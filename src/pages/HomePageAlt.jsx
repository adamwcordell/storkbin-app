/**
 * Alternate marketing homepage (TAXIBOX-inspired layout).
 * View at /home-alt — original stays at /
 * To swap defaults: in App.jsx point path="/" to HomePageAlt instead of HomePage.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader";
import { colors } from "../styles/styles";
import { BRAND_TAGLINE } from "../config/brand";
import { SUPPORT_EMAIL } from "../config/supportContact";
import {
  ANNUAL_PREPAY_BILLED_MONTHS,
  BILLING_CYCLES,
  STORAGE_BIN_OUTSIDE_LABEL,
  SUBSCRIPTION_PLANS,
  getPlanBillingSummary,
} from "../config/subscriptionPlans";

const wrap = {
  fontFamily: "'Inter', system-ui, sans-serif",
  color: colors.charcoal,
  background: colors.background,
  minHeight: "100vh",
};

const inner = { maxWidth: "1100px", margin: "0 auto", padding: "0 22px" };

const btnPrimary = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "14px 26px",
  borderRadius: "999px",
  border: "none",
  background: colors.white,
  color: colors.primaryDark,
  fontWeight: 700,
  fontSize: "15px",
  textDecoration: "none",
  cursor: "pointer",
};

const btnOutline = {
  ...btnPrimary,
  background: "transparent",
  color: colors.white,
  border: `2px solid rgba(255,255,255,0.85)`,
};

const btnGreen = {
  ...btnPrimary,
  background: colors.primary,
  color: colors.white,
};

const warehouseSrc = `${import.meta.env.BASE_URL}StorkBin%20Warehouse.png`;
const logoSrc = `${import.meta.env.BASE_URL}storkbin_color_vertical.png`;

const STEPS = [
  {
    title: "We deliver",
    body: "Starter bins ship to your door. Pack at home—no trip to a storage facility.",
  },
  {
    title: "You pack",
    body: "Fill your bins on your schedule, then ship them to our warehouse when you're ready.",
  },
  {
    title: "We store & return",
    body: "Bins stay secure with us. Request them back to any U.S. address whenever you need.",
  },
];

const FEATURES = [
  {
    title: "Your dashboard",
    body: "See every bin, shipment, and label in one place—no phone tag with a facility.",
  },
  {
    title: "FedEx labels & tracking",
    body: "Prepaid shipping on moves. Track each leg from your account.",
  },
  {
    title: "Book online",
    body: "Pick a plan, confirm your address, and checkout in minutes.",
  },
  {
    title: "Flexible returns",
    body: "Ship bins back from storage as often as you need—any U.S. address.",
  },
];

const PERKS = [
  "First starter delivery: prepaid shipping included",
  "No van or truck rental for your first move",
  "Pack once at home—we handle warehouse intake",
  "Unlimited return shipments from storage",
  "Bins are yours to keep",
  "Monthly or annual storage billing",
];

const sectionTitle = {
  margin: 0,
  fontSize: "clamp(1.65rem, 3.5vw, 2.1rem)",
  fontWeight: 800,
  letterSpacing: "-0.03em",
  color: colors.charcoal,
};

const sectionLead = {
  margin: "10px 0 0",
  fontSize: "16px",
  lineHeight: 1.5,
  color: colors.gray,
  maxWidth: "36em",
};

const stepCard = {
  background: colors.white,
  borderRadius: "16px",
  padding: "24px 20px",
  border: `1px solid ${colors.lightGray}`,
  boxShadow: "0 6px 24px rgba(0,0,0,0.05)",
};

const stepNum = {
  width: "40px",
  height: "40px",
  borderRadius: "12px",
  background: colors.primary,
  color: colors.white,
  fontWeight: 800,
  fontSize: "18px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: "14px",
};

const stepTitle = { margin: 0, fontSize: "20px", fontWeight: 700, color: colors.charcoal };
const stepBody = { margin: "8px 0 0", fontSize: "14px", lineHeight: 1.55, color: colors.gray };

const featureCard = {
  background: colors.background,
  borderRadius: "14px",
  padding: "20px",
  border: `1px solid ${colors.lightGray}`,
};

const perkItem = {
  display: "flex",
  gap: "10px",
  alignItems: "flex-start",
  marginBottom: "12px",
  fontSize: "15px",
  lineHeight: 1.45,
  color: colors.charcoal,
};

const perkCheck = {
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

function billingToggle(active) {
  return {
    border: "none",
    padding: "10px 20px",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "13px",
    background: active ? colors.primary : colors.white,
    color: active ? colors.white : colors.gray,
  };
}

function HomePageAlt() {
  const [billingCycle, setBillingCycle] = useState(BILLING_CYCLES.MONTHLY);

  return (
    <div className="home-page-alt" style={wrap}>
      <PublicSiteHeader />

      <section
        style={{
          background: `linear-gradient(135deg, ${colors.primaryDark} 0%, ${colors.primary} 55%, #9BB89B 100%)`,
          color: colors.white,
          padding: "clamp(48px, 8vw, 88px) 0 clamp(56px, 9vw, 96px)",
          textAlign: "center",
        }}
      >
        <div style={inner}>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              opacity: 0.92,
            }}
          >
            {BRAND_TAGLINE}
          </p>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(2.5rem, 7vw, 4.25rem)",
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              textTransform: "uppercase",
            }}
          >
            Storage that
            <br />
            comes to you
          </h1>
          <p
            style={{
              margin: "20px auto 0",
              maxWidth: "32em",
              fontSize: "clamp(17px, 2.2vw, 20px)",
              lineHeight: 1.55,
              opacity: 0.95,
            }}
          >
            Durable bins to your door. Pack at your pace, store with us, get them back anywhere in the U.S.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "center", marginTop: "28px" }}>
            <Link to="/signup" style={btnPrimary}>
              Get started
            </Link>
            <a href="#alt-how" style={btnOutline}>
              How it works
            </a>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "16px 24px",
              justifyContent: "center",
              marginTop: "32px",
              fontSize: "14px",
              fontWeight: 600,
              opacity: 0.9,
            }}
          >
            <span>✓ U.S. shipping</span>
            <span>✓ Secure warehouse storage</span>
            <span>✓ {STORAGE_BIN_OUTSIDE_LABEL} bins</span>
          </div>
        </div>
      </section>

      <section style={{ background: colors.white, padding: "0 0 48px", marginTop: "-28px" }}>
        <div style={{ ...inner, textAlign: "center" }}>
          <div
            style={{
              borderRadius: "20px",
              overflow: "hidden",
              boxShadow: "0 24px 60px rgba(51,85,51,0.18)",
              border: `1px solid ${colors.lightGray}`,
              maxWidth: "720px",
              margin: "0 auto",
              background: colors.background,
            }}
          >
            <img src={warehouseSrc} alt="StorkBin warehouse" style={{ width: "100%", height: "auto", display: "block" }} />
          </div>
        </div>
      </section>

      <section id="alt-how" style={{ padding: "56px 0", background: colors.background }}>
        <div style={inner}>
          <h2 style={sectionTitle}>How does it work?</h2>
          <p style={sectionLead}>Three steps. You stay home for the hard part.</p>
          <div className="home-alt-steps">
            {STEPS.map((step, i) => (
              <article key={step.title} style={stepCard}>
                <div style={stepNum}>{i + 1}</div>
                <h3 style={stepTitle}>{step.title}</h3>
                <p style={stepBody}>{step.body}</p>
              </article>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: "28px" }}>
            <Link to="/signup" style={btnGreen}>
              Get started
            </Link>
          </div>
        </div>
      </section>

      <section style={{ padding: "56px 0", background: colors.white }}>
        <div style={inner}>
          <h2 style={sectionTitle}>Built for real life</h2>
          <p style={sectionLead}>Less hauling. More control.</p>
          <div className="home-alt-features">
            {FEATURES.map((f) => (
              <article key={f.title} style={featureCard}>
                <h3 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: 700 }}>{f.title}</h3>
                <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.55, color: colors.gray }}>{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        style={{
          padding: "56px 0",
          background: `linear-gradient(180deg, rgba(143,175,143,0.12) 0%, ${colors.background} 100%)`,
        }}
      >
        <div style={inner}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "40px",
              alignItems: "center",
            }}
          >
            <div>
              <h2 style={sectionTitle}>With bins that tick your boxes</h2>
              <ul style={{ margin: "16px 0 0", padding: 0, listStyle: "none" }}>
                {PERKS.map((text) => (
                  <li key={text} style={perkItem}>
                    <span style={perkCheck}>✓</span>
                    {text}
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ textAlign: "center" }}>
              <img src={logoSrc} alt="StorkBin" style={{ maxWidth: "220px", width: "70%", height: "auto" }} />
            </div>
          </div>
        </div>
      </section>

      <section
        id="alt-pricing"
        style={{ padding: "56px 0", background: colors.white, borderTop: `1px solid ${colors.lightGray}` }}
      >
        <div style={inner}>
          <h2 style={{ ...sectionTitle, textAlign: "center" }}>Plans & pricing</h2>
          <p style={{ ...sectionLead, textAlign: "center", margin: "0 auto 24px" }}>
            First empty-bin delivery includes prepaid shipping.
          </p>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "24px" }}>
            <div style={{ display: "inline-flex", border: `1px solid ${colors.lightGray}`, borderRadius: "999px", overflow: "hidden" }}>
              <button type="button" onClick={() => setBillingCycle(BILLING_CYCLES.MONTHLY)} style={billingToggle(billingCycle === BILLING_CYCLES.MONTHLY)}>
                Monthly
              </button>
              <button type="button" onClick={() => setBillingCycle(BILLING_CYCLES.ANNUAL)} style={billingToggle(billingCycle === BILLING_CYCLES.ANNUAL)}>
                Annual (1 mo. free)
              </button>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
              gap: "18px",
            }}
          >
            {SUBSCRIPTION_PLANS.map((plan) => {
              const summary = getPlanBillingSummary(plan, billingCycle);
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
                  <h3 style={{ margin: "10px 0 4px", fontSize: "22px", fontWeight: 700 }}>{plan.subtitle}</h3>
                  <p style={{ margin: 0, fontSize: "13px", color: colors.gray }}>{plan.name}</p>
                  <p style={{ margin: "12px 0 0", fontSize: "28px", fontWeight: 800 }}>${plan.monthlyRate}/mo</p>
                  <p style={{ margin: "4px 0 0", fontSize: "14px", color: colors.primaryDark }}>
                    ${plan.monthlyRatePerBin}/bin · {STORAGE_BIN_OUTSIDE_LABEL}
                  </p>
                  <p style={{ margin: "12px 0 0", fontSize: "13px", color: colors.gray }}>
                    Due today: <strong style={{ color: colors.charcoal }}>${summary.dueToday}</strong>
                  </p>
                  <Link
                    to={`/signup?plan=${encodeURIComponent(plan.id)}&billing=${encodeURIComponent(billingCycle)}`}
                    style={{ ...btnGreen, marginTop: "16px", width: "100%", boxSizing: "border-box" }}
                  >
                    Choose {plan.subtitle}
                  </Link>
                </article>
              );
            })}
          </div>
          {billingCycle === BILLING_CYCLES.ANNUAL ? (
            <p style={{ margin: "18px 0 0", textAlign: "center", fontSize: "13px", color: colors.gray }}>
              Annual: pay {ANNUAL_PREPAY_BILLED_MONTHS} months upfront — 12th month included.
            </p>
          ) : null}
        </div>
      </section>

      <section
        style={{
          padding: "56px 22px",
          background: colors.charcoal,
          color: colors.white,
          textAlign: "center",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "clamp(1.5rem, 4vw, 2rem)", fontWeight: 700 }}>Ready when you are</h2>
        <p style={{ margin: "12px auto 24px", maxWidth: "28em", opacity: 0.88, lineHeight: 1.5 }}>
          Create an account, pick a plan, and we&apos;ll ship your first bins.
        </p>
        <Link to="/signup" style={btnPrimary}>
          Get started
        </Link>
      </section>

      <footer
        style={{
          textAlign: "center",
          padding: "28px 22px",
          fontSize: "13px",
          color: colors.gray,
          background: colors.white,
          borderTop: `1px solid ${colors.lightGray}`,
        }}
      >
        <p style={{ margin: "0 0 8px" }}>
          <Link to="/" style={{ color: colors.primaryDark, fontWeight: 600 }}>
            View classic homepage
          </Link>
          {" · "}
          <Link to="/login" style={{ color: colors.gray }}>
            Log in
          </Link>
        </p>
        <p style={{ margin: 0 }}>
          © {new Date().getFullYear()} StorkBin · Questions?{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: colors.primaryDark }}>
            {SUPPORT_EMAIL}
          </a>
        </p>
      </footer>

      <style>{`
        .home-alt-steps {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 20px;
          margin-top: 28px;
        }
        .home-alt-features {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 18px;
          margin-top: 28px;
        }
      `}</style>
    </div>
  );
}

function div({ style, children, className }) {
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

export default HomePageAlt;
