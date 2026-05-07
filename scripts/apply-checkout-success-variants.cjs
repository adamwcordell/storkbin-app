const fs = require('fs');
const path = require('path');

const root = process.cwd();
const file = (p) => path.join(root, p);
const read = (p) => fs.readFileSync(file(p), 'utf8');
const write = (p, c) => fs.writeFileSync(file(p), c);
const backup = (p) => {
  const full = file(p);
  if (fs.existsSync(full)) fs.copyFileSync(full, `${full}.before-success-page-variants`);
};
const replaceAllLiteral = (content, search, replacement, label) => {
  if (!content.includes(search)) {
    console.log(`Skip ${label}: already changed or not present.`);
    return content;
  }
  return content.split(search).join(replacement);
};
const replaceOnceLiteral = (content, search, replacement, label) => {
  const count = content.split(search).length - 1;
  if (count === 0) {
    console.log(`Skip ${label}: already changed or not present.`);
    return content;
  }
  if (count > 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  return content.replace(search, replacement);
};

const checkoutSuccessPath = 'src/pages/CheckoutSuccess.jsx';
backup(checkoutSuccessPath);
const checkoutSuccessContent = `import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

const SUCCESS_MESSAGES = {
  initial_purchase: {
    title: "Order Confirmed",
    eyebrow: "Thanks for choosing StorkBin!",
    body: "Keep an eye on your inbox - we’ll send you a welcome email with everything you need to get started managing your bins.",
    cta: "Back to dashboard",
    href: "/",
    clearCart: true,
  },
  subscription_payment_recovery: {
    title: "Payment Successful",
    eyebrow: "Your subscription payment has been processed successfully.",
    body: "Your bin remains active and no further action is required.",
    cta: "Return to dashboard",
    href: "/",
  },
  final_settlement: {
    title: "Final Shipping Payment Successful",
    eyebrow: "Your final shipping payment has been received.",
    body: "Your shipment is now being prepared for return delivery.",
    cta: "View my bins",
    href: "/my-bins",
  },
  return_to_storage_shipping: {
    title: "Shipment Request Confirmed",
    eyebrow: "Your return shipment payment has been processed.",
    body: "A shipping label will be generated shortly. Please follow shipment instructions once available.",
    cta: "View my bins",
    href: "/my-bins",
    clearCart: true,
  },
  customer_retrieval_shipping: {
    title: "Shipment Request Confirmed",
    eyebrow: "Your shipment request has been received and payment was successful.",
    body: "Your bin is now being prepared for shipment.",
    cta: "View my bins",
    href: "/my-bins",
    clearCart: true,
  },
  shipping: {
    title: "Shipment Request Confirmed",
    eyebrow: "Your shipment payment has been processed.",
    body: "Your shipment request is now being prepared.",
    cta: "View my bins",
    href: "/my-bins",
    clearCart: true,
  },
  payment_method_update: {
    title: "Payment Method Updated",
    eyebrow: "Your default payment method has been updated successfully.",
    body: "Future StorkBin payments will use your updated payment method.",
    cta: "Return to account",
    href: "/account",
  },
};

export default function CheckoutSuccess() {
  const [searchParams] = useSearchParams();
  const flow = searchParams.get("flow") || "initial_purchase";
  const message = SUCCESS_MESSAGES[flow] || SUCCESS_MESSAGES.initial_purchase;

  useEffect(() => {
    if (message.clearCart) {
      localStorage.removeItem("cart");
    }
  }, [message.clearCart]);

  return (
    <div
      style={{
        backgroundColor: "#f7f7f7",
        paddingTop: "40px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          padding: "20px 24px",
          borderRadius: "12px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          maxWidth: "440px",
          width: "100%",
          textAlign: "center"
        }}
      >
        <div style={{
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          backgroundColor: "#e6f4ea",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 8px auto",
          fontSize: "20px",
          color: "#2e7d32"
        }}>
          ✓
        </div>

        <h1 style={{ marginBottom: "6px", fontSize: "20px", color: "#333" }}>
          {message.title}
        </h1>

        <p style={{ fontSize: "13px", marginBottom: "6px" }}>
          {message.eyebrow}
        </p>

        <p style={{ fontSize: "12.5px", marginBottom: "12px", lineHeight: "1.35" }}>
          {message.body}
        </p>

        <a
          href={message.href}
          style={{
            display: "inline-block",
            backgroundColor: "#111",
            color: "#fff",
            padding: "8px 14px",
            borderRadius: "16px",
            textDecoration: "none",
            fontSize: "12.5px"
          }}
        >
          {message.cta}
        </a>
      </div>
    </div>
  );
}
`;
write(checkoutSuccessPath, checkoutSuccessContent);

const appPath = 'src/App.jsx';
backup(appPath);
let app = read(appPath);

app = replaceAllLiteral(
  app,
  'successUrl: `${window.location.origin}/checkout-success`,',
  'successUrl: `${window.location.origin}/checkout-success?flow=initial_purchase`,',
  'initial purchase success URL'
);

app = replaceAllLiteral(
  app,
  'successUrl: `${window.location.origin}/account?payment=success`,',
  'successUrl: `${window.location.origin}/checkout-success?flow=subscription_payment_recovery`,',
  'subscription recovery success URL'
);

app = replaceAllLiteral(
  app,
  'successUrl: `${window.location.origin}/account?payment_method=success`,',
  'successUrl: `${window.location.origin}/checkout-success?flow=payment_method_update`,',
  'payment method update success URL'
);

app = replaceAllLiteral(
  app,
  'successUrl: `${window.location.origin}/account?payment=final-settlement-success&box=${encodeURIComponent(boxId)}`,',
  'successUrl: `${window.location.origin}/checkout-success?flow=final_settlement&box=${encodeURIComponent(boxId)}`,',
  'final settlement success URL'
);

const shippingFetchNeedle = `      const response = await fetch(SHIPPING_CHECKOUT_FUNCTION_URL, {\n        method: "POST",`;
const shippingFetchReplacement = `      const shippingSuccessFlow =\n        shipToCustomerBoxes.length > 0 && returnToStorageBoxes.length === 0\n          ? "customer_retrieval_shipping"\n          : returnToStorageBoxes.length > 0 && shipToCustomerBoxes.length === 0\n            ? "return_to_storage_shipping"\n            : "shipping";\n\n      const response = await fetch(SHIPPING_CHECKOUT_FUNCTION_URL, {\n        method: "POST",`;
if (app.includes('SHIPPING_CHECKOUT_FUNCTION_URL') && !app.includes('const shippingSuccessFlow =')) {
  app = replaceOnceLiteral(app, shippingFetchNeedle, shippingFetchReplacement, 'shipping success flow selector');
}

app = replaceAllLiteral(
  app,
  'successUrl: `${window.location.origin}/checkout-success?flow=shipping`,',
  'successUrl: `${window.location.origin}/checkout-success?flow=${shippingSuccessFlow}`,',
  'shipping checkout success URL'
);

write(appPath, app);

const recoveryPath = 'supabase/functions/create-payment-recovery-session/index.ts';
if (fs.existsSync(file(recoveryPath))) {
  backup(recoveryPath);
  let recovery = read(recoveryPath);
  recovery = replaceAllLiteral(
    recovery,
    'const recoverySuccessUrl = successUrl || `${appUrl}/account?payment=success`;',
    'const recoverySuccessUrl = successUrl || `${appUrl}/checkout-success?flow=subscription_payment_recovery`;',
    'recovery default success URL'
  );
  write(recoveryPath, recovery);
}

const paymentMethodPath = 'supabase/functions/create-payment-method-setup-session/index.ts';
if (fs.existsSync(file(paymentMethodPath))) {
  backup(paymentMethodPath);
  let paymentMethod = read(paymentMethodPath);
  paymentMethod = replaceAllLiteral(
    paymentMethod,
    'const successUrl = body.successUrl || `${req.headers.get("origin") || "http://localhost:5173"}/account?payment_method=success`;',
    'const successUrl = body.successUrl || `${req.headers.get("origin") || "http://localhost:5173"}/checkout-success?flow=payment_method_update`;',
    'payment method default success URL'
  );
  write(paymentMethodPath, paymentMethod);
}

const finalSettlementPath = 'supabase/functions/create-final-settlement-session/index.ts';
if (fs.existsSync(file(finalSettlementPath))) {
  backup(finalSettlementPath);
  let finalSettlement = read(finalSettlementPath);
  finalSettlement = replaceAllLiteral(
    finalSettlement,
    'params.append("success_url", successUrl || `${origin}/account?payment=final-settlement-success&box=${encodeURIComponent(box.id)}`);',
    'params.append("success_url", successUrl || `${origin}/checkout-success?flow=final_settlement&box=${encodeURIComponent(box.id)}`);',
    'final settlement default success URL'
  );
  write(finalSettlementPath, finalSettlement);
}

console.log('Applied checkout success page variants patch.');
console.log('Changed:');
console.log('- src/pages/CheckoutSuccess.jsx');
console.log('- src/App.jsx');
console.log('- supabase/functions/create-payment-recovery-session/index.ts, if present');
console.log('- supabase/functions/create-payment-method-setup-session/index.ts, if present');
console.log('- supabase/functions/create-final-settlement-session/index.ts, if present');
console.log('Next: npm run build');
console.log('Deploy if changed in your project:');
console.log('- supabase functions deploy create-payment-recovery-session');
console.log('- supabase functions deploy create-payment-method-setup-session');
console.log('- supabase functions deploy create-final-settlement-session --no-verify-jwt');
