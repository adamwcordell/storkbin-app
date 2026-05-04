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
    monthlyRateCents: 1300,
    setupFeeCents: 3500,
    minimumMonths: 6,
    returnShippingDiscountPercent: 0,
    initialShipmentStackSize: 3,
  },
  {
    id: "three_bins",
    name: "3 Bins",
    binCount: 3,
    monthlyRateCents: 3900,
    setupFeeCents: 3500,
    minimumMonths: 6,
    returnShippingDiscountPercent: 50,
    initialShipmentStackSize: 3,
  },
  {
    id: "six_bins",
    name: "6 Bins",
    binCount: 6,
    monthlyRateCents: 7800,
    setupFeeCents: 5000,
    minimumMonths: 6,
    returnShippingDiscountPercent: 50,
    initialShipmentStackSize: 3,
  },
];

export const getStorkBinPlan = (planId: string) =>
  STORKBIN_PLANS.find((plan) => plan.id === planId);
