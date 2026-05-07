const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src', 'pages', 'AccountPage.jsx');

if (!fs.existsSync(filePath)) {
  console.error(`Could not find ${filePath}. Run this from the StorkBin project root.`);
  process.exit(1);
}

let src = fs.readFileSync(filePath, 'utf8');
let changed = false;

function replaceOnce(search, replacement, label) {
  if (!src.includes(search)) {
    if (src.includes(replacement)) {
      console.log(`Already patched: ${label}`);
      return;
    }
    console.error(`Could not find expected code for: ${label}`);
    process.exit(1);
  }
  src = src.replace(search, replacement);
  changed = true;
  console.log(`Patched: ${label}`);
}

replaceOnce(
  'import { Link, useLocation } from "react-router-dom";',
  'import { Link, useLocation, useNavigate } from "react-router-dom";',
  'add useNavigate import'
);

replaceOnce(
  '  const location = useLocation();\n  const showPaymentFocus = new URLSearchParams(location.search).get("payment") === "1";',
  '  const location = useLocation();\n  const navigate = useNavigate();\n  const showPaymentFocus = new URLSearchParams(location.search).get("payment") === "1";',
  'initialize navigate'
);

const handlerBlock = `
  const handleCancellationRequestSuccess = async (boxId, shippingPreference) => {
    if (!appData.requestCancellation) {
      throw new Error("Cancellation is not available right now. Please refresh and try again.");
    }

    await appData.requestCancellation(boxId, shippingPreference);
    navigate("/checkout-success?flow=cancellation_requested");
  };
`;

if (!src.includes('handleCancellationRequestSuccess')) {
  replaceOnce(
    '  const makePayment = () => {',
    `${handlerBlock}\n  const makePayment = () => {`,
    'add cancellation success navigation handler'
  );
} else {
  console.log('Already patched: cancellation success navigation handler');
}

replaceOnce(
  '                          onRequestCancellation={appData.requestCancellation}',
  '                          onRequestCancellation={handleCancellationRequestSuccess}',
  'route successful cancellation to success page'
);

if (changed) {
  fs.writeFileSync(filePath, src);
  console.log('Done. AccountPage cancellation now redirects to checkout-success?flow=cancellation_requested after success.');
} else {
  console.log('No changes needed.');
}
