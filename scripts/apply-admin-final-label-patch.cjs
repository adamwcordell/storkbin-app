const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'src', 'pages', 'AdminDashboardPage.jsx');

if (!fs.existsSync(target)) {
  console.error(`Could not find ${target}. Run this from the StorkBin project root.`);
  process.exit(1);
}

let source = fs.readFileSync(target, 'utf8');

const oldBlock = `  const rawRows = adminRows.length > 0 ? adminRows : fallbackRows;`;

const newBlock = `  const isLabelNeededShipmentRow = (row) =>
    row.latest_shipment_id &&
    row.latest_charge_status === "paid" &&
    row.latest_shipping_status === "paid" &&
    (row.latest_label_status === "needed" ||
      row.latest_label_status === "label_needed" ||
      !row.latest_label_status);

  const rawRows = useMemo(() => {
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

if (!source.includes(oldBlock)) {
  if (source.includes('const isLabelNeededShipmentRow = (row) =>')) {
    console.log('Admin final label patch already appears to be applied.');
    process.exit(0);
  }

  console.error('Could not find the expected rawRows line in AdminDashboardPage.jsx. No changes made.');
  process.exit(1);
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(target, source);
console.log('Patched AdminDashboardPage.jsx to keep paid final-return shipments in the Needs Label queue even when admin_ops_bins omits terminated boxes.');
