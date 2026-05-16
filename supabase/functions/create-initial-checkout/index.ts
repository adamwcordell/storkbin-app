import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { loadOrCreateProfileForCheckout } from "../_shared/ensureProfileForCheckout.ts";
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

    const body = await req.json() as Record<string, unknown>;
    const userId = String(body.userId || "");
    const successUrl = String(body.successUrl || "");
    const cancelUrl = String(body.cancelUrl || "");
    const { shippingAddress, missingFields } = normalizeShippingAddress(
      body.shippingAddress as RawShippingAddress | undefined,
    );

    type BundleLine = {
      planId: string;
      subscriptionGroupId: string;
      billingCycle: "monthly" | "annual";
    };

    const normalizeBilling = (raw: unknown): "monthly" | "annual" =>
      String(raw || "monthly").toLowerCase() === "annual" ? "annual" : "monthly";

    const rawBundle = body.initialPurchaseGroups;
    let bundleLines: BundleLine[] = [];
    let explicitBundleRequest = false;

    if (Array.isArray(rawBundle) && rawBundle.length > 0) {
      explicitBundleRequest = true;
      bundleLines = (rawBundle as Record<string, unknown>[])
        .map((row) => ({
          planId: String(row?.planId || row?.plan_id || "").trim(),
          subscriptionGroupId: String(row?.subscriptionGroupId || row?.subscription_group_id || "").trim(),
          billingCycle: normalizeBilling(row?.billingCycle ?? row?.billing_cycle),
        }))
        .filter((row) => row.planId && row.subscriptionGroupId);

      if (bundleLines.length === 0) {
        return jsonResponse(
          {
            error: "initialPurchaseGroups was sent but no valid plan rows were parsed (need planId and subscriptionGroupId on each entry).",
          },
          400,
        );
      }
    }

    if (!userId || !successUrl || !cancelUrl) {
      return jsonResponse(
        { error: "userId, successUrl, and cancelUrl are required" },
        400,
      );
    }

    if (missingFields.length > 0) {
      return jsonResponse(
        { error: "shippingAddress is required", missingFields },
        400,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const { profile, errorMessage: profileEnsureError } = await loadOrCreateProfileForCheckout(
      supabase,
      userId,
      {
        fullName: shippingAddress.fullName,
        email: shippingAddress.email,
        addressLine1: shippingAddress.addressLine1,
        addressLine2: shippingAddress.addressLine2,
        city: shippingAddress.city,
        state: shippingAddress.state,
        zip: shippingAddress.zip,
      },
    );

    if (profileEnsureError || !profile) {
      return jsonResponse(
        { error: profileEnsureError || "Could not load or create profile for checkout" },
        404,
      );
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

    if (bundleLines.length === 0) {
      const planId = String(body.planId || "");
      const billingCycle = normalizeBilling(body.billingCycle);
      if (!planId) {
        return jsonResponse(
          { error: "planId or initialPurchaseGroups is required" },
          400,
        );
      }

      const plan = getStorkBinPlan(planId);
      if (!plan) {
        return jsonResponse({ error: `Unknown planId: ${planId}` }, 400);
      }

      const requestedSubscriptionGroupId = String(
        body.subscriptionGroupId || body.cartSubscriptionGroupId || "",
      ).trim();

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
              error:
                "Multiple subscription groups match this plan. Pass subscriptionGroupId or use initialPurchaseGroups.",
              matchingCartGroups: matchingGroups.length,
            },
            400,
          );
        }
      }

      const subscriptionGroupId = cartSubscriptionGroupId || crypto.randomUUID();
      bundleLines = [{
        planId,
        subscriptionGroupId,
        billingCycle,
      }];
    }

    const resolvedPlans: { line: BundleLine; plan: NonNullable<ReturnType<typeof getStorkBinPlan>> }[] = [];

    for (const line of bundleLines) {
      let plan = getStorkBinPlan(line.planId);
      if (!plan) {
        return jsonResponse({ error: `Unknown planId: ${line.planId}` }, 400);
      }

      const { data: cartBoxes, error: cartBoxesError } = await supabase
        .from("boxes")
        .select("id")
        .eq("user_id", userId)
        .eq("subscription_group_id", line.subscriptionGroupId)
        .eq("checkout_status", "in_cart")
        .eq("cart_type", "initial_purchase");

      if (cartBoxesError) {
        return jsonResponse({ error: `Could not read cart boxes: ${cartBoxesError.message}` }, 500);
      }

      const foundCount = (cartBoxes || []).length;
      const effectiveLine = { ...line };

      if (explicitBundleRequest && foundCount !== plan.binCount) {
        const inferred =
          foundCount === 4
            ? getStorkBinPlan("four_bins")
            : foundCount === 2
            ? getStorkBinPlan("two_bins")
            : foundCount === 1
            ? getStorkBinPlan("one_bin")
            : null;
        if (inferred && inferred.binCount === foundCount) {
          effectiveLine.planId = inferred.id;
          plan = inferred;
          console.warn("create-initial-checkout: aligned plan to cart bin count", {
            subscriptionGroupId: line.subscriptionGroupId,
            requestedPlanId: line.planId,
            correctedPlanId: inferred.id,
            foundBins: foundCount,
          });
        } else {
          return jsonResponse(
            {
              error: "Cart does not match this plan for the given subscription group.",
              planId: line.planId,
              subscriptionGroupId: line.subscriptionGroupId,
              expectedBins: plan.binCount,
              foundBins: foundCount,
            },
            400,
          );
        }
      }

      resolvedPlans.push({ line: effectiveLine, plan });
    }

    const first = resolvedPlans[0];
    // Short keys keep bundle_json under Stripe's 500-char metadata limit when many plans ship together.
    const bundleJson = JSON.stringify(
      resolvedPlans.map(({ line }) => ({
        p: line.planId,
        s: line.subscriptionGroupId,
        b: line.billingCycle,
      })),
    );

    let totalInitialPaymentCents = 0;
    let lineItemIndex = 0;
    const sessionParams = new URLSearchParams();
    sessionParams.append("mode", "payment");
    sessionParams.append("customer", stripeCustomerId);
    sessionParams.append("success_url", successUrl);
    sessionParams.append("cancel_url", cancelUrl);
    sessionParams.append("payment_intent_data[setup_future_usage]", "off_session");

    for (const { line, plan } of resolvedPlans) {
      const billedStorageCents = line.billingCycle === "annual"
        ? plan.monthlyRateCents * 11
        : plan.monthlyRateCents;
      const bundledKitCents = plan.setupFeeCents + billedStorageCents;
      totalInitialPaymentCents += bundledKitCents;

      // One Checkout line per starter kit so customers cannot drop setup or storage independently.
      const kitTitle = line.billingCycle === "annual"
        ? `${plan.name} starter (setup + 11 mo storage prepay)`
        : `${plan.name} starter (setup + first month)`;
      const kitDescription = line.billingCycle === "annual"
        ? "Bundled: one-time setup fee plus 11 months prepaid storage (12th month free on annual)."
        : "Bundled: one-time setup fee plus first month of storage.";

      sessionParams.append(`line_items[${lineItemIndex}][quantity]`, "1");
      sessionParams.append(`line_items[${lineItemIndex}][price_data][currency]`, "usd");
      sessionParams.append(
        `line_items[${lineItemIndex}][price_data][unit_amount]`,
        String(bundledKitCents),
      );
      sessionParams.append(
        `line_items[${lineItemIndex}][price_data][product_data][name]`,
        kitTitle,
      );
      sessionParams.append(
        `line_items[${lineItemIndex}][price_data][product_data][description]`,
        kitDescription,
      );
      lineItemIndex += 1;
    }

    const sharedMetadata: Record<string, string | number | boolean | null | undefined> = {
      flow: "initial_purchase",
      supabase_user_id: userId,
      initial_purchase_bundle: resolvedPlans.length > 1 ? "1" : "0",
      bundle_json: bundleJson,
      bundle_row_count: resolvedPlans.length,
      plan_id: first.plan.id,
      plan_name: first.plan.name,
      bin_count: first.plan.binCount,
      monthly_rate_cents: first.plan.monthlyRateCents,
      setup_fee_cents: first.plan.setupFeeCents,
      billing_cycle: first.line.billingCycle,
      minimum_months: first.plan.minimumMonths,
      return_shipping_discount_percent: first.plan.returnShippingDiscountPercent,
      initial_shipment_stack_size: first.plan.initialShipmentStackSize,
      subscription_group_id: first.line.subscriptionGroupId,
      cart_subscription_group_id: first.line.subscriptionGroupId,
      first_month_covered: true,
      annual_prepay_months_charged: first.line.billingCycle === "annual" ? 11 : 0,
      annual_term_months_covered: first.line.billingCycle === "annual" ? 12 : 0,
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

    // Stripe caps each metadata value at 500 chars; long bundle_json can truncate and break JSON.parse.
    // Compact rows (planId|subscriptionGroupId|billingCycle) stay well under the limit for multi-plan carts.
    resolvedPlans.forEach(({ line }, i) => {
      sharedMetadata[`b_${i}`] = `${line.planId}|${line.subscriptionGroupId}|${line.billingCycle}`;
    });

    addMetadata(sessionParams, "payment_intent_data", sharedMetadata);
    addMetadata(sessionParams, "", sharedMetadata);

    const session = await stripeRequest(
      "checkout/sessions",
      sessionParams,
      stripeSecretKey,
    );

    return jsonResponse({
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
      subscriptionGroupId: first.line.subscriptionGroupId,
      subscriptionGroupIds: resolvedPlans.map(({ line }) => line.subscriptionGroupId),
    });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
