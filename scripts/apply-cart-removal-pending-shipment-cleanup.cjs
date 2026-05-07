const fs = require('fs');
const path = require('path');

const root = process.cwd();
const file = path.join(root, 'src/App.jsx');

if (!fs.existsSync(file)) {
  throw new Error('src/App.jsx not found. Run this script from the project root.');
}

const backup = `${file}.before-cart-removal-pending-shipment-cleanup`;
if (!fs.existsSync(backup)) {
  fs.copyFileSync(file, backup);
}

let app = fs.readFileSync(file, 'utf8');

if (app.includes('cleanupPendingShippingCartShipment')) {
  console.log('Cart removal pending shipment cleanup already applied.');
  process.exit(0);
}

const oldBlock = `  const removeFromCart = async (boxId) => {
    const box = boxes.find((b) => b.id === boxId);

    if (!box) {
      return;
    }

    if (box.cart_type === "initial_purchase") {
      const groupId = box.subscription_group_id;

      let deleteQuery = supabase
        .from("boxes")
        .delete()
        .eq("user_id", user.id)
        .eq("checkout_status", "in_cart")
        .eq("cart_type", "initial_purchase");

      if (groupId) {
        deleteQuery = deleteQuery.eq("subscription_group_id", groupId);
      } else {
        deleteQuery = deleteQuery.eq("id", boxId);
      }

      const { error } = await deleteQuery;

      if (error) {
        alert(error.message);
      } else {
        loadBoxes(user);
      }

      return;
    }

    const updates = {
      checkout_status: "paid",
      cart_type: null,
      requested_shipping_address: null,
      requested_shipping_address_source: null,
    };

    const { error } = await supabase
      .from("boxes")
      .update(updates)
      .eq("id", boxId);

    if (error) alert(error.message);
    else loadBoxes(user);
  };
`;

const newBlock = `  const cleanupPendingShippingCartShipment = async (box) => {
    const direction =
      box.cart_type === "ship_to_customer"
        ? "to_customer"
        : box.cart_type === "return_to_storage"
          ? "to_storage"
          : null;

    if (!direction) return { error: null };

    const { data: pendingShipments, error: lookupError } = await supabase
      .from("shipments")
      .select("id")
      .eq("box_id", box.id)
      .eq("user_id", user.id)
      .eq("shipment_direction", direction)
      .eq("shipping_status", "pending_payment")
      .in("charge_status", ["pending_payment", "failed"])
      .eq("label_status", "needed");

    if (lookupError) return { error: lookupError };

    const shipmentIds = (pendingShipments || []).map((shipment) => shipment.id);

    if (shipmentIds.length === 0) return { error: null };

    const { error: shipmentBoxesError } = await supabase
      .from("shipment_boxes")
      .delete()
      .in("shipment_id", shipmentIds);

    if (shipmentBoxesError) return { error: shipmentBoxesError };

    const { error: shipmentsError } = await supabase
      .from("shipments")
      .delete()
      .in("id", shipmentIds);

    return { error: shipmentsError };
  };

  const removeFromCart = async (boxId) => {
    const box = boxes.find((b) => b.id === boxId);

    if (!box) {
      return;
    }

    if (box.cart_type === "initial_purchase") {
      const groupId = box.subscription_group_id;

      let deleteQuery = supabase
        .from("boxes")
        .delete()
        .eq("user_id", user.id)
        .eq("checkout_status", "in_cart")
        .eq("cart_type", "initial_purchase");

      if (groupId) {
        deleteQuery = deleteQuery.eq("subscription_group_id", groupId);
      } else {
        deleteQuery = deleteQuery.eq("id", boxId);
      }

      const { error } = await deleteQuery;

      if (error) {
        alert(error.message);
      } else {
        loadBoxes(user);
      }

      return;
    }

    const cleanupResult = await cleanupPendingShippingCartShipment(box);

    if (cleanupResult.error) {
      alert(cleanupResult.error.message);
      return;
    }

    const updates = {
      checkout_status: "paid",
      cart_type: null,
      requested_shipping_address: null,
      requested_shipping_address_source: null,
    };

    const { error } = await supabase
      .from("boxes")
      .update(updates)
      .eq("id", boxId);

    if (error) alert(error.message);
    else loadBoxes(user);
  };
`;

const matches = app.split(oldBlock).length - 1;
if (matches !== 1) {
  throw new Error(`Could not find removeFromCart block. Expected 1 match, found ${matches}.`);
}

app = app.replace(oldBlock, newBlock);
fs.writeFileSync(file, app);

console.log('Applied cart removal pending shipment cleanup patch.');
console.log('Changed: src/App.jsx');
console.log('Next: npm run build');
