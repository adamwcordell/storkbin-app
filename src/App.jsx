import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import styles from "./styles/styles"; // ✅ NEW

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

  const [insuranceEnabledInputs, setInsuranceEnabledInputs] = useState({});
  const [declaredValueInputs, setDeclaredValueInputs] = useState({});
  const [activeManageBox, setActiveManageBox] = useState(null);

  const INSURANCE_RATE = 0.01;
  const MONTHLY_RATE = 10;

  const cartBoxes = boxes.filter((box) => box.checkout_status === "in_cart");

  const cartTotal = cartBoxes.reduce(
    (total, box) => total + Number(box.price || 0),
    0
  );

  const insuranceTotal = cartBoxes.reduce((total, box) => {
    const insuranceOn = insuranceEnabledInputs[box.id];
    const declaredValue = Number(declaredValueInputs[box.id] || 0);

    if (!insuranceOn) return total;

    return total + declaredValue * INSURANCE_RATE;
  }, 0);

  const grandTotal = cartTotal + insuranceTotal;

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

    const enabledDefaults = {};
    const valueDefaults = {};

    (data || []).forEach((box) => {
      enabledDefaults[box.id] = !!box.insurance_enable;
      valueDefaults[box.id] = box.declared_value || 0;
    });

    setInsuranceEnabledInputs(enabledDefaults);
    setDeclaredValueInputs(valueDefaults);
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
        price: 50,
        insurance_enable: false,
        declared_value: 0,
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

  const saveInsurance = async (boxId) => {
    const insuranceOn = !!insuranceEnabledInputs[boxId];
    const declaredValue = Number(declaredValueInputs[boxId] || 0);

    if (declaredValue < 0) {
      alert("Declared value cannot be negative.");
      return;
    }

    const { error } = await supabase
      .from("boxes")
      .update({
        insurance_enable: insuranceOn,
        declared_value: declaredValue,
      })
      .eq("id", boxId);

    if (error) alert(error.message);
    else loadBoxes(user);
  };

  const checkout = async () => {
    if (cartBoxes.length === 0) {
      alert("Your cart is empty.");
      return;
    }

    for (const box of cartBoxes) {
      await saveInsurance(box.id);
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
      "We’ll ship your bin back to you. This does not cancel your subscription. Continue?"
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

  const addItem = async (boxId) => {
    const box = boxes.find((b) => b.id === boxId);

    if (
      !box ||
      (box.status !== "at_customer" && box.checkout_status !== "draft")
    ) {
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

  if (!user) {
    return (
      <div style={styles.page}>
        <div style={styles.authCard}>
          <h1 style={styles.title}>StorkBin</h1>
          <p style={styles.subtitle}>Log in or create your account.</p>

          <input
            style={styles.input}
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            style={styles.input}
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <div style={styles.row}>
            <button style={styles.primaryButton} onClick={signUp}>
              Sign Up
            </button>
            <button style={styles.secondaryButton} onClick={logIn}>
              Log In
            </button>
          </div>
        </div>
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

        <div style={styles.cartCard}>
          <h2 style={styles.sectionTitle}>Cart</h2>

          <p><strong>Boxes in cart:</strong> {cartBoxes.length}</p>
          <p><strong>First month subtotal:</strong> ${cartTotal.toFixed(2)}</p>
          <p><strong>Insurance estimate:</strong> ${insuranceTotal.toFixed(2)}</p>
          <h3>Total today: ${grandTotal.toFixed(2)}</h3>

          <p style={styles.smallText}>
            Billed monthly after your first month. Ongoing storage is $
            {MONTHLY_RATE}/month per bin.
          </p>

          {cartBoxes.length === 0 && (
            <p style={styles.mutedText}>Your cart is empty.</p>
          )}

          {cartBoxes.map((box) => {
            const estimatedInsurance =
              Number(declaredValueInputs[box.id] || 0) * INSURANCE_RATE;

            return (
              <div key={box.id} style={styles.cartItem}>
                <strong>{box.id}</strong>

                <div style={styles.priceLine}>
                  First Month: ${Number(box.price || 0).toFixed(2)}
                </div>

                <div style={styles.smallText}>
                  Includes:
                  <br />• StorkBin container
                  <br />• Delivery to your door
                  <br />• Return shipping to storage
                  <br />• First month of storage
                </div>

                <div style={styles.priceLine}>Then: ${MONTHLY_RATE}/month</div>

                <div style={styles.finePrint}>
                  Bin is provided for use and must be returned after delivery. A
                  replacement fee may apply if not returned.
                </div>

                <div style={styles.subPanel}>
                  <h4>Optional Insurance</h4>

                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={!!insuranceEnabledInputs[box.id]}
                      onChange={(e) =>
                        setInsuranceEnabledInputs({
                          ...insuranceEnabledInputs,
                          [box.id]: e.target.checked,
                        })
                      }
                    />
                    Add insurance for this bin
                  </label>

                  <input
                    style={styles.input}
                    type="number"
                    min="0"
                    placeholder="Declared value"
                    value={declaredValueInputs[box.id] || ""}
                    onChange={(e) =>
                      setDeclaredValueInputs({
                        ...declaredValueInputs,
                        [box.id]: e.target.value,
                      })
                    }
                  />

                  <p style={styles.smallText}>
                    Estimated insurance cost: ${estimatedInsurance.toFixed(2)}
                  </p>

                  <button
                    style={styles.secondaryButton}
                    onClick={() => saveInsurance(box.id)}
                  >
                    Save Insurance
                  </button>
                </div>

                <button
                  style={styles.warningButton}
                  onClick={() => removeFromCart(box.id)}
                >
                  Remove from Cart
                </button>
              </div>
            );
          })}

          {cartBoxes.length > 0 && (
            <button style={styles.primaryButton} onClick={checkout}>
              Mock Checkout
            </button>
          )}
        </div>

        <div style={styles.createCard}>
          <h2 style={styles.sectionTitle}>Create a Bin</h2>

          <div style={styles.row}>
            <input
              style={styles.input}
              placeholder="Enter Box ID"
              value={newBoxId}
              onChange={(e) => setNewBoxId(e.target.value)}
            />

            <button style={styles.primaryButton} onClick={createBox}>
              Create Box
            </button>
          </div>
        </div>

        <h2 style={styles.sectionTitle}>Your Boxes</h2>

        {boxes.map((box) => {
          const boxItems = items.filter((item) => item.box_id === box.id);

          return (
            <div key={box.id} style={styles.boxCard}>
              <div style={styles.boxHeader}>
                <div>
                  <h3 style={styles.boxTitle}>{box.id}</h3>
                  <p style={styles.mutedText}>Box Status: {box.status}</p>
                  <p style={styles.mutedText}>Checkout: {box.checkout_status}</p>
                  <p style={styles.mutedText}>
                    Fulfillment: {box.fulfillment_status || "pending"}
                  </p>
                </div>

                {box.checkout_status === "draft" && (
                  <button
                    style={styles.primaryButton}
                    onClick={() => addToCart(box.id)}
                  >
                    Add to Cart
                  </button>
                )}

                {box.checkout_status === "in_cart" && (
                  <button
                    style={styles.warningButton}
                    onClick={() => removeFromCart(box.id)}
                  >
                    Remove from Cart
                  </button>
                )}
              </div>

              {box.checkout_status === "paid" && (
                <div style={styles.panel}>
                  <p style={styles.successText}>Paid — waiting for fulfillment</p>

                  <div style={styles.subPanel}>
                    <h4>Operations Test Controls</h4>
                    <p style={styles.smallText}>
                      These buttons simulate the warehouse/shipping workflow.
                    </p>

                    <div style={styles.row}>
                      <button
                        style={styles.secondaryButton}
                        onClick={() =>
                          updateFulfillmentStatus(
                            box.id,
                            "bin_shipped_to_customer",
                            "in_transit_to_customer"
                          )
                        }
                      >
                        Mark Bin Shipped to Customer
                      </button>

                      <button
                        style={styles.secondaryButton}
                        onClick={() =>
                          updateFulfillmentStatus(
                            box.id,
                            "bin_with_customer",
                            "at_customer"
                          )
                        }
                      >
                        Mark Bin With Customer
                      </button>

                      <button
                        style={styles.secondaryButton}
                        onClick={() =>
                          updateFulfillmentStatus(box.id, "stored", "stored")
                        }
                      >
                        Mark Stored
                      </button>
                    </div>
                  </div>

                  {box.status !== "return_requested" && (
                    <div style={styles.row}>
                      <button
                        style={styles.secondaryButton}
                        onClick={() => setActiveManageBox(box.id)}
                      >
                        Manage Subscription
                      </button>

                      <button
                        style={styles.dangerButton}
                        onClick={() => requestReturn(box.id)}
                      >
                        Send Me My Bin
                      </button>
                    </div>
                  )}

                  {box.status === "return_requested" && (
                    <p style={styles.warningText}>
                      Return requested — preparing shipment
                    </p>
                  )}

                  {activeManageBox === box.id &&
                    box.status !== "return_requested" && (
                      <div style={styles.subPanel}>
                        <h4>Subscription Settings</h4>

                        <label style={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={!!insuranceEnabledInputs[box.id]}
                            onChange={(e) =>
                              setInsuranceEnabledInputs({
                                ...insuranceEnabledInputs,
                                [box.id]: e.target.checked,
                              })
                            }
                          />
                          Enable insurance
                        </label>

                        <input
                          style={styles.input}
                          type="number"
                          min="0"
                          placeholder="Declared value"
                          value={declaredValueInputs[box.id] || ""}
                          onChange={(e) =>
                            setDeclaredValueInputs({
                              ...declaredValueInputs,
                              [box.id]: e.target.value,
                            })
                          }
                        />

                        <div style={styles.row}>
                          <button
                            style={styles.primaryButton}
                            onClick={() => saveInsurance(box.id)}
                          >
                            Save Changes
                          </button>

                          <button
                            style={styles.secondaryButton}
                            onClick={() => setActiveManageBox(null)}
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    )}
                </div>
              )}

              {(box.status === "at_customer" ||
                box.checkout_status === "draft") && (
                <div style={styles.panel}>
                  <h4>Add Inventory Item</h4>

                  <input
                    style={styles.input}
                    placeholder="Item name"
                    value={itemNames[box.id] || ""}
                    onChange={(e) =>
                      setItemNames({
                        ...itemNames,
                        [box.id]: e.target.value,
                      })
                    }
                  />

                  <textarea
                    style={styles.textarea}
                    placeholder="Description"
                    value={itemDescriptions[box.id] || ""}
                    onChange={(e) =>
                      setItemDescriptions({
                        ...itemDescriptions,
                        [box.id]: e.target.value,
                      })
                    }
                  />

                  <input
                    style={styles.fileInput}
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      setItemImages({
                        ...itemImages,
                        [box.id]: e.target.files[0],
                      })
                    }
                  />

                  <button
                    style={styles.primaryButton}
                    onClick={() => addItem(box.id)}
                  >
                    Add Item
                  </button>
                </div>
              )}

              <div style={styles.panel}>
                <h4>Inventory</h4>

                {boxItems.length === 0 && (
                  <p style={styles.mutedText}>No items added yet.</p>
                )}

                {boxItems.map((item) => (
                  <div key={item.id} style={styles.itemCard}>
                    <strong>{item.name}</strong>

                    {item.description && <p>{item.description}</p>}

                    {item.image_url && (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        style={styles.itemImage}
                      />
                    )}

                    {box.status === "at_customer" && (
                      <button
                        style={styles.dangerButton}
                        onClick={() => deleteItem(item.id, box.status)}
                      >
                        Delete Item
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;