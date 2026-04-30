import styles from "../styles/styles";
import InventoryPanel from "./InventoryPanel";
import SubscriptionPanel from "./SubscriptionPanel";
import CancelSubscriptionPanel from "./CancelSubscriptionPanel";
import OperationsControls from "./OperationsControls";

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
  const shippingCost = Number(shipment?.shipping_cost || shipment?.shipping_estimate || 18);
  const chargeStatus = shipment?.charge_status || null;

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
          <div style={styles.row}>
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
          </div>
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
              : box.fulfillment_status === "paid_waiting_to_ship_bin"
              ? "Paid — StorkBin needs to prepare your starter bin shipment"
              : box.fulfillment_status === "ready_to_ship_to_customer"
              ? "Shipping paid — StorkBin needs to create/print the label"
              : box.fulfillment_status === "label_created"
              ? "Label created — shipment is being prepared"
              : box.fulfillment_status === "shipped_to_customer" ||
                box.fulfillment_status === "bin_shipped_to_customer"
              ? "Bin shipped — on its way to you"
              : box.fulfillment_status === "awaiting_customer_dropoff"
              ? "Shipping paid — label needed for you to send this bin to storage"
              : box.fulfillment_status === "awaiting_storage_arrival"
              ? "In transit to StorkBin — awaiting storage arrival"
              : box.fulfillment_status === "received_in_storage"
              ? "Received — ready to be stored"
              : box.fulfillment_status === "bin_with_customer"
              ? "Bin with you — add or update inventory"
              : box.fulfillment_status === "return_to_storage_requested"
              ? "Return to storage requested — we’ll prepare to receive your bin"
              : box.fulfillment_status === "return_requested"
              ? "Return requested — your bin is being prepared for shipment back to you"
              : box.fulfillment_status === "shipment_pending_payment"
              ? "Shipment pending payment — your bin is ready to ship after payment"
              : box.fulfillment_status === "shipment_payment_failed"
              ? "Shipping payment failed — your bin will not ship until payment is resolved"
              : "Paid — waiting for fulfillment"}
          </p>

          {(box.fulfillment_status === "shipment_pending_payment" ||
            box.fulfillment_status === "shipment_payment_failed" ||
            box.fulfillment_status === "ready_to_ship_to_customer" ||
            box.fulfillment_status === "awaiting_customer_dropoff" ||
            box.fulfillment_status === "awaiting_storage_arrival" ||
            box.fulfillment_status === "shipped_to_customer" ||
            box.fulfillment_status === "label_created") && (
            <div style={styles.panel}>
              {!shipment ? (
                <p style={styles.warningText}>
                  Shipment details are loading. Refresh once if this does not update.
                </p>
              ) : (
                <>
                  <h4>
                    {shipment.shipment_direction === "to_storage"
                      ? "Return-to-Storage Shipment"
                      : "Shipment to Customer"}
                  </h4>

                  <p style={styles.smallText}>
                    Shipping Status: {shipment.shipping_status} / Charge: {chargeStatus || "not started"}
                    {shipment.label_status ? ` / Label: ${shipment.label_status}` : ""}
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

                  {shipment.shipping_status === "pending_payment" && !chargeStatus && (
                    <button
                      style={styles.primaryButton}
                      onClick={() => onPayShipping(box.id, shipment.id)}
                    >
                      Pay Shipping
                    </button>
                  )}

                  {(shipment.shipping_status === "paid" || chargeStatus === "paid") && (
                    <p style={styles.successText}>
                      Shipping paid — waiting for label/fulfillment.
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

                  {isAdmin && (
                    <div style={styles.panel}>
                      <h4>Admin Shipment Ops</h4>

                      <div style={styles.row}>
                        {shipment.label_status !== "printed" &&
                          shipment.label_status !== "emailed" &&
                          shipment.label_status !== "created" && (
                            <button
                              style={styles.primaryButton}
                              onClick={() => onGenerateLabel(shipment, box)}
                            >
                              Generate Label
                            </button>
                          )}

                        {(shipment.label_status === "printed" ||
                          shipment.label_status === "emailed" ||
                          shipment.label_status === "created") &&
                          shipment.shipping_status !== "in_transit" &&
                          shipment.shipping_status !== "delivered" && (
                            <button
                              style={styles.primaryButton}
                              onClick={() => onMarkShipmentInTransit(shipment, box)}
                            >
                              Mark Shipped / In Transit
                            </button>
                          )}

                        {shipment.shipping_status === "in_transit" && (
                          <button
                            style={styles.secondaryButton}
                            onClick={() => onMarkShipmentDelivered(shipment, box)}
                          >
                            {shipment.shipment_direction === "to_storage"
                              ? "Mark Received in Storage"
                              : "Mark Delivered to Customer"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

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
