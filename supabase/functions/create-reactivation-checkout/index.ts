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

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error?.message || "Stripe request failed";
    throw new Error(message);
  }

  return payload;
};

const perBinFirstMonthCents = (box: { plan_monthly_rate?: unknown; plan_bin_count?: unknown }) => {
  const planMonthly = Number(box.plan_monthly_rate ?? 13);
  const binCount = Math.max(1, Number(box.plan_bin_count ?? 1));
  return Math.round((planMonthly / binCount) * 100);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing server configuration." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return jsonResponse({ error: "Missing user session." }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user?.id) {
      return jsonResponse({ error: "Invalid or expired user session." }, 401);
    }

    const userId = userData.user.id;
    const body = await req.json().catch(() => ({}));
    const boxIdsRaw = body.boxIds;
    if (!Array.isArray(boxIdsRaw) || boxIdsRaw.length === 0) {
      return jsonResponse({ error: "boxIds must be a non-empty array" }, 400);
    }

    const trimmed = boxIdsRaw.map((id: unknown) => String(id || "").trim()).filter(Boolean);
    const boxIds = [...new Set(trimmed)];
    if (boxIds.length !== trimmed.length) {
      return jsonResponse({ error: "Duplicate boxIds are not allowed" }, 400);
    }
    if (boxIds.length > 12) {
      return jsonResponse({ error: "Too many bins in one reactivation checkout" }, 400);
    }

    const configuredAppUrl = String(Deno.env.get("APP_URL") || "")
      .trim()
      .replace(/\/$/, "");
    const clientOrigin = String(body.appOrigin || "")
      .trim()
      .replace(/\/$/, "");
    const appBase =
      configuredAppUrl ||
      clientOrigin ||
      "http://localhost:5173";

    if (configuredAppUrl && clientOrigin && clientOrigin !== configuredAppUrl) {
      return jsonResponse(
        { error: "App origin does not match APP_URL configured for this project." },
        400,
      );
    }

    const { data: boxes, error: boxesError } = await supabase
      .from("boxes")
      .select(
        "id, user_id, status, checkout_status, cart_type, subscription_lifecycle_status, lifecycle_status, plan_monthly_rate, plan_bin_count",
      )
      .in("id", boxIds)
      .eq("user_id", userId);

    if (boxesError) return jsonResponse({ error: boxesError.message }, 500);
    if (!boxes || boxes.length !== boxIds.length) {
      return jsonResponse({ error: "One or more bins were not found for your account." }, 404);
    }

    for (const box of boxes) {
      if (box.lifecycle_status === "auction" || box.lifecycle_status === "removed_from_system") {
        return jsonResponse(
          { error: `Bin ${box.id} can no longer be reactivated online. Contact StorkBin.` },
          400,
        );
      }
      if (box.status !== "at_customer") {
        return jsonResponse({ error: `Bin ${box.id} must still be with you to reactivate online.` }, 400);
      }
      if (box.subscription_lifecycle_status !== "terminated") {
        return jsonResponse({ error: `Bin ${box.id} is not eligible for reactivation checkout.` }, 400);
      }
      if (box.checkout_status !== "in_cart" || box.cart_type !== "reactivate_subscription") {
        return jsonResponse(
          { error: "Add reactivation to your cart from Account or My Bins before checking out." },
          400,
        );
      }
    }

    const totalCents = boxes.reduce((sum, box) => sum + perBinFirstMonthCents(box), 0);
    if (totalCents < 50) {
      return jsonResponse({ error: "Computed reactivation total is too small." }, 400);
    }

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
      if (profile.email) customerParams.append("email", String(profile.email));
      if (profile.full_name) customerParams.append("name", String(profile.full_name));
      customerParams.append("metadata[supabase_user_id]", userId);

      const customer = await stripeRequest("customers", customerParams, stripeSecretKey);
      stripeCustomerId = customer.id as string;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", userId);

      if (updateError) {
        return jsonResponse({ error: "Failed to save Stripe customer ID" }, 500);
      }
    }

    const successUrl = `${appBase}/checkout-success?flow=subscription_reactivation&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appBase}/cart?checkout=cancel`;

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("customer", stripeCustomerId);
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);
    params.append("payment_intent_data[setup_future_usage]", "off_session");
    params.append("client_reference_id", boxIds.join(","));
    params.append("metadata[flow]", "subscription_reactivation");
    params.append("metadata[supabase_user_id]", userId);
    params.append("metadata[box_ids]", boxIds.join(","));
    params.append("metadata[first_month_total_cents]", String(totalCents));

    params.append("line_items[0][price_data][currency]", "usd");
    params.append(
      "line_items[0][price_data][product_data][name]",
      boxIds.length > 1
        ? `StorkBin subscription reactivation (first month, ${boxIds.length} bins)`
        : "StorkBin subscription reactivation (first month)",
    );
    params.append("line_items[0][price_data][unit_amount]", String(totalCents));
    params.append("line_items[0][quantity]", "1");

    const session = await stripeRequest("checkout/sessions", params, stripeSecretKey);

    if (!session?.url) {
      return jsonResponse({ error: "Stripe did not return a checkout URL." }, 500);
    }

    return jsonResponse({
      checkoutUrl: session.url as string,
      url: session.url as string,
      firstMonthTotalCents: totalCents,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
