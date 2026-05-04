export const BILLING_CURRENCY = "usd";

export const MINIMUM_TERM_MONTHS = 6;
export const DEFAULT_MONTHLY_RATE_PER_BIN = 13;
export const DEFAULT_SETUP_FEE = 35;
export const DEFAULT_SHIPPING_COST = 18;
export const DEFAULT_EMPTY_BIN_STACK_SIZE = 3;

// Backward-compatible constants used by the current app UI/actions.
export const SETUP_FEE = DEFAULT_SETUP_FEE;
export const MONTHLY_RATE = DEFAULT_MONTHLY_RATE_PER_BIN;
export const FIRST_MONTH_TOTAL = SETUP_FEE + MONTHLY_RATE;

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
    monthlyRate: 13,
    setupFee: 35,
  }),
  buildPlan({
    id: "three_bins",
    name: "3 Bins",
    subtitle: "Best Value",
    type: PLAN_TYPES.MULTI_BIN,
    binCount: 3,
    monthlyRate: 39,
    setupFee: 35,
    returnShippingDiscountPercent: 50,
    badge: "Best Value",
  }),
  buildPlan({
    id: "six_bins",
    name: "6 Bins",
    subtitle: "Bulk Storage",
    type: PLAN_TYPES.MULTI_BIN,
    binCount: 6,
    monthlyRate: 78,
    setupFee: 50,
    returnShippingDiscountPercent: 50,
    badge: "Bulk Storage",
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
