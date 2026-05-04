import fs from "fs";
import path from "path";

const appPath = path.join(process.cwd(), "src", "App.jsx");

if (!fs.existsSync(appPath)) {
  console.error("Could not find src/App.jsx. Run this from your StorkBin project root.");
  process.exit(1);
}

let app = fs.readFileSync(appPath, "utf8");

const usesConstant = app.includes("MINIMUM_TERM_MONTHS");
const hasDefinition =
  /const\s+MINIMUM_TERM_MONTHS\s*=/.test(app) ||
  /let\s+MINIMUM_TERM_MONTHS\s*=/.test(app) ||
  /var\s+MINIMUM_TERM_MONTHS\s*=/.test(app);

if (!usesConstant) {
  console.log("No MINIMUM_TERM_MONTHS reference found. Nothing to patch.");
  process.exit(0);
}

if (hasDefinition) {
  console.log("MINIMUM_TERM_MONTHS is already defined. Nothing to patch.");
  process.exit(0);
}

const importBlockMatch = app.match(/^(import[\s\S]*?;\s*)+/);

if (importBlockMatch) {
  const insertAt = importBlockMatch[0].length;
  app = app.slice(0, insertAt) + "\nconst MINIMUM_TERM_MONTHS = 6;\n" + app.slice(insertAt);
} else {
  app = "const MINIMUM_TERM_MONTHS = 6;\n" + app;
}

fs.writeFileSync(appPath, app);
console.log("Patched src/App.jsx: added const MINIMUM_TERM_MONTHS = 6;");
