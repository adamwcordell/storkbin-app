import styles from "../styles/styles";

function CreateBox({ newBoxId, onBoxIdChange, onCreateBox }) {
  return (
    <div style={styles.createCard}>
      <h2 style={styles.sectionTitle}>Create a Bin</h2>

      <div style={styles.row}>
        <input
          style={styles.input}
          placeholder="Enter Box ID"
          value={newBoxId}
          onChange={(e) => onBoxIdChange(e.target.value)}
        />

        <button style={styles.primaryButton} onClick={onCreateBox}>
          Create Box
        </button>
      </div>
    </div>
  );
}

export default CreateBox;
