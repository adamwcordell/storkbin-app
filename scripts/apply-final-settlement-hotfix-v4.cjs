const fs = require("fs");
const path = require("path");

const webhookPath = path.join(process.cwd(), "supabase", "functions", "stripe-webhook", "index.ts");
if (!fs.existsSync(webhookPath)) {
  console.error(`Missing webhook file: ${webhookPath}`);
  process.exit(1);
}

let source = fs.readFileSync(webhookPath, "utf8");

if (!source.includes("const handleFinalSettlementCheckout")) {
  console.error("Could not find handleFinalSettlementCheckout. Apply the final settlement patch first, then run this hotfix.");
  process.exit(1);
}

const oldBlock = `  if (paymentMethodId && customerId) {
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
      },
    );
  }
`;

const newBlock = `  // Final settlement is a one-time payment for overdue balance + return shipping.
  // Saving the card for future use is useful, but must never block settlement cleanup.
  if (paymentMethodId && customerId) {
    try {
      const attachParams = new URLSearchParams();
      attachParams.append("customer", customerId);

      await stripeApiRequest(
        \`payment_methods/\${encodeURIComponent(paymentMethodId)}/attach\`,
        stripeSecretKey,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: attachParams,
        },
      );
    } catch (error) {
      console.warn("Final settlement payment method attach skipped", error);
    }

    try {
      const customerParams = new URLSearchParams();
      customerParams.append("invoice_settings[default_payment_method]", paymentMethodId);

      await stripeApiRequest(\`customers/\${encodeURIComponent(customerId)}\`, stripeSecretKey, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: customerParams,
      });
    } catch (error) {
      console.warn("Final settlement customer default payment method update skipped", error);
    }
  }

  if (paymentMethodId && subscriptionId) {
    try {
      const subscriptionParams = new URLSearchParams();
      subscriptionParams.append("default_payment_method", paymentMethodId);

      await stripeApiRequest(
        \`subscriptions/\${encodeURIComponent(subscriptionId)}\`,
        stripeSecretKey,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: subscriptionParams,
        },
      );
    } catch (error) {
      console.warn("Final settlement subscription default payment method update skipped", error);
    }
  }
`;

if (source.includes(newBlock)) {
  console.log("Final settlement hotfix v4 is already applied.");
  process.exit(0);
}

if (!source.includes(oldBlock)) {
  console.error("Could not find the exact old final settlement payment-method block to replace.");
  console.error("Open supabase/functions/stripe-webhook/index.ts and search for handleFinalSettlementCheckout; the customer/subscription default-payment-method update block may have changed.");
  process.exit(1);
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(webhookPath, source);
console.log("Applied final settlement hotfix v4 to stripe-webhook.");
