const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(root, p), s);
const exists = (p) => fs.existsSync(path.join(root, p));

function patchApp() {
  const file = 'src/App.jsx';
  if (!exists(file)) throw new Error(`${file} not found`);
  let s = read(file);
  let changed = false;

  if (!s.includes('FINAL_SETTLEMENT_FUNCTION_URL')) {
    s = s.replace(
      /const PAYMENT_METHOD_SETUP_FUNCTION_URL = "([^"]+)";/,
      (m) => `${m}\n  const FINAL_SETTLEMENT_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/create-final-settlement-session";`
    );
    changed = true;
  }

  const payShippingStart = s.indexOf('  const payShipping = async (boxId) => {');
  const payAllStart = s.indexOf('  const payAllFailedPayments = async', payShippingStart);
  if (payShippingStart === -1 || payAllStart === -1) {
    throw new Error('Could not locate payShipping/payAllFailedPayments block in App.jsx');
  }

  const newPayShipping = `  const payShipping = async (boxId) => {
    const box = boxes.find((currentBox) => currentBox.id === boxId);

    if (!box) {
      alert("Box not found.");
      return;
    }

    if (box.lifecycle_status === "auction") {
      alert("This bin is in auction status. Please contact StorkBin support.");
      return;
    }

    if (box.lifecycle_status === "removed_from_system") {
      alert("This bin has been removed from the StorkBin system.");
      return;
    }

    try {
      const response = await fetch(FINAL_SETTLEMENT_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boxId,
          successUrl: \`${'${window.location.origin}'}/account?payment=final-settlement-success&box=${'${encodeURIComponent(boxId)}'}\`,
          cancelUrl: \`${'${window.location.origin}'}/account?payment=final-settlement-cancelled&box=${'${encodeURIComponent(boxId)}'}\`,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.checkoutUrl) {
        alert(payload.error || "Could not start final shipment payment.");
        return;
      }

      window.location.href = payload.checkoutUrl;
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not start final shipment payment.");
    }
  };

`;

  const currentPayShipping = s.slice(payShippingStart, payAllStart);
  if (currentPayShipping !== newPayShipping) {
    s = s.slice(0, payShippingStart) + newPayShipping + s.slice(payAllStart);
    changed = true;
  }

  if (changed) write(file, s);
  console.log(changed ? `patched ${file}` : `no changes needed ${file}`);
}

function patchAccountPage() {
  const file = 'src/pages/AccountPage.jsx';
  if (!exists(file)) throw new Error(`${file} not found`);
  let s = read(file);
  let changed = false;

  const makeStart = s.indexOf('  const makePayment = () => {');
  const nextMarker = s.indexOf('  const updateAddressField', makeStart);
  if (makeStart === -1 || nextMarker === -1) throw new Error('Could not locate makePayment block in AccountPage.jsx');

  const newMakePayment = `  const makePayment = () => {
    const failedShipmentItem = missedPaymentItems.find(
      (item) =>
        item.box?.cancellation_shipping_charge_status === "failed" ||
        item.box?.fulfillment_status === "shipment_payment_failed" ||
        hasFailedShipment(item.box, shipments)
    );

    // Final shipment settlement must take priority because it can include both
    // overdue subscription invoices and the final return-shipping charge.
    if (failedShipmentItem?.box?.id && appData.payShipping) {
      appData.payShipping(failedShipmentItem.box.id);
      return;
    }

    const failedSubscriptionItem = missedPaymentItems.find(
      (item) =>
        item.box?.subscription_payment_status === "failed" &&
        item.box?.stripe_subscription_id
    );

    if (failedSubscriptionItem?.box?.id) {
      if (!appData.startSubscriptionPaymentRecovery) {
        alert("Stripe payment recovery is not wired yet. Please refresh and try again.");
        return;
      }

      appData.startSubscriptionPaymentRecovery(failedSubscriptionItem.box.id);
      return;
    }

    if (appData.payAllFailedPayments) {
      appData.payAllFailedPayments();
    }
  };

`;

  const currentMakePayment = s.slice(makeStart, nextMarker);
  if (currentMakePayment !== newMakePayment) {
    s = s.slice(0, makeStart) + newMakePayment + s.slice(nextMarker);
    changed = true;
  }

  const oldTerminatedFilter = `      if (box.subscription_lifecycle_status === "terminated") {
        return false;
      }
`;
  const newTerminatedFilter = `      const hasFinalShipmentPaymentFailure =
        box.cancellation_shipping_charge_status === "failed" ||
        box.fulfillment_status === "shipment_payment_failed" ||
        hasFailedShipment(box, shipments);

      if (box.subscription_lifecycle_status === "terminated" && !hasFinalShipmentPaymentFailure) {
        return false;
      }
`;
  if (s.includes(oldTerminatedFilter)) {
    s = s.replace(oldTerminatedFilter, newTerminatedFilter);
    changed = true;
  }

  if (changed) write(file, s);
  console.log(changed ? `patched ${file}` : `no changes needed ${file}`);
}

function patchBoxCard() {
  const file = 'src/components/BoxCard.jsx';
  if (!exists(file)) throw new Error(`${file} not found`);
  let s = read(file);
  let changed = false;

  const oldBlock = `                      <div style={styles.row}>
                        <Link style={styles.linkButtonSecondary} to="/account?payment=1">
                          Update Card
                        </Link>
                      </div>`;
  const newBlock = `                      <div style={styles.row}>
                        {onPayShipping ? (
                          <button style={styles.primaryButton} onClick={() => onPayShipping(box.id, shipment.id)}>
                            Pay Final Shipping
                          </button>
                        ) : (
                          <Link style={styles.linkButtonSecondary} to="/account?payment=1">
                            Update Card
                          </Link>
                        )}
                      </div>`;

  if (s.includes(oldBlock)) {
    s = s.replace(oldBlock, newBlock);
    changed = true;
  } else if (!s.includes('Pay Final Shipping')) {
    console.warn(`warning: could not locate failed shipment payment link block in ${file}`);
  }

  if (changed) write(file, s);
  console.log(changed ? `patched ${file}` : `no changes needed ${file}`);
}

function patchCors(file) {
  if (!exists(file)) {
    console.warn(`warning: ${file} not found, skipped`);
    return;
  }
  let s = read(file);
  let changed = false;

  if (!s.includes('const corsHeaders')) {
    s = s.replace(
      /const DEFAULT[^\n]*\n/,
      (m) => `${m}\nconst corsHeaders = {\n  "Access-Control-Allow-Origin": "*",\n  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",\n  "Access-Control-Allow-Methods": "POST, OPTIONS",\n};\n`
    );
    changed = true;
  }

  s = s.replace(
    /headers: \{ "Content-Type": "application\/json" \},/g,
    'headers: { ...corsHeaders, "Content-Type": "application/json" },'
  );

  if (!s.includes('if (req.method === "OPTIONS")')) {
    s = s.replace(
      /serve\(async \(req\) => \{\n/,
      'serve(async (req) => {\n  if (req.method === "OPTIONS") {\n    return new Response("ok", { headers: corsHeaders });\n  }\n\n'
    );
    changed = true;
  }

  if (changed) write(file, s);
  console.log(changed ? `patched ${file}` : `no changes needed ${file}`);
}

patchApp();
patchAccountPage();
patchBoxCard();
patchCors('supabase/functions/create-final-settlement-session/index.ts');
patchCors('supabase/functions/sweep-final-shipments/index.ts');
console.log('final payment UI + CORS patch complete');
