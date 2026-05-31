import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { autoPurchaseShippingLabelsForIds } from "../_shared/fedexPurchaseLabel.ts";
import {
  fulfillInitialPurchaseCheckoutSessionCompletedCore,
  parseInitialPurchasePlanGroups,
} from "../_shared/initialPurchaseFulfillment.ts";
import { getStorkBinPlan } from "../_shared/storkbinPlans.ts";
import { createPerBinSubscription, resolveBinStorageStripeProductId, stripeFormRequest } from "../_shared/stripeFormApi.ts";
import {
  notifyBinRequestedEmails,
  sendAuctionWarningForFailedBox,
  sendBookingConfirmationEmail,
} from "../_shared/customerEmails.ts";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

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
  const secret = String(webhookSecret || "").trim();
  if (!secret || !signatureHeader) return false;

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
    encoder.encode(secret),
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

  const invoice = await stripeFormRequest(`invoices/${invoiceId}`, "GET", stripeSecretKey);
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
  return addDays(now, 45);
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
    .select("id,status,user_id,stripe_subscription_id,subscription_payment_failed_at,lifecycle_deadline_at")
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

  let paymentWarningEmail: unknown = null;
  try {
    paymentWarningEmail = await sendAuctionWarningForFailedBox(
      supabase,
      stripeSecretKey,
      {
        ...box,
        subscription_payment_failed_at: failedAt.toISOString(),
        lifecycle_deadline_at: deadline.toISOString(),
      },
      `${box.id}:initial`,
    );
  } catch (emailErr) {
    console.warn("auction payment warning email", emailErr);
  }

  return { updated: true, boxId: box.id, subscriptionId, paymentWarningEmail };
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

  // Important: Stripe may set canceled_at when a cancellation is scheduled/updated,
  // even while the subscription is still active or past_due with a future cancel_at.
  // Do not treat canceled_at alone as terminal. StorkBin should only terminate when
  // Stripe says the subscription is actually canceled/unpaid or has ended.
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
  const invoiceIds = String(metadata.stripe_invoice_ids || invoiceId || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
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

  const paidInvoices: string[] = [];
  const invoicePaymentErrors: string[] = [];

  for (const recoveredInvoiceId of invoiceIds) {
    try {
      const invoice = await stripeApiRequest(
        `invoices/${encodeURIComponent(recoveredInvoiceId)}`,
        stripeSecretKey,
      );

      const amountRemaining = Number(invoice.amount_remaining || invoice.amount_due || 0);
      const invoiceStatus = String(invoice.status || "");

      if (!["paid", "void", "uncollectible"].includes(invoiceStatus) && amountRemaining > 0) {
        const payParams = new URLSearchParams();
        // The recovery Checkout already collected the money. Mark the original
        // overdue invoice as paid out-of-band so Stripe does not double-charge it.
        payParams.append("paid_out_of_band", "true");

        await stripeApiRequest(
          `invoices/${encodeURIComponent(recoveredInvoiceId)}/pay`,
          stripeSecretKey,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: payParams,
          },
        );
      }

      paidInvoices.push(recoveredInvoiceId);
    } catch (error) {
      invoicePaymentErrors.push(
        `${recoveredInvoiceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (invoicePaymentErrors.length > 0) {
    throw new Error(`Recovery payment succeeded, but invoice cleanup failed: ${invoicePaymentErrors.join("; ")}`);
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
    invoiceIds,
    paidInvoices,
    paymentIntentId,
    paymentMethodId,
  };
};


const parseCsvIds = (value: unknown) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const listActiveStripeSubscriptionsForCustomer = async (
  customerId: string,
  stripeSecretKey: string,
) => {
  const payload = await stripeApiRequest(
    `subscriptions?customer=${encodeURIComponent(customerId)}&status=active&limit=100`,
    stripeSecretKey,
    { method: "GET" },
  );
  return (payload.data || []) as Array<Record<string, unknown>>;
};

const findActiveSubForBox = (
  subs: Array<Record<string, unknown>>,
  boxId: string,
) =>
  subs.find((s) => {
    const meta = (s.metadata || {}) as Record<string, string | undefined>;
    return String(meta.box_id || "") === boxId;
  });

const handleSubscriptionReactivationCheckout = async ({
  supabase,
  session,
  stripeSecretKey,
  stripeBinMonthlyPriceId,
  stripeBinStorageProductId,
}: {
  supabase: ReturnType<typeof createClient>;
  session: Record<string, any>;
  stripeSecretKey: string;
  stripeBinMonthlyPriceId: string;
  stripeBinStorageProductId: string;
}) => {
  if (String(session?.payment_status || "") !== "paid") {
    return {
      ignored: true,
      reason: "checkout session is not paid",
      paymentStatus: session?.payment_status,
    };
  }

  const metadata = session.metadata || {};
  const userId = String(metadata.supabase_user_id || "").trim();
  const boxIds = parseCsvIds(metadata.box_ids);
  const expectedTotal = Number(metadata.first_month_total_cents || 0);
  const amountTotal = Number(session.amount_total || 0);

  if (!userId || boxIds.length === 0) {
    throw new Error("Missing subscription reactivation metadata");
  }

  if (!expectedTotal || expectedTotal !== amountTotal) {
    throw new Error("Reactivation payment amount does not match metadata");
  }

  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id || "";

  if (!stripeCustomerId) {
    throw new Error("Missing Stripe customer on checkout session");
  }

  const { data: boxes, error: boxesError } = await supabase
    .from("boxes")
    .select(
      "id, user_id, status, checkout_status, cart_type, subscription_lifecycle_status, lifecycle_status, subscription_group_id, subscription_plan_id, plan_bin_count, plan_monthly_rate, stripe_subscription_id, subscription_plan_name",
    )
    .in("id", boxIds)
    .eq("user_id", userId);

  if (boxesError) {
    throw new Error(boxesError.message);
  }

  if (!boxes || boxes.length !== boxIds.length) {
    throw new Error("One or more reactivation bins were not found");
  }

  const reactivationComplete = (row: Record<string, any>) =>
    row.subscription_lifecycle_status === "active" &&
    row.checkout_status === "paid" &&
    !row.cart_type &&
    Boolean(row.stripe_subscription_id);

  if ((boxes as Array<Record<string, any>>).every(reactivationComplete)) {
    return { alreadyProcessed: true, boxCount: boxIds.length };
  }

  for (const box of boxes as Array<Record<string, any>>) {
    if (box.lifecycle_status === "auction" || box.lifecycle_status === "removed_from_system") {
      throw new Error(`Bin ${box.id} can no longer be reactivated`);
    }
    if (box.status !== "at_customer") {
      throw new Error(`Bin ${box.id} must be with the customer to reactivate`);
    }
    if (!reactivationComplete(box)) {
      const eligible =
        box.subscription_lifecycle_status === "terminated" &&
        box.checkout_status === "in_cart" &&
        box.cart_type === "reactivate_subscription";
      if (!eligible) {
        throw new Error(`Bin ${box.id} is not in the expected state for reactivation`);
      }
    }
  }

  let defaultPaymentMethodId = "";
  const paymentIntentId = getStripeId(session?.payment_intent);

  if (paymentIntentId) {
    const paymentIntent = await stripeApiRequest(
      `payment_intents/${encodeURIComponent(paymentIntentId)}`,
      stripeSecretKey,
      { method: "GET" },
    );

    defaultPaymentMethodId =
      typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : paymentIntent.payment_method?.id || "";

    if (defaultPaymentMethodId) {
      const customerParams = new URLSearchParams();
      customerParams.append("invoice_settings[default_payment_method]", defaultPaymentMethodId);

      await stripeApiRequest(`customers/${encodeURIComponent(stripeCustomerId)}`, stripeSecretKey, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: customerParams,
      });
    }
  }

  const checkoutCreatedAtMs =
    typeof session?.created === "number" ? session.created * 1000 : Date.now();
  const renewsAt = new Date(checkoutCreatedAtMs + 30 * 24 * 60 * 60 * 1000);
  const billingCycleAnchorUnix = Math.floor(renewsAt.getTime() / 1000);
  const nowIso = new Date(checkoutCreatedAtMs).toISOString();
  const sessionId = String(session.id || "");

  const binProductId = await resolveBinStorageStripeProductId(stripeSecretKey, {
    explicitProductId: stripeBinStorageProductId,
    legacyPriceId: stripeBinMonthlyPriceId,
  });

  let cachedSubs = await listActiveStripeSubscriptionsForCustomer(stripeCustomerId, stripeSecretKey);
  const createdSubscriptionIds: string[] = [];

  for (const box of boxes as Array<Record<string, any>>) {
    if (reactivationComplete(box)) {
      continue;
    }

    let subscription = findActiveSubForBox(cachedSubs, box.id);

    if (!subscription) {
      const planName = String(box.subscription_plan_name || "StorkBin storage");
      const planId = String(box.subscription_plan_id || "one_bin");
      const plan = getStorkBinPlan(planId);
      const perBinMonthlyCents = plan
        ? Math.round(plan.monthlyRateCents / Math.max(1, plan.binCount))
        : Math.round(
            (Number(box.plan_monthly_rate || 15) * 100) / Math.max(1, Number(box.plan_bin_count || 1)),
          );
      const groupId = String(box.subscription_group_id || box.id);

      const meta = {
        flow: "monthly_storage_subscription",
        supabase_user_id: userId,
        subscription_group_id: groupId,
        box_id: box.id,
        box_index: 1,
        plan_id: planId,
        plan_name: planName,
        subscription_model: "one_subscription_per_bin",
        first_month_paid_in_checkout: true,
        reactivation_checkout_session_id: sessionId,
      };

      try {
        subscription = await createPerBinSubscription({
          stripeSecretKey,
          stripeCustomerId,
          pricing: {
            kind: "price_data",
            productId: binProductId,
            unitAmountCents: perBinMonthlyCents,
            recurringInterval: "month",
          },
          billingCycleAnchorUnix,
          defaultPaymentMethodId: defaultPaymentMethodId || undefined,
          metadata: meta,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (!defaultPaymentMethodId || !/payment method/i.test(message)) {
          throw error;
        }

        subscription = await createPerBinSubscription({
          stripeSecretKey,
          stripeCustomerId,
          pricing: {
            kind: "price_data",
            productId: binProductId,
            unitAmountCents: perBinMonthlyCents,
            recurringInterval: "month",
          },
          billingCycleAnchorUnix,
          metadata: meta,
        });
      }

      cachedSubs.push(subscription);
    }

    const subId = String(subscription.id || "");
    if (!subId) {
      throw new Error(`Missing subscription id for box ${box.id}`);
    }

    createdSubscriptionIds.push(subId);

    const { error: upErr } = await supabase
      .from("boxes")
      .update({
        checkout_status: "paid",
        cart_type: null,
        price: null,
        subscription_lifecycle_status: "active",
        subscription_payment_status: "paid",
        subscription_status: "active",
        last_payment_failed_at: null,
        lifecycle_deadline_at: null,
        lifecycle_status: "active",
        lifecycle_attention_reason: null,
        subscription_payment_failed_at: null,
        subscription_payment_deadline_at: null,
        subscription_payment_failure_reason: null,
        renews_at: renewsAt.toISOString(),
        subscription_started_at: nowIso,
        subscription_terminated_at: null,
        subscription_ends_at: null,
        cancel_status: null,
        cancel_requested_at: null,
        cancel_reviewed_at: null,
        cancel_review_note: null,
        stripe_subscription_id: subId,
        early_termination_fee_waived: true,
      })
      .eq("id", box.id)
      .eq("user_id", userId);

    if (upErr) {
      throw new Error(upErr.message);
    }
  }

  return {
    updated: true,
    boxCount: boxIds.length,
    stripeSubscriptionsCreated: createdSubscriptionIds.length,
  };
};

const cancelStripeSubscriptionNowForEarlyTermination = async (
  stripeSecretKey: string,
  subscriptionId: string,
) => {
  const res = await fetch(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${stripeSecretKey}` },
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || "Stripe subscription cancel failed";
    const ignorable =
      /no such subscription/i.test(msg) ||
      /already been canceled/i.test(msg) ||
      /already cancelled/i.test(msg);
    if (!ignorable) throw new Error(msg);
  }
  return body;
};

const handleCustomerShippingCheckout = async ({
  supabase,
  session,
}: {
  supabase: ReturnType<typeof createClient>;
  session: Record<string, any>;
}) => {
  const metadata = session?.metadata || {};
  const shipmentIds = parseCsvIds(metadata.shipment_ids);
  const paymentIntentId = getStripeId(session?.payment_intent);
  const earlyTerminationFeeCents = Number(metadata.early_termination_fee_cents || 0);
  const earlyTerminationBoxId = String(metadata.early_termination_box_id || "").trim();

  if (shipmentIds.length === 0) {
    throw new Error("Missing customer shipping shipment_ids metadata");
  }

  const { data: shipments, error: shipmentLookupError } = await supabase
    .from("shipments")
    .select("id,box_id,shipment_direction,charge_status,shipping_cost")
    .in("id", shipmentIds);

  if (shipmentLookupError) {
    throw new Error(`Could not load customer shipping shipments: ${shipmentLookupError.message}`);
  }

  if (!shipments || shipments.length !== shipmentIds.length) {
    throw new Error("One or more customer shipping shipments were not found");
  }

  const shippingSubtotalCents = Math.round(
    (shipments as Array<Record<string, unknown>>).reduce(
      (sum, sh) => sum + Number(sh.shipping_cost || 0),
      0,
    ) * 100,
  );

  for (const shipment of shipments as Array<Record<string, any>>) {
    const fulfillmentStatus =
      shipment.shipment_direction === "to_customer"
        ? "ready_to_ship_to_customer"
        : shipment.shipment_direction === "to_storage"
          ? "awaiting_customer_dropoff"
          : null;

    if (!fulfillmentStatus) {
      throw new Error(`Unsupported customer shipping direction: ${shipment.shipment_direction}`);
    }

    const { error: shipmentUpdateError } = await supabase
      .from("shipments")
      .update({
        shipping_status: "paid",
        charge_status: "paid",
        charge_attempted_at: new Date().toISOString(),
        charge_failure_reason: null,
        label_status: "needed",
        stripe_payment_intent_id: paymentIntentId || null,
        stripe_checkout_session_id: String(session?.id || "").trim() || null,
      })
      .eq("id", shipment.id);

    if (shipmentUpdateError) {
      throw new Error(`Could not mark customer shipping shipment paid: ${shipmentUpdateError.message}`);
    }

    const boxUpdates: Record<string, any> = {
      checkout_status: "paid",
      cart_type: null,
      requested_shipping_address: null,
      requested_shipping_address_source: null,
      fulfillment_status: fulfillmentStatus,
    };

    const { error: boxUpdateError } = await supabase
      .from("boxes")
      .update(boxUpdates)
      .eq("id", shipment.box_id);

    if (boxUpdateError) {
      throw new Error(`Could not update customer shipping box: ${boxUpdateError.message}`);
    }
  }

  if (earlyTerminationFeeCents > 0 && earlyTerminationBoxId) {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      throw new Error("Missing STRIPE_SECRET_KEY for early termination completion");
    }

    const { data: termBox, error: termBoxErr } = await supabase
      .from("boxes")
      .select("id,stripe_subscription_id")
      .eq("id", earlyTerminationBoxId)
      .maybeSingle();

    if (termBoxErr || !termBox) {
      throw new Error(`Early termination box not found: ${earlyTerminationBoxId}`);
    }

    const paidCents = Number(session?.amount_total || 0);
    const minExpectedCents = shippingSubtotalCents + earlyTerminationFeeCents;
    if (!Number.isFinite(paidCents) || paidCents < minExpectedCents - 15) {
      throw new Error("Checkout amount does not cover quoted shipping plus early termination fee");
    }

    if (termBox.stripe_subscription_id) {
      try {
        await cancelStripeSubscriptionNowForEarlyTermination(
          stripeSecretKey,
          String(termBox.stripe_subscription_id),
        );
      } catch (e) {
        throw new Error(
          e instanceof Error
            ? e.message
            : "Could not cancel Stripe subscription after early termination payment",
        );
      }
    }

    const nowIso = new Date().toISOString();
    const { error: termUpdateErr } = await supabase
      .from("boxes")
      .update({
        cancel_requested_at: nowIso,
        cancel_status: "approved",
        subscription_ends_at: nowIso,
        cancel_reviewed_at: nowIso,
        cancel_review_note: "Early contract termination (penalty + outbound shipping paid via checkout)",
        cancellation_shipping_charge_status: null,
      })
      .eq("id", earlyTerminationBoxId);

    if (termUpdateErr) {
      throw new Error(`Could not finalize early termination on box: ${termUpdateErr.message}`);
    }
  }

  return {
    updated: true,
    shipmentIds,
    paymentIntentId,
    earlyTerminationApplied: earlyTerminationFeeCents > 0 && Boolean(earlyTerminationBoxId),
  };
};

const handleCustomerShippingPaymentFailed = async ({
  supabase,
  paymentIntent,
}: {
  supabase: ReturnType<typeof createClient>;
  paymentIntent: Record<string, any>;
}) => {
  const metadata = paymentIntent?.metadata || {};
  const shipmentIds = parseCsvIds(metadata.shipment_ids);

  if (shipmentIds.length === 0) {
    return { ignored: true, reason: "missing shipment_ids metadata" };
  }

  const failureMessage =
    paymentIntent?.last_payment_error?.message ||
    paymentIntent?.last_payment_error?.decline_code ||
    "Shipping payment failed";

  const { error } = await supabase
    .from("shipments")
    .update({
      shipping_status: "pending_payment",
      charge_status: "failed",
      charge_attempted_at: new Date().toISOString(),
      charge_failure_reason: failureMessage,
      label_status: "needed",
      stripe_payment_intent_id: getStripeId(paymentIntent?.id) || null,
    })
    .in("id", shipmentIds);

  if (error) {
    throw new Error(`Could not mark customer shipping payment failed: ${error.message}`);
  }

  return { updated: true, shipmentIds, failureMessage };
};

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
      `payment_intents/${encodeURIComponent(paymentIntentId)}`,
      stripeSecretKey,
    );

    paymentMethodId =
      typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : paymentIntent.payment_method?.id || null;
  }

  // Final settlement is a one-time payment for overdue balance + return shipping.
  // Saving the card for future use is useful, but must never block settlement cleanup.
  if (paymentMethodId && customerId) {
    try {
      const attachParams = new URLSearchParams();
      attachParams.append("customer", customerId);

      await stripeApiRequest(
        `payment_methods/${encodeURIComponent(paymentMethodId)}/attach`,
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

      await stripeApiRequest(`customers/${encodeURIComponent(customerId)}`, stripeSecretKey, {
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
        `subscriptions/${encodeURIComponent(subscriptionId)}`,
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

  const paidInvoices: string[] = [];
  for (const invoiceId of openInvoiceIds) {
    try {
      await stripeApiRequest(`invoices/${encodeURIComponent(invoiceId)}/pay`, stripeSecretKey, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(),
      });
      paidInvoices.push(invoiceId);
    } catch (error) {
      console.warn(`Could not pay invoice ${invoiceId}; continuing if it was already paid`, error);
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
    throw new Error(`Could not look up final shipment: ${shipmentLookupError.message}`);
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
      throw new Error(`Could not mark final shipment paid: ${shipmentUpdateError.message}`);
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
    throw new Error(`Could not mark final settlement paid: ${boxUpdateError.message}`);
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

const handlePaymentMethodUpdateCheckout = async ({
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
  const userId = metadata.supabase_user_id;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const setupIntentId =
    typeof session.setup_intent === "string"
      ? session.setup_intent
      : session.setup_intent?.id;

  if (!userId) {
    return { ignored: true, reason: "missing supabase_user_id metadata" };
  }

  if (!customerId) {
    return { ignored: true, reason: "missing Stripe customer on setup session" };
  }

  if (!setupIntentId) {
    return { ignored: true, reason: "missing setup_intent on setup session" };
  }

  const setupIntent = await stripeApiRequest(
    `setup_intents/${encodeURIComponent(setupIntentId)}`,
    stripeSecretKey,
  );

  const paymentMethodId =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id || null;

  if (!paymentMethodId) {
    return { ignored: true, reason: "setup intent missing payment method", setupIntentId };
  }

  const customerParams = new URLSearchParams();
  customerParams.append("invoice_settings[default_payment_method]", paymentMethodId);

  await stripeApiRequest(`customers/${encodeURIComponent(customerId)}`, stripeSecretKey, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: customerParams,
  });

  const { data: boxes, error: boxesError } = await supabase
    .from("boxes")
    .select("id,stripe_subscription_id")
    .eq("user_id", userId)
    .not("stripe_subscription_id", "is", null)
    .neq("subscription_lifecycle_status", "terminated");

  if (boxesError) {
    throw new Error(`Could not load subscriptions for payment method update: ${boxesError.message}`);
  }

  const subscriptionIds = Array.from(
    new Set(
      (boxes || [])
        .map((box: { stripe_subscription_id?: string | null }) => box.stripe_subscription_id)
        .filter(Boolean),
    ),
  ) as string[];

  for (const subscriptionId of subscriptionIds) {
    const subscriptionParams = new URLSearchParams();
    subscriptionParams.append("default_payment_method", paymentMethodId);

    await stripeApiRequest(
      `subscriptions/${encodeURIComponent(subscriptionId)}`,
      stripeSecretKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: subscriptionParams,
      },
    );
  }

  return {
    updated: true,
    userId,
    customerId,
    setupIntentId,
    paymentMethodId,
    subscriptionsUpdated: subscriptionIds.length,
  };
};

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const stripeBinMonthlyPriceId = Deno.env.get("STRIPE_BIN_MONTHLY_PRICE_ID") || "";
  const stripeBinStorageProductId = Deno.env.get("STRIPE_BIN_STORAGE_PRODUCT_ID") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey =
    Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!String(webhookSecret || "").trim() || !stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse({ error: "Missing required Edge Function secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY), or SUPABASE_URL" }, 500);
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

  try {
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
    event.type === "checkout.session.completed" &&
    event.data?.object?.metadata?.flow === "subscription_reactivation"
  ) {
    if (!stripeBinMonthlyPriceId.trim() && !stripeBinStorageProductId.trim()) {
      throw new Error("Missing STRIPE_BIN_MONTHLY_PRICE_ID or STRIPE_BIN_STORAGE_PRODUCT_ID");
    }
    const result = await handleSubscriptionReactivationCheckout({
      supabase,
      session: event.data.object || {},
      stripeSecretKey,
      stripeBinMonthlyPriceId,
      stripeBinStorageProductId,
    });

    return jsonResponse({
      received: true,
      eventType: event.type,
      flow: "subscription_reactivation",
      result,
    });
  }

  if (
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

  if (
    event.type === "checkout.session.completed" &&
    event.data?.object?.metadata?.flow === "payment_method_update"
  ) {
    const result = await handlePaymentMethodUpdateCheckout({
      supabase,
      session: event.data.object || {},
    });

    return jsonResponse({
      received: true,
      eventType: event.type,
      flow: "payment_method_update",
      result,
    });
  }

  if (
    event.type === "checkout.session.completed" &&
    event.data?.object?.metadata?.flow === "customer_shipping"
  ) {
    const result = await handleCustomerShippingCheckout({
      supabase,
      session: event.data.object || {},
    });

    // Returns: auto-purchase FedEx only for return (to_storage) rows; outbound to_customer stays manual (admin).
    let labelPurchase: unknown = null;
    try {
      const ids = (result as { shipmentIds?: string[] }).shipmentIds;
      if (Array.isArray(ids) && ids.length > 0) {
        labelPurchase = await autoPurchaseShippingLabelsForIds(supabase, ids);
      }
    } catch (e) {
      console.error("autoPurchaseShippingLabelsForIds", e);
      labelPurchase = { error: e instanceof Error ? e.message : String(e) };
    }

    let binRequestedEmails: unknown = null;
    try {
      const ids = (result as { shipmentIds?: string[] }).shipmentIds;
      if (Array.isArray(ids) && ids.length > 0) {
        binRequestedEmails = await notifyBinRequestedEmails(supabase, ids);
      }
    } catch (e) {
      console.warn("bin requested emails", e);
    }

    return jsonResponse({
      received: true,
      eventType: event.type,
      flow: "customer_shipping",
      result: { ...(result as Record<string, unknown>), labelPurchase, binRequestedEmails },
    });
  }

  if (
    event.type === "payment_intent.payment_failed" &&
    event.data?.object?.metadata?.flow === "customer_shipping"
  ) {
    const result = await handleCustomerShippingPaymentFailed({
      supabase,
      paymentIntent: event.data.object || {},
    });

    return jsonResponse({
      received: true,
      eventType: event.type,
      flow: "customer_shipping",
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

  let sessionRecord = (event.data?.object || {}) as Record<string, unknown>;
  let metadata = { ...(sessionRecord.metadata as Record<string, unknown> | undefined) };

  if (metadata.flow !== "initial_purchase") {
    return jsonResponse({ received: true, ignored: true, eventType: event.type });
  }

  if (String(sessionRecord?.payment_status || "") !== "paid") {
    return jsonResponse({
      received: true,
      ignored: true,
      eventType: event.type,
      flow: "initial_purchase",
      reason: "checkout session is not paid",
      paymentStatus: sessionRecord?.payment_status || null,
    });
  }

  // Event payloads sometimes omit metadata that exists on the live Checkout Session / PaymentIntent.
  const sessionId = getStripeId(sessionRecord?.id) || String(sessionRecord?.id || "").trim();
  const parsedPlans = parseInitialPurchasePlanGroups(metadata as Record<string, unknown>);
  const needsMetadataEnrich =
    Boolean(sessionId) &&
    (parsedPlans.length === 0 || !String(metadata.supabase_user_id || "").trim());
  if (needsMetadataEnrich) {
    try {
      const res = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`,
        { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
      );
      const full = await res.json().catch(() => ({}));
      if (res.ok && full && typeof full === "object") {
        sessionRecord = full as Record<string, unknown>;
        const sm = (full as { metadata?: Record<string, unknown> }).metadata || {};
        const pi = (full as { payment_intent?: unknown }).payment_intent;
        const pim =
          pi && typeof pi === "object" && pi !== null && "metadata" in (pi as object)
            ? ((pi as { metadata?: Record<string, unknown> }).metadata || {})
            : {};
        metadata = { ...pim, ...sm };
      }
    } catch (e) {
      console.warn("stripe-webhook: could not expand checkout session for metadata", e);
    }
  }

  const { status, body } = await fulfillInitialPurchaseCheckoutSessionCompletedCore({
    supabase,
    session: sessionRecord,
    metadata: metadata as Record<string, unknown>,
    stripeSecretKey,
    stripeBinMonthlyPriceId: stripeBinMonthlyPriceId.trim() || null,
    stripeBinStorageProductId: stripeBinStorageProductId.trim() || null,
  });

  let bookingConfirmationEmail: unknown = null;
  if (status === 200 && Number(body.createdBoxes || 0) > 0) {
    const userId = String(metadata.supabase_user_id || "").trim();
    const sessionId = getStripeId(sessionRecord?.id) || String(sessionRecord?.id || "").trim();
    const amountTotal = Number(sessionRecord?.amount_total || 0);
    if (userId && sessionId) {
      try {
        bookingConfirmationEmail = await sendBookingConfirmationEmail(supabase, {
          userId,
          checkoutSessionId: sessionId,
          binCount: Number(body.createdBoxes || 0),
          amountChargedCents: amountTotal,
          customerEmail: String(metadata.shipping_email || "").trim() || null,
          customerName: String(metadata.shipping_full_name || "").trim() || null,
        });
      } catch (emailErr) {
        console.warn("booking confirmation email", emailErr);
      }
    }
  }

  return jsonResponse({ ...body, bookingConfirmationEmail }, status);
  } catch (error) {
    console.error("stripe-webhook processing error", error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
