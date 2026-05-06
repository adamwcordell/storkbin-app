const fs = require('fs');
const path = require('path');

const appPath = path.join(process.cwd(), 'src', 'App.jsx');
if (!fs.existsSync(appPath)) {
  console.error('Could not find src/App.jsx. Run this from your StorkBin project root.');
  process.exit(1);
}

let src = fs.readFileSync(appPath, 'utf8');
const original = src;

function replaceBlock(startMarker, endMarker, replacement) {
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`Start marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  if (end === -1) throw new Error(`End marker not found after ${startMarker}: ${endMarker}`);
  src = src.slice(0, start) + replacement + src.slice(end);
}

const ensureReplacement = `  const ensureCancellationShipmentAndCharge = async (currentUser, box) => {
    const { data: existingShipments, error: existingShipmentError } =
      await supabase
        .from("shipments")
        .select("*")
        .eq("box_id", box.id)
        .eq("shipment_direction", "to_customer")
        .neq("shipping_status", "delivered")
        .order("created_at", { ascending: false })
        .limit(1);

    if (existingShipmentError) {
      console.error("Final shipment lookup failed:", existingShipmentError.message);
      return false;
    }

    let shipment = existingShipments?.[0] || null;

    if (!shipment) {
      const shippingAddress = await getCancellationShippingAddress(
        currentUser,
        box
      );

      if (!shippingAddress) {
        console.error("Final shipment could not be created: missing cancellation shipping address", box.id);
        return false;
      }

      const { data: createdShipment, error: shipmentError } = await supabase
        .from("shipments")
        .insert([
          {
            box_id: box.id,
            user_id: box.user_id,
            shipping_address: shippingAddress,
            shipping_estimate: DEFAULT_SHIPPING_COST,
            shipping_cost: DEFAULT_SHIPPING_COST,
            shipment_direction: "to_customer",
            shipping_status: "pending_payment",
            charge_status: "pending_auto_charge",
            label_status: "needed",
          },
        ])
        .select("*")
        .single();

      if (shipmentError) {
        console.error("Final shipment insert failed:", shipmentError.message);
        return false;
      }

      shipment = createdShipment;
    }

    if (shipment.charge_status === "paid") {
      const { error: boxUpdateError } = await supabase
        .from("boxes")
        .update({
          fulfillment_status: "ready_to_ship_to_customer",
          cancellation_shipping_charge_status: "paid",
        })
        .eq("id", box.id);

      if (boxUpdateError) {
        console.error("Final shipment paid box sync failed:", boxUpdateError.message);
        return false;
      }

      return true;
    }

    if (shipment.charge_status === "failed") {
      const { error: boxUpdateError } = await supabase
        .from("boxes")
        .update({
          fulfillment_status: "shipment_payment_failed",
          cancellation_shipping_charge_status: "failed",
        })
        .eq("id", box.id);

      if (boxUpdateError) {
        console.error("Final shipment failed box sync failed:", boxUpdateError.message);
      }

      return false;
    }

    return attemptMockShipmentCharge(box, shipment);
  };

`;

const lifecycleReplacement = `  const processLifecycleUpdates = async (currentUser, currentBoxes) => {
    const nowMs = Date.now();

    const getTimeMs = (value) => {
      if (!value) return null;
      const parsed = new Date(value).getTime();
      return Number.isNaN(parsed) ? null : parsed;
    };

    for (const box of currentBoxes) {
      if (box.checkout_status !== "paid") continue;

      const subscriptionEndsAtMs = getTimeMs(box.subscription_ends_at);
      const subscriptionHasEnded =
        subscriptionEndsAtMs !== null && subscriptionEndsAtMs <= nowMs;

      if (box.renews_at && !subscriptionHasEnded) {
        const renewsAt = new Date(box.renews_at);

        if (renewsAt.getTime() <= nowMs) {
          const nextRenewalDate = getNextMonthlyDate(renewsAt);

          const { error: renewalError } = await supabase
            .from("boxes")
            .update({
              renews_at: nextRenewalDate.toISOString(),
            })
            .eq("id", box.id);

          if (renewalError) {
            console.error("Renewal update failed:", renewalError.message);
          }
        }
      }

      const shouldTerminateCustomerHeldCancelledBin =
        box.cancel_status === "approved" &&
        box.status === "at_customer" &&
        subscriptionHasEnded &&
        box.subscription_lifecycle_status !== "terminated";

      if (shouldTerminateCustomerHeldCancelledBin) {
        const { error: terminationError } = await supabase
          .from("boxes")
          .update({
            lifecycle_status: "active",
            subscription_lifecycle_status: "terminated",
            subscription_status: "terminated",
            subscription_terminated_at: new Date().toISOString(),
            lifecycle_attention_reason: null,
            lifecycle_deadline_at: null,
          })
          .eq("id", box.id);

        if (terminationError) {
          console.error(
            "Customer-held cancellation termination failed:",
            terminationError.message
          );
        }

        continue;
      }

      const shouldEnsureStoredCancellationShipment =
        box.cancel_status === "approved" &&
        box.status === "stored" &&
        subscriptionHasEnded &&
        box.cancellation_shipping_charge_status !== "paid" &&
        box.fulfillment_status !== "bin_shipped_to_customer" &&
        box.fulfillment_status !== "ready_to_ship_to_customer";

      if (shouldEnsureStoredCancellationShipment) {
        await ensureCancellationShipmentAndCharge(currentUser, box);
      }
    }
  };

`;

try {
  replaceBlock('  const ensureCancellationShipmentAndCharge = async (currentUser, box) => {', '  const processLifecycleUpdates = async (currentUser, currentBoxes) => {', ensureReplacement);
  replaceBlock('  const processLifecycleUpdates = async (currentUser, currentBoxes) => {', '  const signUp = async () => {', lifecycleReplacement);
} catch (error) {
  console.error(error.message);
  console.error('No changes were applied. Please upload current src/App.jsx if this fails again.');
  process.exit(1);
}

if (src === original) {
  console.log('No changes needed; App.jsx already appears patched.');
  process.exit(0);
}

fs.writeFileSync(appPath, src, 'utf8');
console.log('Patched src/App.jsx final shipment auto-creation logic.');
