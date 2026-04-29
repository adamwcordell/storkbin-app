import styles from "../styles/styles";

function CancelSubscriptionPanel({ box, onBack, onRequestCancellation }) {
  const boxIsStored = box.status === "stored";
  const boxIsWithCustomer = box.status === "at_customer";
  const boxIsInTransit =
    box.status === "in_transit_to_customer" ||
    box.fulfillment_status === "bin_shipped_to_customer";

  return (
    <div style={styles.subPanel}>
      <h4>Cancel Subscription</h4>

      <p style={styles.smallText}>
        You can request cancellation now. If your 3-month minimum subscription
        term has not been met, your subscription will remain active through the
        end of that period and monthly billing will stop afterward.
      </p>

      <p style={styles.smallText}>
        Your one-time setup fee includes the purchase of your bin. You do not
        need to return the bin to cancel your subscription.
      </p>

      {boxIsStored && (
        <div style={styles.panel}>
          <h4>Your bin is currently stored</h4>

          <p style={styles.smallText}>
            Cancelling your subscription will stop future renewal after your
            minimum term is complete. Shipping is charged only when you request
            your bin.
          </p>

          <button
            style={styles.dangerButton}
            onClick={() => onRequestCancellation(box.id)}
          >
            Request Cancellation
          </button>
        </div>
      )}

      {boxIsWithCustomer && (
        <div style={styles.panel}>
          <h4>Your bin is currently with you</h4>

          <p style={styles.smallText}>
            Since your setup fee includes your bin purchase, you can keep the
            bin after cancellation. Your subscription will stop after the
            minimum term or current subscription period.
          </p>

          <button
            style={styles.dangerButton}
            onClick={() => onRequestCancellation(box.id)}
          >
            Request Cancellation
          </button>
        </div>
      )}

      {boxIsInTransit && (
        <p style={styles.warningText}>
          This subscription cannot be cancelled while your bin is in transit.
          Once your bin arrives, you’ll be able to request cancellation.
        </p>
      )}

      {!boxIsStored && !boxIsWithCustomer && !boxIsInTransit && (
        <p style={styles.warningText}>
          This subscription cannot be cancelled from this status yet.
        </p>
      )}

      <div style={{ marginTop: "12px" }}>
        <button style={styles.secondaryButton} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

export default CancelSubscriptionPanel;