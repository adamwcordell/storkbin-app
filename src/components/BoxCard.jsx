import { useState } from "react";
import styles from "../styles/styles";
import InventoryPanel from "./InventoryPanel";
import SubscriptionPanel from "./SubscriptionPanel";
import CancelSubscriptionPanel from "./CancelSubscriptionPanel";

function BoxCard({
  isAdmin,
  box,
  shipment,
  boxItems,
  monthlyRate,
  onRequestCancellation,
  onApproveCancellation,
  onRejectCancellation,
  onOverrideCancellationEndDate,
  activeManageBox,
  onAddToCart,
  onRemoveFromCart,
  onDeleteDraftBox,
  onUpdateBinName,
  onSetActiveManageBox,
  onRequestReturn,
  onSendBackToStorage,
  onUpdateFulfillmentStatus,
  onPayShipping,
  onGenerateLabel,
  onMarkShipmentInTransit,
  onMarkShipmentDelivered,
  onAddItem,
  onDeleteItem,
  onItemNameChange,
  onItemDescriptionChange,
  onItemImageChange,
  itemName,
  itemDescription,
}) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftBinName, setDraftBinName] = useState(box.customer_bin_name || "");

  const saveBinName = async () => {
    if (!onUpdateBinName) return;

    await onUpdateBinName(box.id, draftBinName);
    setIsEditingName(false);
  };

  const isManageOpen =
    activeManageBox === box.id || activeManageBox?.id === box.id;

  const cancellationRequested = box.cancel_status === "requested";
  const cancellationApproved = box.cancel_status === "approved";
  const cancellationRejected = box.cancel_status === "rejected";

  const subscriptionEndDate = box.subscription_ends_at
    ? new Date(box.subscription_ends_at).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const isActiveSubscription =
    box.checkout_status === "paid" &&
    !cancellationRequested &&
    !cancellationApproved;

  const shippingAddress = shipment?.shipping_address || {};
  const shippingCost = Number(
    shipment?.shipping_cost || shipment?.shipping_estimate || 18
  );
  const chargeStatus = shipment?.charge_status || null;

  const binLabel = box.box_number || box.id;

  const customerStatus = getCustomerStatus(box);
  const pendingCartAction =
    box.checkout_status === "paid" &&
    (box.cart_type === "ship_to_customer" || box.cart_type === "return_to_storage");
  const pendingCartLabel =
    box.cart_type === "return_to_storage"
      ? "Return in cart"
      : box.cart_type === "ship_to_customer"
        ? "Delivery in cart"
        : null;
  const shouldShowShipment =
    box.fulfillment_status === "shipment_pending_payment" ||
    box.fulfillment_status === "shipment_payment_failed" ||
    box.fulfillment_status === "ready_to_ship_to_customer" ||
    box.fulfillment_status === "awaiting_customer_dropoff" ||
    box.fulfillment_status === "awaiting_storage_arrival" ||
    box.fulfillment_status === "shipped_to_customer" ||
    box.fulfillment_status === "label_created";

  return (
    <div style={styles.boxCard}>
      <div style={styles.boxHeader}>
        <div>
          <p style={styles.smallText}>StorkBin</p>

          {isEditingName ? (
            <div style={nameEditWrapStyle}>
              <input
                style={nameInputStyle}
                placeholder="Name this bin"
                value={draftBinName}
                onChange={(event) => setDraftBinName(event.target.value)}
              />

              <div style={styles.row}>
                <button style={styles.primaryButton} onClick={saveBinName}>
                  Save
                </button>
                <button
                  style={styles.secondaryButton}
                  onClick={() => {
                    setDraftBinName(box.customer_bin_name || "");
                    setIsEditingName(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={binIdentityStyle}>
              <div style={binNumberRowStyle}>
                <h3 style={styles.boxTitle}>Bin {binLabel}</h3>

                {box.checkout_status === "paid" && (
                  <button
                    style={smallTextButtonStyle}
                    onClick={() => setIsEditingName(true)}
                  >
                    {box.customer_bin_name ? "Rename" : "Name bin"}
                  </button>
                )}
              </div>

              <h3 style={friendlyNameStyle}>
                {box.customer_bin_name || "Unnamed bin"}
              </h3>
            </div>
          )}

          <div style={statusRowStyle}>
            <div style={statusPillStyle(customerStatus.tone)}>
              {customerStatus.label}
            </div>

            {pendingCartLabel && (
              <div style={cartBadgeStyle}>{pendingCartLabel}</div>
            )}
          </div>

          <p style={{ ...styles.mutedText, marginTop: "10px" }}>
            {customerStatus.description}
          </p>

          {pendingCartLabel && (
            <p style={styles.smallText}>
              This bin has a pending cart action. Complete checkout or remove it from cart.
            </p>
          )}

          {isActiveSubscription && (
            <p style={styles.successText}>
              Active — ${monthlyRate}/month storage
            </p>
          )}

          {cancellationRequested && (
            <p style={styles.warningText}>
              Cancellation requested
              {subscriptionEndDate
                ? ` — subscription ends on ${subscriptionEndDate}`
                : " — your subscription will end after your 6-month minimum term"}
            </p>
          )}

          {cancellationApproved && (
            <p style={styles.successText}>
              Cancellation approved
              {subscriptionEndDate
                ? ` — subscription ends on ${subscriptionEndDate}`
                : ""}
            </p>
          )}

          {cancellationRejected && (
            <p style={styles.warningText}>
              Your previous cancellation request was rejected.
            </p>
          )}
        </div>

        <div style={{ ...styles.row, justifyContent: "flex-end" }}>
          {box.checkout_status === "draft" && (
            <>
              <button
                style={styles.primaryButton}
                onClick={() => onAddToCart(box.id)}
              >
                Add to Cart
              </button>

              <button
                style={styles.dangerButton}
                onClick={() => onDeleteDraftBox(box.id)}
              >
                Delete Draft
              </button>
            </>
          )}

          {(box.checkout_status === "in_cart" || pendingCartAction) && (
            <button
              style={styles.warningButton}
              onClick={() => onRemoveFromCart(box.id)}
            >
              Remove from Cart
            </button>
          )}

          {box.checkout_status === "paid" &&
            !pendingCartAction &&
            box.status !== "return_requested" &&
            box.status !== "return_to_storage_requested" && (
              <>
                <button
                  style={styles.secondaryButton}
                  onClick={() =>
                    onSetActiveManageBox({
                      id: box.id,
                      view: "menu",
                    })
                  }
                >
                  Manage Subscription
                </button>

                {box.status === "stored" &&
                  box.fulfillment_status === "stored" && (
                    <button
                      style={sendBinButtonStyle}
                      onClick={() => onRequestReturn(box.id)}
                    >
                      Send Me My Bin
                    </button>
                  )}

                {box.status === "at_customer" &&
                  box.fulfillment_status === "bin_with_customer" && (
                    <button
                      style={styles.primaryButton}
                      onClick={() => onSendBackToStorage(box.id)}
                    >
                      Send Bin Back to Storage
                    </button>
                  )}
              </>
            )}
        </div>
      </div>

      {box.checkout_status === "paid" && (
        <>
          {shouldShowShipment && (
            <details style={detailsPanelStyle}>
              <summary style={summaryStyle}>Shipping details</summary>

              {!shipment ? (
                <p style={styles.warningText}>
                  Shipment details are loading. Refresh once if this does not update.
                </p>
              ) : (
                <div style={{ marginTop: "12px" }}>
                  <h4 style={{ marginTop: 0 }}>
                    {shipment.shipment_direction === "to_storage"
                      ? "Return to Storage"
                      : "Shipment to Customer"}
                  </h4>

                  <p style={styles.smallText}>
                    Shipping Status: {shipment.shipping_status} / Charge:{" "}
                    {chargeStatus || "not started"}
                    {shipment.label_status
                      ? ` / Label: ${shipment.label_status}`
                      : ""}
                  </p>

                  <p style={styles.smallText}>
                    Ship to: {shippingAddress.full_name || "Customer"}
                    {shippingAddress.address_line1
                      ? `, ${shippingAddress.address_line1}`
                      : ""}
                    {shippingAddress.address_line2
                      ? `, ${shippingAddress.address_line2}`
                      : ""}
                    {shippingAddress.city ? `, ${shippingAddress.city}` : ""}
                    {shippingAddress.state ? `, ${shippingAddress.state}` : ""}
                    {shippingAddress.zip ? ` ${shippingAddress.zip}` : ""}
                  </p>

                  <p style={styles.successText}>
                    Shipping Cost: ${shippingCost.toFixed(2)}
                  </p>

                  {chargeStatus === "pending_auto_charge" && (
                    <p style={styles.warningText}>
                      We are attempting to bill your card on file automatically.
                    </p>
                  )}

                  {chargeStatus === "failed" && (
                    <>
                      <p style={styles.warningText}>
                        Auto-billing failed. Your bin will not ship until payment
                        is resolved.
                      </p>

                      {shipment.charge_failure_reason && (
                        <p style={styles.smallText}>
                          Reason: {shipment.charge_failure_reason}
                        </p>
                      )}

                      <button
                        style={styles.primaryButton}
                        onClick={() => onPayShipping(box.id, shipment.id)}
                      >
                        Retry Shipping Payment
                      </button>
                    </>
                  )}

                  {shipment.shipping_status === "pending_payment" &&
                    !chargeStatus && (
                      <button
                        style={styles.primaryButton}
                        onClick={() => onPayShipping(box.id, shipment.id)}
                      >
                        Pay Shipping
                      </button>
                    )}

                  {getShipmentMessage(shipment, chargeStatus) && (
                    <p style={getShipmentMessage(shipment, chargeStatus).style}>
                      {getShipmentMessage(shipment, chargeStatus).text}
                    </p>
                  )}

                  {shipment.tracking_number && (
                    <p style={styles.smallText}>
                      Tracking: {shipment.tracking_number}
                    </p>
                  )}

                  {(shipment.label_url || shipment.tracking_url) && (
                    <div style={styles.row}>
                      {shipment.label_url && (
                        <a
                          href={shipment.label_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View Label
                        </a>
                      )}

                      {shipment.tracking_url && (
                        <a
                          href={shipment.tracking_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Track Shipment
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}
            </details>
          )}

          {isManageOpen &&
            box.status !== "return_requested" &&
            box.status !== "return_to_storage_requested" &&
            activeManageBox?.view === "menu" && (
              <SubscriptionPanel
                boxId={box.id}
                onNavigate={(boxId, view) =>
                  onSetActiveManageBox({
                    id: boxId,
                    view,
                  })
                }
                onClose={() => onSetActiveManageBox(null)}
              />
            )}

          {isManageOpen &&
            box.status !== "return_requested" &&
            box.status !== "return_to_storage_requested" &&
            activeManageBox?.view === "cancel" && (
              <CancelSubscriptionPanel
                box={box}
                monthlyRate={monthlyRate}
                cancellationRequested={cancellationRequested}
                cancellationApproved={cancellationApproved}
                cancellationRejected={cancellationRejected}
                onRequestCancellation={onRequestCancellation}
                onBack={() =>
                  onSetActiveManageBox({
                    id: box.id,
                    view: "menu",
                  })
                }
              />
            )}
        </>
      )}

      <details style={detailsPanelStyle}>
        <summary style={summaryStyle}>
          Inventory ({boxItems.length} {boxItems.length === 1 ? "item" : "items"})
        </summary>

        <div style={{ marginTop: "12px" }}>
          <InventoryPanel
            box={box}
            boxItems={boxItems}
            itemName={itemName}
            itemDescription={itemDescription}
            onItemNameChange={onItemNameChange}
            onItemDescriptionChange={onItemDescriptionChange}
            onItemImageChange={onItemImageChange}
            onAddItem={onAddItem}
            onDeleteItem={onDeleteItem}
          />
        </div>
      </details>

      {isAdmin && (
        <details style={detailsPanelStyle}>
          <summary style={summaryStyle}>Technical details</summary>
          <div style={{ marginTop: "12px" }}>
            <p style={styles.smallText}>Physical location: {box.status}</p>
            <p style={styles.smallText}>Checkout: {box.checkout_status}</p>
            <p style={styles.smallText}>
              Fulfillment: {box.fulfillment_status || "pending"}
            </p>
          </div>
        </details>
      )}
    </div>
  );
}


function getShipmentMessage(shipment, chargeStatus) {
  if (!shipment) return null;

  const isReturnToStorage = shipment.shipment_direction === "to_storage";

  if (chargeStatus === "failed") {
    return {
      text: "Shipping payment failed. Please retry payment before this shipment can move.",
      style: styles.warningText,
    };
  }

  if (shipment.shipping_status === "pending_payment" && !chargeStatus) {
    return {
      text: "Shipping payment is needed before this shipment can move.",
      style: styles.warningText,
    };
  }

  if (shipment.shipping_status === "paid") {
    return {
      text: isReturnToStorage
        ? "Return shipping is paid — StorkBin is preparing your return label."
        : "Shipping is paid — StorkBin is preparing your shipment.",
      style: styles.successText,
    };
  }

  if (shipment.shipping_status === "label_created") {
    return {
      text: isReturnToStorage
        ? "Return label created — send your bin back using the provided label."
        : "Label created — your bin is ready to leave StorkBin.",
      style: styles.successText,
    };
  }

  if (shipment.shipping_status === "in_transit") {
    return {
      text: isReturnToStorage
        ? "Your bin is on its way back to StorkBin storage."
        : "Your bin is on its way to you.",
      style: styles.warningText,
    };
  }

  if (shipment.shipping_status === "delivered") {
    return {
      text: isReturnToStorage
        ? "Your bin has been received back into storage."
        : "Your bin has been delivered.",
      style: styles.successText,
    };
  }

  if (chargeStatus === "paid") {
    return {
      text: isReturnToStorage
        ? "Return shipping is paid — StorkBin is preparing your return label."
        : "Shipping is paid — StorkBin is preparing your shipment.",
      style: styles.successText,
    };
  }

  return null;
}

function getCustomerStatus(box) {
  if (box.checkout_status === "draft") {
    return {
      label: "Draft bin",
      description: "This bin has not been checked out yet.",
      tone: "neutral",
    };
  }

  if (box.checkout_status === "in_cart") {
    return {
      label: "In cart",
      description: "Complete checkout to activate this bin.",
      tone: "warning",
    };
  }

  if (box.fulfillment_status === "paid_waiting_to_ship_bin") {
    return {
      label: "Preparing your bin",
      description: "Your new bin order is paid. StorkBin is preparing it for shipment.",
      tone: "warning",
    };
  }

  if (box.fulfillment_status === "ready_to_ship_to_customer") {
    return {
      label: "Preparing shipment",
      description: "Your bin is being prepared to ship to you.",
      tone: "warning",
    };
  }

  if (box.fulfillment_status === "label_created") {
    return {
      label: "Label created",
      description: "A shipping label has been created for this bin.",
      tone: "warning",
    };
  }

  if (
    box.fulfillment_status === "shipped_to_customer" ||
    box.status === "in_transit_to_customer"
  ) {
    return {
      label: "On the way",
      description: "Your bin is on its way to you.",
      tone: "warning",
    };
  }

  if (box.fulfillment_status === "awaiting_customer_dropoff") {
    return {
      label: "Return label ready",
      description: "Your return label is ready. Send this bin back when you are ready.",
      tone: "warning",
    };
  }

  if (
    box.fulfillment_status === "awaiting_storage_arrival" ||
    box.status === "in_transit_to_storage"
  ) {
    return {
      label: "Returning to storage",
      description: "Your bin is on its way back to StorkBin storage.",
      tone: "warning",
    };
  }

  if (box.fulfillment_status === "shipment_payment_failed") {
    return {
      label: "Payment needed",
      description: "Shipping payment needs to be resolved before this bin can ship.",
      tone: "warning",
    };
  }

  if (box.fulfillment_status === "stored") {
    return {
      label: "Stored safely",
      description: "Your bin is currently stored with StorkBin.",
      tone: "success",
    };
  }

  if (
    box.fulfillment_status === "bin_with_customer" ||
    box.status === "at_customer"
  ) {
    return {
      label: "With you",
      description: "Your bin is currently with you. You can update inventory or send it back to storage.",
      tone: "success",
    };
  }

  return {
    label: "Active",
    description: "Your bin is active with StorkBin.",
    tone: "neutral",
  };
}

function statusPillStyle(tone) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "6px 10px",
    fontSize: "13px",
    fontWeight: 600,
    marginTop: "8px",
  };

  if (tone === "success") {
    return {
      ...base,
      color: "#7A9D7A",
      backgroundColor: "rgba(143, 175, 143, 0.18)",
      border: "1px solid rgba(143, 175, 143, 0.35)",
    };
  }

  if (tone === "warning") {
    return {
      ...base,
      color: "#9A5C4E",
      backgroundColor: "rgba(216, 140, 122, 0.18)",
      border: "1px solid rgba(216, 140, 122, 0.35)",
    };
  }

  return {
    ...base,
    color: "#555555",
    backgroundColor: "#F7F7F7",
    border: "1px solid #E5E5E5",
  };
}

const statusRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
};

const cartBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: "999px",
  padding: "6px 10px",
  fontSize: "13px",
  fontWeight: 600,
  marginTop: "8px",
  color: "#7A5C20",
  backgroundColor: "rgba(217, 179, 92, 0.18)",
  border: "1px solid rgba(217, 179, 92, 0.35)",
};

const detailsPanelStyle = {
  backgroundColor: "#F7F7F7",
  borderRadius: "10px",
  padding: "14px 16px",
  marginTop: "12px",
  border: "1px solid #E5E5E5",
};

const summaryStyle = {
  cursor: "pointer",
  fontWeight: 600,
  color: "#333333",
};



const binIdentityStyle = {
  display: "grid",
  gap: "4px",
};

const binNumberRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
};

const sendBinButtonStyle = {
  backgroundColor: "#D88C7A",
  color: "#FFFFFF",
  border: "none",
  padding: "10px 14px",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: 500,
};

const friendlyNameStyle = {
  margin: "0 0 4px 0",
  fontSize: "19px",
  fontWeight: 700,
  color: "#333333",
};

const binTitleRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
};

const smallTextButtonStyle = {
  background: "none",
  border: "none",
  color: "#7A9D7A",
  cursor: "pointer",
  fontWeight: 600,
  padding: 0,
  fontSize: "13px",
};

const nameEditWrapStyle = {
  display: "grid",
  gap: "10px",
  maxWidth: "360px",
};

const nameInputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid #E5E5E5",
  backgroundColor: "#FFFFFF",
  color: "#333333",
  fontSize: "14px",
};


export default BoxCard;
