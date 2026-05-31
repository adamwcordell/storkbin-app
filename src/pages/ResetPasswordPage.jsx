import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader";
import { supabase } from "../supabaseClient";
import { colors } from "../styles/styles";
import { isPasswordRecoveryCallback } from "../utils/authCallback";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ error: "", success: "" });

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });

    const fromRecoveryLink = isPasswordRecoveryCallback();

    let cancelled = false;

    const markReady = () => {
      if (!cancelled) setReady(true);
    };

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.user) {
        markReady();
        return;
      }
      if (!fromRecoveryLink) {
        setInvalidLink(true);
        setReady(true);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || (session?.user && fromRecoveryLink)) {
        setInvalidLink(false);
        markReady();
      }
    });

    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (cancelled) return;
        if (session?.user) {
          markReady();
        } else if (!fromRecoveryLink) {
          setInvalidLink(true);
          setReady(true);
        } else {
          setInvalidLink(true);
          setReady(true);
        }
      });
    }, 8000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const saveNewPassword = async () => {
    setMessage({ error: "", success: "" });
    const p = password.trim();
    const c = confirm.trim();
    if (p.length < 8) {
      setMessage({ error: "Password must be at least 8 characters.", success: "" });
      return;
    }
    if (p !== c) {
      setMessage({ error: "Passwords do not match.", success: "" });
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: p });
    setBusy(false);

    if (error) {
      setMessage({ error: error.message || "Could not update password.", success: "" });
      return;
    }

    setMessage({ error: "", success: "Password updated. Taking you to your dashboard…" });
    window.history.replaceState(null, "", "/reset-password");
    window.setTimeout(() => {
      navigate("/dashboard", { replace: true });
    }, 1200);
  };

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", minHeight: "100vh", background: colors.background }}>
      <PublicSiteHeader />
      <main style={{ maxWidth: "440px", margin: "0 auto", padding: "32px 22px 48px" }}>
        <h1 style={{ margin: "0 0 8px", fontSize: "26px", fontWeight: 700, color: colors.charcoal }}>
          Choose a new password
        </h1>
        <p style={{ margin: "0 0 20px", color: colors.gray, lineHeight: 1.5, fontSize: "15px" }}>
          Pick a new password for your StorkBin account. This link only works once.
        </p>

        {!ready ? (
          <p style={{ color: colors.gray, fontSize: "15px" }}>Verifying your reset link…</p>
        ) : invalidLink ? (
          <>
            <p style={{ color: colors.charcoal, fontSize: "15px", lineHeight: 1.5 }}>
              This reset link is missing, expired, or already used. Request a new one from the log-in page.
            </p>
            <p style={{ marginTop: "18px" }}>
              <Link to="/login" style={{ color: colors.primaryDark, fontWeight: 600 }}>
                Go to log in
              </Link>
            </p>
          </>
        ) : (
          <>
            <label style={labelStyle}>New password (min 8 characters)</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={fieldStyle}
            />
            <label style={labelStyle}>Confirm new password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={fieldStyle}
            />
            {message.error ? <p style={errorStyle}>{message.error}</p> : null}
            {message.success ? <p style={successStyle}>{message.success}</p> : null}
            <button type="button" style={btnStyle} disabled={busy} onClick={saveNewPassword}>
              {busy ? "Saving…" : "Save new password"}
            </button>
          </>
        )}

        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "14px" }}>
          <Link to="/" style={{ color: colors.primaryDark }}>
            ← Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}

const labelStyle = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  marginTop: "14px",
  color: colors.charcoal,
};

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  borderRadius: "8px",
  border: `1px solid ${colors.lightGray}`,
  fontSize: "15px",
  marginTop: "6px",
};

const btnStyle = {
  marginTop: "20px",
  width: "100%",
  padding: "12px 16px",
  borderRadius: "10px",
  border: "none",
  background: colors.primary,
  color: colors.white,
  fontWeight: 600,
  fontSize: "15px",
  cursor: "pointer",
};

const errorStyle = { margin: "12px 0 0", color: "#b42318", fontSize: "14px" };
const successStyle = { margin: "12px 0 0", color: colors.primaryDark, fontSize: "14px", fontWeight: 600 };

export default ResetPasswordPage;
