import { useState } from "react";
import styles from "../styles/styles";
import {
  ANNUAL_PREPAY_BILLED_MONTHS,
  BILLING_CYCLES,
  STORAGE_BIN_OUTSIDE_LABEL,
} from "../config/subscriptionPlans";

const HOW_STORKBIN_WORKS_STEPS = [
  { icon: "📦", title: "We ship empty bins to your door", detail: "No loading a car or visiting a facility." },
  { icon: "🏠", title: "You pack from home", detail: "On your timeline, with everything steps away." },
  { icon: "🏢", title: "We store them securely until you need them back", detail: "Climate-minded storage without a second lease." },
];

const INCLUDED_WITH_EVERY_PLAN = [
  "Free empty-bin delivery",
  "Secure long-term storage",
  "No trips to a storage unit",
  "Customer keeps bins after cancellation",
  "Pay shipping only when requesting bins back",
  "Optional annual prepay with 1 month free",
];

const defaultMarketing = {
  valueSummary: "",
  benefitBullets: [],
  ctaLabel: "Add to cart",
  emphasis: "standard",
  feeNote: "",
};

function getMarketing(plan) {
  return { ...defaultMarketing, ...(plan?.marketing || {}) };
}

function AddBinSubscription({ plans = [], onSelectPlan }) {
  const [billingCycle, setBillingCycle] = useState(BILLING_CYCLES.MONTHLY);

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

  const isAnnual = billingCycle === BILLING_CYCLES.ANNUAL;

  const addPlan = (planId) => {
    onSelectPlan?.(planId, { billingCycle });
  };

  return (
    <div style={styles.cartCard}>
      <header style={headerCenterStyle}>
        <h2 style={{ ...styles.sectionTitle, marginBottom: "8px", textAlign: "center" }}>Choose your storage</h2>
        <p
          style={{
            ...styles.mutedText,
            margin: "0 auto",
            maxWidth: "640px",
            lineHeight: 1.55,
            textAlign: "center",
          }}
        >
          Reclaim closets and garage space without renting a truck or a remote unit. StorkBin brings
          empty bins to you, stores them safely, and ships them back when you are ready.
        </p>
      </header>

      <section style={howItWorksSectionStyle} aria-labelledby="how-storkbin-works-heading">
        <h3 id="how-storkbin-works-heading" style={subsectionTitleStyle}>
          How StorkBin Works
        </h3>
        <div style={howStepsGridStyle}>
          {HOW_STORKBIN_WORKS_STEPS.map((step) => (
            <div key={step.title} style={howStepCardStyle}>
              <div style={howStepIconWrapStyle} aria-hidden>
                <span style={howStepIconStyle}>{step.icon}</span>
              </div>
              <p style={howStepTitleStyle}>{step.title}</p>
              <p style={howStepDetailStyle}>{step.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <div style={billingToggleOuterStyle}>
        <div style={billingToggleWrapStyle}>
          <button
            type="button"
            style={{
              ...billingToggleButtonStyle,
              ...(billingCycle === BILLING_CYCLES.MONTHLY ? billingToggleButtonActiveStyle : null),
            }}
            onClick={() => setBillingCycle(BILLING_CYCLES.MONTHLY)}
          >
            Monthly billing
          </button>
          <button
            type="button"
            style={{
              ...billingToggleButtonStyle,
              ...(isAnnual ? billingToggleButtonActiveStyle : null),
            }}
            onClick={() => setBillingCycle(BILLING_CYCLES.ANNUAL)}
          >
            Annual prepay (1 month free)
          </button>
        </div>
      </div>

      <div style={planGridStyle} aria-label="Subscription plans">
        {plans.map((plan) => {
          const m = getMarketing(plan);
          const emphasis = m.emphasis || "standard";
          const cardStyles = {
            ...planCardBaseStyle,
            ...(emphasis === "featured" ? planCardFeaturedStyle : null),
            ...(emphasis === "premium" ? planCardPremiumStyle : null),
            ...planCardIdleBorder(emphasis),
          };

          return (
            <div key={plan.id} style={cardStyles}>
              <div style={planHeaderBlockStyle}>
                {plan.badge ? (
                  <span style={emphasis === "featured" ? badgeFeaturedStyle : badgePremiumStyle}>
                    {plan.badge}
                  </span>
                ) : (
                  <span style={badgePlaceholderStyle}> </span>
                )}
                <h3 style={planLabelStyle}>{plan.subtitle}</h3>
                <p style={planNameMetaStyle}>{plan.name}</p>
                <p style={planBinSizeStyle}>
                  Bin size (each): <strong>{STORAGE_BIN_OUTSIDE_LABEL}</strong>
                </p>
              </div>

              <div style={priceBlockStyle}>
                <p style={priceMainStyle}>${plan.monthlyRate}/month</p>
                <p style={pricePerBinStyle}>${plan.monthlyRatePerBin}/bin/month</p>
                <p style={priceMathStyle}>
                  {`${plan.binCount} bin${plan.binCount === 1 ? "" : "s"} × $${plan.monthlyRatePerBin}/mo = $${plan.monthlyRate}/mo storage`}
                </p>
                <p style={startupFeeStyle}>
                  {Number(plan.setupFee) === 0 ? (
                    <>
                      <span style={startupFeeHighlightStyle}>No startup fee</span>
                      <span style={startupFeeMutedStyle}> · $0 one-time</span>
                    </>
                  ) : (
                    <>
                      <span style={startupFeeMutedStyle}>$</span>
                      <span style={startupFeeNumberStyle}>{plan.setupFee}</span>
                      <span style={startupFeeMutedStyle}> one-time startup fee</span>
                    </>
                  )}
                </p>
                {m.feeNote ? <p style={feeNoteStyle}>{m.feeNote}</p> : null}
              </div>

              {isAnnual ? (
                <div style={annualPlanCalloutStyle} role="status">
                  <p style={annualPlanCalloutTitleStyle}>1 month free on annual</p>
                  <p style={annualPlanCalloutBodyStyle}>
                    Pay for {ANNUAL_PREPAY_BILLED_MONTHS} months upfront — we cover the 12th month. You save{" "}
                    <strong>${plan.monthlyRate}</strong> on this plan versus twelve separate monthly payments.
                  </p>
                </div>
              ) : null}

              {m.valueSummary ? <p style={valueSummaryStyle}>{m.valueSummary}</p> : null}

              {m.benefitBullets?.length ? (
                <ul style={benefitListStyle}>
                  {m.benefitBullets.map((line) => (
                    <li key={line} style={benefitItemStyle}>
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}

              <button
                type="button"
                style={{
                  ...styles.primaryButton,
                  ...planCtaButtonStyle,
                  ...(emphasis === "featured" ? planCtaFeaturedStyle : null),
                }}
                onClick={() => addPlan(plan.id)}
              >
                Add Plan to Cart
              </button>
            </div>
          );
        })}
      </div>

      <section style={includedSectionStyle} aria-labelledby="included-every-plan-heading">
        <h3 id="included-every-plan-heading" style={includedTitleStyle}>
          Included With Every Plan
        </h3>
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

function planCardIdleBorder(emphasis) {
  if (emphasis === "featured") {
    return { border: "2px solid rgba(122, 157, 122, 0.42)" };
  }
  if (emphasis === "premium") {
    return { border: "1px solid #B8CFB8" };
  }
  return { border: "1px solid #D9D9D9" };
}

const subsectionTitleStyle = {
  margin: "0 0 14px 0",
  fontSize: "18px",
  fontWeight: 600,
  color: "#333333",
  letterSpacing: "-0.02em",
};

const howItWorksSectionStyle = {
  marginTop: "22px",
  marginBottom: "20px",
  padding: "18px 18px 20px",
  borderRadius: "14px",
  backgroundColor: "#FAFAFA",
  border: "1px solid #EBEBEB",
};

const howStepsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "14px",
};

const howStepCardStyle = {
  backgroundColor: "#FFFFFF",
  borderRadius: "12px",
  padding: "14px 14px 16px",
  border: "1px solid #E5E5E5",
  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
};

const howStepIconWrapStyle = {
  width: "40px",
  height: "40px",
  borderRadius: "10px",
  backgroundColor: "rgba(143, 175, 143, 0.2)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: "10px",
};

const howStepIconStyle = {
  fontSize: "20px",
  lineHeight: 1,
};

const howStepTitleStyle = {
  margin: "0 0 6px 0",
  fontSize: "15px",
  fontWeight: 600,
  color: "#333333",
  lineHeight: 1.35,
};

const howStepDetailStyle = {
  margin: 0,
  fontSize: "13px",
  color: "#555555",
  lineHeight: 1.45,
};

const planGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
  gap: "18px",
  marginTop: "18px",
  alignItems: "stretch",
};

const planCardBaseStyle = {
  textAlign: "left",
  borderRadius: "16px",
  backgroundColor: "#FFFFFF",
  padding: "18px 18px 20px",
  display: "flex",
  flexDirection: "column",
  outline: "none",
  transition: "box-shadow 0.2s ease, border-color 0.2s ease, transform 0.2s ease",
};

const planCardFeaturedStyle = {
  padding: "22px 20px 24px",
  boxShadow: "0 14px 44px rgba(0,0,0,0.1), 0 0 0 1px rgba(122, 157, 122, 0.45)",
  transform: "translateY(-2px)",
  zIndex: 1,
};

const planCardPremiumStyle = {
  background: "linear-gradient(165deg, #FFFFFF 0%, #F6FAF6 48%, #EDF4ED 100%)",
  boxShadow: "0 10px 36px rgba(51, 85, 51, 0.1)",
};

const planHeaderBlockStyle = {
  minWidth: 0,
};

const planLabelStyle = {
  margin: "8px 0 0 0",
  fontSize: "20px",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "#333333",
};

const planNameMetaStyle = {
  margin: "4px 0 0 0",
  fontSize: "13px",
  fontWeight: 500,
  color: "#777777",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const planBinSizeStyle = {
  margin: "10px 0 0 0",
  fontSize: "13px",
  fontWeight: 600,
  color: "#333333",
  lineHeight: 1.45,
};

const badgeFeaturedStyle = {
  display: "inline-block",
  backgroundColor: "#D88C7A",
  color: "#FFFFFF",
  borderRadius: "999px",
  padding: "5px 11px",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const badgePremiumStyle = {
  display: "inline-block",
  backgroundColor: "#7A9D7A",
  color: "#FFFFFF",
  borderRadius: "999px",
  padding: "5px 11px",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const badgePlaceholderStyle = {
  display: "inline-block",
  minHeight: "22px",
  visibility: "hidden",
  fontSize: "11px",
};

const priceBlockStyle = {
  marginTop: "14px",
  paddingBottom: "12px",
  borderBottom: "1px solid #ECECEC",
};

const priceMainStyle = {
  margin: 0,
  fontSize: "28px",
  fontWeight: 700,
  color: "#333333",
  letterSpacing: "-0.03em",
};

const pricePerBinStyle = {
  margin: "8px 0 0 0",
  fontSize: "16px",
  fontWeight: 700,
  color: "#7A9D7A",
  letterSpacing: "-0.01em",
};

const priceMathStyle = {
  margin: "4px 0 0 0",
  fontSize: "12px",
  lineHeight: 1.4,
  color: "#666666",
};

const startupFeeStyle = {
  margin: "10px 0 0 0",
  fontSize: "14px",
  color: "#333333",
};

const startupFeeMutedStyle = {
  color: "#666666",
  fontWeight: 500,
};

const startupFeeNumberStyle = {
  fontWeight: 700,
  color: "#333333",
};

const startupFeeHighlightStyle = {
  fontWeight: 700,
  color: "#2F5F2F",
};

const feeNoteStyle = {
  margin: "10px 0 0 0",
  fontSize: "12px",
  lineHeight: 1.45,
  color: "#555555",
  fontStyle: "italic",
};

const valueSummaryStyle = {
  margin: "14px 0 0 0",
  fontSize: "14px",
  lineHeight: 1.5,
  color: "#444444",
};

const benefitListStyle = {
  listStyle: "none",
  padding: 0,
  margin: "14px 0 0 0",
  display: "grid",
  gap: "8px",
  flex: 1,
};

const benefitItemStyle = {
  fontSize: "13px",
  lineHeight: 1.45,
  color: "#333333",
  paddingLeft: "2px",
};

const planCtaButtonStyle = {
  width: "100%",
  marginTop: "16px",
  paddingTop: "12px",
  paddingBottom: "12px",
  fontSize: "15px",
  fontWeight: 600,
  borderRadius: "10px",
};

const planCtaFeaturedStyle = {
  boxShadow: "0 4px 14px rgba(143, 175, 143, 0.45)",
};

const headerCenterStyle = {
  marginBottom: "12px",
  textAlign: "center",
};

const billingToggleOuterStyle = {
  display: "flex",
  justifyContent: "center",
  marginTop: "6px",
  marginBottom: "4px",
};

const billingToggleWrapStyle = {
  display: "inline-flex",
  border: "1px solid #D9D9D9",
  borderRadius: "999px",
  overflow: "hidden",
};

const annualPlanCalloutStyle = {
  marginTop: "12px",
  padding: "10px 12px",
  borderRadius: "10px",
  backgroundColor: "rgba(143, 175, 143, 0.18)",
  border: "1px solid rgba(122, 157, 122, 0.45)",
};

const annualPlanCalloutTitleStyle = {
  margin: "0 0 4px 0",
  fontSize: "13px",
  fontWeight: 700,
  color: "#2F5F2F",
  letterSpacing: "0.02em",
};

const annualPlanCalloutBodyStyle = {
  margin: 0,
  fontSize: "12px",
  lineHeight: 1.45,
  color: "#444444",
};

const billingToggleButtonStyle = {
  border: "none",
  background: "#FFFFFF",
  padding: "9px 16px",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 600,
  color: "#555555",
};

const billingToggleButtonActiveStyle = {
  background: "#8FAF8F",
  color: "#FFFFFF",
};

const includedSectionStyle = {
  marginTop: "24px",
  padding: "18px 20px 20px",
  borderRadius: "14px",
  background: "linear-gradient(180deg, rgba(143, 175, 143, 0.12) 0%, rgba(255,255,255,0.95) 100%)",
  border: "1px solid rgba(122, 157, 122, 0.35)",
};

const includedTitleStyle = {
  margin: "0 0 12px 0",
  fontSize: "17px",
  fontWeight: 600,
  color: "#333333",
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
  color: "#333333",
};

const includedCheckStyle = {
  flexShrink: 0,
  color: "#7A9D7A",
  fontWeight: 700,
  marginTop: "1px",
};

export default AddBinSubscription;
