import { canPickForSendToCustomer } from "./warehouseWorkflow";

/** @param {object|null|undefined} assignment — when set, detects post-label starter outbound too */
export function isStarterKitShipmentRow(row, assignment = null) {
  if (row?.checkout_status !== "paid") return false;
  if (row?.latest_shipment_direction !== "to_customer") return false;
  if (!row?.latest_shipment_id) return false;

  const fulfillment = String(row?.fulfillment_status || "");
  if (fulfillment === "paid_waiting_to_ship_bin") return true;

  // Label purchase sets boxes.fulfillment_status to label_created; warehouse match still follows starter rules.
  if (fulfillment === "label_created") {
    const ship = String(row?.latest_shipping_status || "");
    if (!["paid", "label_created"].includes(ship)) return false;
    const ast = assignment ? String(assignment.status || "") : "";
    return ["qr_applied", "outbound_labeled", "label_verified"].includes(ast);
  }

  return false;
}

export function getStarterKitPieceCount(row) {
  const n = Number(row?.plan_bin_count);
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : 1;
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

  if (isStarterKitShipmentRow(box, assignment)) {
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
  if (ast === "in_staging") return true;

  if (["qr_applied", "outbound_labeled"].includes(ast)) {
    return (
      box?.checkout_status === "paid" &&
      box?.latest_shipment_direction === "to_customer" &&
      Boolean(box?.latest_shipment_id)
    );
  }

  return false;
}

export function canPrintBinQrSticker(box, assignment) {
  return (
    String(assignment?.status || "") === "assigned" &&
    box?.fulfillment_status === "paid_waiting_to_ship_bin"
  );
}

export function canApplyBinQrSticker(box, assignment) {
  return (
    String(assignment?.status || "") === "qr_printed" &&
    box?.fulfillment_status === "paid_waiting_to_ship_bin"
  );
}

export function isOutboundStaged(box, assignment) {
  const ast = String(assignment?.status || "");
  return (
    box?.latest_shipment_direction === "to_customer" &&
    ["picked", "in_staging", "label_verified", "qr_printed", "qr_applied", "outbound_labeled"].includes(ast)
  );
}

/** Printer / FedEx purchase — admin dashboard only. */
export function getBinScanAdminDeskNote(box, assignment) {
  if (canPrintBinQrSticker(box, assignment)) return "print_qr_sticker";
  if (canGenerateLabelForBin(box, assignment)) return "purchase_label";
  return null;
}

export function kitBinsReadyForLabelMatch(kitBoxIds, assignmentsByBoxId = {}) {
  const ids = Array.isArray(kitBoxIds) ? kitBoxIds : [];
  if (ids.length <= 1) return true;
  return ids.every((bid) => {
    const a = assignmentsByBoxId[String(bid)];
    return a && (a.status === "qr_applied" || a.status === "outbound_labeled");
  });
}

export function canMatchShippingLabelOnBinScan(box, assignment, { kitBoxIds = [], assignmentsByBoxId = {} } = {}) {
  if (!canMatchShippingLabelForBin(box, assignment)) return false;
  if (!isStarterKitShipmentRow(box, assignment)) return true;
  return kitBinsReadyForLabelMatch(kitBoxIds, assignmentsByBoxId);
}

export function getPrimaryWarehouseAction(box, assignment, opts = {}) {
  const surface = opts.surface || "admin";
  const workflowOpts = { isStarterKitShipmentRow: opts.isStarterKitShipmentRow || isStarterKitShipmentRow };
  if (canPickForSendToCustomer(box, assignment, workflowOpts)) return "pick";
  if (surface !== "bin_scan" && canGenerateLabelForBin(box, assignment)) return "create_label";
  if (
    surface === "bin_scan"
      ? canMatchShippingLabelOnBinScan(box, assignment, opts)
      : canMatchShippingLabelForBin(box, assignment)
  ) {
    return "match_label";
  }
  if (surface !== "bin_scan" && canPrintBinQrSticker(box, assignment)) return "print_qr";
  if (canApplyBinQrSticker(box, assignment)) return "apply_qr";
  if (opts.showReturnPlacement) return "store_in_bay";
  return null;
}
