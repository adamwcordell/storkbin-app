import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styles from "../styles/styles";
import InventoryPanel from "./InventoryPanel";
import { MINIMUM_TERM_MONTHS } from "../config/subscriptionPlans";

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
  /** When true (e.g. opened from QR scan), after a shipping cart prep succeeds, go to Cart to pick FedEx service + Stripe checkout. */
  navigateToCartAfterShippingPrep = false,
  /** Phone-friendly scan view: inventory + return shipping only (hides subscription/cancellation clutter). */
  scanMinimalUi = false,
  onUpdateFulfillmentStatus,
  onPayShipping,
  onGenerateLabel,
  onMarkShipmentInTransit,
  onMarkShipmentDelivered,
  onStartReactivationCheckout,
  onAddItem,
  onDeleteItem,
  onItemNameChange,
  onItemDescriptionChange,
  onItemImageChange,
  itemName,
  itemDescription,
  itemImageFile,
  /** When true, this bin is in a multi-bin starter kit but is not the lead bin — hide per-bin remove. */
  showStarterKitBundledHint = false,
}) {
  const navigate = useNavigate();
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftBinName, setDraftBinName] = useState(box.customer_bin_name || "");

  const saveBinName = async () => {
    if (!onUpdateBinName) return;

    const ok = await onUpdateBinName(box.id, draftBinName);
    if (ok !== false) {
      setIsEditingName(false);
    }
  };

  const handleRequestReturn = async () => {
    if (!onRequestReturn) return;
    const ok = await onRequestReturn(box.id);
    if (ok && navigateToCartAfterShippingPrep) {
      navigate("/cart");
    }
  };

  const handleSendBackToStorage = async (returnEmpty) => {
    if (!onSendBackToStorage) return;
    const ok = await onSendBackToStorage(box.id, { returnEmpty });
    if (ok && navigateToCartAfterShippingPrep) {
      navigate("/cart");
    }
  };


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

  const isSubscriptionTerminated = box.subscription_lifecycle_status === "terminated";
  const isReactivationEligible =
    box.status === "at_customer" &&
    isSubscriptionTerminated &&
    box.lifecycle_status !== "auction" &&
    box.lifecycle_status !== "removed_from_system";

  const isActiveSubscription =
    box.checkout_status === "paid" &&
    !isSubscriptionTerminated &&
    !cancellationRequested &&
    !cancellationApproved;

  const chargeStatus = shipment?.charge_status || null;
  const hasShipmentPaymentFailure =
    chargeStatus === "failed" ||
    box.fulfillment_status === "shipment_payment_failed" ||
    box.cancellation_shipping_charge_status === "failed";
  const hasSubscriptionPaymentFailure =
    !isSubscriptionTerminated && box.subscription_payment_status === "failed";
  const hasPaymentFailure = hasShipmentPaymentFailure || hasSubscriptionPaymentFailure;
  const isAuction = box.lifecycle_status === "auction";
  const isPaymentLocked = hasPaymentFailure && !isAuction;
  const paymentFailureCopy = getPaymentFailureCopy(box);
  const graceDaysRemaining = getGraceDaysRemaining(box);

  const binLabel = box.box_number || box.id;

  const customerStatus = getCustomerStatus(box, shipment);
  const pendingCartAction =
    box.checkout_status === "paid" &&
    (box.cart_type === "ship_to_customer" || box.cart_type === "return_to_storage");
  const pendingCartLabel =
    box.cart_type === "return_to_storage"
      ? box.return_shipment_empty
        ? "Empty flat return in cart (bundles up to 5 per label)"
        : "Full bin return in cart"
      : box.cart_type === "ship_to_customer"
        ? "Delivery in cart"
        : null;
  const binDisplayName = box.customer_bin_name?.trim() || "Unnamed bin";

  return (
    <div style={styles.boxCustomerBinCard}>
      <div style={styles.cartShippingBinBand}>
        {isEditingName ? (
          <div style={nameEditWrapStyle}>
            <input
              style={nameInputStyle}
              placeholder="Name this bin"
              value={draftBinName}
              onChange={(event) => setDraftBinName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveBinName();
                }
              }}
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
          <>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
              }}
            >
              <p style={{ ...styles.cartShippingBinTitleLine, flex: "1 1 220px", margin: 0 }}>
                <span style={styles.cartShippingBinNumber}>Bin {binLabel}</span>
                <span style={{ color: "#555555", fontWeight: 500 }}> · </span>
                <span
                  style={{
                    ...styles.cartShippingBinName,
                    ...(box.customer_bin_name?.trim()
                      ? { fontSize: "24px", fontWeight: 700, lineHeight: 1.25 }
                      : {}),
                  }}
                >
                  {binDisplayName}
                </span>
              </p>
              {box.checkout_status === "paid" && (
                <button style={smallTextButtonStyle} type="button" onClick={() => setIsEditingName(true)}>
                  {box.customer_bin_name ? "Rename" : "Name bin"}
                </button>
              )}
            </div>
            <div style={{ ...statusRowStyle, marginTop: "8px" }}>
              <div style={statusPillStyle(customerStatus.tone)}>{customerStatus.label}</div>
              {pendingCartLabel && <div style={cartBadgeStyle}>{pendingCartLabel}</div>}
            </div>
          </>
        )}
      </div>

      <div style={styles.cartShippingInner}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "20px",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            {scanMinimalUi ? (
              <p style={{ ...styles.mutedText, marginTop: 0, lineHeight: 1.5 }}>
                Update what&apos;s in this bin, then send it back to storage when you&apos;re ready — full bins or
                empty stacked flat (up to five per label). Full account options are in the app menu.
              </p>
            ) : (
              <>
                <p style={{ ...styles.mutedText, marginTop: 0 }}>{customerStatus.description}</p>

                {pendingCartLabel && (
                  <p style={{ ...styles.smallText, marginTop: "8px" }}>
                    This bin has a pending cart action. Complete checkout or remove it from cart.
                  </p>
                )}

                {isActiveSubscription && (
                  <p style={{ ...styles.successText, marginTop: "10px" }}>
                    Active — ${monthlyRate}/month storage
                  </p>
                )}

                {cancellationRequested && (
                  <p style={{ ...styles.warningText, marginTop: "10px" }}>
                    Cancellation requested
                    {subscriptionEndDate
                      ? ` — subscription ends on ${subscriptionEndDate}`
                      : ` — your subscription will end after your ${MINIMUM_TERM_MONTHS}-month minimum term`}
                  </p>
                )}

                {cancellationApproved && (
                  <p style={{ ...cancellationNoticeTextStyle, marginTop: "10px" }}>
                    Cancellation approved
                    {subscriptionEndDate ? ` — subscription ends on ${subscriptionEndDate}` : ""}
                  </p>
                )}

                {cancellationRejected && (
                  <p style={{ ...styles.warningText, marginTop: "10px" }}>
                    Your previous cancellation request was rejected.
                  </p>
                )}
              </>
            )}
          </div>

          <div style={actionRailStyle}>
            <div style={rightActionButtonsStyle}>
              {box.checkout_status === "draft" && (
                <>
                  <button style={styles.primaryButton} onClick={() => onAddToCart(box.id)}>
                    Add to Cart
                  </button>

                  <button style={styles.dangerButton} onClick={() => onDeleteDraftBox(box.id)}>
                    Delete Draft
                  </button>
                </>
              )}

              {(box.checkout_status === "in_cart" || pendingCartAction) &&
                (showStarterKitBundledHint ? (
                  <p style={{ ...styles.smallText, margin: 0, maxWidth: "220px", lineHeight: 1.45 }}>
                    Part of your starter kit with other bins in this order. Remove the whole kit from{" "}
                    <Link style={styles.linkButtonSecondary} to="/cart">
                      Cart
                    </Link>{" "}
                    or the first bin in the kit.
                  </p>
                ) : (
                  <button style={styles.warningButton} onClick={() => onRemoveFromCart(box.id)}>
                    Remove from Cart
                  </button>
                ))}

              {box.checkout_status === "paid" &&
                !isPaymentLocked &&
                !isReactivationEligible &&
                !isAuction &&
                !pendingCartAction &&
                box.status !== "return_requested" &&
                box.status !== "return_to_storage_requested" && (
                  <>
                    {box.status === "stored" &&
                      box.lifecycle_status !== "auction" &&
                      box.fulfillment_status === "stored" && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                            alignItems: "stretch",
                            maxWidth: "340px",
                          }}
                        >
                          <button style={sendBinButtonStyle} type="button" onClick={() => void handleRequestReturn()}>
                            Send Me My Bin
                          </button>
                        </div>
                      )}

                    {box.status === "at_customer" && box.fulfillment_status === "bin_with_customer" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "stretch" }}>
                        <button
                          style={sendBinPrimaryButtonStyle}
                          type="button"
                          onClick={() => void handleSendBackToStorage(false)}
                        >
                          Send bin back to storage
                        </button>
                        <button
                          style={styles.secondaryButton}
                          type="button"
                          onClick={() => void handleSendBackToStorage(true)}
                        >
                          Return empty flat (up to 5 per label)
                        </button>
                        {scanMinimalUi && (
                          <p style={{ ...styles.smallText, margin: 0, lineHeight: 1.45 }}>
                            Choose this if your bins are empty and stacked flat — one label can cover up to five bins.
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
            </div>

            {hasPaymentFailure && !isAuction && (
              <div style={paymentAlertStyle}>
                <strong>{paymentFailureCopy.title}</strong>
                <p style={{ ...styles.smallText, margin: "6px 0 10px 0" }}>
                  {getPaymentFailureMessage(box, graceDaysRemaining)}
                </p>

                <Link style={styles.linkButtonSecondary} to="/account?payment=1">
                  {paymentFailureCopy.actionLabel}
                </Link>
              </div>
            )}

            {isReactivationEligible && !scanMinimalUi && (
              <div style={reactivationAlertStyle}>
                <strong>Subscription ended</strong>
                <p style={{ ...styles.smallText, margin: "6px 0 10px 0" }}>
                  {onStartReactivationCheckout
                    ? "Restart your monthly subscription when you’re ready (first month is due up front)."
                    : "Reactivate this subscription from your Account page if you want service to continue."}
                </p>

                {onStartReactivationCheckout ? (
                  <button
                    type="button"
                    style={styles.linkButtonSecondary}
                    onClick={() => onStartReactivationCheckout(box.id)}
                  >
                    Reactivate Subscription
                  </button>
                ) : (
                  <Link style={styles.linkButtonSecondary} to="/account?payment=1">
                    Reactivate Subscription
                  </Link>
                )}
              </div>
            )}

            {isAuction && (
              <div style={auctionAlertStyle}>
                <strong>Auction status</strong>
                <p style={{ ...styles.smallText, margin: "6px 0 0 0" }}>
                  This bin requires immediate attention. Please contact StorkBin support.
                </p>
              </div>
            )}
          </div>
        </div>

        {scanMinimalUi ? (
          <div style={{ marginTop: "14px" }}>
            <h4 style={{ margin: "0 0 8px", fontSize: "16px" }}>Inventory</h4>
            <InventoryPanel
              box={box}
              boxItems={boxItems}
              itemName={itemName}
              itemDescription={itemDescription}
              itemImageFile={itemImageFile}
              onItemNameChange={onItemNameChange}
              onItemDescriptionChange={onItemDescriptionChange}
              onItemImageChange={onItemImageChange}
              onAddItem={onAddItem}
              onDeleteItem={onDeleteItem}
            />
          </div>
        ) : (
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
                itemImageFile={itemImageFile}
                onItemNameChange={onItemNameChange}
                onItemDescriptionChange={onItemDescriptionChange}
                onItemImageChange={onItemImageChange}
                onAddItem={onAddItem}
                onDeleteItem={onDeleteItem}
              />
            </div>
          </details>
        )}

        {isAdmin && (
          <details style={detailsPanelStyle}>
            <summary style={summaryStyle}>Technical details</summary>
            <div style={{ marginTop: "12px" }}>
              <p style={styles.smallText}>Physical location: {box.status}</p>
              <p style={styles.smallText}>Checkout: {box.checkout_status}</p>
              <p style={styles.smallText}>Fulfillment: {box.fulfillment_status || "pending"}</p>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}



function getPaymentFailureCopy(box) {
  if (box.subscription_lifecycle_status === "terminated") {
    return {
      title: "Subscription ended",
      actionLabel: "Reactivate Subscription",
    };
  }

  return {
    title: "Payment failed",
    actionLabel: "Update Card",
  };
}

function getPaymentFailureMessage(box, graceDaysRemaining) {
  if (box.subscription_lifecycle_status === "terminated") {
    return "Reactivate your subscription to continue using this bin.";
  }

  const dayText =
    graceDaysRemaining !== null && graceDaysRemaining > 0
      ? ` You have ${graceDaysRemaining} ${graceDaysRemaining === 1 ? "day" : "days"} remaining.`
      : "";

  if (box.subscription_payment_status === "failed" && box.status === "at_customer") {
    return `Update your card to keep this subscription active. This bin will not move to auction while it is with you.${dayText}`;
  }

  if (box.subscription_payment_status === "failed") {
    return `Update your card to keep this bin stored and avoid auction risk.${dayText}`;
  }

  if (box.cancellation_shipping_charge_status === "failed") {
    return `Update your card so we can complete the final shipment for this bin.${dayText}`;
  }

  return `Update your card to continue this shipment.${dayText}`;
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
      candidateDates.push(new Date(failedAt.getTime() + 45 * 24 * 60 * 60 * 1000));
    }
  }

  const validDates = candidateDates.filter((date) => !Number.isNaN(date.getTime()));
  if (validDates.length === 0) return null;

  const soonestDeadline = validDates.reduce((earliest, date) =>
    date.getTime() < earliest.getTime() ? date : earliest
  );

  return Math.ceil((soonestDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}


function getCustomerStatus(box, shipment) {
  const shipmentStatus = String(shipment?.shipping_status || "");
  const shipmentDirection = String(shipment?.shipment_direction || "");

  if (
    shipmentDirection === "to_customer" &&
    (shipmentStatus === "in_transit" || shipmentStatus === "out_for_delivery")
  ) {
    return {
      label: "On the way",
      description: "Your bin is on its way to you.",
      tone: "warning",
    };
  }

  if (
    shipmentDirection === "to_storage" &&
    (shipmentStatus === "in_transit" || shipmentStatus === "out_for_delivery")
  ) {
    return {
      label: "Returning to storage",
      description: "Your bin is on its way back to StorkBin storage.",
      tone: "warning",
    };
  }

  if (
    shipmentDirection === "to_storage" &&
    shipmentStatus === "label_created" &&
    box.status === "at_customer"
  ) {
    return {
      label: "Return label ready",
      description: "Your return label is ready. Send this bin back when you are ready.",
      tone: "warning",
    };
  }

  if (box.lifecycle_status === "auction") {
    return {
      label: "Auction status",
      description: "This bin may no longer be recoverable.",
      tone: "warning",
    };
  }
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

  if (box.subscription_lifecycle_status === "terminated") {
    return {
      label: "Subscription ended",
      description: "Reactivate this subscription to continue using this bin.",
      tone: "warning",
    };
  }

  if (
    box.fulfillment_status === "shipment_payment_failed" ||
    box.cancellation_shipping_charge_status === "failed" ||
    box.subscription_payment_status === "failed"
  ) {
    return {
      label: "Payment needed",
      description:
        box.subscription_payment_status === "failed" && box.status === "at_customer"
          ? "Your monthly payment needs to be resolved to keep this subscription active."
          : box.subscription_payment_status === "failed"
            ? "Your monthly storage payment needs to be resolved."
            : "Shipping payment needs to be resolved before this bin can ship.",
      tone: "warning",
    };
  }

  if (box.status === "stored" && box.fulfillment_status === "stored") {
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
    marginTop: 0,
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

const actionRailStyle = {
  display: "grid",
  gap: "12px",
  justifyItems: "end",
  alignContent: "start",
  minWidth: "280px",
  maxWidth: "360px",
};

const rightActionButtonsStyle = {
  ...styles.row,
  justifyContent: "flex-end",
};

const paymentAlertStyle = {
  border: "1px solid rgba(216, 140, 122, 0.45)",
  backgroundColor: "rgba(216, 140, 122, 0.12)",
  borderRadius: "10px",
  padding: "12px",
  width: "100%",
  boxSizing: "border-box",
  textAlign: "left",
};

const reactivationAlertStyle = {
  border: "1px solid rgba(79, 151, 111, 0.45)",
  backgroundColor: "rgba(79, 151, 111, 0.12)",
  borderRadius: "10px",
  padding: "12px",
  width: "100%",
  boxSizing: "border-box",
  textAlign: "left",
};

const auctionAlertStyle = {
  border: "1px solid #E8B4B4",
  backgroundColor: "#FFF5F5",
  borderRadius: "10px",
  padding: "12px",
  width: "100%",
  boxSizing: "border-box",
  textAlign: "left",
};


const cancellationNoticeTextStyle = {
  margin: "10px 0 0 0",
  color: "#9A5C4E",
  fontSize: "13px",
  fontWeight: 600,
};

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
  marginTop: 0,
  color: "#7A5C20",
  backgroundColor: "rgba(217, 179, 92, 0.18)",
  border: "1px solid rgba(217, 179, 92, 0.35)",
};

const detailsPanelStyle = {
  ...styles.panel,
  marginTop: "14px",
};

const summaryStyle = {
  cursor: "pointer",
  fontWeight: 600,
  color: "#333333",
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

const sendBinPrimaryButtonStyle = {
  ...styles.primaryButton,
  width: "100%",
  padding: "14px 16px",
  fontSize: "16px",
  fontWeight: 600,
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
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid #E5E5E5",
  backgroundColor: "#FFFFFF",
  color: "#333333",
  fontSize: "18px",
  fontWeight: 600,
};


export default BoxCard;
