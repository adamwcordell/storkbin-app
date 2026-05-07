const fs = require('fs');
const path = require('path');

const root = process.cwd();
const file = (p) => path.join(root, p);
function read(p) {
  const full = file(p);
  if (!fs.existsSync(full)) {
    console.error(`Missing ${p}. Run this from your StorkBin project root.`);
    process.exit(1);
  }
  return fs.readFileSync(full, 'utf8');
}
function write(p, content) { fs.writeFileSync(file(p), content); }
function backup(p, suffix) {
  const full = file(p);
  if (fs.existsSync(full)) fs.copyFileSync(full, `${full}.${suffix}`);
}

let changed = false;

// App.jsx: keep the first window.confirm(), remove the second success alert,
// and redirect successful cancellation requests to the shared success page.
const appPath = 'src/App.jsx';
backup(appPath, 'before-cancellation-success-ux-v2');
let app = read(appPath);

const fnStart = app.indexOf('const requestCancellation = async');
const fnEnd = app.indexOf('const approveCancellation = async', fnStart);
if (fnStart === -1 || fnEnd === -1) {
  console.error('Could not find requestCancellation() boundaries in App.jsx. No changes made.');
  process.exit(1);
}

let beforeFn = app.slice(0, fnStart);
let fn = app.slice(fnStart, fnEnd);
let afterFn = app.slice(fnEnd);

// Remove only the post-success alert that starts with "Cancellation scheduled".
// This does NOT touch the first confirm() modal.
const successAlertStart = fn.indexOf('alert(\n        `Cancellation scheduled. Your subscription will end on');
if (successAlertStart !== -1) {
  const successAlertEnd = fn.indexOf(');', successAlertStart);
  if (successAlertEnd === -1) {
    console.error('Found cancellation success alert, but could not find its closing statement. No changes made.');
    process.exit(1);
  }
  fn = fn.slice(0, successAlertStart) + fn.slice(successAlertEnd + 2);
  changed = true;
  console.log('Patched: removed second cancellation success alert.');
} else if (fn.includes('Cancellation scheduled. Your subscription will end on')) {
  // More tolerant fallback for compact/differently formatted code.
  const alertRegex = /\n\s*alert\([\s\S]*?Cancellation scheduled\. Your subscription will end on[\s\S]*?\);/m;
  if (alertRegex.test(fn)) {
    fn = fn.replace(alertRegex, '');
    changed = true;
    console.log('Patched: removed second cancellation success alert via fallback matcher.');
  } else {
    console.error('Found cancellation success text, but could not safely remove only that alert. No changes made.');
    process.exit(1);
  }
} else {
  console.log('No second cancellation success alert found in requestCancellation().');
}

const successUrl = '/checkout-success?flow=cancellation_requested';
if (!fn.includes(successUrl)) {
  const loadNeedle = 'loadBoxes(user);';
  const loadIndex = fn.lastIndexOf(loadNeedle);
  if (loadIndex === -1) {
    console.error('Could not find loadBoxes(user); in requestCancellation() success path. No redirect added.');
    process.exit(1);
  }
  fn = fn.slice(0, loadIndex) +
    'loadBoxes(user);\n      window.location.href = "' + successUrl + '";' +
    fn.slice(loadIndex + loadNeedle.length);
  changed = true;
  console.log('Patched: added cancellation success-page redirect.');
} else {
  console.log('Cancellation success-page redirect already present.');
}

app = beforeFn + fn + afterFn;
write(appPath, app);

// CheckoutSuccess.jsx: make CTA robust if the manually added variant used
// buttonText/buttonLink, and ensure cancellation goes back to Account.
const successPath = 'src/pages/CheckoutSuccess.jsx';
backup(successPath, 'before-cancellation-success-ux-v2');
let success = read(successPath);

if (success.includes('const message = SUCCESS_MESSAGES[flow] || SUCCESS_MESSAGES.initial_purchase;') && !success.includes('const resolvedHref =')) {
  success = success.replace(
    '  const message = SUCCESS_MESSAGES[flow] || SUCCESS_MESSAGES.initial_purchase;\n',
    '  const message = SUCCESS_MESSAGES[flow] || SUCCESS_MESSAGES.initial_purchase;\n  const resolvedHref = message.href || message.buttonLink || "/";\n  const resolvedCta = message.cta || message.buttonText || "Back to dashboard";\n'
  );
  changed = true;
  console.log('Patched: added success page CTA fallbacks.');
}

if (success.includes('href={message.href}')) {
  success = success.split('href={message.href}').join('href={resolvedHref}');
  changed = true;
  console.log('Patched: success CTA uses resolvedHref.');
}
if (success.includes('{message.cta}')) {
  success = success.split('{message.cta}').join('{resolvedCta}');
  changed = true;
  console.log('Patched: success CTA uses resolvedCta.');
}

// If a cancellation_requested block exists but uses buttonLink, normalize destination.
if (success.includes('cancellation_requested')) {
  const blockRegex = /(cancellation_requested:\s*\{[\s\S]*?)(buttonLink|href):\s*["'][^"']*["']([\s\S]*?\},)/m;
  if (blockRegex.test(success)) {
    success = success.replace(blockRegex, '$1$2: "/account"$3');
    changed = true;
    console.log('Patched: cancellation success CTA destination is /account.');
  }
}

write(successPath, success);

if (!changed) {
  console.log('No changes needed. Cancellation UX already appears patched.');
} else {
  console.log('Done. First confirmation stays, second success popup is removed, and success page CTA should navigate out.');
}
