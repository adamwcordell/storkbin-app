/**
 * Internal FedEx Rate API probe (JWT off). Requires matching FEDEX_RATE_PROBE_SECRET in the JSON body.
 * Use only to diagnose FORBIDDEN / scope issues; remove or rotate the secret when done.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { getShippingQuote } from "../_shared/fedexShippingRates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expected = (Deno.env.get("FEDEX_RATE_PROBE_SECRET") || "").trim();
  if (!expected) {
    return json({ error: "FEDEX_RATE_PROBE_SECRET is not set on this project." }, 503);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const probeSecret = String(body.probeSecret || "").trim();
  if (probeSecret !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const quote = await getShippingQuote({
      boxId: "probe",
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
    return json({ ok: true, quote });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, message }, 200);
  }
});
