/**
 * Assign permanent home bays to paid boxes missing a current assignment.
 * Does NOT change bay_code on boxes that already have one.
 *
 *   node scripts/warehouse-backfill-bays.mjs          # apply
 *   node scripts/warehouse-backfill-bays.mjs --dry-run
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dryRun = process.argv.includes("--dry-run");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
dotenv.config({ path: path.join(root, ".env.smoke"), override: true });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey =
  process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL and SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

async function main() {
  const { data: boxes, error: boxErr } = await supabase
    .from("boxes")
    .select("id, box_number, user_id, checkout_status, status, created_at")
    .eq("checkout_status", "paid")
    .order("created_at", { ascending: true });

  if (boxErr) throw new Error(boxErr.message);

  const { data: assignments, error: asnErr } = await supabase
    .from("bin_storage_assignments")
    .select("box_id, bay_code")
    .eq("is_current", true);

  if (asnErr) throw new Error(asnErr.message);

  const { data: bays, error: bayErr } = await supabase
    .from("storage_bays")
    .select("bay_code")
    .eq("is_active", true)
    .order("bay_code", { ascending: true });

  if (bayErr) throw new Error(bayErr.message);

  const assignedBoxIds = new Set((assignments || []).map((a) => String(a.box_id)));
  const occupiedBays = new Set(
    (assignments || []).map((a) => String(a.bay_code || "").toUpperCase()).filter(Boolean),
  );

  const unassigned = (boxes || []).filter((b) => !assignedBoxIds.has(String(b.id)));
  const freeBays = (bays || [])
    .map((b) => String(b.bay_code || "").toUpperCase())
    .filter((c) => c && !occupiedBays.has(c));

  console.log(`\nPaid boxes: ${boxes?.length || 0}`);
  console.log(`Already have home bay: ${assignedBoxIds.size}`);
  console.log(`Need home bay: ${unassigned.length}`);
  console.log(`Free bays: ${freeBays.join(", ") || "(none)"}\n`);

  if (unassigned.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  if (freeBays.length < unassigned.length) {
    console.error(
      `Not enough free bays (need ${unassigned.length}, have ${freeBays.length}). Add bays in storage_bays first.`,
    );
    process.exit(1);
  }

  const { data: profiles } = await supabase.from("profiles").select("id, email");
  const emailById = Object.fromEntries((profiles || []).map((p) => [p.id, p.email]));

  const plan = unassigned.map((box, i) => ({
    box_id: box.id,
    box_number: box.box_number,
    email: emailById[box.user_id] || box.user_id,
    bay_code: freeBays[i],
  }));

  for (const row of plan) {
    console.log(
      `${dryRun ? "[dry-run] " : ""}Box ${row.box_number} (${row.email}) → home bay ${row.bay_code}`,
    );
  }

  if (dryRun) {
    console.log("\nDry run only — no rows inserted.");
    return;
  }

  const now = new Date().toISOString();
  const inserts = plan.map((row) => ({
    box_id: row.box_id,
    bay_code: row.bay_code,
    status: "assigned",
    assigned_by: "script:warehouse-backfill-bays",
    assigned_at: now,
    is_current: true,
  }));

  const { error: insErr } = await supabase.from("bin_storage_assignments").insert(inserts);
  if (insErr) throw new Error(insErr.message);

  console.log(`\nInserted ${inserts.length} permanent home bay assignment(s).`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
