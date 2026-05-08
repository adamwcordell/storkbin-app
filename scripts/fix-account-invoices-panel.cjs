const fs = require("fs");
const path = require("path");

const accountPath = path.join(process.cwd(), "src", "pages", "AccountPage.jsx");
const panelPath = path.join(process.cwd(), "src", "components", "BillingHistoryPanel.jsx");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(accountPath)) {
  fail("Could not find src/pages/AccountPage.jsx. Run this from the StorkBin project root.");
}

if (!fs.existsSync(panelPath)) {
  fail("Could not find src/components/BillingHistoryPanel.jsx. The component must exist before wiring it into AccountPage.");
}

let account = fs.readFileSync(accountPath, "utf8");
const originalAccount = account;

// Keep this surgical: AccountPage already imports BillingHistoryPanel in your current project,
// but this makes the script safe if the import was removed later.
if (!/import\s+BillingHistoryPanel\s+from\s+["']\.\.\/components\/BillingHistoryPanel["'];/.test(account)) {
  const importMatches = [...account.matchAll(/^import .*?;\s*$/gm)];
  const lastImport = importMatches[importMatches.length - 1];
  if (!lastImport) fail("No import lines found in AccountPage.jsx.");
  const insertAt = lastImport.index + lastImport[0].length;
  account = `${account.slice(0, insertAt)}\nimport BillingHistoryPanel from "../components/BillingHistoryPanel";${account.slice(insertAt)}`;
}

const desiredPanel = '<BillingHistoryPanel user={appData.user} />';

// If a previous patch inserted the panel without the user prop, fix that too.
account = account.replace(/<BillingHistoryPanel\s*\/>/g, desiredPanel);

const oldBlock = `              <div style={settingsRowStyle}>
              <div>
                <strong>Invoices</strong>
                <div style={invoiceMetaStyle}>
                  Receipts and invoice history will appear here once Stripe is connected.
                </div>
              </div>

              <span style={mutedPillStyle}>Coming soon</span>
            </div>`;

// More tolerant replacement for the exact current JSX shape in AccountPage.
const currentInvoiceBlockRegex = /\n\s*<div\s+style=\{settingsRowStyle\}>\s*\n\s*<div>\s*\n\s*<strong>Invoices<\/strong>\s*\n\s*<div\s+style=\{invoiceMetaStyle\}>\s*\n\s*Receipts and invoice history will appear here once Stripe is connected\.\s*\n\s*<\/div>\s*\n\s*<\/div>\s*\n\s*<span\s+style=\{mutedPillStyle\}>Coming soon<\/span>\s*\n\s*<\/div>/m;

if (account.includes("Receipts and invoice history will appear here once Stripe is connected.") || account.includes("Coming soon")) {
  if (!currentInvoiceBlockRegex.test(account)) {
    fail("Found invoice coming-soon text, but the JSX block shape was not recognized. No changes made.");
  }
  account = account.replace(currentInvoiceBlockRegex, `\n            ${desiredPanel}`);
}

if (!account.includes(desiredPanel)) {
  fail("BillingHistoryPanel was not inserted. No changes made.");
}

if (account.includes("Receipts and invoice history will appear here once Stripe is connected.") || account.includes("Coming soon")) {
  fail("Old invoice coming-soon text is still present after replacement. No changes made.");
}

if (account === originalAccount) {
  console.log("No AccountPage changes needed. BillingHistoryPanel is already wired with user={appData.user}.");
} else {
  const backupPath = `${accountPath}.before-invoice-panel-wire`;
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, originalAccount, "utf8");
  }
  fs.writeFileSync(accountPath, account, "utf8");
  console.log("Updated src/pages/AccountPage.jsx: replaced the Invoices Coming Soon card with BillingHistoryPanel and passed appData.user.");
}
