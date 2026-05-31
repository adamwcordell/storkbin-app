import {
  FEDEX_DEVELOPER_SETUP_HINT,
  FEDEX_SANDBOX_COMPREHENSIVE_UNAVAILABLE_MESSAGE,
} from "./fedexApiHints.ts";
import { createFedexRateDebugCollector, type FedexDebugCollector } from "./fedexRateDebugExport.ts";
import { isFedexRateDebugEnabled, isFedexSandboxEnv, resolveFedexRatingAccountCandidates } from "./fedexAuth.ts";
import { recordStorkbinFedexRateFailure, logStorkbinFedexRateAttempt, type StorkbinFedexRateAttemptDiagnostic } from "./storkbinFedexRateFailureDiagnostic.ts";
import { fedexAuthorizedJsonHeaders } from "./fedexRestHeaders.ts";

/** FedEx Ground-style rating shared by checkout and cart quote. */

export type PackageProfile =
  | "to_customer_full"
  | "return_full"
  | "return_empty_multi"
  | "starter_empty_multi";

export type ShippingQuoteInput = {
  boxId: string;
  direction: "to_customer" | "to_storage";
  shippingAddress: Record<string, unknown>;
  packageProfile: PackageProfile;
  emptyPieceCount?: number;
  /** When set, selects this FedEx `serviceType` from `options` if present. */
  preferredServiceType?: string;
  /** When true, recipient is rated as commercial (`residential: false`) so FedEx may return FEDEX_GROUND vs Home Delivery. */
  commercialDestination?: boolean;
  /**
   * Debug only (sandbox): rate using FedEx docs sample lane 65247 → 75063 instead of warehouse/customer postals.
   * Does not change stored shipment address or label purchase payload.
   */
  debugFedexSampleLane?: boolean;
};

/** FedEx sandbox docs sample lane (postal-only). */
export const FEDEX_SANDBOX_SAMPLE_LANE = {
  originPostalCode: "65247",
  destinationPostalCode: "75063",
} as const;

const fedexSandboxSampleLaneShipperBlock = () => ({
  address: {
    postalCode: FEDEX_SANDBOX_SAMPLE_LANE.originPostalCode,
    countryCode: "US",
  },
});

const fedexSandboxSampleLaneRecipientBlock = () => ({
  address: {
    postalCode: FEDEX_SANDBOX_SAMPLE_LANE.destinationPostalCode,
    countryCode: "US",
    residential: true,
  },
});

/** One priced FedEx service from a rate reply (deduped by `serviceType`). */
export type FedExRateOption = {
  serviceType: string;
  serviceName: string;
  amountUsd: number;
  estimatedDeliveryDate: string | null;
  estimatedDeliveryWeekday: string | null;
  transitTimeRaw: string | null;
  deliverySummary: string | null;
};

export type ShippingQuote = {
  amountUsd: number;
  provider: string;
  serviceType: string;
  serviceName: string;
  /** FedEx `operationalDetail.deliveryDate` or `commitDate` when present (YYYY-MM-DD). */
  estimatedDeliveryDate: string | null;
  /** FedEx `operationalDetail.deliveryDay` (e.g. MON). */
  estimatedDeliveryWeekday: string | null;
  /** FedEx `operationalDetail.transitTime` enum when present. */
  transitTimeRaw: string | null;
  /** Single line for UI: service + transit + estimated delivery when FedEx returned any. */
  deliverySummary: string | null;
  /** All priced services FedEx returned for this request (cheapest per `serviceType`). */
  options: FedExRateOption[];
};

export type CheckoutGroup = {
  direction: "to_customer" | "to_storage";
  boxes: Array<Record<string, unknown>>;
  packageProfile: PackageProfile;
  emptyPieceCount?: number;
};

const RETURN_EMPTY_MAX = 5;

const DIM_TO_CUSTOMER = { length: 24, width: 16, height: 12, weightLb: 50 };
const DIM_RETURN_FULL = { length: 24, width: 16, height: 12, weightLb: 50 };
const DIM_RETURN_EMPTY_FLAT = { length: 24, width: 16, heightPerBin: 3, weightLbPerPiece: 9 };

const stackedEmptyFedExPackage = (pieceCount: number) => {
  const n = Math.min(RETURN_EMPTY_MAX, Math.max(1, Math.floor(Number(pieceCount) || 1)));
  return {
    weightLb: DIM_RETURN_EMPTY_FLAT.weightLbPerPiece * n,
    length: DIM_RETURN_EMPTY_FLAT.length,
    width: DIM_RETURN_EMPTY_FLAT.width,
    height: DIM_RETURN_EMPTY_FLAT.heightPerBin * n,
  };
};

const buildFedexPackageLineItems = (profile: PackageProfile, emptyPieceCount?: number) => {
  if (profile === "return_empty_multi" || profile === "starter_empty_multi") {
    const p = stackedEmptyFedExPackage(Number(emptyPieceCount || 1));
    return [
      {
        weight: { units: "LB", value: p.weightLb },
        dimensions: {
          length: p.length,
          width: p.width,
          height: p.height,
          units: "IN",
        },
      },
    ];
  }
  const d = profile === "to_customer_full" ? DIM_TO_CUSTOMER : DIM_RETURN_FULL;
  return [
    {
      weight: { units: "LB", value: d.weightLb },
      dimensions: { length: d.length, width: d.width, height: d.height, units: "IN" },
    },
  ];
};

const getAddressField = (address: Record<string, unknown>, key: string) =>
  String(address?.[key] || "").trim();

export const hasValidAddressForQuote = (address: Record<string, unknown>) =>
  Boolean(
    getAddressField(address, "address_line1") &&
      getAddressField(address, "city") &&
      getAddressField(address, "state") &&
      getAddressField(address, "zip"),
  );

const titleCaseWords = (raw: string) =>
  String(raw || "")
    .trim()
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");

/** Normalize checkout/shipment addresses before FedEx rate or ship calls. */
export const normalizeShippingAddressForFedex = (address: Record<string, unknown>) => {
  const zip = getAddressField(address, "zip").replace(/\s+/g, "").slice(0, 10);
  const state = getAddressField(address, "state").toUpperCase().slice(0, 2);
  return {
    ...address,
    address_line1: getAddressField(address, "address_line1"),
    address_line2: getAddressField(address, "address_line2"),
    city: titleCaseWords(getAddressField(address, "city")),
    state,
    zip,
    country_code: getAddressField(address, "country_code") || "US",
  };
};

const FEDEX_ENV = (Deno.env.get("FEDEX_ENV") || "sandbox").trim().toLowerCase();
const FEDEX_BASE_URL =
  FEDEX_ENV === "production" || FEDEX_ENV === "live"
    ? "https://apis.fedex.com"
    : "https://apis-sandbox.fedex.com";

/** Comprehensive Rates API (developer portal product); legacy `/rate/v1/rates/quotes` is a separate entitlement. */
const FEDEX_COMPREHENSIVE_RATES_URL = `${FEDEX_BASE_URL}/rate/v1/comprehensiverates/quotes`;
const FEDEX_LEGACY_RATES_URL = `${FEDEX_BASE_URL}/rate/v1/rates/quotes`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** YYYY-MM-DD in a stable US timezone (defaults to Mountain, matching UT warehouse default). */
const fedexShipDateStamp = (): string => {
  const tz = (Deno.env.get("FEDEX_SHIP_DATE_TZ") || "America/Denver").trim();
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

const hasFedexErrorPayload = (payload: Record<string, unknown>) =>
  Array.isArray(payload?.errors) && (payload.errors as unknown[]).length > 0;

/** FedEx intermittently returns 5xx / UNAVAILABLE on one rate stack; safe to retry or try alternate URL. */
const isFedexTransientOrUnavailable = (httpStatus: number, payload: Record<string, unknown>) => {
  if (httpStatus === 429 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504) return true;
  const errs = payload?.errors;
  if (!Array.isArray(errs)) return false;
  for (const e of errs) {
    const code = String((e as Record<string, unknown>).code || "").toUpperCase();
    if (code.includes("UNAVAILABLE") || code.includes("SYSTEM.UNAVAILABLE")) return true;
  }
  return false;
};

const stripComprehensiveOnlyFields = (body: Record<string, unknown>): Record<string, unknown> => {
  const { carrierCodes: _c, ...rest } = body;
  return rest;
};

const FEDEX_RATE_DEBUG = isFedexRateDebugEnabled();

/** Verbose price-parse logs only when FEDEX_RATE_DEBUG=1. */
const FEDEX_PRICE_PARSE_DEBUG = FEDEX_RATE_DEBUG;

const getFedexAccessToken = async () => {
  const clientId = Deno.env.get("FEDEX_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("FEDEX_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) {
    throw new Error("FedEx credentials are not configured");
  }

  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");
  body.append("client_id", clientId);
  body.append("client_secret", clientSecret);

  const response = await fetch(`${FEDEX_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.errors?.[0]?.message || payload?.error || "FedEx auth failed");
  }

  return String(payload.access_token);
};

export const warehouseAddressBlock = () => {
  const shipperPostal = Deno.env.get("FEDEX_SHIPPER_POSTAL_CODE") || "84401";
  const shipperCountry = Deno.env.get("FEDEX_SHIPPER_COUNTRY_CODE") || "US";
  const shipperState = Deno.env.get("FEDEX_SHIPPER_STATE") || "UT";
  const shipperCity = Deno.env.get("FEDEX_SHIPPER_CITY") || "Ogden";
  const shipperLine1 = Deno.env.get("FEDEX_SHIPPER_ADDRESS_LINE1") || "1990 Wall Ave";
  return {
    address: {
      streetLines: [shipperLine1].filter(Boolean),
      postalCode: shipperPostal,
      countryCode: shipperCountry,
      stateOrProvinceCode: shipperState || undefined,
      city: shipperCity || undefined,
      residential: false,
    },
  };
};

export const customerAddressBlock = (
  addr: Record<string, unknown>,
  opts?: { commercialDestination?: boolean },
) => {
  let residential = true;
  if (opts?.commercialDestination === true) {
    residential = false;
  } else {
    const v = addr.residential;
    if (v === false || v === 0) residential = false;
    else {
      const s = String(v ?? "").toLowerCase();
      if (s === "false" || s === "0" || s === "no" || s === "commercial" || s === "business") residential = false;
    }
  }
  const line1 = getAddressField(addr, "address_line1");
  const line2 = getAddressField(addr, "address_line2");
  return {
    address: {
      streetLines: [line1, line2].filter(Boolean),
      postalCode: getAddressField(addr, "zip"),
      countryCode: getAddressField(addr, "country_code") || "US",
      stateOrProvinceCode: getAddressField(addr, "state") || undefined,
      city: getAddressField(addr, "city") || undefined,
      residential,
    },
  };
};

const formatFedexApiErrors = (payload: Record<string, unknown>): string => {
  const errs = payload?.errors;
  if (!Array.isArray(errs) || errs.length === 0) return "";
  return errs
    .map((e: Record<string, unknown>) => {
      const code = e.code != null ? `[${e.code}] ` : "";
      const msg = String(e.message || "FedEx error");
      const pl = e.parameterList;
      let hint = "";
      if (Array.isArray(pl) && pl.length) {
        hint = ` — fields: ${pl.map((p: Record<string, unknown>) => `${String(p.key || "?")}=${String(p.value || "")}`).join("; ")}`;
      }
      return `${code}${msg}${hint}`;
    })
    .join(" | ");
};

/** OAuth worked but the requested FedEx API operation is not allowed for this project/key pair. */
const isFedexAuthScopeOrCredentialError = (httpStatus: number, payload: Record<string, unknown>) => {
  const blob = `${formatFedexApiErrors(payload)} ${JSON.stringify(payload?.errors || [])}`.toUpperCase();
  return (
    httpStatus === 401 ||
    httpStatus === 403 ||
    blob.includes("FORBIDDEN") ||
    blob.includes("COULD NOT AUTHORIZE YOUR CREDENTIAL") ||
    blob.includes("NOT AUTHORIZED") ||
    blob.includes("ACCESS DENIED")
  );
};

const moneyAmount = (m: unknown): number => {
  if (m == null || typeof m !== "object") return NaN;
  const amt = (m as { amount?: unknown }).amount;
  return amt != null ? Number(amt) : NaN;
};

/**
 * FedEx sometimes returns `totalNetCharge` as a plain number or string; sometimes as `{ currency, amount }`.
 */
const parseTotalNetChargeField = (raw: unknown): number => {
  if (raw == null) return NaN;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return NaN;
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) return n;
    return NaN;
  }
  if (typeof raw === "object") return moneyAmount(raw);
  return NaN;
};

/**
 * Shipment-level total for one `ratedShipmentDetails[]` row: `totalNetCharge` on the block, else
 * `shipmentRateDetail.totalNetCharge` only (no deep scan).
 */
const totalNetChargeUsdFromRatedBlock = (block: Record<string, unknown>): number => {
  const top = parseTotalNetChargeField(block.totalNetCharge);
  if (Number.isFinite(top) && top > 0) return top;
  const srd = block.shipmentRateDetail as Record<string, unknown> | undefined;
  const nested = parseTotalNetChargeField(srd?.totalNetCharge);
  if (Number.isFinite(nested) && nested > 0) return nested;
  return NaN;
};

const getRatedBlockRateType = (block: Record<string, unknown>): string => {
  const direct = block.rateType ?? block.rateShipmentType;
  if (direct != null && String(direct).trim()) return String(direct).trim().toUpperCase();
  const srd = block.shipmentRateDetail as Record<string, unknown> | undefined;
  const inner = srd?.rateType ?? srd?.rateShipmentType;
  if (inner != null && String(inner).trim()) return String(inner).trim().toUpperCase();
  return "";
};

type FedexRatedRowDebug = {
  rateType: string;
  totalNetChargeType: string;
  totalNetChargeRaw: unknown;
  shipmentRateDetailTotalNetChargeType: string;
  shipmentRateDetailTotalNetChargeRaw: unknown;
  parsedTotalNetCharge: number | null;
};

type FedexPricePickDebug = {
  serviceType: string;
  serviceName: string;
  ratedShipmentDetailsLength: number;
  ratedShipmentDetails: FedexRatedRowDebug[];
  /** Index into `ratedShipmentDetails` FedEx returned for this service. */
  selectedRatedShipmentDetailIndex: number | null;
  selectedRateType: string | null;
  selectedTotalNetCharge: number | null;
  selectionReason: string;
  finalNormalizedAppPriceUsd: number;
};

/**
 * Pick one USD price per `rateReplyDetails` row: prefer ACCOUNT `totalNetCharge`, else LIST, else first block with a valid totalNetCharge.
 * Never merges min across blocks (that compared LIST vs ACCOUNT surcharges) and never uses deep Money scan on the parent node.
 */
const selectNetUsdForRateReplyDetail = (
  d: Record<string, unknown>,
): { amountUsd: number; pickDebug: FedexPricePickDebug | null } => {
  const serviceType = String(d.serviceType || "").trim();
  const serviceName = String(d.serviceName || "");
  const blocks = ratedBlocksForDetail(d);

  const buildRowDebug = (b: Record<string, unknown>): FedexRatedRowDebug => {
    const rt = getRatedBlockRateType(b);
    const top = b.totalNetCharge;
    const srd = b.shipmentRateDetail as Record<string, unknown> | undefined;
    const nested = srd?.totalNetCharge;
    const parsed = totalNetChargeUsdFromRatedBlock(b);
    return {
      rateType: rt || "(missing)",
      totalNetChargeType: typeof top,
      totalNetChargeRaw: top,
      shipmentRateDetailTotalNetChargeType: typeof nested,
      shipmentRateDetailTotalNetChargeRaw: nested ?? null,
      parsedTotalNetCharge: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
    };
  };

  const pickFirstPositive = (predicate: (rt: string) => boolean, label: string) => {
    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i];
      const rt = getRatedBlockRateType(b);
      if (!predicate(rt)) continue;
      const n = totalNetChargeUsdFromRatedBlock(b);
      if (Number.isFinite(n) && n > 0) {
        return { block: b, index: i, rateType: rt, amountUsd: n, reason: label };
      }
    }
    return null;
  };

  const account = pickFirstPositive((rt) => rt === "ACCOUNT", "ACCOUNT_totalNetCharge");
  const list = pickFirstPositive((rt) => rt === "LIST", "LIST_totalNetCharge");

  let chosen: {
    block: Record<string, unknown>;
    index: number;
    rateType: string;
    amountUsd: number;
    reason: string;
  } | null = account || list || null;

  if (!chosen) {
    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i];
      const rt = getRatedBlockRateType(b);
      const n = totalNetChargeUsdFromRatedBlock(b);
      if (Number.isFinite(n) && n > 0) {
        chosen = {
          block: b,
          index: i,
          rateType: rt || "UNKNOWN",
          amountUsd: n,
          reason: `FIRST_VALID_${rt || "UNKNOWN"}`,
        };
        break;
      }
    }
  }

  if (!chosen) {
    return {
      amountUsd: NaN,
      pickDebug: FEDEX_PRICE_PARSE_DEBUG
        ? {
            serviceType,
            serviceName,
            ratedShipmentDetailsLength: blocks.length,
            ratedShipmentDetails: blocks.map(buildRowDebug),
            selectedRatedShipmentDetailIndex: null,
            selectedRateType: null,
            selectedTotalNetCharge: null,
            selectionReason: "NO_VALID_totalNetCharge_ON_ANY_RATED_BLOCK",
            finalNormalizedAppPriceUsd: NaN,
          }
        : null,
    };
  }

  const amountUsd = chosen.amountUsd;
  const pickDebug: FedexPricePickDebug | null = FEDEX_PRICE_PARSE_DEBUG
    ? {
        serviceType,
        serviceName,
        ratedShipmentDetailsLength: blocks.length,
        ratedShipmentDetails: blocks.map(buildRowDebug),
        selectedRatedShipmentDetailIndex: chosen.index,
        selectedRateType: chosen.rateType,
        selectedTotalNetCharge: amountUsd,
        selectionReason: chosen.reason,
        finalNormalizedAppPriceUsd: amountUsd,
      }
    : null;

  return { amountUsd, pickDebug };
};

const ratedBlocksForDetail = (d: Record<string, unknown>): Record<string, unknown>[] => {
  const rsd = d.ratedShipmentDetails;
  if (Array.isArray(rsd)) return rsd as Record<string, unknown>[];
  const one = d.ratedShipmentDetail;
  if (one != null && typeof one === "object") return [one as Record<string, unknown>];
  return [];
};

const readOperationalDetail = (
  ...sources: (Record<string, unknown> | undefined)[]
): Record<string, unknown> | undefined => {
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    const od = src.operationalDetail;
    if (od && typeof od === "object" && Object.keys(od as Record<string, unknown>).length > 0) {
      return od as Record<string, unknown>;
    }
    const srd = src.shipmentRateDetail as Record<string, unknown> | undefined;
    const od2 = srd?.operationalDetail;
    if (od2 && typeof od2 === "object" && Object.keys(od2 as Record<string, unknown>).length > 0) {
      return od2 as Record<string, unknown>;
    }
  }
  return undefined;
};

/** FedEx often returns `YYYY-MM-DD` or ISO; show a short US date in summaries (no raw `T17:00:00`). */
const formatFedExDateForSummary = (raw: string | null | undefined): string | null => {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const dateOnly = trimmed.includes("T") ? trimmed.slice(0, trimmed.indexOf("T")) : trimmed.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return trimmed.replace(/T[\d:.-]+Z?$/i, "").trim() || trimmed;
  const d = new Date(`${dateOnly}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateOnly;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
};

const humanizeTransitTime = (raw: string): string | null => {
  const u = raw.toUpperCase().trim();
  if (!u) return null;
  const wordToN: Record<string, string> = {
    ONE: "1",
    TWO: "2",
    THREE: "3",
    FOUR: "4",
    FIVE: "5",
    SIX: "6",
    SEVEN: "7",
    EIGHT: "8",
    NINE: "9",
    TEN: "10",
  };
  const m = u.match(/^(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)_(DAY|DAYS)$/);
  if (m) {
    const n = wordToN[m[1]] || "?";
    return `about ${n} business day${n === "1" ? "" : "s"}`;
  }
  if (u.includes("SAME_DAY")) return "same business day";
  if (u === "ONE_DAY" || u.includes("NEXT_DAY")) return "about 1 business day";
  return u.replace(/_/g, " ").toLowerCase();
};

const buildDeliverySummary = (p: {
  serviceName: string;
  deliveryDate: string | null;
  deliveryDay: string | null;
  transitTimeRaw: string | null;
}): string | null => {
  const parts: string[] = [];
  if (p.serviceName.trim()) parts.push(p.serviceName.trim());
  const tt = p.transitTimeRaw ? humanizeTransitTime(p.transitTimeRaw) : null;
  if (tt) parts.push(tt);
  if (p.deliveryDate) {
    const pretty = formatFedExDateForSummary(p.deliveryDate);
    if (pretty) parts.push(`Est. delivery ${pretty}`);
  }
  if (!parts.length) return null;
  return parts.join(" · ");
};

type FedExDeliveryMeta = {
  estimatedDeliveryDate: string | null;
  estimatedDeliveryWeekday: string | null;
  transitTimeRaw: string | null;
  deliverySummary: string | null;
};

const extractDeliveryMeta = (d: Record<string, unknown>, rated: Record<string, unknown>): FedExDeliveryMeta => {
  const od = readOperationalDetail(rated, d);
  const deliveryDateRaw = od?.deliveryDate != null ? String(od.deliveryDate).trim() : "";
  const commitDateRaw = od?.commitDate != null ? String(od.commitDate).trim() : "";
  const estimatedDeliveryDate = deliveryDateRaw || commitDateRaw || null;
  const estimatedDeliveryWeekday = od?.deliveryDay != null ? String(od.deliveryDay).trim() || null : null;
  const transitTimeRaw = od?.transitTime != null ? String(od.transitTime).trim() || null : null;
  const serviceName = String(d.serviceName || "");
  const deliverySummary = buildDeliverySummary({
    serviceName,
    deliveryDate: estimatedDeliveryDate,
    deliveryDay: estimatedDeliveryWeekday,
    transitTimeRaw,
  });
  return { estimatedDeliveryDate, estimatedDeliveryWeekday, transitTimeRaw, deliverySummary };
};

/** Collect all priced FedEx services (one entry per `serviceType`, lowest USD). */
export const collectAllFedExRateOptions = (payload: Record<string, unknown>): FedExRateOption[] => {
  const out = payload?.output as Record<string, unknown> | undefined;
  const details = out?.rateReplyDetails as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(details)) return [];
  const parseDebugRows: FedexPricePickDebug[] = [];
  const byService = new Map<string, FedExRateOption>();
  for (const d of details) {
    const serviceType = String(d.serviceType || "").trim();
    if (!serviceType) continue;
    const { amountUsd: amt, pickDebug } = selectNetUsdForRateReplyDetail(d);
    if (pickDebug) parseDebugRows.push(pickDebug);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const blocks = ratedBlocksForDetail(d);
    const ratedForMeta = (blocks[0] || d) as Record<string, unknown>;
    const meta = extractDeliveryMeta(d, ratedForMeta);
    const opt: FedExRateOption = {
      serviceType,
      serviceName: String(d.serviceName || ""),
      amountUsd: amt,
      ...meta,
    };
    const prev = byService.get(serviceType);
    if (!prev || amt < prev.amountUsd) byService.set(serviceType, opt);
  }
  if (FEDEX_PRICE_PARSE_DEBUG && parseDebugRows.length) {
    console.error(
      "[FEDEX_PRICE_PARSE_DEBUG] Per-service totalNetCharge: prefer ACCOUNT ratedShipmentDetail, else LIST; " +
        "only shipment-level totalNetCharge (no min across blocks, no deep Money scan — old logic could e.g. show 2.98 vs FedEx 53.82).\n" +
        JSON.stringify(parseDebugRows, null, 2),
    );
  }
  return [...byService.values()].sort((a, b) => a.amountUsd - b.amountUsd);
};

const pickDefaultFedExOption = (options: FedExRateOption[], preferred?: string): FedExRateOption => {
  if (preferred) {
    const m = options.find((o) => o.serviceType === preferred);
    if (m) return m;
  }
  // Always default to FedEx’s lowest-priced option for this quote (scheduled auto-ship, cart default, etc.).
  return [...options].reduce((a, b) => (a.amountUsd <= b.amountUsd ? a : b));
};

/** Customer checkout: FedEx Ground carrier only (no FDXE Express stack in the primary quote path). */
const FEDEX_CARRIER_CODES_CHECKOUT = ["FDXG"] as const;

const envFlagTrue = (key: string) =>
  ["1", "true", "yes"].includes(String(Deno.env.get(key) || "").trim().toLowerCase());

/** Optional second/third POSTs for Ground Economy / SmartPost; default off so checkout stays fast. */
const FEDEX_ENABLE_GROUND_ECONOMY_PROBES = envFlagTrue("FEDEX_ENABLE_GROUND_ECONOMY_PROBES");

/** When true, also try standard Rates and Transit Times (`/rate/v1/rates/quotes`) after comprehensive fails. */
const FEDEX_ENABLE_STANDARD_RATES_API = envFlagTrue("FEDEX_ENABLE_STANDARD_RATES_API");

const normalizeFedexServiceTypeKey = (st: string) =>
  String(st || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");

/** StorkBin UI: only these priced `serviceType` values are shown after FedEx returns a reply. */
const isStorkbinCustomerVisibleGroundServiceType = (st: string): boolean => {
  const u = normalizeFedexServiceTypeKey(st);
  if (u === "GROUND_HOME_DELIVERY") return true;
  if (u === "FEDEX_GROUND") return true;
  if (u === "FEDEX_GROUND_ECONOMY") return true;
  if (u === "SMART_POST" || u === "SMARTPOST") return true;
  return false;
};

const storkbinGroundDisplayLabel = (st: string): string => {
  const u = normalizeFedexServiceTypeKey(st);
  if (u === "GROUND_HOME_DELIVERY") return "FedEx Home Delivery";
  if (u === "FEDEX_GROUND") return "FedEx Ground";
  if (u === "FEDEX_GROUND_ECONOMY") return "FedEx Ground Economy";
  if (u === "SMART_POST" || u === "SMARTPOST") return "FedEx Ground Economy";
  return String(st || "").trim() || "FedEx";
};

const STORKBIN_FEDEX_EXPRESS_BLOCKLIST = new Set(
  [
    "FIRST_OVERNIGHT",
    "PRIORITY_OVERNIGHT",
    "STANDARD_OVERNIGHT",
    "FEDEX_2_DAY_AM",
    "FEDEX_2_DAY",
    "FEDEX_EXPRESS_SAVER",
    "FEDEX_STANDARD_OVERNIGHT",
    "FEDEX_FIRST_OVERNIGHT",
    "FEDEX_PRIORITY_OVERNIGHT",
    "FEDEX_1_DAY_FREIGHT",
    "FEDEX_2_DAY_FREIGHT",
    "FEDEX_3_DAY_FREIGHT",
    "FEDEX_FIRST_FREIGHT",
    "FEDEX_FREIGHT_ECONOMY",
    "FEDEX_SAME_DAY",
    "FEDEX_SAME_DAY_CITY",
  ].map((s) => s.toUpperCase()),
);

const isStorkbinFedexExpressLikeServiceType = (st: string): boolean => {
  const u = normalizeFedexServiceTypeKey(st);
  if (STORKBIN_FEDEX_EXPRESS_BLOCKLIST.has(u)) return true;
  if (u.includes("OVERNIGHT")) return true;
  if (u.includes("INTERNATIONAL") && !u.includes("GROUND")) return true;
  if (u.includes("EXPRESS") && !u.includes("GROUND")) return true;
  if (/\bFEDEX_\d+_DAY\b/.test(u)) return true;
  if (u.includes("SAME_DAY")) return true;
  return false;
};

const storkbinGroundFilterReason = (st: string): string => {
  if (isStorkbinFedexExpressLikeServiceType(st)) {
    return `express_or_non_ground_service:${normalizeFedexServiceTypeKey(st)}`;
  }
  return `not_storkbin_checkout_ground_allowlist:${normalizeFedexServiceTypeKey(st)}`;
};

const filterToStorkbinFedexGroundOptionsForCustomer = (
  options: FedExRateOption[],
): { filtered: FedExRateOption[]; removed: Array<{ serviceType: string; amountUsd: number; reason: string }> } => {
  const removed: Array<{ serviceType: string; amountUsd: number; reason: string }> = [];
  const filtered: FedExRateOption[] = [];
  for (const o of options) {
    if (isStorkbinCustomerVisibleGroundServiceType(o.serviceType)) {
      const label = storkbinGroundDisplayLabel(o.serviceType);
      filtered.push({
        ...o,
        serviceName: label,
        deliverySummary: buildDeliverySummary({
          serviceName: label,
          deliveryDate: o.estimatedDeliveryDate,
          deliveryDay: o.estimatedDeliveryWeekday,
          transitTimeRaw: o.transitTimeRaw,
        }),
      });
    } else {
      removed.push({
        serviceType: o.serviceType,
        amountUsd: o.amountUsd,
        reason: storkbinGroundFilterReason(o.serviceType),
      });
    }
  }
  filtered.sort((a, b) => a.amountUsd - b.amountUsd);
  return { filtered, removed };
};

const logStorkbinFedexGroundFilter = (p: {
  attemptLabel: string;
  /** Every `serviceType` on `output.rateReplyDetails` from the primary quote response (may include unpriced rows). */
  allRateReplyDetailServiceTypesFromPayload: string[];
  allFedexServicesReturned: string[];
  filteredOut: Array<{ serviceType: string; amountUsd: number; reason: string }>;
  customerVisibleOptions: Array<{ serviceType: string; serviceName: string; amountUsd: number }>;
  selectedServiceType: string;
  selectedAmountUsd: number;
}) => {
  if (!FEDEX_RATE_DEBUG && !FEDEX_PRICE_PARSE_DEBUG) return;
  console.error(JSON.stringify({ storkbinFedexGroundFilter: p }));
};

const listRateReplyDetailServiceTypes = (payload: Record<string, unknown>): string[] => {
  const out = payload?.output as Record<string, unknown> | undefined;
  const details = out?.rateReplyDetails as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(details)) return [];
  return details.map((d) => String(d.serviceType || "").trim()).filter(Boolean);
};

const COMPREHENSIVE_RATES_PATH = "/rate/v1/comprehensiverates/quotes";

const postFedexRateQuoteOnce = async (
  token: string,
  url: string,
  body: Record<string, unknown>,
  debugCtx?: { attemptLabel: string; collector: FedexDebugCollector | null },
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown>; fedexTransactionId: string }> => {
  const fedexTransactionId = crypto.randomUUID();
  const headers = fedexAuthorizedJsonHeaders(token, fedexTransactionId);
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const hasBlockingErrors = hasFedexErrorPayload(payload);
  const ok = response.ok && !hasBlockingErrors;

  if (debugCtx?.collector && url.includes(COMPREHENSIVE_RATES_PATH)) {
    const hObj = Object.fromEntries([...Object.entries(headers)]) as Record<string, string>;
    debugCtx.collector.recordComprehensiveAttempt({
      attemptLabel: debugCtx.attemptLabel,
      endpointUrl: url,
      requestHeaders: hObj,
      requestBody: body,
      httpStatus: response.status,
      ok,
      fedexCustomerTransactionId: fedexTransactionId,
      payload,
    });
  }

  return { ok, status: response.status, payload, fedexTransactionId };
};

const FEDEX_RATE_TRANSIENT_RETRIES = 4;

const postFedexRateQuoteResilient = async (
  token: string,
  url: string,
  body: Record<string, unknown>,
  attemptLabel: string,
  collector: FedexDebugCollector | null,
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown>; fedexTransactionId: string }> => {
  let last: { ok: boolean; status: number; payload: Record<string, unknown>; fedexTransactionId: string } = {
    ok: false,
    status: 0,
    payload: {},
    fedexTransactionId: "",
  };
  const debugOnceLabel = `${attemptLabel}_${url.includes(COMPREHENSIVE_RATES_PATH) ? "comprehensive" : "legacy"}`;
  const debugCtx = collector ? { attemptLabel: debugOnceLabel, collector } : undefined;
  for (let t = 0; t < FEDEX_RATE_TRANSIENT_RETRIES; t += 1) {
    last = await postFedexRateQuoteOnce(token, url, body, debugCtx);
    if (last.ok || !isFedexTransientOrUnavailable(last.status, last.payload)) break;
    if (FEDEX_RATE_DEBUG) {
      console.error(
        JSON.stringify({
          fedexRateTransientRetry: t + 1,
          attemptLabel,
          url,
          httpStatus: last.status,
          fedexErrors: Array.isArray(last.payload?.errors) ? last.payload.errors : [],
        }),
      );
    }
    if (t < FEDEX_RATE_TRANSIENT_RETRIES - 1) {
      await sleep(Math.min(2400, 450 * 2 ** t));
    }
  }
  return last;
};

/**
 * Primary: Comprehensive Rates (`/rate/v1/comprehensiverates/quotes`).
 * Legacy `/rate/v1/rates/quotes` only when `FEDEX_ENABLE_STANDARD_RATES_API=1`.
 */
const postFedexRateQuote = async (
  token: string,
  body: Record<string, unknown>,
  attemptLabel: string,
  collector: FedexDebugCollector | null,
): Promise<{
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
  fedexTransactionId: string;
  endpointUrl: string;
}> => {
  const steps: Array<{ url: string; body: Record<string, unknown>; label: string }> = [];

  /** Comprehensive Rates requires accountNumber — LIST without account is standard Rates API only. */
  if (attemptLabel !== "list_no_account") {
    steps.push({
      url: FEDEX_COMPREHENSIVE_RATES_URL,
      body,
      label: `${attemptLabel}_comprehensive`,
    });
  }

  if (FEDEX_ENABLE_STANDARD_RATES_API) {
    const legacyBody = stripComprehensiveOnlyFields(body);
    const legacyNoAccount = { ...legacyBody };
    delete legacyNoAccount.accountNumber;
    if (attemptLabel === "list_no_account") {
      steps.push({
        url: FEDEX_LEGACY_RATES_URL,
        body: legacyNoAccount,
        label: `${attemptLabel}_legacy_list_no_account`,
      });
    } else {
      steps.push({
        url: FEDEX_LEGACY_RATES_URL,
        body: legacyNoAccount,
        label: `${attemptLabel}_legacy_list_no_account`,
      });
      steps.push({
        url: FEDEX_LEGACY_RATES_URL,
        body: legacyBody,
        label: `${attemptLabel}_legacy`,
      });
    }
  }

  let last: {
    ok: boolean;
    status: number;
    payload: Record<string, unknown>;
    fedexTransactionId: string;
    endpointUrl: string;
  } = {
    ok: false,
    status: 0,
    payload: {},
    fedexTransactionId: "",
    endpointUrl: steps[0]?.url ?? FEDEX_COMPREHENSIVE_RATES_URL,
  };

  for (const step of steps) {
    const r = await postFedexRateQuoteResilient(token, step.url, step.body, step.label, collector);
    last = { ...r, endpointUrl: step.url };
    if (last.ok) return last;
  }

  return last;
};

/** Cheapest option per `serviceType` when merging main FDXG quote with optional serviceType probes. */
const mergeFedexOptionsByServiceType = (a: FedExRateOption[], b: FedExRateOption[]): FedExRateOption[] => {
  const m = new Map<string, FedExRateOption>();
  for (const o of a) m.set(o.serviceType, o);
  for (const o of b) {
    const prev = m.get(o.serviceType);
    if (!prev || o.amountUsd < prev.amountUsd) m.set(o.serviceType, o);
  }
  return [...m.values()].sort((x, y) => x.amountUsd - y.amountUsd);
};

/** Optional probe: same shipment as main quote, `carrierCodes: FDXG`, `requestedShipment.serviceType` set. Never throws. */
const optionalFedexGroundServiceTypeProbe = async (
  token: string,
  baseListBody: Record<string, unknown>,
  serviceType: string,
  collector: FedexDebugCollector | null,
): Promise<FedExRateOption[]> => {
  let clone: Record<string, unknown>;
  try {
    clone = JSON.parse(JSON.stringify(baseListBody)) as Record<string, unknown>;
  } catch {
    return [];
  }
  clone.carrierCodes = [...FEDEX_CARRIER_CODES_CHECKOUT];
  const rs = clone.requestedShipment as Record<string, unknown> | undefined;
  if (!rs || typeof rs !== "object") return [];
  rs.serviceType = serviceType;
  const r = await postFedexRateQuote(token, clone, `probe_${serviceType}`, collector);
  if (!r.ok) {
    if (FEDEX_RATE_DEBUG || FEDEX_PRICE_PARSE_DEBUG) {
      console.error(
        JSON.stringify({
          fedexOptionalGroundProbe: {
            serviceType,
            ok: false,
            httpStatus: r.status,
            fedexErrors: Array.isArray(r.payload?.errors) ? r.payload.errors : [],
          },
        }),
      );
    }
    return [];
  }
  const opts = collectAllFedExRateOptions(r.payload);
  if (!opts.length && (FEDEX_RATE_DEBUG || FEDEX_PRICE_PARSE_DEBUG)) {
    console.error(
      JSON.stringify({
        fedexOptionalGroundProbe: {
          serviceType,
          ok: true,
          note: "no_priced_service_in_reply",
          fedexErrors: Array.isArray(r.payload?.errors) ? r.payload.errors : [],
        },
      }),
    );
  }
  return opts;
};

const getFedexQuote = async (input: ShippingQuoteInput): Promise<ShippingQuote> => {
  const ratingAccounts = resolveFedexRatingAccountCandidates();
  const fedexDebugCollector = FEDEX_RATE_DEBUG
    ? createFedexRateDebugCollector(ratingAccounts[0] || "")
    : null;

  try {
  const token = await getFedexAccessToken();
  const warehouse = warehouseAddressBlock();
  const customer = customerAddressBlock(input.shippingAddress, {
    commercialDestination: input.commercialDestination === true,
  });
  let shipperBlock = input.direction === "to_storage" ? customer : warehouse;
  let recipientBlock = input.direction === "to_storage" ? warehouse : customer;
  if (input.debugFedexSampleLane) {
    shipperBlock =
      input.direction === "to_storage"
        ? fedexSandboxSampleLaneRecipientBlock()
        : fedexSandboxSampleLaneShipperBlock();
    recipientBlock =
      input.direction === "to_storage"
        ? fedexSandboxSampleLaneShipperBlock()
        : fedexSandboxSampleLaneRecipientBlock();
  }

  /** StorkBin checkout: Ground carrier only (`FDXG`). Express (`FDXE`) is not requested on the customer path. */
  const carrierCodes = [...FEDEX_CARRIER_CODES_CHECKOUT];
  const rateRequestControlParameters = { returnTransitTimes: true };

  const shipDateStamp = fedexShipDateStamp();

  const requestedShipmentBase: Record<string, unknown> = {
    shipDateStamp,
    shipper: shipperBlock,
    recipient: recipientBlock,
    pickupType: "DROPOFF_AT_FEDEX_LOCATION",
    packagingType: "YOUR_PACKAGING",
    requestedPackageLineItems: buildFedexPackageLineItems(
      input.packageProfile,
      input.emptyPieceCount,
    ),
  };

  type Attempt = { label: string; body: Record<string, unknown> };
  const attempts: Attempt[] = [];

  for (const accountNumber of ratingAccounts) {
    const shippingChargesPayment = {
      paymentType: "SENDER",
      payor: {
        responsibleParty: {
          accountNumber: { value: accountNumber },
        },
      },
    };
    attempts.push({
      label: `list_${accountNumber.slice(-4)}`,
      body: {
        accountNumber: { value: accountNumber },
        carrierCodes,
        rateRequestControlParameters,
        requestedShipment: {
          ...requestedShipmentBase,
          shippingChargesPayment,
          rateRequestType: ["LIST"],
        },
      },
    });
    attempts.push({
      label: `account_list_${accountNumber.slice(-4)}`,
      body: {
        accountNumber: { value: accountNumber },
        carrierCodes,
        rateRequestControlParameters,
        requestedShipment: {
          ...requestedShipmentBase,
          shippingChargesPayment,
          rateRequestType: ["ACCOUNT", "LIST"],
        },
      },
    });
  }

  if (FEDEX_ENABLE_STANDARD_RATES_API) {
    attempts.push({
      label: "list_no_account",
      body: {
        carrierCodes,
        rateRequestControlParameters,
        requestedShipment: {
          ...requestedShipmentBase,
          rateRequestType: ["LIST"],
        },
      },
    });
  }

  let lastEndpoint = FEDEX_COMPREHENSIVE_RATES_URL;
  let lastAccountLabel = "none";
  let lastFailedRateAttempt: {
    attempt: Attempt;
    status: number;
    payload: Record<string, unknown>;
    fedexTransactionId: string;
    endpointUrl: string;
  } | null = null;

  const attemptDiagnostics: StorkbinFedexRateAttemptDiagnostic[] = [];

  const fedexPayloadErrorFields = (payload: Record<string, unknown>) => {
    const errs = payload?.errors;
    if (!Array.isArray(errs) || errs.length === 0) {
      return { errorCode: null as string | null, errorMessage: null as string | null };
    }
    const first = errs[0] as Record<string, unknown>;
    return {
      errorCode: first?.code != null ? String(first.code) : null,
      errorMessage: first?.message != null ? String(first.message) : null,
    };
  };

  const pushAttemptDiagnostic = (entry: StorkbinFedexRateAttemptDiagnostic) => {
    attemptDiagnostics.push(entry);
  };

  const captureTerminalRateFailure = (
    attempt: Attempt,
    status: number,
    payload: Record<string, unknown>,
    fedexTransactionId: string,
    endpointUrl: string,
  ) => {
    recordStorkbinFedexRateFailure({
      endpointUrl,
      environment: isFedexSandboxEnv() ? "sandbox" : "production",
      attemptLabel: attempt.label,
      requestBody: attempt.body,
      fedexHttpStatus: status,
      fedexTransactionId,
      fedexPayload: payload,
      attemptDiagnostics: [...attemptDiagnostics],
    });
  };

  const throwFedexQuoteError = (message: string): never => {
    const error = new Error(message) as Error & { attemptDiagnostics: StorkbinFedexRateAttemptDiagnostic[] };
    error.attemptDiagnostics = [...attemptDiagnostics];
    throw error;
  };

  const isListOnlyRateAttempt = (label: string) =>
    label === "list_no_account" ||
    (label.startsWith("list_") && !label.startsWith("account_list_"));

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    lastAccountLabel = attempt.label;
    const startedAt = new Date().toISOString();
    const { ok, status, payload, fedexTransactionId, endpointUrl } = await postFedexRateQuote(
      token,
      attempt.body,
      attempt.label,
      fedexDebugCollector,
    );
    const completedAt = new Date().toISOString();
    lastEndpoint = endpointUrl;
    const { errorCode, errorMessage } = fedexPayloadErrorFields(payload);
    logStorkbinFedexRateAttempt({
      attemptLabel: attempt.label,
      endpointUrl,
      fedexHttpStatus: status,
      fedexPayload: payload,
      ok,
    });

    if (!ok) {
      lastFailedRateAttempt = { attempt, status, payload, fedexTransactionId, endpointUrl };
      if (FEDEX_RATE_DEBUG) {
        console.error(
          JSON.stringify({
            attemptLabel: attempt.label,
            httpStatus: status,
            fedexErrors: Array.isArray(payload?.errors) ? payload.errors : [],
            fedexTransactionId,
          }),
        );
      }
      const detail = formatFedexApiErrors(payload) || String(payload?.error || "FedEx rate quote failed");
      const canTryNextRateStrategy =
        i + 1 < attempts.length &&
        (isFedexAuthScopeOrCredentialError(status, payload) || isFedexTransientOrUnavailable(status, payload));
      if (canTryNextRateStrategy) {
        pushAttemptDiagnostic({
          attemptLabel: attempt.label,
          startedAt,
          completedAt,
          endpointUrl,
          status,
          ok,
          errorCode,
          errorMessage,
          didContinueToNextAttempt: true,
          continueReason: "fedex_transient_or_auth_error",
        });
        continue;
      }
      pushAttemptDiagnostic({
        attemptLabel: attempt.label,
        startedAt,
        completedAt,
        endpointUrl,
        status,
        ok,
        errorCode,
        errorMessage,
        didContinueToNextAttempt: false,
        continueReason: "terminal_http_error",
      });
      const looksLikeFedexOverload =
        isFedexTransientOrUnavailable(status, payload) || /UNAVAILABLE|TRY AGAIN LATER/i.test(detail);
      const sandboxComprehensiveUnavailable =
        isFedexSandboxEnv() &&
        endpointUrl.includes("/comprehensiverates/") &&
        looksLikeFedexOverload &&
        !isFedexAuthScopeOrCredentialError(status, payload);
      captureTerminalRateFailure(attempt, status, payload, fedexTransactionId, endpointUrl);
      if (sandboxComprehensiveUnavailable) {
        throwFedexQuoteError(FEDEX_SANDBOX_COMPREHENSIVE_UNAVAILABLE_MESSAGE);
      }
      const addrHint =
        looksLikeFedexOverload && !isFedexAuthScopeOrCredentialError(status, payload)
          ? ""
          : input.direction === "to_storage"
            ? "Check the ship-from street address, city, state, and ZIP."
            : "Check the destination street address, city, state, and ZIP.";
      const envLabel = isFedexSandboxEnv()
        ? "sandbox (https://apis-sandbox.fedex.com)"
        : "production (https://apis.fedex.com)";
      const envMismatchHint = isFedexSandboxEnv()
        ? " You are on sandbox: use FedEx sandbox Client ID/Secret, FEDEX_ENV=sandbox (or unset), and sandbox test account 740561073 in FEDEX_ACCOUNT_NUMBER (or leave unset). A production account number in sandbox causes SERVICE.UNAVAILABLE on rating."
        : " You are on production: set FEDEX_ENV=production, use production Client ID/Secret, and FEDEX_ACCOUNT_NUMBER must be your live FedEx shipping account linked in the developer portal.";
      const setupHint =
        isFedexAuthScopeOrCredentialError(status, payload) || looksLikeFedexOverload
          ? ` ${FEDEX_DEVELOPER_SETUP_HINT}`
          : "";
      const addrSep = addrHint ? " " : "";
      const endpointPath = lastEndpoint.includes("/comprehensiverates/")
        ? "/rate/v1/comprehensiverates/quotes"
        : "/rate/v1/rates/quotes";
      const attemptHint = ` Endpoint: ${endpointPath}. Rate attempt: ${lastAccountLabel}.`;
      throwFedexQuoteError(
        `FedEx could not price this shipment (${detail}). Environment: ${envLabel}.${envMismatchHint}${attemptHint}${addrSep}${addrHint}${setupHint}`,
      );
    }

    let mergedBeforeCustomerFilter = collectAllFedExRateOptions(payload);
    if (mergedBeforeCustomerFilter.length > 0) {
      const allRateReplyDetailServiceTypesFromPayload = listRateReplyDetailServiceTypes(payload);
      if (FEDEX_ENABLE_GROUND_ECONOMY_PROBES) {
        for (const probeSt of ["FEDEX_GROUND_ECONOMY", "SMART_POST"] as const) {
          const extra = await optionalFedexGroundServiceTypeProbe(
            token,
            attempt.body,
            probeSt,
            fedexDebugCollector,
          );
          if (extra.length) {
            mergedBeforeCustomerFilter = mergeFedexOptionsByServiceType(mergedBeforeCustomerFilter, extra);
          }
        }
      }

      const allFedexServicesReturned = mergedBeforeCustomerFilter.map((o) => o.serviceType);
      const { filtered, removed } = filterToStorkbinFedexGroundOptionsForCustomer(mergedBeforeCustomerFilter);

      if (filtered.length > 0) {
        const sel = pickDefaultFedExOption(filtered, input.preferredServiceType?.trim());
        logStorkbinFedexGroundFilter({
          attemptLabel: attempt.label,
          allRateReplyDetailServiceTypesFromPayload,
          allFedexServicesReturned,
          filteredOut: removed,
          customerVisibleOptions: filtered.map((o) => ({
            serviceType: o.serviceType,
            serviceName: o.serviceName,
            amountUsd: o.amountUsd,
          })),
          selectedServiceType: sel.serviceType,
          selectedAmountUsd: sel.amountUsd,
        });
        return {
          amountUsd: sel.amountUsd,
          provider: `fedex_${FEDEX_ENV}_${attempt.label}`,
          serviceType: sel.serviceType,
          serviceName: sel.serviceName,
          estimatedDeliveryDate: sel.estimatedDeliveryDate,
          estimatedDeliveryWeekday: sel.estimatedDeliveryWeekday,
          transitTimeRaw: sel.transitTimeRaw,
          deliverySummary: sel.deliverySummary,
          options: filtered,
        };
      }

      logStorkbinFedexGroundFilter({
        attemptLabel: attempt.label,
        allRateReplyDetailServiceTypesFromPayload,
        allFedexServicesReturned,
        filteredOut: removed,
        customerVisibleOptions: [],
        selectedServiceType: "(none_after_ground_filter)",
        selectedAmountUsd: NaN,
      });
      if (isListOnlyRateAttempt(attempt.label) && i + 1 < attempts.length) {
        pushAttemptDiagnostic({
          attemptLabel: attempt.label,
          startedAt,
          completedAt,
          endpointUrl,
          status,
          ok,
          errorCode,
          errorMessage,
          didContinueToNextAttempt: true,
          continueReason: "no_ground_options_after_filter",
        });
        continue;
      }
      pushAttemptDiagnostic({
        attemptLabel: attempt.label,
        startedAt,
        completedAt,
        endpointUrl,
        status,
        ok,
        errorCode,
        errorMessage,
        didContinueToNextAttempt: false,
        continueReason: "terminal_no_ground_options_after_filter",
      });
      captureTerminalRateFailure(attempt, status, payload, fedexTransactionId, endpointUrl);
      throwFedexQuoteError(
        `FedEx returned no StorkBin ground shipping options for this shipment (only services not offered at checkout). ` +
          `Priced service types from FedEx: ${allFedexServicesReturned.join(", ") || "(none)"}. ` +
          "Verify the destination is a US domestic address with a full street line.",
      );
    }

    if (isListOnlyRateAttempt(attempt.label) && i + 1 < attempts.length) {
      pushAttemptDiagnostic({
        attemptLabel: attempt.label,
        startedAt,
        completedAt,
        endpointUrl,
        status,
        ok,
        errorCode,
        errorMessage,
        didContinueToNextAttempt: true,
        continueReason: "http_ok_no_priced_services",
      });
      continue;
    }

    const detail = formatFedexApiErrors(payload);
    const out = payload?.output as Record<string, unknown> | undefined;
    const details = out?.rateReplyDetails as Array<Record<string, unknown>> | undefined;
    const offered = Array.isArray(details)
      ? details.map((d) => String(d.serviceType || d.serviceName || "?")).join(", ")
      : "";
    pushAttemptDiagnostic({
      attemptLabel: attempt.label,
      startedAt,
      completedAt,
      endpointUrl,
      status,
      ok,
      errorCode,
      errorMessage,
      didContinueToNextAttempt: false,
      continueReason: "terminal_http_ok_no_priced_services",
    });
    captureTerminalRateFailure(attempt, status, payload, fedexTransactionId, endpointUrl);
    throwFedexQuoteError(
      `FedEx returned no priced service for this shipment. ${detail || ""}${offered ? ` Services: ${offered}.` : ""} ` +
        "Verify ZIPs and a full street address.",
    );
  }

  if (lastFailedRateAttempt) {
    const f = lastFailedRateAttempt;
    captureTerminalRateFailure(f.attempt, f.status, f.payload, f.fedexTransactionId, f.endpointUrl);
  }
  throwFedexQuoteError("FedEx rate quote failed after all attempts.");
  } finally {
    if (fedexDebugCollector) {
      const path = await fedexDebugCollector.writeToFile();
      if (path) {
        console.error(`[FEDEX_RATE_DEBUG] wrote ${path}`);
      }
    }
  }
};

export const getShippingQuote = async (input: ShippingQuoteInput): Promise<ShippingQuote> => {
  const shippingAddress = normalizeShippingAddressForFedex(input.shippingAddress);
  if (!hasValidAddressForQuote(shippingAddress)) {
    throw new Error(
      `Missing required address fields for FedEx quote (address_line1, city, state, zip) for bin ${input.boxId}.`,
    );
  }
  return await getFedexQuote({ ...input, shippingAddress });
};

export const addressKeyForBundle = (address: Record<string, unknown> | null | undefined) => {
  if (!address) return "";
  return [
    String(address.address_line1 || "").toLowerCase().trim(),
    String(address.city || "").toLowerCase().trim(),
    String(address.state || "").toUpperCase().trim(),
    String(address.zip || "").trim(),
  ].join("|");
};

/** Stable key for a checkout group; must match `lineKeyForGroup` in `quote-cart-shipping`. */
export const shippingLineKeyForGroupBoxes = (groupBoxes: Array<Record<string, unknown>>) => {
  const ids = groupBoxes.map((b) => String(b.id)).sort();
  return ids.length === 1 ? `box:${ids[0]}` : `bundle:${ids.join("-")}`;
};

export const buildCheckoutGroups = (
  boxes: Array<Record<string, unknown>>,
): { groups: CheckoutGroup[]; error?: string } => {
  const toCustomer = boxes.filter((b) => String(b.cart_type) === "ship_to_customer");
  const returns = boxes.filter((b) => String(b.cart_type) === "return_to_storage");
  const returnFull = returns.filter((b) => !b.return_shipment_empty);
  const returnEmpty = returns.filter((b) => Boolean(b.return_shipment_empty));

  const groups: CheckoutGroup[] = [];

  for (const b of toCustomer) {
    groups.push({
      direction: "to_customer",
      boxes: [b],
      packageProfile: "to_customer_full",
    });
  }

  for (const b of returnFull) {
    groups.push({
      direction: "to_storage",
      boxes: [b],
      packageProfile: "return_full",
    });
  }

  const byAddr = new Map<string, typeof returnEmpty>();
  for (const b of returnEmpty) {
    const addr = b.requested_shipping_address as Record<string, unknown> | null;
    const k = addressKeyForBundle(addr);
    if (!byAddr.has(k)) byAddr.set(k, []);
    byAddr.get(k)!.push(b);
  }

  for (const [, list] of byAddr) {
    const sorted = [...list].sort((a, b) =>
      String(a.box_number || a.id).localeCompare(String(b.box_number || b.id), undefined, {
        numeric: true,
      }),
    );
    for (let i = 0; i < sorted.length; i += RETURN_EMPTY_MAX) {
      const chunk = sorted.slice(i, i + RETURN_EMPTY_MAX);
      groups.push({
        direction: "to_storage",
        boxes: chunk,
        packageProfile: "return_empty_multi",
        emptyPieceCount: chunk.length,
      });
    }
  }

  return { groups };
};

export const mergeShipmentAddressWithPackageMeta = (
  base: Record<string, unknown>,
  profile: PackageProfile,
  emptyPieceCount?: number,
) => {
  if (profile === "to_customer_full") {
    return {
      ...base,
      storkbin_package: {
        kind: "to_customer_full",
        length_in: DIM_TO_CUSTOMER.length,
        width_in: DIM_TO_CUSTOMER.width,
        height_in: DIM_TO_CUSTOMER.height,
        weight_lb: DIM_TO_CUSTOMER.weightLb,
      },
    };
  }
  if (profile === "return_full") {
    return {
      ...base,
      storkbin_package: {
        kind: "return_full",
        length_in: DIM_RETURN_FULL.length,
        width_in: DIM_RETURN_FULL.width,
        height_in: DIM_RETURN_FULL.height,
        weight_lb: DIM_RETURN_FULL.weightLb,
      },
    };
  }
  const n = Math.min(RETURN_EMPTY_MAX, Math.max(1, Number(emptyPieceCount || 1)));
  const p = stackedEmptyFedExPackage(n);
  const pkgMeta = {
    piece_count: n,
    length_in: p.length,
    width_in: p.width,
    height_in: p.height,
    weight_lb: p.weightLb,
    weight_lb_per_piece: DIM_RETURN_EMPTY_FLAT.weightLbPerPiece,
    per_bin_height_in: DIM_RETURN_EMPTY_FLAT.heightPerBin,
  };
  if (profile === "starter_empty_multi") {
    return {
      ...base,
      storkbin_package: {
        kind: "starter_empty_multi",
        ...pkgMeta,
      },
    };
  }
  return {
    ...base,
    storkbin_package: {
      kind: "return_empty_multi",
      ...pkgMeta,
    },
  };
};

/** Human-readable stacked empty-bin package for admin label UI. */
export const describeStarterEmptyStackPackage = (pieceCount: number) => {
  const n = Math.min(RETURN_EMPTY_MAX, Math.max(1, Math.floor(Number(pieceCount) || 1)));
  const p = stackedEmptyFedExPackage(n);
  return {
    pieceCount: n,
    lengthIn: p.length,
    widthIn: p.width,
    heightIn: p.height,
    weightLb: p.weightLb,
    perBinHeightIn: DIM_RETURN_EMPTY_FLAT.heightPerBin,
    perBinWeightLb: DIM_RETURN_EMPTY_FLAT.weightLbPerPiece,
    collapsedFootprintLabel: `${p.length}" × ${p.width}" footprint per bin`,
    stackedHeightLabel: `${p.height}" total height (${DIM_RETURN_EMPTY_FLAT.heightPerBin}" per collapsed bin × ${n})`,
    summary:
      n === 1
        ? `1 collapsed empty bin — ${p.length}" × ${p.width}" × ${p.height}", ${p.weightLb} lb`
        : `${n} collapsed empty bins stacked — ${p.length}" × ${p.width}" × ${p.height}" (L×W×H), ${p.weightLb} lb total`,
  };
};

export const withFedexShipMeta = (
  addr: Record<string, unknown>,
  fedex: {
    serviceType: string;
    serviceName: string;
    estimatedDeliveryDate?: string | null;
    estimatedDeliveryWeekday?: string | null;
    transitTimeRaw?: string | null;
    deliverySummary?: string | null;
  },
) => ({
  ...addr,
  fedex_ship_service_type: fedex.serviceType,
  fedex_ship_service_name: fedex.serviceName || "",
  fedex_estimated_delivery_date: fedex.estimatedDeliveryDate ?? null,
  fedex_estimated_delivery_weekday: fedex.estimatedDeliveryWeekday ?? null,
  fedex_transit_time: fedex.transitTimeRaw ?? null,
  fedex_delivery_summary: fedex.deliverySummary ?? null,
});
