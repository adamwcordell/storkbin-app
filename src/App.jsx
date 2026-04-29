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

    setBoxes(data || []);
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

    const { error } = await supabase
      .from("boxes")
      .update({
        checkout_status: "paid",
        fulfillment_status: "paid_waiting_to_ship_bin",
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
  const confirmed = window.confirm(
    "Are you sure you want to cancel your subscription? Your subscription will remain active until the end of your minimum term."
  );

  if (!confirmed) return;

  const { error } = await supabase
    .from("boxes")
    .update({
      cancel_requested_at: new Date().toISOString(),
      cancel_status: "requested",
    })
    .eq("id", boxId);

  if (error) {
    alert(error.message);
  } else {
    alert(
      "Cancellation requested. Your subscription will end after your minimum term."
    );
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
              onAddToCart={addToCart}
              onRemoveFromCart={removeFromCart}
              onSetActiveManageBox={setActiveManageBox}
              onRequestReturn={requestReturn}
              onRequestCancellation={requestCancellation}
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