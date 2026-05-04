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

    const { stripeSubscriptionId, cancelAt } = await req.json();

    if (!stripeSubscriptionId) {
      return jsonResponse({ error: "stripeSubscriptionId is required" }, 400);
    }

    if (!cancelAt) {
      return jsonResponse({ error: "cancelAt is required" }, 400);
    }

    const cancelAtUnix = Math.floor(new Date(cancelAt).getTime() / 1000);

    if (!Number.isFinite(cancelAtUnix)) {
      return jsonResponse({ error: "cancelAt must be a valid date" }, 400);
    }

    const params = new URLSearchParams();
    params.append("cancel_at", String(cancelAtUnix));
    params.append("proration_behavior", "none");

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/subscriptions/${stripeSubscriptionId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      }
    );

    const stripeBody = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return jsonResponse(
        {
          error: "Stripe subscription cancellation schedule failed",
          stripeError: stripeBody?.error?.message || stripeBody,
        },
        500
      );
    }

    return jsonResponse({
      ok: true,
      stripeSubscriptionId,
      cancelAt,
      stripeCancelAt: stripeBody.cancel_at,
      status: stripeBody.status,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});
