import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type SupabaseServiceClient = ReturnType<typeof createClient>;

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getSubscriptionFailureDeadline = (box: { status?: string | null }) => {
  const now = new Date();
  return addDays(now, 45);
};

type BoxRow = {
  id: string;
  status?: string | null;
  subscription_payment_status?: string | null;
  subscription_lifecycle_status?: string | null;
};

export type ReconcileOneResult = {
  subscriptionId: string;
  stripeStatus: string | null;
  actions: string[];
  boxIds: string[];
  error?: string;
  dryRun?: boolean;
};

export type ReconcileOptions = {
  /** If true, compute actions but do not write to `boxes`. */
  dryRun?: boolean;
  /**
   * If false, Stripe HTTP 404 on GET subscription is reported as `stripe_subscription_not_found` and does not terminate bins.
   * Safer when a bad `stripe_subscription_id` could be stored or keys/mode could mismatch.
   */
  treatStripe404AsCanceled?: boolean;
};

const stripeSubscriptionGet = async (stripeSecretKey: string, subscriptionId: string) => {
  const url =
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=latest_invoice`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 404) {
    return { ok: false as const, notFound: true as const };
  }
  if (!res.ok) {
    return {
      ok: false as const,
      notFound: false as const,
      error: String(body?.error?.message || `Stripe HTTP ${res.status}`),
    };
  }
  return { ok: true as const, subscription: body as Record<string, unknown> };
};

/** Align `boxes` rows with Stripe subscription state (cancellation + common payment drift). */
export async function reconcileStripeSubscriptionGroup(
  supabase: SupabaseServiceClient,
  stripeSecretKey: string,
  subscriptionId: string,
  boxGroup: BoxRow[],
  options: ReconcileOptions = {},
): Promise<ReconcileOneResult> {
  const dryRun = options.dryRun ?? false;
  const treatStripe404AsCanceled = options.treatStripe404AsCanceled ?? true;

  const boxIds = boxGroup.map((b) => b.id).filter(Boolean);
  const actions: string[] = [];
  const firstBox = boxGroup[0];

  const fetched = await stripeSubscriptionGet(stripeSecretKey, subscriptionId);
  if (!fetched.ok && "error" in fetched && fetched.error) {
    return { subscriptionId, stripeStatus: null, actions: [], boxIds, error: fetched.error, dryRun };
  }

  let subscription: Record<string, unknown>;
  if (!fetched.ok && "notFound" in fetched && fetched.notFound) {
    if (!treatStripe404AsCanceled) {
      return {
        subscriptionId,
        stripeStatus: null,
        actions: ["skipped_stripe_subscription_not_found"],
        boxIds,
        dryRun,
      };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    subscription = {
      id: subscriptionId,
      status: "canceled",
      canceled_at: nowSec,
      ended_at: nowSec,
      cancel_at: null,
    };
  } else if (fetched.ok) {
    subscription = fetched.subscription;
  } else {
    return { subscriptionId, stripeStatus: null, actions: [], boxIds, error: "Unexpected Stripe response", dryRun };
  }

  const stripeStatus = String(subscription.status || "");
  const canceledAt = subscription.canceled_at
    ? new Date(Number(subscription.canceled_at) * 1000).toISOString()
    : new Date().toISOString();
  const cancelAt = subscription.cancel_at
    ? new Date(Number(subscription.cancel_at) * 1000).toISOString()
    : null;
  const endedAt = subscription.ended_at ? Number(subscription.ended_at) * 1000 : null;

  const shouldTerminate =
    stripeStatus === "canceled" || stripeStatus === "unpaid" || Boolean(endedAt && endedAt > 0);

  if (!shouldTerminate && cancelAt) {
    actions.push("synced_scheduled_cancellation");
    if (!dryRun) {
      const { error } = await supabase
        .from("boxes")
        .update({
          subscription_status: stripeStatus || "active",
          subscription_ends_at: cancelAt,
        })
        .in("id", boxIds);

      if (error) {
        return { subscriptionId, stripeStatus, actions, boxIds, error: error.message, dryRun };
      }
    }
    return { subscriptionId, stripeStatus, actions, boxIds, dryRun };
  }

  if (shouldTerminate) {
    actions.push("synced_stripe_termination");
    if (!dryRun) {
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
        .in("id", boxIds);

      if (error) {
        return { subscriptionId, stripeStatus, actions, boxIds, error: error.message, dryRun };
      }
    }
    return { subscriptionId, stripeStatus, actions, boxIds, dryRun };
  }

  // --- Payment drift (non-terminal Stripe states only) ---
  const anyPaid = boxGroup.some((b) => b.subscription_payment_status === "paid");
  const anyFailed = boxGroup.some((b) => b.subscription_payment_status === "failed");

  if (stripeStatus === "past_due" && anyPaid && firstBox) {
    actions.push("marked_payment_failed_from_past_due");
    if (!dryRun) {
      const failedAt = new Date();
      const deadline = getSubscriptionFailureDeadline(firstBox);
      const { error } = await supabase
        .from("boxes")
        .update({
          subscription_payment_status: "failed",
          subscription_payment_failed_at: failedAt.toISOString(),
          last_payment_failed_at: failedAt.toISOString(),
          subscription_payment_deadline_at: deadline.toISOString(),
          lifecycle_deadline_at: deadline.toISOString(),
          lifecycle_attention_reason:
            firstBox.status === "at_customer"
              ? "customer_held_subscription_payment_failed"
              : "stored_subscription_payment_failed",
          subscription_payment_failure_reason: "Stripe subscription past_due (reconciliation sweep)",
        })
        .in("id", boxIds);

      if (error) {
        return { subscriptionId, stripeStatus, actions, boxIds, error: error.message, dryRun };
      }
    }
  }

  if ((stripeStatus === "active" || stripeStatus === "trialing") && anyFailed) {
    const latest = subscription.latest_invoice;
    const inv =
      latest && typeof latest === "object"
        ? (latest as Record<string, unknown>)
        : null;
    const invStatus = inv ? String(inv.status || "") : "";
    const rawRemain = inv?.amount_remaining ?? inv?.amount_due;
    const invRemaining =
      typeof rawRemain === "number" && !Number.isNaN(rawRemain) ? rawRemain : invStatus === "paid" ? 0 : -1;
    // Only clear failure when Stripe’s expanded latest invoice is fully paid with nothing left due.
    if (
      inv &&
      invStatus === "paid" &&
      invRemaining === 0 &&
      typeof inv.period_end === "number"
    ) {
      actions.push("healed_payment_from_paid_invoice");
      if (!dryRun) {
        const updatePayload: Record<string, string | null> = {
          subscription_payment_status: "paid",
          subscription_payment_failed_at: null,
          last_payment_failed_at: null,
          subscription_payment_deadline_at: null,
          lifecycle_deadline_at: null,
          lifecycle_attention_reason: null,
          subscription_payment_failure_reason: null,
          renews_at: new Date(Number(inv.period_end) * 1000).toISOString(),
        };

        const { error } = await supabase.from("boxes").update(updatePayload).in("id", boxIds);
        if (error) {
          return { subscriptionId, stripeStatus, actions, boxIds, error: error.message, dryRun };
        }
      }
    }
  }

  if (actions.length === 0) {
    actions.push("no_changes");
  }

  return { subscriptionId, stripeStatus, actions, boxIds, dryRun };
}
