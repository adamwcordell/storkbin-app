/** Stripe REST helpers using application/x-www-form-urlencoded (subscriptions, customers, etc.). */

export type BinSubscriptionPricing =
  | { kind: "price_id"; priceId: string }
  | {
    kind: "price_data";
    productId: string;
    unitAmountCents: number;
    /** Per-bin recurring cadence; StorkBin currently bills monthly per bin. */
    recurringInterval: "month" | "year";
  };

export const stripeFormRequest = async (
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

/** Resolve the Stripe Product used for per-bin storage subscriptions. */
export const resolveBinStorageStripeProductId = async (
  stripeSecretKey: string,
  opts: { explicitProductId?: string | null; legacyPriceId?: string | null },
): Promise<string> => {
  const explicit = String(opts.explicitProductId || "").trim();
  if (explicit) return explicit;

  const priceId = String(opts.legacyPriceId || "").trim();
  if (!priceId) {
    throw new Error(
      "Set STRIPE_BIN_STORAGE_PRODUCT_ID or STRIPE_BIN_MONTHLY_PRICE_ID so per-bin subscriptions can be created",
    );
  }

  const price = await stripeFormRequest(`prices/${encodeURIComponent(priceId)}`, "GET", stripeSecretKey);
  const product = price?.product;
  if (typeof product === "string" && product) return product;
  if (product && typeof product === "object" && "id" in product && typeof (product as { id?: unknown }).id === "string") {
    return String((product as { id: string }).id);
  }

  throw new Error("Could not resolve Stripe product id from STRIPE_BIN_MONTHLY_PRICE_ID");
};

export const createPerBinSubscription = async ({
  stripeSecretKey,
  stripeCustomerId,
  pricing,
  billingCycleAnchorUnix,
  defaultPaymentMethodId,
  metadata,
}: {
  stripeSecretKey: string;
  stripeCustomerId: string;
  pricing: BinSubscriptionPricing;
  billingCycleAnchorUnix: number;
  defaultPaymentMethodId?: string;
  metadata: Record<string, string | number | boolean | null | undefined>;
}) => {
  const params = new URLSearchParams();
  params.append("customer", stripeCustomerId);
  if (pricing.kind === "price_id") {
    params.append("items[0][price]", pricing.priceId);
  } else {
    if (pricing.unitAmountCents < 50) {
      throw new Error("Per-bin subscription unit amount is too small");
    }
    params.append("items[0][price_data][currency]", "usd");
    params.append("items[0][price_data][product]", pricing.productId);
    params.append("items[0][price_data][recurring][interval]", pricing.recurringInterval);
    params.append("items[0][price_data][unit_amount]", String(pricing.unitAmountCents));
  }
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

  return stripeFormRequest("subscriptions", "POST", stripeSecretKey, params);
};
