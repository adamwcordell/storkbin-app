import BoxCard from "../components/BoxCard";

/** One remove control per starter kit (same subscription_group_id); avoids N “Remove” buttons for N bins. */
function initialPurchaseCartRemoveLeaderId(allBoxes, box) {
  if (
    box.cart_type !== "initial_purchase" ||
    box.checkout_status !== "in_cart" ||
    !box.subscription_group_id
  ) {
    return box.id;
  }
  const siblings = (allBoxes || []).filter(
    (b) =>
      b.cart_type === "initial_purchase" &&
      b.checkout_status === "in_cart" &&
      b.subscription_group_id === box.subscription_group_id,
  );
  if (siblings.length <= 1) return box.id;
  const sorted = [...siblings].sort((a, b) =>
    String(a.box_number || a.id).localeCompare(String(b.box_number || b.id), undefined, {
      numeric: true,
    }),
  );
  return sorted[0]?.id || box.id;
}

function BoxCardWithData({ appData, box, navigateToCartAfterShippingPrep = false, scanMinimalUi = false }) {
  const boxItems = appData.items.filter((item) => item.box_id === box.id);
  const shipment = appData.getShipmentForBox(box.id);
  const starterKitRemoveLeaderId = initialPurchaseCartRemoveLeaderId(appData.boxes, box);
  const showStarterKitBundledHint =
    box.cart_type === "initial_purchase" &&
    box.checkout_status === "in_cart" &&
    box.subscription_group_id &&
    starterKitRemoveLeaderId !== box.id;

  return (
    <BoxCard
      isAdmin={false}
      key={box.id}
      box={box}
      shipment={shipment}
      boxItems={boxItems}
      activeManageBox={appData.activeManageBox}
      monthlyRate={appData.MONTHLY_RATE}
      onAddToCart={appData.addToCart}
      onRemoveFromCart={appData.removeFromCart}
      onDeleteDraftBox={appData.deleteDraftBox}
      onUpdateBinName={appData.updateBinName}
      onSetActiveManageBox={appData.setActiveManageBox}
      onRequestReturn={appData.requestReturn}
      onRequestCancellation={appData.requestCancellation}
      onApproveCancellation={appData.approveCancellation}
      onRejectCancellation={appData.rejectCancellation}
      onOverrideCancellationEndDate={appData.overrideCancellationEndDate}
      onSendBackToStorage={appData.sendBackToStorage}
      onResendReturnLabel={appData.resendReturnLabelEmail}
      navigateToCartAfterShippingPrep={navigateToCartAfterShippingPrep}
      scanMinimalUi={scanMinimalUi}
      onUpdateFulfillmentStatus={appData.updateFulfillmentStatus}
      onPayShipping={appData.payShipping}
      onGenerateLabel={appData.generateLabel}
      onMarkShipmentInTransit={appData.markShipmentInTransit}
      onMarkShipmentDelivered={appData.markShipmentDelivered}
      onStartReactivationCheckout={appData.startReactivationStripeCheckout}
      onAddItem={appData.addItem}
      onDeleteItem={appData.deleteItem}
      onItemNameChange={(boxId, value) =>
        appData.setItemNames({ ...appData.itemNames, [boxId]: value })
      }
      onItemDescriptionChange={(boxId, value) =>
        appData.setItemDescriptions({ ...appData.itemDescriptions, [boxId]: value })
      }
      onItemImageChange={(boxId, file) =>
        appData.setItemImages({ ...appData.itemImages, [boxId]: file })
      }
      itemName={appData.itemNames[box.id]}
      itemDescription={appData.itemDescriptions[box.id]}
      itemImageFile={appData.itemImages[box.id] || null}
      showStarterKitBundledHint={showStarterKitBundledHint}
      customerEmail={appData.user?.email || ""}
    />
  );
}

export default BoxCardWithData;
