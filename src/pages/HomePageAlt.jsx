/**
 * Alternate marketing homepage (TAXIBOX-inspired layout).
 * Default marketing homepage at / (classic version at /home-classic).
 * Switch: npm run homepage:alt  or  npm run homepage:classic
 */
import { Link } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader";
import SubscriptionPlanPricing from "../components/SubscriptionPlanPricing";
import { colors } from "../styles/styles";
import { SUPPORT_EMAIL } from "../config/supportContact";
import {
  STORAGE_BIN_OUTSIDE_LABEL,
  SUBSCRIPTION_PLANS,
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

const STEPS = [
  {
    title: "We Deliver",
    body: "Empty StorkBins are shipped directly to your door.",
  },
  {
    title: "You Pack",
    body: "Pack your StorkBins on your schedule. Then, ship them to our secured warehouse when you’re ready.",
  },
  {
    title: "Request Your Bins",
    body: "Your bins will stay securely stored at our warehouse until you need them. Request them back at any time to any U.S. address.",
  },
];

const FEATURES = [
  {
    title: "Your Inventory, Organized",
    body: "Log what’s in each bin in the app. Winter coats, files, camping gear—find it without opening every container.",
  },
  {
    title: "One Dashboard For Everything",
    body: "Every bin, every move, every status in one place. No phone tag, no “where did we put that?”",
  },
  {
    title: "Self-Serve On Your Schedule",
    body: "Add storage, request returns, and manage your account anytime—no waiting on business hours.",
  },
  {
    title: "Time Back In Your Day",
    body: "Skip the storage-facility runaround. Pack at home, tap the app, and let us handle the warehouse leg.",
  },
];

const PERKS = [
  "Reclaim closet and garage space without losing track of what you stored",
  "Know exactly which bin has the ski boots—before you request it back",
  "Rotate seasonal gear without a storage-unit trip",
  "Declutter a room in an afternoon, not a whole weekend",
  "Keep bins after you cancel—your system stays yours",
  "Pay for storage monthly; only pay to move bins when you need them",
];

const sectionTitle = {
  margin: 0,
  fontSize: "clamp(1.65rem, 3.5vw, 2.1rem)",
  fontWeight: 800,
  letterSpacing: "-0.03em",
  color: colors.charcoal,
};

const sectionLead = {
  margin: "10px auto 0",
  fontSize: "16px",
  lineHeight: 1.5,
  color: colors.gray,
  maxWidth: "36em",
  textAlign: "center",
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
  marginBottom: 0,
  fontSize: "15px",
  lineHeight: 1.45,
  color: colors.charcoal,
  textWrap: "pretty",
};

const faqItem = {
  padding: "16px 0",
  borderBottom: `1px solid ${colors.lightGray}`,
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

function HomePageAlt() {
  return (
    <div className="home-page-alt home-marketing-page" style={wrap}>
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
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(2.5rem, 7vw, 4.25rem)",
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              textTransform: "uppercase",
              color: colors.white,
            }}
          >
            Storage Without
            <br />
            The Unit
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
            Durable bins delivered to your door. Pack at your pace. Store with confidence. Retrieve anywhere.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "center", marginTop: "28px" }}>
            <Link to="/signup" style={btnPrimary}>
              Get Started
            </Link>
            <a href="#how-it-works" style={btnOutline}>
              How It Works
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

      <section id="how-it-works" style={{ padding: "56px 0", background: colors.background }}>
        <div style={inner}>
          <h2 style={sectionTitle}>How Does It Work?</h2>
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
              Get Started
            </Link>
          </div>
        </div>
      </section>

      <section
        id="pricing"
        style={{ padding: "56px 0", background: colors.white, borderTop: `1px solid ${colors.lightGray}` }}
      >
        <div style={inner}>
          <SubscriptionPlanPricing plans={SUBSCRIPTION_PLANS} mode="signup" />
        </div>
      </section>

      <section style={{ padding: "56px 0", background: colors.white }}>
        <div style={inner}>
          <h2 style={sectionTitle}>Built For Real Life</h2>
          <p style={sectionLead}>
            An app that remembers what you stored—so you spend less time hunting and more time living.
          </p>
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
          <h2 style={{ ...sectionTitle, textAlign: "center" }}>More Space. Nothing Forgotten.</h2>
          <p style={{ ...sectionLead, marginBottom: "28px" }}>
            Reclaim room at home without losing track of what you stored.
          </p>
          <ul className="home-alt-perks">
            {PERKS.map((text) => (
              <li key={text} style={perkItem}>
                <span style={perkCheck}>✓</span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="faq" style={{ padding: "56px 0", background: colors.background }}>
        <div style={inner}>
          <h2 style={sectionTitle}>FAQ</h2>
          <div style={{ marginTop: "20px", textAlign: "left", maxWidth: "40em" }}>
            <div style={faqItem}>
              <strong style={{ color: colors.charcoal }}>Do I keep the bins?</strong>
              <p style={{ margin: "8px 0 0", fontSize: "15px", color: colors.gray, lineHeight: 1.5 }}>
                Yes — bins are yours to keep after service ends.
              </p>
            </div>
            <div style={faqItem}>
              <strong style={{ color: colors.charcoal }}>Who pays shipping?</strong>
              <p style={{ margin: "8px 0 0", fontSize: "15px", color: colors.gray, lineHeight: 1.5 }}>
                First empty-bin delivery is prepaid. After that, you pay carrier shipping whenever bins move.
              </p>
            </div>
            <div style={{ ...faqItem, borderBottom: "none" }}>
              <strong style={{ color: colors.charcoal }}>Where do I log in?</strong>
              <p style={{ margin: "8px 0 0", fontSize: "15px", color: colors.gray, lineHeight: 1.5 }}>
                <Link to="/login">Log in here</Link> after you create your account.
              </p>
            </div>
          </div>
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
        <h2
          style={{
            margin: 0,
            fontSize: "clamp(1.5rem, 4vw, 2rem)",
            fontWeight: 700,
            color: colors.white,
          }}
        >
          Ready When You Are
        </h2>
        <p style={{ margin: "12px auto 24px", maxWidth: "28em", opacity: 0.88, lineHeight: 1.5 }}>
          Create an account, pick a plan, and we&apos;ll ship your first bins.
        </p>
        <Link to="/signup" style={btnPrimary}>
          Get Started
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
          <Link to="/login" style={{ color: colors.gray }}>
            Log In
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
        .home-alt-perks {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 14px 32px;
          margin: 0 auto;
          padding: 0;
          list-style: none;
          max-width: 42em;
        }
      `}</style>
    </div>
  );
}

export default HomePageAlt;
