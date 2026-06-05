/** Warehouse bay location sticker URL (`/bay/{code}?admin=1`). */
export function getBayScanUrl(bayCode, originOverride) {
  const code = String(bayCode || "").trim().toUpperCase();
  const origin =
    originOverride ||
    (typeof window !== "undefined" && window.location?.origin ? window.location.origin : "");
  if (!origin || !code) return "";
  return `${origin}/bay/${encodeURIComponent(code)}?admin=1`;
}
