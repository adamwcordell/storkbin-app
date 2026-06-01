import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { isPasswordRecoveryCallback, passwordRecoveryRedirectPath } from "../utils/authCallback";
import PublicSiteHeader from "../components/PublicSiteHeader";
import AuthCard from "../components/AuthCard";
import { colors } from "../styles/styles";
import { supabase } from "../supabaseClient";
import {
  POST_LOGIN_REDIRECT_KEY,
  resolvePostLoginRedirect,
  safeAuthRedirectPath,
} from "../utils/safeAuthRedirect";

function PublicLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBanner, setAuthBanner] = useState({ error: "", success: "" });

  useEffect(() => {
    if (isPasswordRecoveryCallback()) {
      navigate(passwordRecoveryRedirectPath(), { replace: true });
    }
  }, [navigate]);

  const logIn = async () => {
    setAuthBanner({ error: "", success: "" });
    const addr = String(email || "").trim();
    if (!addr || !password) {
      setAuthBanner({ error: "Enter email and password.", success: "" });
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: addr, password });
    if (error) {
      setAuthBanner({ error: error.message || "Sign in failed.", success: "" });
      return;
    }
    setAuthBanner({ error: "", success: "" });
    if (data?.user) {
      const next = resolvePostLoginRedirect(searchParams.get("redirect"));
      if (next) {
        sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, next);
      }
    }
  };

  const signUp = () => {
    const next = safeAuthRedirectPath(searchParams.get("redirect"));
    navigate(next ? `/signup?redirect=${encodeURIComponent(next)}` : "/signup");
  };

  const requestPasswordReset = async () => {
    setAuthBanner({ error: "", success: "" });
    const emailAddress = String(email || "").trim();
    if (!emailAddress) {
      setAuthBanner({ error: "Enter your email above, then use Forgot password.", success: "" });
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(emailAddress, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      setAuthBanner({ error: error.message || "Reset request failed.", success: "" });
    } else {
      setAuthBanner({ error: "", success: "Check your email for a reset link." });
    }
  };

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", minHeight: "100vh", background: colors.background }}>
      <PublicSiteHeader />
      <div style={{ maxWidth: "480px", margin: "0 auto", padding: "32px 22px 48px" }}>
        <AuthCard
          email={email}
          password={password}
          onEmailChange={(v) => {
            setAuthBanner({ error: "", success: "" });
            setEmail(v);
          }}
          onPasswordChange={(v) => {
            setAuthBanner({ error: "", success: "" });
            setPassword(v);
          }}
          onSignUp={signUp}
          onLogIn={logIn}
          onForgotPassword={requestPasswordReset}
          errorMessage={authBanner.error}
          successMessage={authBanner.success}
        />
        <p style={{ textAlign: "center", marginTop: "16px", fontSize: "14px" }}>
          <Link to="/" style={{ color: colors.primaryDark }}>
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}

export default PublicLoginPage;
