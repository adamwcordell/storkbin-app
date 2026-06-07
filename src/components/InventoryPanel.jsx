import { useEffect, useRef, useState } from "react";
import styles from "../styles/styles";
import ImagePreviewModal from "./ImagePreviewModal";

const ADD_STEPS = { PHOTO: 1, NAME: 2, DETAILS: 3 };

function InventoryPanel({
  box,
  binLabel: binLabelProp,
  boxItems,
  itemName,
  itemDescription,
  itemImageFile,
  onItemNameChange,
  onItemDescriptionChange,
  onItemImageChange,
  onAddItem,
  onDeleteItem,
  scanFlow = false,
}) {
  const [previewImage, setPreviewImage] = useState(null);
  const [addStep, setAddStep] = useState(ADD_STEPS.PHOTO);
  const [savingItem, setSavingItem] = useState(false);
  const [addOpen, setAddOpen] = useState(() => boxItems.length === 0);
  const prevItemCount = useRef(boxItems.length);
  const photoInputRef = useRef(null);

  useEffect(() => {
    if (boxItems.length > prevItemCount.current) {
      setAddStep(ADD_STEPS.PHOTO);
      setAddOpen(false);
    }
    prevItemCount.current = boxItems.length;
  }, [boxItems.length]);

  const canEditInventory =
    box.status === "at_customer" || box.checkout_status === "draft";

  const binLabel = binLabelProp || box.box_number || box.id;

  const saveNewItem = async () => {
    if (savingItem) return;
    setSavingItem(true);
    try {
      const result = await onAddItem(box.id);
      if (result !== false) {
        setAddStep(ADD_STEPS.PHOTO);
      }
    } finally {
      setSavingItem(false);
    }
  };

  const handleAddWizardKeyDown = (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "TEXTAREA") return;
    e.preventDefault();
    if (addStep === ADD_STEPS.PHOTO) {
      setAddStep(ADD_STEPS.NAME);
    } else if (addStep === ADD_STEPS.NAME) {
      if (String(itemName || "").trim()) setAddStep(ADD_STEPS.DETAILS);
    } else if (addStep === ADD_STEPS.DETAILS) {
      void saveNewItem();
    }
  };

  const addCardStyle = addItemCardStyle;

  const itemList = boxItems.length > 0 && (
    <div style={scanFlow ? scanListStyle : listStyle}>
      {scanFlow && (
        <p style={{ ...styles.smallText, margin: "0 0 8px", fontWeight: 600, color: "#333333" }}>
          In this bin ({boxItems.length})
        </p>
      )}
      {boxItems.map((item) => (
        <div key={item.id} style={itemRowStyle} className="inventory-item-row">
          <div className="inventory-item-main">
            <strong>{item.name}</strong>
            <p style={styles.smallText}>{item.description || "No description"}</p>
          </div>

          <div style={actionsStyle} className="inventory-item-actions">
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
                onClick={() => onDeleteItem(item.id, box.status, box.checkout_status)}
              >
                Unpack item
              </button>
            ) : (
              <span style={styles.smallText}>Locked</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const addWizardBody = (
    <>
      <p style={{ ...styles.smallText, marginTop: 0, marginBottom: 0 }}>
        {addStep === ADD_STEPS.PHOTO
          ? scanFlow
            ? "Start with a photo, or skip if you prefer."
            : "Step 1 of 3 — photo first, then name, then notes."
          : `Step ${addStep} of 3 — photo first, then name, then notes.`}
      </p>

      <div style={stackStyle}>
        {addStep === ADD_STEPS.PHOTO && (
          <>
            <div style={fieldStyle}>
              <span style={labelStyle}>1. Item photo</span>
              <input
                ref={photoInputRef}
                style={hiddenFileInputStyle}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  onItemImageChange(box.id, file);
                  if (file) setAddStep(ADD_STEPS.NAME);
                }}
              />
              {itemImageFile ? (
                <p style={{ ...styles.smallText, margin: 0 }}>{itemImageFile.name}</p>
              ) : null}
            </div>
            <div style={wizardNavStyle} className="inventory-wizard-nav">
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => photoInputRef.current?.click()}
              >
                Add Photo
              </button>
              <button
                type="button"
                style={styles.primaryButton}
                onClick={() => {
                  onItemImageChange(box.id, null);
                  setAddStep(ADD_STEPS.NAME);
                }}
              >
                Skip photo
              </button>
            </div>
          </>
        )}

        {addStep === ADD_STEPS.NAME && (
          <>
            <label style={fieldStyle}>
              <span style={labelStyle}>2. Item name</span>
              <input
                style={inputStyle}
                placeholder="Item name"
                value={itemName || ""}
                onChange={(event) => onItemNameChange(box.id, event.target.value)}
              />
            </label>
            <div style={wizardNavStyle} className="inventory-wizard-nav">
              <button type="button" style={styles.secondaryButton} onClick={() => setAddStep(ADD_STEPS.PHOTO)}>
                Back
              </button>
              <button
                type="button"
                style={styles.primaryButton}
                disabled={!String(itemName || "").trim()}
                onClick={() => setAddStep(ADD_STEPS.DETAILS)}
              >
                Next
              </button>
            </div>
          </>
        )}

        {addStep === ADD_STEPS.DETAILS && (
          <>
            <label style={fieldStyle}>
              <span style={labelStyle}>3. Description / notes (optional)</span>
              <input
                style={inputStyle}
                placeholder="Description optional"
                value={itemDescription || ""}
                onChange={(event) => onItemDescriptionChange(box.id, event.target.value)}
              />
            </label>
            <div style={wizardNavStyle} className="inventory-wizard-nav">
              <button type="button" style={styles.secondaryButton} onClick={() => setAddStep(ADD_STEPS.NAME)}>
                Back
              </button>
              <button
                type="button"
                style={{ ...styles.primaryButton, flex: "1 1 auto" }}
                disabled={savingItem}
                onClick={() => void saveNewItem()}
              >
                {savingItem ? "Saving…" : "Save item"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );

  const addLabel = scanFlow ? "Add an item" : `Add item to Bin ${binLabel}`;

  const addForm = scanFlow ? (
    <details
      className="inventory-add-details"
      open={addOpen}
      onToggle={(event) => setAddOpen(event.currentTarget.open)}
    >
      <summary>{addLabel}</summary>
      <div
        className="inventory-add-body"
        role="group"
        aria-label="Add item wizard"
        onKeyDown={handleAddWizardKeyDown}
      >
        {addWizardBody}
      </div>
    </details>
  ) : (
    <div
      style={addCardStyle}
      role="group"
      aria-label="Add item wizard"
      onKeyDown={handleAddWizardKeyDown}
    >
      <strong>{addLabel}</strong>
      {addWizardBody}
    </div>
  );

  return (
    <div className={scanFlow ? "scan-inventory-panel" : undefined}>
      {scanFlow && itemList}

      {canEditInventory && addForm}

      {!canEditInventory && (
        <p style={styles.smallText}>
          Inventory is locked while this bin is not physically with you.
        </p>
      )}

      {!scanFlow && itemList}

      <ImagePreviewModal
        imageUrl={previewImage?.url}
        title={previewImage?.title}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
}

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

const wizardNavStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
  marginTop: "4px",
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

const hiddenFileInputStyle = {
  ...fileInputStyle,
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const scanListStyle = {
  marginTop: 0,
  marginBottom: "10px",
  borderTop: "none",
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
