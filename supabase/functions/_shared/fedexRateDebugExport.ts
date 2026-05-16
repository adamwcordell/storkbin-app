/**
 * Temporary FedEx Comprehensive Rates debug export (FEDEX_RATE_DEBUG=1).
 * Writes a redacted JSON artifact for offline analysis — do not enable in production long-term.
 */
import { fileURLToPath } from "node:url";

const normalizeDebugOutPath = (raw: string): string => {
  const p = (raw || "").trim() || "fedex_rate_debug.json";
  if (p.startsWith("file:")) {
    try {
      return fileURLToPath(new URL(p));
    } catch {
      return "fedex_rate_debug.json";
    }
  }
  // Windows: URL.pathname from file:// can be `/C:/Users/...` which writeTextFile rejects
  if (Deno.build.os === "windows" && /^\/[A-Za-z]:\//.test(p)) {
    return p.slice(1).replace(/\//g, "\\");
  }
  return p;
};

export type FedexAccountDebugMeta = {
  sourceEnvVar: "FEDEX_ACCOUNT_NUMBER";
  present: boolean;
  last4: string | null;
  note: string;
};

export type FedexRequestShapeChecks = {
  requestedShipmentServiceTypePresent: boolean;
  /** Flag: if true, FedEx may only return that service family (often Express). */
  requestedShipmentServiceTypeFiltersResults: boolean;
  requestedShipmentServiceTypeValue: string | null;
  carrierCodesPresent: boolean;
  carrierCodesValue: unknown;
  /** True when both FDXG and FDXE are present (not used on StorkBin customer checkout; optional diagnostics). */
  carrierCodesIncludesFdxgAndFdxe: boolean;
  carrierCodesIncludesFdxg: boolean;
  carrierCodesIncludesFdxe: boolean;
  rateRequestTypePresent: boolean;
  rateRequestTypeValue: unknown;
  rateRequestTypeIncludesAccountAndList: boolean;
  shippingChargesPaymentPresent: boolean;
  shippingChargesPaymentType: string | null;
  /** Expected SENDER for prepaid shipper rating; absence may affect quotes. */
  shippingChargesPaymentIsSender: boolean;
  requestedPackageLineItemsSummary: Array<{
    index: number;
    hasWeight: boolean;
    hasDimensions: boolean;
    /** FedEx often expects packagingType on shipment, not line item — we report both. */
    packagingTypeOnLineItem: string | null;
  }>;
  packagingTypeOnRequestedShipment: string | null;
  pickupTypeOnRequestedShipment: string | null;
};

export type FedexRateDebugAttempt = {
  attemptLabel?: string;
  endpointUrl: string;
  environment: "sandbox" | "production";
  httpStatus: number;
  ok: boolean;
  fedexCustomerTransactionId: string;
  requestHeadersSummary: Record<string, string>;
  requestBodyRedacted: Record<string, unknown>;
  requestShapeChecks: FedexRequestShapeChecks;
  responseSummary: Record<string, unknown>;
  rawResponseRedacted: Record<string, unknown>;
};

const FEDEX_ENV = (Deno.env.get("FEDEX_ENV") || "sandbox").trim().toLowerCase();
const envLabel: "sandbox" | "production" =
  FEDEX_ENV === "production" || FEDEX_ENV === "live" ? "production" : "sandbox";

const maskAccountValue = (raw: string): string => {
  const s = String(raw || "").trim();
  if (s.length < 4) return s ? "***" : "";
  return `***${s.slice(-4)}`;
};

const deepClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const redactBearer = (auth: string): string => {
  const a = String(auth || "");
  if (/^Bearer\s+/i.test(a)) return "Bearer [REDACTED]";
  return a ? "[REDACTED]" : "";
};

const redactAccountInObject = (obj: unknown): unknown => {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(redactAccountInObject);
  if (typeof obj !== "object") return obj;
  const o = obj as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "accountNumber" && v && typeof v === "object") {
      const an = v as Record<string, unknown>;
      const val = String(an.value ?? "").trim();
      next[k] = { ...an, value: val ? maskAccountValue(val) : an.value };
      continue;
    }
    if (k === "value" && typeof v === "string" && /^\d{6,}$/.test(v.trim())) {
      next[k] = maskAccountValue(v);
      continue;
    }
    next[k] = redactAccountInObject(v);
  }
  return next;
};

const redactTokensInString = (s: string): string =>
  s
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/"access_token"\s*:\s*"[^"]+"/gi, '"access_token":"[REDACTED]"');

const redactPayloadDeep = (node: unknown, depth = 0): unknown => {
  if (depth > 40) return "[MAX_DEPTH]";
  if (node == null) return node;
  if (typeof node === "string") return redactTokensInString(node);
  if (typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((x) => redactPayloadDeep(x, depth + 1));
  const o = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "accountNumber" && v && typeof v === "object") {
      out[k] = redactAccountInObject(v);
      continue;
    }
    out[k] = redactPayloadDeep(v, depth + 1);
  }
  return out;
};

const getNested = (o: unknown, path: string[]): unknown => {
  let cur: unknown = o;
  for (const p of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
};

const buildRequestShapeChecks = (body: Record<string, unknown>): FedexRequestShapeChecks => {
  const rs = body.requestedShipment as Record<string, unknown> | undefined;
  const st = rs?.serviceType;
  const serviceTypeStr = st != null && st !== "" ? String(st).trim() : "";
  const carrierCodes = body.carrierCodes;
  const ccArr = Array.isArray(carrierCodes) ? carrierCodes.map(String) : [];
  const hasBoth = ccArr.includes("FDXG") && ccArr.includes("FDXE");
  const hasFdxg = ccArr.includes("FDXG");
  const hasFdxe = ccArr.includes("FDXE");
  const rrt = rs?.rateRequestType;
  const rrtArr = Array.isArray(rrt) ? rrt.map(String) : [];
  const hasAccountList = rrtArr.includes("ACCOUNT") && rrtArr.includes("LIST");
  const scp = rs?.shippingChargesPayment as Record<string, unknown> | undefined;
  const payType = scp?.paymentType != null ? String(scp.paymentType) : null;
  const items = Array.isArray(rs?.requestedPackageLineItems)
    ? (rs!.requestedPackageLineItems as unknown[])
    : [];
  const lineSummaries = items.map((it, index) => {
    const row = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const w = row.weight;
    const d = row.dimensions;
    const pkg = row.packagingType != null ? String(row.packagingType) : null;
    return {
      index,
      hasWeight: w != null && typeof w === "object" && (w as Record<string, unknown>).value != null,
      hasDimensions: d != null && typeof d === "object",
      packagingTypeOnLineItem: pkg,
    };
  });

  return {
    requestedShipmentServiceTypePresent: Boolean(serviceTypeStr),
    requestedShipmentServiceTypeFiltersResults: Boolean(serviceTypeStr),
    requestedShipmentServiceTypeValue: serviceTypeStr || null,
    carrierCodesPresent: carrierCodes != null,
    carrierCodesValue: carrierCodes,
    carrierCodesIncludesFdxgAndFdxe: hasBoth,
    carrierCodesIncludesFdxg: hasFdxg,
    carrierCodesIncludesFdxe: hasFdxe,
    rateRequestTypePresent: rrt != null,
    rateRequestTypeValue: rrt,
    rateRequestTypeIncludesAccountAndList: hasAccountList,
    shippingChargesPaymentPresent: scp != null,
    shippingChargesPaymentType: payType,
    shippingChargesPaymentIsSender: payType?.toUpperCase() === "SENDER",
    requestedPackageLineItemsSummary: lineSummaries,
    packagingTypeOnRequestedShipment: rs?.packagingType != null ? String(rs.packagingType) : null,
    pickupTypeOnRequestedShipment: rs?.pickupType != null ? String(rs.pickupType) : null,
  };
};

const ratedBlocks = (d: Record<string, unknown>): Record<string, unknown>[] => {
  const rsd = d.ratedShipmentDetails;
  if (Array.isArray(rsd)) return rsd as Record<string, unknown>[];
  const one = d.ratedShipmentDetail;
  if (one && typeof one === "object") return [one as Record<string, unknown>];
  return [];
};

const moneyStr = (m: unknown): string | null => {
  if (m == null || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  const amt = o.amount;
  const cur = o.currency != null ? String(o.currency) : "USD";
  if (amt == null) return null;
  return `${cur} ${amt}`;
};

const summarizeRatedRow = (rated: Record<string, unknown>) => {
  const srd = rated.shipmentRateDetail as Record<string, unknown> | undefined;
  const rateType =
    rated.rateType != null
      ? String(rated.rateType)
      : rated.rateShipmentType != null
        ? String(rated.rateShipmentType)
        : srd?.rateType != null
          ? String(srd.rateType)
          : "UNKNOWN";
  const net =
    moneyStr(rated.totalNetCharge) ||
    moneyStr(rated.totalNetFedExCharge) ||
    moneyStr(srd?.totalNetCharge) ||
    moneyStr(srd?.totalNetFedExCharge) ||
    moneyStr(getNested(rated, ["shipmentRateDetail", "totalNetCharge"])) ||
    moneyStr(getNested(rated, ["shipmentRateDetail", "totalNetFedExCharge"])) ||
    null;
  return { rateType, totalNetCharge: net };
};

const summarizePayload = (payload: Record<string, unknown>) => {
  const transactionId =
    (payload.output as Record<string, unknown> | undefined)?.transactionId != null
      ? String((payload.output as Record<string, unknown>).transactionId)
      : payload.transactionId != null
        ? String(payload.transactionId)
        : null;
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const out = payload.output as Record<string, unknown> | undefined;
  const alerts = Array.isArray(out?.alerts)
    ? out.alerts
    : Array.isArray((payload as Record<string, unknown>).alerts)
      ? (payload as Record<string, unknown>).alerts
      : [];
  const details = (payload.output as Record<string, unknown> | undefined)?.rateReplyDetails;
  const list = Array.isArray(details) ? (details as Record<string, unknown>[]) : [];
  const services = list.map((d) => {
    const blocks = ratedBlocks(d);
    const rateRows = blocks.length ? blocks.map(summarizeRatedRow) : [summarizeRatedRow(d)];
    const od =
      (d.operationalDetail as Record<string, unknown> | undefined) ||
      (blocks[0]?.operationalDetail as Record<string, unknown> | undefined);
    const carrierCode =
      (d as Record<string, unknown>).carrierCode != null
        ? String((d as Record<string, unknown>).carrierCode)
        : blocks[0] && (blocks[0] as Record<string, unknown>).carrierCode != null
          ? String((blocks[0] as Record<string, unknown>).carrierCode)
          : null;
    return {
      serviceType: String(d.serviceType || ""),
      serviceName: String(d.serviceName || ""),
      carrierCode: carrierCode || undefined,
      operationalDetail: od
        ? {
            transitTime: od.transitTime != null ? String(od.transitTime) : null,
            deliveryDate: od.deliveryDate != null ? String(od.deliveryDate) : null,
            commitDate: od.commitDate != null ? String(od.commitDate) : null,
            deliveryDay: od.deliveryDay != null ? String(od.deliveryDay) : null,
          }
        : null,
      ratedShipmentRates: rateRows,
    };
  });
  return {
    transactionId,
    errors,
    alerts,
    rateReplyDetailsCount: list.length,
    services,
  };
};

export type FedexDebugCollector = {
  accountMeta: FedexAccountDebugMeta;
  attempts: FedexRateDebugAttempt[];
  recordComprehensiveAttempt: (input: {
    attemptLabel?: string;
    endpointUrl: string;
    requestHeaders: Record<string, string>;
    requestBody: Record<string, unknown>;
    httpStatus: number;
    ok: boolean;
    fedexCustomerTransactionId: string;
    payload: Record<string, unknown>;
  }) => void;
  writeToFile: () => Promise<string | null>;
};

export const createFedexRateDebugCollector = (
  accountNumberRaw: string,
): FedexDebugCollector => {
  const trimmed = String(accountNumberRaw || "").trim();
  const accountMeta: FedexAccountDebugMeta = {
    sourceEnvVar: "FEDEX_ACCOUNT_NUMBER",
    present: Boolean(trimmed),
    last4: trimmed.length >= 4 ? trimmed.slice(-4) : trimmed ? trimmed : null,
    note:
      "Must be the FedEx **shipping** account number linked for rating/billing, not the developer project/client id.",
  };

  const attempts: FedexRateDebugAttempt[] = [];

  const recordComprehensiveAttempt = (input: {
    attemptLabel?: string;
    endpointUrl: string;
    requestHeaders: Record<string, string>;
    requestBody: Record<string, unknown>;
    httpStatus: number;
    ok: boolean;
    fedexCustomerTransactionId: string;
    payload: Record<string, unknown>;
  }) => {
    const requestHeadersSummary: Record<string, string> = {
      "Content-Type": input.requestHeaders["Content-Type"] || input.requestHeaders["content-type"] || "",
      "x-locale": input.requestHeaders["X-locale"] || input.requestHeaders["x-locale"] || "",
      Authorization: redactBearer(input.requestHeaders["Authorization"] || ""),
      "x-customer-transaction-id":
        input.requestHeaders["x-customer-transaction-id"] ||
        input.requestHeaders["X-customer-transaction-id"] ||
        "",
    };
    const requestBodyRedacted = redactAccountInObject(deepClone(input.requestBody)) as Record<string, unknown>;
    attempts.push({
      attemptLabel: input.attemptLabel,
      endpointUrl: input.endpointUrl,
      environment: envLabel,
      httpStatus: input.httpStatus,
      ok: input.ok,
      fedexCustomerTransactionId: input.fedexCustomerTransactionId,
      requestHeadersSummary,
      requestBodyRedacted,
      requestShapeChecks: buildRequestShapeChecks(input.requestBody),
      responseSummary: summarizePayload(input.payload),
      rawResponseRedacted: redactPayloadDeep(deepClone(input.payload)) as Record<string, unknown>,
    });
  };

  const writeToFile = async (): Promise<string | null> => {
    const outPath = normalizeDebugOutPath(
      (Deno.env.get("FEDEX_RATE_DEBUG_OUTFILE") || "").trim() || "fedex_rate_debug.json",
    );
    const clientIdPresent = Boolean((Deno.env.get("FEDEX_CLIENT_ID") || "").trim());
    const clientSecretPresent = Boolean((Deno.env.get("FEDEX_CLIENT_SECRET") || "").trim());

    const artifact = {
      generatedAt: new Date().toISOString(),
      fedexApi: "POST /rate/v1/comprehensiverates/quotes",
      environment: envLabel,
      fedexEnvRaw: FEDEX_ENV,
      accountMeta,
      oauthEnvPresence: {
        FEDEX_CLIENT_ID: clientIdPresent,
        FEDEX_CLIENT_SECRET: clientSecretPresent,
      },
      preflightNote:
        attempts.length === 0
          ? "No comprehensive POSTs were recorded (often: OAuth failed before fetch — set FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET, or an exception occurred before the rate loop)."
          : null,
      attempts,
      storkBinExpectedRequestShape: {
        doNotSetServiceTypeForGeneralRateShopping: true,
        carrierCodesCustomerCheckout: ["FDXG"],
        optionalServiceTypeProbes: ["FEDEX_GROUND_ECONOMY", "SMART_POST"],
        optionalProbesEnvFlag: "FEDEX_ENABLE_GROUND_ECONOMY_PROBES=true",
        carrierCodesShouldInclude: ["FDXG"],
        rateRequestTypeShouldInclude: ["ACCOUNT", "LIST"],
        packagingTypeOnShipment: "YOUR_PACKAGING",
        shippingChargesPaymentPaymentType: "SENDER",
        accountNumberValueSource: "FEDEX_ACCOUNT_NUMBER env (FedEx shipping account, not developer project id)",
        /** StorkBin `fedexShippingRates.ts` does not yet send `shippingChargesPayment`; see per-attempt `requestShapeChecks.shippingChargesPaymentPresent`. */
        storkBinCurrentlySendsShippingChargesPayment: false,
      },
      notes: [
        "Secrets redacted: Authorization Bearer, accountNumber.value masked as ***LAST4.",
        "Enable with FEDEX_RATE_DEBUG=1 (and optional FEDEX_RATE_DEBUG_OUTFILE for path).",
        "Compare each attempt's requestShapeChecks vs storkBinExpectedRequestShape; LIST-only attempts will not satisfy ACCOUNT+LIST together.",
      ],
    };
    const text = JSON.stringify(artifact, null, 2);
    try {
      await Deno.writeTextFile(outPath, text);
      return outPath;
    } catch (e) {
      console.error(
        "[FEDEX_RATE_DEBUG] Could not write file:",
        outPath,
        e instanceof Error ? e.message : e,
      );
      console.error("[FEDEX_RATE_DEBUG] artifact follows (truncated in logs):\n", text.slice(0, 12000));
      return null;
    }
  };

  return { accountMeta, attempts, recordComprehensiveAttempt, writeToFile };
};
