import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { applyShipmentLifecycleToBoxes } from "../_shared/applyShipmentLifecycleToBoxes.ts";
import { purchaseFedexLabelForShipment } from "../_shared/fedexPurchaseLabel.ts";

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

const adminEmails = () =>
  (Deno.env.get("ADMIN_EMAILS") || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

const requireAdminSupabase = async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return { error: jsonResponse({ error: "Missing Supabase configuration" }, 500) };
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { error: jsonResponse({ error: "Missing auth token" }, 401) };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: authUser, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authUser?.user) {
    return { error: jsonResponse({ error: "Invalid auth token" }, 401) };
  }
  const email = String(authUser.user.email || "").trim().toLowerCase();
  if (!adminEmails().includes(email)) {
    return { error: jsonResponse({ error: "Admin access required" }, 403) };
  }

  return { supabase, adminEmail: email };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const gate = await requireAdminSupabase(req);
  if ("error" in gate) return gate.error;
  const { supabase } = gate;

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    if (action === "health") {
      const selShort =
        "id,box_id,shipping_status,charge_status,label_status,label_failure_reason,tracking_number,tracking_url,label_url,last_tracking_poll_at,carrier_tracking_last_detail,created_at,label_purchased_at,charge_attempted_at";

      const [f1, f2, paidNoLabel, stuckLabel, exceptions, overages, heart] = await Promise.all([
        supabase.from("shipments").select(selShort).eq("label_status", "purchase_failed").order("created_at", {
          ascending: false,
        }).limit(40),
        supabase.from("shipments").select(selShort).eq("charge_status", "paid").not("label_failure_reason", "is", null)
          .order("created_at", { ascending: false }).limit(40),
        supabase.from("shipments").select(selShort).eq("charge_status", "paid").eq("shipping_status", "paid").or(
          "label_status.eq.needed,label_status.is.null",
        ).order("created_at", { ascending: false }).limit(40),
        supabase.from("shipments").select(selShort).eq("shipping_status", "label_created").order("label_purchased_at", {
          ascending: true,
          nullsFirst: true,
        }).limit(40),
        supabase.from("shipments").select(selShort).eq("shipping_status", "exception").order("last_tracking_poll_at", {
          ascending: false,
          nullsFirst: true,
        }).limit(30),
        supabase.from("shipping_overage_events").select(
          "id,shipment_id,box_id,detection_status,created_at,overage_amount_cents",
        ).eq("detection_status", "detected").order("created_at", { ascending: false }).limit(50),
        supabase.from("beta_ops_heartbeat").select("*").in("id", ["tracking_sweep", "safety_rails"]),
      ]);

      const err =
        f1.error || f2.error || paidNoLabel.error || stuckLabel.error || exceptions.error || overages.error ||
        heart.error;
      if (err) return jsonResponse({ error: err.message }, 500);

      const failMap = new Map<string, Record<string, unknown>>();
      for (const r of [...(f1.data || []), ...(f2.data || [])] as Record<string, unknown>[]) {
        failMap.set(String(r.id), r);
      }

      return jsonResponse({
        ok: true,
        failedLabelPurchases: [...failMap.values()],
        paidShipmentsMissingLabels: paidNoLabel.data || [],
        stuckLabelCreated: stuckLabel.data || [],
        carrierExceptionShipments: exceptions.data || [],
        unresolvedOverageEvents: overages.data || [],
        heartbeats: heart.data || [],
        stripeWebhookFailuresNote:
          "Stripe does not expose recent webhook failures to this app. Use Stripe Dashboard → Developers → Webhooks → your endpoint → Recent deliveries.",
      });
    }

    if (action === "retry_label") {
      const shipmentId = String(body.shipmentId || "").trim();
      if (!shipmentId) return jsonResponse({ error: "shipmentId is required" }, 400);
      const result = await purchaseFedexLabelForShipment(supabase, shipmentId, { source: "admin" });
      if (!result.ok) {
        const status = result.preconditionFailed ? 400 : 502;
        return jsonResponse({ error: result.error, preconditionFailed: Boolean(result.preconditionFailed) }, status);
      }
      if ("skipped" in result) return jsonResponse({ ok: true, skipped: result.skipped, shipmentId });
      return jsonResponse({ ok: true, shipment: result.shipment, trackingNumber: result.trackingNumber });
    }

    if (action === "override_shipping_status") {
      const shipmentId = String(body.shipmentId || "").trim();
      const next = String(body.shippingStatus || "").trim().toLowerCase();
      if (!shipmentId) return jsonResponse({ error: "shipmentId is required" }, 400);
      if (next !== "in_transit" && next !== "delivered") {
        return jsonResponse({ error: "shippingStatus must be in_transit or delivered" }, 400);
      }

      const { data: ship, error: gErr } = await supabase.from("shipments").select("*").eq("id", shipmentId).single();
      if (gErr || !ship) return jsonResponse({ error: gErr?.message || "Shipment not found" }, 404);

      const { data: updated, error: uErr } = await supabase
        .from("shipments")
        .update({
          shipping_status: next,
        })
        .eq("id", shipmentId)
        .select("*")
        .single();

      if (uErr || !updated) return jsonResponse({ error: uErr?.message || "update failed" }, 500);

      await applyShipmentLifecycleToBoxes(supabase, updated, next);
      return jsonResponse({ ok: true, shipment: updated });
    }

    if (action === "suppress_rail_alerts") {
      const shipmentId = String(body.shipmentId || "").trim();
      const hours = Math.min(24 * 90, Math.max(1, Number(body.hours) || 168));
      if (!shipmentId) return jsonResponse({ error: "shipmentId is required" }, 400);
      const until = new Date(Date.now() + hours * 3600_000).toISOString();
      const { error: uErr } = await supabase
        .from("shipments")
        .update({ admin_suppress_rail_alerts_until: until })
        .eq("id", shipmentId);
      if (uErr) return jsonResponse({ error: uErr.message }, 500);
      return jsonResponse({ ok: true, admin_suppress_rail_alerts_until: until });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
