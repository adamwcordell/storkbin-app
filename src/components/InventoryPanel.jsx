import styles from "../styles/styles";

function InventoryPanel({
  box,
  boxItems,
  itemName,
  itemDescription,
  onItemNameChange,
  onItemDescriptionChange,
  onItemImageChange,
  onAddItem,
  onDeleteItem,
}) { 
   if (box.checkout_status !== "draft" && box.status !== "at_customer") {
    return null;
  }
  return (
    <>
      {(box.status === "at_customer" || box.checkout_status === "draft") && (
        <div style={styles.panel}>
          <h4>Add Inventory Item</h4>

          <input
            style={styles.input}
            placeholder="Item name"
            value={itemName || ""}
            onChange={(e) => onItemNameChange(box.id, e.target.value)}
          />

          <textarea
            style={styles.textarea}
            placeholder="Description"
            value={itemDescription || ""}
            onChange={(e) => onItemDescriptionChange(box.id, e.target.value)}
          />

          <input
            style={styles.fileInput}
            type="file"
            accept="image/*"
            onChange={(e) => onItemImageChange(box.id, e.target.files && e.target.files[0])}          />

          <button style={styles.primaryButton} onClick={() => onAddItem(box.id)}>
            Add Item
          </button>
        </div>
      )}

      <div style={styles.panel}>
        <h4>Inventory</h4>

        {boxItems.length === 0 && <p style={styles.mutedText}>No items added yet.</p>}

        {boxItems.map((item) => (
          <div key={item.id} style={styles.itemCard}>
            <strong>{item.name}</strong>

            {item.description && <p>{item.description}</p>}

            {item.image_url && <img src={item.image_url} alt={item.name} style={styles.itemImage} />}

            {box.status === "at_customer" && (
              <button
                style={styles.dangerButton}
                onClick={() => onDeleteItem(item.id, box.status)}
              >
                Delete Item
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export default InventoryPanel;
