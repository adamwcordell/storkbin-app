import styles from "../styles/styles";
import InventoryPanel from "./InventoryPanel";
import SubscriptionPanel from "./SubscriptionPanel";
import CancelSubscriptionPanel from "./CancelSubscriptionPanel";
import OperationsControls from "./OperationsControls";

function BoxCard({
  isAdmin,
  box,
  boxItems,
  monthlyRate,
  onRequestCancellation,
  onApproveCancellation,
  onRejectCancellation,
  onOverrideCancellationEndDate,
  activeManageBox,
  onAddToCart,
  onRemoveFromCart,
  onSetActiveManageBox,
  onRequestReturn,
  onSendBackToStorage,
  onUpdateFulfillmentStatus,
  onAddItem,
  onDeleteItem,
  onItemNameChange,
  onItemDescriptionChange,
  onItemImageChange,
  itemName,
  itemDescription,
}) {
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

  return (
    <div style={styles.boxCard}>
      <div style={styles.boxHeader}>
        <div>
          <h3 style={styles.boxTitle}>{box.id}</h3>
          <p style={styles.mutedText}>Box Status: {box.status}</p>
          <p style={styles.mutedText}>Checkout: {box.checkout_status}</p>
          <p style={styles.mutedText}>
            Fulfillment: {box.fulfillment_status || "pending"}
          </p>

          {isActiveSubscription && (
            <p style={styles.successText}>
              Active — ${monthlyRate}/month storage
            </p>
          )}

          {cancellationRequested && (
            <p style={styles.warningText}>
              Cancellation Requested
              {subscriptionEndDate
                ? ` — subscription ends on ${subscriptionEndDate}`
                : " — your subscription will end after your 6-month minimum term"}
            </p>
          )}

          {cancellationApproved && (
            <p style={styles.successText}>
              Cancellation Approved
              {subscriptionEndDate
                ? ` — subscription ends on ${subscriptionEndDate}`
                : ""}
            </p>
          )}

          {cancellationRejected && (
            <p style={styles.warningText}>
              Cancellation Rejected — subscription remains active
            </p>
          )}
        </div>

        {box.checkout_status === "draft" && (
          <button
            style={styles.primaryButton}
            onClick={() => onAddToCart(box.id)}
          >
            Add to Cart
          </button>
        )}

        {box.checkout_status === "in_cart" && (
          <button
            style={styles.warningButton}
            onClick={() => onRemoveFromCart(box.id)}
          >
            Remove from Cart
          </button>
        )}
      </div>

      {box.checkout_status === "paid" && (
        <div style={styles.panel}>
          <p style={styles.successText}>
            {box.fulfillment_status === "stored"
              ? "Stored — your bin is safely in storage"
              : box.fulfillment_status === "bin_shipped_to_customer"
              ? "Bin shipped — on its way to you"
              : box.fulfillment_status === "bin_with_customer"
              ? "Bin with you — add or update inventory"
              : box.fulfillment_status === "return_to_storage_requested"
              ? "Return to storage requested — we’ll prepare to receive your bin"
              : box.fulfillment_status === "return_requested"
              ? "Return requested — your bin is being prepared for shipment back to you"
              : box.fulfillment_status === "shipment_pending_payment"
              ? "Shipment pending payment — your bin is ready to ship after payment"
              : "Paid — waiting for fulfillment"}
          </p>

          {isAdmin && (
            <OperationsControls
              boxId={box.id}
              onUpdateFulfillmentStatus={onUpdateFulfillmentStatus}
            />
          )}

          {isAdmin && (cancellationRequested || cancellationApproved) && (
            <div style={styles.panel}>
              <h4>Admin Cancellation Review</h4>

              <p style={styles.smallText}>
                Current cancellation status: {box.cancel_status}
                {subscriptionEndDate
                  ? ` — scheduled end date: ${subscriptionEndDate}.`
                  : ""}
              </p>

              <div style={styles.row}>
                {cancellationRequested && (
                  <>
                    <button
                      style={styles.primaryButton}
                      onClick={() => onApproveCancellation(box.id)}
                    >
                      Approve Cancellation
                    </button>

                    <button
                      style={styles.dangerButton}
                      onClick={() => onRejectCancellation(box.id)}
                    >
                      Reject Cancellation
                    </button>
                  </>
                )}

                <button
                  style={styles.secondaryButton}
                  onClick={() => onOverrideCancellationEndDate(box.id)}
                >
                  Override End Date
                </button>
              </div>
            </div>
          )}

          {box.status !== "return_requested" &&
            box.status !== "return_to_storage_requested" && (
              <div style={styles.row}>
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
                      style={styles.dangerButton}
                      onClick={() => onRequestReturn(box.id)}
                    >
                      Send Me My Bin
                    </button>
                  )}

                {box.status === "at_customer" && (
                  <button
                    style={styles.primaryButton}
                    onClick={() => onSendBackToStorage(box.id)}
                  >
                    Send Bin Back to Storage
                  </button>
                )}
              </div>
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
        </div>
      )}

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
  );
}

export default BoxCard;