import { isSafeBoxIdPathSegment } from "./boxIdRef";

/** sessionStorage key — survives logged-out → logged-in router remount after sign-in. */
export const POST_LOGIN_REDIRECT_KEY = "storkbin_post_login_redirect";

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

/**
 * Maps scan URLs to the customer bin inventory screen when possible so login
 * lands directly on inventory instead of bouncing through the dashboard.
 */
export function resolvePostLoginRedirect(raw) {
  const safe = safeAuthRedirectPath(raw);
  if (!safe) return "";

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://app.invalid";
    const u = new URL(safe, base);
    const scanMatch = /^\/scan\/([^/?#]+)$/i.exec(u.pathname);
    if (scanMatch) {
      const id = decodeURIComponent(scanMatch[1]);
      if (!isSafeBoxIdPathSegment(id)) return safe;
      if (u.searchParams.get("admin") === "1") return safe;
      return `/bins/${encodeURIComponent(id)}?from_scan=1`;
    }
    return safe;
  } catch {
    return safe;
  }
}
