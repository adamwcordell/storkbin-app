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
  const failedPayments = shipments.filter(
    (shipment) => shipment.charge_status === "failed"
  );

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
        failedPayments.length > 0 ||
        pendingCancellations.length > 0) && (
        <div style={styles.panel}>
          <h2 style={styles.sectionTitle}>Needs Attention</h2>

          {cartBoxes.length > 0 && (
            <p style={styles.smallText}>
              You have {cartBoxes.length} item
              {cartBoxes.length === 1 ? "" : "s"} in your cart.{" "}
              <Link to="/cart">Review checkout</Link>
            </p>
          )}

          {failedPayments.length > 0 && (
            <p style={styles.warningText}>
              {failedPayments.length} shipment payment
              {failedPayments.length === 1 ? "" : "s"} need attention.
            </p>
          )}

          {appData.isAdmin && pendingCancellations.length > 0 && (
            <p style={styles.warningText}>
              {pendingCancellations.length} cancellation request
              {pendingCancellations.length === 1 ? "" : "s"} waiting for
              review. <Link to="/admin">Open admin</Link>
            </p>
          )}
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

export default DashboardPage;
