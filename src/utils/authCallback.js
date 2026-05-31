/** True when the URL hash is from a Supabase password-recovery email link. */
export function isPasswordRecoveryCallback() {
  if (typeof window === "undefined") return false;
  const hashQ = String(window.location.hash || "").replace(/^#/, "");
  if (!hashQ) return false;
  const hashParams = new URLSearchParams(hashQ);
  return hashParams.get("type") === "recovery";
}

/** Preserve tokens in the hash when redirecting to /reset-password. */
export function passwordRecoveryRedirectPath() {
  if (typeof window === "undefined") return "/reset-password";
  return `/reset-password${window.location.search || ""}${window.location.hash || ""}`;
}
