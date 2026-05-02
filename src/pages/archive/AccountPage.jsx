import { Link, useLocation } from "react-router-dom";
import styles from "../styles/styles";

function AccountPage({ appData }) {
  const location = useLocation();
  const showPaymentFocus = new URLSearchParams(location.search).get("payment") === "1";
  const failedPaymentBoxes = getRecoverableFailedPaymentBoxes(appData.boxes || [], appData.shipments || []);
  const hasFailedPayments = failedPaymentBoxes.length > 0;

  return (
    <div>
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Account</h2>
        <p style={styles.mutedText}>Logged in as {appData.user.email}</p>
      </div>

      <div style={showPaymentFocus ? paymentFocusPanelStyle : styles.panel}>
        <h3 style={{ marginTop: 0 }}>Payment Method</h3>

        {hasFailedPayments ? (
          <>
            <p style={styles.warningText}>
              Payment failed. Update the card on file and retry the payment below.
            </p>

            <p style={styles.smallText}>
              For now, this mock flow simulates updating the payment method and successfully retrying the failed charge.
              Stripe card management will be connected later.
            </p>

            <div style={retryPanelStyle}>
              <h4 style={{ marginTop: 0 }}>Failed payments</h4>

              {failedPaymentBoxes.map((box) => (
                <div key={box.id} style={retryRowStyle}>
                  <div>
                    <strong>Bin {box.box_number || box.id}</strong>
                    <p style={{ ...styles.smallText, margin: "4px 0 0 0" }}>
                      {getFailureSummary(box)}
                    </p>
                  </div>

                  <button
                    style={styles.primaryButton}
                    onClick={() => appData.payShipping(box.id)}
                  >
                    Update Card & Retry Payment
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p style={styles.smallText}>
              Payment method management will be connected here later.
            </p>

            {showPaymentFocus && (
              <p style={styles.successText}>
                No recoverable failed payments were found for your active bins.
              </p>
            )}
          </>
        )}

        <div style={{ marginTop: "12px" }}>
          <Link style={styles.linkButtonSecondary} to="/bins">
            Back to My Bins
          </Link>
        </div>
      </div>
    </div>
  );
}

function getRecoverableFailedPaymentBoxes(boxes, shipments) {
  return boxes.filter((box) => {
    if (box.lifecycle_status === "auction" || box.lifecycle_status === "removed_from_system") {
      return false;
    }

    const relatedShipmentFailed = shipments.some(
      (shipment) =>
        shipment.charge_status === "failed" &&
        (shipment.box_id === box.id ||
          shipment.latest_box_id === box.id ||
          shipment.box_ids?.includes?.(box.id) ||
          shipment.shipment_boxes?.some((shipmentBox) => shipmentBox.box_id === box.id))
    );

    return (
      relatedShipmentFailed ||
      box.fulfillment_status === "shipment_payment_failed" ||
      box.cancellation_shipping_charge_status === "failed" ||
      box.subscription_payment_status === "failed"
    );
  });
}

function getFailureSummary(box) {
  if (box.cancellation_shipping_charge_status === "failed") {
    return "Final cancellation shipment charge failed.";
  }

  if (box.subscription_payment_status === "failed") {
    return "Monthly subscription payment failed.";
  }

  return "Shipment payment failed.";
}

const paymentFocusPanelStyle = {
  ...styles.panel,
  border: "1px solid rgba(216, 140, 122, 0.55)",
  backgroundColor: "rgba(216, 140, 122, 0.08)",
};

const retryPanelStyle = {
  marginTop: "18px",
  borderTop: "1px solid rgba(0, 0, 0, 0.08)",
  paddingTop: "14px",
};

const retryRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  border: "1px solid #E5E5E5",
  borderRadius: "10px",
  padding: "12px",
  backgroundColor: "#FFFFFF",
  marginTop: "10px",
};

export default AccountPage;
