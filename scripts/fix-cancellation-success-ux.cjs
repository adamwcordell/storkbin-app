const fs = require('fs');
const path = require('path');

const root = process.cwd();
const file = (p) => path.join(root, p);

function readIfExists(p) {
  const full = file(p);
  if (!fs.existsSync(full)) {
    console.error(`Missing ${p}. Run this from your StorkBin project root.`);
    process.exit(1);
  }
  return fs.readFileSync(full, 'utf8');
}

function write(p, content) {
  fs.writeFileSync(file(p), content);
}

function backup(p, suffix) {
  const full = file(p);
  if (fs.existsSync(full)) {
    fs.copyFileSync(full, `${full}.${suffix}`);
  }
}

let changed = false;

// 1) Remove the second post-success cancellation popup from App.jsx.
// The first confirm() warning remains untouched.
const appPath = 'src/App.jsx';
backup(appPath, 'before-cancellation-success-ux-fix');
let app = readIfExists(appPath);

const finalAlertRegex = /\n\s*alert\(\s*`Cancellation scheduled\. Your subscription will end on \$\{subscriptionEndsAt\.toLocaleDateString\([\s\S]*?\}\s*\)\.\s*`\s*\);\s*\n\s*loadBoxes\(user\);/m;

if (finalAlertRegex.test(app)) {
  app = app.replace(finalAlertRegex, '\n      loadBoxes(user);');
  changed = true;
  console.log('Patched: removed second cancellation success alert in App.jsx');
} else if (app.includes('Cancellation scheduled. Your subscription will end on')) {
  console.error('Found the cancellation success alert, but not in the expected shape. No automatic replacement made for App.jsx.');
  process.exit(1);
} else {
  console.log('Already patched or no second cancellation success alert found in App.jsx');
}

write(appPath, app);

// 2) Make CheckoutSuccess resilient if the manually-added cancellation variant used
// buttonText/buttonLink instead of cta/href, and ensure the cancellation variant has
// the right destination.
const successPath = 'src/pages/CheckoutSuccess.jsx';
backup(successPath, 'before-cancellation-success-ux-fix');
let success = readIfExists(successPath);

const cancellationVariant = `  cancellation_requested: {
    title: "Cancellation Request Submitted",
    eyebrow: "Your cancellation request has been received.",
    body: "If your bin is currently in storage, we’ll prepare the final return shipment and notify you of any required shipping payment.",
    cta: "Back to Account",
    href: "/account",
  },`;

if (success.includes('const SUCCESS_MESSAGES') && !success.includes('cancellation_requested')) {
  const insertBefore = '  payment_method_update:';
  if (!success.includes(insertBefore)) {
    console.error('Could not find where to insert cancellation_requested in CheckoutSuccess.jsx.');
    process.exit(1);
  }
  success = success.replace(insertBefore, `${cancellationVariant}\n${insertBefore}`);
  changed = true;
  console.log('Patched: added cancellation_requested success message');
} else if (success.includes('cancellation_requested')) {
  const variantRegex = /\s+cancellation_requested:\s*\{[\s\S]*?\n\s*\},/m;
  if (variantRegex.test(success)) {
    success = success.replace(variantRegex, `\n${cancellationVariant}`);
    changed = true;
    console.log('Patched: normalized cancellation_requested success message');
  } else {
    console.log('Found cancellation_requested, but could not safely normalize its block. Leaving message text as-is.');
  }
}

if (success.includes('const message = SUCCESS_MESSAGES[flow] || SUCCESS_MESSAGES.initial_purchase;') && !success.includes('const resolvedHref =')) {
  success = success.replace(
    '  const message = SUCCESS_MESSAGES[flow] || SUCCESS_MESSAGES.initial_purchase;\n',
    '  const message = SUCCESS_MESSAGES[flow] || SUCCESS_MESSAGES.initial_purchase;\n  const resolvedHref = message.href || message.buttonLink || "/";\n  const resolvedCta = message.cta || message.buttonText || "Back to dashboard";\n'
  );
  changed = true;
  console.log('Patched: added success page CTA fallbacks');
}

if (success.includes('href={message.href}')) {
  success = success.replaceAll('href={message.href}', 'href={resolvedHref}');
  changed = true;
  console.log('Patched: success CTA href uses resolvedHref');
}

if (success.includes('{message.cta}')) {
  success = success.replaceAll('{message.cta}', '{resolvedCta}');
  changed = true;
  console.log('Patched: success CTA text uses resolvedCta');
}

write(successPath, success);

if (!changed) {
  console.log('No changes needed. Files already appear patched.');
} else {
  console.log('Done. Cancellation keeps first confirmation, removes second popup, and success page CTA should leave the page.');
}
