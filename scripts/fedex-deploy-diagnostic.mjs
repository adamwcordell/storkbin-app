/**
 * Safe FedEx / shipping secret diagnostic for Supabase project wslymzcbbevnoybbsbgq.
 * Does not print secret values — only presence and inferred non-secret settings.
 *
 *   node scripts/fedex-deploy-diagnostic.mjs
 */
import crypto from "node:crypto";

const PROJECT_REF = "wslymzcbbevnoybbsbgq";

const KNOWN_DIGESTS = {
  "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b": "1",
  ab8e18ef4ebebeddc0b3152ce9c9006e14fc05242e3fc9ce32246ea6a9543074: "production",
  b7ad567477c83756aab9a542b2be04f77dbae25115d85f22070d74d8cc4779dc: "sandbox",
  "247610f4dedd4ab7247d07dbda19c81ca9817f85820742cad49d407ffae9e4ed": "live",
  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855: "(empty)",
};

const FEDEX_SECRETS = [
  "FEDEX_ENV",
  "FEDEX_CLIENT_ID",
  "FEDEX_CLIENT_SECRET",
  "FEDEX_ACCOUNT_NUMBER",
  "FEDEX_SANDBOX_ACCOUNT_NUMBER",
  "FEDEX_SERVICE_TYPE",
  "FEDEX_SHIPPER_POSTAL_CODE",
  "FEDEX_SHIPPER_COUNTRY_CODE",
  "FEDEX_SHIPPER_STATE",
  "FEDEX_SHIPPER_CITY",
  "FEDEX_SHIPPER_ADDRESS_LINE1",
  "FEDEX_SHIPPER_NAME",
  "FEDEX_SHIPPER_PHONE",
  "FEDEX_RECIPIENT_PHONE_DEFAULT",
  "FEDEX_DEFAULT_WEIGHT_LB",
  "FEDEX_RATE_DEBUG",
  "FEDEX_RATE_PROBE_SECRET",
  "SHIPPING_TEST_MODE",
  "APP_URL",
];

function inferDigest(digest) {
  return KNOWN_DIGESTS[digest] || "(set — value hidden)";
}

async function listSecrets() {
  const { execSync } = await import("node:child_process");
  const out = execSync(`npx supabase secrets list --project-ref ${PROJECT_REF}`, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s+([A-Z0-9_]+)\s+\|\s+([a-f0-9]+)\s*$/);
    if (m) rows.push({ name: m[1], digest: m[2] });
  }
  return rows;
}

const rows = await listSecrets();
const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

console.log("=== Supabase Edge secrets (FedEx / shipping) ===\n");
for (const name of FEDEX_SECRETS) {
  const row = byName[name];
  if (!row) {
    console.log(`${name}: NOT SET`);
    continue;
  }
  console.log(`${name}: ${inferDigest(row.digest)}`);
}

const fedexEnv = inferDigest(byName.FEDEX_ENV?.digest || "");
const testMode = inferDigest(byName.SHIPPING_TEST_MODE?.digest || "");
const testModeActive =
  testMode === "1" && (fedexEnv === "sandbox" || fedexEnv === "(empty)" || fedexEnv.includes("staging"));

console.log("\n=== Effective shipping behavior ===");
console.log(`FEDEX_ENV inferred: ${fedexEnv}`);
console.log(`SHIPPING_TEST_MODE inferred: ${testMode}`);
console.log(
  `isShippingTestModeActive (approx): ${testModeActive ? "YES — fake labels, no FedEx Ship API" : "NO — real FedEx APIs"}`,
);
if (testMode === "1" && fedexEnv === "production") {
  console.log(
    "WARNING: SHIPPING_TEST_MODE=1 is set but FEDEX_ENV=production — test mode is IGNORED; code calls production FedEx.",
  );
}
if (fedexEnv === "production" && testMode !== "1") {
  console.log("Production FedEx: requires production API keys + live FEDEX_ACCOUNT_NUMBER with Ship API enabled.");
}
if ((fedexEnv === "sandbox" || fedexEnv === "(empty)") && testMode !== "1") {
  console.log("Sandbox FedEx: use Developer Portal TEST keys; account defaults to 740561073 if FEDEX_ACCOUNT_NUMBER unset.");
}

console.log("\n=== Failed return shipment (from DB) ===");
console.log(
  "ef19cdb6-be37-43d4-bc7c-20a1507cba1e | label_status=purchase_failed | FedEx FORBIDDEN.ERROR on Ship API",
);

console.log("\n=== Secrets to set for sandbox beta (pick one path) ===");
console.log("Path A — fake labels (no FedEx calls):");
console.log("  FEDEX_ENV=sandbox");
console.log("  SHIPPING_TEST_MODE=1");
console.log("  APP_URL=<your *.vercel.app staging URL>");
console.log("  (FedEx keys optional in this path)");
console.log("\nPath B — real FedEx sandbox labels:");
console.log("  FEDEX_ENV=sandbox");
console.log("  FEDEX_CLIENT_ID=<sandbox test key>");
console.log("  FEDEX_CLIENT_SECRET=<sandbox test secret>");
console.log("  FEDEX_ACCOUNT_NUMBER=740561073  (or your sandbox ship account)");
console.log("  unset SHIPPING_TEST_MODE");
console.log("\nCommand after you provide values:");
console.log(
  `  npx supabase secrets set --project-ref ${PROJECT_REF} FEDEX_ENV=sandbox FEDEX_CLIENT_ID=... FEDEX_CLIENT_SECRET=...`,
);
