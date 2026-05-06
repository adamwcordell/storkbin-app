const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src', 'pages', 'AdminDashboardPage.jsx');

if (!fs.existsSync(filePath)) {
  console.error(`Could not find ${filePath}`);
  process.exit(1);
}

let source = fs.readFileSync(filePath, 'utf8');

const oldBlock = `  const rawRows = useMemo(() => {
    if (adminRows.length === 0) return fallbackRows;

    const existingAdminRowKeys = new Set(
      adminRows.map((row) => String(row.box_id || row.id))
    );

    const missingLabelRows = fallbackRows.filter((row) => {
      const rowKey = String(row.box_id || row.id);
      return isLabelNeededShipmentRow(row) && !existingAdminRowKeys.has(rowKey);
    });

    return [...adminRows, ...missingLabelRows];
  }, [adminRows, fallbackRows]);`;

const newBlock = `  const rawRows = useMemo(() => {
    if (adminRows.length === 0) return fallbackRows;

    const fallbackByBoxId = new Map(
      fallbackRows.map((row) => [String(row.box_id || row.id), row])
    );

    const mergedAdminRows = adminRows.map((adminRow) => {
      const rowKey = String(adminRow.box_id || adminRow.id);
      const fallbackRow = fallbackByBoxId.get(rowKey);

      if (!fallbackRow || !isLabelNeededShipmentRow(fallbackRow)) {
        return adminRow;
      }

      // Keep the authoritative admin row, but overlay the live shipment fields from appData
      // when the fallback row is a paid shipment that still needs a label. This prevents
      // final-return shipments for terminated subscriptions from flashing and disappearing
      // when the admin_ops_bins view is stale or omits the latest shipment fields.
      return {
        ...adminRow,
        latest_shipment_id: fallbackRow.latest_shipment_id,
        latest_shipment_direction: fallbackRow.latest_shipment_direction,
        latest_shipping_status: fallbackRow.latest_shipping_status,
        latest_charge_status: fallbackRow.latest_charge_status,
        latest_label_status: fallbackRow.latest_label_status,
        latest_tracking_number: fallbackRow.latest_tracking_number,
        latest_tracking_url: fallbackRow.latest_tracking_url,
        latest_label_url: fallbackRow.latest_label_url,
        latest_shipping_cost: fallbackRow.latest_shipping_cost,
        fulfillment_status: fallbackRow.fulfillment_status || adminRow.fulfillment_status,
      };
    });

    const existingAdminRowKeys = new Set(
      mergedAdminRows.map((row) => String(row.box_id || row.id))
    );

    const missingLabelRows = fallbackRows.filter((row) => {
      const rowKey = String(row.box_id || row.id);
      return isLabelNeededShipmentRow(row) && !existingAdminRowKeys.has(rowKey);
    });

    return [...mergedAdminRows, ...missingLabelRows];
  }, [adminRows, fallbackRows]);`;

if (!source.includes(oldBlock)) {
  console.error('Could not find the expected rawRows block. No changes made.');
  process.exit(1);
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(filePath, source, 'utf8');
console.log('Patched src/pages/AdminDashboardPage.jsx final-label merge behavior.');
