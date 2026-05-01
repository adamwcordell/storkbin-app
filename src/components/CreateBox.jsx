import styles from "../styles/styles";

function CreateBox({ newBoxId, onBoxIdChange, onCreateBox }) {
  return (
    <div style={styles.cartCard}>
      <h2 style={styles.sectionTitle}>Create Bin</h2>
      <p style={styles.mutedText}>
        Start a new bin, add inventory, then save it to My Bins or add it to checkout.
      </p>

      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "12px" }}>
        <input
          style={{ ...styles.input, marginBottom: 0 }}
          placeholder="Bin number, like 001"
          value={newBoxId}
          onChange={(event) => onBoxIdChange(event.target.value)}
        />

        <button style={styles.primaryButton} onClick={onCreateBox}>
          Create Bin
        </button>
      </div>
    </div>
  );
}

export default CreateBox;
