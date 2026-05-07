const fs = require('fs');
const path = require('path');

const root = process.cwd();
const appFile = path.join(root, 'src/App.jsx');
const cartPageFile = path.join(root, 'src/pages/CartPage.jsx');
const functionDir = path.join(root, 'supabase/functions/cancel-shipping-cart-item');
const functionFile = path.join(functionDir, 'index.ts');

if (!fs.existsSync(appFile)) throw new Error('src/App.jsx not found. Run from project root.');
if (!fs.existsSync(cartPageFile)) throw new Error('src/pages/CartPage.jsx not found. Run from project root.');

const backup = (file, suffix) => {
  if (fs.existsSync(file)) {
    const backupFile = `${file}.${suffix}`;
    if (!fs.existsSync(backupFile)) fs.copyFileSync(file, backupFile);
  }
};

backup(appFile, 'before-abandoned-shipping-cleanup-v3');
backup(cartPageFile, 'before-abandoned-shipping-cleanup-v3');

let app = fs.readFileSync(appFile, 'utf8');

if (!app.includes('CANCEL_SHIPPING_CART_ITEM_FUNCTION_URL')) {
  const urlAnchor = 'const SHIPPING_CHECKOUT_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/create-shipping-checkout-session";';
  if (!app.includes(urlAnchor)) throw new Error('Could not find SHIPPING_CHECKOUT_FUNCTION_URL anchor in src/App.jsx.');
  app = app.replace(urlAnchor, `${urlAnchor}\n  const CANCEL_SHIPPING_CART_ITEM_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/cancel-shipping-cart-item";`);
}

// Replace removeFromCart with server-side cleanup for shipping items.
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
const removeCount = (app.match(removeRegex) || []).length;
if (removeCount !== 1) throw new Error(`Could not replace removeFromCart. Expected 1 match, found ${removeCount}.`);
app = app.replace(removeRegex, newRemoveBlock);

if (!app.includes('const cleanupAbandonedShippingCartShipments = async () =>')) {
  const insertAfter = '  };\n\n\n  const chunkArray =';
  const cleanupFunction = `  };

  const cleanupAbandonedShippingCartShipments = async () => {
    if (!user?.id) return;

    const response = await fetch(CANCEL_SHIPPING_CART_ITEM_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        cleanupOrphans: true,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(payload.error || "Could not clean up abandoned shipping cart shipments.");
      return;
    }

    if (Array.isArray(payload.removedShipmentIds) && payload.removedShipmentIds.length > 0) {
      await loadBoxes(user);
    }
  };


  const chunkArray =`;
  if (!app.includes(insertAfter)) throw new Error('Could not find insertion point for cleanupAbandonedShippingCartShipments.');
  app = app.replace(insertAfter, cleanupFunction);
}

if (!app.includes('cleanupAbandonedShippingCartShipments,')) {
  const appDataAnchor = '    removeFromCart,\n';
  if (!app.includes(appDataAnchor)) throw new Error('Could not find appData removeFromCart anchor.');
  app = app.replace(appDataAnchor, '    removeFromCart,\n    cleanupAbandonedShippingCartShipments,\n');
}

fs.writeFileSync(appFile, app);

let cartPage = fs.readFileSync(cartPageFile, 'utf8');
if (!cartPage.includes('useEffect')) {
  cartPage = cartPage.replace('import Cart from "../components/Cart";', 'import { useEffect } from "react";\nimport Cart from "../components/Cart";');
}
if (!cartPage.includes('cleanupAbandonedShippingCartShipments')) {
  cartPage = cartPage.replace(
    'function CartPage({ appData }) {\n  return (',
    `function CartPage({ appData }) {
  useEffect(() => {
    appData.cleanupAbandonedShippingCartShipments?.();
  }, []);

  return (`
  );
}
fs.writeFileSync(cartPageFile, cartPage);

fs.mkdirSync(functionDir, { recursive: true });
const functionSource = "import { serve } from \"https://deno.land/std@0.224.0/http/server.ts\";\nimport { createClient } from \"https://esm.sh/@supabase/supabase-js@2.45.4\";\n\nconst corsHeaders = {\n  \"Access-Control-Allow-Origin\": \"*\",\n  \"Access-Control-Allow-Headers\": \"authorization, x-client-info, apikey, content-type\",\n  \"Access-Control-Allow-Methods\": \"POST, OPTIONS\",\n};\n\nconst jsonResponse = (body: Record<string, unknown>, status = 200) =>\n  new Response(JSON.stringify(body), {\n    status,\n    headers: { ...corsHeaders, \"Content-Type\": \"application/json\" },\n  });\n\nserve(async (req) => {\n  if (req.method === \"OPTIONS\") {\n    return new Response(\"ok\", { headers: corsHeaders });\n  }\n\n  if (req.method !== \"POST\") {\n    return jsonResponse({ error: \"Method not allowed\" }, 405);\n  }\n\n  try {\n    const supabaseUrl = Deno.env.get(\"SUPABASE_URL\");\n    const serviceRoleKey = Deno.env.get(\"SUPABASE_SERVICE_ROLE_KEY\") || Deno.env.get(\"SERVICE_ROLE_KEY\");\n\n    if (!supabaseUrl || !serviceRoleKey) {\n      return jsonResponse({ error: \"Missing Supabase service role configuration\" }, 500);\n    }\n\n    const body = await req.json();\n    const userId = String(body.userId || \"\").trim();\n    const boxId = String(body.boxId || \"\").trim();\n    const cleanupOrphans = body.cleanupOrphans === true;\n\n    if (!userId) {\n      return jsonResponse({ error: \"userId is required\" }, 400);\n    }\n\n    const supabase = createClient(supabaseUrl, serviceRoleKey, {\n      auth: { persistSession: false },\n    });\n\n    let boxIds: string[] = [];\n    let directionByBoxId = new Map<string, string | null>();\n\n    if (boxId) {\n      const { data: box, error: boxError } = await supabase\n        .from(\"boxes\")\n        .select(\"id,user_id,cart_type\")\n        .eq(\"id\", boxId)\n        .eq(\"user_id\", userId)\n        .single();\n\n      if (boxError || !box) {\n        return jsonResponse({ error: \"Box not found for user\" }, 404);\n      }\n\n      boxIds = [box.id];\n      const direction =\n        box.cart_type === \"ship_to_customer\"\n          ? \"to_customer\"\n          : box.cart_type === \"return_to_storage\"\n            ? \"to_storage\"\n            : null;\n      directionByBoxId.set(box.id, direction);\n    } else if (cleanupOrphans) {\n      const { data: boxes, error: boxesError } = await supabase\n        .from(\"boxes\")\n        .select(\"id,cart_type\")\n        .eq(\"user_id\", userId)\n        .is(\"cart_type\", null);\n\n      if (boxesError) {\n        return jsonResponse({ error: `Could not load boxes: ${boxesError.message}` }, 500);\n      }\n\n      boxIds = (boxes || []).map((box) => box.id);\n      for (const box of boxes || []) {\n        directionByBoxId.set(box.id, null);\n      }\n    } else {\n      return jsonResponse({ error: \"boxId or cleanupOrphans is required\" }, 400);\n    }\n\n    if (boxIds.length === 0) {\n      return jsonResponse({ removed: true, removedShipmentIds: [] });\n    }\n\n    const { data: pendingShipments, error: shipmentLookupError } = await supabase\n      .from(\"shipments\")\n      .select(\"id,box_id,shipment_direction\")\n      .eq(\"user_id\", userId)\n      .in(\"box_id\", boxIds)\n      .eq(\"shipping_status\", \"pending_payment\")\n      .in(\"charge_status\", [\"pending_payment\", \"failed\"])\n      .eq(\"label_status\", \"needed\")\n      .is(\"stripe_payment_intent_id\", null);\n\n    if (shipmentLookupError) {\n      return jsonResponse({ error: `Could not load pending shipments: ${shipmentLookupError.message}` }, 500);\n    }\n\n    const shipmentIds = (pendingShipments || [])\n      .filter((shipment) => {\n        const direction = directionByBoxId.get(shipment.box_id) ?? null;\n        return !direction || shipment.shipment_direction === direction;\n      })\n      .map((shipment) => shipment.id);\n\n    if (shipmentIds.length > 0) {\n      const { error: shipmentBoxesError } = await supabase\n        .from(\"shipment_boxes\")\n        .delete()\n        .in(\"shipment_id\", shipmentIds);\n\n      if (shipmentBoxesError) {\n        return jsonResponse({ error: `Could not remove shipment links: ${shipmentBoxesError.message}` }, 500);\n      }\n\n      const { error: shipmentsError } = await supabase\n        .from(\"shipments\")\n        .delete()\n        .in(\"id\", shipmentIds);\n\n      if (shipmentsError) {\n        return jsonResponse({ error: `Could not remove pending shipments: ${shipmentsError.message}` }, 500);\n      }\n    }\n\n    if (boxId) {\n      const { error: boxUpdateError } = await supabase\n        .from(\"boxes\")\n        .update({\n          checkout_status: \"paid\",\n          cart_type: null,\n          requested_shipping_address: null,\n          requested_shipping_address_source: null,\n        })\n        .eq(\"id\", boxId)\n        .eq(\"user_id\", userId);\n\n      if (boxUpdateError) {\n        return jsonResponse({ error: `Could not clear cart item: ${boxUpdateError.message}` }, 500);\n      }\n    }\n\n    return jsonResponse({\n      removed: true,\n      removedShipmentIds: shipmentIds,\n    });\n  } catch (error) {\n    return jsonResponse({ error: error instanceof Error ? error.message : \"Unexpected error\" }, 500);\n  }\n});\n";
fs.writeFileSync(functionFile, functionSource);

console.log('Applied abandoned shipping cart cleanup v3 patch.');
console.log('Changed/created:');
console.log('- src/App.jsx');
console.log('- src/pages/CartPage.jsx');
console.log('- supabase/functions/cancel-shipping-cart-item/index.ts');
console.log('Next: npm run build');
console.log('Deploy: supabase functions deploy cancel-shipping-cart-item --no-verify-jwt');
