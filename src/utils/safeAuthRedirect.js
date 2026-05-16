import { isSafeBoxIdPathSegment } from "./boxIdRef";

/**
 * Returns a safe in-app path for post-login redirects, or "".
 * Rejects protocol-relative URLs, other origins, and path traversal.
 */
export function safeAuthRedirectPath(raw) {
  const s = String(raw || "").trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("..")) return "";

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://app.invalid";
    const u = new URL(s, base);
    if (u.origin !== base) return "";
    const scanMatch = /^\/scan\/([^/?#]+)$/i.exec(u.pathname);
    const isScan =
      Boolean(scanMatch) && isSafeBoxIdPathSegment(decodeURIComponent(scanMatch[1]));
    const binMatch = /^\/bins\/([^/?#]+)$/i.exec(u.pathname);
    const isBinDetail = binMatch && isSafeBoxIdPathSegment(decodeURIComponent(binMatch[1]));
    if (!isScan && !isBinDetail) return "";
    return `${u.pathname}${u.search}`;
  } catch {
    return "";
  }
}
