const fs = require('fs');
const path = require('path');

const root = process.cwd();
const adminPath = path.join(root, 'src', 'pages', 'AdminDashboardPage.jsx');
const sweepSourcePath = path.join(__dirname, '..', 'supabase', 'functions', 'sweep-final-shipments', 'index.ts');
const sweepDestPath = path.join(root, 'supabase', 'functions', 'sweep-final-shipments', 'index.ts');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(adminPath)) fail(`Missing ${adminPath}`);
if (!fs.existsSync(sweepSourcePath)) fail(`Missing ${sweepSourcePath}`);

fs.mkdirSync(path.dirname(sweepDestPath), { recursive: true });
fs.copyFileSync(sweepSourcePath, sweepDestPath);
console.log('Updated supabase/functions/sweep-final-shipments/index.ts');

let admin = fs.readFileSync(adminPath, 'utf8');

if (admin.includes('sweep-final-shipments')) {
  console.log('AdminDashboardPage.jsx already calls sweep-final-shipments; leaving existing call in place.');
} else {
  const needle = '    setLoadingAdminRows(true);\n    setAdminRowsError("");\n';
  const insert = `    setLoadingAdminRows(true);\n    setAdminRowsError("");\n\n    try {\n      const { error: sweepError } = await supabase.functions.invoke("sweep-final-shipments");\n\n      if (sweepError) {\n        console.warn("Final shipment sweep did not complete:", sweepError.message || sweepError);\n      }\n    } catch (sweepError) {\n      console.warn("Final shipment sweep did not complete:", sweepError);\n    }\n`;

  if (!admin.includes(needle)) {
    fail('Could not find the loadAdminRows insertion point in src/pages/AdminDashboardPage.jsx. No partial changes were made to that file.');
  }

  admin = admin.replace(needle, insert);
  fs.writeFileSync(adminPath, admin);
  console.log('Updated src/pages/AdminDashboardPage.jsx to run the final-shipment sweep during admin refresh.');
}

console.log('\nDone. Next commands:');
console.log('  supabase functions deploy sweep-final-shipments --no-verify-jwt');
console.log('  npm run dev');
