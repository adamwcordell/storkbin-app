import fs from "fs";
import path from "path";

const accountPath = path.join(process.cwd(), "src", "pages", "AccountPage.jsx");

if (!fs.existsSync(accountPath)) {
  console.error("Could not find src/pages/AccountPage.jsx. Run this from your StorkBin project root.");
  process.exit(1);
}

let file = fs.readFileSync(accountPath, "utf8");

if (file.includes("account_make_payment_stripe_recovery_fix")) {
  console.log("Account Make a Payment Stripe recovery fix already applied.");
  process.exit(0);
}

const startMarker = "  const makePayment = () => {";
const endMarker = "  const dismissReactivation = async (boxId) => {";

const startIndex = file.indexOf(startMarker);
const endIndex = file.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
  console.error("Could not locate makePayment function in AccountPage.jsx. No changes made.");
  process.exit(1);
}

const replacement = `  const makePayment = () => {
    // account_make_payment_stripe_recovery_fix
    // Subscription failures should go to Stripe recovery, not the old mock recovery path.
    const failedSubscriptionItem = missedPaymentItems.find(
      (item) =>
        item.box?.subscription_payment_status === "failed" &&
        item.box?.stripe_subscription_id
    );

    if (
      failedSubscriptionItem?.box?.id &&
      appData.startSubscriptionPaymentRecovery
    ) {
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

file = file.slice(0, startIndex) + replacement + file.slice(endIndex);

fs.writeFileSync(accountPath, file);
console.log("Patched AccountPage.jsx: Make a Payment now prioritizes Stripe subscription recovery.");
