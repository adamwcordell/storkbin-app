import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { fedexAuthorizedJsonHeaders } from "./fedexRestHeaders.ts";
import { getFedexAccessToken, getFedexApiBaseUrl, resolveFedexAccountNumber } from "./fedexAuth.ts";
import { notifyOpsOutboundLabel } from "./shippingLabelNotifications.ts";
import { notifyCustomerOnLabelCreated } from "./customerEmails.ts";
import {
  buildDisplayBinRef,
  getCustomerBinScanUrl,
  type BinLabelOverlayItem,
} from "./binDisplayRef.ts";
import { overlayBinQrsOnFedexLabelPdfBase64 } from "./fedexLabelQrOverlay.ts";
import { formatStorkbinShipmentRef } from "./scanMatch.ts";
import {
  buildTestLabelPdfBase64,
  generateTestTrackingNumber,
  isShippingTestModeActive,
  isTestTrackingNumber,
} from "./shippingTestMode.ts";

type Supabase = ReturnType<typeof createClient>;

const FEDEX_TRACK_BASE_URL = "https://www.fedex.com/fedextrack/?trknbr=";

const randomAlphaNumeric = (length = 12) =>
  Array.from({ length }, () => Math.floor(Math.random() * 36).toString(36))
    .join("")
    .toUpperCase();

const extractTrackingNumber = (payload: Record<string, unknown>) => {
  const output = payload?.output as Record<string, unknown> | undefined;
  const tx = (output?.transactionShipments as Array<Record<string, unknown>> | undefined)?.[0];
  const piece = (tx?.pieceResponses as Array<Record<string, unknown>> | undefined)?.[0];
  const candidate =
    piece?.trackingNumber ||
    tx?.masterTrackingNumber ||
    tx?.shipmentTrackingNumber;
  return String(candidate || "").trim();
};

const extractLabel = (payload: Record<string, unknown>) => {
  const output = payload?.output as Record<string, unknown> | undefined;
  const tx = (output?.transactionShipments as Array<Record<string, unknown>> | undefined)?.[0];
  const piece = (tx?.pieceResponses as Array<Record<string, unknown>> | undefined)?.[0];
  const docs = piece?.packageDocuments as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(docs) || docs.length === 0) return null;
  const doc = docs.find((d) => String(d?.encodedLabel || "").trim()) || docs[0];
  const encoded = String(doc?.encodedLabel || "").trim();
  if (!encoded) return null;
  const format = String(doc?.docType || "PDF").toUpperCase();
  return {
    encodedLabel: encoded,
    mimeType: format.includes("PDF") ? "application/pdf" : "application/octet-stream",
  };
};

const extractFedexErrorMessage = (payload: Record<string, unknown>) => {
  const errors = payload?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as Record<string, unknown>;
    const code = String(first?.code || "").trim();
    const message = String(first?.message || "").trim();
    const parameterList = Array.isArray(first?.parameterList)
      ? (first.parameterList as Array<Record<string, unknown>>)
          .map((p) => `${String(p?.key || "").trim()}=${String(p?.value || "").trim()}`)
          .filter(Boolean)
          .join("; ")
      : "";
    return [code ? `[${code}]` : "", message, parameterList ? `(${parameterList})` : ""]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  const output = payload?.output as Record<string, unknown> | undefined;
  const tx = (output?.transactionShipments as Array<Record<string, unknown>> | undefined)?.[0];
  const alerts = tx?.alerts;
  if (Array.isArray(alerts) && alerts.length > 0) {
    const first = alerts[0] as Record<string, unknown>;
    const code = String(first?.code || "").trim();
    const message = String(first?.message || "").trim();
    return [code ? `[${code}]` : "", message].filter(Boolean).join(" ").trim();
  }

  const notes = payload?.notifications;
  if (Array.isArray(notes) && notes.length > 0) {
    const first = notes[0] as Record<string, unknown>;
    const code = String(first?.code || "").trim();
    const message = String(first?.message || "").trim();
    return [code ? `[${code}]` : "", message].filter(Boolean).join(" ").trim();
  }

  return "";
};

const extractFedexPrimaryErrorCode = (payload: Record<string, unknown>) => {
  const errors = payload?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return String((errors[0] as Record<string, unknown>)?.code || "").trim();
  }
  const output = payload?.output as Record<string, unknown> | undefined;
  const tx = (output?.transactionShipments as Array<Record<string, unknown>> | undefined)?.[0];
  const alerts = tx?.alerts;
  if (Array.isArray(alerts) && alerts.length > 0) {
    return String((alerts[0] as Record<string, unknown>)?.code || "").trim();
  }
  return "";
};

const getAddressField = (address: Record<string, unknown>, key: string) =>
  String(address?.[key] || "").trim();

type StorkbinPackageMeta = {
  kind?: string;
  piece_count?: number;
  length_in?: number;
  width_in?: number;
  height_in?: number;
  weight_lb?: number;
  weight_lb_per_piece?: number;
  per_bin_height_in?: number;
};

const stripShipperOnlyMeta = (addr: Record<string, unknown>) => {
  const {
    storkbin_package: _pkg,
    fedex_ship_service_type: _st,
    fedex_ship_service_name: _sn,
    ...rest
  } = addr;
  return rest;
};

const buildRequestedPackageLineItems = (
  shippingAddress: Record<string, unknown>,
): Array<Record<string, unknown>> => {
  const raw = shippingAddress.storkbin_package as StorkbinPackageMeta | undefined;
  const fallbackWeight = Number(Deno.env.get("FEDEX_DEFAULT_WEIGHT_LB") || "5");
  if (!raw || typeof raw !== "object") {
    return [{ weight: { units: "LB", value: fallbackWeight } }];
  }
  const kind = String(raw.kind || "");
  if (kind === "return_empty_multi" || kind === "starter_empty_multi") {
    const n = Math.min(5, Math.max(1, Number(raw.piece_count || 1)));
    const perW = Number(raw.weight_lb_per_piece || 9);
    const perH = Number(raw.per_bin_height_in || 3);
    const length = Number(raw.length_in || 24);
    const width = Number(raw.width_in || 16);
    const height = perH * n;
    const totalWeight =
      Number.isFinite(Number(raw.weight_lb)) && Number(raw.weight_lb) > 0
        ? Number(raw.weight_lb)
        : perW * n;
    return [
      {
        weight: { units: "LB", value: totalWeight },
        dimensions: { length, width, height, units: "IN" },
      },
    ];
  }
  const weight = Number(raw.weight_lb || 50);
  const length = Number(raw.length_in || 24);
  const width = Number(raw.width_in || 16);
  const height = Number(raw.height_in || 12);
  return [
    {
      weight: { units: "LB", value: weight },
      dimensions: { length, width, height, units: "IN" },
    },
  ];
};

/** Merge into shipment `shipping_address` so FedEx ship uses stacked empty-flat dims (same footprint as return-empty quotes). */
export const attachStarterEmptyBinPackageMeta = (
  address: Record<string, unknown>,
  pieceCount: number,
): Record<string, unknown> => {
  const n = Math.min(5, Math.max(1, Math.floor(Number(pieceCount) || 1)));
  return {
    ...address,
    storkbin_package: {
      kind: "starter_empty_multi",
      piece_count: n,
      length_in: 24,
      width_in: 16,
      per_bin_height_in: 3,
      weight_lb_per_piece: 9,
    },
  };
};

export type PurchaseLabelSource = "admin" | "automation";

export type PurchaseFedexLabelResult =
  | { ok: true; skipped: string; shipmentId: string }
  | {
      ok: true;
      shipment: Record<string, unknown>;
      trackingNumber: string;
      trackingUrl: string;
      labelDataUrl: string | null;
      provider?: string;
      testMode?: boolean;
    }
  | { ok: false; error: string; shipmentId: string; preconditionFailed?: boolean };

type OutboundGateResult = { ok: true } | { ok: false; error: string };

/**
 * Beta rule: never auto-buy outbound labels; admin buys only after warehouse prep.
 * Starter kits: every bin on the shipment must be qr_applied (or outbound_labeled).
 * Stored-bin outbound: pick/staging gate (picked | in_staging | label_verified).
 */
const assertAdminToCustomerOutboundGate = async (
  supabase: Supabase,
  shipmentId: string,
  shipment: Record<string, unknown>,
): Promise<OutboundGateResult> => {
  const shippingAddressRaw = (shipment.shipping_address || {}) as Record<string, unknown>;
  const pkg = shippingAddressRaw.storkbin_package;
  const hasStarterKind =
    pkg &&
    typeof pkg === "object" &&
    String((pkg as Record<string, unknown>).kind || "") === "starter_empty_multi";

  const { data: srows } = await supabase
    .from("shipment_boxes")
    .select("box_id")
    .eq("shipment_id", shipmentId);
  let boxIds = [...new Set((srows || []).map((r: { box_id: string }) => String(r.box_id)).filter(Boolean))];
  const legacy = String(shipment.box_id || "").trim();
  if (boxIds.length === 0 && legacy) boxIds = [legacy];
  if (boxIds.length === 0) {
    return {
      ok: false,
      error:
        "Shipment has no linked bins (shipment_boxes); cannot verify warehouse prep before label purchase.",
    };
  }

  let isStarterOutbound = hasStarterKind;
  if (!isStarterOutbound) {
    const { data: boxRows } = await supabase.from("boxes").select("id,fulfillment_status").in("id", boxIds);
    const byId = new Map(
      (boxRows || []).map((b: { id: string; fulfillment_status?: string | null }) => [
        String(b.id),
        String(b.fulfillment_status || ""),
      ]),
    );
    isStarterOutbound =
      boxIds.every((id) => byId.has(id)) &&
      boxIds.every((id) => byId.get(id) === "paid_waiting_to_ship_bin");
  }

  const { data: assigns, error: aErr } = await supabase
    .from("bin_storage_assignments")
    .select("box_id,status")
    .in("box_id", boxIds)
    .eq("is_current", true);
  if (aErr) {
    return { ok: false, error: `Could not load bin assignments: ${aErr.message}` };
  }
  const statusByBox = new Map(
    (assigns || []).map((a: { box_id: string; status?: string | null }) => [
      String(a.box_id),
      String(a.status || ""),
    ]),
  );

  if (isStarterOutbound) {
    const blocked = boxIds.some((bid) => {
      const st = statusByBox.get(bid) || "";
      return st !== "qr_applied" && st !== "outbound_labeled";
    });
    if (blocked) {
      return {
        ok: false,
        error:
          "Starter kit outbound: apply the physical bin QR for every bin on this shipment (warehouse status qr_applied) before purchasing a FedEx label.",
      };
    }
    return { ok: true };
  }

  const blockedWarehouse = boxIds.some((bid) => {
    const st = statusByBox.get(bid) || "";
    return !["picked", "in_staging", "label_verified"].includes(st);
  });
  if (blockedWarehouse) {
    return {
      ok: false,
      error:
        "Stored-bin outbound: pick and stage each bin (assignment picked, in_staging, or label_verified) before purchasing a FedEx label.",
    };
  }
  return { ok: true };
};

/** Service-role backfill when shipment_boxes rows are missing (admin label purchase). */
const ensureShipmentBoxLinksServer = async (
  supabase: Supabase,
  shipment: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> => {
  const shipmentId = String(shipment.id || "").trim();
  const userId = String(shipment.user_id || "").trim();
  const primaryBoxId = String(shipment.box_id || "").trim();
  if (!shipmentId || !userId) return { ok: true };

  const { data: existing, error: exErr } = await supabase
    .from("shipment_boxes")
    .select("box_id")
    .eq("shipment_id", shipmentId);
  if (exErr) return { ok: false, error: exErr.message };

  if ((existing || []).length > 0) return { ok: true };

  let boxIds: string[] = [];
  if (primaryBoxId) {
    const { data: primaryBox } = await supabase
      .from("boxes")
      .select("id,subscription_group_id,fulfillment_status,user_id")
      .eq("id", primaryBoxId)
      .maybeSingle();

    const gid = String(primaryBox?.subscription_group_id || "").trim();
    if (
      gid &&
      String(primaryBox?.user_id || "") === userId &&
      String(primaryBox?.fulfillment_status || "") === "paid_waiting_to_ship_bin"
    ) {
      const { data: peers } = await supabase
        .from("boxes")
        .select("id")
        .eq("subscription_group_id", gid)
        .eq("user_id", userId)
        .eq("fulfillment_status", "paid_waiting_to_ship_bin")
        .order("id", { ascending: true });
      boxIds = (peers || []).map((b: { id: string }) => String(b.id)).filter(Boolean);
    } else {
      boxIds = [primaryBoxId];
    }
  }

  if (boxIds.length === 0) return { ok: true };

  const rows = boxIds.map((box_id, index) => ({
    shipment_id: shipmentId,
    box_id,
    user_id: userId,
    stack_position: index + 1,
  }));

  const { error: insErr } = await supabase.from("shipment_boxes").insert(rows);
  if (insErr && !/duplicate|unique|violates unique/i.test(insErr.message)) {
    return { ok: false, error: insErr.message };
  }
  return { ok: true };
};

const markLabelPurchaseFailed = async (
  supabase: Supabase,
  shipmentId: string,
  reason: string,
) => {
  const { error } = await supabase
    .from("shipments")
    .update({
      label_status: "purchase_failed",
      label_failure_reason: reason.slice(0, 4000),
    })
    .eq("id", shipmentId);
  if (error) {
    console.error("markLabelPurchaseFailed", shipmentId, error.message);
  }
};

export const purchaseFedexLabelForShipment = async (
  supabase: Supabase,
  shipmentId: string,
  opts: { source: PurchaseLabelSource },
): Promise<PurchaseFedexLabelResult> => {
  const { data: shipment, error: shipmentErr } = await supabase
    .from("shipments")
    .select("*")
    .eq("id", shipmentId)
    .maybeSingle();

  if (shipmentErr) {
    return { ok: false, error: shipmentErr.message, shipmentId };
  }
  if (!shipment) {
    return { ok: false, error: "Shipment not found", shipmentId };
  }

  const labelStatus = String(shipment.label_status || "");
  if (labelStatus === "created") {
    return { ok: true, skipped: "label already created", shipmentId };
  }

  if (opts.source === "automation" && labelStatus === "purchasing") {
    return { ok: true, skipped: "label purchase in progress", shipmentId };
  }

  if (String(shipment.charge_status || "") !== "paid") {
    return { ok: true, skipped: "shipment not paid", shipmentId };
  }

  const shipStatus = String(shipment.shipping_status || "");
  const purchasable =
    shipStatus === "paid" ||
    shipStatus === "pending_payment" ||
    (opts.source === "admin" && shipStatus === "label_created");
  if (!purchasable) {
    return { ok: true, skipped: `shipping_status not label-purchasable (${shipStatus})`, shipmentId };
  }

  const directionEarly = String(shipment.shipment_direction || "to_customer");

  if (opts.source === "automation" && directionEarly === "to_customer") {
    return {
      ok: true,
      skipped:
        "automation does not purchase outbound (to_customer) labels; use admin after warehouse prep (QR or pick/stage).",
      shipmentId,
    };
  }

  if (opts.source === "automation") {
    const pi = String(shipment.stripe_payment_intent_id || "").trim();
    const cs = String(shipment.stripe_checkout_session_id || "").trim();
    if (!pi && !cs) {
      return {
        ok: true,
        skipped:
          "automation blocked: shipment missing stripe_payment_intent_id and stripe_checkout_session_id (no FedEx before Stripe proof)",
        shipmentId,
      };
    }
  }

  if (opts.source === "admin") {
    const linkResult = await ensureShipmentBoxLinksServer(
      supabase,
      shipment as Record<string, unknown>,
    );
    if (!linkResult.ok) {
      return {
        ok: false,
        error: linkResult.error || "Could not link bins to shipment",
        shipmentId,
        preconditionFailed: true,
      };
    }
  }

  if (opts.source === "admin" && directionEarly === "to_customer") {
    const gate = await assertAdminToCustomerOutboundGate(supabase, shipmentId, shipment as Record<string, unknown>);
    if (!gate.ok) {
      return { ok: false, error: gate.error, shipmentId, preconditionFailed: true };
    }
  }

  if (opts.source === "automation" || opts.source === "admin") {
    const { data: locked, error: lockErr } = await supabase
      .from("shipments")
      .update({ label_status: "purchasing" })
      .eq("id", shipmentId)
      .in("label_status", ["needed", "purchase_failed", "label_needed"])
      .select("id")
      .maybeSingle();
    if (lockErr || !locked) {
      const { data: again } = await supabase
        .from("shipments")
        .select("label_status")
        .eq("id", shipmentId)
        .maybeSingle();
      if (String(again?.label_status || "") === "created") {
        return { ok: true, skipped: "label already created", shipmentId };
      }
      return { ok: true, skipped: "label purchase not started (race or state)", shipmentId };
    }
  }

  let shippingAddressRaw = (shipment.shipping_address || {}) as Record<string, unknown>;
  const direction = String(shipment.shipment_direction || "to_customer");

  if (direction === "to_customer") {
    const pkg = shippingAddressRaw.storkbin_package;
    const hasStarterKind =
      pkg &&
      typeof pkg === "object" &&
      String((pkg as Record<string, unknown>).kind || "") === "starter_empty_multi";
    if (!hasStarterKind) {
      const { data: srows } = await supabase
        .from("shipment_boxes")
        .select("box_id")
        .eq("shipment_id", shipmentId);
      const boxIds = [
        ...new Set((srows || []).map((r: { box_id: string }) => String(r.box_id)).filter(Boolean)),
      ];
      if (boxIds.length > 0) {
        const { data: boxRows } = await supabase.from("boxes").select("id,fulfillment_status").in("id", boxIds);
        const byId = new Map(
          (boxRows || []).map((b: { id: string; fulfillment_status?: string | null }) => [
            String(b.id),
            String(b.fulfillment_status || ""),
          ]),
        );
        const allStarter =
          boxIds.every((id) => byId.has(id)) &&
          boxIds.every((id) => byId.get(id) === "paid_waiting_to_ship_bin");
        if (allStarter) {
          shippingAddressRaw = attachStarterEmptyBinPackageMeta(shippingAddressRaw, boxIds.length);
        }
      }
    }
  }

  const quotedCentsFromShipment = (s: Record<string, unknown>): number | null => {
    const cost = Number(s.shipping_cost ?? s.shipping_estimate ?? 0);
    if (!Number.isFinite(cost) || cost <= 0) return null;
    return Math.round(cost * 100);
  };

  const shippingAddress = stripShipperOnlyMeta(shippingAddressRaw);

  const appBase = (Deno.env.get("APP_URL") || "https://storkbin.com").replace(/\/$/, "");
  const fallbackEmail = getAddressField(shippingAddressRaw, "email");

  const loadLinkedBinLabelMeta = async (): Promise<BinLabelOverlayItem[]> => {
    const { data: srows } = await supabase
      .from("shipment_boxes")
      .select("box_id")
      .eq("shipment_id", shipmentId);
    const boxIds = [
      ...new Set((srows || []).map((r: { box_id: string }) => String(r.box_id)).filter(Boolean)),
    ];
    if (!boxIds.length) return [];

    const { data: boxRows } = await supabase
      .from("boxes")
      .select("id,box_number,user_id")
      .in("id", boxIds);
    if (!boxRows?.length) return [];

    const userIds = [...new Set((boxRows || []).map((b: { user_id?: string }) => String(b.user_id || "")).filter(Boolean))];
    const emailByUser = new Map<string, string>();

    if (userIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id,email").in("id", userIds);
      for (const p of profiles || []) {
        const id = String((p as { id?: string }).id || "");
        const email = String((p as { email?: string }).email || "").trim();
        if (id && email) emailByUser.set(id, email);
      }
    }

    return (boxRows as Array<{ id: string; box_number?: string | null; user_id?: string }>)
      .map((b) => {
        const boxId = String(b.id);
        const email = emailByUser.get(String(b.user_id || "")) || fallbackEmail;
        const displayRef = buildDisplayBinRef({
          email,
          boxNumber: b.box_number,
          boxId,
        });
        return {
          boxId,
          displayRef,
          scanUrl: getCustomerBinScanUrl(boxId, appBase),
        };
      })
      .sort((a, b) => a.displayRef.localeCompare(b.displayRef, undefined, { numeric: true }));
  };

  const linkedBinLabelMeta = await loadLinkedBinLabelMeta();
  const linkedDisplayRefs = linkedBinLabelMeta.map((m) => m.displayRef);
  const storkbinShipmentRef = formatStorkbinShipmentRef(shipmentId);

  const buildFedexCustomerReferences = () => {
    const refs: Array<{ customerReferenceType: string; value: string }> = [];
    if (linkedDisplayRefs.length) {
      refs.push({
        customerReferenceType: "CUSTOMER_REFERENCE",
        value: linkedDisplayRefs.join(",").slice(0, 40),
      });
    } else if (storkbinShipmentRef) {
      refs.push({
        customerReferenceType: "CUSTOMER_REFERENCE",
        value: storkbinShipmentRef.slice(0, 40),
      });
    }
    if (storkbinShipmentRef && linkedDisplayRefs.length) {
      refs.push({
        customerReferenceType: "DEPARTMENT_NUMBER",
        value: storkbinShipmentRef.slice(0, 40),
      });
    }
    return refs;
  };

  const customerPostal = getAddressField(shippingAddress, "zip");
  const customerState = getAddressField(shippingAddress, "state");
  const customerCity = getAddressField(shippingAddress, "city");
  const customerCountry = getAddressField(shippingAddress, "country_code") || "US";
  if (!customerPostal || !customerState || !customerCity) {
    const msg =
      "Shipment is missing address fields on the customer ship-from / destination record (city/state/zip)";
    await markLabelPurchaseFailed(supabase, shipmentId, msg);
    return { ok: false, error: msg, shipmentId };
  }

  const warehousePostal = Deno.env.get("FEDEX_SHIPPER_POSTAL_CODE") || "84401";
  const warehouseCountry = Deno.env.get("FEDEX_SHIPPER_COUNTRY_CODE") || "US";
  const warehouseState = Deno.env.get("FEDEX_SHIPPER_STATE") || "UT";
  const warehouseCity = Deno.env.get("FEDEX_SHIPPER_CITY") || "Ogden";
  const warehouseAddress1 = Deno.env.get("FEDEX_SHIPPER_ADDRESS_LINE1") || "1990 Wall Ave";
  const warehouseName = Deno.env.get("FEDEX_SHIPPER_NAME") || "STORKBIN, LLC";
  const warehousePhone = Deno.env.get("FEDEX_SHIPPER_PHONE") || "5555555555";
  const accountNumber = resolveFedexAccountNumber();
  const shippingTestModeEnabled = isShippingTestModeActive();
  if (!accountNumber && !shippingTestModeEnabled) {
    const msg = "FEDEX_ACCOUNT_NUMBER is required on the server to purchase labels";
    await markLabelPurchaseFailed(supabase, shipmentId, msg);
    return { ok: false, error: msg, shipmentId };
  }

  const customerParty = {
    contact: {
      personName: getAddressField(shippingAddress, "full_name") || "StorkBin Customer",
      phoneNumber: Deno.env.get("FEDEX_RECIPIENT_PHONE_DEFAULT") || "5555555555",
    },
    address: {
      streetLines: [getAddressField(shippingAddress, "address_line1")].filter(Boolean),
      city: customerCity,
      stateOrProvinceCode: customerState,
      postalCode: customerPostal,
      countryCode: customerCountry,
      residential: true,
    },
  };

  const warehouseParty = {
    contact: {
      personName: warehouseName,
      phoneNumber: warehousePhone,
    },
    address: {
      streetLines: [warehouseAddress1].filter(Boolean),
      city: warehouseCity,
      stateOrProvinceCode: warehouseState,
      postalCode: warehousePostal,
      countryCode: warehouseCountry,
      residential: false,
    },
  };

  const shipperBlock = direction === "to_storage" ? customerParty : warehouseParty;
  const recipientsBlock = direction === "to_storage" ? [warehouseParty] : [customerParty];

  const serviceTypeFromQuote = String(
    (shippingAddressRaw as { fedex_ship_service_type?: string }).fedex_ship_service_type || "",
  ).trim();
  const serviceNameFromQuote = String(
    (shippingAddressRaw as { fedex_ship_service_name?: string }).fedex_ship_service_name || "",
  ).trim();
  const baseServiceType = serviceTypeFromQuote || Deno.env.get("FEDEX_SERVICE_TYPE") || "FEDEX_GROUND";

  let trackingNumber = "";
  let labelEncoded = "";
  let labelMimeType = "application/pdf";
  let fedexSucceeded = false;
  let labelProvider = "fedex";
  let shippingTestMode = false;

  if (shippingTestModeEnabled) {
    shippingTestMode = true;
    labelProvider = "fedex_test";
    trackingNumber = generateTestTrackingNumber(shipmentId);
    if (isTestTrackingNumber(String(shipment.tracking_number || ""))) {
      trackingNumber = String(shipment.tracking_number).trim();
    }
    try {
      labelEncoded = await buildTestLabelPdfBase64({
        trackingNumber,
        shipmentRef: storkbinShipmentRef,
        direction: direction === "to_storage" ? "to_storage" : "to_customer",
        serviceName: serviceNameFromQuote || serviceTypeFromQuote || baseServiceType,
        displayRefs: linkedDisplayRefs,
      });
      // Test labels use a prominent tracking QR for match; skip bin overlay to avoid duplicate QRs.
      fedexSucceeded = true;
      console.info("[shippingTestMode] Created fake label for shipment", shipmentId, trackingNumber);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markLabelPurchaseFailed(supabase, shipmentId, `Test label generation failed: ${msg}`);
      return { ok: false, error: msg, shipmentId };
    }
  } else {
  let tokenFedex: string;
  try {
    tokenFedex = await getFedexAccessToken();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markLabelPurchaseFailed(supabase, shipmentId, msg);
    return { ok: false, error: msg, shipmentId };
  }

  const fedexBase = getFedexApiBaseUrl();
  const candidateServiceTypes =
    direction === "to_customer"
      ? serviceTypeFromQuote
        ? [serviceTypeFromQuote]
        : ["GROUND_HOME_DELIVERY", "FEDEX_HOME_DELIVERY", "FEDEX_GROUND"]
      : [baseServiceType];

  let fedexPayload: Record<string, unknown> = {};
  let fedexStatus = 0;
  let lastFedexReason = "";

  const fedexCustomerReferences = buildFedexCustomerReferences();

  for (const serviceType of candidateServiceTypes) {
    const requestedShipment: Record<string, unknown> = {
      shipper: shipperBlock,
      recipients: recipientsBlock,
      shipDatestamp: new Date().toISOString().slice(0, 10),
      serviceType,
      packagingType: "YOUR_PACKAGING",
      pickupType: "DROPOFF_AT_FEDEX_LOCATION",
      shippingChargesPayment: {
        paymentType: "SENDER",
      },
      requestedPackageLineItems: buildRequestedPackageLineItems(shippingAddressRaw),
      labelSpecification: {
        imageType: "PDF",
        labelStockType: "PAPER_85X11_TOP_HALF_LABEL",
      },
    };
    if (fedexCustomerReferences.length) {
      requestedShipment.customerReferences = fedexCustomerReferences;
    }

    const requestBody: Record<string, unknown> = {
      accountNumber: { value: accountNumber },
      labelResponseOptions: "LABEL",
      requestedShipment,
    };

    const fedexResponse = await fetch(`${fedexBase}/ship/v1/shipments`, {
      method: "POST",
      headers: fedexAuthorizedJsonHeaders(tokenFedex),
      body: JSON.stringify(requestBody),
    });
    fedexStatus = fedexResponse.status;
    fedexPayload = (await fedexResponse.json().catch(() => ({}))) as Record<string, unknown>;

    if (fedexResponse.ok) {
      fedexSucceeded = true;
      break;
    }

    const code = extractFedexPrimaryErrorCode(fedexPayload);
    const msg = extractFedexErrorMessage(fedexPayload);
    lastFedexReason = msg || `FedEx label purchase failed (HTTP ${fedexStatus})`;

    const isServiceTypeUnsupported = code === "REQUESTEDSHIPMENT.SERVICETYPE.NOTSUPPORTED";
    const isServiceTypeAddressMismatch =
      code === "REQUESTEDSHIPMENT.SERVICETYPEANDADDRESS.MISMATCH";
    const hasMoreCandidates = candidateServiceTypes.indexOf(serviceType) < candidateServiceTypes.length - 1;
    if (
      !(
        direction === "to_customer" &&
        (isServiceTypeUnsupported || isServiceTypeAddressMismatch) &&
        hasMoreCandidates
      )
    ) {
      break;
    }
  }

  if (!fedexSucceeded) {
    const reason = lastFedexReason || `FedEx label purchase failed (HTTP ${fedexStatus || "unknown"})`;
    await markLabelPurchaseFailed(supabase, shipmentId, reason);
    return { ok: false, error: reason, shipmentId };
  }

    trackingNumber =
      extractTrackingNumber(fedexPayload as Record<string, unknown>) || `FDX-${randomAlphaNumeric(12)}`;
    const label = extractLabel(fedexPayload as Record<string, unknown>);
    labelEncoded = label?.encodedLabel || "";
    labelMimeType = label?.mimeType || "application/pdf";
    if (labelEncoded && linkedBinLabelMeta.length && direction === "to_customer") {
      const overlay = await overlayBinQrsOnFedexLabelPdfBase64(labelEncoded, linkedBinLabelMeta);
      if (overlay.overlaid) labelEncoded = overlay.base64;
    }
  }

  const trackingUrl = `${FEDEX_TRACK_BASE_URL}${encodeURIComponent(trackingNumber)}`;
  const labelDataUrl = labelEncoded ? `data:${labelMimeType};base64,${labelEncoded}` : null;
  const nowIso = new Date().toISOString();
  const labelQuotedCents = quotedCentsFromShipment(shipment as Record<string, unknown>);

  const updates: Record<string, unknown> = {
    shipping_status: "label_created",
    label_status: "created",
    carrier: "fedex",
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
    label_url: labelDataUrl,
    charge_status: "paid",
    charge_attempted_at: nowIso,
    charge_failure_reason: null,
    label_failure_reason: null,
    label_purchased_at: nowIso,
    shipping_address: {
      ...shippingAddressRaw,
      storkbin_shipment_ref: storkbinShipmentRef,
      storkbin_display_refs: linkedDisplayRefs,
      storkbin_label_match_tracking: trackingNumber,
      ...(shippingTestMode ? { storkbin_shipping_test_mode: true } : {}),
    },
    ...(labelQuotedCents != null
      ? { label_quoted_amount_cents: labelQuotedCents, label_quoted_currency: "usd" }
      : {}),
  };

  const { data: updatedShipment, error: updateErr } = await supabase
    .from("shipments")
    .update(updates)
    .eq("id", shipmentId)
    .select("*")
    .single();
  if (updateErr) {
    await markLabelPurchaseFailed(supabase, shipmentId, updateErr.message);
    return { ok: false, error: updateErr.message, shipmentId };
  }

  const { data: linkedRows } = await supabase
    .from("shipment_boxes")
    .select("box_id")
    .eq("shipment_id", shipmentId);
  const boxIds = (linkedRows || []).map((r: { box_id: string }) => String(r.box_id));
  const boxFulfillmentAfterLabel =
    direction === "to_storage" ? "awaiting_customer_dropoff" : "label_created";
  const boxPatch: Record<string, unknown> = { fulfillment_status: boxFulfillmentAfterLabel };
  if (direction === "to_storage") {
    boxPatch.status = "at_customer";
  }
  if (boxIds.length) {
    await supabase.from("boxes").update(boxPatch).in("id", boxIds);
  } else if (shipment.box_id) {
    await supabase.from("boxes").update(boxPatch).eq("id", shipment.box_id);
  }

  const labelB64 = labelEncoded || null;
  try {
    await notifyCustomerOnLabelCreated(supabase, updatedShipment as Record<string, unknown>, {
      trackingNumber,
      trackingUrl,
      labelPdfBase64: labelB64,
    });
  } catch (emailErr) {
    console.warn("customer label-created email", emailErr);
  }

  if (direction === "to_customer") {
    try {
      await notifyOpsOutboundLabel({
        trackingNumber,
        trackingUrl,
        direction,
        shipmentId,
      });
    } catch (opsErr) {
      console.warn("ops outbound label email", opsErr);
    }
  }

  return {
    ok: true,
    shipment: updatedShipment as Record<string, unknown>,
    trackingNumber,
    trackingUrl,
    labelDataUrl,
    provider: labelProvider,
    testMode: shippingTestMode,
  };
};

export const autoPurchaseShippingLabelsForIds = async (
  supabase: Supabase,
  shipmentIds: string[],
): Promise<{
  results: Array<
    { shipmentId: string } & (
      | { ok: true; skipped?: string; trackingNumber?: string }
      | { ok: false; error: string }
    )
  >;
}> => {
  const results: Array<
    { shipmentId: string } & (
      | { ok: true; skipped?: string; trackingNumber?: string }
      | { ok: false; error: string }
    )
  > = [];

  const unique = [...new Set(shipmentIds.map((id) => String(id).trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { results: [] };
  }

  const { data: dirRows, error: dirErr } = await supabase
    .from("shipments")
    .select("id,shipment_direction")
    .in("id", unique);
  const directionById = new Map(
    (dirRows || []).map((r: { id: string; shipment_direction?: string | null }) => [
      String(r.id),
      String(r.shipment_direction || ""),
    ]),
  );
  if (dirErr) {
    for (const shipmentId of unique) {
      results.push({ shipmentId, ok: false, error: dirErr.message });
    }
    return { results };
  }

  for (const shipmentId of unique) {
    const dir = directionById.get(shipmentId) || "";
    if (dir !== "to_storage") {
      results.push({
        shipmentId,
        ok: true,
        skipped:
          dir === "to_customer"
            ? "automation only purchases return (to_storage) labels after payment; outbound labels are created manually from admin."
            : `automation skips auto-label for shipment_direction=${dir || "unknown"}`,
      });
      continue;
    }
    const r = await purchaseFedexLabelForShipment(supabase, shipmentId, { source: "automation" });
    if (!r.ok) {
      results.push({ shipmentId, ok: false, error: r.error });
      continue;
    }
    if ("skipped" in r) {
      results.push({ shipmentId, ok: true, skipped: r.skipped });
      continue;
    }
    results.push({
      shipmentId,
      ok: true,
      trackingNumber: r.trackingNumber,
    });
  }

  return { results };
};
