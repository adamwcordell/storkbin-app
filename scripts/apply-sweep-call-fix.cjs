const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src', 'pages', 'AdminDashboardPage.jsx');

if (!fs.existsSync(filePath)) {
  console.error(`Could not find ${filePath}`);
  process.exit(1);
}

let source = fs.readFileSync(filePath, 'utf8');

if (source.includes('await sweepFinalShipments();')) {
  console.log('Already patched: loadAdminRows already calls sweepFinalShipments().');
  process.exit(0);
}

const marker = '    setAdminRowsError("");';
if (!source.includes(marker)) {
  console.error('Patch failed: expected setAdminRowsError("") marker was not found.');
  process.exit(1);
}

source = source.replace(
  marker,
  `${marker}\n\n    await sweepFinalShipments();`
);

fs.writeFileSync(filePath, source);
console.log('Patched AdminDashboardPage.jsx: loadAdminRows now calls sweepFinalShipments().');
