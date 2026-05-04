import fs from "fs";
import path from "path";

const webhookPath = path.join(process.cwd(), "supabase", "functions", "stripe-webhook", "index.ts");

if (!fs.existsSync(webhookPath)) {
  console.error("Could not find supabase/functions/stripe-webhook/index.ts. Run this from your StorkBin project root.");
  process.exit(1);
}

let code = fs.readFileSync(webhookPath, "utf8");

if (code.includes("syncStripeSubscriptionCancellation")) {
  console.log("Stripe subscription cancellation sync already appears to be installed.");
  process.exit(0);
}

const helper = `
const syncStripeSubscriptionCancellation = async ({
  supabase,
  subscription,
}) => {
  const subscriptionId = subscription?.id;

  if (!subscriptionId) {
    return { ignored: true, reason: "missing subscription id" };
  }

  const stripeStatus = subscription?.status || null;
  const canceledAt = subscription?.canceled_at
    ? new Date(subscription.canceled_at * 1000).toISOString()
    : new Date().toISOString();

  const cancelAt = subscription?.cancel_at
    ? new Date(subscription.cancel_at * 1000).toISOString()
    : null;

  const shouldTerminate =
    stripeStatus === "canceled" ||
    stripeStatus === "unpaid" ||
    subscription?.ended_at ||
    subscription?.canceled_at;

  if (!shouldTerminate && cancelAt) {
    const { error } = await supabase
      .from("boxes")
      .update({
        subscription_status: stripeStatus || "active",
        subscription_ends_at: cancelAt,
      })
      .eq("stripe_subscription_id", subscriptionId);

    if (error) {
      throw new Error(\`Could not sync Stripe scheduled cancellation: \${error.message}\`);
    }

    return { updated: true, subscriptionId, scheduledCancelAt: cancelAt };
  }

  if (!shouldTerminate) {
    return { ignored: true, reason: "subscription still active", subscriptionId, stripeStatus };
  }

  const { error } = await supabase
    .from("boxes")
    .update({
      subscription_status: "terminated",
      subscription_lifecycle_status: "terminated",
      subscription_terminated_at: canceledAt,
      lifecycle_status: "terminated",
      lifecycle_attention_reason: null,
      lifecycle_deadline_at: null,
    })
    .eq("stripe_subscription_id", subscriptionId);

  if (error) {
    throw new Error(\`Could not sync Stripe subscription cancellation: \${error.message}\`);
  }

  return { updated: true, subscriptionId, stripeStatus, canceledAt };
};

`;

// Insert helper before serve(...)
const serveIndex = code.indexOf("serve(async");
if (serveIndex === -1) {
  console.error("Could not find serve(async in webhook file.");
  process.exit(1);
}

code = code.slice(0, serveIndex) + helper + code.slice(serveIndex);

// Add handlers after supabase client creation when possible.
const handler = `
  if (
    event.type === "customer.subscription.deleted" ||
    event.type === "customer.subscription.updated"
  ) {
    const result = await syncStripeSubscriptionCancellation({
      supabase,
      subscription: event.data?.object || {},
    });

    return jsonResponse({
      received: true,
      eventType: event.type,
      result,
    });
  }

`;

const supabaseClientPattern = /const supabase = createClient\([\s\S]*?\);\s*/;
const match = code.match(supabaseClientPattern);

if (!match) {
  console.error("Could not find Supabase client creation block in webhook file.");
  process.exit(1);
}

const insertAt = match.index + match[0].length;
code = code.slice(0, insertAt) + handler + code.slice(insertAt);

// Widen strict allowlist guards if present.
code = code.replace(
  /event\.type !== "invoice\.payment_failed"\s*\)/g,
  `event.type !== "invoice.payment_failed" &&
    event.type !== "customer.subscription.deleted" &&
    event.type !== "customer.subscription.updated"
  )`
);

code = code.replace(
  /event\.type !== "invoice_payment\.failed"\s*\)/g,
  `event.type !== "invoice_payment.failed" &&
    event.type !== "customer.subscription.deleted" &&
    event.type !== "customer.subscription.updated"
  )`
);

fs.writeFileSync(webhookPath, code);
console.log("Patched stripe-webhook to sync customer.subscription.deleted/updated cancellation state.");
