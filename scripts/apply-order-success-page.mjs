import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appPath = path.join(root, "src", "App.jsx");
const pageSource = path.join(root, "src", "pages", "CheckoutSuccess.jsx");

if (!fs.existsSync(appPath)) {
  console.error("Could not find src/App.jsx. Run this from your StorkBin project root.");
  process.exit(1);
}

if (!fs.existsSync(pageSource)) {
  console.error("Could not find src/pages/CheckoutSuccess.jsx. Extract the zip into your StorkBin root first.");
  process.exit(1);
}

let app = fs.readFileSync(appPath, "utf8");

if (!app.includes('from "./pages/CheckoutSuccess"') && !app.includes("from './pages/CheckoutSuccess'")) {
  const importAnchor = 'import AdminBoxDetailPage from "./pages/AdminBoxDetailPage";';
  if (app.includes(importAnchor)) {
    app = app.replace(importAnchor, `${importAnchor}\nimport CheckoutSuccess from "./pages/CheckoutSuccess";`);
  } else {
    const lastImportMatch = [...app.matchAll(/^import .*;$/gm)].pop();
    if (!lastImportMatch) {
      console.error("Could not find import section in src/App.jsx.");
      process.exit(1);
    }
    const insertAt = lastImportMatch.index + lastImportMatch[0].length;
    app = `${app.slice(0, insertAt)}\nimport CheckoutSuccess from "./pages/CheckoutSuccess";${app.slice(insertAt)}`;
  }
}

const successUrlPatterns = [
  /successUrl:\s*`\$\{window\.location\.origin\}\/account\?checkout=success`,/g,
  /successUrl:\s*`\$\{window\.location\.origin\}\/account`,/g,
  /successUrl:\s*`\$\{window\.location\.origin\}\/?`,/g,
  /successUrl:\s*"http:\/\/localhost:5173\/account\?checkout=success",/g,
  /successUrl:\s*"http:\/\/localhost:5173\/account",/g,
];

for (const pattern of successUrlPatterns) {
  app = app.replace(pattern, 'successUrl: `${window.location.origin}/checkout-success`,');
}

if (!app.includes('path="/checkout-success"')) {
  const routeAnchor = '<Route path="/account" element={<AccountPage appData={appData} />} />';
  if (app.includes(routeAnchor)) {
    app = app.replace(routeAnchor, `${routeAnchor}\n            <Route path="/checkout-success" element={<CheckoutSuccess />} />`);
  } else {
    const fallbackRoute = '<Route path="*" element={<Navigate to="/" replace />} />';
    if (!app.includes(fallbackRoute)) {
      console.error("Could not find a safe place to add the /checkout-success route.");
      process.exit(1);
    }
    app = app.replace(fallbackRoute, `<Route path="/checkout-success" element={<CheckoutSuccess />} />\n            ${fallbackRoute}`);
  }
}

fs.writeFileSync(appPath, app);
console.log("Order success page patch applied.");
console.log("Next: restart npm run dev and run a fresh checkout.");
