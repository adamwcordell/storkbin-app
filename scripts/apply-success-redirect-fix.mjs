import fs from "fs";
import path from "path";

const appPath = path.join(process.cwd(), "src", "App.jsx");
const pagePath = path.join(process.cwd(), "src", "pages", "CheckoutSuccess.jsx");
const patchPagePath = path.join(process.cwd(), "src", "pages", "CheckoutSuccess.jsx");

if (!fs.existsSync(appPath)) {
  console.error("Could not find src/App.jsx. Run this from the StorkBin project root.");
  process.exit(1);
}

let app = fs.readFileSync(appPath, "utf8");

if (!app.includes('import CheckoutSuccess from "./pages/CheckoutSuccess";')) {
  const anchor = 'import AdminBoxDetailPage from "./pages/AdminBoxDetailPage";';
  if (!app.includes(anchor)) {
    console.error("Could not find App.jsx import anchor. No changes made.");
    process.exit(1);
  }
  app = app.replace(anchor, `${anchor}\nimport CheckoutSuccess from "./pages/CheckoutSuccess";`);
}

app = app.replaceAll(
  'successUrl: `${window.location.origin}/account?checkout=success`,',
  'successUrl: `${window.location.origin}/checkout-success`,'
);
app = app.replaceAll(
  'successUrl: `${window.location.origin}/account`,',
  'successUrl: `${window.location.origin}/checkout-success`,'
);

if (!app.includes('path="/checkout-success"')) {
  const routeAnchor = '<Route path="/account" element={<AccountPage appData={appData} />} />';
  if (!app.includes(routeAnchor)) {
    console.error("Could not find routes anchor. No changes made.");
    process.exit(1);
  }
  app = app.replace(
    routeAnchor,
    `${routeAnchor}\n            <Route path="/checkout-success" element={<CheckoutSuccess />} />`
  );
}

fs.mkdirSync(path.dirname(pagePath), { recursive: true });
fs.writeFileSync(appPath, app);
console.log("Success redirect patch applied: App.jsx now uses /checkout-success and route is installed.");
