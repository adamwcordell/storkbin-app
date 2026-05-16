import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { reconcileStripeSubscriptionGroup } from "../_shared/stripeSubscriptionReconcile.ts";

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

const DEFAULT_LIMIT = 150;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" }, 500);
  }

  if (!stripeSecretKey) {
    return jsonResponse({ error: "Missing STRIPE_SECRET_KEY" }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(
    500,
    Math.max(1, Number(body.limit || DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  const dryRun = body.dryRun === true;
  /** Default true: 404 on GET /subscriptions/:id treats sub as deleted (matches prior behavior). Set false if you fear key/live-mode mismatches. */
  const treatStripe404AsCanceled = body.treatStripe404AsCanceled !== false;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: rowsRaw, error: loadError } = await supabase
    .from("boxes")
    .select(
      "id,status,stripe_subscription_id,subscription_payment_status,subscription_lifecycle_status,checkout_status,lifecycle_status",
    )
    .eq("checkout_status", "paid")
    .not("stripe_subscription_id", "is", null);

  if (loadError) {
    return jsonResponse({ error: `Could not load boxes: ${loadError.message}` }, 500);
  }

  const rows = (rowsRaw || []).filter(
    (r) => r.lifecycle_status !== "auction" && r.lifecycle_status !== "removed_from_system",
  );

  const bySub = new Map<
    string,
    Array<{
      id: string;
      status?: string | null;
      subscription_payment_status?: string | null;
      subscription_lifecycle_status?: string | null;
    }>
  >();

  for (const row of rows || []) {
    const sid = String(row.stripe_subscription_id || "").trim();
    if (!sid) continue;
    const list = bySub.get(sid) || [];
    list.push({
      id: row.id,
      status: row.status,
      subscription_payment_status: row.subscription_payment_status,
      subscription_lifecycle_status: row.subscription_lifecycle_status,
    });
    bySub.set(sid, list);
  }

  const uniqueIds = [...bySub.keys()];
  const toProcess = uniqueIds.slice(0, limit);

  const results: Array<Record<string, unknown>> = [];
  const summary = {
    scannedSubscriptions: toProcess.length,
    totalCandidates: uniqueIds.length,
    scheduledCancelSynced: 0,
    terminationSynced: 0,
    paymentFailedFromPastDue: 0,
    paymentHealed: 0,
    noChanges: 0,
    skippedStripeNotFound: 0,
    errors: 0,
  };

  for (const subscriptionId of toProcess) {
    const group = bySub.get(subscriptionId) || [];
    const outcome = await reconcileStripeSubscriptionGroup(
      supabase,
      stripeSecretKey,
      subscriptionId,
      group,
      { dryRun, treatStripe404AsCanceled },
    );

    if (outcome.error) {
      summary.errors += 1;
      results.push({ subscriptionId, error: outcome.error });
      continue;
    }

    for (const a of outcome.actions) {
      if (a === "synced_scheduled_cancellation") summary.scheduledCancelSynced += 1;
      if (a === "synced_stripe_termination") summary.terminationSynced += 1;
      if (a === "marked_payment_failed_from_past_due") summary.paymentFailedFromPastDue += 1;
      if (a === "healed_payment_from_paid_invoice") summary.paymentHealed += 1;
      if (a === "no_changes") summary.noChanges += 1;
      if (a === "skipped_stripe_subscription_not_found") summary.skippedStripeNotFound += 1;
    }

    results.push({
      subscriptionId,
      stripeStatus: outcome.stripeStatus,
      actions: outcome.actions,
      boxCount: outcome.boxIds.length,
    });
  }

  return jsonResponse({
    ok: true,
    limit,
    dryRun,
    treatStripe404AsCanceled,
    summary,
    results,
  });
});
