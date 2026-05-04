import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getStorkBinPlan } from "../_shared/storkbinPlans.ts";

const DEFAULT_SHIPPING_COST = 18;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const stripeRequest = async (
  path: string,
  method: "GET" | "POST",
  stripeSecretKey: string,
  body?: URLSearchParams,
) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body : undefined,
  });

  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message || "Stripe request failed";
    throw new Error(message);
  }

  return payload;
};

const createPerBinSubscription = async ({
  stripeSecretKey,
  stripeCustomerId,
  priceId,
  billingCycleAnchorUnix,
  defaultPaymentMethodId,
  metadata,
}: {
  stripeSecretKey: string;
  stripeCustomerId: string;
  priceId: string;
  billingCycleAnchorUnix: number;
  defaultPaymentMethodId?: string;
  metadata: Record<string, string | number | boolean | null | undefined>;
}) => {
  const params = new URLSearchParams();
  params.append("customer", stripeCustomerId);
  params.append("items[0][price]", priceId);
  params.append("billing_cycle_anchor", String(billingCycleAnchorUnix));
  params.append("proration_behavior", "none");
  params.append("collection_method", "charge_automatically");

  if (defaultPaymentMethodId) {
    params.append("default_payment_method", defaultPaymentMethodId);
  }

  Object.entries(metadata).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(`metadata[${key}]`, String(value));
    }
  });

  return stripeRequest("subscriptions", "POST", stripeSecretKey, params);
};

const encoder = new TextEncoder();

const hexToBytes = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const constantTimeEqual = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
};

const verifyStripeSignature = async (
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
) => {
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split("=");
    if (!key || !value) return acc;
    acc[key] = [...(acc[key] || []), value];
    return acc;
  }, {});

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];

  if (!timestamp || signatures.length === 0) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const expectedSignature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload)),
  );

  return signatures.some((signature) =>
    constantTimeEqual(expectedSignature, hexToBytes(signature)),
  );
};

const buildShippingAddressFromMetadata = (metadata: Record<string, string | undefined>) => ({
  full_name: metadata.shipping_full_name || "",
  email: metadata.shipping_email || "",
  address_line1: metadata.shipping_address_line1 || "",
  address_line2: metadata.shipping_address_line2 || "",
  city: metadata.shipping_city || "",
  state: metadata.shipping_state || "",
  zip: metadata.shipping_zip || "",
});

const getMissingShippingAddressFields = (shippingAddress: Record<string, string>) =>
  Object.entries(shippingAddress)
    .filter(([key, value]) => key !== "address_line2" && !value)
    .map(([key]) => key);


const getStripeId = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "id" in value && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return "";
};

const getInvoiceId = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "id" in value && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return "";
};

const getSubscriptionIdFromInvoiceLike = (invoiceLike: Record<string, unknown>) => {
  const directSubscription = getStripeId(invoiceLike.subscription);
  if (directSubscription) return directSubscription;

  const invoice = invoiceLike.invoice as Record<string, unknown> | string | undefined;
  if (invoice && typeof invoice === "object") {
    const invoiceSubscription = getStripeId(invoice.subscription);
    if (invoiceSubscription) return invoiceSubscription;
  }

  const parent = invoiceLike.parent as Record<string, unknown> | undefined;
  const subscriptionDetails = parent?.subscription_details as Record<string, unknown> | undefined;
  const parentSubscription = getStripeId(subscriptionDetails?.subscription);
  if (parentSubscription) return parentSubscription;

  return "";
};

const resolveInvoiceForEvent = async ({
  stripeSecretKey,
  eventObject,
}: {
  stripeSecretKey: string;
  eventObject: Record<string, unknown>;
}) => {
  const directSubscriptionId = getSubscriptionIdFromInvoiceLike(eventObject);

  if (directSubscriptionId) {
    return { invoice: eventObject, subscriptionId: directSubscriptionId };
  }

  const invoiceId = getInvoiceId(eventObject.invoice);

  if (!invoiceId) {
    return { invoice: eventObject, subscriptionId: "" };
  }

  const invoice = await stripeRequest(`invoices/${invoiceId}`, "GET", stripeSecretKey);
  const subscriptionId = getSubscriptionIdFromInvoiceLike(invoice);

  return { invoice, subscriptionId };
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getSubscriptionFailureDeadline = (box: { status?: string | null }) => {
  const now = new Date();

  if (box.status === "at_customer") {
    return addDays(now, 30);
  }

  return addDays(now, 60);
};

const markSubscriptionPaymentFailed = async ({
  supabase,
  stripeSecretKey,
  invoiceLike,
}: {
  supabase: ReturnType<typeof createClient>;
  stripeSecretKey: string;
  invoiceLike: Record<string, unknown>;
}) => {
  const { invoice, subscriptionId } = await resolveInvoiceForEvent({
    stripeSecretKey,
    eventObject: invoiceLike,
  });

  if (!subscriptionId) {
    return { ignored: true, reason: "invoice missing subscription" };
  }

  const { data: box, error: boxError } = await supabase
    .from("boxes")
    .select("id,status")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (boxError) {
    throw new Error(`Could not look up box by Stripe subscription: ${boxError.message}`);
  }

  if (!box) {
    return { ignored: true, reason: "no box matched subscription", subscriptionId };
  }

  const failedAt = new Date();
  const deadline = getSubscriptionFailureDeadline(box);
  const failureReason =
    typeof invoice.last_payment_error === "object" &&
    invoice.last_payment_error &&
    "message" in invoice.last_payment_error
      ? String((invoice.last_payment_error as { message?: unknown }).message || "Stripe subscription payment failed")
      : "Stripe subscription payment failed";

  const { error: updateError } = await supabase
    .from("boxes")
    .update({
      subscription_payment_status: "failed",
      subscription_payment_failed_at: failedAt.toISOString(),
      last_payment_failed_at: failedAt.toISOString(),
      subscription_payment_deadline_at: deadline.toISOString(),
      lifecycle_deadline_at: deadline.toISOString(),
      lifecycle_attention_reason:
        box.status === "at_customer"
          ? "customer_held_subscription_payment_failed"
          : "stored_subscription_payment_failed",
      subscription_payment_failure_reason: failureReason,
    })
    .eq("id", box.id);

  if (updateError) {
    throw new Error(`Could not mark subscription payment failed: ${updateError.message}`);
  }

  return { updated: true, boxId: box.id, subscriptionId };
};

const markSubscriptionPaymentPaid = async ({
  supabase,
  stripeSecretKey,
  invoiceLike,
}: {
  supabase: ReturnType<typeof createClient>;
  stripeSecretKey: string;
  invoiceLike: Record<string, unknown>;
}) => {
  const { invoice, subscriptionId } = await resolveInvoiceForEvent({
    stripeSecretKey,
    eventObject: invoiceLike,
  });

  if (!subscriptionId) {
    return { ignored: true, reason: "invoice missing subscription" };
  }

  const paidAt = new Date();
  const updatePayload: Record<string, string | null> = {
    subscription_payment_status: "paid",
    subscription_payment_failed_at: null,
    last_payment_failed_at: null,
    subscription_payment_deadline_at: null,
    lifecycle_deadline_at: null,
    lifecycle_attention_reason: null,
    subscription_payment_failure_reason: null,
  };

  if (typeof invoice.period_end === "number") {
    updatePayload.renews_at = new Date(invoice.period_end * 1000).toISOString();
  }

  const { error: updateError } = await supabase
    .from("boxes")
    .update(updatePayload)
    .eq("stripe_subscription_id", subscriptionId);

  if (updateError) {
    throw new Error(`Could not mark subscription payment paid: ${updateError.message}`);
  }

  return { updated: true, subscriptionId, paidAt: paidAt.toISOString() };
};

const getNextBoxNumbers = async (supabase: ReturnType<typeof createClient>, count: number) => {
  const { data, error } = await supabase
    .from("boxes")
    .select("box_number")
    .not("box_number", "is", null);

  if (error) throw new Error(`Could not read existing box numbers: ${error.message}`);

  const usedNumbers = new Set(
    (data || [])
      .map((row: { box_number: string | null }) => row.box_number)
      .filter(Boolean) as string[],
  );

  const numbers: string[] = [];
  let candidate = 1;

  while (numbers.length < count) {
    const nextNumber = String(candidate).padStart(3, "0");

    if (!usedNumbers.has(nextNumber)) {
      numbers.push(nextNumber);
      usedNumbers.add(nextNumber);
    }

    candidate += 1;
  }

  return numbers;
};

const chunkArray = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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
      throw new Error(`Could not sync Stripe scheduled cancellation: ${error.message}`);
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
    throw new Error(`Could not sync Stripe subscription cancellation: ${error.message}`);
  }

  return { updated: true, subscriptionId, stripeStatus, canceledAt };
};


const stripeApiRequest = async (
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
      `payment_intents/${encodeURIComponent(paymentIntentId)}`,
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

    await stripeApiRequest(`customers/${encodeURIComponent(customerId)}`, stripeSecretKey, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: customerParams,
    });
  }

  if (paymentMethodId) {
    const subscriptionParams = new URLSearchParams();
    subscriptionParams.append("default_payment_method", paymentMethodId);

    await stripeApiRequest(
      `subscriptions/${encodeURIComponent(subscriptionId)}`,
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
    throw new Error(`Could not clear failed subscription payment state: ${error.message}`);
  }

  return {
    updated: true,
    subscriptionId,
    invoiceId,
    paymentIntentId,
    paymentMethodId,
  };
};

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const stripeBinMonthlyPriceId = Deno.env.get("STRIPE_BIN_MONTHLY_PRICE_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

  if (!webhookSecret || !stripeSecretKey || !stripeBinMonthlyPriceId || !supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse({ error: "Missing required Edge Function secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_BIN_MONTHLY_PRICE_ID, SERVICE_ROLE_KEY, or SUPABASE_URL" }, 500);
  }

  const rawBody = await req.text();
  const isValidSignature = await verifyStripeSignature(
    rawBody,
    req.headers.get("stripe-signature"),
    webhookSecret,
  );

  if (!isValidSignature) {
    return jsonResponse({ error: "Invalid Stripe signature" }, 400);
  }

  const event = JSON.parse(rawBody);

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  
  
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

if (event.type === "invoice.payment_failed" || event.type === "invoice_payment.failed") {
    const result = await markSubscriptionPaymentFailed({
      supabase,
      stripeSecretKey,
      invoiceLike: event.data?.object || {},
    });

    return jsonResponse({ received: true, eventType: event.type, result });
  }

  if (
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_succeeded" ||
    event.type === "invoice_payment.paid"
  ) {
    const result = await markSubscriptionPaymentPaid({
      supabase,
      stripeSecretKey,
      invoiceLike: event.data?.object || {},
    });

    return jsonResponse({ received: true, eventType: event.type, result });
  }

  if (event.type !== "checkout.session.completed") {
    return jsonResponse({ received: true, ignored: true, eventType: event.type });
  }

  const session = event.data?.object;
  const metadata = session?.metadata || {};

  if (metadata.flow !== "initial_purchase") {
    return jsonResponse({ received: true, ignored: true, eventType: event.type });
  }

  const userId = metadata.supabase_user_id;
  const planId = metadata.plan_id;
  const subscriptionGroupId = metadata.subscription_group_id;
  const cartSubscriptionGroupId = metadata.cart_subscription_group_id || subscriptionGroupId;
  const stripeCustomerId = session?.customer;

  if (!userId || !planId || !subscriptionGroupId || !stripeCustomerId) {
    return jsonResponse({ error: "Missing checkout metadata" }, 400);
  }

  const plan = getStorkBinPlan(planId);

  if (!plan) {
    return jsonResponse({ error: `Unknown planId: ${planId}` }, 400);
  }

  const shippingAddress = buildShippingAddressFromMetadata(metadata);
  const missingShippingFields = getMissingShippingAddressFields(shippingAddress);

  if (missingShippingFields.length > 0) {
    return jsonResponse(
      { error: "Missing required checkout shipping metadata", missingShippingFields },
      400,
    );
  }

  let defaultPaymentMethodId = "";

  if (session?.payment_intent) {
    const paymentIntent = await stripeRequest(
      `payment_intents/${session.payment_intent}`,
      "GET",
      stripeSecretKey,
    );

    defaultPaymentMethodId = paymentIntent?.payment_method || "";

    if (defaultPaymentMethodId) {
      const customerUpdateParams = new URLSearchParams();
      customerUpdateParams.append(
        "invoice_settings[default_payment_method]",
        defaultPaymentMethodId,
      );

      await stripeRequest(
        `customers/${stripeCustomerId}`,
        "POST",
        stripeSecretKey,
        customerUpdateParams,
      );
    }
  }

  const { data: existingBoxes, error: existingError } = await supabase
    .from("boxes")
    .select("id,checkout_status,cart_type,stripe_subscription_id")
    .eq("subscription_group_id", subscriptionGroupId);

  if (existingError) {
    return jsonResponse({ error: `Idempotency check failed: ${existingError.message}` }, 500);
  }

  const alreadyProcessed = (existingBoxes || []).some(
    (box: { checkout_status?: string | null; stripe_subscription_id?: string | null }) =>
      box.checkout_status === "paid" || Boolean(box.stripe_subscription_id),
  );

  if (alreadyProcessed) {
    return jsonResponse({ received: true, alreadyProcessed: true });
  }

  if (cartSubscriptionGroupId) {
    const { error: provisionalDeleteError } = await supabase
      .from("boxes")
      .delete()
      .eq("subscription_group_id", cartSubscriptionGroupId)
      .eq("user_id", userId)
      .eq("checkout_status", "in_cart")
      .eq("cart_type", "initial_purchase");

    if (provisionalDeleteError) {
      return jsonResponse({ error: `Could not remove provisional cart boxes: ${provisionalDeleteError.message}` }, 500);
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name,stripe_customer_id")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    return jsonResponse({ error: "Profile not found for checkout user" }, 404);
  }

  if (profile.stripe_customer_id !== stripeCustomerId) {
    const { error: profileUpdateError } = await supabase
      .from("profiles")
      .update({ stripe_customer_id: stripeCustomerId })
      .eq("id", userId);

    if (profileUpdateError) {
      return jsonResponse({ error: `Could not update Stripe customer ID: ${profileUpdateError.message}` }, 500);
    }
  }

  const now = new Date();
  const renewsAt = new Date(now);
  renewsAt.setMonth(renewsAt.getMonth() + 1);

  const boxNumbers = await getNextBoxNumbers(supabase, plan.binCount);

  const billingCycleAnchorUnix = Math.floor(renewsAt.getTime() / 1000);
  const createdSubscriptions = [];

  for (let index = 0; index < boxNumbers.length; index += 1) {
    const boxId = `${subscriptionGroupId}-${index + 1}`;
    const subscription = await createPerBinSubscription({
      stripeSecretKey,
      stripeCustomerId,
      priceId: stripeBinMonthlyPriceId,
      billingCycleAnchorUnix,
      defaultPaymentMethodId,
      metadata: {
        flow: "monthly_storage_subscription",
        supabase_user_id: userId,
        subscription_group_id: subscriptionGroupId,
        box_id: boxId,
        box_index: index + 1,
        plan_id: plan.id,
        plan_name: plan.name,
        subscription_model: "one_subscription_per_bin",
        first_month_paid_in_checkout: true,
      },
    });

    createdSubscriptions.push(subscription);
  }

  const boxRows = boxNumbers.map((boxNumber, index) => ({
    id: `${subscriptionGroupId}-${index + 1}`,
    box_number: boxNumber,
    user_id: userId,
    status: "stored",
    fulfillment_status: "paid_waiting_to_ship_bin",
    checkout_status: "paid",
    cart_type: null,
    lifecycle_status: "active",
    subscription_lifecycle_status: "active",
    subscription_payment_status: "paid",
    subscription_group_id: subscriptionGroupId,
    stripe_subscription_id: createdSubscriptions[index]?.id || null,
    subscription_plan_id: plan.id,
    subscription_plan_name: plan.name,
    plan_bin_count: plan.binCount,
    plan_setup_fee: plan.setupFeeCents / 100,
    plan_monthly_rate: plan.monthlyRateCents / 100,
    minimum_months: plan.minimumMonths,
    return_shipping_discount_percent: plan.returnShippingDiscountPercent,
    plan_initial_stack_size: plan.initialShipmentStackSize,
    requested_shipping_address: shippingAddress,
    requested_shipping_address_source: metadata.shipping_source || "customer_selected_checkout",
    price: (plan.setupFeeCents + plan.monthlyRateCents) / 100,
    subscription_started_at: now.toISOString(),
    renews_at: renewsAt.toISOString(),
  }));

  const { data: insertedBoxes, error: boxesError } = await supabase
    .from("boxes")
    .insert(boxRows)
    .select("*");

  if (boxesError) {
    return jsonResponse({ error: `Could not create boxes: ${boxesError.message}` }, 500);
  }

  const starterShipmentStacks = chunkArray(
    insertedBoxes || [],
    plan.initialShipmentStackSize || 3,
  );

  for (const shipmentStack of starterShipmentStacks) {
    const firstBox = shipmentStack[0];

    const { data: createdShipment, error: shipmentError } = await supabase
      .from("shipments")
      .insert([
        {
          box_id: firstBox.id,
          user_id: userId,
          shipping_address: shippingAddress,
          shipping_estimate: DEFAULT_SHIPPING_COST,
          shipping_cost: DEFAULT_SHIPPING_COST,
          shipment_direction: "to_customer",
          shipping_status: "paid",
          charge_status: "paid",
          charge_attempted_at: now.toISOString(),
          charge_failure_reason: null,
          label_status: "needed",
        },
      ])
      .select("*")
      .single();

    if (shipmentError) {
      return jsonResponse({ error: `Could not create starter shipment: ${shipmentError.message}` }, 500);
    }

    const shipmentBoxRows = shipmentStack.map((box: { id: string }, index: number) => ({
      shipment_id: createdShipment.id,
      box_id: box.id,
      user_id: userId,
      stack_position: index + 1,
    }));

    const { error: shipmentBoxesError } = await supabase
      .from("shipment_boxes")
      .insert(shipmentBoxRows);

    if (shipmentBoxesError) {
      return jsonResponse({ error: `Could not link starter shipment boxes: ${shipmentBoxesError.message}` }, 500);
    }
  }

  return jsonResponse({
    received: true,
    createdBoxes: insertedBoxes?.length || 0,
    createdSubscriptions: createdSubscriptions.length,
    subscriptionGroupId,
  });
});
