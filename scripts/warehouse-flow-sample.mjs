/**
 * Seeds a warehouse lifecycle test bin (service role) and prints admin URLs.
 *
 *   node scripts/warehouse-flow-sample.mjs
 *
 * Requires in .env.smoke or environment:
 *   SUPABASE_URL, SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY)
 *
 * Does NOT delete existing bins. Tags rows with internal_id prefix WH-FLOW-TEST.
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
dotenv.config({ path: path.join(root, ".env.smoke"), override: true });
dotenv.config({ path: path.join(root, ".env"), override: false });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey =
  process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL and SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const testEmail = `warehouse-flow+${stamp}@storkbin.test`;

async function pickBay() {
  const { data: bays } = await supabase
    .from("storage_bays")
    .select("bay_code")
    .eq("is_active", true)
    .order("bay_code", { ascending: true });
  const { data: occupied } = await supabase
    .from("bin_storage_assignments")
    .select("bay_code")
    .eq("is_current", true);
  const occ = new Set((occupied || []).map((r) => String(r.bay_code)));
  const free = (bays || []).map((b) => String(b.bay_code)).filter((c) => c && !occ.has(c));
  return free[0] || "A1";
}

async function main() {
  console.log("\n=== StorkBin warehouse flow sample ===\n");

  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email: testEmail,
    email_confirm: true,
    password: `WhFlow!${stamp}`,
  });
  if (authErr || !authUser?.user?.id) {
    console.error("Could not create test user:", authErr?.message || "unknown");
    process.exit(1);
  }
  const userId = authUser.user.id;

  const bayCode = await pickBay();
  const now = new Date().toISOString();

  const boxId = randomUUID();
  const { data: box, error: boxErr } = await supabase
    .from("boxes")
    .insert({
      id: boxId,
      user_id: userId,
      box_number: "WH-TEST",
      status: "stored",
      fulfillment_status: "stored",
      checkout_status: "paid",
      lifecycle_status: "active",
      subscription_lifecycle_status: "active",
      subscription_payment_status: "paid",
    })
    .select("*")
    .single();

  if (boxErr || !box?.id) {
    console.error("Could not create test box:", boxErr?.message);
    process.exit(1);
  }

  const { data: asn, error: asnErr } = await supabase
    .from("bin_storage_assignments")
    .insert({
      box_id: box.id,
      bay_code: bayCode,
      status: "assigned",
      assigned_by: "script:warehouse-flow-sample",
      assigned_at: now,
      is_current: true,
    })
    .select("*")
    .single();

  if (asnErr) {
    console.error("Could not assign home bay:", asnErr.message);
    process.exit(1);
  }

  console.log("Created test customer:", testEmail);
  console.log("Box id:", box.id);
  console.log("Home bay:", bayCode, "(permanent)");
  console.log("Assignment status:", asn.status);
  console.log("\n--- Manual test URLs (log in as admin) ---");
  console.log(`Admin intake:  ${appUrl}/admin/intake/${box.id}`);
  console.log(`Bin scan QR:   ${appUrl}/scan/${box.id}?customer=1`);
  console.log(`Storage bays:  ${appUrl}/admin/storage-bays`);
  console.log(`Bay sticker:   ${appUrl}/bay/${bayCode}?admin=1`);
  console.log("\n--- Suggested flow ---");
  console.log("1. Admin → Receive bin (scan) or open intake URL");
  console.log("2. See Home bay", bayCode);
  console.log("3. Place bin → scan bin QR + scan bay QR");
  console.log("4. Assignment → placed, box → stored");
  console.log("\nTo test send-bin pick: create to_customer shipment on this box from customer app.");
  console.log("Do NOT clear all bins — this test row is isolated.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
