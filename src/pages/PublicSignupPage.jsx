import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { safeAuthRedirectPath } from "../utils/safeAuthRedirect";
import PublicSiteHeader from "../components/PublicSiteHeader";
import { supabase } from "../supabaseClient";
import { colors } from "../styles/styles";
import { BILLING_CYCLES, SUBSCRIPTION_PLANS } from "../config/subscriptionPlans";

const wrap = {
  fontFamily: "'Inter', system-ui, sans-serif",
  minHeight: "100vh",
  background: colors.background,
  color: colors.charcoal,
};

const main = { maxWidth: "520px", margin: "0 auto", padding: "28px 22px 48px" };

const field = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  borderRadius: "8px",
  border: `1px solid ${colors.lightGray}`,
  fontSize: "15px",
  marginTop: "6px",
};

const label = { display: "block", fontSize: "13px", fontWeight: 600, marginTop: "14px", color: colors.charcoal };

function buildDashboardRedirectWithPlan(planId, billingCycle) {
  const origin = window.location.origin;
  if (!planId || !SUBSCRIPTION_PLANS.some((p) => p.id === planId)) {
    return `${origin}/dashboard`;
  }
  const bill =
    billingCycle === BILLING_CYCLES.ANNUAL ? BILLING_CYCLES.ANNUAL : BILLING_CYCLES.MONTHLY;
  const q = new URLSearchParams({
    pending_plan: planId,
    pending_billing: bill,
  });
  return `${origin}/dashboard?${q.toString()}`;
}

function persistPlanForPostAuth(planId, billingCycle) {
  if (!planId || !SUBSCRIPTION_PLANS.some((p) => p.id === planId)) {
    sessionStorage.removeItem("storkbin_post_signup");
    return;
  }
  sessionStorage.setItem(
    "storkbin_post_signup",
    JSON.stringify({
      planId,
      billingCycle:
        billingCycle === BILLING_CYCLES.ANNUAL ? BILLING_CYCLES.ANNUAL : BILLING_CYCLES.MONTHLY,
    }),
  );
}

function PublicSignupPage() {
  const [params] = useSearchParams();
  const scanRedirect = safeAuthRedirectPath(params.get("redirect"));
  const planFromHomepage = useMemo(() => {
    const raw = String(params.get("plan") || "").trim();
    return SUBSCRIPTION_PLANS.some((p) => p.id === raw) ? raw : "";
  }, [params]);
  const billingFromHomepage = useMemo(() => {
    const raw = String(params.get("billing") || "").trim();
    return raw === BILLING_CYCLES.ANNUAL ? BILLING_CYCLES.ANNUAL : BILLING_CYCLES.MONTHLY;
  }, [params]);

  const selectedPlanLabel = useMemo(() => {
    if (!planFromHomepage) return null;
    const p = SUBSCRIPTION_PLANS.find((x) => x.id === planFromHomepage);
    return p ? `${p.subtitle} (${p.name})` : null;
  }, [planFromHomepage]);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [addr, setAddr] = useState({
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    zip: "",
  });

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ error: "", success: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [phase, setPhase] = useState("form");

  const mergeResolvedIntoAddr = (resolved) => {
    if (!resolved) return;
    setAddr((a) => ({
      ...a,
      address_line1: String(resolved.address_line1 || a.address_line1),
      address_line2: String(resolved.address_line2 || a.address_line2),
      city: String(resolved.city || a.city),
      state: String(resolved.state || a.state),
      zip: String(resolved.zip || a.zip),
    }));
  };

  const runAddressValidation = async () => {
    const payload = {
      address: {
        full_name: fullName.trim(),
        email: email.trim(),
        address_line1: addr.address_line1.trim(),
        address_line2: addr.address_line2.trim(),
        city: addr.city.trim(),
        state: addr.state.trim(),
        zip: addr.zip.trim(),
        country_code: "US",
      },
    };
    const { data, error } = await supabase.functions.invoke("validate-address", { body: payload });
    if (error) {
      return { ok: false, error: error.message || "Could not validate address.", fieldErrors: {} };
    }
    if (data?.validated && data?.resolved) {
      return { ok: true, resolved: data.resolved, fieldErrors: {} };
    }
    const suggested = data?.suggested || null;
    if (suggested) {
      mergeResolvedIntoAddr(suggested);
    }
    return {
      ok: false,
      error: data?.message || data?.error || "Please review your address and try again.",
      fieldErrors: data?.fieldErrors || {},
    };
  };

  const createAccount = async () => {
    setMessage({ error: "", success: "" });
    setFieldErrors({});

    if (!fullName.trim() || !email.trim() || !password || password.length < 8) {
      setMessage({ error: "Enter your name, email, and a password of at least 8 characters.", success: "" });
      return;
    }
    if (
      !addr.address_line1.trim() ||
      !addr.city.trim() ||
      !addr.state.trim() ||
      !addr.zip.trim()
    ) {
      setMessage({ error: "Enter a complete U.S. shipping address.", success: "" });
      return;
    }

    setBusy(true);
    try {
      const validation = await runAddressValidation();
      if (!validation.ok) {
        setFieldErrors(validation.fieldErrors || {});
        setMessage({ error: validation.error || "Address could not be confirmed.", success: "" });
        return;
      }

      const resolved = validation.resolved;
      const ship = {
        ...addr,
        ...resolved,
        full_name: fullName.trim(),
        email: email.trim(),
        country_code: "US",
      };

      const dashboardWithPlan = buildDashboardRedirectWithPlan(planFromHomepage, billingFromHomepage);

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: dashboardWithPlan,
          data: {
            full_name: fullName.trim(),
            phone: phone.trim(),
            /** Copied into `profiles` by DB trigger when email confirmation leaves `session` null. */
            signup_profile_email: email.trim(),
            address_line1: String(ship.address_line1 || "").trim(),
            address_line2: String(ship.address_line2 || "").trim(),
            city: String(ship.city || "").trim(),
            state: String(ship.state || "").trim(),
            zip: String(ship.zip || "").trim(),
            country_code: "US",
          },
        },
      });

      if (error) {
        setMessage({ error: error.message || "Sign up failed.", success: "" });
        return;
      }

      const sessionUser = data.user;
      const session = data.session;

      if (sessionUser && session) {
        const dest = scanRedirect || dashboardWithPlan;
        // If the redirect URL already carries pending_plan, only that path should hydrate the cart
        // (App.jsx). Avoid also writing storkbin_post_signup or we risk double-adding the same plan.
        if (planFromHomepage && dest.includes("pending_plan=")) {
          sessionStorage.removeItem("storkbin_post_signup");
        } else {
          persistPlanForPostAuth(planFromHomepage, billingFromHomepage);
        }
        const { error: profileErr } = await supabase.from("profiles").upsert(
          {
            id: sessionUser.id,
            full_name: fullName.trim(),
            email: email.trim(),
            address_line1: String(ship.address_line1 || "").trim(),
            address_line2: String(ship.address_line2 || "").trim(),
            city: String(ship.city || "").trim(),
            state: String(ship.state || "").trim(),
            zip: String(ship.zip || "").trim(),
          },
          { onConflict: "id" },
        );
        if (profileErr) {
          setMessage({
            error:
              profileErr.message ||
              "Account was created but your profile could not be saved. Try again or contact support before checking out.",
            success: "",
          });
          return;
        }
        setMessage({ error: "", success: "Account ready — opening your dashboard…" });
        window.location.assign(dest);
        return;
      }

      persistPlanForPostAuth(planFromHomepage, billingFromHomepage);
      setPhase("check-email");
      setMessage({
        error: "",
        success: "",
      });
    } finally {
      setBusy(false);
    }
  };

  if (phase === "check-email") {
    return (
      <div style={wrap}>
        <PublicSiteHeader />
        <main style={main}>
          <h1 style={{ margin: "0 0 10px", fontSize: "26px", fontWeight: 700, color: colors.charcoal }}>
            Check your email
          </h1>
          <p style={{ margin: "0 0 16px", color: colors.gray, lineHeight: 1.55, fontSize: "16px" }}>
            We sent a confirmation link to <strong style={{ color: colors.charcoal }}>{email.trim()}</strong>. Open that
            link to confirm your email — you will be signed in and taken straight to your dashboard.
          </p>
          {planFromHomepage ? (
            <p
              style={{
                margin: "0 0 20px",
                padding: "14px 16px",
                borderRadius: "10px",
                background: "rgba(143,175,143,0.2)",
                color: colors.charcoal,
                fontSize: "14px",
                lineHeight: 1.45,
              }}
            >
              After you confirm, you will land on your dashboard with{" "}
              <strong>{selectedPlanLabel || "your selected plan"}</strong> already in your cart.
            </p>
          ) : null}
          <p style={{ margin: "0 0 12px", fontSize: "14px", color: colors.gray }}>
            Did not get the email? Check spam, or wait a minute and try signing up again with the same address.
          </p>
          <Link to="/login" style={{ fontSize: "15px", fontWeight: 600, color: colors.primaryDark }}>
            Already verified? Log in
          </Link>
          <p style={{ marginTop: "22px", fontSize: "14px" }}>
            <Link to="/" style={{ color: colors.gray }}>
              ← Back to home
            </Link>
          </p>
        </main>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <PublicSiteHeader />
      <main style={main}>
        <h1 style={{ margin: "0 0 8px", fontSize: "26px", fontWeight: 700, color: colors.charcoal }}>
          Create your StorkBin account
        </h1>
        <p style={{ margin: "0 0 18px", color: colors.gray, lineHeight: 1.55 }}>
          {planFromHomepage ? (
            <>
              You chose <strong style={{ color: colors.charcoal }}>{selectedPlanLabel}</strong> from Pricing — after
              you create your account it will appear in your cart on the dashboard. One step below checks your address
              and creates your login.
            </>
          ) : (
            <>
              After signup you can pick a plan from Pricing or your dashboard. Address is checked automatically when
              you tap Create account.
            </>
          )}
        </p>

        <label style={label}>Full name</label>
        <input style={field} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />

        <label style={label}>Email</label>
        <input style={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />

        <label style={label}>Phone</label>
        <input style={field} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />

        <label style={label}>Password (min 8 characters)</label>
        <input
          style={field}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />

        <h2 style={{ margin: "28px 0 8px", fontSize: "17px", fontWeight: 700, color: colors.charcoal }}>
          Shipping address (U.S.)
        </h2>
        <p style={{ margin: "0 0 10px", fontSize: "13px", color: colors.gray }}>
          We confirm your address as part of account creation so checkout later goes smoothly.
        </p>

        {["address_line1", "address_line2", "city", "state", "zip"].map((key) => (
          <div key={key}>
            <label style={label}>
              {key === "address_line1"
                ? "Street address"
                : key === "address_line2"
                  ? "Apt / suite (optional)"
                  : key.charAt(0).toUpperCase() + key.slice(1)}
            </label>
            <input
              style={{
                ...field,
                borderColor: fieldErrors[key] ? colors.accent : colors.lightGray,
              }}
              value={addr[key]}
              onChange={(e) => setAddr((a) => ({ ...a, [key]: e.target.value }))}
            />
            {fieldErrors[key] ? (
              <div style={{ fontSize: "12px", color: colors.accent, marginTop: "4px" }}>{fieldErrors[key]}</div>
            ) : null}
          </div>
        ))}
        {fieldErrors._form ? (
          <div style={{ fontSize: "13px", color: colors.accent, marginTop: "10px" }}>{fieldErrors._form}</div>
        ) : null}

        {message.error ? (
          <div style={{ marginTop: "14px", padding: "12px", borderRadius: "8px", background: "#FFF5F5", color: "#7A1F1F" }}>
            {message.error}
          </div>
        ) : null}
        {message.success ? (
          <div style={{ marginTop: "14px", padding: "12px", borderRadius: "8px", background: "#F0FAF2", color: colors.primaryDark }}>
            {message.success}
          </div>
        ) : null}

        <button
          type="button"
          style={{
            marginTop: "22px",
            width: "100%",
            padding: "14px",
            borderRadius: "10px",
            border: "none",
            background: colors.primary,
            color: colors.white,
            fontWeight: 600,
            fontSize: "16px",
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.85 : 1,
          }}
          disabled={busy}
          onClick={createAccount}
        >
          {busy ? "Working…" : "Create account"}
        </button>

        <p style={{ marginTop: "18px", fontSize: "14px", color: colors.gray }}>
          Already have an account? <Link to="/login">Log in</Link> · <Link to="/">Home</Link>
        </p>
      </main>
    </div>
  );
}

export default PublicSignupPage;
