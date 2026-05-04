import fs from "fs";
import path from "path";

const webhookPath = path.join(process.cwd(), "supabase", "functions", "stripe-webhook", "index.ts");

if (!fs.existsSync(webhookPath)) {
  console.error("Could not find supabase/functions/stripe-webhook/index.ts. Run this from your StorkBin project root.");
  process.exit(1);
}

let code = fs.readFileSync(webhookPath, "utf8");

if (!code.includes("invoice_payment.paid")) {
  code = code.replaceAll(
    'event.type === "invoice.paid"',
    '(event.type === "invoice.paid" || event.type === "invoice_payment.paid")'
  );
  code = code.replaceAll(
    "event.type === 'invoice.paid'",
    "(event.type === 'invoice.paid' || event.type === 'invoice_payment.paid')"
  );
}

if (!code.includes("getInvoiceSubscriptionId")) {
  const helper = `
const getInvoiceSubscriptionId = (invoiceLike) => {
  if (!invoiceLike) return null;

  if (typeof invoiceLike.subscription === "string") return invoiceLike.subscription;
  if (invoiceLike.subscription?.id) return invoiceLike.subscription.id;

  if (typeof invoiceLike.invoice?.subscription === "string") return invoiceLike.invoice.subscription;
  if (invoiceLike.invoice?.subscription?.id) return invoiceLike.invoice.subscription.id;

  if (typeof invoiceLike.parent?.subscription_details?.subscription === "string") {
    return invoiceLike.parent.subscription_details.subscription;
  }

  if (invoiceLike.parent?.subscription_details?.subscription?.id) {
    return invoiceLike.parent.subscription_details.subscription.id;
  }

  return null;
};

`;

  const serveIndex = code.indexOf("serve(async");
  if (serveIndex !== -1) {
    code = code.slice(0, serveIndex) + helper + code.slice(serveIndex);
  }
}

code = code.replaceAll(
  "const subscriptionId = event.data.object.subscription;",
  "const subscriptionId = getInvoiceSubscriptionId(event.data.object);"
);

code = code.replaceAll(
  "const subscriptionId = event.data?.object?.subscription;",
  "const subscriptionId = getInvoiceSubscriptionId(event.data?.object);"
);

code = code.replace(
  /if\s*\(\s*event\.type\s*!==\s*["']checkout\.session\.completed["']\s*\)\s*\{\s*return\s+jsonResponse\(\{\s*received:\s*true,\s*ignored:\s*true\s*\}\);\s*\}/g,
  `if (
    event.type !== "checkout.session.completed" &&
    event.type !== "invoice.paid" &&
    event.type !== "invoice_payment.paid" &&
    event.type !== "invoice.payment_failed"
  ) {
    return jsonResponse({ received: true, ignored: true, eventType: event.type });
  }`
);

fs.writeFileSync(webhookPath, code);
console.log("Patched stripe-webhook for invoice_payment.paid.");
