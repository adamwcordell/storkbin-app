import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { colors } from "../styles/styles";
import { isPasswordRecoveryCallback, passwordRecoveryRedirectPath } from "../utils/authCallback";

/**
 * Shown while logged out but the URL may contain Supabase auth tokens (e.g. email confirmation → /dashboard).
 * Without this route, `*` sends /dashboard to `/` and the session is never applied.
 */
function AuthSessionBridgePage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("working");

  useEffect(() => {
    const hashQ = window.location.hash.replace(/^#/, "");
    const hashParams = new URLSearchParams(hashQ);
    const searchParams = new URLSearchParams(window.location.search);
    if (isPasswordRecoveryCallback()) {
      navigate(passwordRecoveryRedirectPath(), { replace: true });
      return;
    }

    const looksLikeAuthCallback =
      hashParams.has("access_token") ||
      hashParams.has("refresh_token") ||
      searchParams.has("code") ||
      hashParams.has("code");

    // Logged-out visit to /dashboard with no magic-link payload → home (not “Signing you in…” for 15s).
    if (!looksLikeAuthCallback) {
      let cancelled = false;
      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (cancelled) return;
        if (!session?.user) navigate("/", { replace: true });
      });
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    let timeoutId;

    const clearWait = () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const goLogin = () => {
      if (cancelled) return;
      setStatus("timeout");
      navigate("/login?note=confirm-link", { replace: true });
    };

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.user) {
        setStatus("done");
        clearWait();
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, sess) => {
      if (cancelled) return;
      if (sess?.user && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")) {
        setStatus("done");
        clearWait();
      }
    });

    timeoutId = window.setTimeout(goLogin, 15000);

    return () => {
      cancelled = true;
      clearWait();
      subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px",
        background: colors.background,
        color: colors.charcoal,
        textAlign: "center",
      }}
    >
      <p style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>Signing you in…</p>
      <p style={{ margin: "12px 0 0", maxWidth: "360px", fontSize: "15px", color: colors.gray, lineHeight: 1.5 }}>
        {status === "timeout"
          ? "Taking you to log in."
          : "Completing email confirmation. This usually takes a second."}
      </p>
      <p style={{ marginTop: "28px", fontSize: "14px" }}>
        <Link to="/" style={{ color: colors.primaryDark }}>
          Back to home
        </Link>
      </p>
    </div>
  );
}

export default AuthSessionBridgePage;
