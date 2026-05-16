import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { fulfillInitialPurchaseCheckoutSessionCompletedCore } from "../_shared/initialPurchaseFulfillment.ts";

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
    const stripeBinMonthlyPriceId = Deno.env.get("STRIPE_BIN_MONTHLY_PRICE_ID") || "";
    const stripeBinStorageProductId = Deno.env.get("STRIPE_BIN_STORAGE_PRODUCT_ID") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing server configuration" }, 500);
    }
    if (!stripeBinMonthlyPriceId.trim() && !stripeBinStorageProductId.trim()) {
      return jsonResponse(
        { error: "Missing STRIPE_BIN_MONTHLY_PRICE_ID or STRIPE_BIN_STORAGE_PRODUCT_ID" },
        500,
      );
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return jsonResponse({ error: "Missing user session" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user?.id) {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }

    const userId = userData.user.id;
    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) return jsonResponse({ error: "sessionId is required" }, 400);

    const sessionRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: { Authorization: `Bearer ${stripeSecretKey}` },
      },
    );
    const session = await sessionRes.json().catch(() => ({}));
    if (!sessionRes.ok) {
      return jsonResponse({ error: session?.error?.message || "Could not load Checkout session" }, 400);
    }

    if (String(session.payment_status || "") !== "paid") {
      return jsonResponse({ ok: true, skipped: true, reason: "session not paid" });
    }

    const metadata = session.metadata || {};
    if (String(metadata.flow || "") !== "initial_purchase") {
      return jsonResponse({ ok: true, skipped: true, reason: "not an initial_purchase session" });
    }

    if (String(metadata.supabase_user_id || "") !== userId) {
      return jsonResponse({ error: "This checkout does not belong to the signed-in user" }, 403);
    }

    const { status, body: resultBody } = await fulfillInitialPurchaseCheckoutSessionCompletedCore({
      supabase,
      session: session as Record<string, unknown>,
      metadata: metadata as Record<string, unknown>,
      stripeSecretKey,
      stripeBinMonthlyPriceId,
      stripeBinStorageProductId,
    });

    return jsonResponse({ ok: status >= 200 && status < 300, ...resultBody }, status);
  } catch (error) {
    console.error("finalize-initial-purchase-checkout", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
