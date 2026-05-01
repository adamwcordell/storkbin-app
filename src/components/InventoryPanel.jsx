import { useState } from "react";
import styles from "../styles/styles";
import ImagePreviewModal from "./ImagePreviewModal";

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
  const [previewImage, setPreviewImage] = useState(null);

  const canEditInventory =
    box.status === "at_customer" || box.checkout_status === "draft";

  const binLabel = box.box_number || box.id;

  return (
    <div>
      <div style={headerRowStyle}>
        <div>
          <h4 style={{ margin: 0 }}>Inventory</h4>
          <p style={styles.smallText}>
            {boxItems.length === 0
              ? "No items added yet."
              : `${boxItems.length} item${boxItems.length === 1 ? "" : "s"} in this bin.`}
          </p>
        </div>
      </div>

      {canEditInventory && (
        <div style={addItemCardStyle}>
          <strong>Add item to Bin {binLabel}</strong>

          <div style={stackStyle}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Item name</span>
              <input
                style={inputStyle}
                placeholder="Item name"
                value={itemName || ""}
                onChange={(event) =>
                  onItemNameChange(box.id, event.target.value)
                }
              />
            </label>

            <label style={fieldStyle}>
              <span style={labelStyle}>Description</span>
              <input
                style={inputStyle}
                placeholder="Description optional"
                value={itemDescription || ""}
                onChange={(event) =>
                  onItemDescriptionChange(box.id, event.target.value)
                }
              />
            </label>

            <label style={fieldStyle}>
              <span style={labelStyle}>Image</span>
              <input
                style={fileInputStyle}
                type="file"
                accept="image/*"
                onChange={(event) =>
                  onItemImageChange(box.id, event.target.files?.[0] || null)
                }
              />
            </label>

            <button
              style={{ ...styles.primaryButton, width: "100%" }}
              onClick={() => onAddItem(box.id)}
            >
              Add Item
            </button>
          </div>

          <p style={{ ...styles.smallText, marginTop: "10px" }}>
            On your phone, the image picker should let you choose from photos or use the camera.
          </p>
        </div>
      )}

      {!canEditInventory && (
        <p style={styles.smallText}>
          Inventory is locked while this bin is not physically with you.
        </p>
      )}

      {boxItems.length > 0 && (
        <div style={listStyle}>
          {boxItems.map((item) => (
            <div key={item.id} style={itemRowStyle}>
              <div>
                <strong>{item.name}</strong>
                <p style={styles.smallText}>
                  {item.description || "No description"}
                </p>
              </div>

              <div style={actionsStyle}>
                {item.image_url ? (
                  <button
                    style={imageButtonStyle}
                    onClick={() =>
                      setPreviewImage({
                        url: item.image_url,
                        title: item.name || "Item image",
                      })
                    }
                  >
                    View Image
                  </button>
                ) : (
                  <span style={styles.smallText}>No image</span>
                )}

                <span style={statusBadgeStyle}>{item.status || "packed"}</span>

                {canEditInventory ? (
                  <button
                    style={styles.warningButton}
                    onClick={() =>
                      onDeleteItem(item.id, box.status, box.checkout_status)
                    }
                  >
                    Unpack
                  </button>
                ) : (
                  <span style={styles.smallText}>Locked</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ImagePreviewModal
        imageUrl={previewImage?.url}
        title={previewImage?.title}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
}

const headerRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
};

const addItemCardStyle = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #E5E5E5",
  borderRadius: "8px",
  padding: "16px",
  marginTop: "12px",
  maxWidth: "680px",
  marginLeft: "auto",
  marginRight: "auto",
};

const stackStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  marginTop: "12px",
};

const fieldStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const labelStyle = {
  color: "#555555",
  fontSize: "13px",
  fontWeight: 500,
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid #E5E5E5",
  backgroundColor: "#FFFFFF",
  color: "#333333",
  fontSize: "14px",
};

const fileInputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid #E5E5E5",
  backgroundColor: "#FFFFFF",
  color: "#333333",
  fontSize: "14px",
};

const listStyle = {
  marginTop: "12px",
  borderTop: "1px solid #E5E5E5",
};

const itemRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "16px",
  padding: "12px 0",
  borderBottom: "1px solid #E5E5E5",
  flexWrap: "wrap",
};

const actionsStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
};

const imageButtonStyle = {
  background: "none",
  border: "none",
  color: "#7A9D7A",
  cursor: "pointer",
  fontWeight: 600,
  padding: 0,
};

const statusBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: "999px",
  padding: "5px 9px",
  fontSize: "12px",
  fontWeight: 600,
  color: "#7A9D7A",
  backgroundColor: "rgba(143, 175, 143, 0.18)",
  border: "1px solid rgba(143, 175, 143, 0.35)",
};

export default InventoryPanel;
