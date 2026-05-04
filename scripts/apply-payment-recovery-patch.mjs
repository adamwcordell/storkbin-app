import fs from "fs";
import path from "path";

const appPath = path.join(process.cwd(), "src", "App.jsx");

if (!fs.existsSync(appPath)) {
  console.error("Could not find src/App.jsx. Run this from your StorkBin project root.");
  process.exit(1);
}

let app = fs.readFileSync(appPath, "utf8");

if (!app.includes("PAYMENT_RECOVERY_FUNCTION_URL")) {
  const anchor = 'const INITIAL_CHECKOUT_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.functions.supabase.co/create-initial-checkout";';
  const replacement = `${anchor}
  const PAYMENT_RECOVERY_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/create-payment-recovery-session";`;
  if (!app.includes(anchor)) {
    console.error("Could not find INITIAL_CHECKOUT_FUNCTION_URL in App.jsx. No changes made.");
    process.exit(1);
  }
  app = app.replace(anchor, replacement);
}

if (!app.includes("startSubscriptionPaymentRecovery")) {
  const insertBefore = "  const payShipping = async (boxId) => {";
  const fn = `  const startSubscriptionPaymentRecovery = async (boxId) => {
    const box = boxes.find((currentBox) => currentBox.id === boxId);

    if (!box) {
      alert("Box not found.");
      return;
    }

    if (!box.stripe_subscription_id) {
      alert("This bin does not have a Stripe subscription yet.");
      return;
    }

    const response = await fetch(PAYMENT_RECOVERY_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscriptionId: box.stripe_subscription_id,
        successUrl: \`\${window.location.origin}/account?payment=success\`,
        cancelUrl: \`\${window.location.origin}/account?payment=cancel\`,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.checkoutUrl) {
      alert(payload.error || "Could not start payment recovery.");
      return;
    }

    window.location.href = payload.checkoutUrl;
  };

`;
  if (!app.includes(insertBefore)) {
    console.error("Could not find payShipping insertion point in App.jsx. No changes made.");
    process.exit(1);
  }
  app = app.replace(insertBefore, fn + insertBefore);
}

const appDataPattern = /payShipping,\s*\n\s*payAllFailedPayments,/;
if (appDataPattern.test(app) && !app.includes("startSubscriptionPaymentRecovery,")) {
  app = app.replace(appDataPattern, "payShipping,\n            startSubscriptionPaymentRecovery,\n            payAllFailedPayments,");
}

fs.writeFileSync(appPath, app);
console.log("Patched App.jsx for Stripe subscription payment recovery.");
