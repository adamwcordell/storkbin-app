/** Maps one FedEx `trackResults[]` element to a coarse shipping_status. */
export const mapFedexSingleTrackResult = (
  tr: Record<string, unknown>,
): { status: string | null; detail: string | null } => {
  const latest = tr.latestStatusDetail as Record<string, unknown> | undefined;
  const code = String(latest?.code || "").toUpperCase();
  const derived = String(latest?.derivedCode || "").toUpperCase();
  const desc = String(
    latest?.description || latest?.statusByLocale || latest?.derivedDescription || "",
  ).slice(0, 240);

  const scanEvents = tr.scanEvents as Array<Record<string, unknown>> | undefined;
  const lastScan = Array.isArray(scanEvents) && scanEvents.length > 0
    ? scanEvents[scanEvents.length - 1]
    : null;
  const scanDerived = String(lastScan?.derivedStatus || lastScan?.eventType || "").toUpperCase();

  const blob = `${code} ${derived} ${desc} ${scanDerived}`.toUpperCase();

  if (blob.includes("DELIVERED") || code === "DL") {
    return { status: "delivered", detail: desc || code || derived };
  }
  if (
    code === "DE" ||
    code === "SE" ||
    code === "RS" ||
    blob.includes("EXCEPTION") ||
    blob.includes("DELIVERY EXCEPTION")
  ) {
    return { status: "exception", detail: desc || code || derived };
  }
  if (code === "OD" || blob.includes("ON FEDEX VEHICLE") || blob.includes("OUT FOR DELIVERY")) {
    return { status: "out_for_delivery", detail: desc || code || derived };
  }
  if (
    code === "IT" ||
    derived === "IN_TRANSIT" ||
    blob.includes("IN TRANSIT") ||
    blob.includes("AT FEDEX") ||
    blob.includes("PICKED UP") ||
    blob.includes("LEFT FEDEX")
  ) {
    return { status: "in_transit", detail: desc || code || derived };
  }

  return { status: null, detail: desc || code || derived || null };
};

/**
 * Maps full FedEx Track API JSON (first track result only) — useful for probes/tests.
 */
export const mapFedexTrackToShippingStatus = (
  trackPayload: Record<string, unknown>,
): { status: string | null; detail: string | null } => {
  const output = trackPayload?.output as Record<string, unknown> | undefined;
  const alerts = output?.alerts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(alerts) && alerts.length > 0) {
    const a = alerts[0];
    const code = String(a?.code || "").toUpperCase();
    if (code === "TRACKING.TRACKINGNUMBER.NOTFOUND" || code.includes("NOTFOUND")) {
      return { status: null, detail: "tracking_not_found" };
    }
  }

  const complete = output?.completeTrackResults as Array<Record<string, unknown>> | undefined;
  const firstComplete = complete?.[0];
  const results = firstComplete?.trackResults as Array<Record<string, unknown>> | undefined;
  const tr = results?.[0];
  if (!tr) {
    return { status: null, detail: null };
  }

  return mapFedexSingleTrackResult(tr);
};

const RANK: Record<string, number> = {
  pending_payment: 5,
  paid: 10,
  label_created: 20,
  in_transit: 30,
  exception: 34,
  out_for_delivery: 36,
  delivered: 100,
};

export const trackingRank = (shippingStatus: string) => RANK[shippingStatus] ?? 0;

/** Returns true if `next` should replace `current` on the shipment row. */
export const shouldAdvanceShippingStatus = (current: string, next: string) => {
  if (next === "delivered") return current !== "delivered";
  if (current === "delivered") return false;

  const cr = trackingRank(current);
  const nr = trackingRank(next);
  if (nr > cr) return true;

  if (next === "exception" && cr >= trackingRank("in_transit")) {
    return current !== "exception";
  }

  // FedEx can clear a delivery exception and resume transit; rank alone would block IT < EX.
  if (
    current === "exception" &&
    (next === "in_transit" || next === "out_for_delivery")
  ) {
    return true;
  }

  return false;
};
