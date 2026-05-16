import { Link, useParams, useLocation } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader";
import { colors } from "../styles/styles";
import { isSafeBoxIdPathSegment } from "../utils/boxIdRef";

function PublicScanGatePage() {
  const { boxIdOrToken } = useParams();
  const location = useLocation();
  const raw = String(boxIdOrToken || "").trim();
  const looksOk = isSafeBoxIdPathSegment(raw);
  const redirectPath = looksOk ? `${location.pathname}${location.search || ""}` : "";
  const isCustomerSticker = new URLSearchParams(location.search).get("customer") === "1";

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", minHeight: "100vh", background: colors.background }}>
      <PublicSiteHeader />
      <main style={{ maxWidth: "520px", margin: "0 auto", padding: "32px 22px 48px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, color: colors.charcoal, margin: "0 0 12px" }}>
          Bin QR scan
        </h1>
        {!looksOk ? (
          <p style={{ color: colors.gray, lineHeight: 1.55, fontSize: "15px" }}>
            This scan link is not valid. If the sticker looks damaged, contact support for a replacement QR.
          </p>
        ) : (
          <>
            <p style={{ color: colors.gray, lineHeight: 1.55, fontSize: "15px", marginBottom: "20px" }}>
              {isCustomerSticker
                ? "Sign in to manage this bin: update inventory and send it back to storage when you are ready."
                : "Sign in to continue. Customer bin links open your bin; warehouse links require an admin account."}
            </p>
            <Link
              to={redirectPath ? `/login?redirect=${encodeURIComponent(redirectPath)}` : "/login"}
              style={{
                display: "inline-block",
                padding: "12px 20px",
                borderRadius: "8px",
                background: colors.primaryDark,
                color: "#fff",
                fontWeight: 600,
                textDecoration: "none",
                fontSize: "15px",
              }}
            >
              Sign in to continue
            </Link>
            <p style={{ marginTop: "18px", fontSize: "14px" }}>
              <Link to={`/signup?redirect=${encodeURIComponent(redirectPath)}`} style={{ color: colors.primaryDark }}>
                Create an account
              </Link>
            </p>
          </>
        )}
        <p style={{ marginTop: "28px", fontSize: "14px" }}>
          <Link to="/" style={{ color: colors.primaryDark }}>
            ← Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}

export default PublicScanGatePage;
