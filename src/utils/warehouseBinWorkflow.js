import { canPickForSendToCustomer } from "./warehouseWorkflow";

export function isStarterKitShipmentRow(row) {
  return (
    row?.checkout_status === "paid" &&
    row?.fulfillment_status === "paid_waiting_to_ship_bin" &&
    row?.latest_shipment_direction === "to_customer" &&
    Boolean(row?.latest_shipment_id)
  );
}

/** Warehouse outbound: ready to purchase/print carrier label after pick/stage. */
export function canGenerateLabelForBin(box, assignment) {
  const isLabelStillNeeded =
    box?.latest_shipment_id &&
    String(box.latest_charge_status || "") === "paid" &&
    box.latest_shipping_status === "paid" &&
    (box.latest_label_status === "needed" ||
      box.latest_label_status === "label_needed" ||
      box.latest_label_status === "purchase_failed" ||
      !box.latest_label_status);

  if (!isLabelStillNeeded) return false;

  if (box.latest_shipment_direction === "to_storage") {
    return box.latest_label_status === "purchase_failed";
  }

  if (isStarterKitShipmentRow(box)) {
    return String(assignment?.status || "") === "qr_applied";
  }

  const isWarehouseOutbound =
    box.latest_shipment_direction === "to_customer" &&
    box.status === "stored" &&
    box.fulfillment_status !== "paid_waiting_to_ship_bin";

  if (isWarehouseOutbound) {
    return ["picked", "in_staging", "label_verified"].includes(String(assignment?.status || ""));
  }

  return false;
}

/** Ready to scan bin QR + label barcode after label exists. */
export function canMatchShippingLabelForBin(box, assignment) {
  const ship = String(box?.latest_shipping_status || "");
  if (ship !== "label_created") return false;

  const ast = String(assignment?.status || "");
  if (isStarterKitShipmentRow(box)) {
    return ast === "qr_applied" || ast === "outbound_labeled";
  }
  return ast === "in_staging";
}

export function canApplyBinQrSticker(box, assignment) {
  return (
    String(assignment?.status || "") === "assigned" &&
    box?.fulfillment_status === "paid_waiting_to_ship_bin"
  );
}

export function isOutboundStaged(box, assignment) {
  const ast = String(assignment?.status || "");
  return (
    box?.latest_shipment_direction === "to_customer" &&
    ["picked", "in_staging", "label_verified", "qr_applied", "outbound_labeled"].includes(ast)
  );
}

export function getPrimaryWarehouseAction(box, assignment, opts = {}) {
  const workflowOpts = { isStarterKitShipmentRow: opts.isStarterKitShipmentRow || isStarterKitShipmentRow };
  if (canPickForSendToCustomer(box, assignment, workflowOpts)) return "pick";
  if (canGenerateLabelForBin(box, assignment)) return "create_label";
  if (canMatchShippingLabelForBin(box, assignment)) return "match_label";
  if (canApplyBinQrSticker(box, assignment)) return "apply_qr";
  if (opts.showReturnPlacement) return "store_in_bay";
  return null;
}
