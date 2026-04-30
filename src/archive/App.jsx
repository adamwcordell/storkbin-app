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

  const [newBoxId, setNewBoxId] = useState("");

  const [itemNames, setItemNames] = useState({});
  const [itemDescriptions, setItemDescriptions] = useState({});
  const [itemImages, setItemImages] = useState({});

  const [activeManageBox, setActiveManageBox] = useState(null);

  const SETUP_FEE = 35;
  const MONTHLY_RATE = 13;
  const FIRST_MONTH_TOTAL = SETUP_FEE + MONTHLY_RATE;
  const MINIMUM_TERM_MONTHS = 6;

  const ADMIN_EMAILS = ["adamwcordell@gmail.com"];
  const isAdmin = user && ADMIN_EMAILS.includes(user.email);

  const cartBoxes = boxes.filter((box) => box.checkout_status === "in_cart");

  const cartTotal = cartBoxes.length * FIRST_MONTH_TOTAL;
  const grandTotal = cartTotal;

  useEffect(() => {
    const getSessionAndLoadData = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        setUser(session.user);
        await Promise.all([loadBoxes(session.user), loadItems()]);
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

  const processLifecycleUpdates = async (currentUser, currentBoxes) => {
    for (const box of currentBoxes) {
      if (box.checkout_status !== "paid") continue;

      const subscriptionHasEnded =
        box.subscription_ends_at &&
        new Date(box.subscription_ends_at).getTime() <= Date.now();

      console.log("Lifecycle check:", {
        boxId: box.id,
        checkout_status: box.checkout_status,
        cancel_status: box.cancel_status,
        status: box.status,
        fulfillment_status: box.fulfillment_status,
        subscription_ends_at: box.subscription_ends_at,
        subscriptionHasEnded,
      });

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
            alert(`Renewal update failed: ${renewalError.message}`);
          }
        }
      }

      if (
        box.cancel_status === "approved" &&
        box.status === "stored" &&
        subscriptionHasEnded
      ) {
        alert(`Trigger hit for box ${box.id}. Checking shipment/profile.`);

        const { data: existingShipment, error: existingShipmentError } =
          await supabase
            .from("shipments")
            .select("id")
            .eq("box_id", box.id)
            .eq("shipping_status", "pending_payment")
            .maybeSingle();

        if (existingShipmentError) {
          alert(`Shipment lookup failed: ${existingShipmentError.message}`);
          continue;
        }

        if (existingShipment) {
          alert(`Shipment already exists for box ${box.id}.`);
          continue;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", box.user_id)
          .maybeSingle();

        if (profileError || !profile) {
          alert(`No profile/address found for user ${box.user_id}`);
          continue;
        }

        const shippingAddress = {
          full_name: profile.full_name || "",
          email: profile.email || currentUser.email || "",
          address_line1: profile.address_line1 || "",
          address_line2: profile.address_line2 || "",
          city: profile.city || "",
          state: profile.state || "",
          zip: profile.zip || "",
        };

        alert(`Profile found. Creating shipment for box ${box.id}.`);

        const { error: shipmentError } = await supabase
          .from("shipments")
          .insert([
            {
              box_id: box.id,
              user_id: box.user_id,
              shipping_address: shippingAddress,
              shipping_estimate: null,
              shipping_status: "pending_payment",
            },
          ]);

        if (shipmentError) {
          alert(`Shipment insert failed: ${shipmentError.message}`);
          continue;
        }

        const { error: boxUpdateError } = await supabase
          .from("boxes")
          .update({
            fulfillment_status: "shipment_pending_payment",
          })
          .eq("id", box.id);

        if (boxUpdateError) {
          alert(`Box update failed: ${boxUpdateError.message}`);
          continue;
        }

        alert(`Shipment created for box ${box.id}.`);
      }
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
      .update({ checkout_status: "in_cart" })
      .eq("id", boxId)
      .eq("checkout_status", "draft");

    if (error) alert(error.message);
    else loadBoxes(user);
  };

  const removeFromCart = async (boxId) => {
    const { error } = await supabase
      .from("boxes")
      .update({ checkout_status: "draft" })
      .eq("id", boxId)
      .eq("checkout_status", "in_cart");

    if (error) alert(error.message);
    else loadBoxes(user);
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

    const cartBoxIds = cartBoxes.map((box) => box.id);

    const now = new Date();

    const renewsAt = new Date(now);
    renewsAt.setMonth(renewsAt.getMonth() + 1);

    const { error } = await supabase
      .from("boxes")
      .update({
        checkout_status: "paid",
        fulfillment_status: "paid_waiting_to_ship_bin",
        subscription_started_at: now.toISOString(),
        renews_at: renewsAt.toISOString(),
      })
      .in("id", cartBoxIds);

    if (error) {
      alert(error.message);
    } else {
      alert("Mock checkout complete.");
      loadBoxes(user);
    }
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

  const requestReturn = async (boxId) => {
    const confirmed = window.confirm(
      "We’ll ship your bin back to you. Shipping will be charged when requested. Continue?"
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("boxes")
      .update({
        status: "return_requested",
        fulfillment_status: "return_requested",
      })
      .eq("id", boxId);

    if (error) {
      alert(error.message);
    } else {
      setActiveManageBox(null);
      alert("Return requested. We’ll begin processing your shipment.");
      loadBoxes(user);
    }
  };

  const requestCancellation = async (boxId) => {
    const box = boxes.find((b) => b.id === boxId);

    if (!box) {
      alert("Box not found.");
      return;
    }

    const boxIsStored = box.status === "stored";
    const subscriptionEndsAt = getCancellationEndDate(box);

    const confirmed = window.confirm(
      boxIsStored
        ? "Your subscription will end after your 6-month minimum term. If your bin is still in storage on that date, we’ll ship it to your address on file at your expense. Continue?"
        : "Your subscription will end after your 6-month minimum term. Continue?"
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("boxes")
      .update({
        cancel_requested_at: new Date().toISOString(),
        cancel_status: "requested",
        subscription_ends_at: subscriptionEndsAt.toISOString(),
        cancel_reviewed_at: null,
        cancel_review_note: null,
      })
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
    const confirmed = window.confirm(
      "Before sending your bin back, please confirm your inventory is up to date. Any unpacked items should be removed from this bin by clicking the Unpack Item button. Continue?"
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("boxes")
      .update({
        status: "return_to_storage_requested",
        fulfillment_status: "return_to_storage_requested",
      })
      .eq("id", boxId);

    if (error) {
      alert(error.message);
    } else {
      alert("Return to storage requested. We’ll prepare to receive your bin.");
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

          return (
            <BoxCard
              isAdmin={isAdmin}
              key={box.id}
              box={box}
              boxItems={boxItems}
              activeManageBox={activeManageBox}
              monthlyRate={MONTHLY_RATE}
              onAddToCart={addToCart}
              onRemoveFromCart={removeFromCart}
              onSetActiveManageBox={setActiveManageBox}
              onRequestReturn={requestReturn}
              onRequestCancellation={requestCancellation}
              onApproveCancellation={approveCancellation}
              onRejectCancellation={rejectCancellation}
              onOverrideCancellationEndDate={overrideCancellationEndDate}
              onSendBackToStorage={sendBackToStorage}
              onUpdateFulfillmentStatus={updateFulfillmentStatus}
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