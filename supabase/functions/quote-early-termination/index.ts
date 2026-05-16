import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  EARLY_TERMINATION_FEE_CENTS,
  isWithinMinimumTerm,
  MINIMUM_TERM_MONTHS,
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
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
    const boxId = String(body.boxId || "").trim();
    if (!boxId) return jsonResponse({ error: "boxId is required" }, 400);

    const { data: box, error: boxError } = await supabase
      .from("boxes")
      .select(
        "id, user_id, subscription_started_at, plan_monthly_rate, plan_bin_count, subscription_lifecycle_status, cancel_status, early_termination_fee_waived",
      )
      .eq("id", boxId)
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
      return jsonResponse({
        withinMinimumTerm: false,
        minimumTermMonths: MINIMUM_TERM_MONTHS,
        feeCents: EARLY_TERMINATION_FEE_CENTS,
        amountCents: null,
        amountUsd: null,
        reason: "reactivated_no_early_fee",
      });
    }

    const within = isWithinMinimumTerm(box.subscription_started_at as string);
    if (!within) {
      return jsonResponse({
        withinMinimumTerm: false,
        minimumTermMonths: MINIMUM_TERM_MONTHS,
        feeCents: EARLY_TERMINATION_FEE_CENTS,
        amountCents: null,
        amountUsd: null,
      });
    }

    const amountCents = EARLY_TERMINATION_FEE_CENTS;

    if (amountCents < 50) {
      return jsonResponse({ error: "Computed fee is too small." }, 400);
    }

    return jsonResponse({
      withinMinimumTerm: true,
      minimumTermMonths: MINIMUM_TERM_MONTHS,
      feeCents: EARLY_TERMINATION_FEE_CENTS,
      amountCents,
      amountUsd: amountCents / 100,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
