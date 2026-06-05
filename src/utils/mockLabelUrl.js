/** In-app mock shipping label page (beta / simulator). Uses real site origin, not storkbin.local. */
export function getMockLabelPageUrl(trackingNumber, originOverride) {
  const tracking = String(trackingNumber || "").trim();
  const origin =
    originOverride ||
    (typeof window !== "undefined" && window.location?.origin ? window.location.origin : "");
  if (!tracking || !origin) return "";
  return `${origin.replace(/\/$/, "")}/labels/${encodeURIComponent(tracking)}`;
}
