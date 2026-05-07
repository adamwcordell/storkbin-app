const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src', 'pages', 'DashboardPage.jsx');
let text = fs.readFileSync(filePath, 'utf8');

const oldBlock = `  const failedPaymentBoxes = boxes.filter((box) => {
    if (box.lifecycle_status === "auction" || box.lifecycle_status === "removed_from_system") {
      return false;
    }

    // Reactivation is optional and belongs on Account/My Bins, not Dashboard attention.
    // Dashboard payment attention is only for money owed or blocked shipments.
    if (box.subscription_lifecycle_status === "terminated") {
      return false;
    }

    const relatedShipmentFailed = shipments.some(
      (shipment) =>
        shipment.charge_status === "failed" &&
        (shipment.box_id === box.id ||
          shipment.latest_box_id === box.id ||
          shipment.box_ids?.includes?.(box.id) ||
          shipment.shipment_boxes?.some((shipmentBox) => shipmentBox.box_id === box.id))
    );

    return (
      relatedShipmentFailed ||
      box.fulfillment_status === "shipment_payment_failed" ||
      box.cancellation_shipping_charge_status === "failed" ||
      box.subscription_payment_status === "failed"
    );
  });`;

const newBlock = `  const failedPaymentBoxes = boxes.filter((box) => {
    if (box.lifecycle_status === "auction" || box.lifecycle_status === "removed_from_system") {
      return false;
    }

    const relatedShipmentFailed = hasFailedShipment(box, shipments);
    const hasFinalShipmentPaymentFailure =
      box.cancellation_shipping_charge_status === "failed" ||
      box.fulfillment_status === "shipment_payment_failed" ||
      relatedShipmentFailed;

    // Reactivation is optional and belongs on Account/My Bins, not Dashboard attention.
    // Ordinary terminated bins stay hidden, but canceled/terminated bins still need
    // attention when final-return shipping payment failed.
    if (box.subscription_lifecycle_status === "terminated" && !hasFinalShipmentPaymentFailure) {
      return false;
    }

    return (
      hasFinalShipmentPaymentFailure ||
      box.subscription_payment_status === "failed"
    );
  });`;

if (!text.includes(oldBlock)) {
  throw new Error('Could not find Dashboard failedPaymentBoxes block. File may have changed; no edits made.');
}
text = text.replace(oldBlock, newBlock);

const helperAnchor = `function getPaymentWarningMessage(box) {`;
const helper = `function hasFailedShipment(box, shipments) {
  return shipments.some((shipment) => {
    if (shipment.charge_status !== "failed") {
      return false;
    }

    return (
      shipment.box_id === box.id ||
      shipment.latest_box_id === box.id ||
      shipment.box_ids?.includes?.(box.id) ||
      shipment.shipment_boxes?.some?.((shipmentBox) => shipmentBox.box_id === box.id)
    );
  });
}

`;

if (!text.includes('function hasFailedShipment(box, shipments)')) {
  if (!text.includes(helperAnchor)) {
    throw new Error('Could not find helper insertion point. File may have changed; no edits made.');
  }
  text = text.replace(helperAnchor, helper + helperAnchor);
}

fs.writeFileSync(filePath, text);
console.log('Patched Customer Dashboard final-shipping payment alert filter.');
