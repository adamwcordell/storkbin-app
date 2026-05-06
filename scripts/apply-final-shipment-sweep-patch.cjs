const fs = require('fs');
const path = require('path');

const adminPath = path.join(process.cwd(), 'src', 'pages', 'AdminDashboardPage.jsx');
if (!fs.existsSync(adminPath)) {
  console.error('Could not find src/pages/AdminDashboardPage.jsx. Run this from your StorkBin project root.');
  process.exit(1);
}

let source = fs.readFileSync(adminPath, 'utf8');
const original = source;

const target = `  const loadAdminRows = async () => {
    if (!appData.isAdmin) return;

    setLoadingAdminRows(true);
    setAdminRowsError("");
`;

const replacement = `  const sweepFinalShipments = async () => {
    try {
      const { error } = await supabase.functions.invoke("sweep-final-shipments", {
        body: {},
      });

      if (error) {
        console.warn("Final shipment sweep failed:", error.message || error);
      }
    } catch (error) {
      console.warn("Final shipment sweep failed:", error?.message || error);
    }
  };

  const loadAdminRows = async () => {
    if (!appData.isAdmin) return;

    setLoadingAdminRows(true);
    setAdminRowsError("");

    await sweepFinalShipments();
`;

if (source.includes('const sweepFinalShipments = async () =>')) {
  console.log('AdminDashboardPage.jsx already contains sweepFinalShipments. No admin file changes needed.');
} else if (source.includes(target)) {
  source = source.replace(target, replacement);
} else {
  console.error('Could not find the expected loadAdminRows block in AdminDashboardPage.jsx. No changes applied.');
  process.exit(1);
}

if (source !== original) {
  fs.writeFileSync(adminPath, source);
  console.log('Patched src/pages/AdminDashboardPage.jsx to run final shipment sweep on admin refresh.');
} else {
  console.log('No changes written to src/pages/AdminDashboardPage.jsx.');
}

const functionSource = path.join(__dirname, '..', 'supabase', 'functions', 'sweep-final-shipments', 'index.ts');
const functionTargetDir = path.join(process.cwd(), 'supabase', 'functions', 'sweep-final-shipments');
const functionTarget = path.join(functionTargetDir, 'index.ts');
fs.mkdirSync(functionTargetDir, { recursive: true });
fs.copyFileSync(functionSource, functionTarget);
console.log('Installed supabase/functions/sweep-final-shipments/index.ts');
console.log('Next: supabase functions deploy sweep-final-shipments');
