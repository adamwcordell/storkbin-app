import { Link } from "react-router-dom";
import styles from "../styles/styles";
import InventoryPanel from "../components/InventoryPanel";

function DraftBinSetup({ appData }) {
  const draftBins = appData.boxes.filter(
    (box) => box.checkout_status === "draft"
  );

  if (draftBins.length === 0) return null;

  return (
    <div style={styles.cartCard}>
      <h2 style={styles.sectionTitle}>Set Up New Bins</h2>
      <p style={styles.mutedText}>
        Add contents now, then save the bin to My Bins or add it to checkout.
      </p>

      <div style={{ display: "grid", gap: "14px", marginTop: "14px" }}>
        {draftBins.map((box) => {
          const boxItems = appData.items.filter((item) => item.box_id === box.id);
          const binLabel = box.box_number || box.id;

          return (
            <div key={box.id} style={draftCardStyle}>
              <div style={draftHeaderStyle}>
                <div>
                  <p style={styles.smallText}>Draft bin</p>
                  <h3 style={{ margin: 0 }}>Bin {binLabel}</h3>
                </div>

                <div style={styles.row}>
                  <Link style={linkButton} to="/bins">
                    Save to My Bins
                  </Link>

                  <button
                    style={styles.primaryButton}
                    onClick={() => appData.addToCart(box.id)}
                  >
                    Add to Checkout
                  </button>

                  <button
                    style={styles.warningButton}
                    onClick={() => appData.deleteDraftBox(box.id)}
                  >
                    Delete Draft
                  </button>
                </div>
              </div>

              <InventoryPanel
                box={box}
                boxItems={boxItems}
                itemName={appData.itemNames[box.id]}
                itemDescription={appData.itemDescriptions[box.id]}
                onItemNameChange={(boxId, value) =>
                  appData.setItemNames({ ...appData.itemNames, [boxId]: value })
                }
                onItemDescriptionChange={(boxId, value) =>
                  appData.setItemDescriptions({
                    ...appData.itemDescriptions,
                    [boxId]: value,
                  })
                }
                onItemImageChange={(boxId, file) =>
                  appData.setItemImages({ ...appData.itemImages, [boxId]: file })
                }
                onAddItem={appData.addItem}
                onDeleteItem={appData.deleteItem}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const draftCardStyle = {
  backgroundColor: "#F7F7F7",
  border: "1px solid #E5E5E5",
  borderRadius: "8px",
  padding: "16px",
};

const draftHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "16px",
  marginBottom: "12px",
};

const linkButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#E5E5E5",
  color: "#333333",
  textDecoration: "none",
  border: "none",
  padding: "10px 14px",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: 500,
};

export default DraftBinSetup;
