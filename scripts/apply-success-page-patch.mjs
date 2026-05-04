import fs from "fs";
import path from "path";

const appPath = path.join(process.cwd(), "src", "App.jsx");

if (!fs.existsSync(appPath)) {
  console.error("Could not find src/App.jsx. Run this from your StorkBin project root.");
  process.exit(1);
}

let app = fs.readFileSync(appPath, "utf8");
let changed = false;

if (!app.includes('import CheckoutSuccess from "./pages/CheckoutSuccess";') && !app.includes("import CheckoutSuccess from './pages/CheckoutSuccess';")) {
  const marker = 'import AdminBoxDetailPage from "./pages/AdminBoxDetailPage";';
  if (!app.includes(marker)) {
    console.error("Could not find the expected import marker in App.jsx. No changes made.");
    process.exit(1);
  }
  app = app.replace(marker, `${marker}\nimport CheckoutSuccess from "./pages/CheckoutSuccess";`);
  changed = true;
}

if (!app.includes('path="/checkout-success"')) {
  const routeMarker = '<Route path="/cart" element={<CartPage appData={appData} />} />';
  if (!app.includes(routeMarker)) {
    console.error("Could not find the expected cart route in App.jsx. No changes made.");
    process.exit(1);
  }
  app = app.replace(routeMarker, `${routeMarker}\n            <Route path="/checkout-success" element={<CheckoutSuccess appData={appData} />} />`);
  changed = true;
}

if (changed) {
  fs.writeFileSync(appPath, app);
  console.log("Success page route added to src/App.jsx.");
} else {
  console.log("Success page route was already present. No App.jsx changes needed.");
}
