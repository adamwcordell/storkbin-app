import { useState } from "react";
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
  const [showAddForm, setShowAddForm] = useState(false);

  const canEditInventory =
    box.checkout_status === "draft" || box.status === "at_customer";

  const handleAddItem = () => {
    onAddItem(box.id);
    setShowAddForm(false);
  };

  return (
    <div style={styles.panel}>
      <h4>Inventory List</h4>

      {canEditInventory && !showAddForm && (
        <button
          style={styles.primaryButton}
          onClick={() => setShowAddForm(true)}
        >
          + Add Item
        </button>
      )}

      {canEditInventory && showAddForm && (
        <div style={styles.subPanel}>
          <h4>Add Inventory Item</h4>

          <input
            style={styles.input}
            placeholder="Item name"
            value={itemName || ""}
            onChange={(e) => onItemNameChange(box.id, e.target.value)}
          />

          <input
            style={styles.input}
            placeholder="Description"
            value={itemDescription || ""}
            onChange={(e) => onItemDescriptionChange(box.id, e.target.value)}
          />

          <input
            style={styles.fileInput}
            type="file"
            accept="image/*"
            onChange={(e) =>
              onItemImageChange(box.id, e.target.files && e.target.files[0])
            }
          />

          <div style={styles.row}>
            <button style={styles.primaryButton} onClick={handleAddItem}>
              Save Item
            </button>

            <button
              style={styles.secondaryButton}
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 2fr 90px 100px 120px",
          gap: "12px",
          alignItems: "center",
          fontWeight: "bold",
          borderBottom: "1px solid #E7E2DA",
          paddingBottom: "8px",
          marginTop: "14px",
          marginBottom: "8px",
        }}
      >
        <div>Item</div>
        <div>Description</div>
        <div>Image</div>
        <div>Status</div>
        <div>Action</div>
      </div>

      {boxItems.length === 0 && (
        <p style={styles.mutedText}>No items added yet.</p>
      )}

      {boxItems.map((item) => (
        <div
          key={item.id}
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 2fr 90px 100px 120px",
            gap: "12px",
            alignItems: "center",
            borderBottom: "1px solid #E7E2DA",
            padding: "10px 0",
          }}
        >
          <div>
            <strong>{item.name}</strong>
          </div>

          <div style={styles.smallText}>
            {item.description || "No description"}
          </div>

          <div>
            {item.image_url ? (
              <a href={item.image_url} target="_blank" rel="noreferrer">
                <img
                  src={item.image_url}
                  alt={item.name}
                  style={{
                    width: "64px",
                    height: "64px",
                    objectFit: "cover",
                    borderRadius: "8px",
                    border: "1px solid #E7E2DA",
                    cursor: "pointer",
                  }}
                />
              </a>
            ) : (
              <span style={styles.mutedText}>No image</span>
            )}
          </div>

          <div>
            <span
              style={{
                display: "inline-block",
                padding: "4px 8px",
                borderRadius: "999px",
                background: "#F4F1EC",
                border: "1px solid #D6D2CB",
                fontSize: "12px",
              }}
            >
              Packed
            </span>
          </div>

          <div>
            {box.status === "at_customer" ? (
              <button
                style={styles.dangerButton}
                onClick={() => onDeleteItem(item.id, box.status)}
              >
                Unpack Item
              </button>
            ) : (
              <span style={styles.mutedText}>Locked</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default InventoryPanel;