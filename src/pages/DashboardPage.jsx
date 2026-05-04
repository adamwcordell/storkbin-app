import { Link } from "react-router-dom";
import styles from "../styles/styles";
import AddBinSubscription from "../components/AddBinSubscription";

function DashboardPage({ appData }) {
  const boxes = appData.boxes || [];
  const shipments = appData.shipments || [];
  const cartBoxes = appData.cartBoxes || [];

  const storedBoxes = boxes.filter((box) => box.status === "stored");
  const atCustomerBoxes = boxes.filter((box) => box.status === "at_customer");
  const inTransitBoxes = boxes.filter(
    (box) =>
      box.status === "in_transit_to_customer" ||
      box.status === "in_transit_to_storage"
  );

  const pendingCancellations = boxes.filter(
    (box) => box.cancel_status === "requested"
  );

  const auctionBoxes = boxes.filter(
    (box) => box.lifecycle_status === "auction"
  );

  const failedPaymentBoxes = boxes.filter((box) => {
    if (box.lifecycle_status === "auction" || box.lifecycle_status === "removed_from_system") {
      return false;
    }

    // Reactivation is optional and belongs on Account/My Bins, not Dashboard attention.
    // Dashboard payment attention is only for money owed or blocked shipments.
    if (box.subscription_lifecycle_status === "terminated") {
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

  const plans = appData.SUBSCRIPTION_PLANS || [];

  return (
    <div>
      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <p style={styles.smallText}>Total Bins</p>
          <h2 style={styles.metric}>{boxes.length}</h2>
        </div>
        <div style={styles.summaryCard}>
          <p style={styles.smallText}>Stored</p>
          <h2 style={styles.metric}>{storedBoxes.length}</h2>
        </div>
        <div style={styles.summaryCard}>
          <p style={styles.smallText}>With You</p>
          <h2 style={styles.metric}>{atCustomerBoxes.length}</h2>
        </div>
        <div style={styles.summaryCard}>
          <p style={styles.smallText}>In Transit</p>
          <h2 style={styles.metric}>{inTransitBoxes.length}</h2>
        </div>
      </div>

      {(cartBoxes.length > 0 ||
        failedPaymentBoxes.length > 0 ||
        auctionBoxes.length > 0 ||
        pendingCancellations.length > 0) && (
        <div style={styles.panel}>
          <h2 style={styles.sectionTitle}>Needs Attention</h2>

          <div style={attentionListStyle}>
            {cartBoxes.length > 0 && (
              <div style={attentionItemStyle}>
                <strong>Cart pending</strong>
                <p style={styles.smallText}>
                  You have {cartBoxes.length} item
                  {cartBoxes.length === 1 ? "" : "s"} waiting for checkout.
                </p>
                <Link style={styles.linkButtonSecondary} to="/cart">
                  Review checkout
                </Link>
              </div>
            )}

            {failedPaymentBoxes.length > 0 && (
              <div style={paymentAttentionStyle}>
                <strong>Payment needed</strong>
                <p style={styles.warningText}>
                  {failedPaymentBoxes.length} bin
                  {failedPaymentBoxes.length === 1 ? " needs" : "s need"} payment attention.
                </p>

                <div style={paymentIssueListStyle}>
                  {failedPaymentBoxes.map((box) => (
                    <div key={box.id} style={paymentIssueRowStyle}>
                      <strong>Bin {box.box_number || box.id}</strong>
                      <p style={{ ...styles.smallText, margin: "4px 0 0 0" }}>
                        {getPaymentWarningMessage(box)}
                      </p>
                    </div>
                  ))}
                </div>

                <Link style={styles.linkButtonSecondary} to="/account?payment=1">
                  Update Card
                </Link>
              </div>
            )}

            {auctionBoxes.length > 0 && (
              <div style={auctionAttentionStyle}>
                <strong>Auction notice</strong>
                <p style={styles.warningText}>
                  {auctionBoxes.length} bin
                  {auctionBoxes.length === 1 ? " is" : "s are"} in auction status and may not be recoverable.
                </p>
                <a style={styles.linkButtonSecondary} href="mailto:support@storkbin.com">
                  Contact StorkBin
                </a>
              </div>
            )}

            {appData.isAdmin && pendingCancellations.length > 0 && (
              <div style={attentionItemStyle}>
                <strong>Admin review needed</strong>
                <p style={styles.warningText}>
                  {pendingCancellations.length} cancellation request
                  {pendingCancellations.length === 1 ? "" : "s"} waiting for review.
                </p>
                <Link style={styles.linkButtonSecondary} to="/admin">
                  Open admin
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      <AddBinSubscription
        plans={plans}
        onSelectPlan={appData.createSubscriptionPlan}
      />

      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Manage Your Bins</h2>
        <p style={styles.mutedText}>
          Open My Bins to view contents, request shipments, or manage subscriptions.
        </p>
        <Link style={styles.linkButton} to="/bins">
          View My Bins
        </Link>
      </div>
    </div>
  );
}

function getPaymentWarningMessage(box) {
  const days = getGraceDaysRemaining(box);
  const dayText =
    days !== null && days > 0
      ? ` ${days} ${days === 1 ? "day" : "days"} remaining.`
      : "";

  if (box.subscription_payment_status === "failed" && box.status === "at_customer") {
    return `Monthly payment failed. This bin is with you; subscription may terminate if payment is not fixed.${dayText}`;
  }

  if (box.subscription_payment_status === "failed") {
    return `Monthly storage payment failed. This stored bin may move toward auction if payment is not fixed.${dayText}`;
  }

  if (box.cancellation_shipping_charge_status === "failed") {
    return `Final shipment payment failed. This stored bin may move toward auction if payment is not fixed.${dayText}`;
  }

  return "Shipment payment failed. Update your card so the shipment can continue.";
}

function getGraceDaysRemaining(box) {
  const candidateDates = [];

  if (box.lifecycle_deadline_at) {
    candidateDates.push(new Date(box.lifecycle_deadline_at));
  }

  if (box.cancellation_shipping_charge_failed_at) {
    const failedAt = new Date(box.cancellation_shipping_charge_failed_at);
    if (!Number.isNaN(failedAt.getTime())) {
      candidateDates.push(new Date(failedAt.getTime() + 45 * 24 * 60 * 60 * 1000));
    }
  }

  if (box.last_payment_failed_at && box.status === "stored") {
    const failedAt = new Date(box.last_payment_failed_at);
    if (!Number.isNaN(failedAt.getTime())) {
      candidateDates.push(new Date(failedAt.getTime() + 60 * 24 * 60 * 60 * 1000));
    }
  }

  if (box.last_payment_failed_at && box.status === "at_customer") {
    const failedAt = new Date(box.last_payment_failed_at);
    if (!Number.isNaN(failedAt.getTime())) {
      candidateDates.push(new Date(failedAt.getTime() + 30 * 24 * 60 * 60 * 1000));
    }
  }

  const validDates = candidateDates.filter((date) => !Number.isNaN(date.getTime()));
  if (validDates.length === 0) return null;

  const soonestDeadline = validDates.reduce((earliest, date) =>
    date.getTime() < earliest.getTime() ? date : earliest
  );

  return Math.ceil((soonestDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

const attentionListStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
};

const attentionItemStyle = {
  border: "1px solid #E5E5E5",
  borderRadius: "10px",
  padding: "14px",
  backgroundColor: "#FFFFFF",
};

const paymentAttentionStyle = {
  ...attentionItemStyle,
  borderColor: "#E8B4B4",
  backgroundColor: "#FFF5F5",
};

const auctionAttentionStyle = {
  ...attentionItemStyle,
  borderColor: "#E8B4B4",
  backgroundColor: "#FFF5F5",
};

const paymentIssueListStyle = {
  display: "grid",
  gap: "8px",
  margin: "10px 0 12px 0",
};

const paymentIssueRowStyle = {
  border: "1px solid rgba(216, 140, 122, 0.35)",
  backgroundColor: "#FFFFFF",
  borderRadius: "8px",
  padding: "10px",
};

export default DashboardPage;
