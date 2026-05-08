const fs = require("fs");

const target = "src/components/BillingHistoryPanel.jsx";

if (!fs.existsSync(target)) {
  console.error(`Could not find ${target}. Run this from the StorkBin project root.`);
  process.exit(1);
}

let text = fs.readFileSync(target, "utf8");
const original = text;
const backup = `${target}.button-font-backup-${Date.now()}`;
fs.writeFileSync(backup, original);

const appFont = `"'Inter', system-ui, -apple-system, sans-serif"`;

function replaceConstObject(name, body) {
  const pattern = new RegExp(`const\\s+${name}\\s*=\\s*\\{[\\s\\S]*?\\};`, "m");
  if (!pattern.test(text)) return false;
  text = text.replace(pattern, `const ${name} = {\n${body}\n};`);
  return true;
}

const secondaryButtonBody = `  backgroundColor: "#E5E5E5",
  color: "#333333",
  border: "none",
  padding: "10px 14px",
  borderRadius: "8px",
  cursor: "pointer",
  fontFamily: ${appFont},
  fontSize: "13px",
  fontWeight: 500,
  lineHeight: 1.2,
  textDecoration: "none",
  whiteSpace: "nowrap",`;

const pillBody = `  backgroundColor: "#E5E5E5",
  color: "#333333",
  border: "none",
  padding: "10px 14px",
  borderRadius: "8px",
  cursor: "pointer",
  fontFamily: ${appFont},
  fontSize: "13px",
  fontWeight: 500,
  lineHeight: 1.2,
  whiteSpace: "nowrap",`;

const replaced = [];
[
  "pillStyle",
  "smallButtonStyle",
  "linkStyle",
  "viewButtonStyle",
  "refreshButtonStyle",
  "closeButtonStyle",
  "modalCloseButtonStyle",
  "invoiceButtonStyle",
  "invoiceActionButtonStyle",
  "secondaryButtonStyle",
  "actionButtonStyle",
].forEach((name) => {
  if (replaceConstObject(name, name === "pillStyle" ? pillBody : secondaryButtonBody)) {
    replaced.push(name);
  }
});

// Make any remaining button style objects use the app font instead of the browser default.
text = text.replace(/font:\s*"inherit",/g, `fontFamily: ${appFont},`);
text = text.replace(/fontFamily:\s*"inherit",/g, `fontFamily: ${appFont},`);

// If there are inline View invoices/Refresh/Close buttons with ad-hoc style objects,
// this keeps the button text consistent without changing lifecycle or invoice logic.
text = text.replace(
  /(<button\b[^>]*style=\{\{)([\s\S]*?)(\}\}[^>]*>\s*(?:View invoices|Refresh|Close|Done|Open invoices|Hide invoices))/g,
  (match, start, middle, end) => {
    let patched = middle;
    if (!/fontFamily\s*:/.test(patched)) {
      patched += `\n            fontFamily: ${appFont},`;
    }
    if (!/fontSize\s*:/.test(patched)) {
      patched += `\n            fontSize: "13px",`;
    }
    if (!/fontWeight\s*:/.test(patched)) {
      patched += `\n            fontWeight: 500,`;
    }
    if (!/color\s*:/.test(patched)) {
      patched += `\n            color: "#333333",`;
    }
    return `${start}${patched}${end}`;
  }
);

if (text === original) {
  console.error("No matching BillingHistoryPanel button styles were found to patch.");
  process.exit(1);
}

fs.writeFileSync(target, text);

console.log("BillingHistoryPanel button typography patched.");
console.log(`Backup created: ${backup}`);
if (replaced.length) {
  console.log(`Updated style constants: ${replaced.join(", ")}`);
}
