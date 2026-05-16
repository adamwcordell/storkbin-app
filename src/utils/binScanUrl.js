import { isSafeBoxIdPathSegment } from "./boxIdRef";

/** Base `/scan/:id` URL (warehouse / generic). */
export function getBinScanUrl(boxId, originOverride) {
  const id = String(boxId || "").trim();
  const origin =
    originOverride ||
    (typeof window !== "undefined" && window.location?.origin ? window.location.origin : "");
  if (!origin || !id || !isSafeBoxIdPathSegment(id)) return "";
  return `${origin}/scan/${encodeURIComponent(id)}`;
}

/** Customer-facing physical sticker — forces owner routing even for admin test accounts. */
export function getCustomerBinScanUrl(boxId, originOverride) {
  const base = getBinScanUrl(boxId, originOverride);
  if (!base) return "";
  return `${base}?customer=1`;
}

/** Warehouse-only sticker — forces admin routing when opened by staff. */
export function getAdminBinScanUrl(boxId, originOverride) {
  const base = getBinScanUrl(boxId, originOverride);
  if (!base) return "";
  return `${base}?admin=1`;
}
