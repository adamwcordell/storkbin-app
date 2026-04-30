import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import styles from "./styles/styles";
import AuthCard from "./components/AuthCard";
import Cart from "./components/Cart";
import CreateBox from "./components/CreateBox";
import BoxCard from "./components/BoxCard";

function App() {
  const [user, setUser] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [boxes, setBoxes] = useState([]);
  const [items, setItems] = useState([]);
  const [shipments, setShipments] = useState([]);

  const [newBoxId, setNewBoxId] = useState("");

  const [itemNames, setItemNames] = useState({});
  const [itemDescriptions, setItemDescriptions] = useState({});
  const [itemImages, setItemImages] = useState({});

  const [activeManageBox, setActiveManageBox] = useState(null);

  const SETUP_FEE = 35;
  const MONTHLY_RATE = 13;
  const FIRST_MONTH_TOTAL = SETUP_FEE + MONTHLY_RATE;
  const MINIMUM_TERM_MONTHS = 6;
  const DEFAULT_SHIPPING_COST = 18;
  const MOCK_AUTO_CHARGE_SUCCEEDS = true; // Set to false locally to test payment-failed UI

  const ADMIN_EMAILS = ["adamwcordell@gmail.com"];
  const isAdmin = user && ADMIN_EMAILS.includes(user.email);

  const cartBoxes = boxes.filter((box) => box.checkout_status === "in_cart");

  const cartTotal = cartBoxes.reduce((total, box) => {
    if (box.cart_type === "initial_purchase") {
      return total + FIRST_MONTH_TOTAL;
    }

    if (
      box.cart_type === "ship_to_customer" ||
      box.cart_type === "return_to_storage"
    ) {
      return total + DEFAULT_SHIPPING_COST;
    }

    return total;
  }, 0);
  const grandTotal = cartTotal;

  useEffect(() => {
    const getSessionAndLoadData = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        setUser(session.user);
        await loadBoxes(session.user);
        await loadItems();
      }
    };

    getSessionAndLoadData();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user || null;
      setUser(currentUser);

      if (currentUser) {
        loadBoxes(currentUser);
        loadItems();
      } else {
        setBoxes([]);
        setItems([]);
        setShipments([]);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const getNextMonthlyDate = (dateValue) => {
    const now = new Date();
    const nextDate = new Date(dateValue);

    while (nextDate.getTime() <= now.getTime()) {
      nextDate.setMonth(nextDate.getMonth() + 1);
    }

    return nextDate;
  };

  const getCancellationEndDate = (box) => {
    const now = new Date();

    const startedAt = box.subscription_started_at
      ? new Date(box.subscription_started_at)
      : now;

    const minimumTermEnd = new Date(startedAt);
    minimumTermEnd.setMonth(minimumTermEnd.getMonth() + MINIMUM_TERM_MONTHS);

    if (minimumTermEnd.getTime() > now.getTime()) {
      return minimumTermEnd;
    }

    if (box.renews_at) {
      return getNextMonthlyDate(box.renews_at);
    }

    return now;
  };

  const loadShipments = async (currentUser) => {
    const { data, error } = await supabase
      .from("shipments")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Shipment load failed:", error.message);
      setShipments([]);
      return [];
    }

    const loadedShipments = data || [];
    setShipments(loadedShipments);
    return loadedShipments;
  };

  const getProfileShippingAddress = async (currentUser, box) => {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", box.user_id)
      .maybeSingle();

    if (profileError || !profile) {
      console.error("No profile/address found for shipment.", profileError);
      return null;
    }

    return {
      full_name: profile.full_name || "",
      email: profile.email || currentUser.email || "",
      address_line1: profile.address_line1 || "",
      address_line2: profile.address_line2 || "",
      city: profile.city || "",
      state: profile.state || "",
      zip: profile.zip || "",
    };
  };

  const formatAddressForPrompt = (address) => {
    if (!address) return "";

    return [
      address.full_name,
      address.address_line1,
      address.address_line2,
      [address.city, address.state, address.zip].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join("\n");
  };

  const promptForCustomShippingAddress = (addressRole = "Recipient") => {
    const fullName = window.prompt(`${addressRole} full name:`) || "";
    const addressLine1 = window.prompt("Street address:") || "";
    const addressLine2 = window.prompt("Apartment, suite, etc. (optional):") || "";
    const city = window.prompt("City:") || "";
    const state = window.prompt("State:") || "";
    const zip = window.prompt("ZIP code:") || "";

    if (!addressLine1.trim() || !city.trim() || !state.trim() || !zip.trim()) {
      alert("Please enter a complete shipping address.");
      return null;
    }

    return {
      full_name: fullName.trim(),
      email: user?.email || "",
      address_line1: addressLine1.trim(),
      address_line2: addressLine2.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
    };
  };

  const chooseShippingAddressForBox = async (box, options = {}) => {
    const { mode = "to_customer", addressRole = "Recipient" } = options;
    const profileAddress = await getProfileShippingAddress(user, box);

    if (profileAddress) {
      const promptMessage =
        mode === "from_customer"
          ? `Will you ship this bin from your address on file?\n\n${formatAddressForPrompt(profileAddress)}\n\nClick OK to use this ship-from address. Click Cancel to enter a different ship-from address.`
          : `Ship this bin to your address on file?\n\n${formatAddressForPrompt(profileAddress)}\n\nClick OK to use this destination address. Click Cancel to enter a different destination address.`;

      const useAddressOnFile = window.confirm(promptMessage);

      if (useAddressOnFile) {
        return { source: "profile", address: profileAddress };
      }
    } else {
      alert(
        mode === "from_customer"
          ? "We could not find an address on file. Please enter the address you will ship from."
          : "We could not find an address on file. Please enter a shipping address."
      );
    }

    const customAddress = promptForCustomShippingAddress(addressRole);

    if (!customAddress) return null;

    return { source: "custom", address: customAddress };
  };

  const getCancellationShippingAddress = async (currentUser, box) => {
    if (box.cancellation_shipping_address) {
      return box.cancellation_shipping_address;
    }

    return getProfileShippingAddress(currentUser, box);
  };

  const attemptMockShipmentCharge = async (box, shipment) => {
    const now = new Date().toISOString();
    const shippingCost = shipment.shipping_cost || DEFAULT_SHIPPING_COST;

    if (MOCK_AUTO_CHARGE_SUCCEEDS) {
      const { error: shipmentUpdateError } = await supabase
        .from("shipments")
        .update({
          shipping_status: "paid",
          charge_status: "paid",
          charge_attempted_at: now,
          charge_failure_reason: null,
          shipping_cost: shippingCost,
          label_status: shipment.label_status || "needed",
        })
        .eq("id", shipment.id);

      if (shipmentUpdateError) {
        console.error("Shipment charge update failed:", shipmentUpdateError.message);
        return false;
      }

      const { error: boxUpdateError } = await supabase
        .from("boxes")
        .update({
          fulfillment_status: "ready_to_ship_to_customer",
          cancellation_shipping_charge_status: "paid",
        })
        .eq("id", box.id);

      if (boxUpdateError) {
        console.error("Box charge update failed:", boxUpdateError.message);
        return false;
      }

      return true;
    }

    const { error: shipmentUpdateError } = await supabase
      .from("shipments")
      .update({
        shipping_status: "pending_payment",
        charge_status: "failed",
        charge_attempted_at: now,
        charge_failure_reason: "Mock card charge failed",
        shipping_cost: shippingCost,
      })
      .eq("id", shipment.id);

    if (shipmentUpdateError) {
      console.error("Shipment failure update failed:", shipmentUpdateError.message);
      return false;
    }

    const { error: boxUpdateError } = await supabase
      .from("boxes")
      .update({
        fulfillment_status: "shipment_payment_failed",
        cancellation_shipping_charge_status: "failed",
      })
      .eq("id", box.id);

    if (boxUpdateError) {
      console.error("Box failure update failed:", boxUpdateError.message);
      return false;
    }

    return true;
  };

  const ensureCancellationShipmentAndCharge = async (currentUser, box) => {
    const { data: existingShipments, error: existingShipmentError } =
      await supabase
        .from("shipments")
        .select("*")
        .eq("box_id", box.id)
        .limit(1);

    if (existingShipmentError) {
      console.error("Shipment lookup failed:", existingShipmentError.message);
      return false;
    }

    let shipment = existingShipments?.[0] || null;

    if (!shipment) {
      const shippingAddress = await getCancellationShippingAddress(
        currentUser,
        box
      );

      if (!shippingAddress) return false;

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
        console.error("Shipment insert failed:", shipmentError.message);
        return false;
      }

      shipment = createdShipment;
    }

    if (shipment.charge_status === "paid") {
      return true;
    }

    if (shipment.charge_status === "failed") {
      return false;
    }

    return attemptMockShipmentCharge(box, shipment);
  };

  const processLifecycleUpdates = async (currentUser, currentBoxes) => {
    for (const box of currentBoxes) {
      if (box.checkout_status !== "paid") continue;

      const subscriptionHasEnded =
        box.subscription_ends_at &&
        new Date(box.subscription_ends_at).getTime() <= Date.now();

      if (box.renews_at && !subscriptionHasEnded) {
        const renewsAt = new Date(box.renews_at);

        if (renewsAt.getTime() <= Date.now()) {
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

      const needsEndOfTermShipment =
        box.cancel_status === "approved" &&
        box.status === "stored" &&
        subscriptionHasEnded;

      if (!needsEndOfTermShipment) continue;

      if (
        box.fulfillment_status === "bin_shipped_to_customer" ||
        box.fulfillment_status === "ready_to_ship_to_customer" ||
        box.fulfillment_status === "shipment_payment_failed"
      ) {
        continue;
      }

      await ensureCancellationShipmentAndCharge(currentUser, box);
    }
  };

  const signUp = async () => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) alert(error.message);
    else alert("Check your email to confirm your account.");
  };

  const logIn = async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert(error.message);
    } else {
      setUser(data.user);
      loadBoxes(data.user);
      loadItems();
    }
  };

  const logOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setBoxes([]);
    setItems([]);
    setShipments([]);
  };

  const loadBoxes = async (currentUser) => {
    const { data, error } = await supabase
      .from("boxes")
      .select("*")
      .eq("user_id", currentUser.id);

    if (error) {
      alert(error.message);
      return;
    }

    const loadedBoxes = data || [];
    await processLifecycleUpdates(currentUser, loadedBoxes);

    const { data: refreshedBoxes, error: refreshError } = await supabase
      .from("boxes")
      .select("*")
      .eq("user_id", currentUser.id);

    if (refreshError) {
      alert(refreshError.message);
      return;
    }

    setBoxes(refreshedBoxes || []);
    await loadShipments(currentUser);
  };

  const loadItems = async () => {
    const { data, error } = await supabase.from("items").select("*");

    if (error) {
      alert(error.message);
      return;
    }

    setItems(data || []);
  };

  const createBox = async () => {
    if (!newBoxId.trim()) {
      alert("Please enter a Box ID.");
      return;
    }

    const { error } = await supabase.from("boxes").insert([
      {
        id: newBoxId.trim(),
        user_id: user.id,
        status: "at_customer",
        checkout_status: "draft",
        fulfillment_status: "pending",
        price: FIRST_MONTH_TOTAL,
        cart_type: "initial_purchase",
      },
    ]);

    if (error) {
      alert(error.message);
    } else {
      setNewBoxId("");
      loadBoxes(user);
    }
  };

  const addToCart = async (boxId) => {
    const { error } = await supabase
      .from("boxes")
      .update({ checkout_status: "in_cart", cart_type: "initial_purchase" })
      .eq("id", boxId)
      .eq("checkout_status", "draft");

    if (error) alert(error.message);
    else loadBoxes(user);
  };

  const removeFromCart = async (boxId) => {
    const box = boxes.find((b) => b.id === boxId);

    if (!box) {
      alert("Box not found.");
      return;
    }

    const updates =
      box.cart_type === "initial_purchase"
        ? {
            checkout_status: "draft",
            cart_type: "initial_purchase",
          }
        : {
            checkout_status: "paid",
            cart_type: null,
            requested_shipping_address: null,
            requested_shipping_address_source: null,
          };

    const { error } = await supabase
      .from("boxes")
      .update(updates)
      .eq("id", boxId)
      .eq("checkout_status", "in_cart");

    if (error) alert(error.message);
    else loadBoxes(user);
  };

  const createShipmentForCartBox = async (box, direction) => {
    const shippingAddress =
      box.requested_shipping_address || (await getProfileShippingAddress(user, box));

    if (!shippingAddress) {
      alert(`Missing shipping address for box ${box.id}.`);
      return false;
    }

    const { error } = await supabase.from("shipments").insert([
      {
        box_id: box.id,
        user_id: box.user_id,
        shipping_address: shippingAddress,
        shipping_estimate: DEFAULT_SHIPPING_COST,
        shipping_cost: DEFAULT_SHIPPING_COST,
        shipment_direction: direction,
        shipping_status: "paid",
        charge_status: "paid",
        charge_attempted_at: new Date().toISOString(),
        charge_failure_reason: null,
        label_status: "needed",
      },
    ]);

    if (error) {
      alert(error.message);
      return false;
    }

    return true;
  };

  const checkout = async () => {
    if (cartBoxes.length === 0) {
      alert("Your cart is empty.");
      return;
    }

    const confirmed = window.confirm(
      `Mock checkout for $${grandTotal.toFixed(2)}?`
    );

    if (!confirmed) return;

    const now = new Date();
    const renewsAt = new Date(now);
    renewsAt.setMonth(renewsAt.getMonth() + 1);

    const initialPurchaseBoxes = cartBoxes.filter(
      (box) => box.cart_type === "initial_purchase"
    );
    const shipToCustomerBoxes = cartBoxes.filter(
      (box) => box.cart_type === "ship_to_customer"
    );
    const returnToStorageBoxes = cartBoxes.filter(
      (box) => box.cart_type === "return_to_storage"
    );

    if (initialPurchaseBoxes.length > 0) {
      const { error } = await supabase
        .from("boxes")
        .update({
          checkout_status: "paid",
          cart_type: null,
          fulfillment_status: "paid_waiting_to_ship_bin",
          subscription_started_at: now.toISOString(),
          renews_at: renewsAt.toISOString(),
        })
        .in(
          "id",
          initialPurchaseBoxes.map((box) => box.id)
        );

      if (error) {
        alert(error.message);
        return;
      }
    }

    for (const box of shipToCustomerBoxes) {
      const shipmentCreated = await createShipmentForCartBox(box, "to_customer");
      if (!shipmentCreated) return;

      const { error } = await supabase
        .from("boxes")
        .update({
          checkout_status: "paid",
          cart_type: null,
          requested_shipping_address: null,
          requested_shipping_address_source: null,
          fulfillment_status: "ready_to_ship_to_customer",
        })
        .eq("id", box.id);

      if (error) {
        alert(error.message);
        return;
      }
    }

    for (const box of returnToStorageBoxes) {
      const shipmentCreated = await createShipmentForCartBox(box, "to_storage");
      if (!shipmentCreated) return;

      const { error } = await supabase
        .from("boxes")
        .update({
          checkout_status: "paid",
          cart_type: null,
          fulfillment_status: "awaiting_customer_dropoff",
        })
        .eq("id", box.id);

      if (error) {
        alert(error.message);
        return;
      }
    }

    alert("Mock checkout complete.");
    loadBoxes(user);
  };

  const updateFulfillmentStatus = async (boxId, fulfillmentStatus, boxStatus) => {
    const updates = {
      fulfillment_status: fulfillmentStatus,
    };

    if (boxStatus) {
      updates.status = boxStatus;
    }

    const { error } = await supabase
      .from("boxes")
      .update(updates)
      .eq("id", boxId);

    if (error) alert(error.message);
    else loadBoxes(user);
  };

  const payShipping = async (boxId, shipmentId) => {
    if (!shipmentId) {
      alert("Shipment details are still loading. Please refresh and try again.");
      return;
    }

    const confirmed = window.confirm("Mock pay shipping now?");
    if (!confirmed) return;

    const { error: shipmentError } = await supabase
      .from("shipments")
      .update({
        shipping_status: "paid",
        charge_status: "paid",
        charge_attempted_at: new Date().toISOString(),
        charge_failure_reason: null,
      })
      .eq("id", shipmentId)
      .eq("user_id", user.id);

    if (shipmentError) {
      alert(shipmentError.message);
      return;
    }

    const { error: boxError } = await supabase
      .from("boxes")
      .update({ fulfillment_status: "ready_to_ship_to_customer" })
      .eq("id", boxId);

    if (boxError) {
      alert(boxError.message);
      return;
    }

    alert("Shipping payment complete. Your bin is now marked as shipped.");
    loadBoxes(user);
  };

  const generateLabel = async (shipment, box) => {
    if (!shipment?.id) {
      alert("Shipment not found.");
      return;
    }

    const confirmed = window.confirm(`Generate a mock shipping label for box ${box.id}?`);
    if (!confirmed) return;

    const fakeTrackingNumber = `STORK-${box.id}-${String(Date.now()).slice(-6)}`;
    const fakeTrackingUrl = `https://tracking.storkbin.com/${fakeTrackingNumber}`;
    const fakeLabelUrl = `https://labels.storkbin.com/${fakeTrackingNumber}.pdf`;

    const { error: shipmentError } = await supabase
      .from("shipments")
      .update({
        carrier: "MockFedEx",
        tracking_number: fakeTrackingNumber,
        tracking_url: fakeTrackingUrl,
        label_url: fakeLabelUrl,
        label_status: shipment.shipment_direction === "to_storage" ? "emailed" : "printed",
        shipping_status: "label_created",
      })
      .eq("id", shipment.id)
      .eq("user_id", user.id);

    if (shipmentError) {
      alert(shipmentError.message);
      return;
    }

    const { error: boxError } = await supabase
      .from("boxes")
      .update({
        fulfillment_status: "label_created",
      })
      .eq("id", box.id);

    if (boxError) {
      alert(boxError.message);
      return;
    }

    alert(
      shipment.shipment_direction === "to_storage"
        ? "Mock label generated and marked as emailed to the customer."
        : "Mock label generated and marked as ready to print."
    );

    loadBoxes(user);
  };

  const markShipmentInTransit = async (shipment, box) => {
    if (!shipment?.id) {
      alert("Shipment not found.");
      return;
    }

    const confirmed = window.confirm(`Mark shipment for box ${box.id} as in transit?`);
    if (!confirmed) return;

    const nextFulfillmentStatus =
      shipment.shipment_direction === "to_storage"
        ? "awaiting_storage_arrival"
        : "shipped_to_customer";

    const nextBoxStatus =
      shipment.shipment_direction === "to_storage"
        ? "in_transit_to_storage"
        : "in_transit_to_customer";

    const { error: shipmentError } = await supabase
      .from("shipments")
      .update({
        shipping_status: "in_transit",
      })
      .eq("id", shipment.id)
      .eq("user_id", user.id);

    if (shipmentError) {
      alert(shipmentError.message);
      return;
    }

    const { error: boxError } = await supabase
      .from("boxes")
      .update({
        status: nextBoxStatus,
        fulfillment_status: nextFulfillmentStatus,
      })
      .eq("id", box.id);

    if (boxError) {
      alert(boxError.message);
      return;
    }

    alert("Shipment marked in transit.");
    loadBoxes(user);
  };

  const markShipmentDelivered = async (shipment, box) => {
    if (!shipment?.id) {
      alert("Shipment not found.");
      return;
    }

    const confirmed = window.confirm(
      shipment.shipment_direction === "to_storage"
        ? `Mark box ${box.id} as received into storage?`
        : `Mark box ${box.id} as delivered to customer?`
    );

    if (!confirmed) return;

    const deliveredToStorage = shipment.shipment_direction === "to_storage";

    const { error: shipmentError } = await supabase
      .from("shipments")
      .update({
        shipping_status: "delivered",
      })
      .eq("id", shipment.id)
      .eq("user_id", user.id);

    if (shipmentError) {
      alert(shipmentError.message);
      return;
    }

    const { error: boxError } = await supabase
      .from("boxes")
      .update({
        status: deliveredToStorage ? "stored" : "at_customer",
        fulfillment_status: deliveredToStorage ? "stored" : "bin_with_customer",
      })
      .eq("id", box.id);

    if (boxError) {
      alert(boxError.message);
      return;
    }

    alert(deliveredToStorage ? "Box marked stored." : "Box marked with customer.");
    loadBoxes(user);
  };

const requestReturn = async (boxId) => {
  const box = boxes.find((b) => b.id === boxId);

  if (!box) {
    alert("Box not found.");
    return;
  }

  const shippingChoice = await chooseShippingAddressForBox(box);

  if (!shippingChoice) return;

  const { error } = await supabase
    .from("boxes")
    .update({
      checkout_status: "in_cart",
      cart_type: "ship_to_customer",
      requested_shipping_address: shippingChoice.address,
      requested_shipping_address_source: shippingChoice.source,
    })
    .eq("id", boxId);

  if (error) {
    alert(error.message);
  } else {
    alert("Added to cart. Complete checkout to ship your bin to the selected address.");
    loadBoxes(user);
  }
};

  const requestCancellation = async (boxId, shippingPreference) => {
    const box = boxes.find((b) => b.id === boxId);

    if (!box) {
      alert("Box not found.");
      return;
    }

    const boxIsStored = box.status === "stored";
    const subscriptionEndsAt = getCancellationEndDate(box);

    let cancellationShippingAddress = null;
    let cancellationShippingAddressSource = null;

    if (boxIsStored) {
      if (!shippingPreference?.source) {
        alert("Please choose a return shipping address.");
        return;
      }

      cancellationShippingAddressSource = shippingPreference.source;

      if (shippingPreference.source === "custom") {
        const customAddress = shippingPreference.address || {};

        if (
          !customAddress.address_line1?.trim() ||
          !customAddress.city?.trim() ||
          !customAddress.state?.trim() ||
          !customAddress.zip?.trim()
        ) {
          alert("Please enter a complete shipping address.");
          return;
        }

        cancellationShippingAddress = {
          full_name: customAddress.full_name || "",
          email: customAddress.email || user.email || "",
          address_line1: customAddress.address_line1.trim(),
          address_line2: customAddress.address_line2 || "",
          city: customAddress.city.trim(),
          state: customAddress.state.trim(),
          zip: customAddress.zip.trim(),
        };
      } else {
        cancellationShippingAddress = await getProfileShippingAddress(user, box);

        if (!cancellationShippingAddress) {
          alert("We could not find your address on file. Please enter a different shipping address.");
          return;
        }
      }
    }

    const confirmed = window.confirm(
      boxIsStored
        ? "Your subscription will end after your 6-month minimum term. If your bin is still in storage on that date, we’ll automatically bill your card on file and ship it to your selected address. If billing fails, the bin will not ship until payment is resolved. Continue?"
        : "Your subscription will end after your 6-month minimum term. Continue?"
    );

    if (!confirmed) return;

    const updates = {
      cancel_requested_at: new Date().toISOString(),
      cancel_status: "requested",
      subscription_ends_at: subscriptionEndsAt.toISOString(),
      cancel_reviewed_at: null,
      cancel_review_note: null,
    };

    if (boxIsStored) {
      updates.cancellation_shipping_address = cancellationShippingAddress;
      updates.cancellation_shipping_address_source =
        cancellationShippingAddressSource;
      updates.cancellation_shipping_charge_status = "pending_auto_charge";
    }

    const { error } = await supabase
      .from("boxes")
      .update(updates)
      .eq("id", boxId);

    if (error) {
      alert(error.message);
    } else {
      alert(
        `Cancellation requested. Your subscription will end on ${subscriptionEndsAt.toLocaleDateString(
          undefined,
          {
            month: "long",
            day: "numeric",
            year: "numeric",
          }
        )}.`
      );
      loadBoxes(user);
    }
  };

  const approveCancellation = async (boxId) => {
    const confirmed = window.confirm(
      "Approve this cancellation request? The subscription will end on the scheduled end date."
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("boxes")
      .update({
        cancel_status: "approved",
        cancel_reviewed_at: new Date().toISOString(),
        cancel_review_note: "Approved by admin",
      })
      .eq("id", boxId);

    if (error) {
      alert(error.message);
    } else {
      alert("Cancellation approved.");
      loadBoxes(user);
    }
  };

  const rejectCancellation = async (boxId) => {
    const confirmed = window.confirm(
      "Reject this cancellation request? This will keep the subscription active."
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("boxes")
      .update({
        cancel_status: "rejected",
        cancel_reviewed_at: new Date().toISOString(),
        cancel_review_note: "Rejected by admin",
        subscription_ends_at: null,
        cancellation_shipping_address: null,
        cancellation_shipping_address_source: null,
        cancellation_shipping_charge_status: null,
      })
      .eq("id", boxId);

    if (error) {
      alert(error.message);
    } else {
      alert("Cancellation rejected.");
      loadBoxes(user);
    }
  };

  const overrideCancellationEndDate = async (boxId) => {
    const dateInput = window.prompt(
      "Enter the new subscription end date in YYYY-MM-DD format:"
    );

    if (!dateInput) return;

    const overrideDate = new Date(`${dateInput}T00:00:00`);

    if (Number.isNaN(overrideDate.getTime())) {
      alert("Invalid date. Please use YYYY-MM-DD format.");
      return;
    }

    const { error } = await supabase
      .from("boxes")
      .update({
        cancel_status: "approved",
        subscription_ends_at: overrideDate.toISOString(),
        cancel_reviewed_at: new Date().toISOString(),
        cancel_review_note: `Admin override: end date set to ${dateInput}`,
      })
      .eq("id", boxId);

    if (error) {
      alert(error.message);
    } else {
      alert("Subscription end date overridden.");
      loadBoxes(user);
    }
  };

const sendBackToStorage = async (boxId) => {
  const box = boxes.find((b) => b.id === boxId);

  if (!box) {
    alert("Box not found.");
    return;
  }

  const shippingChoice = await chooseShippingAddressForBox(box, {
    mode: "from_customer",
    addressRole: "Ship-from contact",
  });

  if (!shippingChoice) return;

  const { error } = await supabase
    .from("boxes")
    .update({
      checkout_status: "in_cart",
      cart_type: "return_to_storage",
      requested_shipping_address: shippingChoice.address,
      requested_shipping_address_source: shippingChoice.source,
    })
    .eq("id", boxId);

  if (error) {
    alert(error.message);
  } else {
    alert("Added to cart. Complete checkout to receive your return shipping label.");
    loadBoxes(user);
  }
};

  const deleteDraftBox = async (boxId) => {
    const box = boxes.find((b) => b.id === boxId);

    if (!box) {
      alert("Box not found.");
      return;
    }

    if (box.checkout_status !== "draft") {
      alert("Only draft boxes can be deleted.");
      return;
    }

    const confirmed = window.confirm(
      `Delete draft box ${boxId}? This cannot be undone.`
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("boxes")
      .delete()
      .eq("id", boxId)
      .eq("user_id", user.id)
      .eq("checkout_status", "draft");

    if (error) {
      alert(error.message);
    } else {
      alert("Draft box deleted.");
      loadBoxes(user);
    }
  };

  const addItem = async (boxId) => {
    const box = boxes.find((b) => b.id === boxId);

    if (!box || (box.status !== "at_customer" && box.checkout_status !== "draft")) {
      alert("You can only add items while setting up your bin or when it is with you.");
      return;
    }

    const name = itemNames[boxId];
    const description = itemDescriptions[boxId] || "";
    const imageFile = itemImages[boxId];

    if (!name || !name.trim()) {
      alert("Please enter an item name.");
      return;
    }

    let imageUrl = "";

    if (imageFile) {
      const filePath = `${boxId}/${Date.now()}-${imageFile.name}`;

      const { error: uploadError } = await supabase.storage
        .from("item-images")
        .upload(filePath, imageFile);

      if (uploadError) {
        alert(uploadError.message);
        return;
      }

      const { data } = supabase.storage
        .from("item-images")
        .getPublicUrl(filePath);

      imageUrl = data.publicUrl;
    }

    const { error } = await supabase.from("items").insert([
      {
        box_id: boxId,
        name: name.trim(),
        description,
        image_url: imageUrl,
      },
    ]);

    if (error) {
      alert(error.message);
    } else {
      setItemNames({ ...itemNames, [boxId]: "" });
      setItemDescriptions({ ...itemDescriptions, [boxId]: "" });
      setItemImages({ ...itemImages, [boxId]: null });
      loadItems();
    }
  };

  const deleteItem = async (itemId, boxStatus) => {
    if (boxStatus !== "at_customer") {
      alert("You can only delete items while your bin is with you.");
      return;
    }

    const { error } = await supabase.from("items").delete().eq("id", itemId);

    if (error) {
      alert(error.message);
    } else {
      loadItems();
    }
  };

  const getShipmentForBox = (boxId) => {
    const matchingShipments = shipments.filter((shipment) => shipment.box_id === boxId);

    if (matchingShipments.length === 0) return null;

    return matchingShipments[0];
  };

  if (!user) {
    return (
      <div style={styles.page}>
        <AuthCard
          email={email}
          password={password}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onSignUp={signUp}
          onLogIn={logIn}
        />
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>StorkBin Dashboard</h1>
            <p style={styles.subtitle}>Logged in as {user.email}</p>
          </div>

          <button style={styles.secondaryButton} onClick={logOut}>
            Log Out
          </button>
        </div>

        <Cart
          cartBoxes={cartBoxes}
          cartTotal={cartTotal}
          grandTotal={grandTotal}
          monthlyRate={MONTHLY_RATE}
          setupFee={SETUP_FEE}
          firstMonthTotal={FIRST_MONTH_TOTAL}
          defaultShippingCost={DEFAULT_SHIPPING_COST}
          onRemoveFromCart={removeFromCart}
          onCheckout={checkout}
        />

        <CreateBox
          newBoxId={newBoxId}
          onBoxIdChange={setNewBoxId}
          onCreateBox={createBox}
        />

        <h2 style={styles.sectionTitle}>Your Boxes</h2>

        {boxes.map((box) => {
          const boxItems = items.filter((item) => item.box_id === box.id);
          const shipment = getShipmentForBox(box.id);

          return (
            <BoxCard
              isAdmin={isAdmin}
              key={box.id}
              box={box}
              shipment={shipment}
              boxItems={boxItems}
              activeManageBox={activeManageBox}
              monthlyRate={MONTHLY_RATE}
              onAddToCart={addToCart}
              onRemoveFromCart={removeFromCart}
              onDeleteDraftBox={deleteDraftBox}
              onSetActiveManageBox={setActiveManageBox}
              onRequestReturn={requestReturn}
              onRequestCancellation={requestCancellation}
              onApproveCancellation={approveCancellation}
              onRejectCancellation={rejectCancellation}
              onOverrideCancellationEndDate={overrideCancellationEndDate}
              onSendBackToStorage={sendBackToStorage}
              onUpdateFulfillmentStatus={updateFulfillmentStatus}
              onPayShipping={payShipping}
              onGenerateLabel={generateLabel}
              onMarkShipmentInTransit={markShipmentInTransit}
              onMarkShipmentDelivered={markShipmentDelivered}
              onAddItem={addItem}
              onDeleteItem={deleteItem}
              onItemNameChange={(boxId, value) =>
                setItemNames({ ...itemNames, [boxId]: value })
              }
              onItemDescriptionChange={(boxId, value) =>
                setItemDescriptions({ ...itemDescriptions, [boxId]: value })
              }
              onItemImageChange={(boxId, file) =>
                setItemImages({ ...itemImages, [boxId]: file })
              }
              itemName={itemNames[box.id]}
              itemDescription={itemDescriptions[box.id]}
            />
          );
        })}
      </div>
    </div>
  );
}

export default App;
