import Cart from "../components/Cart";

function CartPage({ appData }) {
  return (
    <Cart
      cartBoxes={appData.cartBoxes}
      cartTotal={appData.cartTotal}
      grandTotal={appData.grandTotal}
      monthlyRate={appData.MONTHLY_RATE}
      setupFee={appData.SETUP_FEE}
      firstMonthTotal={appData.FIRST_MONTH_TOTAL}
      defaultShippingCost={appData.DEFAULT_SHIPPING_COST}
      onRemoveFromCart={appData.removeFromCart}
      onCheckout={appData.checkout}
    />
  );
}

export default CartPage;
