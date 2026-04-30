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

  const getCartItemDetails = (box) => {
    if (box.cart_type === "ship_to_customer") {
      return {
        title: "Ship bin to you",
        description: "Shipping only — we’ll prepare this stored bin to ship to the selected address after checkout.",
        amount: defaultShippingCost,
        lines: [
          { label: "Shipping estimate", amount: defaultShippingCost },
          {
            label: `Destination${box.requested_shipping_address_source ? ` (${box.requested_shipping_address_source})` : ""}`,
            text: formatAddress(box.requested_shipping_address) || "Selected address",
          },
        ],
      };
    }

    if (box.cart_type === "return_to_storage") {
      return {
        title: "Return bin to storage",
        description: "Shipping label only — after checkout, you’ll receive a label to send this bin back from the selected address.",
        amount: defaultShippingCost,
        lines: [
          { label: "Shipping label estimate", amount: defaultShippingCost },
          {
            label: `Ship-from address${box.requested_shipping_address_source ? ` (${box.requested_shipping_address_source})` : ""}`,
            text: formatAddress(box.requested_shipping_address) || "Selected ship-from address",
          },
        ],
      };
    }

    return {
      title: "New bin order",
      description: `Includes your bin setup and first month of storage. Future storage is $${monthlyRate}/month.`,
      amount: firstMonthTotal,
      lines: [
        { label: "One-time setup fee", amount: setupFee },
        { label: "First month storage", amount: monthlyRate },
      ],
    };
  };

  const formatMoney = (amount) => `$${Number(amount || 0).toFixed(2)}`;

  return (
    <div style={styles.cartCard}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start" }}>
        <div>
          <h2 style={styles.sectionTitle}>Cart</h2>
          <p style={styles.mutedText}>
            {cartBoxes.length === 0
              ? "Your cart is empty."
              : `${cartBoxes.length} item${cartBoxes.length === 1 ? "" : "s"} in cart`}
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
          {cartBoxes.map((box) => {
            const details = getCartItemDetails(box);

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
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                    <div>
                      <strong>{details.title}</strong>
                      <p style={{ ...styles.smallText, marginTop: "4px" }}>
                        Bin {box.id} · {details.description}
                      </p>
                    </div>
                  </div>

                  <div style={{ marginTop: "12px" }}>
                    {details.lines.map((line) => (
                      <div
                        key={line.label}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "16px",
                          padding: "4px 0",
                        }}
                      >
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
                Shipping prices are mocked for now and will later come from FedEx.
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

export default Cart;
