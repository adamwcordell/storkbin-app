import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  labelDataUrlToPdfBase64,
  resendBinsShippedToStorageEmail,
  resolveShipmentCustomerEmail,
} from "../_shared/customerEmails.ts";

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

const FEDEX_TRACK_BASE_URL = "https://www.fedex.com/fedextrack/?trknbr=";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Supabase configuration" }, 500);
    }

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const token = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "Missing auth token" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: authUser, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authUser?.user?.id) {
      return jsonResponse({ error: "Invalid auth token" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const shipmentId = String(body.shipmentId || "").trim();
    if (!shipmentId) return jsonResponse({ error: "shipmentId is required" }, 400);

    const { data: shipment, error: shipErr } = await supabase
      .from("shipments")
      .select("id,box_id,user_id,shipment_direction,shipping_status,label_status,tracking_number,tracking_url,label_url")
      .eq("id", shipmentId)
      .maybeSingle();

    if (shipErr) return jsonResponse({ error: shipErr.message }, 500);
    if (!shipment) return jsonResponse({ error: "Shipment not found" }, 404);

    if (String(shipment.user_id || "") !== String(authUser.user.id)) {
      return jsonResponse({ error: "This shipment does not belong to your account" }, 403);
    }

    if (String(shipment.shipment_direction || "") !== "to_storage") {
      return jsonResponse({ error: "This is not a return-to-storage shipment" }, 400);
    }

    if (String(shipment.shipping_status || "") !== "label_created") {
      return jsonResponse(
        {
          error:
            "Return label email can only be resent before FedEx scans your package (while the label is waiting for drop-off).",
        },
        400,
      );
    }

    const trackingNumber = String(shipment.tracking_number || "").trim();
    if (!trackingNumber) {
      return jsonResponse({ error: "This shipment does not have a tracking number yet" }, 400);
    }

    const customerEmail = await resolveShipmentCustomerEmail(supabase, shipment as Record<string, unknown>);
    if (!customerEmail) {
      return jsonResponse({ error: "Could not resolve your email address for this shipment" }, 400);
    }

    const trackingUrl =
      String(shipment.tracking_url || "").trim() ||
      `${FEDEX_TRACK_BASE_URL}${encodeURIComponent(trackingNumber)}`;

    const result = await resendBinsShippedToStorageEmail(supabase, {
      userId: authUser.user.id,
      shipmentId,
      customerEmail,
      trackingNumber,
      trackingUrl,
      labelPdfBase64: labelDataUrlToPdfBase64(shipment.label_url),
      boxId: shipment.box_id ? String(shipment.box_id) : null,
      labelUrl: shipment.label_url ? String(shipment.label_url) : null,
    });

    if (!result.ok) {
      return jsonResponse(
        { error: result.error || result.skipped || "Could not resend return label email" },
        502,
      );
    }

    return jsonResponse({
      ok: true,
      sentTo: customerEmail,
      trackingNumber,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
