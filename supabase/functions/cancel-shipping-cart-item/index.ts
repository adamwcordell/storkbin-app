import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Supabase service role configuration" }, 500);
    }

    const body = await req.json();
    const userId = String(body.userId || "").trim();
    const boxId = String(body.boxId || "").trim();
    const cleanupOrphans = body.cleanupOrphans === true;

    if (!userId) {
      return jsonResponse({ error: "userId is required" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    let boxIds: string[] = [];
    let directionByBoxId = new Map<string, string | null>();

    if (boxId) {
      const { data: box, error: boxError } = await supabase
        .from("boxes")
        .select("id,user_id,cart_type")
        .eq("id", boxId)
        .eq("user_id", userId)
        .single();

      if (boxError || !box) {
        return jsonResponse({ error: "Box not found for user" }, 404);
      }

      boxIds = [box.id];
      const direction =
        box.cart_type === "ship_to_customer"
          ? "to_customer"
          : box.cart_type === "return_to_storage"
            ? "to_storage"
            : null;
      directionByBoxId.set(box.id, direction);
    } else if (cleanupOrphans) {
      const { data: boxes, error: boxesError } = await supabase
        .from("boxes")
        .select("id,cart_type")
        .eq("user_id", userId)
        .is("cart_type", null);

      if (boxesError) {
        return jsonResponse({ error: `Could not load boxes: ${boxesError.message}` }, 500);
      }

      boxIds = (boxes || []).map((box) => box.id);
      for (const box of boxes || []) {
        directionByBoxId.set(box.id, null);
      }
    } else {
      return jsonResponse({ error: "boxId or cleanupOrphans is required" }, 400);
    }

    if (boxIds.length === 0) {
      return jsonResponse({ removed: true, removedShipmentIds: [] });
    }

    const { data: pendingShipments, error: shipmentLookupError } = await supabase
      .from("shipments")
      .select("id,box_id,shipment_direction")
      .eq("user_id", userId)
      .in("box_id", boxIds)
      .eq("shipping_status", "pending_payment")
      .in("charge_status", ["pending_payment", "failed"])
      .eq("label_status", "needed")
      .is("stripe_payment_intent_id", null);

    if (shipmentLookupError) {
      return jsonResponse({ error: `Could not load pending shipments: ${shipmentLookupError.message}` }, 500);
    }

    const shipmentIds = (pendingShipments || [])
      .filter((shipment) => {
        const direction = directionByBoxId.get(shipment.box_id) ?? null;
        return !direction || shipment.shipment_direction === direction;
      })
      .map((shipment) => shipment.id);

    if (shipmentIds.length > 0) {
      const { error: shipmentBoxesError } = await supabase
        .from("shipment_boxes")
        .delete()
        .in("shipment_id", shipmentIds);

      if (shipmentBoxesError) {
        return jsonResponse({ error: `Could not remove shipment links: ${shipmentBoxesError.message}` }, 500);
      }

      const { error: shipmentsError } = await supabase
        .from("shipments")
        .delete()
        .in("id", shipmentIds);

      if (shipmentsError) {
        return jsonResponse({ error: `Could not remove pending shipments: ${shipmentsError.message}` }, 500);
      }
    }

    if (boxId) {
      const { error: boxUpdateError } = await supabase
        .from("boxes")
        .update({
          checkout_status: "paid",
          cart_type: null,
          requested_shipping_address: null,
          requested_shipping_address_source: null,
        })
        .eq("id", boxId)
        .eq("user_id", userId);

      if (boxUpdateError) {
        return jsonResponse({ error: `Could not clear cart item: ${boxUpdateError.message}` }, 500);
      }
    }

    return jsonResponse({
      removed: true,
      removedShipmentIds: shipmentIds,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
