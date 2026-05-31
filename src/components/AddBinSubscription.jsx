import styles, { colors } from "../styles/styles";
import SubscriptionPlanPricing from "./SubscriptionPlanPricing";

const HOW_IT_WORKS_CONDENSED = [
  { step: "1", title: "We deliver", detail: "Empty bins ship to your door." },
  { step: "2", title: "You pack", detail: "Fill them at home, on your schedule." },
  { step: "3", title: "We store", detail: "Send bins to us; request them back anytime." },
];

const INCLUDED_WITH_EVERY_PLAN = [
  "Free empty-bin delivery",
  "Secure long-term storage",
  "No trips to a storage unit",
  "Customer keeps bins after cancellation",
  "Pay shipping only when requesting bins back",
  "Optional annual prepay with 1 month free",
];

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
      <SubscriptionPlanPricing
        plans={plans}
        mode="dashboard"
        onChoosePlan={(planId, opts) => onSelectPlan?.(planId, opts)}
      />

      <section style={includedSectionStyle} aria-labelledby="included-every-plan-heading">
        <h3 id="included-every-plan-heading" style={includedTitleStyle}>
          How it works & what&apos;s included
        </h3>
        <ol style={howItWorksListStyle}>
          {HOW_IT_WORKS_CONDENSED.map((item) => (
            <li key={item.step} style={howItWorksItemStyle}>
              <span style={howItWorksStepStyle} aria-hidden>
                {item.step}
              </span>
              <span>
                <strong style={{ color: colors.charcoal }}>{item.title}</strong>
                {" — "}
                {item.detail}
              </span>
            </li>
          ))}
        </ol>
        <ul style={includedListStyle}>
          {INCLUDED_WITH_EVERY_PLAN.map((line) => (
            <li key={line} style={includedItemStyle}>
              <span style={includedCheckStyle} aria-hidden>
                ✓
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const includedSectionStyle = {
  marginTop: "28px",
  padding: "18px 20px 20px",
  borderRadius: "14px",
  background: "linear-gradient(180deg, rgba(143, 175, 143, 0.12) 0%, rgba(255,255,255,0.95) 100%)",
  border: "1px solid rgba(122, 157, 122, 0.35)",
  textAlign: "left",
};

const includedTitleStyle = {
  margin: "0 0 14px 0",
  fontSize: "17px",
  fontWeight: 600,
  color: colors.charcoal,
};

const howItWorksListStyle = {
  listStyle: "none",
  padding: 0,
  margin: "0 0 16px 0",
  display: "grid",
  gap: "10px",
  paddingBottom: "16px",
  borderBottom: `1px solid rgba(122, 157, 122, 0.25)`,
};

const howItWorksItemStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "flex-start",
  fontSize: "14px",
  lineHeight: 1.45,
  color: colors.gray,
};

const howItWorksStepStyle = {
  flexShrink: 0,
  width: "22px",
  height: "22px",
  borderRadius: "50%",
  background: colors.primary,
  color: colors.white,
  fontSize: "12px",
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const includedListStyle = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "grid",
  gap: "10px",
};

const includedItemStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "flex-start",
  fontSize: "14px",
  lineHeight: 1.45,
  color: colors.charcoal,
};

const includedCheckStyle = {
  flexShrink: 0,
  color: colors.primaryDark,
  fontWeight: 700,
  marginTop: "1px",
};

export default AddBinSubscription;
