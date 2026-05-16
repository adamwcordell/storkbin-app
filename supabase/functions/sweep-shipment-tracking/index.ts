import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { fedexAuthorizedJsonHeaders } from "../_shared/fedexRestHeaders.ts";
import { getFedexAccessToken, getFedexApiBaseUrl } from "../_shared/fedexAuth.ts";
import { mapFedexSingleTrackResult, shouldAdvanceShippingStatus } from "../_shared/fedexTrackStatus.ts";
import { applyShipmentLifecycleToBoxes } from "../_shared/applyShipmentLifecycleToBoxes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const POLL_INTERVAL_MS = Math.max(
  60_000,
  Number(Deno.env.get("FEDEX_TRACK_POLL_MIN_INTERVAL_MS") || "") || 6 * 60_000,
);

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  const n = Math.max(1, size);
  for (let i = 0; i < items.length; i += n) {
    out.push(items.slice(i, i + n));
  }
  return out;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const fetchLimit = Math.min(200, Math.max(1, Number(body.fetchLimit) || 120));
    const limit = Math.min(80, Math.max(1, Number(body.limit) || 40));

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: rows, error: loadErr } = await supabase
      .from("shipments")
      .select("id, tracking_number, shipment_direction, shipping_status, carrier, label_status, last_tracking_poll_at")
      .eq("carrier", "fedex")
      .eq("label_status", "created")
      .not("tracking_number", "is", null)
      .neq("shipping_status", "delivered")
      .in("shipping_status", ["label_created", "in_transit", "out_for_delivery", "exception"])
      .order("last_tracking_poll_at", { ascending: true, nullsFirst: true })
      .limit(fetchLimit);

    if (loadErr) {
      return jsonResponse({ error: loadErr.message }, 500);
    }

    const now = Date.now();
    const staleBefore = now - POLL_INTERVAL_MS;
    const shipments = ((rows || []) as Array<{
      id: string;
      tracking_number: string;
      shipment_direction: string | null;
      shipping_status: string | null;
      last_tracking_poll_at: string | null;
    }>).filter((s) => {
      if (!s.last_tracking_poll_at) return true;
      const t = new Date(s.last_tracking_poll_at).getTime();
      return t < staleBefore;
    }).slice(0, limit);

    if (shipments.length === 0) {
      await supabase.from("beta_ops_heartbeat").upsert(
        {
          id: "tracking_sweep",
          last_run_at: new Date().toISOString(),
          last_summary: { polled: 0, updated: 0, batches: 0, candidates: 0 },
        },
        { onConflict: "id" },
      );
      return jsonResponse({ ok: true, polled: 0, updated: 0, batches: 0 });
    }

    let token: string;
    try {
      token = await getFedexAccessToken();
    } catch (e) {
      return jsonResponse(
        { error: e instanceof Error ? e.message : String(e) },
        502,
      );
    }

    const base = getFedexApiBaseUrl();
    const byTn = new Map<string, typeof shipments[0][]>();
    for (const s of shipments) {
      const tn = String(s.tracking_number || "").trim();
      if (!tn) continue;
      if (!byTn.has(tn)) byTn.set(tn, []);
      byTn.get(tn)!.push(s);
    }

    const uniqueTns = [...byTn.keys()];
    const batches = chunk(uniqueTns, 30);
    let updated = 0;

    for (const batch of batches) {
      const trackingInfo = batch.map((trackingNumber) => ({
        trackingNumberInfo: { trackingNumber },
      }));

      const res = await fetch(`${base}/track/v1/trackingnumbers`, {
        method: "POST",
        headers: fedexAuthorizedJsonHeaders(token),
        body: JSON.stringify({
          includeDetailedScans: true,
          trackingInfo,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("FedEx track batch failed", res.status, payload);
        continue;
      }

      const output = (payload as Record<string, unknown>)?.output as Record<string, unknown> | undefined;
      const complete = output?.completeTrackResults as Array<Record<string, unknown>> | undefined;

      for (const entry of complete || []) {
        const trackResults = entry?.trackResults as Array<Record<string, unknown>> | undefined;
        for (const tr of trackResults || []) {
          const tni = tr?.trackingNumberInfo as Record<string, unknown> | undefined;
          const tn = String(tni?.trackingNumber || tr?.trackingNumber || "").trim();
          if (!tn) continue;

          const mapped = mapFedexSingleTrackResult(tr as Record<string, unknown>);

          const shipList = byTn.get(tn);
          if (!shipList) continue;

          for (const ship of shipList) {
            const current = String(ship.shipping_status || "label_created");
            const next = mapped.status;

            if (!next || !shouldAdvanceShippingStatus(current, next)) {
              await supabase
                .from("shipments")
                .update({
                  last_tracking_poll_at: new Date().toISOString(),
                  ...(mapped.detail
                    ? { carrier_tracking_last_detail: mapped.detail.slice(0, 500) }
                    : {}),
                })
                .eq("id", ship.id);
              continue;
            }

            const { data: fresh, error: upErr } = await supabase
              .from("shipments")
              .update({
                shipping_status: next,
                last_tracking_poll_at: new Date().toISOString(),
                carrier_tracking_last_detail: mapped.detail?.slice(0, 500) || null,
              })
              .eq("id", ship.id)
              .select("*")
              .single();

            if (upErr) {
              console.error("shipment tracking update", ship.id, upErr.message);
              continue;
            }

            updated += 1;
            await applyShipmentLifecycleToBoxes(supabase, fresh, next);
          }
        }
      }
    }

    await supabase.from("beta_ops_heartbeat").upsert(
      {
        id: "tracking_sweep",
        last_run_at: new Date().toISOString(),
        last_summary: {
          candidates: shipments.length,
          uniqueTracking: uniqueTns.length,
          batches: batches.length,
          updated,
        },
      },
      { onConflict: "id" },
    );

    return jsonResponse({
      ok: true,
      candidates: shipments.length,
      uniqueTracking: uniqueTns.length,
      batches: batches.length,
      updated,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
