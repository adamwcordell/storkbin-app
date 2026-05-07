const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src', 'pages', 'AdminDashboardPage.jsx');
let source = fs.readFileSync(filePath, 'utf8');

const oldBlock = `  const getExpectedBoxStateForShipment = (row) => {
    if (!row.latest_shipment_id) return null;

    if (row.latest_shipping_status === "label_created") {
      return {
        status: null,
        fulfillment_status: "label_created",
        label: "Label created",
      };
    }

    if (row.latest_shipping_status === "in_transit") {
      if (row.latest_shipment_direction === "to_customer") {
        return {
          status: "in_transit_to_customer",
          fulfillment_status: "shipped_to_customer",
          label: "In transit to customer",
        };
      }

      if (row.latest_shipment_direction === "to_storage") {
        return {
          status: "in_transit_to_storage",
          fulfillment_status: "awaiting_storage_arrival",
          label: "In transit to storage",
        };
      }
    }

    if (row.latest_shipping_status === "delivered") {
      if (row.latest_shipment_direction === "to_customer") {
        return {
          status: "at_customer",
          fulfillment_status: "bin_with_customer",
          label: "Delivered to customer",
        };
      }

      if (row.latest_shipment_direction === "to_storage") {
        return {
          status: "stored",
          fulfillment_status: "stored",
          label: "Received into storage",
        };
      }
    }

    return null;
  };
`;

const newBlock = `  const isFinalReturnToCustomerRow = (row) =>
    row.latest_shipment_direction === "to_customer" &&
    (row.cancel_status === "approved" ||
      row.cancel_status === "completed" ||
      row.subscription_status === "terminated" ||
      row.subscription_lifecycle_status === "terminated" ||
      row.lifecycle_status === "terminated");

  const getExpectedBoxStateForShipment = (row) => {
    if (!row.latest_shipment_id) return null;

    // Final return shipments are different from starter outbound shipments.
    // A canceled/terminated stored bin can be shipped back to the customer without
    // becoming an active at_customer/bin_with_customer subscription again.
    if (isFinalReturnToCustomerRow(row)) return null;

    if (row.latest_shipping_status === "label_created") {
      return {
        status: null,
        fulfillment_status: "label_created",
        label: "Label created",
      };
    }

    if (row.latest_shipping_status === "in_transit") {
      if (row.latest_shipment_direction === "to_customer") {
        return {
          status: "in_transit_to_customer",
          fulfillment_status: "shipped_to_customer",
          label: "In transit to customer",
        };
      }

      if (row.latest_shipment_direction === "to_storage") {
        return {
          status: "in_transit_to_storage",
          fulfillment_status: "awaiting_storage_arrival",
          label: "In transit to storage",
        };
      }
    }

    if (row.latest_shipping_status === "delivered") {
      if (row.latest_shipment_direction === "to_customer") {
        return {
          status: "at_customer",
          fulfillment_status: "bin_with_customer",
          label: "Delivered to customer",
        };
      }

      if (row.latest_shipment_direction === "to_storage") {
        return {
          status: "stored",
          fulfillment_status: "stored",
          label: "Received into storage",
        };
      }
    }

    return null;
  };
`;

if (!source.includes(oldBlock)) {
  console.error('Could not find the expected getExpectedBoxStateForShipment block. No files changed.');
  process.exit(1);
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(filePath, source);
console.log('Patched AdminDashboardPage.jsx final-return shipment mismatch logic.');
