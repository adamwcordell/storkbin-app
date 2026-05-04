import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ error: "Missing STRIPE_SECRET_KEY, SUPABASE_URL, or SERVICE_ROLE_KEY" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const userId = body.userId;
    const successUrl = body.successUrl || `${req.headers.get("origin") || "http://localhost:5173"}/account?payment_method=success`;
    const cancelUrl = body.cancelUrl || `${req.headers.get("origin") || "http://localhost:5173"}/account?payment_method=cancel`;

    if (!userId) {
      return jsonResponse({ error: "Missing userId" }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: box, error: boxError } = await supabase
      .from("boxes")
      .select("id,stripe_subscription_id")
      .eq("user_id", userId)
      .not("stripe_subscription_id", "is", null)
      .neq("subscription_lifecycle_status", "terminated")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (boxError) {
      return jsonResponse({ error: boxError.message }, 500);
    }

    if (!box?.stripe_subscription_id) {
      return jsonResponse({ error: "No active Stripe subscription found for this account." }, 400);
    }

    const subscription = await stripeGet(
      `subscriptions/${encodeURIComponent(box.stripe_subscription_id)}`,
      stripeSecretKey,
    );

    const customerId = typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

    if (!customerId) {
      return jsonResponse({ error: "Could not find Stripe customer for this subscription." }, 400);
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

    return new Response(JSON.stringify({ checkoutUrl: session.url }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("create-payment-method-setup-session error", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
