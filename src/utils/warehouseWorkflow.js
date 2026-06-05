import { needsHomeBayPlacement } from "./binIntake";

const PREP_STATUSES = new Set([
  "picked",
  "in_staging",
  "label_verified",
  "qr_applied",
  "outbound_labeled",
]);

function step(id, label, state) {
  return { id, label, state };
}

/** @returns {'starter_kit'|'send_to_customer'|'return_intake'|null} */
export function detectWarehouseFlow(row, assignment, { isStarterKitShipmentRow }) {
  if (!row) return null;

  const dir = row.latest_shipment_direction;
  const ship = row.latest_shipping_status;
  const ast = String(assignment?.status || "");

  if (isStarterKitShipmentRow?.(row)) return "starter_kit";

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
    (dir === "to_storage" ||
      row.status === "stored" ||
      row.fulfillment_status === "stored" ||
      ship === "delivered")
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
    const qrDone = ast === "qr_applied" || PREP_STATUSES.has(ast);
    const labelDone = ["label_created", "in_transit", "out_for_delivery", "delivered"].includes(
      String(shippingStatus || ""),
    );
    const matchDone = ast === "label_verified" || ast === "outbound_labeled";
    const carrierDone = ["in_transit", "out_for_delivery", "delivered"].includes(String(shippingStatus || ""));

    const steps = [
      step("qr", "Print & apply bin QR", qrDone ? "done" : "current"),
      step(
        "label",
        "Print ship label",
        labelDone ? "done" : qrDone ? "current" : "pending",
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
