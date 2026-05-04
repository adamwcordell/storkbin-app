import { useEffect, useRef, useState } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./supabaseClient";
import styles from "./styles/styles";
import AuthCard from "./components/AuthCard";
import AddressChoiceModal from "./components/AddressChoiceModal";
import DateOverrideModal from "./components/DateOverrideModal";
import DashboardPage from "./pages/DashboardPage";
import BoxesPage from "./pages/BoxesPage";
import BoxDetailPage from "./pages/BoxDetailPage";
import CartPage from "./pages/CartPage";
import AccountPage from "./pages/AccountPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import AdminBoxDetailPage from "./pages/AdminBoxDetailPage";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import {
  DEFAULT_EMPTY_BIN_STACK_SIZE,
  DEFAULT_SHIPPING_COST,
  FIRST_MONTH_TOTAL,
  MONTHLY_RATE,
  SETUP_FEE,
  SUBSCRIPTION_PLANS,
  createPlanSnapshotForBox,
} from "./config/subscriptionPlans";


const MINIMUM_TERM_MONTHS = 6;
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

  const [addressChoiceModal, setAddressChoiceModal] = useState(null);
  const addressChoiceResolverRef = useRef(null);

  const [dateOverrideModal, setDateOverrideModal] = useState(null);
  const dateOverrideResolverRef = useRef(null);

  const MOCK_AUTO_CHARGE_SUCCEEDS = true; // Set to false locally to test payment-failed UI
  const INITIAL_CHECKOUT_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.functions.supabase.co/create-initial-checkout";
  const PAYMENT_RECOVERY_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/create-payment-recovery-session";

  const ADMIN_EMAILS = ["adamwcordell@gmail.com"];
  const isAdmin = user && ADMIN_EMAILS.includes(user.email);

  const cartBoxes = boxes.filter(
    (box) =>
      box.checkout_status === "in_cart" ||
      (box.checkout_status === "paid" &&
        (box.cart_type === "ship_to_customer" ||
          box.cart_type === "return_to_storage"))
  );

  const getInitialPurchaseGroups = (boxesToGroup = cartBoxes) => {
    const groups = {};

    boxesToGroup
      .filter((box) => box.cart_type === "initial_purchase")
      .forEach((box) => {
        const groupId = box.subscription_group_id || box.id;

        if (!groups[groupId]) {
          groups[groupId] = {
            groupId,
            boxes: [],
            planName: box.subscription_plan_name || "Bin Subscription",
            setupFee: Number(box.plan_setup_fee ?? SETUP_FEE),
            monthlyRate: Number(box.plan_monthly_rate ?? MONTHLY_RATE),
            binCount: Number(box.plan_bin_count || 1),
          };
        }

        groups[groupId].boxes.push(box);
      });

    return Object.values(groups);
  };

  const initialPurchaseTotal = getInitialPurchaseGroups().reduce(
    (total, group) => total + group.setupFee + group.monthlyRate,
    0
  );

  const shippingCartTotal = cartBoxes.reduce((total, box) => {
    if (
      box.cart_type === "ship_to_customer" ||
      box.cart_type === "return_to_storage"
    ) {
      return total + DEFAULT_SHIPPING_COST;
    }

    return total;
  }, 0);

  const reactivationCartTotal = cartBoxes.reduce((total, box) => {
    if (box.cart_type === "reactivate_subscription") {
      return total + Number(box.price ?? MONTHLY_RATE);
    }

    return total;
  }, 0);

  const cartTotal = initialPurchaseTotal + shippingCartTotal + reactivationCartTotal;
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
      .select("*, shipment_boxes(*)")
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

  const chooseShippingAddressForBox = async (box, options = {}) => {
    const { mode = "to_customer", addressRole = "Recipient" } = options;
    const profileAddress = await getProfileShippingAddress(user, box);

    return new Promise((resolve) => {
      addressChoiceResolverRef.current = resolve;
      setAddressChoiceModal({
        box,
        mode,
        addressRole,
        profileAddress,
        userEmail: user?.email || "",
      });
    });
  };

  const closeAddressChoiceModal = (choice = null) => {
    if (addressChoiceResolverRef.current) {
      addressChoiceResolverRef.current(choice);
      addressChoiceResolverRef.current = null;
    }

    setAddressChoiceModal(null);
  };

  const promptForDateOverride = async (boxId) => {
    return new Promise((resolve) => {
      dateOverrideResolverRef.current = resolve;
      setDateOverrideModal({ boxId });
    });
  };

  const closeDateOverrideModal = (dateInput = null) => {
    if (dateOverrideResolverRef.current) {
      dateOverrideResolverRef.current(dateInput);
      dateOverrideResolverRef.current = null;
    }

    setDateOverrideModal(null);
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
      .eq("user_id", currentUser.id)
      .order("box_number", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });

    if (error) {
      alert(error.message);
      return;
    }

    const loadedBoxes = data || [];
    await processLifecycleUpdates(currentUser, loadedBoxes);

    const { data: refreshedBoxes, error: refreshError } = await supabase
      .from("boxes")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("box_number", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });

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

  const getNextBoxNumbers = (count) => {
    const usedNumbers = new Set(
      boxes.map((box) => box.box_number || box.id).filter(Boolean)
    );

    const numbers = [];
    let candidate = 1;

    while (numbers.length < count) {
      const nextNumber = String(candidate).padStart(3, "0");

      if (!usedNumbers.has(nextNumber)) {
        numbers.push(nextNumber);
        usedNumbers.add(nextNumber);
      }

      candidate += 1;
    }

    return numbers;
  };

  const createSubscriptionPlan = async (planId) => {
    const plan = SUBSCRIPTION_PLANS.find(
      (currentPlan) => currentPlan.id === planId
    );

    if (!plan) {
      alert("Please choose a subscription option.");
      return;
    }

    const subscriptionGroupId = `${user.id.slice(0, 8)}-${Date.now()}`;
    const boxNumbers = getNextBoxNumbers(plan.binCount);

    const planSnapshot = createPlanSnapshotForBox(plan);

    const rows = boxNumbers.map((boxNumber, index) => ({
      id: `${subscriptionGroupId}-${index + 1}`,
      box_number: boxNumber,
      user_id: user.id,
      status: "stored",
      checkout_status: "in_cart",
      fulfillment_status: "pending",
      price: plan.setupFee + plan.monthlyRate,
      cart_type: "initial_purchase",
      subscription_group_id: subscriptionGroupId,
      ...planSnapshot,
    }));

    const { error } = await supabase.from("boxes").insert(rows);

    if (error) {
      alert(error.message);
    } else {
      loadBoxes(user);
    }
  };

  const addSubscriptionReactivationToCart = async (boxId, options = {}) => {
    const hasBin = options.hasBin !== false;

    if (!hasBin) {
      await createSubscriptionPlan("one_bin");
      return;
    }

    const box = boxes.find((currentBox) => currentBox.id === boxId);

    if (!box) {
      alert("Bin not found.");
      return;
    }

    if (box.lifecycle_status === "auction" || box.lifecycle_status === "removed_from_system") {
      alert("This subscription can no longer be reactivated online. Please contact StorkBin.");
      return;
    }

    if (box.status !== "at_customer") {
      alert("Only bins still with the customer can be reactivated online.");
      return;
    }

    const { error } = await supabase
      .from("boxes")
      .update({
        checkout_status: "in_cart",
        cart_type: "reactivate_subscription",
        price: MONTHLY_RATE,
      })
      .eq("id", box.id)
      .eq("user_id", user.id);

    if (error) {
      alert(error.message);
      return;
    }

    loadBoxes(user);
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


  const chunkArray = (items, size) => {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  };


  const getOpenShipmentForBox = async (boxId, direction) => {
    const openStatuses = ["pending_payment", "paid", "label_created", "in_transit"];

    const localMatch = shipments.find(
      (shipment) =>
        shipment.shipment_direction === direction &&
        openStatuses.includes(shipment.shipping_status) &&
        (shipment.box_id === boxId ||
          shipment.shipment_boxes?.some(
            (shipmentBox) => shipmentBox.box_id === boxId
          ))
    );

    if (localMatch) {
      return { shipment: localMatch, error: null };
    }

    const { data, error } = await supabase
      .from("shipment_boxes")
      .select("shipment_id, shipments(*)")
      .eq("box_id", boxId);

    if (error) {
      return { shipment: null, error };
    }

    const remoteMatch = (data || [])
      .map((row) => row.shipments)
      .filter(Boolean)
      .find(
        (shipment) =>
          shipment.shipment_direction === direction &&
          openStatuses.includes(shipment.shipping_status)
      );

    return { shipment: remoteMatch || null, error: null };
  };

  const createStarterShipmentForBoxes = async (shipmentBoxes) => {
    if (!shipmentBoxes?.length) return true;

    const firstBox = shipmentBoxes[0];
    const shippingAddress = await getProfileShippingAddress(user, firstBox);

    if (!shippingAddress) {
      alert(`Missing shipping address for subscription group ${firstBox.subscription_group_id || firstBox.id}.`);
      return false;
    }

    const { data: createdShipment, error: shipmentError } = await supabase
      .from("shipments")
      .insert([
        {
          box_id: firstBox.id,
          user_id: firstBox.user_id,
          shipping_address: shippingAddress,
          shipping_estimate: DEFAULT_SHIPPING_COST,
          shipping_cost: DEFAULT_SHIPPING_COST,
          shipment_direction: "to_customer",
          shipping_status: "paid",
          charge_status: "paid",
          charge_attempted_at: new Date().toISOString(),
          charge_failure_reason: null,
          label_status: "needed",
        },
      ])
      .select("*")
      .single();

    if (shipmentError) {
      alert(shipmentError.message);
      return false;
    }

    const shipmentBoxRows = shipmentBoxes.map((box, index) => ({
      shipment_id: createdShipment.id,
      box_id: box.id,
      user_id: box.user_id,
      stack_position: index + 1,
    }));

    const { error: shipmentBoxesError } = await supabase
      .from("shipment_boxes")
      .insert(shipmentBoxRows);

    if (shipmentBoxesError) {
      alert(shipmentBoxesError.message);
      return false;
    }

    return true;
  };

  const createShipmentForCartBox = async (box, direction, options = {}) => {
    const {
      expectedLabelStatus = "needed",
      shippingStatus = "paid",
      chargeStatus = "paid",
      allowExistingOpenShipment = true,
    } = options;

    if (allowExistingOpenShipment) {
      const { shipment: existingShipment, error: lookupError } =
        await getOpenShipmentForBox(box.id, direction);

      if (lookupError) {
        alert(lookupError.message);
        return false;
      }

      if (existingShipment) {
        return true;
      }
    }

    const shippingAddress =
      box.requested_shipping_address || (await getProfileShippingAddress(user, box));

    if (!shippingAddress) {
      alert(`Missing shipping address for bin ${box.box_number || box.id}.`);
      return false;
    }

    const { data: createdShipment, error } = await supabase
      .from("shipments")
      .insert([
        {
          box_id: box.id,
          user_id: box.user_id,
          shipping_address: shippingAddress,
          shipping_estimate: DEFAULT_SHIPPING_COST,
          shipping_cost: DEFAULT_SHIPPING_COST,
          shipment_direction: direction,
          shipping_status: shippingStatus,
          charge_status: chargeStatus,
          charge_attempted_at: new Date().toISOString(),
          charge_failure_reason: null,
          label_status: expectedLabelStatus,
        },
      ])
      .select("*")
      .single();

    if (error) {
      alert(error.message);
      return false;
    }

    const { error: shipmentBoxError } = await supabase
      .from("shipment_boxes")
      .insert([
        {
          shipment_id: createdShipment.id,
          box_id: box.id,
          user_id: box.user_id,
          stack_position: 1,
        },
      ]);

    if (shipmentBoxError) {
      alert(shipmentBoxError.message);
      return false;
    }

    return true;
  };

  const getPlanIdForInitialPurchaseGroup = (groupBoxes) => {
    const firstBox = groupBoxes[0];

    if (firstBox?.subscription_plan_id) {
      return firstBox.subscription_plan_id;
    }

    const binCount = Number(firstBox?.plan_bin_count || groupBoxes.length || 1);

    if (binCount === 6) return "six_bins";
    if (binCount === 3) return "three_bins";
    return "one_bin";
  };

  const formatCheckoutShippingAddress = (address) => ({
    fullName: address?.full_name || "",
    email: address?.email || user?.email || "",
    addressLine1: address?.address_line1 || "",
    addressLine2: address?.address_line2 || "",
    city: address?.city || "",
    state: address?.state || "",
    zip: address?.zip || "",
    country: "US",
  });

  const startInitialPurchaseStripeCheckout = async (initialPurchaseBoxes) => {
    const groups = Object.values(
      initialPurchaseBoxes.reduce((groupMap, box) => {
        const groupId = box.subscription_group_id || box.id;

        if (!groupMap[groupId]) {
          groupMap[groupId] = [];
        }

        groupMap[groupId].push(box);
        return groupMap;
      }, {})
    );

    if (groups.length !== 1) {
      alert("Please check out one new subscription plan at a time.");
      return;
    }

    const groupBoxes = groups[0];
    const firstBox = groupBoxes[0];
    const planId = getPlanIdForInitialPurchaseGroup(groupBoxes);
    const shippingChoice = await chooseShippingAddressForBox(firstBox, {
      mode: "to_customer",
      addressRole: "Delivery address",
    });

    if (!shippingChoice) return;

    const response = await fetch(INITIAL_CHECKOUT_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId,
        userId: user.id,
        subscriptionGroupId: firstBox.subscription_group_id || firstBox.id,
        cartSubscriptionGroupId: firstBox.subscription_group_id || firstBox.id,
        successUrl: `${window.location.origin}/checkout-success`,
        cancelUrl: `${window.location.origin}/cart?checkout=cancel`,
        shippingAddress: formatCheckoutShippingAddress(shippingChoice.address),
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.checkoutUrl) {
      alert(payload.error || "Stripe checkout could not be started.");
      return;
    }

    window.location.href = payload.checkoutUrl;
  };

  const checkout = async () => {
    if (cartBoxes.length === 0) {
      alert("Your cart is empty.");
      return;
    }

    const initialPurchaseBoxes = cartBoxes.filter(
      (box) => box.cart_type === "initial_purchase"
    );
    const shipToCustomerBoxes = cartBoxes.filter(
      (box) => box.cart_type === "ship_to_customer"
    );
    const returnToStorageBoxes = cartBoxes.filter(
      (box) => box.cart_type === "return_to_storage"
    );
    const reactivationBoxes = cartBoxes.filter(
      (box) => box.cart_type === "reactivate_subscription"
    );

    if (initialPurchaseBoxes.length > 0) {
      if (
        shipToCustomerBoxes.length > 0 ||
        returnToStorageBoxes.length > 0 ||
        reactivationBoxes.length > 0
      ) {
        alert("Please check out new subscription plans separately from shipping or reactivation items.");
        return;
      }

      await startInitialPurchaseStripeCheckout(initialPurchaseBoxes);
      return;
    }

    const confirmed = window.confirm(
      `Mock checkout for $${grandTotal.toFixed(2)}?`
    );

    if (!confirmed) return;

    const now = new Date();
    const renewsAt = new Date(now);
    renewsAt.setMonth(renewsAt.getMonth() + 1);

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

    for (const box of reactivationBoxes) {
      const { error } = await supabase
        .from("boxes")
        .update({
          checkout_status: "paid",
          cart_type: null,
          price: null,
          subscription_lifecycle_status: "active",
          subscription_payment_status: "paid",
          last_payment_failed_at: null,
          lifecycle_deadline_at: null,
          renews_at: renewsAt.toISOString(),
        })
        .eq("id", box.id)
        .eq("user_id", user.id);

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

  const startSubscriptionPaymentRecovery = async (boxId) => {
    const box = boxes.find((currentBox) => currentBox.id === boxId);

    if (!box) {
      alert("Box not found.");
      return;
    }

    if (!box.stripe_subscription_id) {
      alert("This bin does not have a Stripe subscription yet.");
      return;
    }

    const response = await fetch(PAYMENT_RECOVERY_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscriptionId: box.stripe_subscription_id,
        successUrl: `${window.location.origin}/account?payment=success`,
        cancelUrl: `${window.location.origin}/account?payment=cancel`,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.checkoutUrl) {
      alert(payload.error || "Could not start payment recovery.");
      return;
    }

    window.location.href = payload.checkoutUrl;
  };

  const payShipping = async (boxId) => {
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

    const confirmed = window.confirm("Mock update card and recover this payment now?");
    if (!confirmed) return;

    const { data, error } = await supabase.rpc("customer_retry_failed_payment_mock", {
      p_box_id: boxId,
      p_mock_charge_succeeds: true,
    });

    if (error) {
      alert(error.message);
      return;
    }

    const resultMessage = data?.message || "Payment recovery complete.";
    alert(resultMessage);
    loadBoxes(user);
  };

  const payAllFailedPayments = async () => {
    const confirmed = window.confirm(
      "Mock update card and recover all eligible failed payments now?"
    );
    if (!confirmed) return;

    const { data, error } = await supabase.rpc("customer_retry_all_failed_payments_mock", {
      p_mock_charge_succeeds: true,
    });

    if (error) {
      alert(error.message);
      return;
    }

    const recoveredCount = data?.recovered_count ?? 0;
    const skippedCount = data?.skipped_count ?? 0;
    const summary = recoveredCount > 0
      ? `Payment method updated. Recovered ${recoveredCount} payment${recoveredCount === 1 ? "" : "s"}.${skippedCount ? ` ${skippedCount} item${skippedCount === 1 ? "" : "s"} skipped.` : ""}`
      : data?.message || "No eligible failed payments were found.";

    alert(summary);
    loadBoxes(user);
  };


  const generateLabel = async (shipment, box) => {
    if (!shipment?.id) {
      alert("Shipment not found.");
      return;
    }

    const confirmed = window.confirm("Generate label for this shipment?");
    if (!confirmed) return;

    const { error } = await supabase.rpc("admin_generate_label", {
      p_shipment_id: shipment.id,
    });

    if (error) {
      alert(error.message);
      return;
    }

    alert("Label generated.");
    loadBoxes(user);
  };

  const markShipmentInTransit = async (shipment, box) => {
    if (!shipment?.id) {
      alert("Shipment not found.");
      return;
    }

    const confirmed = window.confirm("Mark this shipment in transit?");
    if (!confirmed) return;

    const { error } = await supabase.rpc("admin_mark_shipment_in_transit", {
      p_shipment_id: shipment.id,
    });

    if (error) {
      alert(error.message);
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
        ? "Mark this shipment received into storage?"
        : "Mark this shipment delivered to customer?"
    );

    if (!confirmed) return;

    const { error } = await supabase.rpc("admin_mark_shipment_delivered", {
      p_shipment_id: shipment.id,
    });

    if (error) {
      alert(error.message);
      return;
    }

    alert(
      shipment.shipment_direction === "to_storage"
        ? "Shipment marked stored."
        : "Shipment marked delivered."
    );
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
      checkout_status: "paid",
      cart_type: "ship_to_customer",
      requested_shipping_address: shippingChoice.address,
      requested_shipping_address_source: shippingChoice.source,
    })
    .eq("id", boxId);

  if (error) {
    alert(error.message);
  } else {
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
      cancel_status: "approved",
      subscription_ends_at: subscriptionEndsAt.toISOString(),
      cancel_reviewed_at: new Date().toISOString(),
      cancel_review_note: "Auto-approved customer cancellation",
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
      if (box.stripe_subscription_id) {
        const { error: stripeCancelError } = await supabase.functions.invoke(
          "schedule-stripe-cancellation",
          {
            body: {
              stripeSubscriptionId: box.stripe_subscription_id,
              cancelAt: subscriptionEndsAt.toISOString(),
            },
          }
        );

        if (stripeCancelError) {
          alert(
            "Cancellation was saved in StorkBin, but Stripe could not be scheduled. Please contact support before relying on this cancellation."
          );
          console.error("Stripe cancellation scheduling failed:", stripeCancelError);
        }
      }

      alert(
        `Cancellation scheduled. Your subscription will end on ${subscriptionEndsAt.toLocaleDateString(
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
    const dateInput = await promptForDateOverride(boxId);

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

  if (box.status !== "at_customer" || box.fulfillment_status !== "bin_with_customer") {
    alert("This bin is not currently eligible to be sent back to storage.");
    return;
  }

  const { shipment: existingReturnShipment, error: lookupError } =
    await getOpenShipmentForBox(box.id, "to_storage");

  if (lookupError) {
    alert(lookupError.message);
    return;
  }

  if (existingReturnShipment) {
    alert("A return shipment already exists for this bin.");
    await loadBoxes(user);
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
      checkout_status: "paid",
      cart_type: "return_to_storage",
      requested_shipping_address: shippingChoice.address,
      requested_shipping_address_source: shippingChoice.source,
    })
    .eq("id", boxId);

  if (error) {
    alert(error.message);
  } else {
    loadBoxes(user);
  }
};

  const updateBinName = async (boxId, customerBinName) => {
    const { error } = await supabase
      .from("boxes")
      .update({
        customer_bin_name: customerBinName?.trim() || null,
      })
      .eq("id", boxId)
      .eq("user_id", user.id);

    if (error) {
      alert(error.message);
    } else {
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

  const deleteItem = async (itemId, boxStatus, checkoutStatus = null) => {
    if (boxStatus !== "at_customer" && checkoutStatus !== "draft") {
      alert("You can only delete items while setting up your bin or when it is with you.");
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
    const matchingShipments = shipments.filter(
      (shipment) =>
        shipment.box_id === boxId ||
        shipment.shipment_boxes?.some((shipmentBox) => shipmentBox.box_id === boxId)
    );

    if (matchingShipments.length === 0) return null;

    return matchingShipments[0];
  };

  const appData = {
    user,
    isAdmin,
    boxes,
    items,
    shipments,
    cartBoxes,
    cartTotal,
    grandTotal,
    activeManageBox,
    itemNames,
    itemDescriptions,
    SETUP_FEE,
    MONTHLY_RATE,
    FIRST_MONTH_TOTAL,
    DEFAULT_SHIPPING_COST,
    SUBSCRIPTION_PLANS,
    newBoxId,
    getShipmentForBox,
    setNewBoxId,
    setActiveManageBox,
    setItemNames,
    setItemDescriptions,
    setItemImages,
    addToCart,
    removeFromCart,
    deleteDraftBox,
    updateBinName,
    requestReturn,
    requestCancellation,
    approveCancellation,
    rejectCancellation,
    overrideCancellationEndDate,
    sendBackToStorage,
    updateFulfillmentStatus,
    payShipping,
            startSubscriptionPaymentRecovery,
    payAllFailedPayments,
    generateLabel,
    markShipmentInTransit,
    markShipmentDelivered,
    addItem,
    deleteItem,
    createSubscriptionPlan,
    addSubscriptionReactivationToCart,
    checkout,
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

  const navLinkStyle = ({ isActive }) => ({
    ...styles.navLink,
    ...(isActive ? styles.navLinkActive : {}),
  });

  return (
    <BrowserRouter>
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

          <nav style={styles.navBar}>
            <NavLink to="/" end style={navLinkStyle}>
              Dashboard
            </NavLink>
            <NavLink to="/bins" style={navLinkStyle}>
              My Bins
            </NavLink>
            <NavLink to="/cart" style={navLinkStyle}>
              Cart{cartBoxes.length > 0 ? ` (${cartBoxes.length})` : ""}
            </NavLink>
            <NavLink to="/account" style={navLinkStyle}>
              Account
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin" style={navLinkStyle}>
                Admin
              </NavLink>
            )}
          </nav>

          <Routes>
            <Route path="/" element={<DashboardPage appData={appData} />} />
            <Route path="/bins" element={<BoxesPage appData={appData} />} />
            <Route path="/bins/:boxId" element={<BoxDetailPage appData={appData} />} />
            <Route path="/cart" element={<CartPage appData={appData} />} />
            <Route path="/checkout-success" element={<CheckoutSuccess appData={appData} />} />
            <Route path="/account" element={<AccountPage appData={appData} />} />
            <Route path="/admin" element={<AdminDashboardPage appData={appData} />} />
            <Route path="/admin/boxes/:boxId" element={<AdminBoxDetailPage appData={appData} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>

          {addressChoiceModal && (
            <AddressChoiceModal
              box={addressChoiceModal.box}
              mode={addressChoiceModal.mode}
              addressRole={addressChoiceModal.addressRole}
              profileAddress={addressChoiceModal.profileAddress}
              userEmail={addressChoiceModal.userEmail}
              onCancel={() => closeAddressChoiceModal(null)}
              onSubmit={closeAddressChoiceModal}
            />
          )}

          {dateOverrideModal && (
            <DateOverrideModal
              boxId={dateOverrideModal.boxId}
              onCancel={() => closeDateOverrideModal(null)}
              onSubmit={closeDateOverrideModal}
            />
          )}
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
