import { useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import { POST_LOGIN_REDIRECT_KEY } from "../utils/safeAuthRedirect";

/**
 * After sign-in the app swaps to a new BrowserRouter; the URL may still be /login
 * while the catch-all route sends users to /dashboard. Read a pending redirect
 * saved before auth and navigate there on first paint.
 */
export default function PostLoginRedirect() {
  const navigate = useNavigate();

  useLayoutEffect(() => {
    const pending = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
    if (!pending) return;
    sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    navigate(pending, { replace: true });
  }, [navigate]);

  return null;
}
