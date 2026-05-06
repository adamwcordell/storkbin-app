const fs = require("fs");
const path = require("path");

const appPath = path.join(process.cwd(), "src", "App.jsx");
if (!fs.existsSync(appPath)) {
  console.error("Could not find src/App.jsx. Run this from the StorkBin project root.");
  process.exit(1);
}

let source = fs.readFileSync(appPath, "utf8");
const original = source;

// Patch final cancellation shipment detection to ignore old delivered/customer shipments
// and to allow terminated subscription states to still create the final return shipment.
const oldExistingShipmentBlock = `const existingFinalShipment = currentShipments.find(
        (shipment) => shipment.box_id === box.id && shipment.shipment_direction === "to_customer"
      );`;
const newExistingShipmentBlock = `const existingFinalShipment = currentShipments.find(
        (shipment) =>
          shipment.box_id === box.id &&
          shipment.shipment_direction === "to_customer" &&
          shipment.shipping_status !== "delivered" &&
          shipment.charge_status !== "paid"
      );`;

if (source.includes(oldExistingShipmentBlock)) {
  source = source.replace(oldExistingShipmentBlock, newExistingShipmentBlock);
}

// More flexible fallback: replace a compact one-line find variant if present.
source = source.replace(
  /const existingFinalShipment = currentShipments\.find\(\s*\(shipment\) => shipment\.box_id === box\.id && shipment\.shipment_direction === "to_customer"\s*\);/,
  newExistingShipmentBlock
);

// Make date parsing robust for Supabase timestamps without timezone suffix.
const oldDateCheck = `const subscriptionEndDate = box.subscription_ends_at ? new Date(box.subscription_ends_at) : null;`;
const newDateCheck = `const subscriptionEndDate = box.subscription_ends_at
        ? new Date(String(box.subscription_ends_at).includes("T") ? box.subscription_ends_at : String(box.subscription_ends_at).replace(" ", "T"))
        : null;`;
if (source.includes(oldDateCheck)) {
  source = source.replace(oldDateCheck, newDateCheck);
}

// Ensure final shipment creation condition does not exclude terminated local subscription states.
source = source.replace(
  /box\.subscription_lifecycle_status !== "terminated"\s*&&\s*/g,
  ""
);
source = source.replace(
  /box\.subscription_status !== "terminated"\s*&&\s*/g,
  ""
);
source = source.replace(
  /box\.lifecycle_status !== "terminated"\s*&&\s*/g,
  ""
);

if (source === original) {
  console.error("No changes were applied. Your App.jsx did not match the expected lifecycle patterns.");
  process.exit(2);
}

fs.writeFileSync(appPath, source, "utf8");
console.log("Applied final shipment auto-create fix to src/App.jsx");
