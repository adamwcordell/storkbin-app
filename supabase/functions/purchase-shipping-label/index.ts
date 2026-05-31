import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { purchaseFedexLabelForShipment } from "../_shared/fedexPurchaseLabel.ts";
import { withFedexShipMeta } from "../_shared/fedexShippingRates.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const adminEmails = (Deno.env.get("ADMIN_EMAILS") || "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" }, 500);
    }

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const token = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return jsonResponse({ error: "Missing auth token" }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: authUser, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authUser?.user) {
      return jsonResponse({ error: "Invalid auth token" }, 401);
    }
    if (!adminEmails.includes(String(authUser.user.email || "").trim().toLowerCase())) {
      return jsonResponse({ error: "Admin access required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const shipmentId = String(body.shipmentId || "").trim();
    if (!shipmentId) return jsonResponse({ error: "shipmentId is required" }, 400);

    const fedexServiceType = String(body.fedexServiceType || "").trim();
    const fedexServiceName = String(body.fedexServiceName || "").trim();
    const selectedRateAmountUsd = Number(body.selectedRateAmountUsd);
    const dimensionsConfirmed = body.dimensionsConfirmed === true;

    if (fedexServiceType || dimensionsConfirmed) {
      if (!fedexServiceType || !Number.isFinite(selectedRateAmountUsd) || selectedRateAmountUsd <= 0) {
        return jsonResponse(
          { error: "fedexServiceType and selectedRateAmountUsd are required when saving label options" },
          400,
        );
      }
      if (!dimensionsConfirmed) {
        return jsonResponse({ error: "dimensionsConfirmed must be true before purchasing a label" }, 400);
      }

      const { data: shipment, error: shipErr } = await supabase
        .from("shipments")
        .select("id,shipping_address")
        .eq("id", shipmentId)
        .maybeSingle();
      if (shipErr) return jsonResponse({ error: shipErr.message }, 500);
      if (!shipment) return jsonResponse({ error: "Shipment not found" }, 404);

      const merged = withFedexShipMeta((shipment.shipping_address || {}) as Record<string, unknown>, {
        serviceType: fedexServiceType,
        serviceName: fedexServiceName || fedexServiceType,
        estimatedDeliveryDate: body.estimatedDeliveryDate ? String(body.estimatedDeliveryDate) : null,
        estimatedDeliveryWeekday: body.estimatedDeliveryWeekday
          ? String(body.estimatedDeliveryWeekday)
          : null,
        transitTimeRaw: body.transitTimeRaw ? String(body.transitTimeRaw) : null,
        deliverySummary: body.deliverySummary ? String(body.deliverySummary) : null,
      });

      const { error: upErr } = await supabase
        .from("shipments")
        .update({
          shipping_address: merged,
          shipping_cost: selectedRateAmountUsd,
          shipping_estimate: selectedRateAmountUsd,
        })
        .eq("id", shipmentId);
      if (upErr) return jsonResponse({ error: upErr.message }, 500);
    }

    const result = await purchaseFedexLabelForShipment(supabase, shipmentId, { source: "admin" });
    if (!result.ok) {
      const status = result.preconditionFailed ? 400 : 502;
      return jsonResponse({ error: result.error, preconditionFailed: Boolean(result.preconditionFailed) }, status);
    }
    if ("skipped" in result) {
      return jsonResponse({ ok: true, skipped: result.skipped, shipmentId });
    }

    return jsonResponse({
      ok: true,
      shipment: result.shipment,
      trackingNumber: result.trackingNumber,
      trackingUrl: result.trackingUrl,
      labelMimeType: result.labelDataUrl?.startsWith("data:application/pdf") ? "application/pdf" : null,
      labelDataUrl: result.labelDataUrl,
      provider: "fedex",
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
