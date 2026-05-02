import { Link, useLocation } from "react-router-dom";
import styles from "../styles/styles";

function AccountPage({ appData }) {
  const location = useLocation();
  const showPaymentFocus = new URLSearchParams(location.search).get("payment") === "1";

  return (
    <div>
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Account</h2>
        <p style={styles.mutedText}>Logged in as {appData.user.email}</p>
      </div>

      <div style={showPaymentFocus ? paymentFocusPanelStyle : styles.panel}>
        <h3 style={{ marginTop: 0 }}>Payment Method</h3>

        {showPaymentFocus && (
          <p style={styles.warningText}>
            Payment failed. Update your payment method, then retry the shipment payment on the affected bin.
          </p>
        )}

        <p style={styles.smallText}>
          Stripe payment method management will be wired here. For now, this is the customer destination for failed-payment recovery.
        </p>

        <button
          style={styles.primaryButton}
          onClick={() => alert("Stripe payment method update will be connected here.")}
        >
          Update Payment Method
        </button>

        <div style={{ marginTop: "12px" }}>
          <Link style={styles.linkButtonSecondary} to="/bins">
            Back to My Bins
          </Link>
        </div>
      </div>
    </div>
  );
}

const paymentFocusPanelStyle = {
  ...styles.panel,
  border: "1px solid rgba(216, 140, 122, 0.55)",
  backgroundColor: "rgba(216, 140, 122, 0.08)",
};

export default AccountPage;
