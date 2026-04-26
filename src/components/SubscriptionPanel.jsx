import styles from "../styles/styles";

function SubscriptionPanel({
  boxId,
  insuranceEnabled,
  declaredValue,
  onInsuranceEnabledChange,
  onDeclaredValueChange,
  onSaveInsurance,
  onClose,
}) {
  return (
    <div style={styles.subPanel}>
      <h4>Subscription Settings</h4>

      <label style={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={!!insuranceEnabled}
          onChange={(e) => onInsuranceEnabledChange(boxId, e.target.checked)}
        />
        Enable insurance
      </label>

      <input
        style={styles.input}
        type="number"
        min="0"
        placeholder="Declared value"
        value={declaredValue || ""}
        onChange={(e) => onDeclaredValueChange(boxId, e.target.value)}
      />

      <div style={styles.row}>
        <button style={styles.primaryButton} onClick={() => onSaveInsurance(boxId)}>
          Save Changes
        </button>

        <button style={styles.secondaryButton} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export default SubscriptionPanel;
