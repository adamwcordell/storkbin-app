const fs = require('fs');
const path = require('path');

const appPath = path.join(process.cwd(), 'src', 'App.jsx');
if (!fs.existsSync(appPath)) {
  console.error('Could not find src/App.jsx. Run this from the StorkBin project root.');
  process.exit(1);
}

let src = fs.readFileSync(appPath, 'utf8');
const original = src;

// 1) Make final-cancellation shipment lookup only reuse active/final to_customer shipments.
// The old lookup grabbed ANY shipment for the box, including old delivered starter shipments,
// which can silently prevent final return shipment creation.
const oldShipmentLookup = `const { data: existingShipments, error: existingShipmentError } =
      await supabase
        .from("shipments")
        .select("*")
        .eq("box_id", box.id)
        .limit(1);`;

const newShipmentLookup = `const { data: existingShipments, error: existingShipmentError } =
      await supabase
        .from("shipments")
        .select("*")
        .eq("box_id", box.id)
        .eq("shipment_direction", "to_customer")
        .neq("shipping_status", "delivered")
        .order("created_at", { ascending: false })
        .limit(1);`;

if (!src.includes(oldShipmentLookup) && !src.includes(newShipmentLookup)) {
  console.error('Could not find the cancellation shipment lookup block in src/App.jsx. No changes made.');
  process.exit(1);
}
src = src.replace(oldShipmentLookup, newShipmentLookup);

// 2) Add robust timestamp parsing for DB timestamps that may arrive without a timezone/T separator.
const processLifecycleMarker = `  const processLifecycleUpdates = async (currentUser, currentBoxes) => {`;
const helperBlock = `  const parseLifecycleTimestamp = (value) => {
    if (!value) return null;

    if (value instanceof Date) return value;

    const rawValue = String(value);
    const normalizedValue = rawValue.includes("T")
      ? rawValue
      : rawValue.replace(" ", "T");
    const hasTimezone = /([zZ]|[+-]\\d{2}:?\\d{2})$/.test(normalizedValue);
    const date = new Date(hasTimezone ? normalizedValue : `${normalizedValue}Z`);

    return Number.isNaN(date.getTime()) ? null : date;
  };

  const hasSubscriptionEndPassed = (box) => {
    const endsAt = parseLifecycleTimestamp(box.subscription_ends_at);
    return Boolean(endsAt && endsAt.getTime() <= Date.now());
  };

` + processLifecycleMarker;

if (!src.includes('const parseLifecycleTimestamp = (value) =>')) {
  if (!src.includes(processLifecycleMarker)) {
    console.error('Could not find processLifecycleUpdates marker in src/App.jsx. No changes made.');
    process.exit(1);
  }
  src = src.replace(processLifecycleMarker, helperBlock);
}

// 3) Use the robust helper inside lifecycle processing.
const oldSubscriptionHasEnded = `const subscriptionHasEnded =
        box.subscription_ends_at &&
        new Date(box.subscription_ends_at).getTime() <= Date.now();`;
const newSubscriptionHasEnded = `const subscriptionHasEnded = hasSubscriptionEndPassed(box);`;

if (!src.includes(oldSubscriptionHasEnded) && !src.includes(newSubscriptionHasEnded)) {
  console.error('Could not find subscriptionHasEnded calculation in src/App.jsx. No changes made.');
  process.exit(1);
}
src = src.replace(oldSubscriptionHasEnded, newSubscriptionHasEnded);

// 4) Keep the end-of-term shipment path available even after Stripe has locally terminated the subscription.
// This condition is intentionally based on physical state + cancellation approval + end date, not subscription_status.
const oldNeedsEndOfTermShipment = `const needsEndOfTermShipment =
        box.cancel_status === "approved" &&
        box.status === "stored" &&
        subscriptionHasEnded;`;
const newNeedsEndOfTermShipment = `const needsEndOfTermShipment =
        box.cancel_status === "approved" &&
        box.status === "stored" &&
        subscriptionHasEnded &&
        box.cancellation_shipping_charge_status !== "paid";`;

if (src.includes(oldNeedsEndOfTermShipment)) {
  src = src.replace(oldNeedsEndOfTermShipment, newNeedsEndOfTermShipment);
}

if (src === original) {
  console.log('No changes were needed; src/App.jsx already appears patched.');
} else {
  fs.writeFileSync(appPath, src);
  console.log('Patched src/App.jsx for robust final-shipment auto-creation.');
}
