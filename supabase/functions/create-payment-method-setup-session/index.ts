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
  stripeSecretKey: string,
  body: URLSearchParams,
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
    throw new Error(payload?.error?.message || `Stripe request failed: ${path}`);
  }

  return payload;
};

const stripeGet = async (path: string, stripeSecretKey: string) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Stripe request failed: ${path}`);
  }

  return payload;
};

const getCustomerIdFromSubscription = (subscription: Record<string, unknown>) => {
  const customer = subscription.customer;
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in customer) {
    return String((customer as { id?: unknown }).id || "");
  }
  return "";
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey =
      Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ error: "Missing server configuration." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return jsonResponse({ error: "Missing user session." }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user?.id) {
      return jsonResponse({ error: "Invalid or expired user session." }, 401);
    }

    const userId = userData.user.id;
    const body = await req.json().catch(() => ({}));
    const successUrl = body.successUrl || `${req.headers.get("origin") || "http://localhost:5173"}/checkout-success?flow=payment_method_update`;
    const cancelUrl = body.cancelUrl || `${req.headers.get("origin") || "http://localhost:5173"}/account?payment_method=cancel`;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id,email,full_name,stripe_customer_id")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return jsonResponse({ error: "Profile not found for user." }, 404);
    }

    let customerId = profile.stripe_customer_id ? String(profile.stripe_customer_id) : "";

    if (!customerId) {
      const { data: boxes, error: boxesError } = await supabase
        .from("boxes")
        .select("stripe_subscription_id")
        .eq("user_id", userId)
        .not("stripe_subscription_id", "is", null)
        .neq("subscription_lifecycle_status", "terminated")
        .order("created_at", { ascending: false })
        .limit(10);

      if (boxesError) {
        return jsonResponse({ error: boxesError.message }, 500);
      }

      for (const box of boxes || []) {
        const subscriptionId = String(box.stripe_subscription_id || "");
        if (!subscriptionId) continue;

        const subscription = await stripeGet(
          `subscriptions/${encodeURIComponent(subscriptionId)}`,
          stripeSecretKey,
        );
        customerId = getCustomerIdFromSubscription(subscription);
        if (customerId) break;
      }
    }

    if (!customerId) {
      const customerParams = new URLSearchParams();
      const email = profile.email || userData.user.email;
      if (email) customerParams.append("email", String(email));
      if (profile.full_name) customerParams.append("name", String(profile.full_name));
      customerParams.append("metadata[supabase_user_id]", userId);

      const customer = await stripeRequest("customers", stripeSecretKey, customerParams);
      customerId = String(customer.id || "");

      if (!customerId) {
        return jsonResponse({ error: "Could not create Stripe customer for this account." }, 500);
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId);

      if (updateError) {
        console.error("create-payment-method-setup-session profile update", updateError);
      }
    } else if (!profile.stripe_customer_id) {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId);

      if (updateError) {
        console.error("create-payment-method-setup-session profile backfill", updateError);
      }
    }

    const params = new URLSearchParams();
    params.append("mode", "setup");
    params.append("customer", customerId);
    params.append("payment_method_types[0]", "card");
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);
    params.append("metadata[flow]", "payment_method_update");
    params.append("metadata[supabase_user_id]", userId);
    params.append("metadata[stripe_customer_id]", customerId);

    const session = await stripeRequest("checkout/sessions", stripeSecretKey, params);

    return jsonResponse({ checkoutUrl: session.url });
  } catch (error) {
    console.error("create-payment-method-setup-session error", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
