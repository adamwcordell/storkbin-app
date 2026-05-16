/**
 * RFC 4122 UUID (used when ids happen to be standard UUIDs).
 */
export const RFC_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Box id / scan token allowed in `/scan/:boxIdOrToken` and `/bins/:id`.
 * StorkBin may use non-UUID primary keys (e.g. hyphenated hex segments); keep a tight allowlist.
 */
export function isSafeBoxIdPathSegment(raw) {
  const s = String(raw || "").trim();
  if (s.length < 4 || s.length > 128) return false;
  return /^[a-zA-Z0-9_-]+$/.test(s);
}
