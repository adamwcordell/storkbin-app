import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { applyShipmentLifecycleToBoxes } from "../_shared/applyShipmentLifecycleToBoxes.ts";
import { notifyCustomerOnShipmentDelivered } from "../_shared/customerEmails.ts";

const FEDEX_TRACK_BASE_URL = "https://www.fedex.com/fedextrack/?trknbr=";

const mockLabelPageUrl = (trackingNumber: string) => {
  const appBase = (Deno.env.get("APP_URL") || "https://storkbin-app.vercel.app").replace(/\/$/, "");
  return `${appBase}/labels/${encodeURIComponent(trackingNumber)}`;
};

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

const randomAlphaNumeric = (length = 12) =>
  Array.from({ length }, () => Math.floor(Math.random() * 36).toString(36))
    .join("")
    .toUpperCase();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const shipmentId = String(body.shipmentId || "").trim();
    const action = String(body.action || "advance").trim();
    if (!shipmentId) return jsonResponse({ error: "shipmentId is required" }, 400);

    const { data: shipment, error: shipmentErr } = await supabase
      .from("shipments")
      .select("*")
      .eq("id", shipmentId)
      .maybeSingle();

    if (shipmentErr) return jsonResponse({ error: shipmentErr.message }, 500);
    if (!shipment) return jsonResponse({ error: "Shipment not found" }, 404);

    const now = new Date().toISOString();
    const trackingNumber = shipment.tracking_number || `MOCK-FDX-${randomAlphaNumeric(12)}`;
    const trackingUrl = `${FEDEX_TRACK_BASE_URL}${encodeURIComponent(trackingNumber)}`;
    const labelUrl = mockLabelPageUrl(trackingNumber);

    let nextShippingStatus = String(shipment.shipping_status || "paid");
    const currentShippingStatus = String(shipment.shipping_status || "paid");
    const hasLabelArtifact = Boolean(
      shipment.label_url || shipment.tracking_number || shipment.tracking_url
    );
    if (action === "set_label_created") {
      nextShippingStatus = "label_created";
    } else if (action === "set_in_transit") {
      nextShippingStatus = "in_transit";
    } else if (action === "set_delivered") {
      nextShippingStatus = "delivered";
    } else {
      if (nextShippingStatus === "paid" || nextShippingStatus === "pending_payment") {
        nextShippingStatus = "label_created";
      } else if (nextShippingStatus === "label_created") {
        nextShippingStatus = "in_transit";
      } else if (nextShippingStatus === "in_transit") {
        nextShippingStatus = "out_for_delivery";
      } else if (nextShippingStatus === "out_for_delivery") {
        nextShippingStatus = "delivered";
      }
    }

    // Enforce strict lifecycle: no shipping movement before label is created.
    if (nextShippingStatus === "in_transit") {
      const allowFrom =
        currentShippingStatus === "label_created" || currentShippingStatus === "in_transit";
      if (!allowFrom && !hasLabelArtifact) {
        return jsonResponse(
          {
            error:
              "Cannot mark in_transit before label creation. Generate/match label first.",
          },
          400,
        );
      }
    }

    if (nextShippingStatus === "delivered") {
      const allowFrom =
        currentShippingStatus === "in_transit" ||
        currentShippingStatus === "out_for_delivery" ||
        currentShippingStatus === "delivered";
      if (!allowFrom) {
        return jsonResponse(
          {
            error:
              "Cannot mark delivered before in_transit. Move shipment to in_transit first.",
          },
          400,
        );
      }
    }

    const shipmentUpdates: Record<string, unknown> = {
      shipping_status: nextShippingStatus,
    };

    if (nextShippingStatus === "label_created") {
      shipmentUpdates.carrier = "fedex";
      shipmentUpdates.charge_status = "paid";
      shipmentUpdates.charge_attempted_at = now;
      shipmentUpdates.charge_failure_reason = null;
      shipmentUpdates.label_status = "created";
      shipmentUpdates.tracking_number = trackingNumber;
      shipmentUpdates.tracking_url = trackingUrl;
      shipmentUpdates.label_url = labelUrl;
    }

    const { data: updatedShipment, error: updateErr } = await supabase
      .from("shipments")
      .update(shipmentUpdates)
      .eq("id", shipmentId)
      .select("*")
      .single();

    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    await applyShipmentLifecycleToBoxes(supabase, updatedShipment, nextShippingStatus);

    if (nextShippingStatus === "delivered") {
      try {
        await notifyCustomerOnShipmentDelivered(supabase, updatedShipment as Record<string, unknown>);
      } catch (emailErr) {
        console.warn("customer delivered email (simulator)", emailErr);
      }
    }

    return jsonResponse({
      ok: true,
      shipment: updatedShipment,
      simulated: true,
      nextShippingStatus,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
