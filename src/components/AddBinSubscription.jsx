import styles from "../styles/styles";

function AddBinSubscription({ plans = [], onSelectPlan }) {
  if (!plans.length) {
    return (
      <div style={styles.cartCard}>
        <h2 style={styles.sectionTitle}>Add Bin Subscription</h2>
        <p style={styles.warningText}>
          Subscription options are not loaded yet. Refresh once if this does not update.
        </p>
      </div>
    );
  }

  return (
    <div style={styles.cartCard}>
      <h2 style={styles.sectionTitle}>Add Bin Subscription</h2>
      <p style={styles.mutedText}>
        Choose how many empty bins you want delivered. You can add inventory after your bins arrive.
      </p>

      <div style={planGridStyle}>
        {plans.map((plan) => (
          <div key={plan.id} style={planCardStyle}>
            <div style={planHeaderStyle}>
              <div>
                <p style={styles.smallText}>{plan.subtitle}</p>
                <h3 style={planTitleStyle}>{plan.name}</h3>
              </div>

              {plan.badge && <span style={badgeStyle}>{plan.badge}</span>}
            </div>

            <div style={priceStyle}>${plan.monthlyRate}/month</div>
            <p style={styles.smallText}>
              {plan.binCount === 1
                ? "$13/month"
                : `$13/bin · ${plan.binCount} bins`}
            </p>

            <div style={lineListStyle}>
              <div style={lineStyle}>
                <span>Setup fee</span>
                <strong>${plan.setupFee}</strong>
              </div>
              <div style={lineStyle}>
                <span>Empty bin delivery</span>
                <strong>Free</strong>
              </div>
              <div style={lineStyle}>
                <span>Return shipping</span>
                <strong>
                  {plan.returnShippingDiscountPercent > 0
                    ? `${plan.returnShippingDiscountPercent}% off`
                    : "Customer pays"}
                </strong>
              </div>
            </div>

            <button
              style={{ ...styles.primaryButton, width: "100%", marginTop: "16px" }}
              onClick={() => onSelectPlan?.(plan.id)}
            >
              Add {plan.name}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const planGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "14px",
  marginTop: "16px",
};

const planCardStyle = {
  backgroundColor: "#F7F7F7",
  border: "1px solid #E5E5E5",
  borderRadius: "10px",
  padding: "18px",
};

const planHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
};

const planTitleStyle = {
  margin: "4px 0 0 0",
  fontSize: "22px",
  fontWeight: 600,
};

const badgeStyle = {
  backgroundColor: "#D88C7A",
  color: "#FFFFFF",
  borderRadius: "999px",
  padding: "5px 9px",
  fontSize: "12px",
  fontWeight: 600,
};

const priceStyle = {
  marginTop: "16px",
  fontSize: "26px",
  fontWeight: 700,
  color: "#333333",
};

const lineListStyle = {
  display: "grid",
  gap: "8px",
  marginTop: "14px",
};

const lineStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  fontSize: "14px",
};

export default AddBinSubscription;
