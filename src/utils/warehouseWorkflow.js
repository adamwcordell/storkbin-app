import { needsHomeBayPlacement } from "./binIntake";

const PREP_STATUSES = new Set([
  "picked",
  "in_staging",
  "label_verified",
  "qr_printed",
  "qr_applied",
  "outbound_labeled",
]);

function step(id, label, state) {
  return { id, label, state };
}

/** Paid warehouse → customer ship (not starter kit). Bin may still be `assigned` in rack without a prior `placed` scan. */
export function isActiveSendToCustomerOutbound(row, assignment, { isStarterKitShipmentRow } = {}) {
  if (!row) return false;
  if (isStarterKitShipmentRow?.(row)) return false;
  if (String(row.status) !== "stored") return false;
  if (row.fulfillment_status === "paid_waiting_to_ship_bin") return false;
  if (row.latest_shipment_direction !== "to_customer") return false;

  const chargePaid = String(row.latest_charge_status || "") === "paid";
  const shipActive = ["paid", "label_created", "in_transit", "out_for_delivery", "delivered"].includes(
    String(row.latest_shipping_status || ""),
  );
  return chargePaid || shipActive;
}

/** Return intake buttons — not when customer is waiting on an outbound pick. */
export function shouldShowReturnIntakeActions(row, assignment, { isStarterKitShipmentRow } = {}) {
  if (!needsHomeBayPlacement(assignment)) return false;
  if (row.fulfillment_status === "paid_waiting_to_ship_bin") return false;
  if (isStarterKitShipmentRow?.(row)) return false;
  if (isActiveSendToCustomerOutbound(row, assignment, { isStarterKitShipmentRow })) return false;
  if (row.status === "at_customer" || row.fulfillment_status === "bin_with_customer") return false;
  if (
    row.latest_shipment_direction === "to_customer" &&
    ["in_transit", "out_for_delivery", "delivered"].includes(String(row.latest_shipping_status || ""))
  ) {
    return false;
  }
  return true;
}

export function canPickForSendToCustomer(row, assignment, { isStarterKitShipmentRow } = {}) {
  if (!isActiveSendToCustomerOutbound(row, assignment, { isStarterKitShipmentRow })) return false;
  const ast = String(assignment?.status || "");
  return !["picked", "in_staging", "label_verified", "qr_applied", "outbound_labeled"].includes(ast);
}

/** @returns {'starter_kit'|'send_to_customer'|'return_intake'|null} */
export function detectWarehouseFlow(row, assignment, { isStarterKitShipmentRow }) {
  if (!row) return null;

  const dir = row.latest_shipment_direction;
  const ship = row.latest_shipping_status;
  const ast = String(assignment?.status || "");

  if (isStarterKitShipmentRow?.(row, assignment)) return "starter_kit";

  if (
    dir === "to_customer" &&
    row.status === "stored" &&
    row.fulfillment_status !== "paid_waiting_to_ship_bin" &&
    (PREP_STATUSES.has(ast) || ship === "paid" || ship === "label_created")
  ) {
    return "send_to_customer";
  }

  if (
    assignment?.bay_code &&
    needsHomeBayPlacement(assignment) &&
    row.fulfillment_status !== "paid_waiting_to_ship_bin" &&
    !isActiveSendToCustomerOutbound(row, assignment, { isStarterKitShipmentRow }) &&
    row.status !== "at_customer" &&
    row.fulfillment_status !== "bin_with_customer" &&
    !(dir === "to_customer" && ["in_transit", "out_for_delivery", "delivered"].includes(String(ship || ""))) &&
    (dir === "to_storage" ||
      row.status === "stored" ||
      row.fulfillment_status === "stored" ||
      (dir === "to_storage" && ship === "delivered"))
  ) {
    return "return_intake";
  }

  return null;
}

/**
 * @returns {{ flow: string, steps: Array<{id:string,label:string,state:'done'|'current'|'pending'}> }|null}
 */
export function getWarehouseWorkflow(row, assignment, { isStarterKitShipmentRow }) {
  const flow = detectWarehouseFlow(row, assignment, { isStarterKitShipmentRow });
  if (!flow) return null;

  const shippingStatus = row.latest_shipping_status;
  const ast = String(assignment?.status || "");
  const bay = String(assignment?.bay_code || "").toUpperCase();

  if (flow === "starter_kit") {
    const printDone = ast !== "assigned" && Boolean(ast);
    const applyDone = ast === "qr_applied" || ["outbound_labeled", "label_verified"].includes(ast);
    const labelDone = ["label_created", "in_transit", "out_for_delivery", "delivered"].includes(
      String(shippingStatus || ""),
    );
    const matchDone = ast === "label_verified" || ast === "outbound_labeled";
    const carrierDone = ["in_transit", "out_for_delivery", "delivered"].includes(String(shippingStatus || ""));

    const steps = [
      step("print_qr", "Print bin QR sticker", printDone ? "done" : "current"),
      step("apply_qr", "Apply bin QR sticker", applyDone ? "done" : printDone ? "current" : "pending"),
      step(
        "label",
        "Print ship label",
        labelDone ? "done" : applyDone ? "current" : "pending",
      ),
      step(
        "match",
        "Confirm QR + label match",
        matchDone ? "done" : labelDone ? "current" : "pending",
      ),
      step(
        "carrier",
        "FedEx tracking",
        carrierDone ? "done" : matchDone ? "current" : "pending",
      ),
    ];
    return { flow, steps };
  }

  if (flow === "send_to_customer") {
    const pickDone = ["picked", "in_staging", "label_verified"].includes(ast);
    const labelDone = ["label_created", "in_transit", "out_for_delivery", "delivered"].includes(
      String(shippingStatus || ""),
    );
    const matchDone = ast === "label_verified";
    const carrierDone = ["in_transit", "out_for_delivery", "delivered"].includes(String(shippingStatus || ""));

    const steps = [
      step("pick", "Pick bin (scan QR)", pickDone ? "done" : "current"),
      step("label", "Print ship label", labelDone ? "done" : pickDone ? "current" : "pending"),
      step("match", "Confirm QR + label match", matchDone ? "done" : labelDone ? "current" : "pending"),
      step("carrier", "FedEx tracking", carrierDone ? "done" : matchDone ? "current" : "pending"),
    ];
    return { flow, steps };
  }

  if (flow === "return_intake") {
    const placed = ast === "placed";
    const steps = [
      step("scan", "Scan bin → see home bay", placed ? "done" : "current"),
      step(
        "place",
        bay ? `Place in home bay ${bay}` : "Place in home bay",
        placed ? "done" : "pending",
      ),
    ];
    return { flow, steps };
  }

  return null;
}
