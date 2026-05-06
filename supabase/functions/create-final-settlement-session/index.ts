import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const DEFAULT_FINAL_SHIPPING_COST_CENTS = 1800;

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
  method: "GET" | "POST",
  stripeSecretKey: string,
  body?: URLSearchParams,
) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body : undefined,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message || "Stripe request failed");
  }

  return payload;
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
    const supabaseServiceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ error: "Missing required secrets" }, 500);
    }

    const { boxId, successUrl, cancelUrl } = await req.json();

    if (!boxId) {
      return jsonResponse({ error: "Missing boxId" }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: box, error: boxError } = await supabase
      .from("boxes")
      .select("id,user_id,box_number,stripe_subscription_id,cancellation_shipping_address,requested_shipping_address,cancellation_shipping_charge_status")
      .eq("id", boxId)
      .single();

    if (boxError || !box) {
      return jsonResponse({ error: "Box not found" }, 404);
    }

    if (!box.stripe_subscription_id) {
      return jsonResponse({ error: "Box is missing Stripe subscription id" }, 400);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_customer_id,email,full_name,address_line1,address_line2,city,state,zip")
      .eq("id", box.user_id)
      .single();

    if (profileError || !profile?.stripe_customer_id) {
      return jsonResponse({ error: "Profile missing Stripe customer id" }, 400);
    }

    const shippingAddress =
      box.cancellation_shipping_address ||
      box.requested_shipping_address ||
      {
        full_name: profile.full_name || "",
        email: profile.email || "",
        address_line1: profile.address_line1 || "",
        address_line2: profile.address_line2 || "",
        city: profile.city || "",
        state: profile.state || "",
        zip: profile.zip || "",
      };

    const { data: existingShipment, error: existingShipmentError } = await supabase
      .from("shipments")
      .select("id,shipping_cost,charge_status,shipping_status")
      .eq("box_id", box.id)
      .eq("shipment_direction", "to_customer")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingShipmentError) {
      return jsonResponse({ error: `Could not look up final shipment: ${existingShipmentError.message}` }, 500);
    }

    let shipment = existingShipment;

    if (!shipment) {
      const { data: createdShipment, error: shipmentError } = await supabase
        .from("shipments")
        .insert([
          {
            box_id: box.id,
            user_id: box.user_id,
            shipping_address: shippingAddress,
            shipping_estimate: DEFAULT_FINAL_SHIPPING_COST_CENTS / 100,
            shipping_cost: DEFAULT_FINAL_SHIPPING_COST_CENTS / 100,
            shipment_direction: "to_customer",
            shipping_status: "pending_payment",
            charge_status: "pending_payment",
            label_status: "needed",
          },
        ])
        .select("id,shipping_cost,charge_status,shipping_status")
        .single();

      if (shipmentError) {
        return jsonResponse({ error: `Could not create final shipment: ${shipmentError.message}` }, 500);
      }

      shipment = createdShipment;
    }

    const invoices = await stripeRequest(
      `invoices?subscription=${encodeURIComponent(box.stripe_subscription_id)}&status=open&limit=100`,
      "GET",
      stripeSecretKey,
    );

    const openInvoices = invoices?.data || [];
    const overdueAmountCents = openInvoices.reduce(
      (sum: number, invoice: { amount_remaining?: number }) => sum + Number(invoice.amount_remaining || 0),
      0,
    );

    const shippingAmountCents = Math.round(Number(shipment?.shipping_cost || 18) * 100) || DEFAULT_FINAL_SHIPPING_COST_CENTS;
    const totalAmountCents = overdueAmountCents + shippingAmountCents;

    if (totalAmountCents <= 0) {
      return jsonResponse({ error: "No settlement balance due" }, 400);
    }

    const origin = req.headers.get("origin") || "http://localhost:5173";
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("customer", profile.stripe_customer_id);
    params.append("success_url", successUrl || `${origin}/account?payment=final-settlement-success&box=${encodeURIComponent(box.id)}`);
    params.append("cancel_url", cancelUrl || `${origin}/account?payment=final-settlement-cancelled&box=${encodeURIComponent(box.id)}`);
    params.append("line_items[0][price_data][currency]", "usd");
    params.append("line_items[0][price_data][product_data][name]", `StorkBin final settlement - Bin ${box.box_number || box.id}`);
    params.append("line_items[0][price_data][unit_amount]", String(totalAmountCents));
    params.append("line_items[0][quantity]", "1");
    params.append("metadata[flow]", "final_settlement");
    params.append("metadata[box_id]", box.id);
    params.append("metadata[stripe_subscription_id]", box.stripe_subscription_id);
    params.append("metadata[shipment_id]", shipment?.id || "");
    params.append("metadata[open_invoice_ids]", openInvoices.map((invoice: { id: string }) => invoice.id).join(","));
    params.append("metadata[overdue_amount_cents]", String(overdueAmountCents));
    params.append("metadata[shipping_amount_cents]", String(shippingAmountCents));

    const session = await stripeRequest("checkout/sessions", "POST", stripeSecretKey, params);

    return jsonResponse({
      url: session.url,
      checkoutUrl: session.url,
      sessionId: session.id,
      totalAmountCents,
      overdueAmountCents,
      shippingAmountCents,
      shipmentId: shipment?.id || null,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
