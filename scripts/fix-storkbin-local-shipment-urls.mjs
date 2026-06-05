/**
 * Rewrites shipments.label_url / tracking_url that still point at storkbin.local.
 *
 * Usage: node scripts/fix-storkbin-local-shipment-urls.mjs
 * Env:   .env.smoke (SUPABASE_URL + SERVICE_ROLE_KEY)
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(root, ".env.smoke"), override: true });

const APP_BASE = (process.env.APP_URL || "https://storkbin-app.vercel.app").replace(/\/$/, "");

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const rewrite = (url, tracking) => {
  const raw = String(url || "").trim();
  if (!raw.includes("storkbin.local")) return null;

  if (/\/labels\//i.test(raw)) {
    const ref = raw.match(/\/labels\/([^/?#]+)/i)?.[1] || tracking;
    return `${APP_BASE}/labels/${encodeURIComponent(decodeURIComponent(ref))}`;
  }
  if (/\/track\//i.test(raw)) {
    const ref = raw.match(/\/track\/([^/?#]+)/i)?.[1] || tracking;
    return `${APP_BASE}/track/${encodeURIComponent(decodeURIComponent(ref))}`;
  }
  return null;
};

const { data: rows, error } = await sb
  .from("shipments")
  .select("id, tracking_number, label_url, tracking_url")
  .or("label_url.ilike.%storkbin.local%,tracking_url.ilike.%storkbin.local%");

if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}

if (!rows?.length) {
  console.log("No shipments with storkbin.local URLs.");
  process.exit(0);
}

for (const row of rows) {
  const tracking = String(row.tracking_number || "").trim();
  const nextLabel = rewrite(row.label_url, tracking);
  const nextTrack = rewrite(row.tracking_url, tracking);
  const patch = {};
  if (nextLabel) patch.label_url = nextLabel;
  if (nextTrack) patch.tracking_url = nextTrack;
  if (!Object.keys(patch).length) continue;

  const { error: upErr } = await sb.from("shipments").update(patch).eq("id", row.id);
  if (upErr) {
    console.error(row.id, upErr.message);
    continue;
  }
  console.log("updated", row.id.slice(0, 8), tracking, patch);
}

console.log("Done.");
