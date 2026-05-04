import fs from "fs";
import path from "path";

const webhookPath = path.join(process.cwd(), "supabase", "functions", "stripe-webhook", "index.ts");

if (!fs.existsSync(webhookPath)) {
  console.error("Could not find supabase/functions/stripe-webhook/index.ts. Run this from your StorkBin project root.");
  process.exit(1);
}

let code = fs.readFileSync(webhookPath, "utf8");

if (code.includes("handleSubscriptionRecoveryCheckout")) {
  console.log("Recovery checkout webhook cleanup already installed.");
  process.exit(0);
}

const helper = `
const stripeApiRequest = async (
  path: string,
  stripeSecretKey: string,
  options: RequestInit = {}
) => {
  const response = await fetch(\`https://api.stripe.com/v1/\${path}\`, {
    ...options,
    headers: {
      Authorization: \`Bearer \${stripeSecretKey}\`,
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message || \`Stripe request failed: \${path}\`);
  }

  return payload;
};

const handleSubscriptionRecoveryCheckout = async ({
  supabase,
  session,
}: {
  supabase: ReturnType<typeof createClient>;
  session: Record<string, any>;
}) => {
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

  if (!stripeSecretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  const metadata = session.metadata || {};
  const subscriptionId = metadata.stripe_subscription_id;
  const invoiceId = metadata.stripe_invoice_id;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!subscriptionId) {
    return { ignored: true, reason: "missing stripe_subscription_id metadata" };
  }

  let paymentMethodId = null;

  if (paymentIntentId) {
    const paymentIntent = await stripeApiRequest(
      \`payment_intents/\${encodeURIComponent(paymentIntentId)}\`,
      stripeSecretKey
    );

    paymentMethodId =
      typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : paymentIntent.payment_method?.id || null;
  }

  if (paymentMethodId && customerId) {
    const customerParams = new URLSearchParams();
    customerParams.append("invoice_settings[default_payment_method]", paymentMethodId);

    await stripeApiRequest(\`customers/\${encodeURIComponent(customerId)}\`, stripeSecretKey, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: customerParams,
    });
  }

  if (paymentMethodId) {
    const subscriptionParams = new URLSearchParams();
    subscriptionParams.append("default_payment_method", paymentMethodId);

    await stripeApiRequest(
      \`subscriptions/\${encodeURIComponent(subscriptionId)}\`,
      stripeSecretKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: subscriptionParams,
      }
    );
  }

  const updatePayload: Record<string, string | null> = {
    subscription_payment_status: "paid",
    subscription_payment_failed_at: null,
    last_payment_failed_at: null,
    subscription_payment_deadline_at: null,
    lifecycle_deadline_at: null,
    lifecycle_attention_reason: null,
    subscription_payment_failure_reason: null,
  };

  const { error } = await supabase
    .from("boxes")
    .update(updatePayload)
    .eq("stripe_subscription_id", subscriptionId);

  if (error) {
    throw new Error(\`Could not clear failed subscription payment state: \${error.message}\`);
  }

  return {
    updated: true,
    subscriptionId,
    invoiceId,
    paymentIntentId,
    paymentMethodId,
  };
};

`;

const serveIndex = code.indexOf("serve(async");
if (serveIndex === -1) {
  console.error("Could not find serve(async in stripe-webhook/index.ts.");
  process.exit(1);
}

code = code.slice(0, serveIndex) + helper + code.slice(serveIndex);

const handler = `
  if (
    event.type === "checkout.session.completed" &&
    event.data?.object?.metadata?.flow === "subscription_payment_recovery"
  ) {
    const result = await handleSubscriptionRecoveryCheckout({
      supabase,
      session: event.data.object || {},
    });

    return jsonResponse({
      received: true,
      eventType: event.type,
      flow: "subscription_payment_recovery",
      result,
    });
  }

`;

const supabaseClientPattern = /const supabase = createClient\([\s\S]*?\);\s*/;
const match = code.match(supabaseClientPattern);

if (!match || typeof match.index !== "number") {
  console.error("Could not find Supabase client creation block in stripe-webhook/index.ts.");
  process.exit(1);
}

const insertAt = match.index + match[0].length;
code = code.slice(0, insertAt) + handler + code.slice(insertAt);

// Make sure checkout.session.completed is not prematurely ignored before the recovery handler.
// This widens common strict allowlists.
code = code.replace(
  /event\.type !== "invoice\.payment_failed"\s*\)/g,
  `event.type !== "invoice.payment_failed" &&
    event.type !== "checkout.session.completed"
  )`
);

code = code.replace(
  /event\.type !== "invoice_payment\.failed"\s*\)/g,
  `event.type !== "invoice_payment.failed" &&
    event.type !== "checkout.session.completed"
  )`
);

fs.writeFileSync(webhookPath, code);
console.log("Patched stripe-webhook: subscription recovery Checkout now clears failed state and updates Stripe default card.");
