/**
 * One-shot domestic US quote with FEDEX_RATE_DEBUG export to fedex_rate_debug.json at repo root.
 *
 * Prereqs in env or ../.env :
 *   FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET
 *   FEDEX_ACCOUNT_NUMBER (recommended for ACCOUNT+LIST attempt)
 *   FEDEX_ENV=sandbox|production (optional; defaults sandbox)
 * Optional Ground Economy / SmartPost supplemental quotes (after main FDXG quote):
 *   FEDEX_ENABLE_GROUND_ECONOMY_PROBES=true
 *
 * From repo root:
 *   deno run --allow-net --allow-env --allow-read --allow-write scripts/fedex-rate-debug-once.mts
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

try {
  await load({ export: true, envPath: join(repoRoot, ".env") });
} catch {
  /* optional */
}

const outfile = join(repoRoot, "fedex_rate_debug.json");
Deno.env.set("FEDEX_RATE_DEBUG", "1");
Deno.env.set("FEDEX_RATE_DEBUG_OUTFILE", outfile);

const { getShippingQuote } = await import(
  new URL("../supabase/functions/_shared/fedexShippingRates.ts", import.meta.url).href
);

await getShippingQuote({
  boxId: "fedex-rate-debug-once",
  direction: "to_customer",
  shippingAddress: {
    address_line1: "1600 Amphitheatre Pkwy",
    city: "Mountain View",
    state: "CA",
    zip: "94043",
    country_code: "US",
  },
  packageProfile: "to_customer_full",
});

console.log(`OK — wrote ${outfile}`);
