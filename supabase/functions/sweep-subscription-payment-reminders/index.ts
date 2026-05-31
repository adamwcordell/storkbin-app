import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendAuctionWarningForFailedBox } from "../_shared/customerEmails.ts";

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

const isoWeekKey = (date = new Date()) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || "";

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const weekKey = isoWeekKey();

  const { data: failedBoxes, error } = await supabase
    .from("boxes")
    .select(
      "id,user_id,stripe_subscription_id,subscription_payment_failed_at,lifecycle_deadline_at,lifecycle_status,subscription_payment_status",
    )
    .eq("subscription_payment_status", "failed")
    .neq("lifecycle_status", "auction")
    .neq("lifecycle_status", "removed_from_system");

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  const results: unknown[] = [];
  for (const box of failedBoxes || []) {
    const referenceKey = `${box.id}:week-${weekKey}`;
    results.push(
      await sendAuctionWarningForFailedBox(supabase, stripeSecretKey, box, referenceKey),
    );
  }

  return jsonResponse({
    ok: true,
    weekKey,
    checked: (failedBoxes || []).length,
    results,
  });
});
