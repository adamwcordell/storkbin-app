export const BILLING_CURRENCY = "usd";

export const MINIMUM_TERM_MONTHS = 12;

/** One-time fee charged if a customer ends service during the minimum term. */
export const EARLY_CANCELLATION_FEE_USD = 99;
/** @deprecated Legacy name; cancellation UI uses `EARLY_CANCELLATION_FEE_USD` and server quotes. */
export const EARLY_CONTRACT_BREAK_PENALTY_MONTHS = 4;

export function isWithinMinimumTerm(box, minimumMonths = MINIMUM_TERM_MONTHS) {
  if (box?.early_termination_fee_waived) return false;
  if (!box?.subscription_started_at) return false;
  const now = new Date();
  const startedAt = new Date(box.subscription_started_at);
  if (Number.isNaN(startedAt.getTime())) return false;
  const minimumTermEnd = new Date(startedAt);
  minimumTermEnd.setMonth(minimumTermEnd.getMonth() + minimumMonths);
  return minimumTermEnd.getTime() > now.getTime();
}

/** Next calendar monthly anniversary strictly after now (used for renews_at roll-forward). */
export function getNextMonthlyDate(dateValue) {
  const now = new Date();
  const nextDate = new Date(dateValue);

  while (nextDate.getTime() <= now.getTime()) {
    nextDate.setMonth(nextDate.getMonth() + 1);
  }

  return nextDate;
}

/** When a scheduled (non–early-break) cancellation would end billing, aligned with requestCancellation in App. */
export function getCancellationEndDate(box, minimumMonths = MINIMUM_TERM_MONTHS) {
  const now = new Date();

  if (box.early_termination_fee_waived) {
    if (box.renews_at) {
      return getNextMonthlyDate(box.renews_at);
    }
    return getNextMonthlyDate(now);
  }

  const startedAt = box.subscription_started_at ? new Date(box.subscription_started_at) : now;

  const minimumTermEnd = new Date(startedAt);
  minimumTermEnd.setMonth(minimumTermEnd.getMonth() + minimumMonths);

  if (minimumTermEnd.getTime() > now.getTime()) {
    return minimumTermEnd;
  }

  if (box.renews_at) {
    return getNextMonthlyDate(box.renews_at);
  }

  return now;
}
/** Outside dimensions — shown on plan pickers (homepage, dashboard, etc.). */
export const STORAGE_BIN_OUTSIDE_LABEL = '27" × 17" × 14"';

export const DEFAULT_MONTHLY_RATE_PER_BIN = 15;
export const DEFAULT_SETUP_FEE = 25;
export const DEFAULT_SHIPPING_COST = 18;
export const DEFAULT_EMPTY_BIN_STACK_SIZE = 4;

// Backward-compatible constants used by the current app UI/actions.
export const SETUP_FEE = DEFAULT_SETUP_FEE;
export const MONTHLY_RATE = DEFAULT_MONTHLY_RATE_PER_BIN;
export const FIRST_MONTH_TOTAL = SETUP_FEE + MONTHLY_RATE;
export const ANNUAL_PREPAY_BILLED_MONTHS = 11;
export const BILLING_CYCLES = {
  MONTHLY: "monthly",
  ANNUAL: "annual",
};

export const PLAN_TYPES = {
  SINGLE_BIN: "single_bin",
  MULTI_BIN: "multi_bin",
};

export const PAYMENT_FLOW_TYPES = {
  INITIAL_PURCHASE: "initial_purchase",
  MONTHLY_SUBSCRIPTION: "monthly_subscription",
  SHIP_STORED_BIN_TO_CUSTOMER: "ship_stored_bin_to_customer",
  RETURN_CUSTOMER_BIN_TO_STORAGE: "return_customer_bin_to_storage",
  CANCELLATION_FINAL_SHIPMENT: "cancellation_final_shipment",
  FAILED_PAYMENT_RECOVERY: "failed_payment_recovery",
  REACTIVATE_TERMINATED_SUBSCRIPTION: "reactivate_terminated_subscription",
};

export const SHIPPING_DIRECTIONS = {
  TO_CUSTOMER: "to_customer",
  TO_STORAGE: "to_storage",
};

export const DEFAULT_SHIPPING_RULES = {
  initialEmptyBinShipment: {
    enabled: true,
    direction: SHIPPING_DIRECTIONS.TO_CUSTOMER,
    stackSize: DEFAULT_EMPTY_BIN_STACK_SIZE,
    chargeCustomer: false,
    notes: "Initial empty-bin shipment is included in the starter purchase flow.",
  },
  storedBinRequest: {
    enabled: true,
    direction: SHIPPING_DIRECTIONS.TO_CUSTOMER,
    chargeCustomer: true,
    basePrice: DEFAULT_SHIPPING_COST,
  },
  returnToStorage: {
    enabled: true,
    direction: SHIPPING_DIRECTIONS.TO_STORAGE,
    chargeCustomer: true,
    basePrice: DEFAULT_SHIPPING_COST,
  },
  cancellationFinalShipment: {
    enabled: true,
    direction: SHIPPING_DIRECTIONS.TO_CUSTOMER,
    chargeCustomer: true,
    basePrice: DEFAULT_SHIPPING_COST,
  },
};

/** @typedef {'standard' | 'featured' | 'premium'} PlanCardEmphasis */

const buildPlan = ({
  id,
  name,
  subtitle,
  type,
  binCount,
  monthlyRate,
  setupFee,
  returnShippingDiscountPercent = 0,
  badge = "",
  stripe = {},
  shipping = {},
  marketing = {},
}) => {
  const mergedShipping = {
    ...DEFAULT_SHIPPING_RULES,
    ...shipping,
    initialEmptyBinShipment: {
      ...DEFAULT_SHIPPING_RULES.initialEmptyBinShipment,
      ...(shipping.initialEmptyBinShipment || {}),
    },
    storedBinRequest: {
      ...DEFAULT_SHIPPING_RULES.storedBinRequest,
      ...(shipping.storedBinRequest || {}),
    },
    returnToStorage: {
      ...DEFAULT_SHIPPING_RULES.returnToStorage,
      ...(shipping.returnToStorage || {}),
    },
    cancellationFinalShipment: {
      ...DEFAULT_SHIPPING_RULES.cancellationFinalShipment,
      ...(shipping.cancellationFinalShipment || {}),
    },
  };

  const marketingDefaults = {
    valueSummary: "",
    benefitBullets: [],
    ctaLabel: "Add to cart",
    /** standard | featured (recommended) | premium (high-value tier) */
    emphasis: "standard",
    /** Optional short line under startup fee (e.g. no-fee comparison). */
    feeNote: "",
  };

  return {
    id,
    name,
    subtitle,
    type,
    binCount,
    monthlyRate,
    monthlyRatePerBin: monthlyRate / binCount,
    setupFee,
    minimumMonths: MINIMUM_TERM_MONTHS,
    returnShippingDiscountPercent,
    initialShipmentStackSize: mergedShipping.initialEmptyBinShipment.stackSize,
    badge,
    marketing: { ...marketingDefaults, ...marketing },
    billing: {
      currency: BILLING_CURRENCY,
      monthlyRate,
      monthlyRatePerBin: monthlyRate / binCount,
      setupFee,
      minimumMonths: MINIMUM_TERM_MONTHS,
      stripe,
      subscriptionModel: "one_subscription_per_bin",
    },
    shipping: mergedShipping,
  };
};

export const SUBSCRIPTION_PLANS = [
  buildPlan({
    id: "one_bin",
    name: "1 Bin",
    subtitle: "Starter Storage",
    type: PLAN_TYPES.SINGLE_BIN,
    binCount: 1,
    monthlyRate: 15,
    setupFee: 25,
    marketing: {
      emphasis: "standard",
      valueSummary:
        "Best for customers with limited space needs or seasonal storage.",
      benefitBullets: [
        "📦 Free empty-bin delivery",
        "🏠 Pack from home on your schedule",
        "🧥 Perfect for seasonal items & overflow storage",
        "🚚 Pay shipping only when requesting your bin back",
        "🎁 Keep your bin after cancellation",
      ],
      ctaLabel: "Start Storing",
    },
  }),
  buildPlan({
    id: "two_bins",
    name: "2 Bins",
    subtitle: "Most Popular",
    type: PLAN_TYPES.MULTI_BIN,
    binCount: 2,
    monthlyRate: 30,
    setupFee: 15,
    returnShippingDiscountPercent: 0,
    badge: "Most Popular",
    marketing: {
      emphasis: "featured",
      valueSummary:
        "Best for apartment living, closets, decorations, and garage overflow.",
      benefitBullets: [
        "📦 Free delivery of both storage bins",
        "🏠 No trips to a storage unit",
        "🎄 Great for holiday décor, clothing, and extra household storage",
        "🚚 Request bins back anytime",
        "🎁 Keep your bins after cancellation",
      ],
      ctaLabel: "Choose 2 Bins",
    },
  }),
  buildPlan({
    id: "four_bins",
    name: "4 Bins",
    subtitle: "Best Value",
    type: PLAN_TYPES.MULTI_BIN,
    binCount: 4,
    monthlyRate: 60,
    setupFee: 0,
    returnShippingDiscountPercent: 0,
    badge: "Best Value",
    marketing: {
      emphasis: "premium",
      valueSummary:
        "Best for families, long-term storage, outdoor gear, and major decluttering.",
      benefitBullets: [
        "📦 Free delivery of all storage bins",
        "🏠 Reclaim closets, garage, and living space",
        "👨‍👩‍👧 Ideal for families and large storage needs",
        "🚚 Easy long-term storage without renting a unit",
        "🎁 Keep your bins after cancellation",
      ],
      ctaLabel: "Maximize My Storage",
      feeNote: "No startup fee — compared to Starter, you skip the one-time setup charge.",
    },
  }),
];

export const getSubscriptionPlanById = (planId) =>
  SUBSCRIPTION_PLANS.find((plan) => plan.id === planId);

export const createPlanSnapshotForBox = (plan) => ({
  subscription_plan_id: plan.id,
  subscription_plan_name: plan.name,
  plan_bin_count: plan.binCount,
  plan_setup_fee: plan.setupFee,
  plan_monthly_rate: plan.monthlyRate,
  minimum_months: plan.minimumMonths,
  return_shipping_discount_percent: plan.returnShippingDiscountPercent,
  plan_initial_stack_size: plan.initialShipmentStackSize,
});

export const getPlanBillingSummary = (
  plan,
  billingCycle = BILLING_CYCLES.MONTHLY
) => {
  const monthlyRate = Number(plan?.monthlyRate || 0);
  const setupFee = Number(plan?.setupFee || 0);
  const normalizedCycle =
    billingCycle === BILLING_CYCLES.ANNUAL
      ? BILLING_CYCLES.ANNUAL
      : BILLING_CYCLES.MONTHLY;
  const annualPrepaySubtotal = ANNUAL_PREPAY_BILLED_MONTHS * monthlyRate;

  if (normalizedCycle === BILLING_CYCLES.ANNUAL) {
    return {
      billingCycle: BILLING_CYCLES.ANNUAL,
      dueToday: setupFee + annualPrepaySubtotal,
      recurringAfterPrepay: annualPrepaySubtotal,
      recurringIntervalMonths: 12,
      savingsVsTwelveMonths: monthlyRate,
      annualPrepayMonths: ANNUAL_PREPAY_BILLED_MONTHS,
    };
  }

  return {
    billingCycle: BILLING_CYCLES.MONTHLY,
    dueToday: setupFee + monthlyRate,
    recurringAfterPrepay: monthlyRate,
    recurringIntervalMonths: 1,
    savingsVsTwelveMonths: 0,
    annualPrepayMonths: ANNUAL_PREPAY_BILLED_MONTHS,
  };
};
