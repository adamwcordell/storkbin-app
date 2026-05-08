const fs = require('fs');
const path = require('path');

const accountPath = path.join(process.cwd(), 'src', 'pages', 'AccountPage.jsx');

if (!fs.existsSync(accountPath)) {
  console.error('Could not find src/pages/AccountPage.jsx. Run this from the StorkBin project root.');
  process.exit(1);
}

let source = fs.readFileSync(accountPath, 'utf8');
let changed = false;

// 1) Add BillingHistoryPanel import if missing.
if (!source.includes('BillingHistoryPanel')) {
  const importLine = 'import BillingHistoryPanel from "../components/BillingHistoryPanel";\n';

  // Prefer inserting after the last existing import line.
  const importMatches = [...source.matchAll(/^import .*?;\s*$/gm)];
  if (importMatches.length === 0) {
    console.error('No import lines found in AccountPage.jsx. No changes made.');
    process.exit(1);
  }

  const lastImport = importMatches[importMatches.length - 1];
  const insertAt = lastImport.index + lastImport[0].length;
  source = source.slice(0, insertAt) + '\n' + importLine + source.slice(insertAt);
  changed = true;
} else if (!source.includes('import BillingHistoryPanel from')) {
  // The component may be referenced but not imported. Add the import safely.
  const importLine = 'import BillingHistoryPanel from "../components/BillingHistoryPanel";\n';
  const importMatches = [...source.matchAll(/^import .*?;\s*$/gm)];
  const lastImport = importMatches[importMatches.length - 1];
  if (!lastImport) {
    console.error('No import lines found in AccountPage.jsx. No changes made.');
    process.exit(1);
  }
  const insertAt = lastImport.index + lastImport[0].length;
  source = source.slice(0, insertAt) + '\n' + importLine + source.slice(insertAt);
  changed = true;
}

// 2) Replace the exact old Invoices / Coming soon summary card.
const oldBlockRegex = /\n\s*<div\s+style=\{summaryCardStyle\}>\s*\n\s*<div>\s*\n\s*<strong>Invoices<\/strong>\s*\n\s*<p\s+style=\{hintStyle\}>\s*\n\s*Receipts and invoice history will appear here once Stripe is connected\.\s*\n\s*<\/p>\s*\n\s*<\/div>\s*\n\s*<span\s+style=\{mutedPillStyle\}>Coming soon<\/span>\s*\n\s*<\/div>/m;

if (oldBlockRegex.test(source)) {
  source = source.replace(oldBlockRegex, '\n              <BillingHistoryPanel />');
  changed = true;
} else if (source.includes('Receipts and invoice history will appear here once Stripe is connected.')) {
  console.error('Found the invoice coming-soon text, but the surrounding block is not in the expected shape.');
  console.error('No automatic replacement made for AccountPage.jsx.');
  process.exit(1);
} else if (source.includes('<BillingHistoryPanel />')) {
  console.log('BillingHistoryPanel already appears to be installed in AccountPage.jsx.');
} else {
  console.error('Could not find the old Invoices / Coming soon block and BillingHistoryPanel is not installed.');
  process.exit(1);
}

if (changed) {
  fs.writeFileSync(accountPath, source, 'utf8');
  console.log('Updated src/pages/AccountPage.jsx: installed BillingHistoryPanel in place of Invoices coming-soon card.');
} else {
  console.log('No changes needed.');
}
