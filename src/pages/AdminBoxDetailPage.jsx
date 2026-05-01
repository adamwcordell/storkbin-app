import { Link, useParams } from "react-router-dom";
import styles from "../styles/styles";
import OperationsControls from "../components/OperationsControls";

function AdminBoxDetailPage({ appData }) {
  const { boxId } = useParams();

  if (!appData.isAdmin) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Admin</h2>
        <p style={styles.warningText}>You do not have admin access.</p>
      </div>
    );
  }

  const box = appData.boxes.find(
    (currentBox) => String(currentBox.id) === String(boxId)
  );

  if (!box) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Bin not found</h2>
        <Link to="/admin" style={buttonLink}>
          Back to Admin
        </Link>
      </div>
    );
  }

  const shipment = appData.getShipmentForBox(box.id);
  const boxItems = appData.items.filter((item) => item.box_id === box.id);
  const binLabel = box.box_number || box.id;

  const shippingAddress = shipment?.shipping_address || {};
  const shippingCost = Number(
    shipment?.shipping_cost ||
      shipment?.shipping_estimate ||
      appData.DEFAULT_SHIPPING_COST ||
      18
  );

  const subscriptionEndDate = box.subscription_ends_at
    ? new Date(box.subscription_ends_at).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "Not scheduled";

  const canGenerateLabel =
    shipment &&
    (shipment.label_status === "needed" ||
      shipment.label_status === "label_needed" ||
      !shipment.label_status) &&
    (shipment.shipping_status === "paid" || shipment.charge_status === "paid");

  const canMarkInTransit =
    shipment && shipment.shipping_status === "label_created";

  const canMarkDelivered =
    shipment && shipment.shipping_status === "in_transit";

  const nextAction = getNextAction({
    box,
    shipment,
    canGenerateLabel,
    canMarkInTransit,
    canMarkDelivered,
  });

  return (
    <div>
      <div style={topBar}>
        <div>
          <h2 style={{ ...styles.sectionTitle, marginBottom: 4 }}>
            Admin · Bin {binLabel}
          </h2>
          <p style={styles.mutedText}>
            Worker view for warehouse, shipment, and inventory status.
          </p>
        </div>

        <div style={styles.row}>
          <Link to={`/bins/${box.id}`} style={buttonLink}>
            Customer View
          </Link>
          <Link to="/admin" style={buttonLink}>
            Back to Admin
          </Link>
        </div>
      </div>

      <section style={opsCard}>
        <div style={sectionTitleRow}>
          <div>
            <h3 style={compactHeading}>Next Action</h3>
            <p style={styles.mutedText}>{nextAction.message}</p>
          </div>

          <div style={styles.row}>
            {canGenerateLabel && (
              <button
                style={styles.primaryButton}
                onClick={() => appData.generateLabel(shipment, box)}
              >
                Generate Label
              </button>
            )}

            {canMarkInTransit && (
              <button
                style={styles.primaryButton}
                onClick={() => appData.markShipmentInTransit(shipment, box)}
              >
                Mark In Transit
              </button>
            )}

            {canMarkDelivered && (
              <button
                style={styles.primaryButton}
                onClick={() => appData.markShipmentDelivered(shipment, box)}
              >
                {shipment.shipment_direction === "to_storage"
                  ? "Receive Into Storage"
                  : "Mark Delivered"}
              </button>
            )}

            {box.cancel_status === "requested" && (
              <>
                <button
                  style={styles.primaryButton}
                  onClick={() => appData.approveCancellation(box.id)}
                >
                  Approve Cancellation
                </button>

                <button
                  style={dangerButton}
                  onClick={() => appData.rejectCancellation(box.id)}
                >
                  Reject Cancellation
                </button>
              </>
            )}

            {!canGenerateLabel &&
              !canMarkInTransit &&
              !canMarkDelivered &&
              box.cancel_status !== "requested" && (
                <span style={quietBadge}>{nextAction.badge}</span>
              )}
          </div>
        </div>
      </section>

      <section style={opsCard}>
        <h3 style={compactHeading}>Bin Status</h3>

        <div style={infoGrid}>
          <InfoRow label="Bin number" value={binLabel} />
          <InfoRow label="Physical location" value={box.status || "unknown"} />
          <InfoRow label="Fulfillment step" value={box.fulfillment_status || "pending"} />
          <InfoRow label="Checkout" value={box.checkout_status || "unknown"} />
          <InfoRow label="Cancellation" value={box.cancel_status || "none"} />
          <InfoRow label="Customer" value={box.customer_email || box.user_email || box.user_id || "unknown"} />
          <InfoRow label="Subscription end" value={subscriptionEndDate} />
        </div>
      </section>

      <section style={opsCard}>
        <h3 style={compactHeading}>Shipment</h3>

        {!shipment ? (
          <div style={emptyState}>
            <strong>No shipment yet</strong>
            <p style={styles.smallText}>
              A label can only be generated after a shipment row exists.
            </p>
          </div>
        ) : (
          <>
            <div style={infoGrid}>
              <InfoRow label="Direction" value={shipment.shipment_direction || "not set"} />
              <InfoRow label="Shipping status" value={shipment.shipping_status || "not started"} />
              <InfoRow label="Charge status" value={shipment.charge_status || "not started"} />
              <InfoRow label="Label status" value={shipment.label_status || "not created"} />
              <InfoRow label="Carrier" value={shipment.carrier || "not assigned"} />
              <InfoRow label="Tracking" value={shipment.tracking_number || "not assigned"} />
              <InfoRow label="Shipping cost" value={`$${shippingCost.toFixed(2)}`} />
              <InfoRow label="Address" value={formatAddress(shippingAddress)} wide />
            </div>

            {(shipment.label_url || shipment.tracking_url) && (
              <div style={{ ...styles.row, marginTop: 14 }}>
                {shipment.label_url && (
                  <a href={shipment.label_url} target="_blank" rel="noreferrer">
                    View Label
                  </a>
                )}

                {shipment.tracking_url && (
                  <a href={shipment.tracking_url} target="_blank" rel="noreferrer">
                    Track Shipment
                  </a>
                )}
              </div>
            )}

            {shipment.charge_failure_reason && (
              <p style={styles.warningText}>
                Charge failure: {shipment.charge_failure_reason}
              </p>
            )}
          </>
        )}
      </section>

      <section style={opsCard}>
        <details>
          <summary style={summaryStyle}>Manual status override</summary>
          <div style={{ marginTop: 12 }}>
            <p style={styles.smallText}>
              Use only for warehouse/admin corrections.
            </p>
            <OperationsControls
              boxId={box.id}
              onUpdateFulfillmentStatus={appData.updateFulfillmentStatus}
            />
          </div>
        </details>
      </section>

      {(box.cancel_status === "requested" || box.cancel_status === "approved") && (
        <section style={opsCard}>
          <h3 style={compactHeading}>Cancellation</h3>

          <div style={infoGrid}>
            <InfoRow label="Status" value={box.cancel_status} />
            <InfoRow label="Scheduled end" value={subscriptionEndDate} />
          </div>

          <div style={{ ...styles.row, marginTop: 14 }}>
            {box.cancel_status === "requested" && (
              <>
                <button
                  style={styles.primaryButton}
                  onClick={() => appData.approveCancellation(box.id)}
                >
                  Approve Cancellation
                </button>

                <button
                  style={dangerButton}
                  onClick={() => appData.rejectCancellation(box.id)}
                >
                  Reject Cancellation
                </button>
              </>
            )}

            <button
              style={styles.secondaryButton}
              onClick={() => appData.overrideCancellationEndDate(box.id)}
            >
              Override End Date
            </button>
          </div>
        </section>
      )}

      <section style={opsCard}>
        <h3 style={compactHeading}>Inventory</h3>

        {boxItems.length === 0 ? (
          <p style={styles.mutedText}>No inventory items.</p>
        ) : (
          <div style={compactTable}>
            {boxItems.map((item) => (
              <div key={item.id} style={tableRow}>
                <div>
                  <strong>{item.name}</strong>
                  <p style={styles.smallText}>
                    {item.description || "No description"}
                  </p>
                </div>

                <div style={rightAligned}>
                  <span style={quietBadge}>{item.status || "packed"}</span>
                  {item.image_url && (
                    <a href={item.image_url} target="_blank" rel="noreferrer">
                      Image
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InfoRow({ label, value, wide = false }) {
  return (
    <div style={wide ? wideInfoRow : infoRow}>
      <span style={infoLabel}>{label}</span>
      <span style={infoValue}>{value}</span>
    </div>
  );
}

function getNextAction({ box, shipment, canGenerateLabel, canMarkInTransit, canMarkDelivered }) {
  if (box.cancel_status === "requested") {
    return {
      badge: "Review needed",
      message: "Review and approve or reject this cancellation request.",
    };
  }

  if (!shipment) {
    return {
      badge: "No shipment",
      message: "No shipment exists yet. No warehouse shipping action is available.",
    };
  }

  if (shipment.charge_status === "failed") {
    return {
      badge: "Payment failed",
      message: "Shipping payment failed. Wait for customer payment before shipping.",
    };
  }

  if (canGenerateLabel) {
    return {
      badge: "Needs label",
      message: "Generate the shipping label for this shipment.",
    };
  }

  if (canMarkInTransit) {
    return {
      badge: "Ready to move",
      message: "Label has been created. Mark this shipment in transit when it leaves.",
    };
  }

  if (canMarkDelivered) {
    return {
      badge: "In transit",
      message:
        shipment.shipment_direction === "to_storage"
          ? "Shipment is in transit to storage. Receive it when it arrives."
          : "Shipment is in transit to customer. Mark delivered when complete.",
    };
  }

  if (shipment.shipping_status === "delivered") {
    return {
      badge: "Complete",
      message: "Shipment is delivered. No shipment action is needed.",
    };
  }

  return {
    badge: "No action",
    message: "No shipment action is currently available for this state.",
  };
}

function formatAddress(address) {
  if (!address) return "No address saved";

  return [
    address.full_name,
    address.address_line1,
    address.address_line2,
    [address.city, address.state, address.zip].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(", ") || "No address saved";
}

const topBar = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "16px",
  marginBottom: "16px",
};

const opsCard = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #E5E5E5",
  borderRadius: "8px",
  padding: "18px",
  marginBottom: "14px",
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
};

const sectionTitleRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "16px",
};

const compactHeading = {
  margin: "0 0 8px 0",
  fontSize: "18px",
  fontWeight: 600,
  color: "#333333",
};

const infoGrid = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "0",
  borderTop: "1px solid #E5E5E5",
  marginTop: "10px",
};

const infoRow = {
  display: "grid",
  gridTemplateColumns: "160px 1fr",
  gap: "12px",
  padding: "10px 0",
  borderBottom: "1px solid #E5E5E5",
};

const wideInfoRow = {
  display: "grid",
  gridTemplateColumns: "160px 1fr",
  gap: "12px",
  padding: "10px 0",
  borderBottom: "1px solid #E5E5E5",
  gridColumn: "1 / -1",
};

const infoLabel = {
  color: "#555555",
  fontSize: "13px",
};

const infoValue = {
  color: "#333333",
  fontSize: "14px",
  fontWeight: 600,
  wordBreak: "break-word",
};

const buttonLink = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#E5E5E5",
  color: "#333333",
  textDecoration: "none",
  border: "none",
  padding: "10px 14px",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: 500,
};

const dangerButton = {
  backgroundColor: "#b00020",
  color: "#FFFFFF",
  border: "none",
  padding: "10px 14px",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: 500,
};

const quietBadge = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: "999px",
  padding: "5px 9px",
  fontSize: "12px",
  fontWeight: 600,
  color: "#555555",
  backgroundColor: "#F7F7F7",
  border: "1px solid #E5E5E5",
};

const summaryStyle = {
  cursor: "pointer",
  fontWeight: 600,
  color: "#333333",
};

const emptyState = {
  borderTop: "1px solid #E5E5E5",
  marginTop: "10px",
  paddingTop: "12px",
};

const compactTable = {
  borderTop: "1px solid #E5E5E5",
  marginTop: "10px",
};

const tableRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "16px",
  padding: "12px 0",
  borderBottom: "1px solid #E5E5E5",
};

const rightAligned = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
};

export default AdminBoxDetailPage;
