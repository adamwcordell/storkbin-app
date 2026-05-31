/** Customer-requested shipping (bin to customer) — quoted max; heavier may cost more at carrier */
export const SHIP_TO_CUSTOMER_DIM_IN = { length: 24, width: 16, height: 12 };
export const SHIP_TO_CUSTOMER_MAX_WEIGHT_LB = 50;

/** Return to storage — full bin (one bin per label) */
export const RETURN_FULL_DIM_IN = { length: 24, width: 16, height: 12 };
export const RETURN_FULL_QUOTE_WEIGHT_LB = 50;

/** Return to storage — one empty flat bin before stacking */
export const RETURN_EMPTY_FLAT_DIM_IN = { length: 24, width: 16, height: 3 };
/** Per-bin weight used for stacked empty-return quotes (n bins → n × this lb) */
export const RETURN_EMPTY_QUOTE_WEIGHT_LB_PER_PIECE = 9;

/** Max empty flat bins combined on one return label */
export const RETURN_EMPTY_BUNDLE_MAX_BINS = 5;

export const SHIPPER_NAME_DEFAULT = "STORKBIN, LLC";

/** Legacy / non-cart surfaces — cart uses shorter per-line copy */
export const RETURN_SHIPPING_NOTICE =
  "FedEx rates for bin moves are finalized at Stripe checkout.";

/** Shown for ship-to-customer and return-full-bin moves only (not empty flat-pack returns). */
export const FULL_BIN_OVERWEIGHT_NOTICE =
  "Estimated shipping assumes up to a 50 lb maximum; additional fees may apply if your box is heavier.";

/**
 * FedEx-style single package for n stacked empty flat bins (same footprint, height stacks).
 * @param {number} pieceCount
 */
export function stackedEmptyReturnPackage(pieceCount) {
  const n = Math.min(
    RETURN_EMPTY_BUNDLE_MAX_BINS,
    Math.max(1, Math.floor(Number(pieceCount) || 1))
  );
  return {
    piece_count: n,
    length_in: RETURN_EMPTY_FLAT_DIM_IN.length,
    width_in: RETURN_EMPTY_FLAT_DIM_IN.width,
    height_in: RETURN_EMPTY_FLAT_DIM_IN.height * n,
    weight_lb: RETURN_EMPTY_QUOTE_WEIGHT_LB_PER_PIECE * n,
  };
}

/**
 * How many paid shipping checkout lines are in the cart (after bundling empty returns).
 * @param {Array<{ cart_type?: string, return_shipment_empty?: boolean }>} cartBoxes
 */
export function countBundledShippingCheckoutLines(cartBoxes) {
  const toCustomer = cartBoxes.filter((b) => b.cart_type === "ship_to_customer").length;
  const returns = cartBoxes.filter((b) => b.cart_type === "return_to_storage");
  const empties = returns.filter((b) => Boolean(b.return_shipment_empty));
  const fulls = returns.filter((b) => !b.return_shipment_empty);
  const emptyBundles =
    empties.length === 0 ? 0 : Math.ceil(empties.length / RETURN_EMPTY_BUNDLE_MAX_BINS);
  return toCustomer + fulls.length + emptyBundles;
}
