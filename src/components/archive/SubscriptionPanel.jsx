import styles from "../styles/styles";

function SubscriptionPanel({ boxId, onNavigate, onClose }) {
  return (
    <div style={styles.subPanel}>
      <h4>Subscription Settings</h4>

      <button
        style={styles.primaryButton}
        onClick={() => onNavigate(boxId, "insurance")}
      >
        Update Insurance
      </button>

      <div style={{ marginTop: "8px" }}>
        <button
          style={styles.secondaryButton}
          onClick={() => alert("Payment method management coming soon.")}
        >
          Manage Payment Method
        </button>
      </div>

      <div style={{ marginTop: "8px" }}>
        <button
          style={styles.dangerButton}
          onClick={() => onNavigate(boxId, "cancel")}
        >
          Cancel Subscription
        </button>
      </div>

      <div style={{ marginTop: "12px" }}>
        <button style={styles.secondaryButton} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

export default SubscriptionPanel;