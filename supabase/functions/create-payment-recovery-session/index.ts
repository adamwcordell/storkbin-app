import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  options: RequestInit = {}
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return jsonResponse({ ok: true });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Stripe or Supabase server configuration." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return jsonResponse({ error: "Missing user session." }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user?.id) {
      return jsonResponse({ error: "Invalid or expired user session." }, 401);
    }

    const userId = userData.user.id;
    const { subscriptionId, successUrl, cancelUrl } = await req.json();

    if (!subscriptionId) {
      return jsonResponse({ error: "subscriptionId is required" }, 400);
    }

    const { data: matchingBox, error: matchingBoxError } = await supabase
      .from("boxes")
      .select("id")
      .eq("user_id", userId)
      .eq("stripe_subscription_id", subscriptionId)
      .limit(1)
      .maybeSingle();

    if (matchingBoxError) {
      return jsonResponse({ error: matchingBoxError.message }, 500);
    }

    if (!matchingBox?.id) {
      return jsonResponse({ error: "Subscription does not belong to the authenticated user." }, 403);
    }

    const appUrl = Deno.env.get("APP_URL") || "http://localhost:5173";
    const recoverySuccessUrl = successUrl || `${appUrl}/checkout-success?flow=subscription_payment_recovery`;
    const recoveryCancelUrl = cancelUrl || `${appUrl}/account?payment=cancel`;

    const invoices = await stripeRequest(
      `invoices?subscription=${encodeURIComponent(subscriptionId)}&limit=100`,
      stripeSecretKey
    );

    const unpaidInvoices = (invoices.data || []).filter((invoice: Record<string, unknown>) => {
      const status = String(invoice.status || "");
      const amountRemaining = Number(invoice.amount_remaining || invoice.amount_due || 0);
      return !["paid", "void", "uncollectible"].includes(status) && amountRemaining > 0;
    });

    if (unpaidInvoices.length === 0) {
      return jsonResponse({ error: "No unpaid invoices found for this subscription." }, 404);
    }

    const customerId = String(unpaidInvoices[0].customer || "");
    const currency = String(unpaidInvoices[0].currency || "usd");
    const hasMixedCurrency = unpaidInvoices.some(
      (invoice: Record<string, unknown>) => String(invoice.currency || "usd") !== currency,
    );

    if (!customerId) {
      return jsonResponse({ error: "Invoice is missing a Stripe customer." }, 400);
    }

    if (hasMixedCurrency) {
      return jsonResponse({ error: "Cannot recover invoices with mixed currencies." }, 400);
    }

    const amountDue = unpaidInvoices.reduce(
      (sum: number, invoice: Record<string, unknown>) =>
        sum + Number(invoice.amount_remaining || invoice.amount_due || 0),
      0,
    );

    if (!amountDue || amountDue <= 0) {
      return jsonResponse({ error: "Invoices do not have an amount due." }, 400);
    }

    const invoiceIds = unpaidInvoices
      .map((invoice: Record<string, unknown>) => String(invoice.id || ""))
      .filter(Boolean);

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("customer", customerId);
    params.append("payment_method_types[]", "card");
    params.append("payment_intent_data[setup_future_usage]", "off_session");
    params.append("metadata[flow]", "subscription_payment_recovery");
    params.append("metadata[stripe_subscription_id]", subscriptionId);
    params.append("metadata[stripe_invoice_id]", invoiceIds[0] || "");
    params.append("metadata[stripe_invoice_ids]", invoiceIds.join(","));
    params.append("metadata[unpaid_invoice_count]", String(invoiceIds.length));
    params.append("line_items[0][price_data][currency]", currency);
    params.append(
      "line_items[0][price_data][product_data][name]",
      invoiceIds.length > 1
        ? `StorkBin overdue subscription balance (${invoiceIds.length} invoices)`
        : "StorkBin subscription payment recovery",
    );
    params.append("line_items[0][price_data][unit_amount]", String(amountDue));
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", recoverySuccessUrl);
    params.append("cancel_url", recoveryCancelUrl);

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
      500
    );
  }
});
