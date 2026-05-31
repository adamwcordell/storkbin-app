import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isPasswordRecoveryCallback, passwordRecoveryRedirectPath } from "../utils/authCallback";

/** Sends password-reset email links to /reset-password before the app treats them as a normal login. */
export default function RecoveryPasswordRedirect({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isPasswordRecoveryCallback()) return;
    if (location.pathname === "/reset-password") return;
    navigate(passwordRecoveryRedirectPath(), { replace: true });
  }, [location.pathname, location.hash, location.search, navigate]);

  return children;
}
