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

    if (!stripeSecretKey) {
      return jsonResponse({ error: "Missing STRIPE_SECRET_KEY" }, 500);
    }

    const { subscriptionId, successUrl, cancelUrl } = await req.json();

    if (!subscriptionId) {
      return jsonResponse({ error: "subscriptionId is required" }, 400);
    }

    const appUrl = Deno.env.get("APP_URL") || "http://localhost:5173";
    const recoverySuccessUrl = successUrl || `${appUrl}/account?payment=success`;
    const recoveryCancelUrl = cancelUrl || `${appUrl}/account?payment=cancel`;

    const invoices = await stripeRequest(
      `invoices?subscription=${encodeURIComponent(subscriptionId)}&limit=10`,
      stripeSecretKey
    );

    const openInvoice = (invoices.data || []).find((invoice: Record<string, unknown>) => {
      const status = String(invoice.status || "");
      const amountRemaining = Number(invoice.amount_remaining || invoice.amount_due || 0);
      return status !== "paid" && status !== "void" && amountRemaining > 0;
    });

    if (!openInvoice) {
      return jsonResponse({ error: "No unpaid invoice found for this subscription." }, 404);
    }

    const customerId = String(openInvoice.customer || "");
    const amountDue = Number(openInvoice.amount_remaining || openInvoice.amount_due || 0);
    const currency = String(openInvoice.currency || "usd");

    if (!customerId) {
      return jsonResponse({ error: "Invoice is missing a Stripe customer." }, 400);
    }

    if (!amountDue || amountDue <= 0) {
      return jsonResponse({ error: "Invoice does not have an amount due." }, 400);
    }

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("customer", customerId);
    params.append("payment_method_types[]", "card");
    params.append("payment_intent_data[setup_future_usage]", "off_session");
    params.append("metadata[flow]", "subscription_payment_recovery");
    params.append("metadata[stripe_subscription_id]", subscriptionId);
    params.append("metadata[stripe_invoice_id]", String(openInvoice.id || ""));
    params.append("line_items[0][price_data][currency]", currency);
    params.append("line_items[0][price_data][product_data][name]", "StorkBin subscription payment recovery");
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
