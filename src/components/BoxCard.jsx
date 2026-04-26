import styles from "../styles/styles";
import InventoryPanel from "./InventoryPanel";
import SubscriptionPanel from "./SubscriptionPanel";
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
  return (
    <div style={styles.boxCard}>
      <div style={styles.boxHeader}>
        <div>
          <h3 style={styles.boxTitle}>{box.id}</h3>
          <p style={styles.mutedText}>Box Status: {box.status}</p>
          <p style={styles.mutedText}>Checkout: {box.checkout_status}</p>
          <p style={styles.mutedText}>Fulfillment: {box.fulfillment_status || "pending"}</p>
        </div>

        {box.checkout_status === "draft" && (
          <button style={styles.primaryButton} onClick={() => onAddToCart(box.id)}>
            Add to Cart
          </button>
        )}

        {box.checkout_status === "in_cart" && (
          <button style={styles.warningButton} onClick={() => onRemoveFromCart(box.id)}>
            Remove from Cart
          </button>
        )}
      </div>

      {box.checkout_status === "paid" && (
        <div style={styles.panel}>
          <p style={styles.successText}>Paid — waiting for fulfillment</p>

      {isAdmin && (
        <OperationsControls
          boxId={box.id}
          onUpdateFulfillmentStatus={onUpdateFulfillmentStatus}
        />
      )}

          {box.status !== "return_requested" && (
            <div style={styles.row}>
              <button style={styles.secondaryButton} onClick={() => onSetActiveManageBox(box.id)}>
                Manage Subscription
              </button>

              <button style={styles.dangerButton} onClick={() => onRequestReturn(box.id)}>
                Send Me My Bin
              </button>
            </div>
          )}

          {box.status === "return_requested" && (
            <p style={styles.warningText}>Return requested — preparing shipment</p>
          )}

          {activeManageBox === box.id && box.status !== "return_requested" && (
            <SubscriptionPanel
              boxId={box.id}
              insuranceEnabled={insuranceEnabledInputs[box.id]}
              declaredValue={declaredValueInputs[box.id]}
              onInsuranceEnabledChange={onInsuranceEnabledChange}
              onDeclaredValueChange={onDeclaredValueChange}
              onSaveInsurance={onSaveInsurance}
              onClose={() => onSetActiveManageBox(null)}
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
