import styles from "../styles/styles";

function CancelSubscriptionPanel({ box, onBack }) {
  const boxIsStored = box.status === "stored";
  const boxIsWithCustomer = box.status === "at_customer";

  return (
    <div style={styles.subPanel}>
      <h4>Cancel Subscription</h4>

      <p style={styles.smallText}>
        You can request cancellation now. If your minimum subscription term has
        not been met, your subscription will remain active through the end of
        that period and monthly billing will stop afterward.
      </p>

      <p style={styles.smallText}>
        To close this subscription, your bin must either be returned to
        StorkBin or purchased for a replacement fee.
      </p>

      {boxIsStored && (
        <div style={styles.panel}>
          <h4>Your bin is currently stored</h4>
          <p style={styles.smallText}>
            We will need to send your bin back to you before cancellation can be
            completed.
          </p>

          <button
            style={styles.primaryButton}
            onClick={() =>
              alert(
                "Coming soon: ship bin to customer, then return bin after removing items."
              )
            }
          >
            Send My Bin, Then I’ll Return It
          </button>

          <div style={{ marginTop: "8px" }}>
            <button
              style={styles.secondaryButton}
              onClick={() =>
                alert(
                  "Coming soon: ship bin to customer and charge replacement/bin purchase fee."
                )
              }
            >
              Send My Bin, I Want To Keep It
            </button>
          </div>
        </div>
      )}

      {boxIsWithCustomer && (
        <div style={styles.panel}>
          <h4>Your bin is currently with you</h4>
          <p style={styles.smallText}>
            Choose whether you will return the bin to StorkBin or keep it and
            pay the replacement fee.
          </p>

          <button
            style={styles.primaryButton}
            onClick={() =>
              alert(
                "Coming soon: create cancellation request and return-bin workflow."
              )
            }
          >
            I’ll Return the Bin
          </button>

          <div style={{ marginTop: "8px" }}>
            <button
              style={styles.secondaryButton}
              onClick={() =>
                alert(
                  "Coming soon: create cancellation request and charge replacement/bin purchase fee."
                )
              }
            >
              I Want To Keep the Bin
            </button>
          </div>
        </div>
      )}

      {!boxIsStored && !boxIsWithCustomer && (
        <p style={styles.warningText}>
          This subscription cannot while the bin is In-Transit.
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