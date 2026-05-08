const fs = require("fs");

const path = "src/components/BillingHistoryPanel.jsx";

if (!fs.existsSync(path)) {
  console.error("BillingHistoryPanel.jsx not found.");
  process.exit(1);
}

let text = fs.readFileSync(path, "utf8");

// backup
fs.writeFileSync(path + ".font-backup", text);

// normalize button font inheritance
text = text.replace(
  /fontFamily:\s*"[^"]*"/g,
  'fontFamily: "inherit"'
);

// add inherit if missing on common button styles
text = text.replace(
  /cursor:\s*"pointer",/g,
  'cursor: "pointer",\n                  fontFamily: "inherit",'
);

fs.writeFileSync(path, text);

console.log("Billing modal button fonts patched to inherit app typography.");