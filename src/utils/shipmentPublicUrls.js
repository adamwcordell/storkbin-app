import { getMockLabelPagePath, getMockLabelPageUrl } from "./mockLabelUrl";

const DEFAULT_APP_ORIGIN = "https://storkbin-app.vercel.app";
const FEDEX_TRACK_BASE_URL = "https://www.fedex.com/fedextrack/?trknbr=";

export function getAppOrigin(originOverride) {
  const origin =
    originOverride ||
    (typeof window !== "undefined" && window.location?.origin ? window.location.origin : "") ||
    DEFAULT_APP_ORIGIN;
  return String(origin).replace(/\/$/, "");
}

export function isStorkbinLocalUrl(url) {
  try {
    return new URL(String(url || "").trim()).hostname.toLowerCase() === "storkbin.local";
  } catch {
    return false;
  }
}

export function isMockStorkTrackingNumber(trackingNumber) {
  const tracking = String(trackingNumber || "").trim();
  return (
    /^STORK-/i.test(tracking) ||
    /^TEST/i.test(tracking) ||
    /^MOCK-FDX-/i.test(tracking)
  );
}

/** Simulator / fake-label fallbacks are staging-only; production uses live FedEx + tracking sweep. */
export function isStagingShippingSimulatorAllowed() {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app");
}

/** In-app mock tracking page for beta simulator labels (not real FedEx). */
export function getMockTrackPageUrl(trackingNumber, originOverride) {
  const tracking = String(trackingNumber || "").trim();
  const origin = getAppOrigin(originOverride);
  if (!tracking || !origin) return "";
  return `${origin}/track/${encodeURIComponent(tracking)}`;
}

/** In-app route for label viewer — use with React Router Link (no new tab). */
export function resolveShipmentLabelPrintPath(labelUrl, trackingNumber) {
  const inAppPath = resolveShipmentLabelInAppPath(labelUrl, trackingNumber);
  if (!inAppPath) return "";
  return inAppPath.includes("?") ? `${inAppPath}&print=1` : `${inAppPath}?print=1`;
}

export function resolveShipmentLabelInAppPath(labelUrl, trackingNumber) {
  const raw = String(labelUrl || "").trim();
  const tracking = String(trackingNumber || "").trim();

  if (raw.startsWith("data:") && tracking) {
    return getMockLabelPagePath(tracking);
  }

  if (!raw && tracking && isMockStorkTrackingNumber(tracking)) {
    return getMockLabelPagePath(tracking);
  }

  if (isStorkbinLocalUrl(raw)) {
    const match = raw.match(/\/labels\/([^/?#]+)/i);
    const ref = match?.[1] ? decodeURIComponent(match[1]) : tracking;
    return ref ? getMockLabelPagePath(ref) : "";
  }

  const full = resolveShipmentLabelUrl(labelUrl, trackingNumber);
  if (!full || full.startsWith("data:")) return "";

  try {
    const base =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : DEFAULT_APP_ORIGIN;
    const url = new URL(full, base);
    if (/\/labels\//i.test(url.pathname)) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    /* not an in-app label route */
  }

  return "";
}

export function resolveShipmentLabelPrintUrl(labelUrl, trackingNumber, originOverride) {
  const inAppPath = resolveShipmentLabelPrintPath(labelUrl, trackingNumber);
  if (inAppPath) return inAppPath;

  const base = resolveShipmentLabelUrl(labelUrl, trackingNumber, originOverride);
  if (!base || base.startsWith("data:")) return base;
  return base.includes("?") ? `${base}&print=1` : `${base}?print=1`;
}

export function resolveShipmentLabelUrl(labelUrl, trackingNumber, originOverride) {
  const raw = String(labelUrl || "").trim();
  const tracking = String(trackingNumber || "").trim();

  if (!raw) {
    return tracking && isMockStorkTrackingNumber(tracking)
      ? getMockLabelPageUrl(tracking, originOverride)
      : "";
  }

  // Purchased labels are stored as data URLs in Postgres; opening them directly in a new tab
  // often renders blank (browser size limits). Always route through the in-app label viewer.
  if (raw.startsWith("data:")) {
    return tracking ? getMockLabelPageUrl(tracking, originOverride) : raw;
  }

  if (isStorkbinLocalUrl(raw)) {
    const match = raw.match(/\/labels\/([^/?#]+)/i);
    const ref = match?.[1] ? decodeURIComponent(match[1]) : tracking;
    return getMockLabelPageUrl(ref, originOverride);
  }

  if (/^https?:\/\//i.test(raw)) return raw;
  if (tracking && isMockStorkTrackingNumber(tracking)) {
    return getMockLabelPageUrl(tracking, originOverride);
  }
  return raw;
}

export function resolveShipmentTrackingUrl(trackingUrl, trackingNumber, originOverride) {
  const raw = String(trackingUrl || "").trim();
  const tracking = String(trackingNumber || "").trim();

  if (raw && isStorkbinLocalUrl(raw)) {
    const match = raw.match(/\/track\/([^/?#]+)/i);
    const ref = match?.[1] ? decodeURIComponent(match[1]) : tracking;
    return getMockTrackPageUrl(ref, originOverride);
  }

  if (raw && /^https?:\/\//i.test(raw)) return raw;

  if (tracking && isMockStorkTrackingNumber(tracking)) {
    return getMockTrackPageUrl(tracking, originOverride);
  }

  if (tracking) return `${FEDEX_TRACK_BASE_URL}${encodeURIComponent(tracking)}`;
  return raw;
}
