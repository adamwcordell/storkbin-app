import styles from "../styles/styles";

function Cart({
  cartBoxes,
  cartTotal,
  insuranceTotal,
  grandTotal,
  monthlyRate,
  insuranceRate,
  insuranceEnabledInputs,
  declaredValueInputs,
  onInsuranceEnabledChange,
  onDeclaredValueChange,
  onSaveInsurance,
  onRemoveFromCart,
  onCheckout,
}) {
  return (
    <div style={styles.cartCard}>
      <h2 style={styles.sectionTitle}>Cart</h2>

      <p><strong>Boxes in cart:</strong> {cartBoxes.length}</p>
      <p><strong>First month subtotal:</strong> ${cartTotal.toFixed(2)}</p>
      <p><strong>Insurance estimate:</strong> ${insuranceTotal.toFixed(2)}</p>
      <h3>Total today: ${grandTotal.toFixed(2)}</h3>

      <p style={styles.smallText}>
        Billed monthly after your first month. Ongoing storage is ${monthlyRate}/month per bin.
      </p>

      {cartBoxes.length === 0 && <p style={styles.mutedText}>Your cart is empty.</p>}

      {cartBoxes.map((box) => {
        const estimatedInsurance = Number(declaredValueInputs[box.id] || 0) * insuranceRate;

        return (
          <div key={box.id} style={styles.cartItem}>
            <strong>{box.id}</strong>

            <div style={styles.priceLine}>First Month: ${Number(box.price || 0).toFixed(2)}</div>

            <div style={styles.smallText}>
              Includes:
              <br />• StorkBin container
              <br />• Delivery to your door
              <br />• Return shipping to storage
              <br />• First month of storage
            </div>

            <div style={styles.priceLine}>Then: ${monthlyRate}/month</div>

            <div style={styles.finePrint}>
              Bin is provided for use and must be returned after delivery. A replacement fee may apply if not
              returned.
            </div>

            <div style={styles.subPanel}>
              <h4>Optional Insurance</h4>

              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={!!insuranceEnabledInputs[box.id]}
                  onChange={(e) => onInsuranceEnabledChange(box.id, e.target.checked)}
                />
                Add insurance for this bin
              </label>

              <input
                style={styles.input}
                type="number"
                min="0"
                placeholder="Declared value"
                value={declaredValueInputs[box.id] || ""}
                onChange={(e) => onDeclaredValueChange(box.id, e.target.value)}
              />

              <p style={styles.smallText}>Estimated insurance cost: ${estimatedInsurance.toFixed(2)}</p>

              <button style={styles.secondaryButton} onClick={() => onSaveInsurance(box.id)}>
                Save Insurance
              </button>
            </div>

            <button style={styles.warningButton} onClick={() => onRemoveFromCart(box.id)}>
              Remove from Cart
            </button>
          </div>
        );
      })}

      {cartBoxes.length > 0 && (
        <button style={styles.primaryButton} onClick={onCheckout}>
          Mock Checkout
        </button>
      )}
    </div>
  );
}

export default Cart;
