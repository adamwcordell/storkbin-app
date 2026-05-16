import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function cancelStripeSubscriptionNow(stripeSecretKey: string, subscriptionId: string) {
  const res = await fetch(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
      },
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message || "Stripe subscription cancel failed");
  }
  return body;
}

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
    const sessionId = String(body.sessionId || "").trim();
    const shippingPreference = body.shippingPreference as
      | { source?: string | null; address?: Record<string, string> | null }
      | null
      | undefined;

    if (!sessionId) return jsonResponse({ error: "sessionId is required" }, 400);

    const sessionRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: { Authorization: `Bearer ${stripeSecretKey}` },
      },
    );
    const session = await sessionRes.json().catch(() => ({}));
    if (!sessionRes.ok) {
      return jsonResponse({ error: session?.error?.message || "Could not load Checkout session." }, 400);
    }

    if (session.payment_status !== "paid") {
      return jsonResponse({ error: "Checkout session is not paid yet." }, 400);
    }

    if (String(session.metadata?.flow || "") !== "early_termination") {
      return jsonResponse({ error: "This session is not an early termination payment." }, 400);
    }

    const boxId = String(session.metadata?.box_id || "").trim();
    if (!boxId) return jsonResponse({ error: "Missing box on session metadata." }, 400);

    if (String(session.metadata?.user_id || "") !== userId) {
      return jsonResponse({ error: "Session does not belong to the signed-in user." }, 403);
    }

    const { data: box, error: boxError } = await supabase
      .from("boxes")
      .select("*")
      .eq("id", boxId)
      .eq("user_id", userId)
      .maybeSingle();

    if (boxError) return jsonResponse({ error: boxError.message }, 500);
    if (!box?.id) return jsonResponse({ error: "Bin not found." }, 404);

    if (
      typeof box.cancel_review_note === "string" &&
      box.cancel_review_note.includes("Early contract termination")
    ) {
      return jsonResponse({ ok: true, alreadyCompleted: true });
    }

    const metaCents = Number(session.metadata?.amount_cents || 0);
    const paidCents = Number(session.amount_total || 0);
    const expectedCents = metaCents > 0 ? metaCents : paidCents;
    if (!Number.isFinite(expectedCents) || expectedCents < 50 || paidCents < expectedCents) {
      return jsonResponse({ error: "Payment amount does not match the early termination fee." }, 400);
    }

    const boxIsStored = box.status === "stored";
    const now = new Date().toISOString();

    let cancellationShippingAddress: Record<string, string> | null = null;
    let cancellationShippingAddressSource: string | null = null;
    let missingStoredAddress = false;

    if (boxIsStored) {
      const source =
        typeof shippingPreference?.source === "string" && shippingPreference.source.trim()
          ? shippingPreference.source
          : "profile";
      cancellationShippingAddressSource = source;

      if (source === "custom") {
        const customAddress = shippingPreference.address || {};
        if (
          !customAddress.address_line1?.trim() ||
          !customAddress.city?.trim() ||
          !customAddress.state?.trim() ||
          !customAddress.zip?.trim()
        ) {
          return jsonResponse({ error: "Incomplete custom shipping address." }, 400);
        }
        cancellationShippingAddress = {
          full_name: String(customAddress.full_name || ""),
          email: String(customAddress.email || ""),
          address_line1: String(customAddress.address_line1).trim(),
          address_line2: String(customAddress.address_line2 || ""),
          city: String(customAddress.city).trim(),
          state: String(customAddress.state).trim(),
          zip: String(customAddress.zip).trim(),
        };
      } else {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .maybeSingle();
        if (profileError || !profile) {
          // Do not fail the paid termination flow if profile lookup is missing.
          // We will complete termination and return a warning so support/customer can add address.
          missingStoredAddress = true;
          cancellationShippingAddress = null;
          cancellationShippingAddressSource = "profile";
        } else {
          cancellationShippingAddress = {
            full_name: String(profile.full_name || ""),
            email: String(profile.email || ""),
            address_line1: String(profile.address_line1 || ""),
            address_line2: String(profile.address_line2 || ""),
            city: String(profile.city || ""),
            state: String(profile.state || ""),
            zip: String(profile.zip || ""),
          };
        }
      }
    }

    if (box.stripe_subscription_id) {
      try {
        await cancelStripeSubscriptionNow(stripeSecretKey, String(box.stripe_subscription_id));
      } catch (stripeErr) {
        const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr);
        const ignorable =
          /no such subscription/i.test(msg) ||
          /already been canceled/i.test(msg) ||
          /already cancelled/i.test(msg);
        if (!ignorable) {
          return jsonResponse(
            {
              error:
                stripeErr instanceof Error
                  ? stripeErr.message
                  : "Payment was received but Stripe could not cancel the subscription immediately. Contact support.",
            },
            500,
          );
        }
      }
    }

    const updates: Record<string, unknown> = {
      cancel_requested_at: now,
      cancel_status: "approved",
      subscription_ends_at: now,
      cancel_reviewed_at: now,
      cancel_review_note: missingStoredAddress
        ? "Early contract termination (fee paid; shipping address required)"
        : "Early contract termination (fee paid)",
    };

    if (boxIsStored && cancellationShippingAddress) {
      updates.cancellation_shipping_address = cancellationShippingAddress;
      updates.cancellation_shipping_address_source = cancellationShippingAddressSource;
      updates.cancellation_shipping_charge_status = "pending_auto_charge";
    }

    const { error: updateError } = await supabase.from("boxes").update(updates).eq("id", boxId);

    if (updateError) return jsonResponse({ error: updateError.message }, 500);

    return jsonResponse({
      ok: true,
      warning: missingStoredAddress
        ? "Payment succeeded and subscription ended, but we could not load a shipping address for the stored bin. Please update your account address."
        : null,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
