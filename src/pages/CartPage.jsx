import { useEffect } from "react";
import Cart from "../components/Cart";

function CartPage({ appData }) {
  useEffect(() => {
    appData.cleanupAbandonedShippingCartShipments?.();
  }, []);

  return (
    <Cart
      cartBoxes={appData.cartBoxes}
      grandTotal={appData.grandTotal}
      earlyTerminationCartFeeUsd={appData.earlyTerminationCartFeeUsd}
      monthlyRate={appData.MONTHLY_RATE}
      setupFee={appData.SETUP_FEE}
      initialPurchaseBillingByGroup={appData.initialPurchaseBillingByGroup}
      shippingQuotes={appData.shippingQuotes}
      refreshShippingQuotes={appData.refreshShippingQuotes}
      shippingSelections={appData.shippingSelections}
      setShippingSelections={appData.setShippingSelections}
      onRemoveFromCart={appData.removeFromCart}
      onCheckout={appData.checkout}
      checkoutBusy={Boolean(appData.stripeCheckoutPending)}
    />
  );
}

export default CartPage;
