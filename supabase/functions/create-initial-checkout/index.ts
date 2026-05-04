import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getStorkBinPlan } from "../_shared/storkbinPlans.ts";

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

const addMetadata = (
  params: URLSearchParams,
  prefix: string,
  metadata: Record<string, string | number | boolean | null | undefined>,
) => {
  Object.entries(metadata).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      const metadataKey = prefix ? `${prefix}[metadata][${key}]` : `metadata[${key}]`;
      params.append(metadataKey, String(value));
    }
  });
};

type RawShippingAddress = {
  fullName?: unknown;
  email?: unknown;
  addressLine1?: unknown;
  addressLine2?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
};

const clean = (value: unknown) => String(value || "").trim();

const normalizeShippingAddress = (raw: RawShippingAddress | null | undefined) => {
  const shippingAddress = {
    fullName: clean(raw?.fullName),
    email: clean(raw?.email),
    addressLine1: clean(raw?.addressLine1),
    addressLine2: clean(raw?.addressLine2),
    city: clean(raw?.city),
    state: clean(raw?.state),
    zip: clean(raw?.zip),
  };

  const missingFields = Object.entries(shippingAddress)
    .filter(([key, value]) => key !== "addressLine2" && !value)
    .map(([key]) => key);

  if (missingFields.length > 0) {
    return { shippingAddress, missingFields };
  }

  return { shippingAddress, missingFields: [] as string[] };
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
    const planId = String(body.planId || "");
    const userId = String(body.userId || "");
    const successUrl = String(body.successUrl || "");
    const cancelUrl = String(body.cancelUrl || "");
    const { shippingAddress, missingFields } = normalizeShippingAddress(body.shippingAddress);

    if (!planId || !userId || !successUrl || !cancelUrl) {
      return jsonResponse(
        { error: "planId, userId, successUrl, and cancelUrl are required" },
        400,
      );
    }

    if (missingFields.length > 0) {
      return jsonResponse(
        { error: "shippingAddress is required", missingFields },
        400,
      );
    }

    const plan = getStorkBinPlan(planId);

    if (!plan) {
      return jsonResponse({ error: `Unknown planId: ${planId}` }, 400);
    }

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

    const requestedSubscriptionGroupId = String(body.subscriptionGroupId || body.cartSubscriptionGroupId || "").trim();

    let cartSubscriptionGroupId = requestedSubscriptionGroupId;

    if (!cartSubscriptionGroupId) {
      const { data: cartRows, error: cartRowsError } = await supabase
        .from("boxes")
        .select("id, subscription_group_id, plan_bin_count, created_at")
        .eq("user_id", userId)
        .eq("checkout_status", "in_cart")
        .eq("cart_type", "initial_purchase")
        .eq("plan_bin_count", plan.binCount)
        .order("created_at", { ascending: false });

      if (cartRowsError) {
        return jsonResponse({ error: `Could not read cart rows: ${cartRowsError.message}` }, 500);
      }

      const matchingGroups = Array.from(
        new Set((cartRows || []).map((row) => row.subscription_group_id).filter(Boolean)),
      );

      if (matchingGroups.length === 1) {
        cartSubscriptionGroupId = String(matchingGroups[0]);
      } else if (matchingGroups.length > 1) {
        return jsonResponse(
          {
            error: "Please check out one new subscription plan at a time.",
            matchingCartGroups: matchingGroups.length,
          },
          400,
        );
      }
    }

    const subscriptionGroupId = cartSubscriptionGroupId || crypto.randomUUID();
    const totalInitialPaymentCents = plan.setupFeeCents + plan.monthlyRateCents;

    const sharedMetadata = {
      flow: "initial_purchase",
      supabase_user_id: userId,
      plan_id: plan.id,
      plan_name: plan.name,
      bin_count: plan.binCount,
      monthly_rate_cents: plan.monthlyRateCents,
      setup_fee_cents: plan.setupFeeCents,
      minimum_months: plan.minimumMonths,
      return_shipping_discount_percent: plan.returnShippingDiscountPercent,
      initial_shipment_stack_size: plan.initialShipmentStackSize,
      subscription_group_id: subscriptionGroupId,
      cart_subscription_group_id: cartSubscriptionGroupId,
      first_month_covered: true,
      total_initial_payment_cents: totalInitialPaymentCents,
      subscription_model: "one_subscription_per_bin",
      shipping_source: "customer_selected_checkout",
      shipping_full_name: shippingAddress.fullName,
      shipping_email: shippingAddress.email,
      shipping_address_line1: shippingAddress.addressLine1,
      shipping_address_line2: shippingAddress.addressLine2,
      shipping_city: shippingAddress.city,
      shipping_state: shippingAddress.state,
      shipping_zip: shippingAddress.zip,
    };

    const sessionParams = new URLSearchParams();
    sessionParams.append("mode", "payment");
    sessionParams.append("customer", stripeCustomerId);
    sessionParams.append("success_url", successUrl);
    sessionParams.append("cancel_url", cancelUrl);
    sessionParams.append("payment_intent_data[setup_future_usage]", "off_session");

    addMetadata(sessionParams, "payment_intent_data", sharedMetadata);

    sessionParams.append("line_items[0][quantity]", "1");
    sessionParams.append("line_items[0][price_data][currency]", "usd");
    sessionParams.append("line_items[0][price_data][unit_amount]", String(plan.setupFeeCents));
    sessionParams.append("line_items[0][price_data][product_data][name]", `${plan.name} Setup Fee`);

    sessionParams.append("line_items[1][quantity]", "1");
    sessionParams.append("line_items[1][price_data][currency]", "usd");
    sessionParams.append("line_items[1][price_data][unit_amount]", String(plan.monthlyRateCents));
    sessionParams.append("line_items[1][price_data][product_data][name]", `${plan.name} First Month Storage`);

    addMetadata(sessionParams, "", sharedMetadata);

    const session = await stripeRequest(
      "checkout/sessions",
      sessionParams,
      stripeSecretKey,
    );

    return jsonResponse({
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
      subscriptionGroupId,
    });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
