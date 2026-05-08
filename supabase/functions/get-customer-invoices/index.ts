import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function stripeGet(path: string, secretKey: string) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Stripe request failed.");
  return payload;
}

function getCustomerIdFromSubscription(subscription: Record<string, unknown>) {
  const customer = subscription.customer;
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in customer) return String((customer as { id?: unknown }).id || "");
  return "";
}

function safeInvoice(invoice: Record<string, unknown>) {
  const linesPayload = invoice.lines as { data?: Record<string, unknown>[] } | undefined;
  const firstLine = Array.isArray(linesPayload?.data) ? linesPayload.data[0] : undefined;
  const period = firstLine?.period && typeof firstLine.period === "object" ? firstLine.period as Record<string, unknown> : null;

  return {
    id: String(invoice.id || ""),
    number: invoice.number ? String(invoice.number) : "",
    status: invoice.status ? String(invoice.status) : "unknown",
    billingReason: invoice.billing_reason ? String(invoice.billing_reason) : "",
    description: invoice.description ? String(invoice.description) : String(firstLine?.description || "StorkBin invoice"),
    currency: invoice.currency ? String(invoice.currency).toUpperCase() : "USD",
    amountDue: Number(invoice.amount_due || 0),
    amountPaid: Number(invoice.amount_paid || 0),
    amountRemaining: Number(invoice.amount_remaining || 0),
    subtotal: Number(invoice.subtotal || 0),
    total: Number(invoice.total || 0),
    created: invoice.created ? Number(invoice.created) : null,
    dueDate: invoice.due_date ? Number(invoice.due_date) : null,
    paid: Boolean(invoice.paid),
    attempted: Boolean(invoice.attempted),
    attemptCount: Number(invoice.attempt_count || 0),
    hostedInvoiceUrl: invoice.hosted_invoice_url ? String(invoice.hosted_invoice_url) : "",
    invoicePdf: invoice.invoice_pdf ? String(invoice.invoice_pdf) : "",
    periodStart: period?.start ? Number(period.start) : null,
    periodEnd: period?.end ? Number(period.end) : null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Stripe or Supabase server configuration." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return jsonResponse({ error: "Missing user session." }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user?.id) return jsonResponse({ error: "Invalid or expired user session." }, 401);

    const userId = userData.user.id;
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit || 20), 1), 100);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) return jsonResponse({ error: profileError.message }, 500);

    let stripeCustomerId = profile?.stripe_customer_id ? String(profile.stripe_customer_id) : "";

    if (!stripeCustomerId) {
      const { data: boxes, error: boxesError } = await supabase
        .from("boxes")
        .select("stripe_subscription_id")
        .eq("user_id", userId)
        .not("stripe_subscription_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(10);
      if (boxesError) return jsonResponse({ error: boxesError.message }, 500);

      for (const box of boxes || []) {
        const subscriptionId = String(box.stripe_subscription_id || "");
        if (!subscriptionId) continue;
        const subscription = await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}`, stripeSecretKey);
        stripeCustomerId = getCustomerIdFromSubscription(subscription);
        if (stripeCustomerId) break;
      }
    }

    if (!stripeCustomerId) return jsonResponse({ invoices: [], stripeCustomerId: null });

    const params = new URLSearchParams();
    params.set("customer", stripeCustomerId);
    params.set("limit", String(limit));
    params.set("expand[]", "data.lines");

    const invoicesPayload = await stripeGet(`invoices?${params.toString()}`, stripeSecretKey);
    const invoices = Array.isArray(invoicesPayload.data) ? invoicesPayload.data.map((invoice: Record<string, unknown>) => safeInvoice(invoice)) : [];

    return jsonResponse({ invoices, stripeCustomerId });
  } catch (error) {
    console.error("get-customer-invoices error", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
