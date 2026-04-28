import styles from "../styles/styles";

function Cart({
  cartBoxes,
  cartTotal,
  grandTotal,
  monthlyRate,
  setupFee,
  firstMonthTotal,
  onRemoveFromCart,
  onCheckout,
}) {
  return (
    <div style={styles.cartCard}>
      <h2 style={styles.sectionTitle}>Cart</h2>

      <p>
        <strong>Boxes in cart:</strong> {cartBoxes.length}
      </p>

      <h3>Total cost first month: ${grandTotal.toFixed(2)}</h3>

      <p style={styles.smallText}>
        Every month thereafter: ${monthlyRate}/month per bin. Each subscription
        has a 3-month minimum term.
      </p>

      {cartBoxes.length === 0 && (
        <p style={styles.mutedText}>Your cart is empty.</p>
      )}

      {cartBoxes.map((box) => (
        <div key={box.id} style={styles.cartItem}>
          <strong>{box.id}</strong>

          <div style={styles.subPanel}>
            <h4>💰 What You’re Paying For</h4>

            <div style={styles.smallText}>
              📦 Free delivery of your storage bin
              <br />
              💳 ${monthlyRate}/month bin storage fee
              <br />
              🧾 ${setupFee} one-time setup fee (covers your bin purchase)
              <br />
              🚚 Shipping charged only when you request your bin
            </div>

            <div style={styles.priceLine}>
              <strong>Total cost first month:</strong> $
              {firstMonthTotal.toFixed(2)}
            </div>

            <div style={styles.priceLine}>
              <strong>Every month thereafter:</strong> ${monthlyRate}/month
            </div>
          </div>

          <button
            style={styles.warningButton}
            onClick={() => onRemoveFromCart(box.id)}
          >
            Remove from Cart
          </button>
        </div>
      ))}

      {cartBoxes.length > 0 && (
        <button style={styles.primaryButton} onClick={onCheckout}>
          Mock Checkout
        </button>
      )}
    </div>
  );
}

export default Cart;