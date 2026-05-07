const fs = require('fs');
const path = require('path');

const root = process.cwd();
const appFile = path.join(root, 'src/App.jsx');
const functionDir = path.join(root, 'supabase/functions/cancel-shipping-cart-item');
const functionFile = path.join(functionDir, 'index.ts');

if (!fs.existsSync(appFile)) {
  throw new Error('src/App.jsx not found. Run this script from the project root.');
}

const backup = (file, suffix) => {
  if (fs.existsSync(file)) {
    const backupFile = `${file}.${suffix}`;
    if (!fs.existsSync(backupFile)) fs.copyFileSync(file, backupFile);
  }
};

backup(appFile, 'before-shipping-cart-remove-edge-cleanup');

let app = fs.readFileSync(appFile, 'utf8');

if (!app.includes('CANCEL_SHIPPING_CART_ITEM_FUNCTION_URL')) {
  const urlAnchor = 'const SHIPPING_CHECKOUT_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/create-shipping-checkout-session";';
  const finalAnchor = 'const FINAL_SETTLEMENT_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/create-final-settlement-session";';

  if (app.includes(urlAnchor)) {
    app = app.replace(
      urlAnchor,
      `${urlAnchor}\n  const CANCEL_SHIPPING_CART_ITEM_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/cancel-shipping-cart-item";`
    );
  } else if (app.includes(finalAnchor)) {
    app = app.replace(
      finalAnchor,
      `${finalAnchor}\n  const CANCEL_SHIPPING_CART_ITEM_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/cancel-shipping-cart-item";`
    );
  } else {
    throw new Error('Could not find function URL anchor in src/App.jsx');
  }
}

const removeRegex = /  const removeFromCart = async \(boxId\) => \{[\s\S]*?\n  \};\n\n\n  const chunkArray =/;
const newRemoveBlock = `  const removeFromCart = async (boxId) => {
    const box = boxes.find((b) => b.id === boxId);

    if (!box) {
      return;
    }

    if (box.cart_type === "initial_purchase") {
      const groupId = box.subscription_group_id;

      let deleteQuery = supabase
        .from("boxes")
        .delete()
        .eq("user_id", user.id)
        .eq("checkout_status", "in_cart")
        .eq("cart_type", "initial_purchase");

      if (groupId) {
        deleteQuery = deleteQuery.eq("subscription_group_id", groupId);
      } else {
        deleteQuery = deleteQuery.eq("id", boxId);
      }

      const { error } = await deleteQuery;

      if (error) {
        alert(error.message);
      } else {
        loadBoxes(user);
      }

      return;
    }

    if (box.cart_type === "ship_to_customer" || box.cart_type === "return_to_storage") {
      const response = await fetch(CANCEL_SHIPPING_CART_ITEM_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          boxId,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(payload.error || "Could not remove shipping item from cart.");
        return;
      }

      loadBoxes(user);
      return;
    }

    const updates = {
      checkout_status: "paid",
      cart_type: null,
      requested_shipping_address: null,
      requested_shipping_address_source: null,
    };

    const { error } = await supabase
      .from("boxes")
      .update(updates)
      .eq("id", boxId);

    if (error) alert(error.message);
    else loadBoxes(user);
  };


  const chunkArray =`;

const matchCount = (app.match(removeRegex) || []).length;
if (matchCount !== 1) {
  throw new Error(`Could not replace removeFromCart cleanly. Expected 1 match, found ${matchCount}.`);
}
app = app.replace(removeRegex, newRemoveBlock);
fs.writeFileSync(appFile, app);

fs.mkdirSync(functionDir, { recursive: true });
fs.writeFileSync(functionFile, `import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
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

    if (!userId || !boxId) {
      return jsonResponse({ error: "userId and boxId are required" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: box, error: boxError } = await supabase
      .from("boxes")
      .select("id,user_id,cart_type")
      .eq("id", boxId)
      .eq("user_id", userId)
      .single();

    if (boxError || !box) {
      return jsonResponse({ error: "Box not found for user" }, 404);
    }

    const direction =
      box.cart_type === "ship_to_customer"
        ? "to_customer"
        : box.cart_type === "return_to_storage"
          ? "to_storage"
          : null;

    const { data: pendingShipments, error: shipmentLookupError } = await supabase
      .from("shipments")
      .select("id")
      .eq("box_id", boxId)
      .eq("user_id", userId)
      .eq("shipping_status", "pending_payment")
      .in("charge_status", ["pending_payment", "failed"])
      .eq("label_status", "needed")
      .is("stripe_payment_intent_id", null)
      .order("created_at", { ascending: false });

    if (shipmentLookupError) {
      return jsonResponse({ error: `Could not load pending shipment: ${shipmentLookupError.message}` }, 500);
    }

    const shipmentIds = (pendingShipments || []).map((shipment) => shipment.id);

    if (shipmentIds.length > 0) {
      const { error: shipmentBoxesError } = await supabase
        .from("shipment_boxes")
        .delete()
        .in("shipment_id", shipmentIds);

      if (shipmentBoxesError) {
        return jsonResponse({ error: `Could not remove shipment links: ${shipmentBoxesError.message}` }, 500);
      }

      const deleteQuery = supabase
        .from("shipments")
        .delete()
        .in("id", shipmentIds);

      const { error: shipmentsError } = direction
        ? await deleteQuery.eq("shipment_direction", direction)
        : await deleteQuery;

      if (shipmentsError) {
        return jsonResponse({ error: `Could not remove pending shipment: ${shipmentsError.message}` }, 500);
      }
    }

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

    return jsonResponse({
      removed: true,
      boxId,
      removedShipmentIds: shipmentIds,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
`);

console.log('Applied shipping cart remove Edge cleanup patch.');
console.log('Changed/created:');
console.log('- src/App.jsx');
console.log('- supabase/functions/cancel-shipping-cart-item/index.ts');
console.log('Next: npm run build');
console.log('Deploy: supabase functions deploy cancel-shipping-cart-item --no-verify-jwt');
