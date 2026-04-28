import styles from "../styles/styles";
import InventoryPanel from "./InventoryPanel";
import SubscriptionPanel from "./SubscriptionPanel";
import InsuranceUpdatePanel from "./InsuranceUpdatePanel";
import CancelSubscriptionPanel from "./CancelSubscriptionPanel";
import OperationsControls from "./OperationsControls";

function BoxCard({
  isAdmin,
  box,
  boxItems,
  activeManageBox,
  insuranceEnabledInputs,
  declaredValueInputs,
  onAddToCart,
  onRemoveFromCart,
  onSetActiveManageBox,
  onRequestReturn,
  onSendBackToStorage,
  onUpdateFulfillmentStatus,
  onInsuranceEnabledChange,
  onDeclaredValueChange,
  onSaveInsurance,
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
          {/* ✅ SINGLE SOURCE OF TRUTH FOR STATUS MESSAGE */}
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
              : "Paid — waiting for fulfillment"}
          </p>

          {isAdmin && (
            <OperationsControls
              boxId={box.id}
              onUpdateFulfillmentStatus={onUpdateFulfillmentStatus}
            />
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

          {/* 🚫 NO DUPLICATE MESSAGE BLOCKS HERE ANYMORE */}

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
            activeManageBox?.view === "insurance" && (
              <InsuranceUpdatePanel
                boxId={box.id}
                insuranceEnabled={insuranceEnabledInputs[box.id]}
                declaredValue={declaredValueInputs[box.id]}
                onInsuranceEnabledChange={onInsuranceEnabledChange}
                onDeclaredValueChange={onDeclaredValueChange}
                onSaveInsurance={onSaveInsurance}
                onBack={() =>
                  onSetActiveManageBox({
                    id: box.id,
                    view: "menu",
                  })
                }
              />
            )}

          {isManageOpen &&
            box.status !== "return_requested" &&
            box.status !== "return_to_storage_requested" &&
            activeManageBox?.view === "cancel" && (
              <CancelSubscriptionPanel
                box={box}
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