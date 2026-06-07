/** Return label exists; customer has not dropped off / FedEx has not scanned yet. */
export function isReturnLabelAwaitingCarrierPickup(shipment) {
  if (!shipment) return false;
  if (String(shipment.shipment_direction || "") !== "to_storage") return false;
  return String(shipment.shipping_status || "") === "label_created";
}
