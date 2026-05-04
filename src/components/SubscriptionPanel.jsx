import styles from "../styles/styles";

function SubscriptionPanel({ boxId, onNavigate, onClose, onManagePaymentMethod }) {
  return (
    <div style={styles.subPanel}>
      <h4>Subscription Settings</h4>

      <button
        style={styles.secondaryButton}
        onClick={() => onManagePaymentMethod?.()}
        disabled={!onManagePaymentMethod}
        title={!onManagePaymentMethod ? "Stripe payment method management is not available yet." : undefined}
      >
        Manage Payment Method
      </button>

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
