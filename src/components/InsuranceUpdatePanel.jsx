import styles from "../styles/styles";

function InsuranceUpdatePanel({
  boxId,
  insuranceEnabled,
  declaredValue,
  onInsuranceEnabledChange,
  onDeclaredValueChange,
  onSaveInsurance,
  onBack,
}) {
  return (
    <div style={styles.subPanel}>
      <h4>Update Insurance</h4>

      <p style={styles.smallText}>
        Update your insurance coverage and declared value. This will affect your
        monthly billing.
      </p>

      <label style={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={!!insuranceEnabled}
          onChange={(e) =>
            onInsuranceEnabledChange(boxId, e.target.checked)
          }
        />
        Enable insurance
      </label>

      <input
        style={styles.input}
        type="number"
        min="0"
        placeholder="Declared value"
        value={declaredValue || ""}
        onChange={(e) =>
          onDeclaredValueChange(boxId, e.target.value)
        }
      />

      <div style={styles.row}>
        <button
          style={styles.primaryButton}
          onClick={() => {
            onSaveInsurance(boxId);
            alert(
              "Insurance updated. Billing will reflect this change next cycle."
            );
          }}
        >
          Update Insurance
        </button>

        <button style={styles.secondaryButton} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

export default InsuranceUpdatePanel;