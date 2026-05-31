import { useState } from "react";
import { Link } from "react-router-dom";
import styles, { colors } from "../styles/styles";
import {
  ANNUAL_PREPAY_BILLED_MONTHS,
  BILLING_CYCLES,
  formatPlanPrice,
  NO_STARTUP_FEE_LABEL,
  STORAGE_BIN_OUTSIDE_LABEL,
} from "../config/subscriptionPlans";

const sectionTitleStyle = {
  margin: 0,
  fontSize: "clamp(1.65rem, 3.5vw, 2.1rem)",
  fontWeight: 800,
  letterSpacing: "-0.03em",
  color: colors.charcoal,
  textAlign: "center",
};

const sectionLeadStyle = {
  margin: "10px auto 0",
  fontSize: "16px",
  lineHeight: 1.5,
  color: colors.gray,
  maxWidth: "36em",
  textAlign: "center",
};

const planGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
  gap: "18px",
  textAlign: "left",
};

const btnGreen = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "14px 26px",
  borderRadius: "999px",
  border: "none",
  background: colors.primary,
  color: colors.white,
  fontWeight: 700,
  fontSize: "15px",
  textDecoration: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  lineHeight: 1.25,
};

function billingToggleStyle(active) {
  return {
    border: "none",
    padding: "10px 20px",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "13px",
    background: active ? colors.primary : colors.white,
    color: active ? colors.white : colors.gray,
    fontFamily: "inherit",
    lineHeight: 1.25,
    margin: 0,
    appearance: "none",
    WebkitAppearance: "none",
  };
}

/**
 * Shared plans & pricing block (homepage + customer dashboard).
 * @param {{ plans: Array, mode?: 'signup' | 'dashboard', onChoosePlan?: (planId: string, opts: { billingCycle: string }) => void }} props
 */
function SubscriptionPlanPricing({ plans = [], mode = "signup", onChoosePlan, title, lead }) {
  const [billingCycle, setBillingCycle] = useState(BILLING_CYCLES.MONTHLY);
  const isAnnual = billingCycle === BILLING_CYCLES.ANNUAL;
  const isDashboard = mode === "dashboard";
  const heading =
    title ?? (isDashboard ? "Add More Bins to Your Plan" : "Plans & Pricing");
  const subheading =
    lead ??
    (isDashboard ? "Choose a plan below to add storage bins to your account." : null);

  if (!plans.length) {
    return null;
  }

  return (
    <div
      className="subscription-plan-pricing"
      style={{
        fontFamily: isDashboard ? undefined : "'Inter', system-ui, sans-serif",
        color: colors.charcoal,
        textAlign: "center",
      }}
    >
      {isDashboard ? (
        <>
          <h2 style={{ ...styles.sectionTitle, marginBottom: "8px", textAlign: "center" }}>{heading}</h2>
          {subheading ? (
            <p style={{ ...styles.mutedText, margin: "0 auto 24px", textAlign: "center", maxWidth: "36em" }}>
              {subheading}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <h2 style={sectionTitleStyle}>{heading}</h2>
          {subheading ? (
            <p style={{ ...sectionLeadStyle, margin: "0 auto 24px" }}>{subheading}</p>
          ) : null}
        </>
      )}

      <div style={{ display: "flex", justifyContent: "center", marginBottom: "24px" }}>
        <div
          style={{
            display: "inline-flex",
            border: `1px solid ${colors.lightGray}`,
            borderRadius: "999px",
            overflow: "hidden",
            background: colors.white,
          }}
        >
          <button
            type="button"
            className="plan-pricing-toggle"
            onClick={() => setBillingCycle(BILLING_CYCLES.MONTHLY)}
            style={billingToggleStyle(billingCycle === BILLING_CYCLES.MONTHLY)}
          >
            Monthly
          </button>
          <button
            type="button"
            className="plan-pricing-toggle"
            onClick={() => setBillingCycle(BILLING_CYCLES.ANNUAL)}
            style={billingToggleStyle(billingCycle === BILLING_CYCLES.ANNUAL)}
          >
            Annual (1 mo. free)
          </button>
        </div>
      </div>

      <div style={planGridStyle}>
        {plans.map((plan) => {
          const annualStorageTotal = ANNUAL_PREPAY_BILLED_MONTHS * plan.monthlyRate;
          const featured = plan.marketing?.emphasis === "featured";

          return (
            <article
              key={plan.id}
              style={{
                borderRadius: "16px",
                padding: "20px",
                background: colors.white,
                border: featured ? `2px solid ${colors.primary}` : `1px solid ${colors.lightGray}`,
                boxShadow: featured ? "0 12px 40px rgba(122,157,122,0.2)" : "0 4px 18px rgba(0,0,0,0.06)",
              }}
            >
              {plan.badge ? (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    color: colors.white,
                    background: featured ? colors.accent : colors.primaryDark,
                    padding: "4px 10px",
                    borderRadius: "999px",
                  }}
                >
                  {plan.badge}
                </span>
              ) : null}
              <h3 style={{ margin: "10px 0 4px", fontSize: "22px", fontWeight: 700, color: colors.charcoal }}>
                {plan.subtitle}
              </h3>
              <p style={{ margin: 0, fontSize: "13px", color: colors.gray }}>{plan.name}</p>
              <p style={{ margin: "12px 0 0", fontSize: "28px", fontWeight: 800, color: colors.charcoal }}>
                {isAnnual
                  ? `$${formatPlanPrice(annualStorageTotal)}/year`
                  : `$${plan.monthlyRate}/mo`}
              </p>
              {isAnnual ? (
                <p style={{ margin: "6px 0 0", fontSize: "14px", fontWeight: 600, color: colors.primaryDark }}>
                  1 month free
                </p>
              ) : null}
              <p style={{ margin: "8px 0 0", fontSize: "14px", color: colors.gray }}>
                Bin size (each):{" "}
                <strong style={{ color: colors.charcoal }}>{STORAGE_BIN_OUTSIDE_LABEL}</strong>
              </p>
              <p style={{ margin: "8px 0 0", fontSize: "14px", color: colors.charcoal }}>
                {Number(plan.setupFee) === 0 ? (
                  <strong style={{ color: colors.primaryDark }}>{NO_STARTUP_FEE_LABEL}</strong>
                ) : (
                  <>
                    <strong>${plan.setupFee}</strong>
                    <span style={{ color: colors.gray, fontWeight: 500 }}> one-time startup fee</span>
                  </>
                )}
              </p>
              {mode === "dashboard" ? (
                <button
                  type="button"
                  style={{ ...btnGreen, marginTop: "16px", width: "100%", boxSizing: "border-box" }}
                  onClick={() => onChoosePlan?.(plan.id, { billingCycle })}
                >
                  Choose {plan.subtitle}
                </button>
              ) : (
                <Link
                  to={`/signup?plan=${encodeURIComponent(plan.id)}&billing=${encodeURIComponent(billingCycle)}`}
                  style={{ ...btnGreen, marginTop: "16px", width: "100%", boxSizing: "border-box" }}
                >
                  Choose {plan.subtitle}
                </Link>
              )}
            </article>
          );
        })}
      </div>

      {isAnnual ? (
        <p style={{ margin: "18px 0 0", textAlign: "center", fontSize: "13px", color: colors.gray }}>
          Annual: pay {ANNUAL_PREPAY_BILLED_MONTHS} months upfront — 12th month included.
        </p>
      ) : null}
    </div>
  );
}

export default SubscriptionPlanPricing;
