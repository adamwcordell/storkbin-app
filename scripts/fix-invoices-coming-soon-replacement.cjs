const fs = require("fs");
const path = require("path");

const accountFile = path.join("src", "pages", "AccountPage.jsx");
const componentSource = path.join("StorkBin", "src", "components", "BillingHistoryPanel.jsx");
const functionSource = path.join("StorkBin", "supabase", "functions", "get-customer-invoices", "index.ts");

function read(file) { return fs.readFileSync(file, "utf8"); }
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
function copyFromPatch(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Missing patch source file: ${source}`);
  write(destination, read(source));
}

if (!fs.existsSync(accountFile)) throw new Error("Run this from the StorkBin project root. Could not find src/pages/AccountPage.jsx");

copyFromPatch(componentSource, path.join("src", "components", "BillingHistoryPanel.jsx"));
copyFromPatch(functionSource, path.join("supabase", "functions", "get-customer-invoices", "index.ts"));

let content = read(accountFile);

if (!content.includes('BillingHistoryPanel from "../components/BillingHistoryPanel"')) {
  const importMarker = 'import CancelSubscriptionPanel from "../components/CancelSubscriptionPanel";';
  if (content.includes(importMarker)) {
    content = content.replace(importMarker, `${importMarker}\nimport BillingHistoryPanel from "../components/BillingHistoryPanel";`);
  } else {
    content = content.replace(/(import[^\n]+;\n)(?!import)/, `$1import BillingHistoryPanel from "../components/BillingHistoryPanel";\n`);
  }
}

const exactBlock = `            <div style={settingsRowStyle}>
              <div>
                <strong>Invoices</strong>
                <div style={invoiceMetaStyle}>
                  Receipts and invoice history will appear here once Stripe is connected.
                </div>
              </div>

              <span style={mutedPillStyle}>Coming soon</span>
            </div>`;

const flexibleBlock = /\s*<div style=\{settingsRowStyle\}>\s*<div>\s*<strong>Invoices<\/strong>\s*<div style=\{invoiceMetaStyle\}>[\s\S]*?Receipts and invoice history will appear here once Stripe is connected\.[\s\S]*?<\/div>\s*<\/div>\s*<span style=\{mutedPillStyle\}>Coming soon<\/span>\s*<\/div>/m;

if (content.includes("<BillingHistoryPanel user={appData.user} />")) {
  console.log("AccountPage already renders BillingHistoryPanel.");
} else if (content.includes(exactBlock)) {
  content = content.replace(exactBlock, "            <BillingHistoryPanel user={appData.user} />");
  console.log("Replaced exact Invoices coming soon block.");
} else if (flexibleBlock.test(content)) {
  content = content.replace(flexibleBlock, "\n            <BillingHistoryPanel user={appData.user} />");
  console.log("Replaced flexible Invoices coming soon block.");
} else {
  const nearby = content.match(/<strong>Invoices<\/strong>[\s\S]{0,600}/);
  throw new Error(`Could not replace the Invoices coming soon block. Nearby text:\n${nearby ? nearby[0] : "<not found>"}`);
}

write(accountFile, content);
console.log("Invoice panel replacement complete.");
console.log("Deploy with: supabase functions deploy get-customer-invoices --no-verify-jwt");
