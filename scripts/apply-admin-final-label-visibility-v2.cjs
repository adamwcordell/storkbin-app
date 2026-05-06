const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src', 'pages', 'AdminDashboardPage.jsx');

if (!fs.existsSync(filePath)) {
  console.error(`Could not find ${filePath}. Run this from your StorkBin project root.`);
  process.exit(1);
}

let source = fs.readFileSync(filePath, 'utf8');
const original = source;

// 1) Ensure helper exists after rawRows block or before rows useMemo.
const helperName = 'isFinalReturnNeedingLabel';
const helperCode = `\n  const ${helperName} = (row) =>\n    row?.latest_shipment_id &&\n    row?.latest_charge_status === "paid" &&\n    row?.latest_shipping_status === "paid" &&\n    (row?.latest_label_status === "needed" ||\n      row?.latest_label_status === "label_needed" ||\n      !row?.latest_label_status);\n`;

if (!source.includes(`const ${helperName} =`)) {
  const rowsMarker = '  const rows = useMemo(() => {';
  if (!source.includes(rowsMarker)) {
    console.error('Could not find rows useMemo marker in AdminDashboardPage.jsx. No changes made.');
    process.exit(1);
  }
  source = source.replace(rowsMarker, `${helperCode}\n${rowsMarker}`);
}

// 2) Remove lifecycle termination from existing filters by making label-needed final shipments always match.
// Patch common matchesStatus shape by adding an early return inside row filters.
const filterMarker = 'return baseRows.filter((row) => {';
if (source.includes(filterMarker) && !source.includes('ADMIN_FINAL_LABEL_VISIBILITY_V2')) {
  source = source.replace(
    filterMarker,
    `${filterMarker}\n      // ADMIN_FINAL_LABEL_VISIBILITY_V2: final-return shipments still need labels even after subscription termination.\n      if (${helperName}(row)) return true;`
  );
}

// 3) If the file uses rawRows.filter directly instead of baseRows.filter, patch those too.
const rawFilterMarker = 'return rawRows.filter((row) => {';
if (source.includes(rawFilterMarker) && !source.includes('ADMIN_FINAL_LABEL_VISIBILITY_V2_RAW')) {
  source = source.replace(
    rawFilterMarker,
    `${rawFilterMarker}\n      // ADMIN_FINAL_LABEL_VISIBILITY_V2_RAW: final-return shipments still need labels even after subscription termination.\n      if (${helperName}(row)) return true;`
  );
}

// 4) Make canGenerateLabel explicitly allow terminated final-return shipment rows.
const canGenerateLabelRegex = /const canGenerateLabel = \(row\) =>\s*row\.lifecycle_status !== "auction" &&\s*row\.lifecycle_status !== "removed_from_system" &&\s*row\.latest_shipment_id &&\s*row\.latest_charge_status === "paid" &&\s*\(row\.latest_label_status === "needed" \|\|\s*row\.latest_label_status === "label_needed" \|\|\s*!row\.latest_label_status\) &&\s*row\.latest_shipping_status === "paid";/m;

if (canGenerateLabelRegex.test(source)) {
  source = source.replace(canGenerateLabelRegex, `const canGenerateLabel = (row) =>
    isFinalReturnNeedingLabel(row) &&
    row.lifecycle_status !== "auction" &&
    row.lifecycle_status !== "removed_from_system";`);
}

// 5) As a fallback, if rows useMemo still has a terminal filter pattern, broaden the status checks.
source = source.replace(/row\.subscription_status !== "terminated"/g, '(row.subscription_status !== "terminated" || isFinalReturnNeedingLabel(row))');
source = source.replace(/row\.subscription_lifecycle_status !== "terminated"/g, '(row.subscription_lifecycle_status !== "terminated" || isFinalReturnNeedingLabel(row))');
source = source.replace(/row\.lifecycle_status !== "terminated"/g, '(row.lifecycle_status !== "terminated" || isFinalReturnNeedingLabel(row))');

if (source === original) {
  console.log('No changes were needed; AdminDashboardPage.jsx already appears patched.');
  process.exit(0);
}

fs.writeFileSync(filePath, source, 'utf8');
console.log('Patched src/pages/AdminDashboardPage.jsx for final-return label visibility.');
console.log('Next: run npm run dev and refresh the admin dashboard.');
