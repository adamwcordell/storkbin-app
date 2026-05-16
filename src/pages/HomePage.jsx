import { useState } from "react";
import { Link } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader";
import { colors } from "../styles/styles";
import { BRAND_TAGLINE } from "../config/brand";
import {
  ANNUAL_PREPAY_BILLED_MONTHS,
  BILLING_CYCLES,
  STORAGE_BIN_OUTSIDE_LABEL,
  SUBSCRIPTION_PLANS,
  getPlanBillingSummary,
} from "../config/subscriptionPlans";

const page = {
  fontFamily: "'Inter', system-ui, sans-serif",
  color: colors.charcoal,
  background: colors.background,
  minHeight: "100vh",
};

const section = {
  maxWidth: "1040px",
  margin: "0 auto",
  padding: "48px 22px",
};

const hero = {
  ...section,
  paddingTop: "40px",
  paddingBottom: "64px",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "clamp(32px, 5vw, 56px)",
  alignItems: "center",
};

const h1 = {
  margin: 0,
  fontSize: "clamp(2.35rem, 4.8vw, 3.15rem)",
  fontWeight: 700,
  letterSpacing: "-0.035em",
  lineHeight: 1.12,
  color: colors.charcoal,
};

const lead = {
  margin: "16px 0 0",
  fontSize: "clamp(17px, 1.9vw, 19px)",
  lineHeight: 1.55,
  color: colors.gray,
  maxWidth: "36em",
};

const btnRow = { display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "22px" };

const btnPrimary = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 22px",
  borderRadius: "10px",
  border: "none",
  background: colors.primary,
  color: colors.white,
  fontWeight: 600,
  fontSize: "15px",
  cursor: "pointer",
  textDecoration: "none",
};

const btnSecondary = {
  ...btnPrimary,
  background: colors.white,
  color: colors.charcoal,
  border: `1px solid ${colors.lightGray}`,
};

const homePlanGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
  gap: "18px",
  alignItems: "stretch",
};

function homePlanBorder(emphasis) {
  if (emphasis === "featured") {
    return { border: "2px solid rgba(122, 157, 122, 0.42)" };
  }
  if (emphasis === "premium") {
    return { border: "1px solid #B8CFB8" };
  }
  return { border: `1px solid ${colors.lightGray}` };
}

function homePlanCardStyle(emphasis) {
  const base = {
    textAlign: "left",
    borderRadius: "16px",
    backgroundColor: colors.white,
    padding: "18px 18px 20px",
    display: "flex",
    flexDirection: "column",
    outline: "none",
    transition: "box-shadow 0.2s ease, border-color 0.2s ease, transform 0.2s ease",
    ...homePlanBorder(emphasis),
  };
  if (emphasis === "featured") {
    return {
      ...base,
      padding: "22px 20px 24px",
      boxShadow: "0 14px 44px rgba(0,0,0,0.1), 0 0 0 1px rgba(122, 157, 122, 0.45)",
      transform: "translateY(-2px)",
      zIndex: 1,
    };
  }
  if (emphasis === "premium") {
    return {
      ...base,
      background: "linear-gradient(165deg, #FFFFFF 0%, #F6FAF6 48%, #EDF4ED 100%)",
      boxShadow: "0 10px 36px rgba(51, 85, 51, 0.1)",
    };
  }
  return {
    ...base,
    boxShadow: "0 6px 22px rgba(0,0,0,0.07)",
  };
}

const homeBadgeFeatured = {
  display: "inline-block",
  backgroundColor: colors.accent,
  color: colors.white,
  borderRadius: "999px",
  padding: "5px 11px",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const homeBadgePremium = {
  display: "inline-block",
  backgroundColor: colors.primaryDark,
  color: colors.white,
  borderRadius: "999px",
  padding: "5px 11px",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const homeBadgePlaceholder = {
  display: "inline-block",
  minHeight: "22px",
  visibility: "hidden",
  fontSize: "11px",
};

const homePlanSubtitle = {
  margin: "8px 0 0 0",
  fontSize: "20px",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: colors.charcoal,
};

const homePlanNameMeta = {
  margin: "4px 0 0 0",
  fontSize: "13px",
  fontWeight: 600,
  color: colors.gray,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const homeBinSizeLine = {
  margin: "10px 0 0 0",
  fontSize: "13px",
  lineHeight: 1.45,
  color: colors.charcoal,
  fontWeight: 600,
};

const homePriceBlock = {
  marginTop: "14px",
  paddingBottom: "12px",
  borderBottom: `1px solid ${colors.lightGray}`,
};

const homePriceMain = {
  margin: 0,
  fontSize: "28px",
  fontWeight: 700,
  color: colors.charcoal,
  letterSpacing: "-0.03em",
};

const homePricePerBin = {
  margin: "8px 0 0 0",
  fontSize: "16px",
  fontWeight: 700,
  color: colors.primaryDark,
  letterSpacing: "-0.01em",
};

const homePriceMath = {
  margin: "4px 0 0 0",
  fontSize: "12px",
  color: colors.gray,
  lineHeight: 1.4,
};

const homeStartupRow = {
  margin: "12px 0 0 0",
  fontSize: "14px",
  color: colors.charcoal,
};

const homeFeeNote = {
  margin: "8px 0 0 0",
  fontSize: "12px",
  lineHeight: 1.45,
  color: colors.gray,
  fontStyle: "italic",
};

const homeAnnualCallout = {
  marginTop: "12px",
  padding: "10px 12px",
  borderRadius: "10px",
  backgroundColor: "rgba(143, 175, 143, 0.18)",
  border: "1px solid rgba(122, 157, 122, 0.45)",
};

const homeAnnualCalloutTitle = {
  margin: "0 0 4px 0",
  fontSize: "13px",
  fontWeight: 700,
  color: colors.primaryDark,
  letterSpacing: "0.02em",
};

const homeAnnualCalloutBody = {
  margin: 0,
  fontSize: "12px",
  lineHeight: 1.45,
  color: colors.gray,
};

const homeValueSummary = {
  margin: "12px 0 0 0",
  fontSize: "14px",
  lineHeight: 1.5,
  color: colors.gray,
};

const homeCheckoutLine = {
  margin: "12px 0 0 0",
  fontSize: "13px",
  lineHeight: 1.45,
  color: colors.gray,
};

const stepCard = {
  background: colors.white,
  borderRadius: "12px",
  padding: "18px",
  border: `1px solid ${colors.lightGray}`,
  textAlign: "left",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
};

const sectionHeading = {
  margin: "0 0 8px",
  fontSize: "26px",
  fontWeight: 700,
  color: colors.charcoal,
  lineHeight: 1.2,
};

const faqItem = {
  padding: "16px 0",
  borderBottom: `1px solid ${colors.lightGray}`,
};

const warehouseHeroImageSrc = `${import.meta.env.BASE_URL}StorkBin%20Warehouse.png`;

/** ~30% larger than the original 280px art; caps on small viewports. */
const heroWarehouseImgStyle = {
  display: "block",
  width: "100%",
  maxWidth: "min(100%, 384px)",
  height: "auto",
  objectFit: "contain",
};

function HeroGraphic() {
  return (
    <div
      style={{
        borderRadius: "18px",
        background: `linear-gradient(160deg, ${colors.white} 0%, rgba(143,175,143,0.1) 52%, ${colors.white} 100%)`,
        border: `1px solid ${colors.lightGray}`,
        padding: "clamp(28px, 4vw, 40px) clamp(22px, 3.5vw, 36px) clamp(30px, 4vw, 42px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: "clamp(20px, 3vw, 28px)",
        boxSizing: "border-box",
        maxWidth: "440px",
        marginLeft: "auto",
        marginRight: "auto",
      }}
    >
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "center",
          padding: "4px 0 0",
        }}
      >
        <img
          src={warehouseHeroImageSrc}
          alt="StorkBin warehouse shelves with storage bins"
          width={384}
          height={233}
          style={heroWarehouseImgStyle}
          loading="eager"
          decoding="async"
        />
      </div>
      <p
        style={{
          margin: 0,
          fontSize: "clamp(15px, 1.55vw, 16px)",
          color: colors.gray,
          textAlign: "left",
          maxWidth: "400px",
          width: "100%",
          lineHeight: 1.58,
          alignSelf: "center",
          paddingTop: "2px",
        }}
      >
        <strong style={{ color: colors.charcoal }}>Unlimited returns.</strong> Request bins back as often as you need,
        shipped to any U.S. address you choose.
      </p>
    </div>
  );
}

function HomePage() {
  const [billingCycle, setBillingCycle] = useState(BILLING_CYCLES.MONTHLY);

  const workSteps = [
    {
      n: "1",
      t: "Pick a plan",
      d: (
        <>
          <strong style={{ color: colors.charcoal }}>1, 2, or 4 bins.</strong> Monthly billing or annual prepay (11
          months paid, 12th month on us).
        </>
      ),
    },
    {
      n: "2",
      t: "Empty bins arrive",
      d: (
        <>
          <strong style={{ color: colors.charcoal }}>First starter shipment included</strong> — we send empty
          containers so you can start packing.
        </>
      ),
    },
    {
      n: "3",
      t: "Pack & ship to storage",
      d: (
        <>
          <strong style={{ color: colors.charcoal }}>Use the prepaid label.</strong> Track each bin live. Add item
          names, photos, and notes per bin so you know what is inside.
        </>
      ),
    },
    {
      n: "4",
      t: "Request bins back anytime",
      d: (
        <>
          <strong style={{ color: colors.charcoal }}>Ships to any U.S. address you pick.</strong> Pay shipping whenever
          bins move; no cap on how often you request access.
        </>
      ),
    },
  ];

  return (
    <div className="home-marketing-page" style={page}>
      <PublicSiteHeader />
      <main style={{ textAlign: "left" }}>
        <section style={hero}>
          <div>
            <h1 style={h1}>Storage that comes to you.</h1>
            <p style={lead}>
              <strong style={{ color: colors.charcoal }}>Durable bins to your door.</strong>{" "}
              <strong style={{ color: colors.charcoal }}>Pack</strong> at your pace,{" "}
              <strong style={{ color: colors.charcoal }}>ship to our warehouse</strong> for secure storage, then{" "}
              <strong style={{ color: colors.charcoal }}>request them back</strong> whenever you need—
              <strong style={{ color: colors.charcoal }}>anywhere in the U.S., as often as you want.</strong>{" "}
              <strong style={{ color: colors.charcoal }}>First starter shipment included.</strong> Shipping applies only
              when bins move to or from storage.
            </p>
            <div style={btnRow}>
              <Link to="/signup" style={btnPrimary}>
                Get started
              </Link>
              <a href="#how-it-works" style={btnSecondary}>
                See how it works
              </a>
            </div>
          </div>
          <HeroGraphic />
        </section>

        <section id="how-it-works" style={{ ...section, paddingTop: "12px" }}>
          <h2 style={sectionHeading}>How it works</h2>
          <p style={{ margin: "0 0 22px", color: colors.gray, maxWidth: "48em", lineHeight: 1.5 }}>
            <strong style={{ color: colors.charcoal }}>Four steps:</strong> receive → pack → store → retrieve. You
            control the timeline.
          </p>
          <div className="home-how-grid">
            {workSteps.map((s) => (
              <div key={s.n} style={stepCard}>
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "10px",
                    background: "rgba(143,175,143,0.25)",
                    color: colors.primaryDark,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "8px",
                  }}
                >
                  {s.n}
                </div>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: colors.charcoal, letterSpacing: "-0.02em" }}>
                  {s.t}
                </h3>
                <p style={{ margin: "8px 0 0", fontSize: "14px", color: colors.gray, lineHeight: 1.5, textAlign: "left" }}>{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" style={{ ...section, background: colors.white, borderTop: `1px solid ${colors.lightGray}`, borderBottom: `1px solid ${colors.lightGray}` }}>
          <h2 style={sectionHeading}>Pricing & plans</h2>
          <p style={{ margin: "0 0 18px", color: colors.gray, maxWidth: "48em", lineHeight: 1.55 }}>
            <strong style={{ color: colors.charcoal }}>First empty-bin delivery:</strong> prepaid shipping included.{" "}
            <strong style={{ color: colors.charcoal }}>After that:</strong> pay shipping whenever bins move (unlimited
            requests).
          </p>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "22px" }}>
            <div
              style={{
                display: "inline-flex",
                border: `1px solid ${colors.lightGray}`,
                borderRadius: "999px",
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => setBillingCycle(BILLING_CYCLES.MONTHLY)}
                style={{
                  border: "none",
                  padding: "9px 18px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "13px",
                  background: billingCycle === BILLING_CYCLES.MONTHLY ? colors.primary : colors.white,
                  color: billingCycle === BILLING_CYCLES.MONTHLY ? colors.white : colors.gray,
                }}
              >
                Monthly billing
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle(BILLING_CYCLES.ANNUAL)}
                style={{
                  border: "none",
                  padding: "9px 18px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "13px",
                  background: billingCycle === BILLING_CYCLES.ANNUAL ? colors.primary : colors.white,
                  color: billingCycle === BILLING_CYCLES.ANNUAL ? colors.white : colors.gray,
                }}
              >
                Annual prepay (1 mo. free)
              </button>
            </div>
          </div>
          {billingCycle === BILLING_CYCLES.ANNUAL ? (
            <p style={{ margin: "0 0 18px", fontSize: "14px", color: colors.primaryDark, textAlign: "center", maxWidth: "40em", marginLeft: "auto", marginRight: "auto" }}>
              Annual: pay for <strong>{ANNUAL_PREPAY_BILLED_MONTHS} months</strong> upfront — the 12th month is included at no extra storage charge versus twelve separate monthly payments.
            </p>
          ) : null}
          <div style={homePlanGrid}>
            {SUBSCRIPTION_PLANS.map((plan) => {
              const summary = getPlanBillingSummary(plan, billingCycle);
              const m = plan.marketing || {};
              const emphasis = m.emphasis || "standard";
              const isAnnual = billingCycle === BILLING_CYCLES.ANNUAL;
              const perBin = plan.monthlyRatePerBin;
              return (
                <div key={plan.id} style={homePlanCardStyle(emphasis)}>
                  <div>
                    {plan.badge ? (
                      <span style={emphasis === "featured" ? homeBadgeFeatured : homeBadgePremium}>{plan.badge}</span>
                    ) : (
                      <span style={homeBadgePlaceholder}> </span>
                    )}
                    <h3 style={homePlanSubtitle}>{plan.subtitle}</h3>
                    <p style={homePlanNameMeta}>{plan.name}</p>
                    <p style={homeBinSizeLine}>
                      Bin size (each):{" "}
                      <span style={{ fontWeight: 700, color: colors.charcoal }}>{STORAGE_BIN_OUTSIDE_LABEL}</span>
                    </p>
                  </div>

                  <div style={homePriceBlock}>
                    <p style={homePriceMain}>${plan.monthlyRate}/month</p>
                    <p style={homePricePerBin}>${perBin}/bin/month</p>
                    <p style={homePriceMath}>
                      {plan.binCount} bin{plan.binCount === 1 ? "" : "s"} × ${perBin}/mo = ${plan.monthlyRate}/mo storage
                    </p>
                    <p style={homeStartupRow}>
                      {Number(plan.setupFee) === 0 ? (
                        <>
                          <span style={{ fontWeight: 700, color: colors.primaryDark }}>No startup fee</span>
                          <span style={{ color: colors.gray, fontWeight: 500 }}> · $0 one-time</span>
                        </>
                      ) : (
                        <>
                          <span style={{ fontWeight: 700 }}>${plan.setupFee}</span>
                          <span style={{ color: colors.gray, fontWeight: 500 }}> one-time startup fee</span>
                        </>
                      )}
                    </p>
                    {m.feeNote ? <p style={homeFeeNote}>{m.feeNote}</p> : null}
                  </div>

                  {isAnnual ? (
                    <div style={homeAnnualCallout} role="status">
                      <p style={homeAnnualCalloutTitle}>Annual prepay · 1 month free</p>
                      <p style={homeAnnualCalloutBody}>
                        Pay {ANNUAL_PREPAY_BILLED_MONTHS} months upfront — we cover the 12th. You save{" "}
                        <strong style={{ color: colors.charcoal }}>${plan.monthlyRate}</strong> versus twelve separate
                        monthly payments on this plan.
                      </p>
                    </div>
                  ) : null}

                  {m.valueSummary ? <p style={homeValueSummary}>{m.valueSummary}</p> : null}

                  <p style={homeCheckoutLine}>
                    <strong style={{ color: colors.charcoal }}>Due at checkout:</strong> ${summary.dueToday} (
                    {Number(plan.setupFee) === 0 ? "no startup" : `$${plan.setupFee} startup`} +{" "}
                    {isAnnual ? (
                      <>{ANNUAL_PREPAY_BILLED_MONTHS} months storage prepay</>
                    ) : (
                      <>first month storage</>
                    )}
                    )
                  </p>

                  <Link
                    to={`/signup?plan=${encodeURIComponent(plan.id)}&billing=${encodeURIComponent(billingCycle)}`}
                    style={{
                      ...btnPrimary,
                      marginTop: "14px",
                      textAlign: "center",
                      ...(emphasis === "featured" ? { boxShadow: "0 4px 14px rgba(143, 175, 143, 0.45)" } : null),
                    }}
                  >
                    Get started — {plan.subtitle}
                  </Link>
                </div>
              );
            })}
          </div>
        </section>

        <section style={section}>
          <h2 style={sectionHeading}>Trust & logistics</h2>
          <ul
            style={{
              color: colors.gray,
              lineHeight: 1.6,
              maxWidth: "48em",
              fontSize: "15px",
              textAlign: "left",
              listStylePosition: "outside",
              paddingLeft: "1.25em",
            }}
          >
            <li style={{ marginBottom: "10px" }}>
              <strong style={{ color: colors.charcoal }}>Unlimited returns</strong> to any U.S. address you choose.
            </li>
            <li style={{ marginBottom: "10px" }}>
              <strong style={{ color: colors.charcoal }}>Live status</strong> on every bin in your account.
            </li>
            <li style={{ marginBottom: "10px" }}>
              <strong style={{ color: colors.charcoal }}>Prepaid labels + tracking</strong> on every move.
            </li>
            <li>
              <strong style={{ color: colors.charcoal }}>We store;</strong> you decide when bins ship again.
            </li>
          </ul>
        </section>

        <section id="faq" style={{ ...section, paddingBottom: "64px" }}>
          <h2 style={{ ...sectionHeading, margin: "0 0 18px" }}>FAQ</h2>
          <div style={{ textAlign: "left" }}>
            <div style={faqItem}>
              <strong style={{ color: colors.charcoal }}>Do I keep the bins?</strong>
              <p style={{ margin: "8px 0 0", color: colors.gray }}>Yes — bins are yours to keep after service ends.</p>
            </div>
            <div style={faqItem}>
              <strong style={{ color: colors.charcoal }}>Who pays shipping?</strong>
              <p style={{ margin: "8px 0 0", color: colors.gray }}>
                First empty-bin delivery: prepaid. After that, you pay carrier shipping whenever bins move—no limit on
                how often, any U.S. address each time.
              </p>
            </div>
            <div style={faqItem}>
              <strong style={{ color: colors.charcoal }}>What if my address looks wrong at checkout?</strong>
              <p style={{ margin: "8px 0 0", color: colors.gray }}>
                Checkout runs quick checks so bins route cleanly; you can fix typos or apartment details before you pay.
              </p>
            </div>
            <div style={{ ...faqItem, borderBottom: "none" }}>
              <strong style={{ color: colors.charcoal }}>Where do I log in?</strong>
              <p style={{ margin: "8px 0 0", color: colors.gray }}>
                <Link to="/login">Log in here</Link> — admins with configured emails still land in the admin tools after sign-in.
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer
        style={{
          textAlign: "center",
          padding: "24px",
          fontSize: "13px",
          color: colors.gray,
          borderTop: `1px solid ${colors.lightGray}`,
          background: colors.white,
        }}
      >
        © {new Date().getFullYear()} StorkBin · {BRAND_TAGLINE}
      </footer>
    </div>
  );
}

export default HomePage;
