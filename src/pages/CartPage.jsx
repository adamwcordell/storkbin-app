import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Cart from "../components/Cart";

function CartPage({ appData }) {
  const location = useLocation();

  useEffect(() => {
    if (!appData.user?.id || typeof appData.refreshAppData !== "function") return;
    void appData.refreshAppData();
  }, [appData.user?.id, appData.refreshAppData, location.key]);

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
      customerEmail={appData.user?.email || ""}
    />
  );
}

export default CartPage;
