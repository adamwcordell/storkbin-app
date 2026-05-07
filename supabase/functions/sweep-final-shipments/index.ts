import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const DEFAULT_SHIPPING_COST = 18;

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

const ensureShipmentBoxLink = async (supabase: ReturnType<typeof createClient>, shipmentId: string, box: any) => {
  const { data: existingRows, error: lookupError } = await supabase
    .from("shipment_boxes")
    .select("shipment_id")
    .eq("shipment_id", shipmentId)
    .eq("box_id", box.id)
    .limit(1);

  if (lookupError) {
    throw new Error("Could not check final shipment link for " + box.id + ": " + lookupError.message);
  }

  if (existingRows?.length) return;

  const { error: insertError } = await supabase.from("shipment_boxes").insert([
    {
      shipment_id: shipmentId,
      box_id: box.id,
      user_id: box.user_id,
      stack_position: 1,
    },
  ]);

  if (insertError) {
    throw new Error("Could not link final shipment to " + box.id + ": " + insertError.message);
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const nowIso = new Date().toISOString();

  const { data: boxes, error: boxesError } = await supabase
    .from("boxes")
    .select(
      "id,user_id,status,fulfillment_status,checkout_status,cancel_status,subscription_ends_at,cancellation_shipping_address,cancellation_shipping_charge_status"
    )
    .eq("checkout_status", "paid")
    .eq("cancel_status", "approved")
    .eq("status", "stored")
    .eq("cancellation_shipping_charge_status", "pending_auto_charge")
    .lte("subscription_ends_at", nowIso);

  if (boxesError) {
    return jsonResponse({ error: `Could not load final-shipment candidates: ${boxesError.message}` }, 500);
  }

  const candidates = boxes || [];
  const results: Record<string, unknown>[] = [];

  for (const box of candidates) {
    if (!box.cancellation_shipping_address) {
      results.push({ boxId: box.id, skipped: true, reason: "missing cancellation shipping address" });
      continue;
    }

    const { data: existingShipments, error: shipmentLookupError } = await supabase
      .from("shipments")
      .select("id,shipping_status,charge_status,label_status,shipment_direction,created_at")
      .eq("box_id", box.id)
      .eq("shipment_direction", "to_customer")
      .neq("shipping_status", "delivered")
      .order("created_at", { ascending: false })
      .limit(1);

    if (shipmentLookupError) {
      throw new Error(`Could not check existing shipments for ${box.id}: ${shipmentLookupError.message}`);
    }

    if (existingShipments && existingShipments.length > 0) {
      await ensureShipmentBoxLink(supabase, existingShipments[0].id, box);

      results.push({
        boxId: box.id,
        skipped: true,
        reason: "open final shipment already exists",
        shipmentId: existingShipments[0].id,
        linked: true,
      });
      continue;
    }

    const { data: createdShipment, error: shipmentCreateError } = await supabase
      .from("shipments")
      .insert([
        {
          box_id: box.id,
          user_id: box.user_id,
          shipping_address: box.cancellation_shipping_address,
          shipping_estimate: DEFAULT_SHIPPING_COST,
          shipping_cost: DEFAULT_SHIPPING_COST,
          shipment_direction: "to_customer",
          shipping_status: "pending_payment",
          charge_status: "failed",
          charge_attempted_at: nowIso,
          charge_failure_reason: "Final return shipping payment required",
          label_status: "needed",
        },
      ])
      .select("id")
      .single();

    if (shipmentCreateError) {
      throw new Error(`Could not create final shipment for ${box.id}: ${shipmentCreateError.message}`);
    }

    await ensureShipmentBoxLink(supabase, createdShipment.id, box);

    const { error: boxUpdateError } = await supabase
      .from("boxes")
      .update({
        fulfillment_status: "shipment_payment_failed",
        cancellation_shipping_charge_status: "failed",
        lifecycle_attention_reason: "final_shipping_payment_failed",
      })
      .eq("id", box.id);

    if (boxUpdateError) {
      throw new Error(`Could not update final shipment box state for ${box.id}: ${boxUpdateError.message}`);
    }

    results.push({ boxId: box.id, created: true, shipmentId: createdShipment?.id || null });
  }

  return jsonResponse({
    ok: true,
    checked: candidates.length,
    created: results.filter((result) => result.created).length,
    results,
  });
});
