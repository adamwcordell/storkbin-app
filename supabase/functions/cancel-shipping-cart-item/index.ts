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

    const { data: shipLinks, error: shipLinksErr } = await supabase
      .from("shipment_boxes")
      .select("shipment_id,box_id")
      .in("box_id", boxIds);

    if (shipLinksErr) {
      return jsonResponse({ error: `Could not load shipment links: ${shipLinksErr.message}` }, 500);
    }

    const candidateShipmentIds = [...new Set((shipLinks || []).map((r) => String(r.shipment_id)))];

    let pendingShipments: Array<{ id: string; box_id: string; shipment_direction: string | null }> = [];
    if (candidateShipmentIds.length > 0) {
      const { data: ships, error: shipmentLookupError } = await supabase
        .from("shipments")
        .select("id,box_id,shipment_direction")
        .eq("user_id", userId)
        .in("id", candidateShipmentIds)
        .eq("shipping_status", "pending_payment")
        .in("charge_status", ["pending_payment", "failed"])
        .eq("label_status", "needed")
        .is("stripe_payment_intent_id", null);

      if (shipmentLookupError) {
        return jsonResponse({ error: `Could not load pending shipments: ${shipmentLookupError.message}` }, 500);
      }
      pendingShipments = ships || [];
    }

    const { data: legacyPending, error: legacyErr } = await supabase
      .from("shipments")
      .select("id,box_id,shipment_direction")
      .eq("user_id", userId)
      .in("box_id", boxIds)
      .eq("shipping_status", "pending_payment")
      .in("charge_status", ["pending_payment", "failed"])
      .eq("label_status", "needed")
      .is("stripe_payment_intent_id", null);

    if (legacyErr) {
      return jsonResponse({ error: `Could not load legacy pending shipments: ${legacyErr.message}` }, 500);
    }

    const byId = new Map(pendingShipments.map((s) => [s.id, s]));
    for (const row of legacyPending || []) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
    pendingShipments = [...byId.values()];

    const affectedShipmentIds = (pendingShipments || [])
      .filter((shipment) => {
        const direction = directionByBoxId.get(shipment.box_id) ?? null;
        return !direction || shipment.shipment_direction === direction;
      })
      .map((shipment) => shipment.id);

    if (affectedShipmentIds.length > 0) {
      const { error: unlinkErr } = await supabase
        .from("shipment_boxes")
        .delete()
        .in("shipment_id", affectedShipmentIds)
        .in("box_id", boxIds);

      if (unlinkErr) {
        return jsonResponse({ error: `Could not remove shipment links: ${unlinkErr.message}` }, 500);
      }

      for (const sid of affectedShipmentIds) {
        const { count, error: cntErr } = await supabase
          .from("shipment_boxes")
          .select("box_id", { count: "exact", head: true })
          .eq("shipment_id", sid);
        if (cntErr) {
          return jsonResponse({ error: `Could not verify shipment links: ${cntErr.message}` }, 500);
        }
        if ((count ?? 0) === 0) {
          const { error: delShipErr } = await supabase.from("shipments").delete().eq("id", sid);
          if (delShipErr) {
            return jsonResponse({ error: `Could not remove pending shipment: ${delShipErr.message}` }, 500);
          }
        }
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
          return_shipment_empty: false,
        })
        .eq("id", boxId)
        .eq("user_id", userId);

      if (boxUpdateError) {
        return jsonResponse({ error: `Could not clear cart item: ${boxUpdateError.message}` }, 500);
      }
    }

    return jsonResponse({
      removed: true,
      removedShipmentIds: affectedShipmentIds,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
