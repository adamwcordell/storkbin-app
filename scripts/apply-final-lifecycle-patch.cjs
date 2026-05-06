const fs = require("fs");
const path = require("path");

const root = process.cwd();
const webhookPath = path.join(root, "supabase", "functions", "stripe-webhook", "index.ts");
const appPath = path.join(root, "src", "App.jsx");
const accountPath = path.join(root, "src", "pages", "AccountPage.jsx");

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing file: ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, "utf8");
}

function write(filePath, source) {
  fs.writeFileSync(filePath, source);
  console.log(`Patched ${path.relative(root, filePath)}`);
}

function replaceFunction(source, functionName, replacement, nextFunctionName) {
  const start = source.indexOf(`const ${functionName} = async`);
  if (start === -1) return null;

  const next = source.indexOf(`const ${nextFunctionName} =`, start + 1);
  if (next === -1) return null;

  return source.slice(0, start) + replacement + "\n\n" + source.slice(next);
}

function insertBefore(source, anchor, block, label) {
  if (source.includes(label)) return source;
  const idx = source.indexOf(anchor);
  if (idx === -1) {
    console.error(`Could not find anchor: ${anchor}`);
    process.exit(1);
  }
  return source.slice(0, idx) + block + source.slice(idx);
}

// --------------------------
// Patch stripe-webhook
// --------------------------
let webhook = read(webhookPath);

const finalSettlementHelper = `const handleFinalSettlementCheckout = async ({
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
  const subscriptionId = metadata.stripe_subscription_id || metadata.subscription_id;
  const shipmentIdFromMetadata = metadata.shipment_id;
  const openInvoiceIds = String(metadata.open_invoice_ids || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!boxId || !subscriptionId) {
    return { ignored: true, reason: "missing final settlement metadata", boxId, subscriptionId };
  }

  const paidInvoices: string[] = [];
  for (const invoiceId of openInvoiceIds) {
    try {
      const invoice = await stripeApiRequest(
        \\`invoices/\\${encodeURIComponent(invoiceId)}\\`,
        stripeSecretKey,
      );

      if (invoice?.status !== "paid" && Number(invoice?.amount_remaining || 0) > 0) {
        const invoiceParams = new URLSearchParams();
        invoiceParams.append("paid_out_of_band", "true");

        await stripeApiRequest(\\`invoices/\\${encodeURIComponent(invoiceId)}/pay\\`, stripeSecretKey, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: invoiceParams,
        });
      }

      paidInvoices.push(invoiceId);
    } catch (error) {
      console.warn(\\`Could not mark invoice \\${invoiceId} paid during final settlement\\`, error);
    }
  }

  const nowIso = new Date().toISOString();

  let shipmentId = shipmentIdFromMetadata || null;

  if (!shipmentId) {
    const { data: existingShipment, error: shipmentLookupError } = await supabase
      .from("shipments")
      .select("id")
      .eq("box_id", boxId)
      .eq("shipment_direction", "to_customer")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (shipmentLookupError) {
      throw new Error(\\`Could not look up final shipment: \\${shipmentLookupError.message}\\`);
    }

    shipmentId = existingShipment?.id || null;
  }

  if (shipmentId) {
    const { error: shipmentUpdateError } = await supabase
      .from("shipments")
      .update({
        shipping_status: "paid",
        charge_status: "paid",
        charge_attempted_at: nowIso,
        charge_failure_reason: null,
        label_status: "needed",
      })
      .eq("id", shipmentId);

    if (shipmentUpdateError) {
      throw new Error(\\`Could not mark final shipment paid: \\${shipmentUpdateError.message}\\`);
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
    throw new Error(\\`Could not mark final settlement paid: \\${boxUpdateError.message}\\`);
  }

  return {
    updated: true,
    boxId,
    subscriptionId,
    shipmentId,
    paidInvoices,
  };
};`;

if (webhook.includes("const handleFinalSettlementCheckout = async")) {
  const replaced = replaceFunction(webhook, "handleFinalSettlementCheckout", finalSettlementHelper, "handlePaymentMethodUpdateCheckout");
  if (!replaced) {
    console.error("Found handleFinalSettlementCheckout but could not replace it.");
    process.exit(1);
  }
  webhook = replaced;
} else {
  webhook = insertBefore(
    webhook,
    "const handlePaymentMethodUpdateCheckout = async",
    finalSettlementHelper + "\n\n",
    "const handleFinalSettlementCheckout = async",
  );
}

const finalSettlementEventHandler = `  if (
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

if (!webhook.includes('flow: "final_settlement"')) {
  webhook = insertBefore(
    webhook,
    '  if (\n    event.type === "checkout.session.completed" &&\n    event.data?.object?.metadata?.flow === "payment_method_update"',
    finalSettlementEventHandler,
    'flow: "final_settlement"',
  );
}

const improvedSync = `const createFinalShipmentForCanceledStoredBox = async ({
  supabase,
  box,
}: {
  supabase: ReturnType<typeof createClient>;
  box: Record<string, any>;
}) => {
  const { data: existingShipment, error: existingShipmentError } = await supabase
    .from("shipments")
    .select("id,charge_status,shipping_status")
    .eq("box_id", box.id)
    .eq("shipment_direction", "to_customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingShipmentError) {
    throw new Error(\\`Could not look up final shipment: \\${existingShipmentError.message}\\`);
  }

  if (existingShipment?.id) {
    return { shipmentId: existingShipment.id, created: false };
  }

  const shippingAddress = box.cancellation_shipping_address || box.requested_shipping_address || null;

  const { data: createdShipment, error: shipmentError } = await supabase
    .from("shipments")
    .insert([
      {
        box_id: box.id,
        user_id: box.user_id,
        shipping_address: shippingAddress,
        shipping_estimate: DEFAULT_SHIPPING_COST,
        shipping_cost: DEFAULT_SHIPPING_COST,
        shipment_direction: "to_customer",
        shipping_status: "pending_payment",
        charge_status: "pending_payment",
        label_status: "needed",
      },
    ])
    .select("id")
    .single();

  if (shipmentError) {
    throw new Error(\\`Could not create final shipment: \\${shipmentError.message}\\`);
  }

  await supabase
    .from("boxes")
    .update({
      fulfillment_status: "shipment_payment_failed",
      cancellation_shipping_charge_status: "failed",
      cancellation_shipping_charge_failed_at: new Date().toISOString(),
      lifecycle_attention_reason: "final_shipment_payment_required",
    })
    .eq("id", box.id);

  return { shipmentId: createdShipment.id, created: true };
};

const syncStripeSubscriptionCancellation = async ({
  supabase,
  subscription,
}) => {
  const subscriptionId = subscription?.id;

  if (!subscriptionId) {
    return { ignored: true, reason: "missing subscription id" };
  }

  const stripeStatus = subscription?.status || null;
  const terminatedAt = subscription?.ended_at
    ? new Date(subscription.ended_at * 1000).toISOString()
    : subscription?.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : new Date().toISOString();

  const cancelAt = subscription?.cancel_at
    ? new Date(subscription.cancel_at * 1000).toISOString()
    : null;

  const shouldTerminate =
    stripeStatus === "canceled" ||
    stripeStatus === "unpaid" ||
    Boolean(subscription?.ended_at);

  if (!shouldTerminate && cancelAt) {
    const { error } = await supabase
      .from("boxes")
      .update({
        subscription_status: stripeStatus || "active",
        subscription_ends_at: cancelAt,
      })
      .eq("stripe_subscription_id", subscriptionId);

    if (error) {
      throw new Error(\\`Could not sync Stripe scheduled cancellation: \\${error.message}\\`);
    }

    return { updated: true, subscriptionId, scheduledCancelAt: cancelAt, stripeStatus };
  }

  if (!shouldTerminate) {
    const { error } = await supabase
      .from("boxes")
      .update({ subscription_status: stripeStatus || "active" })
      .eq("stripe_subscription_id", subscriptionId);

    if (error) {
      throw new Error(\\`Could not sync Stripe subscription status: \\${error.message}\\`);
    }

    return { ignored: true, reason: "subscription still active", subscriptionId, stripeStatus };
  }

  const { data: boxes, error: boxesError } = await supabase
    .from("boxes")
    .select("id,user_id,status,cancel_status,cancellation_shipping_address,requested_shipping_address,fulfillment_status")
    .eq("stripe_subscription_id", subscriptionId);

  if (boxesError) {
    throw new Error(\\`Could not load boxes for canceled subscription: \\${boxesError.message}\\`);
  }

  const finalShipments: Array<Record<string, unknown>> = [];

  for (const box of boxes || []) {
    const isStoredCancellation = box.status === "stored" && box.cancel_status === "approved";

    if (isStoredCancellation) {
      finalShipments.push(await createFinalShipmentForCanceledStoredBox({ supabase, box }));
    }

    const { error } = await supabase
      .from("boxes")
      .update({
        subscription_status: "terminated",
        subscription_lifecycle_status: "terminated",
        subscription_terminated_at: terminatedAt,
        lifecycle_status: isStoredCancellation ? "active" : "terminated",
        lifecycle_attention_reason: isStoredCancellation
          ? "final_shipment_payment_required"
          : null,
        lifecycle_deadline_at: null,
      })
      .eq("id", box.id);

    if (error) {
      throw new Error(\\`Could not sync Stripe subscription cancellation: \\${error.message}\\`);
    }
  }

  return { updated: true, subscriptionId, stripeStatus, terminatedAt, finalShipments };
};`;

if (webhook.includes("const syncStripeSubscriptionCancellation = async")) {
  const start = webhook.indexOf("const syncStripeSubscriptionCancellation = async");
  const next = webhook.indexOf("const stripeApiRequest = async", start);
  if (next === -1) {
    console.error("Could not find stripeApiRequest anchor after syncStripeSubscriptionCancellation.");
    process.exit(1);
  }
  webhook = webhook.slice(0, start) + improvedSync + "\n\n\n" + webhook.slice(next);
} else {
  webhook = insertBefore(webhook, "const stripeApiRequest = async", improvedSync + "\n\n\n", "const syncStripeSubscriptionCancellation = async");
}

write(webhookPath, webhook);

// --------------------------
// Patch App.jsx
// --------------------------
let app = read(appPath);

if (!app.includes("FINAL_SETTLEMENT_FUNCTION_URL")) {
  app = app.replace(
    /const PAYMENT_RECOVERY_FUNCTION_URL = .*?;\n/,
    (match) => `${match}  const FINAL_SETTLEMENT_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/create-final-settlement-session";\n`,
  );
}

const finalSettlementAppFunction = `  const startFinalSettlementPayment = async (boxId) => {
    const box = boxes.find((currentBox) => currentBox.id === boxId);

    if (!box) {
      alert("Box not found.");
      return;
    }

    const response = await fetch(FINAL_SETTLEMENT_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        boxId: box.id,
        successUrl: `${window.location.origin}/account?payment=final-settlement-success`,
        cancelUrl: `${window.location.origin}/account?payment=final-settlement-cancel`,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    const checkoutUrl = payload.url || payload.checkoutUrl;

    if (!response.ok || !checkoutUrl) {
      alert(payload.error || "Could not start final settlement payment.");
      return;
    }

    window.location.href = checkoutUrl;
  };

`;

if (!app.includes("const startFinalSettlementPayment = async")) {
  app = app.replace("  const startSubscriptionPaymentRecovery = async (boxId) => {", finalSettlementAppFunction + "  const startSubscriptionPaymentRecovery = async (boxId) => {");
}

if (!app.includes("startFinalSettlementPayment,")) {
  app = app.replace("    payShipping,", "    payShipping,\n    startFinalSettlementPayment,");
}

write(appPath, app);

// --------------------------
// Patch AccountPage.jsx
// --------------------------
let account = read(accountPath);

const makePaymentReplacement = `  const makePayment = () => {
    const finalSettlementItem = missedPaymentItems.find(
      (item) => item.type === "final_settlement"
    );

    if (finalSettlementItem?.box?.id) {
      if (!appData.startFinalSettlementPayment) {
        alert("Final settlement payment is not wired yet. Please refresh and try again.");
        return;
      }

      appData.startFinalSettlementPayment(finalSettlementItem.box.id);
      return;
    }

    const failedSubscriptionItem = missedPaymentItems.find(
      (item) =>
        item.box?.subscription_payment_status === "failed" &&
        item.box?.stripe_subscription_id
    );

    if (failedSubscriptionItem?.box?.id) {
      if (!appData.startSubscriptionPaymentRecovery) {
        alert("Stripe payment recovery is not wired yet. Please refresh and try again.");
        return;
      }

      appData.startSubscriptionPaymentRecovery(failedSubscriptionItem.box.id);
      return;
    }

    const failedShipmentItem = missedPaymentItems.find(
      (item) =>
        item.box?.cancellation_shipping_charge_status === "failed" ||
        item.box?.fulfillment_status === "shipment_payment_failed" ||
        hasFailedShipment(item.box, shipments)
    );

    if (failedShipmentItem?.box?.id && appData.payShipping) {
      appData.payShipping(failedShipmentItem.box.id);
      return;
    }

    if (appData.payAllFailedPayments) {
      appData.payAllFailedPayments();
    }
  };

`;

account = account.replace(/  const makePayment = \(\) => \{[\s\S]*?\n  \};\n\n  const updateAddressField/, makePaymentReplacement + "  const updateAddressField");

const missedPaymentReplacement = `function getMissedPaymentItems(boxes, shipments, rates) {
  return boxes
    .filter((box) => {
      if (box.lifecycle_status === "auction" || box.lifecycle_status === "removed_from_system") {
        return false;
      }

      const finalSettlementRequired = isFinalSettlementRequired(box, shipments);

      if (box.subscription_lifecycle_status === "terminated" && !finalSettlementRequired) {
        return false;
      }

      return (
        finalSettlementRequired ||
        box.subscription_payment_status === "failed" ||
        box.cancellation_shipping_charge_status === "failed" ||
        box.fulfillment_status === "shipment_payment_failed" ||
        hasFailedShipment(box, shipments)
      );
    })
    .map((box) => {
      const finalSettlementRequired = isFinalSettlementRequired(box, shipments);

      if (finalSettlementRequired) {
        const owesSubscription = box.subscription_payment_status === "failed";
        const amount = (owesSubscription ? rates.monthlyRate : 0) + rates.finalShippingRate;

        return {
          key: `${box.id}-final-settlement`,
          type: "final_settlement",
          box,
          title: `Final payment due · Bin ${box.box_number || box.id}`,
          detail: owesSubscription
            ? "Pay overdue storage plus final return shipping before we can ship your bin."
            : "Pay final return shipping before we can ship your bin.",
          amount,
        };
      }

      if (box.cancellation_shipping_charge_status === "failed") {
        return {
          key: `${box.id}-final-shipping`,
          type: "shipment_payment",
          box,
          title: `Final shipping payment failed · Bin ${box.box_number || box.id}`,
          detail: buildCountdownDetail(box, "auction"),
          amount: rates.finalShippingRate,
        };
      }

      if (box.subscription_payment_status === "failed" && box.status === "at_customer") {
        return {
          key: `${box.id}-customer-subscription`,
          type: "subscription_payment",
          box,
          title: `Monthly payment failed · Bin ${box.box_number || box.id}`,
          detail: buildCountdownDetail(box, "subscription termination"),
          amount: rates.monthlyRate,
        };
      }

      if (box.subscription_payment_status === "failed") {
        return {
          key: `${box.id}-stored-subscription`,
          type: "subscription_payment",
          box,
          title: `Monthly payment failed · Bin ${box.box_number || box.id}`,
          detail: buildCountdownDetail(box, "auction"),
          amount: rates.monthlyRate,
        };
      }

      return {
        key: `${box.id}-shipment`,
        type: "shipment_payment",
        box,
        title: `Shipping payment failed · Bin ${box.box_number || box.id}`,
        detail: buildCountdownDetail(box, "auction"),
        amount: rates.finalShippingRate,
      };
    });
}

function isFinalSettlementRequired(box, shipments) {
  if (box.cancel_status !== "approved" || box.status !== "stored") {
    return false;
  }

  return (
    box.cancellation_shipping_charge_status === "pending_auto_charge" ||
    box.cancellation_shipping_charge_status === "pending_payment" ||
    box.cancellation_shipping_charge_status === "failed" ||
    box.fulfillment_status === "shipment_payment_failed" ||
    hasPendingFinalShipment(box, shipments)
  );
}

function hasPendingFinalShipment(box, shipments) {
  return shipments.some((shipment) => {
    const matchesBox =
      shipment.box_id === box.id ||
      shipment.latest_box_id === box.id ||
      shipment.box_ids?.includes?.(box.id) ||
      shipment.shipment_boxes?.some?.((shipmentBox) => shipmentBox.box_id === box.id);

    if (!matchesBox || shipment.shipment_direction !== "to_customer") {
      return false;
    }

    return shipment.charge_status !== "paid" || shipment.shipping_status !== "paid";
  });
}

`;

const mpStart = account.indexOf("function getMissedPaymentItems(");
const mpEnd = account.indexOf("function getReactivationItems(", mpStart);
if (mpStart === -1 || mpEnd === -1) {
  console.error("Could not find getMissedPaymentItems block.");
  process.exit(1);
}
account = account.slice(0, mpStart) + missedPaymentReplacement + account.slice(mpEnd);

write(accountPath, account);

console.log("Final lifecycle patch complete.");
