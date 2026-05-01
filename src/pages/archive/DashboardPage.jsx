import { Link } from "react-router-dom";
import styles from "../styles/styles";
import CreateBox from "../components/CreateBox";
import DraftBinSetup from "./DraftBinSetup";

function DashboardPage({ appData }) {
  const storedBoxes = appData.boxes.filter((box) => box.status === "stored");
  const atCustomerBoxes = appData.boxes.filter((box) => box.status === "at_customer");
  const inTransitBoxes = appData.boxes.filter((box) =>
    box.status === "in_transit_to_customer" || box.status === "in_transit_to_storage"
  );
  const pendingCancellations = appData.boxes.filter(
    (box) => box.cancel_status === "requested"
  );
  const failedPayments = appData.shipments.filter(
    (shipment) => shipment.charge_status === "failed"
  );

  return (
    <div>
      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <p style={styles.smallText}>Total Bins</p>
          <h2 style={styles.metric}>{appData.boxes.length}</h2>
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

      {(appData.cartBoxes.length > 0 || failedPayments.length > 0 || pendingCancellations.length > 0) && (
        <div style={styles.panel}>
          <h2 style={styles.sectionTitle}>Needs Attention</h2>

          {appData.cartBoxes.length > 0 && (
            <p style={styles.smallText}>
              You have {appData.cartBoxes.length} item{appData.cartBoxes.length === 1 ? "" : "s"} in your cart.{" "}
              <Link to="/cart">Review checkout</Link>
            </p>
          )}

          {failedPayments.length > 0 && (
            <p style={styles.warningText}>
              {failedPayments.length} shipment payment{failedPayments.length === 1 ? "" : "s"} need attention.
            </p>
          )}

          {appData.isAdmin && pendingCancellations.length > 0 && (
            <p style={styles.warningText}>
              {pendingCancellations.length} cancellation request{pendingCancellations.length === 1 ? "" : "s"} waiting for review.{" "}
              <Link to="/admin">Open admin</Link>
            </p>
          )}
        </div>
      )}

      <CreateBox
        newBoxId={appData.newBoxId}
        onBoxIdChange={appData.setNewBoxId}
        onCreateBox={appData.createBox}
      />

      <DraftBinSetup appData={appData} />

      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Manage Your Bins</h2>
        <p style={styles.mutedText}>
          Open My Bins to view contents, add inventory, request shipments, or manage subscriptions.
        </p>
        <Link style={styles.linkButton} to="/bins">
          View My Bins
        </Link>
      </div>
    </div>
  );
}

export default DashboardPage;
