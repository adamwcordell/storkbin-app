import fs from "fs";
import path from "path";

const root = process.cwd();
const accountPath = path.join(root, "src", "pages", "AccountPage.jsx");
const appPath = path.join(root, "src", "App.jsx");

if (!fs.existsSync(accountPath)) {
  console.error("Could not find src/pages/AccountPage.jsx.");
  process.exit(1);
}

if (!fs.existsSync(appPath)) {
  console.error("Could not find src/App.jsx.");
  process.exit(1);
}

let account = fs.readFileSync(accountPath, "utf8");
let app = fs.readFileSync(appPath, "utf8");

const newMakePayment = `  const makePayment = () => {
    const failedSubscriptionItem = missedPaymentItems.find(
      (item) =>
        item.box?.subscription_payment_status === "failed" &&
        item.box?.stripe_subscription_id
    );

    if (failedSubscriptionItem?.box?.id) {
      if (!appData.startSubscriptionPaymentRecovery) {
        alert("Stripe payment recovery is not wired yet. Please refresh and try again.");
        return;
      }

      appData.startSubscriptionPaymentRecovery(failedSubscriptionItem.box.id);
      return;
    }

    const failedShipmentItem = missedPaymentItems.find(
      (item) =>
        item.box?.cancellation_shipping_charge_status === "failed" ||
        item.box?.fulfillment_status === "shipment_payment_failed" ||
        hasFailedShipment(item.box, shipments)
    );

    if (failedShipmentItem?.box?.id && appData.payShipping) {
      appData.payShipping(failedShipmentItem.box.id);
      return;
    }

    if (appData.payAllFailedPayments) {
      appData.payAllFailedPayments();
    }
  };

`;

const makePaymentRegex = /  const makePayment = \(\) => \{[\s\S]*?\n  \};\n\n  const updateAddressField = /;

if (!makePaymentRegex.test(account)) {
  console.error("Could not find makePayment block in AccountPage.jsx.");
  process.exit(1);
}

account = account.replace(makePaymentRegex, newMakePayment + "  const updateAddressField = ");

fs.writeFileSync(accountPath, account);

const initialCheckoutLine =
  'const INITIAL_CHECKOUT_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.functions.supabase.co/create-initial-checkout";';

if (!app.includes("PAYMENT_RECOVERY_FUNCTION_URL")) {
  if (!app.includes(initialCheckoutLine)) {
    console.error("Could not find INITIAL_CHECKOUT_FUNCTION_URL in App.jsx.");
    process.exit(1);
  }

  app = app.replace(
    initialCheckoutLine,
    `${initialCheckoutLine}
  const PAYMENT_RECOVERY_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/create-payment-recovery-session";`
  );
}

if (!app.includes("const startSubscriptionPaymentRecovery = async")) {
  const payShippingMarker = "  const payShipping = async (boxId) => {";

  if (!app.includes(payShippingMarker)) {
    console.error("Could not find payShipping marker in App.jsx.");
    process.exit(1);
  }

  const recoveryFunction = `  const startSubscriptionPaymentRecovery = async (boxId) => {
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

  app = app.replace(payShippingMarker, recoveryFunction + payShippingMarker);
}

if (!app.includes("startSubscriptionPaymentRecovery,")) {
  const payShippingProp = "payShipping,";
  const propIndex = app.lastIndexOf(payShippingProp);

  if (propIndex === -1) {
    console.error("Could not find payShipping prop in App.jsx appData.");
    process.exit(1);
  }

  app = app.slice(0, propIndex + payShippingProp.length) +
    "\n            startSubscriptionPaymentRecovery," +
    app.slice(propIndex + payShippingProp.length);
}

fs.writeFileSync(appPath, app);

console.log("Patched AccountPage Make Payment to use Stripe recovery first.");
console.log("Verified App.jsx exposes startSubscriptionPaymentRecovery.");
