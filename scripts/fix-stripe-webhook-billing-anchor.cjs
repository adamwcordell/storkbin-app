const fs = require("fs");
const path = require("path");

const target = path.join(process.cwd(), "supabase", "functions", "stripe-webhook", "index.ts");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(target)) {
  fail("Could not find supabase/functions/stripe-webhook/index.ts. Run from C:\\Users\\adamw\\Desktop\\StorkBin.");
}

let text = fs.readFileSync(target, "utf8");
const original = text;

const oldBlock = `  const now = new Date();
  const renewsAt = new Date(now);
  renewsAt.setMonth(renewsAt.getMonth() + 1);`;

const newBlock = `  // Use the Stripe Checkout session creation time as the source of truth for the
  // first renewal anchor. This avoids billing_cycle_anchor drift during webhook
  // replay/test-clock runs, where the function's server time can be later than
  // Stripe's next natural billing date for the test-clock customer.
  const checkoutCreatedAt =
    typeof session?.created === "number"
      ? new Date(session.created * 1000)
      : new Date();

  const now = checkoutCreatedAt;
  const renewsAt = new Date(checkoutCreatedAt.getTime() + 30 * 24 * 60 * 60 * 1000);`;

if (!text.includes(oldBlock)) {
  fail("Could not find the exact renewal anchor block. No changes made.");
}

text = text.replace(oldBlock, newBlock);

const backup = `${target}.billing-anchor-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
fs.writeFileSync(backup, original);
fs.writeFileSync(target, text);

console.log("Patched stripe-webhook renewal anchor calculation.");
console.log(`Backup created: ${path.relative(process.cwd(), backup)}`);
console.log("");
console.log("Next:");
console.log("supabase functions deploy stripe-webhook --no-verify-jwt");
