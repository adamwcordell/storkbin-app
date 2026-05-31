import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { autoPurchaseShippingLabelsForIds } from "../_shared/fedexPurchaseLabel.ts";
import { notifyBinRequestedEmails } from "../_shared/customerEmails.ts";

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

const parseCsvIds = (raw: string | null | undefined): string[] =>
  String(raw || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

const getStripeId = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return String((value as { id: string }).id || "");
  }
  return "";
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing server configuration" }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return jsonResponse({ error: "Missing user session" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user?.id) {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }

    const userId = userData.user.id;
    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) return jsonResponse({ error: "sessionId is required" }, 400);

    const sessionRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: { Authorization: `Bearer ${stripeSecretKey}` },
      },
    );
    const session = await sessionRes.json().catch(() => ({}));
    if (!sessionRes.ok) {
      return jsonResponse({ error: session?.error?.message || "Could not load Checkout session" }, 400);
    }

    if (String(session.payment_status || "") !== "paid") {
      return jsonResponse({ ok: true, skipped: true, reason: "session not paid" });
    }

    const metadata = session.metadata || {};
    if (String(metadata.flow || "") !== "customer_shipping") {
      return jsonResponse({ ok: true, skipped: true, reason: "not a customer shipping session" });
    }

    if (String(metadata.supabase_user_id || "") !== userId) {
      return jsonResponse({ error: "This checkout does not belong to the signed-in user" }, 403);
    }

    const shipmentIds = parseCsvIds(metadata.shipment_ids);
    if (shipmentIds.length === 0) {
      return jsonResponse({ error: "Session missing shipment_ids" }, 400);
    }

    const paymentIntentId = getStripeId(session.payment_intent);

    const { data: shipments, error: shipmentLookupError } = await supabase
      .from("shipments")
      .select("id,box_id,shipment_direction,charge_status")
      .in("id", shipmentIds);

    if (shipmentLookupError) {
      return jsonResponse({ error: shipmentLookupError.message }, 500);
    }

    if (!shipments || shipments.length !== shipmentIds.length) {
      return jsonResponse({ error: "One or more shipments not found" }, 400);
    }

    for (const shipment of shipments as Array<Record<string, unknown>>) {
      const direction = String(shipment.shipment_direction || "");
      const fulfillmentStatus =
        direction === "to_customer"
          ? "ready_to_ship_to_customer"
          : direction === "to_storage"
            ? "awaiting_customer_dropoff"
            : null;

      if (!fulfillmentStatus) {
        return jsonResponse({ error: `Unsupported shipment direction: ${direction}` }, 400);
      }

      if (shipment.charge_status !== "paid") {
        const { error: shipmentUpdateError } = await supabase
          .from("shipments")
          .update({
            shipping_status: "paid",
            charge_status: "paid",
            charge_attempted_at: new Date().toISOString(),
            charge_failure_reason: null,
            label_status: "needed",
            stripe_payment_intent_id: paymentIntentId || null,
          })
          .eq("id", shipment.id);

        if (shipmentUpdateError) {
          return jsonResponse({ error: shipmentUpdateError.message }, 500);
        }
      }

      const { error: boxUpdateError } = await supabase
        .from("boxes")
        .update({
          checkout_status: "paid",
          cart_type: null,
          requested_shipping_address: null,
          requested_shipping_address_source: null,
          fulfillment_status: fulfillmentStatus,
        })
        .eq("id", shipment.box_id);

      if (boxUpdateError) {
        return jsonResponse({ error: boxUpdateError.message }, 500);
      }
    }

    const stripeProof: Record<string, unknown> = {};
    if (paymentIntentId) stripeProof.stripe_payment_intent_id = paymentIntentId;
    if (sessionId) stripeProof.stripe_checkout_session_id = sessionId;
    if (Object.keys(stripeProof).length > 0) {
      const { error: stripeProofErr } = await supabase
        .from("shipments")
        .update(stripeProof)
        .in("id", shipmentIds);
      if (stripeProofErr) {
        return jsonResponse({ error: stripeProofErr.message }, 500);
      }
    }

    // autoPurchaseShippingLabelsForIds only buys return (to_storage) labels; outbound to_customer is manual (admin).
    let labelPurchase: unknown = null;
    try {
      labelPurchase = await autoPurchaseShippingLabelsForIds(supabase, shipmentIds);
    } catch (e) {
      console.error("finalize autoPurchaseShippingLabelsForIds", e);
      labelPurchase = { error: e instanceof Error ? e.message : String(e) };
    }

    let binRequestedEmails: unknown = null;
    try {
      binRequestedEmails = await notifyBinRequestedEmails(supabase, shipmentIds);
    } catch (e) {
      console.warn("finalize bin requested emails", e);
    }

    return jsonResponse({
      ok: true,
      finalizedShipments: shipmentIds.length,
      labelPurchase,
      binRequestedEmails,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
