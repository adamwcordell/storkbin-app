import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });

const stripeRequest = async (
  path: string,
  stripeSecretKey: string,
  options: RequestInit = {},
) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Stripe request failed: ${path}`);
  }

  return payload;
};

const normalizeSubscriptionIds = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  const singleValue = String(value || "").trim();
  return singleValue ? [singleValue] : [];
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return jsonResponse({ ok: true });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (!stripeSecretKey) {
      return jsonResponse({ error: "Missing STRIPE_SECRET_KEY" }, 500);
    }

    const { subscriptionIds, subscriptionId, successUrl, cancelUrl } = await req.json();
    const ids = normalizeSubscriptionIds(subscriptionIds || subscriptionId);

    if (ids.length === 0) {
      return jsonResponse({ error: "At least one subscription id is required." }, 400);
    }

    const primarySubscriptionId = ids[0];
    const subscription = await stripeRequest(
      `subscriptions/${encodeURIComponent(primarySubscriptionId)}`,
      stripeSecretKey,
    );

    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;

    if (!customerId) {
      return jsonResponse({ error: "Subscription is missing a Stripe customer." }, 400);
    }

    const appUrl = Deno.env.get("APP_URL") || "http://localhost:5173";
    const setupSuccessUrl = successUrl || `${appUrl}/account?payment_method=success`;
    const setupCancelUrl = cancelUrl || `${appUrl}/account?payment_method=cancel`;

    const params = new URLSearchParams();
    params.append("mode", "setup");
    params.append("customer", customerId);
    params.append("payment_method_types[]", "card");
    params.append("metadata[flow]", "payment_method_update");
    params.append("metadata[stripe_customer_id]", customerId);
    params.append("metadata[stripe_subscription_ids]", ids.join(","));
    params.append("success_url", setupSuccessUrl);
    params.append("cancel_url", setupCancelUrl);

    const session = await stripeRequest("checkout/sessions", stripeSecretKey, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    return jsonResponse({ checkoutUrl: session.url, url: session.url });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
