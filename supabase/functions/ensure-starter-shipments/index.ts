import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { attachStarterEmptyBinPackageMeta } from "../_shared/fedexPurchaseLabel.ts";

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

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const n = Math.max(1, size);
  for (let i = 0; i < items.length; i += n) {
    out.push(items.slice(i, i + n));
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Supabase configuration" }, 500);
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

    const { data: candidateBoxes, error: boxesError } = await supabase
      .from("boxes")
      .select("*")
      .eq("user_id", userId)
      .eq("checkout_status", "paid")
      .eq("fulfillment_status", "paid_waiting_to_ship_bin");

    if (boxesError) return jsonResponse({ error: boxesError.message }, 500);

    const boxes = candidateBoxes || [];
    if (boxes.length === 0) {
      return jsonResponse({ ok: true, createdShipments: 0, message: "No starter bins needing shipments" });
    }

    const byGroup = new Map<string, typeof boxes>();
    for (const box of boxes) {
      const gid = String(box.subscription_group_id || box.id);
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid)!.push(box);
    }

    let createdShipments = 0;

    for (const [, groupBoxes] of byGroup) {
      groupBoxes.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const boxIds = groupBoxes.map((b) => String(b.id));

      const { data: links, error: linkErr } = await supabase
        .from("shipment_boxes")
        .select("shipment_id")
        .in("box_id", boxIds);
      if (linkErr) return jsonResponse({ error: linkErr.message }, 500);

      const shipmentIds = [...new Set((links || []).map((r: { shipment_id: string }) => String(r.shipment_id)))];
      if (shipmentIds.length > 0) {
        const { data: ships, error: shipErr } = await supabase
          .from("shipments")
          .select("id, shipment_direction")
          .in("id", shipmentIds);
        if (shipErr) return jsonResponse({ error: shipErr.message }, 500);
        const hasOutbound = (ships || []).some((s: { shipment_direction: string }) =>
          s.shipment_direction === "to_customer"
        );
        if (hasOutbound) continue;
      }

      const planBinCount = Math.max(1, Math.floor(Number(groupBoxes[0]?.plan_bin_count) || 1));
      const configuredStack = Math.max(1, Number(groupBoxes[0]?.plan_initial_stack_size) || 1);
      const stackSize = Math.max(planBinCount, configuredStack);
      let shippingAddress = groupBoxes[0]?.requested_shipping_address as Record<string, unknown> | null;
      if (!shippingAddress || !String(shippingAddress.address_line1 || "").trim()) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, email, address_line1, address_line2, city, state, zip")
          .eq("id", userId)
          .maybeSingle();
        if (profile && String(profile.address_line1 || "").trim()) {
          shippingAddress = {
            full_name: profile.full_name || "",
            email: profile.email || "",
            address_line1: profile.address_line1 || "",
            address_line2: profile.address_line2 || "",
            city: profile.city || "",
            state: profile.state || "",
            zip: profile.zip || "",
          };
        }
      }
      if (!shippingAddress || !String(shippingAddress.address_line1 || "").trim()) {
        continue;
      }

      const stacks = chunkArray(groupBoxes, stackSize);
      const now = new Date().toISOString();

      for (const stack of stacks) {
        const firstBox = stack[0];
        const shipAddr = attachStarterEmptyBinPackageMeta(
          shippingAddress as Record<string, unknown>,
          stack.length,
        );
        const { data: createdShipment, error: shipmentError } = await supabase
          .from("shipments")
          .insert([
            {
              box_id: firstBox.id,
              user_id: userId,
              shipping_address: shipAddr,
              shipping_estimate: DEFAULT_SHIPPING_COST,
              shipping_cost: DEFAULT_SHIPPING_COST,
              shipment_direction: "to_customer",
              shipping_status: "paid",
              charge_status: "paid",
              charge_attempted_at: now,
              charge_failure_reason: null,
              label_status: "needed",
            },
          ])
          .select("*")
          .single();

        if (shipmentError) {
          console.error("ensure-starter-shipments insert shipment", shipmentError);
          continue;
        }

        const shipmentBoxRows = stack.map((box: { id: string }, index: number) => ({
          shipment_id: createdShipment.id,
          box_id: box.id,
          user_id: userId,
          stack_position: index + 1,
        }));

        const { error: shipmentBoxesError } = await supabase.from("shipment_boxes").insert(shipmentBoxRows);
        if (shipmentBoxesError) {
          console.error("ensure-starter-shipments shipment_boxes", shipmentBoxesError);
          continue;
        }
        createdShipments += 1;
      }
    }

    return jsonResponse({ ok: true, createdShipments });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
