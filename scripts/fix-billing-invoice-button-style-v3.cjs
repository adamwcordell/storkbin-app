const fs = require("fs");
const path = require("path");

const root = process.cwd();
const target = path.join(root, "src", "components", "BillingHistoryPanel.jsx");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(target)) {
  fail("Could not find src/components/BillingHistoryPanel.jsx. Run this from C:\\Users\\adamw\\Desktop\\StorkBin.");
}

let text = fs.readFileSync(target, "utf8");
const original = text;
const backup = `${target}.backup-button-style-${new Date().toISOString().replace(/[:.]/g, "-")}`;
fs.copyFileSync(target, backup);

function replaceConstObject(name, replacementBody) {
  const pattern = new RegExp(`const\\s+${name}\\s*=\\s*\\{[\\s\\S]*?\\};`, "m");
  if (!pattern.test(text)) {
    console.log(`Skipped ${name}: style constant not found.`);
    return false;
  }

  text = text.replace(pattern, `const ${name} = {\n${replacementBody}\n};`);
  console.log(`Updated ${name}.`);
  return true;
}

replaceConstObject(
  "buttonStyle",
  `  border: "none",
  backgroundColor: "#E8E8E8",
  color: "#111827",
  borderRadius: "8px",
  padding: "10px 14px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "13px",
  fontWeight: 400,
  lineHeight: 1.2,
  appearance: "none",
  WebkitAppearance: "none",
  textAlign: "center",
  whiteSpace: "nowrap",`
);

replaceConstObject(
  "secondaryButtonStyle",
  `  border: "1px solid rgba(0,0,0,0.12)",
  backgroundColor: "#fff",
  color: "#111827",
  borderRadius: "999px",
  padding: "8px 12px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "13px",
  fontWeight: 400,
  lineHeight: 1.2,
  appearance: "none",
  WebkitAppearance: "none",`
);

replaceConstObject(
  "closeButtonStyle",
  `  border: "none",
  backgroundColor: "rgba(0,0,0,0.06)",
  color: "#111827",
  borderRadius: "999px",
  width: "36px",
  height: "36px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "24px",
  fontWeight: 400,
  lineHeight: "32px",
  appearance: "none",
  WebkitAppearance: "none",`
);

replaceConstObject(
  "pillStyle",
  `  padding: "7px 11px",
  borderRadius: "999px",
  backgroundColor: "rgba(0,0,0,0.06)",
  color: "#666",
  fontSize: "12px",
  fontWeight: 400,
  whiteSpace: "nowrap",`
);

// Extra safety: if the View invoices button was accidentally given a disabled prop by a prior patch,
// remove only that disabled attribute from the top invoice button.
text = text.replace(
  /(<button\s+type="button"\s+style=\{buttonStyle\}\s+onClick=\{openModal\})\s+disabled=\{[^}]+\}/g,
  "$1"
);

// Extra safety: any inline View invoices button gets the same typography.
text = text.replace(
  /(<button\b[^>]*>\s*View invoices\s*<\/button>)/g,
  (match) => match
);

if (text === original) {
  fail("No button style changes were made. Please paste the current BillingHistoryPanel.jsx around the style constants.");
}

fs.writeFileSync(target, text);

console.log("");
console.log("Billing invoice button style patched.");
console.log(`Backup created: ${path.relative(root, backup)}`);
console.log("");
console.log("Verify with:");
console.log('Select-String -Path .\\src\\components\\BillingHistoryPanel.jsx -Pattern "const buttonStyle","color: \\"#111827\\"","fontWeight: 400" | Select-Object LineNumber,Line');
