/**
 * Pre–first-paying-beta checklist: prints manual steps + runs a few automated checks.
 *
 *   npm run prebeta:check
 *
 * Uses repo root `.env.smoke` (same as beta:smoke): service role + optional admin JWT + Stripe secret.
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env.smoke");

console.log("=== StorkBin pre–paid-beta checklist ===\n");

if (!fs.existsSync(envPath)) {
  console.log("No .env.smoke — run:  npm run beta:smoke:setup\n");
} else {
  dotenv.config({ path: envPath });
}

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || "wslymzcbbevnoybbsbgq";
const url = process.env.SUPABASE_URL?.trim() || `https://${projectRef}.supabase.co`;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const adminJwt = process.env.ADMIN_SMOKE_JWT?.trim();
const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();

const manual = [
  "Supabase Dashboard → Edge Functions → Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_BIN_MONTHLY_PRICE_ID, SUPABASE_URL, SERVICE_ROLE_KEY, FedEx vars, RESEND_*, ADMIN_EMAILS.",
  "Stripe Live: webhook endpoint → https://" + projectRef + ".supabase.co/functions/v1/stripe-webhook ; signing secret → STRIPE_WEBHOOK_SECRET.",
  "Deploy functions (at minimum): stripe-webhook, purchase-shipping-label, finalize-customer-shipping-checkout, sweep-shipment-tracking, beta-safety-rails, beta-ops-admin, shipping-overage-admin.",
  "Schedule POST sweep-shipment-tracking (service role JWT) every 10–15 minutes (see curl below).",
  "Schedule POST beta-safety-rails (service role JWT) hourly or daily.",
  "FedEx: run one real production label on an internal test shipment.",
  "Send a test Resend email (e.g. trigger overage or verify RESEND_FROM_EMAIL in Dashboard).",
  "Supabase: Database → beta_ops_heartbeat row id=tracking_sweep — last_run_at should advance after each sweep.",
];

console.log("— Manual confirmations (cannot be fully automated from this repo) —\n");
manual.forEach((line, i) => console.log(`${i + 1}. ${line}`));
console.log("");

if (!serviceKey) {
  console.log("Automated checks skipped: SUPABASE_SERVICE_ROLE_KEY missing in .env.smoke\n");
  process.exit(0);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

async function edgePost(name, body, bearer) {
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      apikey: bearer,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

console.log("— Automated —\n");

const { data: hb, error: hbErr } = await supabase.from("beta_ops_heartbeat").select("*").in("id", ["tracking_sweep", "safety_rails"]);
if (hbErr) {
  console.log("beta_ops_heartbeat:", hbErr.message, "(run migrations if table missing)");
} else {
  console.log("Heartbeat rows:", JSON.stringify(hb || [], null, 2));
  const sweepRow = (hb || []).find((r) => r.id === "tracking_sweep");
  if (!sweepRow?.last_run_at) {
    console.log("FAIL  tracking_sweep heartbeat: no row or last_run_at (sweep never completed after deploy?)");
  } else {
    const ageMin = (Date.now() - new Date(sweepRow.last_run_at).getTime()) / 60_000;
    const slack = 22;
    if (ageMin <= slack) {
      console.log(`PASS  tracking_sweep heartbeat fresh (${ageMin.toFixed(1)} min ≤ ${slack} min — cron likely OK)`);
    } else {
      console.log(
        `FAIL  tracking_sweep heartbeat stale (${ageMin.toFixed(1)} min > ${slack} min) — verify cron or POST sweep manually`,
      );
    }
  }
}

console.log(`
— Schedule tracking sweep (every 10–15 min) — use service_role key from Dashboard → Settings → API:

curl -sS -X POST "${url}/functions/v1/sweep-shipment-tracking" -H "Authorization: Bearer SERVICE_ROLE_KEY" -H "apikey: SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\\"limit\\":40,\\"fetchLimit\\":120}"

Supabase Dashboard: Integrations → Cron (or Database → cron if enabled) → HTTP POST to that URL with the same headers; or GitHub Actions schedule / external cron.
`);

for (const fn of ["sweep-shipment-tracking", "beta-safety-rails"]) {
  const r = await edgePost(fn, {}, serviceKey);
  const deployed = r.status !== 404;
  console.log(`${deployed ? "OK " : "FAIL"}  ${fn} reachable (HTTP ${r.status})`);
}

const probeAdmin = await edgePost("beta-ops-admin", { action: "health" }, serviceKey);
if (probeAdmin.status === 404) {
  console.log("FAIL beta-ops-admin not deployed (HTTP 404)");
} else if (probeAdmin.status === 401 || probeAdmin.status === 403) {
  console.log("OK  beta-ops-admin deployed (JWT required as expected for service key)");
} else {
  console.log(`WARN beta-ops-admin HTTP ${probeAdmin.status}`);
}

if (adminJwt) {
  const h = await edgePost("beta-ops-admin", { action: "health" }, adminJwt);
  console.log(h.ok ? "OK  beta-ops-admin health (admin JWT)" : `FAIL beta-ops-admin health: ${h.status} ${JSON.stringify(h.json).slice(0, 200)}`);
} else {
  console.log("SKIP beta-ops-admin health payload (set ADMIN_SMOKE_JWT for full JSON check)");
}

if (stripeSecret) {
  try {
    const stripe = new Stripe(stripeSecret);
    await stripe.balance.retrieve();
    console.log("OK  Stripe API (balance.retrieve)");
  } catch (e) {
    console.log("FAIL Stripe API:", e?.message || e);
  }
} else {
  console.log("SKIP Stripe API (STRIPE_SECRET_KEY not set)");
}

console.log("\nThen run:  npm run beta:smoke\n");
