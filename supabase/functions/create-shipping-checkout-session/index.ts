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

const stripeRequest = async (
  path: string,
  body: URLSearchParams,
  stripeSecretKey: string,
) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message || "Stripe request failed";
    throw new Error(message);
  }

  return payload;
};

const toStripeMetadataValue = (value: unknown) => String(value || "").slice(0, 500);

const formatAddressLine = (address: Record<string, unknown> | null | undefined) => {
  if (!address) return "shipping address";

  return [
    address.address_line1,
    address.city,
    address.state,
    address.zip,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
};

const getShipmentDirectionForCartType = (cartType: string | null | undefined) => {
  if (cartType === "ship_to_customer") return "to_customer";
  if (cartType === "return_to_storage") return "to_storage";
  return "";
};

const getFulfillmentStatusAfterPayment = (direction: string) => {
  if (direction === "to_customer") return "ready_to_ship_to_customer";
  if (direction === "to_storage") return "awaiting_customer_dropoff";
  return null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ error: "Missing required Edge Function secrets" }, 500);
    }

    const body = await req.json();
    const userId = String(body.userId || "").trim();
    const boxIds = Array.isArray(body.boxIds)
      ? body.boxIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];
    const successUrl = String(body.successUrl || "").trim();
    const cancelUrl = String(body.cancelUrl || "").trim();

    if (!userId || boxIds.length === 0 || !successUrl || !cancelUrl) {
      return jsonResponse({ error: "userId, boxIds, successUrl, and cancelUrl are required" }, 400);
    }

    const uniqueBoxIds = Array.from(new Set(boxIds));

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id,email,full_name,stripe_customer_id")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return jsonResponse({ error: "Profile not found for user" }, 404);
    }

    let stripeCustomerId = profile.stripe_customer_id as string | null;

    if (!stripeCustomerId) {
      const customerParams = new URLSearchParams();
      if (profile.email) customerParams.append("email", profile.email);
      if (profile.full_name) customerParams.append("name", profile.full_name);
      customerParams.append("metadata[supabase_user_id]", userId);

      const customer = await stripeRequest("customers", customerParams, stripeSecretKey);
      stripeCustomerId = customer.id;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", userId);

      if (updateError) {
        return jsonResponse({ error: "Failed to save Stripe customer ID" }, 500);
      }
    }

    const { data: boxes, error: boxesError } = await supabase
      .from("boxes")
      .select("id,box_number,user_id,status,fulfillment_status,checkout_status,cart_type,requested_shipping_address,requested_shipping_address_source")
      .eq("user_id", userId)
      .in("id", uniqueBoxIds);

    if (boxesError) {
      return jsonResponse({ error: `Could not load shipping cart boxes: ${boxesError.message}` }, 500);
    }

    if (!boxes || boxes.length !== uniqueBoxIds.length) {
      return jsonResponse({ error: "One or more selected bins were not found" }, 404);
    }

    const shipmentRows = [] as Array<Record<string, unknown>>;
    const lineItems = [] as Array<{ box: Record<string, unknown>; shipment: Record<string, unknown>; direction: string }>;

    for (const box of boxes as Array<Record<string, unknown>>) {
      const direction = getShipmentDirectionForCartType(String(box.cart_type || ""));

      if (!direction) {
        return jsonResponse({ error: `Bin ${box.box_number || box.id} is not a shipping cart item` }, 400);
      }

      if (box.checkout_status !== "paid") {
        return jsonResponse({ error: `Bin ${box.box_number || box.id} is not eligible for shipping checkout` }, 400);
      }

      if (direction === "to_customer" && !(box.status === "stored" && box.fulfillment_status === "stored")) {
        return jsonResponse({ error: `Bin ${box.box_number || box.id} is not eligible to be shipped to customer` }, 400);
      }

      if (direction === "to_storage" && !(box.status === "at_customer" && box.fulfillment_status === "bin_with_customer")) {
        return jsonResponse({ error: `Bin ${box.box_number || box.id} is not eligible to be returned to storage` }, 400);
      }

      const shippingAddress = box.requested_shipping_address as Record<string, unknown> | null;

      if (!shippingAddress) {
        return jsonResponse({ error: `Missing shipping address for bin ${box.box_number || box.id}` }, 400);
      }

      const { data: existingShipments, error: existingError } = await supabase
        .from("shipments")
        .select("*")
        .eq("box_id", box.id)
        .eq("shipment_direction", direction)
        .in("shipping_status", ["pending_payment", "paid", "label_created", "in_transit"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (existingError) {
        return jsonResponse({ error: `Could not check existing shipment: ${existingError.message}` }, 500);
      }

      let shipment = existingShipments?.[0] as Record<string, unknown> | undefined;

      if (shipment && shipment.charge_status === "paid") {
        return jsonResponse({ error: `Bin ${box.box_number || box.id} already has a paid open shipment` }, 400);
      }

      if (!shipment) {
        const { data: createdShipment, error: shipmentError } = await supabase
          .from("shipments")
          .insert([
            {
              box_id: box.id,
              user_id: box.user_id,
              shipping_address: shippingAddress,
              shipping_estimate: DEFAULT_SHIPPING_COST,
              shipping_cost: DEFAULT_SHIPPING_COST,
              shipment_direction: direction,
              shipping_status: "pending_payment",
              charge_status: "pending_payment",
              charge_attempted_at: new Date().toISOString(),
              charge_failure_reason: null,
              label_status: "needed",
            },
          ])
          .select("*")
          .single();

        if (shipmentError) {
          return jsonResponse({ error: `Could not create shipment: ${shipmentError.message}` }, 500);
        }

        const { error: shipmentBoxError } = await supabase
          .from("shipment_boxes")
          .insert([
            {
              shipment_id: createdShipment.id,
              box_id: box.id,
              user_id: box.user_id,
              stack_position: 1,
            },
          ]);

        if (shipmentBoxError) {
          return jsonResponse({ error: `Could not link shipment box: ${shipmentBoxError.message}` }, 500);
        }

        shipment = createdShipment as Record<string, unknown>;
      } else {
        const { error: updateShipmentError } = await supabase
          .from("shipments")
          .update({
            shipping_address: shippingAddress,
            shipping_estimate: DEFAULT_SHIPPING_COST,
            shipping_cost: DEFAULT_SHIPPING_COST,
            shipping_status: "pending_payment",
            charge_status: "pending_payment",
            charge_attempted_at: new Date().toISOString(),
            charge_failure_reason: null,
            label_status: "needed",
          })
          .eq("id", shipment.id);

        if (updateShipmentError) {
          return jsonResponse({ error: `Could not refresh shipment: ${updateShipmentError.message}` }, 500);
        }
      }

      shipmentRows.push(shipment);
      lineItems.push({ box, shipment, direction });
    }

    const sessionParams = new URLSearchParams();
    sessionParams.append("mode", "payment");
    sessionParams.append("customer", stripeCustomerId);
    sessionParams.append("success_url", successUrl);
    sessionParams.append("cancel_url", cancelUrl);
    sessionParams.append("payment_method_types[0]", "card");
    sessionParams.append("metadata[flow]", "customer_shipping");
    sessionParams.append("metadata[supabase_user_id]", userId);
    sessionParams.append("metadata[shipment_ids]", shipmentRows.map((shipment) => shipment.id).join(","));
    sessionParams.append("metadata[box_ids]", uniqueBoxIds.join(","));
    sessionParams.append("payment_intent_data[metadata][flow]", "customer_shipping");
    sessionParams.append("payment_intent_data[metadata][supabase_user_id]", userId);
    sessionParams.append("payment_intent_data[metadata][shipment_ids]", shipmentRows.map((shipment) => shipment.id).join(","));
    sessionParams.append("payment_intent_data[metadata][box_ids]", uniqueBoxIds.join(","));

    lineItems.forEach(({ box, direction }, index) => {
      const label = direction === "to_storage" ? "Return shipping to storage" : "Shipping to customer";
      sessionParams.append(`line_items[${index}][price_data][currency]`, "usd");
      sessionParams.append(`line_items[${index}][price_data][unit_amount]`, String(Math.round(DEFAULT_SHIPPING_COST * 100)));
      sessionParams.append(`line_items[${index}][price_data][product_data][name]`, `${label} — Bin ${box.box_number || box.id}`);
      sessionParams.append(`line_items[${index}][price_data][product_data][description]`, formatAddressLine(box.requested_shipping_address as Record<string, unknown> | null));
      sessionParams.append(`line_items[${index}][price_data][product_data][metadata][box_id]`, toStripeMetadataValue(box.id));
      sessionParams.append(`line_items[${index}][price_data][product_data][metadata][shipment_direction]`, direction);
      sessionParams.append(`line_items[${index}][quantity]`, "1");
    });

    const session = await stripeRequest("checkout/sessions", sessionParams, stripeSecretKey);

    return jsonResponse({
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
      shipmentIds: shipmentRows.map((shipment) => shipment.id),
    });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
