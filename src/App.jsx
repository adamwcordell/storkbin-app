import { useEffect, useRef, useState } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import StorkBinLogo from "./components/StorkBinLogo";
import HomePage from "./pages/HomePage";
import HomePageAlt from "./pages/HomePageAlt";
import PublicLoginPage from "./pages/PublicLoginPage";
import PublicSignupPage from "./pages/PublicSignupPage";
import AuthSessionBridgePage from "./pages/AuthSessionBridgePage";
import { supabase, supabaseFunctionAuthHeaders } from "./supabaseClient";
import styles, { colors } from "./styles/styles";
import AddressChoiceModal from "./components/AddressChoiceModal";
import DateOverrideModal from "./components/DateOverrideModal";
import DashboardPage from "./pages/DashboardPage";
import BoxesPage from "./pages/BoxesPage";
import BoxDetailPage from "./pages/BoxDetailPage";
import CartPage from "./pages/CartPage";
import AccountPage from "./pages/AccountPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import AdminBoxDetailPage from "./pages/AdminBoxDetailPage";
import AdminBetaHealthPage from "./pages/AdminBetaHealthPage";
import AdminQrFlowLabPage from "./pages/AdminQrFlowLabPage";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import PublicScanGatePage from "./pages/PublicScanGatePage";
import ScanResolvePage from "./pages/ScanResolvePage";
import {
  BILLING_CYCLES,
  DEFAULT_SHIPPING_COST,
  EARLY_CANCELLATION_FEE_USD,
  FIRST_MONTH_TOTAL,
  MINIMUM_TERM_MONTHS,
  MONTHLY_RATE,
  SETUP_FEE,
  SUBSCRIPTION_PLANS,
  createPlanSnapshotForBox,
  getPlanBillingSummary,
  getSubscriptionPlanById,
  getCancellationEndDate,
  getNextMonthlyDate,
  isWithinMinimumTerm,
} from "./config/subscriptionPlans";
import {
  getEdgeFunctionErrorMessage,
  getEdgeFunctionInvokeFailureDetails,
} from "./utils/edgeFunctionErrors";
function App() {
  const [user, setUser] = useState(null);

  const invokeEdge = async (name, body, options = {}) => {
    const auth = await supabaseFunctionAuthHeaders();
    return supabase.functions.invoke(name, {
      ...options,
      body,
      headers: { ...auth, ...(options.headers || {}) },
    });
  };

  const [boxes, setBoxes] = useState([]);
  const [shippingQuotes, setShippingQuotes] = useState({
    loading: false,
    lines: [],
    error: null,
  });
  /** `lineKey` → FedEx `serviceType` chosen for that cart shipping line (see `quote-cart-shipping`). */
  const [shippingSelections, setShippingSelections] = useState({});
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
  const [cartToast, setCartToast] = useState({ message: "", visible: false });
  const cartToastHideTimeoutRef = useRef(null);
  const cartToastClearTimeoutRef = useRef(null);
  /** Full-screen “preparing Stripe checkout” while edge + Stripe session are created. */
  const [stripeCheckoutPending, setStripeCheckoutPending] = useState(false);

  /** Prevents double-submit duplicate rows while `addItem` is running. */
  const addItemInFlightRef = useRef(new Set());
  /** Avoid hammering `quote-cart-shipping` when `boxes` re-renders with the same shipping cart. */
  const shippingQuoteCacheRef = useRef({ sig: "", fetchedAt: 0, ok: false });
  /** Stores annual/monthly choice per initial purchase cart group for this browser session. */
  const pendingInitialPurchaseBillingRef = useRef({});
  const SHIPPING_QUOTE_MIN_INTERVAL_MS = 5 * 60 * 1000;
  const [shippingQuoteNonce, setShippingQuoteNonce] = useState(0);

  const refreshShippingQuotes = () => {
    shippingQuoteCacheRef.current = { sig: "", fetchedAt: 0, ok: false };
    setShippingQuoteNonce((n) => n + 1);
  };

  const buildShipCartQuoteSignature = (shipCart) =>
    shipCart
      .map((b) => {
        const a = b.requested_shipping_address;
        const addr =
          a &&
          `${String(a.address_line1 || "")}|${String(a.city || "")}|${String(a.state || "")}|${String(a.zip || "")}|${String(a.residential ?? "")}`;
        return `${String(b.id)}|${String(b.cart_type || "")}|${String(b.checkout_status || "")}|${b.return_shipment_empty ? "e" : "f"}|${addr || ""}`;
      })
      .sort()
      .join(";");

  const MOCK_AUTO_CHARGE_SUCCEEDS = true; // Set to false locally to test payment-failed UI
  const INITIAL_CHECKOUT_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.functions.supabase.co/create-initial-checkout";
  const PAYMENT_RECOVERY_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/create-payment-recovery-session";
  const PAYMENT_METHOD_SETUP_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/create-payment-method-setup-session";
  const FINAL_SETTLEMENT_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/create-final-settlement-session";
  const SHIPPING_CHECKOUT_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/create-shipping-checkout-session";
  const CANCEL_SHIPPING_CART_ITEM_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/cancel-shipping-cart-item";
  const AUCTION_SWEEP_FUNCTION_URL = "https://wslymzcbbevnoybbsbgq.supabase.co/functions/v1/sweep-auction-escalations";

  const ADMIN_EMAILS = String(import.meta.env.VITE_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = Boolean(user?.email && ADMIN_EMAILS.includes(user.email.trim().toLowerCase()));

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
          const billingCycle =
            pendingInitialPurchaseBillingRef.current[groupId] || BILLING_CYCLES.MONTHLY;
          const setupFee = Number(box.plan_setup_fee ?? SETUP_FEE);
          const monthlyRate = Number(box.plan_monthly_rate ?? MONTHLY_RATE);
          const billingSummary = getPlanBillingSummary(
            { setupFee, monthlyRate },
            billingCycle
          );
          groups[groupId] = {
            groupId,
            boxes: [],
            planName: box.subscription_plan_name || "Bin Subscription",
            setupFee,
            monthlyRate,
            binCount: Number(box.plan_bin_count || 1),
            billingCycle,
            dueToday: Number(billingSummary.dueToday || 0),
          };
        }

        groups[groupId].boxes.push(box);
      });

    return Object.values(groups);
  };

  const initialPurchaseTotal = getInitialPurchaseGroups().reduce(
    (total, group) =>
      total + Number(group.dueToday ?? group.setupFee + group.monthlyRate),
    0
  );

  const effectiveShippingLineUsd = (line) => {
    const pick = shippingSelections[line.lineKey];
    if (pick && Array.isArray(line.fedexOptions)) {
      const o = line.fedexOptions.find((x) => x.serviceType === pick);
      if (o && Number.isFinite(o.amountUsd)) return o.amountUsd;
    }
    return typeof line.amountUsd === "number" && Number.isFinite(line.amountUsd) ? line.amountUsd : 0;
  };

  const shippingCartTotal = shippingQuotes.lines.reduce((total, line) => total + effectiveShippingLineUsd(line), 0);

  const reactivationCartTotal = cartBoxes.reduce((total, box) => {
    if (box.cart_type === "reactivate_subscription") {
      return total + Number(box.price ?? MONTHLY_RATE);
    }

    return total;
  }, 0);

  const earlyTerminationCartFeeUsd = (() => {
    if (typeof sessionStorage === "undefined") return 0;
    try {
      const raw = sessionStorage.getItem("storkbin_early_term_cart");
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      const id = String(parsed?.boxId || "");
      if (!id) return 0;
      const hasBox = cartBoxes.some(
        (b) =>
          String(b.id) === id &&
          b.cart_type === "ship_to_customer" &&
          b.checkout_status === "in_cart",
      );
      return hasBox ? EARLY_CANCELLATION_FEE_USD : 0;
    } catch {
      return 0;
    }
  })();

  const cartTotal = initialPurchaseTotal + shippingCartTotal + reactivationCartTotal;
  const grandTotal = cartTotal + earlyTerminationCartFeeUsd;

  const showCartToast = (message) => {
    if (cartToastHideTimeoutRef.current) {
      clearTimeout(cartToastHideTimeoutRef.current);
    }
    if (cartToastClearTimeoutRef.current) {
      clearTimeout(cartToastClearTimeoutRef.current);
    }

    setCartToast({ message, visible: true });

    cartToastHideTimeoutRef.current = setTimeout(() => {
      setCartToast((current) => ({ ...current, visible: false }));
    }, 2400);

    cartToastClearTimeoutRef.current = setTimeout(() => {
      setCartToast({ message: "", visible: false });
    }, 3000);
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

  const processLifecycleUpdates = async (currentUser, currentBoxes) => {
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

  const logOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setBoxes([]);
    setItems([]);
    setShipments([]);
    // Avoid staying on /dashboard etc. with logged-out router (AuthSessionBridge “Signing you in…”).
    window.location.replace("/");
  };

  const loadBoxes = async (currentUser) => {
    // Keep auction lifecycle fresh: stored bins past deadline auto-escalate.
    const { data: sweepSessionData } = await supabase.auth.getSession();
    const sweepAccessToken = sweepSessionData?.session?.access_token;
    await fetch(AUCTION_SWEEP_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sweepAccessToken ? { Authorization: `Bearer ${sweepAccessToken}` } : {}),
      },
      body: JSON.stringify({}),
    }).catch((error) => {
      console.warn("Auction sweep failed:", error);
    });

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

  const loadBoxesRef = useRef(loadBoxes);
  loadBoxesRef.current = loadBoxes;
  const userRefForRealtime = useRef(user);
  userRefForRealtime.current = user;

  useEffect(() => {
    if (!user?.id) return undefined;

    let debounceTimer = 0;
    const scheduleBoxDataReload = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = 0;
        const currentUser = userRefForRealtime.current;
        if (currentUser?.id) {
          void loadBoxesRef.current(currentUser);
        }
      }, 400);
    };

    const uid = String(user.id);
    const channel = supabase
      .channel(`customer-box-ship-sync-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "boxes", filter: `user_id=eq.${uid}` },
        scheduleBoxDataReload,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "shipments" }, scheduleBoxDataReload)
      .subscribe();

    return () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      shippingQuoteCacheRef.current = { sig: "", fetchedAt: 0, ok: false };
      setShippingQuotes({ loading: false, lines: [], error: null });
      return undefined;
    }

    const shipCart = boxes.filter(
      (box) =>
        (box.cart_type === "ship_to_customer" || box.cart_type === "return_to_storage") &&
        (box.checkout_status === "in_cart" || box.checkout_status === "paid"),
    );

    if (shipCart.length === 0) {
      shippingQuoteCacheRef.current = { sig: "", fetchedAt: 0, ok: false };
      setShippingQuotes({ loading: false, lines: [], error: null });
      return undefined;
    }

    const sig = buildShipCartQuoteSignature(shipCart);
    const now = Date.now();
    const cache = shippingQuoteCacheRef.current;
    if (cache.ok && cache.sig === sig && now - cache.fetchedAt < SHIPPING_QUOTE_MIN_INTERVAL_MS) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      setShippingQuotes((prev) => ({ ...prev, loading: true, error: null }));
      const headers = await supabaseFunctionAuthHeaders();
      const { data, error } = await supabase.functions.invoke("quote-cart-shipping", {
        body: {},
        headers,
      });
      if (cancelled) return;
      if (error) {
        shippingQuoteCacheRef.current = { sig: "", fetchedAt: 0, ok: false };
        setShippingQuotes({ loading: false, lines: [], error: error.message || "Could not load shipping rates" });
        return;
      }
      if (data?.error) {
        shippingQuoteCacheRef.current = { sig: "", fetchedAt: 0, ok: false };
        setShippingQuotes({ loading: false, lines: [], error: String(data.error) });
        return;
      }
      setShippingQuotes({
        loading: false,
        lines: Array.isArray(data?.lines) ? data.lines : [],
        error: null,
      });
      shippingQuoteCacheRef.current = { sig, fetchedAt: Date.now(), ok: true };
    })();

    return () => {
      cancelled = true;
    };
  }, [boxes, user?.id, shippingQuoteNonce]);

  const loadItems = async () => {
    const { data, error } = await supabase.from("items").select("*");

    if (error) {
      alert(error.message);
      return;
    }

    setItems(data || []);
  };

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
      if (cartToastHideTimeoutRef.current) {
        clearTimeout(cartToastHideTimeoutRef.current);
      }
      if (cartToastClearTimeoutRef.current) {
        clearTimeout(cartToastClearTimeoutRef.current);
      }
    };
    // Intentionally mount-only: bootstrap session; loadBoxes/loadItems are stable for this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, []);

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

  const createSubscriptionPlan = async (planId, options = {}) => {
    const plan = SUBSCRIPTION_PLANS.find(
      (currentPlan) => currentPlan.id === planId
    );
    const billingCycle =
      options.billingCycle === BILLING_CYCLES.ANNUAL
        ? BILLING_CYCLES.ANNUAL
        : BILLING_CYCLES.MONTHLY;

    if (!plan) {
      alert("Please choose a subscription option.");
      return;
    }

    if (options.preventDuplicateInitialCart === true && user?.id) {
      const alreadyInCart = boxes.some(
        (b) =>
          b.user_id === user.id &&
          b.checkout_status === "in_cart" &&
          b.cart_type === "initial_purchase" &&
          String(b.subscription_plan_id || "") === String(plan.id)
      );
      if (alreadyInCart) {
        return;
      }
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
      pendingInitialPurchaseBillingRef.current[subscriptionGroupId] = billingCycle;
      showCartToast(
        `${plan.binCount} bin${plan.binCount === 1 ? "" : "s"} added to cart.`
      );
      loadBoxes(user);
    }
  };

  /** After signup / email confirm: add homepage-selected plan to cart from URL query or sessionStorage. */
  useEffect(() => {
    if (!user?.id) return;

    const url = new URL(window.location.href);
    const pendingPlan = url.searchParams.get("pending_plan");
    const pendingBillingRaw = url.searchParams.get("pending_billing");

    if (pendingPlan) {
      const billingCycle =
        pendingBillingRaw === BILLING_CYCLES.ANNUAL ? BILLING_CYCLES.ANNUAL : BILLING_CYCLES.MONTHLY;
      url.searchParams.delete("pending_plan");
      url.searchParams.delete("pending_billing");
      const nextSearch = url.searchParams.toString();
      window.history.replaceState({}, "", `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`);

      if (SUBSCRIPTION_PLANS.some((p) => p.id === pendingPlan)) {
        sessionStorage.removeItem("storkbin_post_signup");
        void createSubscriptionPlan(pendingPlan, {
          billingCycle,
          preventDuplicateInitialCart: true,
        });
      }
      return;
    }

    const raw = sessionStorage.getItem("storkbin_post_signup");
    if (!raw) return;
    sessionStorage.removeItem("storkbin_post_signup");
    try {
      const parsed = JSON.parse(raw);
      const planId = String(parsed.planId || "").trim();
      const billingCycle =
        parsed.billingCycle === BILLING_CYCLES.ANNUAL ? BILLING_CYCLES.ANNUAL : BILLING_CYCLES.MONTHLY;
      if (!planId || !SUBSCRIPTION_PLANS.some((p) => p.id === planId)) return;
      void createSubscriptionPlan(planId, {
        billingCycle,
        preventDuplicateInitialCart: true,
      });
    } catch {
      /* ignore malformed storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot after signup; avoid re-running on plan fn identity
  }, [user?.id]);

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

    const planMonthly = Number(box.plan_monthly_rate ?? MONTHLY_RATE);
    const binCount = Math.max(1, Number(box.plan_bin_count ?? 1));
    const perBinMonthly = planMonthly / binCount;

    const { error } = await supabase
      .from("boxes")
      .update({
        checkout_status: "in_cart",
        cart_type: "reactivate_subscription",
        price: perBinMonthly,
      })
      .eq("id", box.id)
      .eq("user_id", user.id);

    if (error) {
      alert(error.message);
      return;
    }

    loadBoxes(user);
  };

  /** One click: mark bin for reactivation checkout and open Stripe (subscription first month). */
  const startReactivationStripeCheckout = async (boxId) => {
    if (!user?.id) {
      alert("Please sign in to reactivate.");
      return;
    }

    const box = boxes.find((b) => b.id === boxId);
    if (!box) {
      alert("Bin not found.");
      return;
    }

    if (box.lifecycle_status === "auction" || box.lifecycle_status === "removed_from_system") {
      alert("This subscription can no longer be reactivated online. Please contact StorkBin.");
      return;
    }

    if (box.status !== "at_customer") {
      alert("Only bins still with you can be reactivated online.");
      return;
    }

    if (box.subscription_lifecycle_status !== "terminated") {
      alert("This bin is not eligible for subscription reactivation.");
      return;
    }

    const planMonthly = Number(box.plan_monthly_rate ?? MONTHLY_RATE);
    const binCount = Math.max(1, Number(box.plan_bin_count ?? 1));
    const perBinMonthly = planMonthly / binCount;

    const alreadyInReactivationCart =
      box.checkout_status === "in_cart" && box.cart_type === "reactivate_subscription";

    if (!alreadyInReactivationCart) {
      const { error: prepErr } = await supabase
        .from("boxes")
        .update({
          checkout_status: "in_cart",
          cart_type: "reactivate_subscription",
          price: perBinMonthly,
        })
        .eq("id", box.id)
        .eq("user_id", user.id);

      if (prepErr) {
        alert(prepErr.message);
        return;
      }
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.access_token) {
      alert("Your session expired. Please sign in again.");
      return;
    }

    setStripeCheckoutPending(true);
    try {
      const { data, error } = await invokeEdge("create-reactivation-checkout", {
        boxIds: [boxId],
        appOrigin: typeof window !== "undefined" ? window.location.origin : "",
      });

      if (error || data?.error) {
        setStripeCheckoutPending(false);
        alert(data?.error || error?.message || "Could not start reactivation checkout.");
        return;
      }

      const checkoutUrl = data?.checkoutUrl || data?.url;
      if (!checkoutUrl) {
        setStripeCheckoutPending(false);
        alert("Checkout URL missing. Please try again.");
        return;
      }

      window.location.href = checkoutUrl;
    } catch (e) {
      setStripeCheckoutPending(false);
      alert(e instanceof Error ? e.message : "Could not start reactivation checkout.");
    }
  };

  const addToCart = async (boxId) => {
    const { error } = await supabase
      .from("boxes")
      .update({ checkout_status: "in_cart", cart_type: "initial_purchase" })
      .eq("id", boxId)
      .eq("checkout_status", "draft");

    if (error) alert(error.message);
    else {
      showCartToast("Bin added to cart.");
      loadBoxes(user);
    }
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
        if (groupId) {
          delete pendingInitialPurchaseBillingRef.current[groupId];
        }
        loadBoxes(user);
      }

      return;
    }

    if (box.cart_type === "ship_to_customer" || box.cart_type === "return_to_storage") {
      const { data: cancelSessionData } = await supabase.auth.getSession();
      const cancelAccessToken = cancelSessionData?.session?.access_token;
      const response = await fetch(CANCEL_SHIPPING_CART_ITEM_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cancelAccessToken ? { Authorization: `Bearer ${cancelAccessToken}` } : {}),
        },
        body: JSON.stringify({
          userId: user.id,
          boxId,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(payload.error || "Could not remove shipping item from cart.");
        return;
      }

      try {
        const raw = sessionStorage.getItem("storkbin_early_term_cart");
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.boxId != null && String(parsed.boxId) === String(boxId)) {
          sessionStorage.removeItem("storkbin_early_term_cart");
        }
      } catch {
        /* ignore */
      }

      loadBoxes(user);
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

  const cleanupAbandonedShippingCartShipments = async () => {
    if (!user?.id) return;

    const { data: cleanupSessionData } = await supabase.auth.getSession();
    const cleanupAccessToken = cleanupSessionData?.session?.access_token;
    const response = await fetch(CANCEL_SHIPPING_CART_ITEM_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cleanupAccessToken ? { Authorization: `Bearer ${cleanupAccessToken}` } : {}),
      },
      body: JSON.stringify({
        userId: user.id,
        cleanupOrphans: true,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(payload.error || "Could not clean up abandoned shipping cart shipments.");
      return;
    }

    if (Array.isArray(payload.removedShipmentIds) && payload.removedShipmentIds.length > 0) {
      await loadBoxes(user);
    }
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

  /**
   * Plan id must match how many bins are in the checkout group, or `create-initial-checkout`
   * returns 400 ("Cart does not match this plan"). Prefer stored plan_id only when it agrees
   * with the grouped bin count; otherwise infer from cart size.
   */
  const getPlanIdForInitialPurchaseGroup = (groupBoxes) => {
    const n = groupBoxes.length;
    const firstBox = groupBoxes[0];
    const storedId = firstBox?.subscription_plan_id;
    if (storedId) {
      const plan = getSubscriptionPlanById(storedId);
      if (plan && plan.binCount === n) return storedId;
    }
    if (n === 4) return "four_bins";
    if (n === 2) return "two_bins";
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

    const firstBox = groups[0][0];
    const shippingChoice = await chooseShippingAddressForBox(firstBox, {
      mode: "to_customer",
      addressRole: "Delivery address",
    });

    if (!shippingChoice) return;

    const initialPurchaseGroups = groups.map((groupBoxes) => {
      const first = groupBoxes[0];
      const groupId = first.subscription_group_id || first.id;
      return {
        planId: getPlanIdForInitialPurchaseGroup(groupBoxes),
        subscriptionGroupId: groupId,
        billingCycle:
          pendingInitialPurchaseBillingRef.current[groupId] || BILLING_CYCLES.MONTHLY,
      };
    });

    const firstGroup = initialPurchaseGroups[0] || {};
    const legacyPlanId = firstGroup.planId || "";
    const legacyGroupId = firstGroup.subscriptionGroupId || "";
    const legacyBillingCycle = firstGroup.billingCycle || BILLING_CYCLES.MONTHLY;

    const { data: initialSessionData } = await supabase.auth.getSession();
    const initialAccessToken = initialSessionData?.session?.access_token;

    setStripeCheckoutPending(true);
    try {
      const response = await fetch(INITIAL_CHECKOUT_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(initialAccessToken ? { Authorization: `Bearer ${initialAccessToken}` } : {}),
        },
        body: JSON.stringify({
          userId: user.id,
          initialPurchaseGroups,
          planId: legacyPlanId,
          subscriptionGroupId: legacyGroupId,
          cartSubscriptionGroupId: legacyGroupId,
          billingCycle: legacyBillingCycle,
          successUrl: `${window.location.origin}/checkout-success?flow=initial_purchase&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/cart?checkout=cancel`,
          shippingAddress: formatCheckoutShippingAddress(shippingChoice.address),
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.checkoutUrl) {
        setStripeCheckoutPending(false);
        alert(payload.error || payload.message || `Stripe checkout could not be started (HTTP ${response.status}).`);
        return;
      }

      window.location.href = payload.checkoutUrl;
    } catch (e) {
      setStripeCheckoutPending(false);
      alert(e instanceof Error ? e.message : "Stripe checkout could not be started.");
    }
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

    if (shipToCustomerBoxes.length > 0 || returnToStorageBoxes.length > 0) {
      if (reactivationBoxes.length > 0) {
        alert("Please check out shipping items separately from reactivation items.");
        return;
      }

      if (earlyTerminationCartFeeUsd > 0) {
        if (returnToStorageBoxes.length > 0 || shipToCustomerBoxes.length !== 1) {
          alert(
            "Early termination checkout must include only your stored bin’s ship-to-you order. Remove other bins from the cart or finish checkout separately.",
          );
          return;
        }
      }

      if (shippingQuotes.loading) {
        alert("Shipping rates are still loading. Please wait a moment and try again.");
        return;
      }

      for (const line of shippingQuotes.lines || []) {
        const sel = shippingSelections[line.lineKey];
        if (sel && Array.isArray(line.fedexOptions) && !line.fedexOptions.some((o) => o.serviceType === sel)) {
          alert("A selected shipping option is no longer valid. Wait for rates to refresh and try again.");
          return;
        }
      }

      const shippingSuccessFlow =
        shipToCustomerBoxes.length > 0 && returnToStorageBoxes.length === 0
          ? "customer_retrieval_shipping"
          : returnToStorageBoxes.length > 0 && shipToCustomerBoxes.length === 0
            ? "return_to_storage_shipping"
            : "shipping";

      const { data: shippingSessionData } = await supabase.auth.getSession();
      const shippingAccessToken = shippingSessionData?.session?.access_token;

      setStripeCheckoutPending(true);
      try {
        const response = await fetch(SHIPPING_CHECKOUT_FUNCTION_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(shippingAccessToken ? { Authorization: `Bearer ${shippingAccessToken}` } : {}),
          },
          body: JSON.stringify({
            userId: user.id,
            boxIds: [...shipToCustomerBoxes, ...returnToStorageBoxes].map((box) => box.id),
            successUrl: `${window.location.origin}/checkout-success?flow=${shippingSuccessFlow}&session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${window.location.origin}/cart?checkout=cancel`,
            shippingSelections,
            ...(earlyTerminationCartFeeUsd > 0
              ? { earlyTerminationFeeCents: Math.round(EARLY_CANCELLATION_FEE_USD * 100) }
              : {}),
          }),
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.checkoutUrl) {
          setStripeCheckoutPending(false);
          alert(
            payload.error ||
              payload.message ||
              `Stripe shipping checkout could not be started (HTTP ${response.status}).`
          );
          return;
        }

        window.location.href = payload.checkoutUrl;
      } catch (e) {
        setStripeCheckoutPending(false);
        alert(e instanceof Error ? e.message : "Stripe shipping checkout could not be started.");
      }
      return;
    }

    if (reactivationBoxes.length > 0) {
      const { data: reactivationSession } = await supabase.auth.getSession();
      if (!reactivationSession?.session?.access_token) {
        alert("Your session expired. Please sign in again.");
        return;
      }

      setStripeCheckoutPending(true);
      try {
        const { data, error } = await invokeEdge("create-reactivation-checkout", {
          boxIds: reactivationBoxes.map((box) => box.id),
          appOrigin: typeof window !== "undefined" ? window.location.origin : "",
        });

        if (error || data?.error) {
          setStripeCheckoutPending(false);
          alert(data?.error || error?.message || "Could not start reactivation checkout.");
          return;
        }

        const checkoutUrl = data?.checkoutUrl || data?.url;
        if (!checkoutUrl) {
          setStripeCheckoutPending(false);
          alert("Checkout URL missing. Please try again.");
          return;
        }

        window.location.href = checkoutUrl;
      } catch (e) {
        setStripeCheckoutPending(false);
        alert(e instanceof Error ? e.message : "Could not start reactivation checkout.");
      }
      return;
    }

    alert("Your cart has nothing we can check out right now.");
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
    if (!user?.id) {
      alert("Please sign in before recovering a subscription payment.");
      return;
    }

    const box = boxes.find((currentBox) => currentBox.id === boxId);

    if (!box) {
      alert("Box not found.");
      return;
    }

    if (!box.stripe_subscription_id) {
      alert("This bin does not have a Stripe subscription yet.");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    if (!accessToken) {
      alert("Your session expired. Please sign in again.");
      return;
    }

    setStripeCheckoutPending(true);
    try {
      const response = await fetch(PAYMENT_RECOVERY_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          subscriptionId: box.stripe_subscription_id,
          successUrl: `${window.location.origin}/checkout-success?flow=subscription_payment_recovery`,
          cancelUrl: `${window.location.origin}/account?payment=cancel`,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.checkoutUrl) {
        setStripeCheckoutPending(false);
        alert(payload.error || "Could not start payment recovery.");
        return;
      }

      window.location.href = payload.checkoutUrl;
    } catch (e) {
      setStripeCheckoutPending(false);
      alert(e instanceof Error ? e.message : "Could not start payment recovery.");
    }
  };

  const openPaymentMethodManager = async () => {
    if (!user?.id) {
      alert("Please sign in before updating your payment method.");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      alert("Your session expired. Please sign in again.");
      return;
    }

    setStripeCheckoutPending(true);
    try {
      const response = await fetch(PAYMENT_METHOD_SETUP_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          userId: user.id,
          successUrl: `${window.location.origin}/checkout-success?flow=payment_method_update`,
          cancelUrl: `${window.location.origin}/account?payment_method=cancel`,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.checkoutUrl) {
        setStripeCheckoutPending(false);
        alert(payload.error || "Could not open Stripe payment method setup.");
        return;
      }

      window.location.href = payload.checkoutUrl;
    } catch (e) {
      setStripeCheckoutPending(false);
      alert(e instanceof Error ? e.message : "Could not open Stripe payment method setup.");
    }
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

    const { data: finalSessionData } = await supabase.auth.getSession();
    const finalAccessToken = finalSessionData?.session?.access_token;
    if (!finalAccessToken) {
      alert("Your session expired. Please sign in again.");
      return;
    }

    setStripeCheckoutPending(true);
    try {
      const response = await fetch(FINAL_SETTLEMENT_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${finalAccessToken}`,
        },
        body: JSON.stringify({
          boxId,
          successUrl: `${window.location.origin}/checkout-success?flow=final_settlement&box=${encodeURIComponent(boxId)}`,
          cancelUrl: `${window.location.origin}/account?payment=final-settlement-cancelled&box=${encodeURIComponent(boxId)}`,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.checkoutUrl) {
        setStripeCheckoutPending(false);
        alert(payload.error || "Could not start final shipment payment.");
        return;
      }

      window.location.href = payload.checkoutUrl;
    } catch (error) {
      setStripeCheckoutPending(false);
      alert(error instanceof Error ? error.message : "Could not start final shipment payment.");
    }
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


  const ensureShipmentBoxLink = async (shipment, box) => {
    const shipmentId = shipment?.id;
    const boxId = shipment?.box_id || box?.id;
    const userId = shipment?.user_id || box?.user_id;

    if (!shipmentId || !boxId || !userId) {
      return { ok: true };
    }

    const { data: existingRows, error: lookupError } = await supabase
      .from("shipment_boxes")
      .select("shipment_id")
      .eq("shipment_id", shipmentId)
      .eq("box_id", boxId)
      .limit(1);

    if (lookupError) {
      return { ok: false, error: lookupError };
    }

    if (existingRows?.length) {
      return { ok: true };
    }

    const { error: insertError } = await supabase.from("shipment_boxes").insert([
      {
        shipment_id: shipmentId,
        box_id: boxId,
        user_id: userId,
        stack_position: 1,
      },
    ]);

    return insertError ? { ok: false, error: insertError } : { ok: true };
  };

  const generateLabel = async (shipment, box) => {
    if (!shipment?.id) {
      alert("Shipment not found.");
      return;
    }

    const confirmed = window.confirm("Generate label for this shipment?");
    if (!confirmed) return;

    const linkResult = await ensureShipmentBoxLink(shipment, box);
    if (!linkResult.ok) {
      alert(linkResult.error?.message || "Could not link this shipment to its bin before label generation.");
      return;
    }

    const purchase = await invokeEdge("purchase-shipping-label", {
      shipmentId: shipment.id,
    });
    const purchaseFailure = await getEdgeFunctionInvokeFailureDetails(purchase.error, purchase.data);

    if (!purchase.error && !purchase.data?.error) {
      if (purchase.data?.skipped) {
        alert(String(purchase.data.skipped));
        loadBoxes(user);
        return;
      }
      if (purchase.data?.labelDataUrl) {
        try {
          const dataUrl = String(purchase.data.labelDataUrl);
          const response = await fetch(dataUrl);
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const win = window.open(objectUrl, "_blank", "noopener,noreferrer");
          if (!win) {
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = `shipment-label-${shipment.id || "label"}.pdf`;
            a.rel = "noopener noreferrer";
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
          setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        } catch {
          // Non-blocking: shipment is already updated even if preview fails.
        }
      }
      alert("FedEx label purchased and shipment updated.");
      loadBoxes(user);
      return;
    }

    if (purchaseFailure.preconditionFailed) {
      alert(purchaseFailure.message);
      loadBoxes(user);
      return;
    }

    const purchaseErrorMessage = purchaseFailure.message;

    if (/admin access required/i.test(String(purchaseErrorMessage || ""))) {
      alert(
        `${purchaseErrorMessage}\n\n` +
          "The admin UI uses your Vite env VITE_ADMIN_EMAILS. Creating a carrier label calls the Edge Function purchase-shipping-label, which only allows emails listed in the Supabase secret ADMIN_EMAILS (comma-separated, case-insensitive).\n\n" +
          "Fix: Supabase Dashboard → Project Settings → Edge Functions → Secrets → set ADMIN_EMAILS to include admin@storkbin.com (then redeploy the function if your project requires it).",
      );
      loadBoxes(user);
      return;
    }

    const isStarterOutbound =
      String(shipment?.shipment_direction || "") === "to_customer" &&
      String(box?.fulfillment_status || "") === "paid_waiting_to_ship_bin" &&
      String(box?.checkout_status || "") === "paid";

    if (isStarterOutbound) {
      alert(
        purchaseErrorMessage ||
          "FedEx could not create a label for this starter kit. Check the shipment address and FedEx configuration; starter kits always use live FedEx empty-bin package data (no simulator fallback).",
      );
      loadBoxes(user);
      return;
    }

    const { error } = await supabase.rpc("admin_generate_label", {
      p_shipment_id: shipment.id,
    });

    if (error) {
      // Fallback for local/staging simulation when RPCs are unavailable.
      const { data: simData, error: simError } = await invokeEdge("shipment-carrier-simulator", {
        action: "set_label_created",
        shipmentId: shipment.id,
      });
      if (simError || simData?.error) {
        alert(
          purchaseErrorMessage ||
            error.message ||
            simData?.error ||
            simError?.message ||
            "Could not generate label."
        );
        return;
      }
    }

    alert("Label generated.");
    loadBoxes(user);
  };

  const adminRetryLabelPurchase = async (shipment) => {
    if (!shipment?.id) {
      alert("Shipment not found.");
      return;
    }
    if (!window.confirm("Admin: retry FedEx label purchase for this shipment?")) return;
    const { data, error } = await invokeEdge("beta-ops-admin", {
      action: "retry_label",
      shipmentId: shipment.id,
    });
    if (error || data?.error) {
      const details = await getEdgeFunctionInvokeFailureDetails(error, data);
      alert(details.message || String(data?.error || error?.message || "Retry failed"));
      return;
    }
    if (data?.skipped) {
      alert(String(data.skipped));
    } else {
      alert("Label purchase attempted. Check bin detail for tracking/label.");
    }
    loadBoxes(user);
  };

  const suppressRailAlertsForShipment = async (shipment, hours = 168) => {
    if (!shipment?.id) return;
    if (!window.confirm(`Silence beta rail digest emails for this shipment for ${hours}h?`)) return;
    const { data, error } = await invokeEdge("beta-ops-admin", {
      action: "suppress_rail_alerts",
      shipmentId: shipment.id,
      hours,
    });
    if (error || data?.error) alert(error?.message || data?.error || "Failed");
    else alert("Suppression window updated.");
  };

  const markShipmentInTransit = async (shipment) => {
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
      const { data: betaData, error: betaErr } = await invokeEdge("beta-ops-admin", {
        action: "override_shipping_status",
        shipmentId: shipment.id,
        shippingStatus: "in_transit",
      });
      if (!betaErr && !betaData?.error) {
        alert("Shipment marked in transit.");
        loadBoxes(user);
        return;
      }
      const { data: simData, error: simError } = await invokeEdge("shipment-carrier-simulator", {
        action: "set_in_transit",
        shipmentId: shipment.id,
      });
      if (simError || simData?.error) {
        alert(error.message || betaData?.error || simData?.error || simError?.message || "Could not mark in transit.");
        return;
      }
    }

    alert("Shipment marked in transit.");
    loadBoxes(user);
  };

  const markShipmentDelivered = async (shipment) => {
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
      const { data: betaData, error: betaErr } = await invokeEdge("beta-ops-admin", {
        action: "override_shipping_status",
        shipmentId: shipment.id,
        shippingStatus: "delivered",
      });
      if (!betaErr && !betaData?.error) {
        alert(
          shipment.shipment_direction === "to_storage"
            ? "Shipment marked stored."
            : "Shipment marked delivered."
        );
        loadBoxes(user);
        return;
      }
      const { data: simData, error: simError } = await invokeEdge("shipment-carrier-simulator", {
        action: "set_delivered",
        shipmentId: shipment.id,
      });
      if (simError || simData?.error) {
        alert(error.message || betaData?.error || simData?.error || simError?.message || "Could not mark delivered.");
        return;
      }
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
      return false;
    }

    const shippingChoice = await chooseShippingAddressForBox(box);

    if (!shippingChoice) return false;

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
      return false;
    }
    showCartToast("Bin added to cart.");
    await loadBoxes(user);
    return true;
  };

  const requestCancellation = async (boxId, shippingPreference) => {
    const box = boxes.find((b) => b.id === boxId);

    if (!box) {
      alert("Box not found.");
      return;
    }

    const boxIsStored = box.status === "stored";
    const subscriptionEndsAt = getCancellationEndDate(box);
    const endDateLabel = subscriptionEndsAt.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const reactivatedNoEarlyFee = Boolean(box.early_termination_fee_waived);

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

    const confirmMessage = reactivatedNoEarlyFee
      ? boxIsStored
        ? `Your subscription is scheduled to end on ${endDateLabel}. If your bin is still in storage then, we’ll bill your card on file for return shipping to your selected address before we ship. Continue?`
        : `Your subscription is scheduled to end on ${endDateLabel}. Continue?`
      : boxIsStored
        ? `Your subscription will end after your ${MINIMUM_TERM_MONTHS}-month minimum term. If your bin is still in storage on that date, we’ll automatically bill your card on file and ship it to your selected address. If billing fails, the bin will not ship until payment is resolved. Continue?`
        : `Your subscription will end after your ${MINIMUM_TERM_MONTHS}-month minimum term. Continue?`;

    const confirmed = window.confirm(confirmMessage);

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
        const { error: stripeCancelError } = await invokeEdge("schedule-stripe-cancellation", {
          stripeSubscriptionId: box.stripe_subscription_id,
          cancelAt: subscriptionEndsAt.toISOString(),
        });

        if (stripeCancelError) {
          alert(
            "Cancellation was saved in StorkBin, but Stripe could not be scheduled. Please contact support before relying on this cancellation."
          );
          console.error("Stripe cancellation scheduling failed:", stripeCancelError);
        }
      }

      
      loadBoxes(user);
      window.location.href = "/checkout-success?flow=cancellation_requested";
    }
  };

  const fetchEarlyTerminationQuote = async (boxId) => {
    const { data, error } = await invokeEdge("quote-early-termination", { boxId });

    if (error) {
      return { error: error.message };
    }

    if (data?.error) {
      return { error: data.error };
    }

    return data;
  };

  const startEarlyTerminationCheckout = async (boxId, shippingPreference) => {
    const box = boxes.find((b) => b.id === boxId);

    if (!box) {
      alert("Box not found.");
      return;
    }

    if (!isWithinMinimumTerm(box)) {
      alert("Your minimum term is already complete. Use standard cancellation instead.");
      return;
    }

    const boxIsStored = box.status === "stored";

    if (boxIsStored) {
      if (!shippingPreference?.source) {
        alert("Please choose where we should ship your bin.");
        return;
      }

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
      }

      let cancellationShippingAddress = null;
      const cancellationShippingAddressSource = shippingPreference.source;

      if (shippingPreference.source === "custom") {
        const customAddress = shippingPreference.address || {};
        cancellationShippingAddress = {
          full_name: String(customAddress.full_name || ""),
          email: String(customAddress.email || "").trim() || user.email || "",
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

      const { error } = await supabase
        .from("boxes")
        .update({
          checkout_status: "in_cart",
          cart_type: "ship_to_customer",
          requested_shipping_address: cancellationShippingAddress,
          requested_shipping_address_source: cancellationShippingAddressSource,
        })
        .eq("id", boxId);

      if (error) {
        alert(error.message);
        return;
      }

      try {
        sessionStorage.setItem(
          "storkbin_early_term_cart",
          JSON.stringify({ boxId, shippingPreference, savedAt: Date.now() }),
        );
      } catch {
        alert("Could not open cart (browser storage blocked). Allow storage for this site and try again.");
        return;
      }

      await loadBoxes(user);
      window.location.href = "/cart";
      return;
    }

    try {
      sessionStorage.setItem(
        "storkbin_early_term",
        JSON.stringify({ boxId, shippingPreference, savedAt: Date.now() }),
      );
    } catch {
      alert("Could not start checkout (browser storage blocked). Allow storage for this site and try again.");
      return;
    }

    setStripeCheckoutPending(true);
    try {
      const { data, error } = await invokeEdge("create-early-termination-checkout", {
        boxId,
        appOrigin: typeof window !== "undefined" ? window.location.origin : "",
      });

      if (error || data?.error) {
        sessionStorage.removeItem("storkbin_early_term");
        setStripeCheckoutPending(false);
        alert(data?.error || error?.message || "Could not start early termination checkout.");
        return;
      }

      if (!data?.url) {
        sessionStorage.removeItem("storkbin_early_term");
        setStripeCheckoutPending(false);
        alert("Checkout URL missing. Please try again.");
        return;
      }

      window.location.href = data.url;
    } catch (e) {
      sessionStorage.removeItem("storkbin_early_term");
      setStripeCheckoutPending(false);
      alert(e instanceof Error ? e.message : "Could not start early termination checkout.");
    }
  };

  const completeEarlyTerminationFromCheckout = async (sessionId) => {
    let shippingPreference;
    try {
      const raw = sessionStorage.getItem("storkbin_early_term");
      const parsed = raw ? JSON.parse(raw) : null;
      shippingPreference = parsed?.shippingPreference ?? null;
    } catch {
      shippingPreference = null;
    }

    const { data, error } = await invokeEdge("complete-early-termination", {
      sessionId,
      shippingPreference,
    });

    sessionStorage.removeItem("storkbin_early_term");

    if (error || data?.error) {
      const msg = await getEdgeFunctionErrorMessage(error, data);
      alert(msg || "Could not confirm early termination payment.");
      return { ok: false };
    }

    await loadBoxes(user);
    return { ok: true, warning: data?.warning ? String(data.warning) : null };
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

  const sendBackToStorage = async (boxId, options = {}) => {
    const returnEmpty = Boolean(options.returnEmpty);
    const box = boxes.find((b) => b.id === boxId);

    if (!box) {
      alert("Box not found.");
      return false;
    }

    if (box.status !== "at_customer" || box.fulfillment_status !== "bin_with_customer") {
      alert("This bin is not currently eligible to be sent back to storage.");
      return false;
    }

    if (returnEmpty) {
      const boxItems = items.filter((i) => i.box_id === boxId);
      if (boxItems.length > 0) {
        alert(
          "Returning empty flat needs an empty inventory list on this bin. Open inventory and tap Unpack item on each line before continuing.",
        );
        return false;
      }
    }

    const { shipment: existingReturnShipment, error: lookupError } = await getOpenShipmentForBox(box.id, "to_storage");

    if (lookupError) {
      alert(lookupError.message);
      return false;
    }

    if (existingReturnShipment) {
      alert("A return shipment already exists for this bin.");
      await loadBoxes(user);
      return false;
    }

    const shippingChoice = await chooseShippingAddressForBox(box, {
      mode: "from_customer",
      addressRole: "Ship-from contact",
    });

    if (!shippingChoice) return false;

    const { error } = await supabase
      .from("boxes")
      .update({
        checkout_status: "paid",
        cart_type: "return_to_storage",
        return_shipment_empty: returnEmpty,
        requested_shipping_address: shippingChoice.address,
        requested_shipping_address_source: shippingChoice.source,
      })
      .eq("id", boxId);

    if (error) {
      alert(error.message);
      return false;
    }
    showCartToast("Bin added to cart.");
    await loadBoxes(user);
    return true;
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
      return false;
    }
    await loadBoxes(user);
    return true;
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
    if (addItemInFlightRef.current.has(boxId)) {
      return false;
    }

    const box = boxes.find((b) => b.id === boxId);

    if (!box || (box.status !== "at_customer" && box.checkout_status !== "draft")) {
      alert("You can only add items while setting up your bin or when it is with you.");
      return false;
    }

    const name = itemNames[boxId];
    const description = itemDescriptions[boxId] || "";
    const imageFile = itemImages[boxId];

    if (!name || !name.trim()) {
      alert("Please enter an item name.");
      return false;
    }

    if (!imageFile) {
      alert("Please add a photo of this item before saving.");
      return false;
    }

    addItemInFlightRef.current.add(boxId);
    try {
      const filePath = `${boxId}/${Date.now()}-${imageFile.name}`;

      const { error: uploadError } = await supabase.storage.from("item-images").upload(filePath, imageFile);

      if (uploadError) {
        alert(uploadError.message);
        return false;
      }

      const { data } = supabase.storage.from("item-images").getPublicUrl(filePath);
      const imageUrl = data.publicUrl;

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
        return false;
      }

      setItemNames({ ...itemNames, [boxId]: "" });
      setItemDescriptions({ ...itemDescriptions, [boxId]: "" });
      setItemImages({ ...itemImages, [boxId]: null });
      await loadItems();
      return true;
    } finally {
      addItemInFlightRef.current.delete(boxId);
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

    // Always use the most recent shipment row for customer-facing status messaging.
    // Older rows can remain in history and would otherwise show stale "in transit" states.
    const toMs = (value) => {
      const t = new Date(value || 0).getTime();
      return Number.isFinite(t) ? t : 0;
    };

    return matchingShipments.reduce((latest, current) => {
      const latestTs = Math.max(
        toMs(latest?.created_at),
        toMs(latest?.charge_attempted_at),
        toMs(latest?.label_purchased_at),
      );
      const currentTs = Math.max(
        toMs(current?.created_at),
        toMs(current?.charge_attempted_at),
        toMs(current?.label_purchased_at),
      );
      return currentTs > latestTs ? current : latest;
    }, matchingShipments[0]);
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
    earlyTerminationCartFeeUsd,
    shippingQuotes,
    refreshShippingQuotes,
    shippingSelections,
    setShippingSelections,
    activeManageBox,
    itemNames,
    itemDescriptions,
    itemImages,
    SETUP_FEE,
    MONTHLY_RATE,
    MINIMUM_TERM_MONTHS,
    EARLY_CANCELLATION_FEE_USD,
    FIRST_MONTH_TOTAL,
    DEFAULT_SHIPPING_COST,
    SUBSCRIPTION_PLANS,
    initialPurchaseBillingByGroup: pendingInitialPurchaseBillingRef.current,
    newBoxId,
    getShipmentForBox,
    setNewBoxId,
    setActiveManageBox,
    setItemNames,
    setItemDescriptions,
    setItemImages,
    addToCart,
    removeFromCart,
    cleanupAbandonedShippingCartShipments,
    deleteDraftBox,
    updateBinName,
    requestReturn,
    requestCancellation,
    startEarlyTerminationCheckout,
    fetchEarlyTerminationQuote,
    completeEarlyTerminationFromCheckout,
    approveCancellation,
    rejectCancellation,
    overrideCancellationEndDate,
    sendBackToStorage,
    updateFulfillmentStatus,
    payShipping,
    openPaymentMethodManager,
    startSubscriptionPaymentRecovery,
    payAllFailedPayments,
    generateLabel,
    adminRetryLabelPurchase,
    suppressRailAlertsForShipment,
    invokeEdge,
    markShipmentInTransit,
    markShipmentDelivered,
    addItem,
    deleteItem,
    createSubscriptionPlan,
    addSubscriptionReactivationToCart,
    startReactivationStripeCheckout,
    checkout,
    stripeCheckoutPending,
  };

  const navLinkStyle = ({ isActive }) => ({
    ...styles.navLink,
    ...(isActive ? styles.navLinkActive : {}),
  });

  if (!user) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/home-alt" element={<HomePageAlt />} />
          <Route path="/login" element={<PublicLoginPage />} />
          <Route path="/signup" element={<PublicSignupPage />} />
          <Route path="/dashboard" element={<AuthSessionBridgePage />} />
          <Route path="/account" element={<AuthSessionBridgePage />} />
          <Route path="/checkout-success" element={<CheckoutSuccess />} />
          <Route path="/scan/:boxIdOrToken" element={<PublicScanGatePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <div style={styles.page}>
        <div style={styles.shell}>
          <header style={styles.appStickyHeader}>
            <div style={styles.appStickyHeaderRow}>
              <StorkBinLogo to="/dashboard" showTagline variant="hero" />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: "10px",
                }}
              >
                <p style={{ ...styles.subtitle, marginTop: 0, pointerEvents: "none" }}>
                  Logged in as {user.email}
                </p>
                <button type="button" style={styles.secondaryButton} onClick={logOut}>
                  Log Out
                </button>
              </div>
            </div>
            <nav style={styles.appStickyNavRow} aria-label="Main">
            <NavLink to="/dashboard" end style={navLinkStyle}>
              Dashboard
            </NavLink>
            <NavLink to="/bins" style={navLinkStyle}>
              My Bins
            </NavLink>
            <NavLink to="/cart" end style={navLinkStyle}>
              Cart{cartBoxes.length > 0 ? ` (${cartBoxes.length})` : ""}
            </NavLink>
            <NavLink to="/account" end style={navLinkStyle}>
              Account
            </NavLink>
            {isAdmin && (
              <>
                <NavLink to="/admin" style={navLinkStyle}>
                  Admin
                </NavLink>
                <NavLink to="/admin/beta-health" style={navLinkStyle}>
                  Beta health
                </NavLink>
                <NavLink to="/admin/qr-flow-lab" style={navLinkStyle}>
                  QR lab (temp)
                </NavLink>
              </>
            )}
            </nav>
          </header>

          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage appData={appData} />} />
            <Route path="/bins" element={<BoxesPage appData={appData} />} />
            <Route path="/bins/:boxId" element={<BoxDetailPage appData={appData} />} />
            <Route path="/cart" element={<CartPage appData={appData} />} />
            <Route path="/checkout-success" element={<CheckoutSuccess appData={appData} />} />
            <Route path="/account" element={<AccountPage appData={appData} />} />
            <Route path="/admin" element={<AdminDashboardPage appData={appData} />} />
            <Route path="/admin/beta-health" element={<AdminBetaHealthPage appData={appData} />} />
            <Route path="/admin/qr-flow-lab" element={<AdminQrFlowLabPage appData={appData} />} />
            <Route path="/admin/boxes/:boxId" element={<AdminBoxDetailPage appData={appData} />} />
            <Route path="/scan/:boxIdOrToken" element={<ScanResolvePage appData={appData} />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>

          {addressChoiceModal && (
            <AddressChoiceModal
              key={`addr-${addressChoiceModal.box?.id ?? "x"}-${addressChoiceModal.mode}`}
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

          {cartToast.message && (
            <div
              style={{
                ...styles.cartToast,
                ...(cartToast.visible ? styles.cartToastVisible : styles.cartToastHidden),
              }}
            >
              {cartToast.message}
            </div>
          )}

          {stripeCheckoutPending && (
            <div
              role="status"
              aria-live="polite"
              aria-busy="true"
              style={{
                ...styles.modalOverlay,
                zIndex: 10050,
                flexDirection: "column",
                gap: "16px",
              }}
            >
              <div
                style={{
                  ...styles.modalContent,
                  textAlign: "center",
                  maxWidth: "420px",
                }}
              >
                <p style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: colors.charcoal }}>
                  Preparing secure checkout
                </p>
                <p style={{ margin: "12px 0 0", fontSize: "15px", color: colors.gray, lineHeight: 1.5 }}>
                  Talking to Stripe. This can take a little while—please keep this tab open.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
