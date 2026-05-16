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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const nowIso = new Date().toISOString();

  const { data: overdueBoxes, error: overdueError } = await supabase
    .from("boxes")
    .select("id,box_number,user_id,status,lifecycle_status,subscription_payment_status,lifecycle_deadline_at")
    .eq("status", "stored")
    .eq("subscription_payment_status", "failed")
    .neq("lifecycle_status", "auction")
    .lte("lifecycle_deadline_at", nowIso);

  if (overdueError) {
    return jsonResponse({ error: `Could not load overdue auction candidates: ${overdueError.message}` }, 500);
  }

  const candidates = overdueBoxes || [];
  if (candidates.length === 0) {
    return jsonResponse({ ok: true, checked: 0, escalated: 0, escalatedBoxIds: [] });
  }

  const candidateIds = candidates.map((box) => box.id).filter(Boolean);

  const { data: updatedRows, error: updateError } = await supabase
    .from("boxes")
    .update({
      lifecycle_status: "auction",
      lifecycle_attention_reason: "stored_subscription_payment_failed_auction_escalated",
    })
    .in("id", candidateIds)
    .select("id,box_number,user_id,lifecycle_status,lifecycle_attention_reason");

  if (updateError) {
    return jsonResponse({ error: `Could not escalate overdue bins to auction: ${updateError.message}` }, 500);
  }

  return jsonResponse({
    ok: true,
    checked: candidates.length,
    escalated: (updatedRows || []).length,
    escalatedBoxIds: (updatedRows || []).map((row) => row.id),
  });
});
