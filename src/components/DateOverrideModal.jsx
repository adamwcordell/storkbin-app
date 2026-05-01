import { useState } from "react";
import styles from "../styles/styles";

function DateOverrideModal({ boxId, onCancel, onSubmit }) {
  const [dateInput, setDateInput] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const submitDate = () => {
    if (!dateInput) {
      setErrorMessage("Please choose a date.");
      return;
    }

    const overrideDate = new Date(`${dateInput}T00:00:00`);

    if (Number.isNaN(overrideDate.getTime())) {
      setErrorMessage("Invalid date. Please use YYYY-MM-DD format.");
      return;
    }

    onSubmit(dateInput);
  };

  return (
    <div style={modalOverlayStyle}>
      <div style={modalStyle}>
        <div style={modalHeaderStyle}>
          <div>
            <h3 style={{ margin: 0 }}>Override cancellation end date</h3>
            <p style={{ ...styles.smallText, marginTop: "6px" }}>
              Set the subscription end date for box {boxId}.
            </p>
          </div>

          <button style={styles.secondaryButton} onClick={onCancel}>
            Close
          </button>
        </div>

        <input
          style={styles.input}
          type="date"
          value={dateInput}
          onChange={(event) => setDateInput(event.target.value)}
        />

        {errorMessage && <p style={styles.warningText}>{errorMessage}</p>}

        <div style={modalFooterStyle}>
          <button style={styles.secondaryButton} onClick={onCancel}>
            Cancel
          </button>

          <button style={styles.primaryButton} onClick={submitDate}>
            Save End Date
          </button>
        </div>
      </div>
    </div>
  );
}

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  zIndex: 1000,
};

const modalStyle = {
  background: "#fff",
  borderRadius: "16px",
  padding: "20px",
  width: "min(520px, 100%)",
  boxShadow: "0 20px 50px rgba(0, 0, 0, 0.2)",
};

const modalHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "flex-start",
  marginBottom: "16px",
};

const modalFooterStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "12px",
  marginTop: "16px",
};

export default DateOverrideModal;
