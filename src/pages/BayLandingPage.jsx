import { Link, useParams, useSearchParams } from "react-router-dom";
import styles from "../styles/styles";

/** Shown when a warehouse worker scans a bay location QR (`/bay/A3?admin=1`). */
export default function BayLandingPage({ appData }) {
  const { bayCode } = useParams();
  const [searchParams] = useSearchParams();
  const code = String(bayCode || "").trim().toUpperCase();
  const adminIntent = searchParams.get("admin") === "1";

  if (!code) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Invalid bay link</h2>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <p style={{ ...styles.smallText, margin: "0 0 8px", textTransform: "uppercase" }}>Rack location</p>
      <h2 style={{ ...styles.sectionTitle, fontSize: 36, marginBottom: 8 }}>Bay {code}</h2>
      <p style={styles.mutedText}>
        {adminIntent
          ? "Use this sticker during return intake: scan the bin first, then scan this bay to confirm placement."
          : "Warehouse bay location."}
      </p>
      {appData?.isAdmin ? (
        <Link to="/admin/storage-bays" style={styles.linkButtonSecondary}>
          Storage bays list
        </Link>
      ) : null}
    </div>
  );
}
