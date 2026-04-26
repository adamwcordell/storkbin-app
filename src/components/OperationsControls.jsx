import styles from "../styles/styles";

function OperationsControls({ boxId, onUpdateFulfillmentStatus }) {
  return (
    <div style={styles.subPanel}>
      <h4>Operations Test Controls</h4>
      <p style={styles.smallText}>These buttons simulate the warehouse/shipping workflow.</p>

      <div style={styles.row}>
        <button
          style={styles.secondaryButton}
          onClick={() =>
            onUpdateFulfillmentStatus(
              boxId,
              "bin_shipped_to_customer",
              "in_transit_to_customer"
            )
          }
        >
          Mark Bin Shipped to Customer
        </button>

        <button
          style={styles.secondaryButton}
          onClick={() => onUpdateFulfillmentStatus(boxId, "bin_with_customer", "at_customer")}
        >
          Mark Bin With Customer
        </button>

        <button
          style={styles.secondaryButton}
          onClick={() => onUpdateFulfillmentStatus(boxId, "stored", "stored")}
        >
          Mark Stored
        </button>
      </div>
    </div>
  );
}

export default OperationsControls;
