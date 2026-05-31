import {
  RETURN_EMPTY_FLAT_DIM_IN,
  RETURN_EMPTY_QUOTE_WEIGHT_LB_PER_PIECE,
  stackedEmptyReturnPackage,
} from "../config/shippingPackages";

/** Starter outbound label flow: empty collapsed bins stacked on one label. */
export function isStarterKitOutboundLabelContext(shipment, box) {
  return (
    String(shipment?.shipment_direction || "") === "to_customer" &&
    String(box?.fulfillment_status || "") === "paid_waiting_to_ship_bin" &&
    String(box?.checkout_status || "") === "paid"
  );
}

export function formatStarterEmptyStackPackage(pieceCount) {
  const pkg = stackedEmptyReturnPackage(pieceCount);
  const n = pkg.piece_count;
  return {
    pieceCount: n,
    lengthIn: pkg.length_in,
    widthIn: pkg.width_in,
    heightIn: pkg.height_in,
    weightLb: pkg.weight_lb,
    summary:
      n === 1
        ? `1 collapsed empty bin — ${pkg.length_in}" × ${pkg.width_in}" × ${pkg.height_in}", ${pkg.weight_lb} lb`
        : `${n} collapsed empty bins stacked — ${pkg.length_in}" × ${pkg.width_in}" × ${pkg.height_in}" (L×W×H), ${pkg.weight_lb} lb total`,
    detailLines: [
      `${n} empty bin${n === 1 ? "" : "s"} (collapsed flat, not expanded for storage)`,
      `Footprint: ${pkg.length_in}" × ${pkg.width_in}" per bin`,
      `Stacked height: ${pkg.height_in}" total (${RETURN_EMPTY_FLAT_DIM_IN.height}" per bin × ${n})`,
      `Quoted weight: ${pkg.weight_lb} lb total (${RETURN_EMPTY_QUOTE_WEIGHT_LB_PER_PIECE} lb per bin)`,
    ],
  };
}
