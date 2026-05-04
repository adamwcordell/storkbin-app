import styles from "../styles/styles";

function Cart({
  cartBoxes,
  grandTotal,
  monthlyRate,
  setupFee,
  firstMonthTotal,
  defaultShippingCost = 18,
  onRemoveFromCart,
  onCheckout,
}) {
  const formatAddress = (address) => {
    if (!address) return "";

    return [
      address.address_line1,
      address.address_line2,
      [address.city, address.state, address.zip].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join(", ");
  };

  const formatMoney = (amount) => `$${Number(amount || 0).toFixed(2)}`;

  const initialPurchaseGroups = Object.values(
    cartBoxes
      .filter((box) => box.cart_type === "initial_purchase")
      .reduce((groups, box) => {
        const groupId = box.subscription_group_id || box.id;

        if (!groups[groupId]) {
          groups[groupId] = {
            groupId,
            boxes: [],
            planName: box.subscription_plan_name || "1 Bin",
            setupFee: Number(box.plan_setup_fee ?? setupFee),
            monthlyRate: Number(box.plan_monthly_rate ?? monthlyRate),
            binCount: Number(box.plan_bin_count || 1),
          };
        }

        groups[groupId].boxes.push(box);
        return groups;
      }, {})
  );

  const shippingBoxes = cartBoxes.filter(
    (box) =>
      box.cart_type === "ship_to_customer" ||
      box.cart_type === "return_to_storage"
  );

  const reactivationBoxes = cartBoxes.filter(
    (box) => box.cart_type === "reactivate_subscription"
  );

  const getShippingDetails = (box) => {
    if (box.cart_type === "ship_to_customer") {
      return {
        title: "Ship bin to you",
        description:
          "Shipping only — we’ll prepare this stored bin to ship to the selected address after checkout.",
        amount: defaultShippingCost,
        lines: [
          { label: "Shipping estimate", amount: defaultShippingCost },
          {
            label: `Destination${
              box.requested_shipping_address_source
                ? ` (${box.requested_shipping_address_source})`
                : ""
            }`,
            text:
              formatAddress(box.requested_shipping_address) ||
              "Selected address",
          },
        ],
      };
    }

    return {
      title: "Return bin to storage",
      description:
        "Shipping label only — after checkout, you’ll receive a label to send this bin back from the selected address.",
      amount: defaultShippingCost,
      lines: [
        { label: "Shipping label estimate", amount: defaultShippingCost },
        {
          label: `Ship-from address${
            box.requested_shipping_address_source
              ? ` (${box.requested_shipping_address_source})`
              : ""
          }`,
          text:
            formatAddress(box.requested_shipping_address) ||
            "Selected ship-from address",
        },
      ],
    };
  };

  return (
    <div style={styles.cartCard}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "16px",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h2 style={styles.sectionTitle}>Cart</h2>
          <p style={styles.mutedText}>
            {cartBoxes.length === 0
              ? "Your cart is empty."
              : `${cartBoxes.length} bin${cartBoxes.length === 1 ? "" : "s"} / shipment item${cartBoxes.length === 1 ? "" : "s"} in cart`}
          </p>
        </div>

        {cartBoxes.length > 0 && (
          <div style={{ textAlign: "right" }}>
            <p style={styles.smallText}>Cart Total</p>
            <h3 style={{ margin: 0 }}>{formatMoney(grandTotal)}</h3>
          </div>
        )}
      </div>

      {cartBoxes.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          {initialPurchaseGroups.map((group) => {
            const amount = group.setupFee + group.monthlyRate;

            return (
              <div
                key={group.groupId}
                style={{
                  ...styles.cartItem,
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: "16px",
                  alignItems: "start",
                }}
              >
                <div>
                  <strong>{group.planName} Subscription</strong>
                        <p style={{ ...styles.smallText, marginTop: "4px" }}>
                    Includes {group.boxes.length} empty bin{group.boxes.length === 1 ? "" : "s"}, setup, first month of storage, and free empty-bin delivery.
                  </p>

                  <div style={{ marginTop: "12px" }}>
                    <div style={lineStyle}>
                      <span style={styles.smallText}>One-time setup fee</span>
                      <span style={styles.smallText}>{formatMoney(group.setupFee)}</span>
                    </div>
                    <div style={lineStyle}>
                      <span style={styles.smallText}>First month storage</span>
                      <span style={styles.smallText}>{formatMoney(group.monthlyRate)}</span>
                    </div>
                    <div style={lineStyle}>
                      <span style={styles.smallText}>Bins</span>
                      <span style={styles.smallText}>
                        {group.boxes.map((box) => box.box_number || box.id).join(", ")}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <strong>{formatMoney(amount)}</strong>
                  <div style={{ marginTop: "10px" }}>
                    <button
                      style={styles.warningButton}
                      onClick={() => onRemoveFromCart(group.boxes[0]?.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {shippingBoxes.map((box) => {
            const details = getShippingDetails(box);

            return (
              <div
                key={box.id}
                style={{
                  ...styles.cartItem,
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: "16px",
                  alignItems: "start",
                }}
              >
                <div>
                  <strong>{details.title}</strong>
                  <p style={{ ...styles.smallText, marginTop: "4px" }}>
                    Bin {box.box_number || box.id} · {details.description}
                  </p>

                  <div style={{ marginTop: "12px" }}>
                    {details.lines.map((line) => (
                      <div key={line.label} style={lineStyle}>
                        <span style={styles.smallText}>{line.label}</span>
                        <span style={styles.smallText}>
                          {line.text || formatMoney(line.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <strong>{formatMoney(details.amount)}</strong>
                  <div style={{ marginTop: "10px" }}>
                    <button
                      style={styles.warningButton}
                      onClick={() => onRemoveFromCart(box.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {reactivationBoxes.map((box) => {
            const amount = Number(box.price ?? monthlyRate);

            return (
              <div
                key={box.id}
                style={{
                  ...styles.cartItem,
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: "16px",
                  alignItems: "start",
                }}
              >
                <div>
                  <strong>Reactivate subscription</strong>
                  <p style={{ ...styles.smallText, marginTop: "4px" }}>
                    Bin {box.box_number || box.id} · Restarts storage billing for a bin you still have.
                  </p>

                  <div style={{ marginTop: "12px" }}>
                    <div style={lineStyle}>
                      <span style={styles.smallText}>Monthly storage</span>
                      <span style={styles.smallText}>{formatMoney(amount)}</span>
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <strong>{formatMoney(amount)}</strong>
                  <div style={{ marginTop: "10px" }}>
                    <button
                      style={styles.warningButton}
                      onClick={() => onRemoveFromCart(box.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "16px",
              paddingTop: "16px",
              borderTop: "1px solid #ddd",
            }}
          >
            <div>
              <strong>Total</strong>
              <p style={styles.smallText}>
                Subscription checkout is mocked for now. Shipping rates will later come from FedEx.
              </p>
            </div>

            <h3 style={{ margin: 0 }}>{formatMoney(grandTotal)}</h3>
          </div>

          <button
            style={{ ...styles.primaryButton, marginTop: "16px", width: "100%" }}
            onClick={onCheckout}
          >
            Mock Checkout
          </button>
        </div>
      )}
    </div>
  );
}

const lineStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  padding: "4px 0",
};

export default Cart;
