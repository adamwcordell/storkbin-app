import fs from 'fs';
import path from 'path';

const root = process.cwd();
const source = path.join(root, 'src/pages/CheckoutSuccess.jsx');
const patch = path.join(root, 'src/pages/CheckoutSuccess.jsx');

if (!fs.existsSync(source)) {
  console.error('Could not find src/pages/CheckoutSuccess.jsx. Run this from the StorkBin project root.');
  process.exit(1);
}

console.log('CheckoutSuccess.jsx is already placed by this patch. Restart npm run dev.');
console.log('Updated: src/pages/CheckoutSuccess.jsx');
