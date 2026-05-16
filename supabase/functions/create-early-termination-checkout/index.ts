import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  EARLY_TERMINATION_FEE_CENTS,
  isWithinMinimumTerm,
} from "../_shared/earlyTermination.ts";

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
    const { boxId } = body;

    if (!boxId) return jsonResponse({ error: "boxId is required" }, 400);

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

    const { data: box, error: boxError } = await supabase
      .from("boxes")
      .select(
        "id, user_id, status, subscription_started_at, plan_monthly_rate, plan_bin_count, stripe_subscription_id, cancel_status, subscription_lifecycle_status, early_termination_fee_waived",
      )
      .eq("id", String(boxId))
      .eq("user_id", userId)
      .maybeSingle();

    if (boxError) return jsonResponse({ error: boxError.message }, 500);
    if (!box?.id) return jsonResponse({ error: "Bin not found." }, 404);

    if (box.subscription_lifecycle_status === "terminated") {
      return jsonResponse({ error: "This subscription is already ended." }, 400);
    }

    if (box.cancel_status === "approved" || box.cancel_status === "requested") {
      return jsonResponse({ error: "A cancellation is already in progress for this bin." }, 400);
    }

    if (!box.subscription_started_at) {
      return jsonResponse({ error: "This subscription has no start date on file. Contact support." }, 400);
    }

    if (box.early_termination_fee_waived === true) {
      return jsonResponse(
        {
          error:
            "This subscription has no early termination penalty. Use standard cancellation from Account; if your bin is in storage when service ends, return shipping is charged separately.",
        },
        400,
      );
    }

    if (!isWithinMinimumTerm(box.subscription_started_at as string | null)) {
      return jsonResponse(
        { error: "Minimum term is already complete. Use standard cancellation instead." },
        400,
      );
    }

    const amountCents = EARLY_TERMINATION_FEE_CENTS;
    if (amountCents < 50) {
      return jsonResponse({ error: "Computed fee is too small." }, 400);
    }

    const successUrl = `${appBase}/checkout-success?flow=early_termination&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appBase}/account`;

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);
    params.append("client_reference_id", String(box.id));
    params.append("metadata[box_id]", String(box.id));
    params.append("metadata[user_id]", userId);
    params.append("metadata[flow]", "early_termination");
    params.append("metadata[fee_cents]", String(EARLY_TERMINATION_FEE_CENTS));
    params.append("metadata[amount_cents]", String(amountCents));
    params.append("line_items[0][price_data][currency]", "usd");
    params.append(
      "line_items[0][price_data][product_data][name]",
      "Early termination penalty",
    );
    params.append(
      "line_items[0][price_data][product_data][description]",
      "One-time early termination penalty",
    );
    params.append("line_items[0][price_data][unit_amount]", String(amountCents));
    params.append("line_items[0][quantity]", "1");

    const customerEmail = userData.user.email;
    if (customerEmail) {
      params.append("customer_email", customerEmail);
    }

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const stripeBody = await stripeResponse.json().catch(() => ({}));

    if (!stripeResponse.ok) {
      return jsonResponse(
        {
          error: "Could not create Stripe Checkout session.",
          stripeError: stripeBody?.error?.message || stripeBody,
        },
        500,
      );
    }

    if (!stripeBody?.url) {
      return jsonResponse({ error: "Stripe did not return a checkout URL." }, 500);
    }

    return jsonResponse({ url: stripeBody.url as string });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
