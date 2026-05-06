const fs = require("fs");
const path = require("path");

const webhookPath = path.join(process.cwd(), "supabase", "functions", "stripe-webhook", "index.ts");
if (!fs.existsSync(webhookPath)) {
  console.error(`Missing webhook file: ${webhookPath}`);
  process.exit(1);
}

let source = fs.readFileSync(webhookPath, "utf8");

if (!source.includes("const handleFinalSettlementCheckout")) {
  const insertAfter = `const handlePaymentMethodUpdateCheckout = async ({`;
  const idx = source.indexOf(insertAfter);
  if (idx === -1) {
    console.error("Could not find handlePaymentMethodUpdateCheckout anchor.");
    process.exit(1);
  }

  const helper = `
const handleFinalSettlementCheckout = async ({
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
  const boxId = metadata.box_id;
  const subscriptionId = metadata.stripe_subscription_id;
  const openInvoiceIds = String(metadata.open_invoice_ids || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!boxId || !subscriptionId) {
    return { ignored: true, reason: "missing final settlement metadata", boxId, subscriptionId };
  }

  let paymentMethodId = null;

  if (paymentIntentId) {
    const paymentIntent = await stripeApiRequest(
      \`payment_intents/\${encodeURIComponent(paymentIntentId)}\`,
      stripeSecretKey,
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
      },
    );
  }

  const paidInvoices: string[] = [];
  for (const invoiceId of openInvoiceIds) {
    try {
      await stripeApiRequest(\`invoices/\${encodeURIComponent(invoiceId)}/pay\`, stripeSecretKey, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(),
      });
      paidInvoices.push(invoiceId);
    } catch (error) {
      console.warn(\`Could not pay invoice \${invoiceId}; continuing if it was already paid\`, error);
    }
  }

  const nowIso = new Date().toISOString();

  const { data: existingShipment, error: shipmentLookupError } = await supabase
    .from("shipments")
    .select("id")
    .eq("box_id", boxId)
    .eq("shipment_direction", "to_customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (shipmentLookupError) {
    throw new Error(\`Could not look up final shipment: \${shipmentLookupError.message}\`);
  }

  if (existingShipment?.id) {
    const { error: shipmentUpdateError } = await supabase
      .from("shipments")
      .update({
        shipping_status: "paid",
        charge_status: "paid",
        charge_attempted_at: nowIso,
        charge_failure_reason: null,
        label_status: "needed",
      })
      .eq("id", existingShipment.id);

    if (shipmentUpdateError) {
      throw new Error(\`Could not mark final shipment paid: \${shipmentUpdateError.message}\`);
    }
  }

  const { error: boxUpdateError } = await supabase
    .from("boxes")
    .update({
      subscription_payment_status: "paid",
      subscription_payment_failed_at: null,
      last_payment_failed_at: null,
      subscription_payment_deadline_at: null,
      lifecycle_deadline_at: null,
      lifecycle_attention_reason: null,
      subscription_payment_failure_reason: null,
      cancellation_shipping_charge_status: "paid",
      cancellation_shipping_charge_failed_at: null,
      fulfillment_status: "ready_to_ship_to_customer",
    })
    .eq("id", boxId);

  if (boxUpdateError) {
    throw new Error(\`Could not mark final settlement paid: \${boxUpdateError.message}\`);
  }

  return {
    updated: true,
    boxId,
    subscriptionId,
    paidInvoices,
    paymentIntentId,
    paymentMethodId,
    shipmentId: existingShipment?.id || null,
  };
};

`;
  source = source.slice(0, idx) + helper + source.slice(idx);
}

if (!source.includes('flow: "final_settlement"')) {
  const anchor = `  if (
    event.type === "checkout.session.completed" &&
    event.data?.object?.metadata?.flow === "payment_method_update"
  ) {`;
  const idx = source.indexOf(anchor);
  if (idx === -1) {
    console.error("Could not find payment_method_update handler anchor.");
    process.exit(1);
  }

  const handler = `  if (
    event.type === "checkout.session.completed" &&
    event.data?.object?.metadata?.flow === "final_settlement"
  ) {
    const result = await handleFinalSettlementCheckout({
      supabase,
      session: event.data.object || {},
    });

    return jsonResponse({
      received: true,
      eventType: event.type,
      flow: "final_settlement",
      result,
    });
  }

`;
  source = source.slice(0, idx) + handler + source.slice(idx);
}

fs.writeFileSync(webhookPath, source);
console.log("Patched stripe-webhook final settlement handler.");
