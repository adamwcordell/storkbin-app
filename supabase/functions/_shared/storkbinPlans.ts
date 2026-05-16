export type StorkBinPlan = {
  id: string;
  name: string;
  binCount: number;
  monthlyRateCents: number;
  setupFeeCents: number;
  minimumMonths: number;
  returnShippingDiscountPercent: number;
  initialShipmentStackSize: number;
};

export const STORKBIN_PLANS: StorkBinPlan[] = [
  {
    id: "one_bin",
    name: "1 Bin",
    binCount: 1,
    monthlyRateCents: 1500,
    setupFeeCents: 2500,
    minimumMonths: 12,
    returnShippingDiscountPercent: 0,
    initialShipmentStackSize: 4,
  },
  {
    id: "two_bins",
    name: "2 Bins",
    binCount: 2,
    monthlyRateCents: 3000,
    setupFeeCents: 1500,
    minimumMonths: 12,
    returnShippingDiscountPercent: 0,
    initialShipmentStackSize: 4,
  },
  {
    id: "four_bins",
    name: "4 Bins",
    binCount: 4,
    monthlyRateCents: 6000,
    setupFeeCents: 0,
    minimumMonths: 12,
    returnShippingDiscountPercent: 0,
    initialShipmentStackSize: 4,
  },
];

export const getStorkBinPlan = (planId: string) =>
  STORKBIN_PLANS.find((plan) => plan.id === planId);
