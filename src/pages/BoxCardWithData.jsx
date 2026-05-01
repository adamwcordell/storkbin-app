import BoxCard from "../components/BoxCard";

function BoxCardWithData({ appData, box }) {
  const boxItems = appData.items.filter((item) => item.box_id === box.id);
  const shipment = appData.getShipmentForBox(box.id);

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
      onUpdateFulfillmentStatus={appData.updateFulfillmentStatus}
      onPayShipping={appData.payShipping}
      onGenerateLabel={appData.generateLabel}
      onMarkShipmentInTransit={appData.markShipmentInTransit}
      onMarkShipmentDelivered={appData.markShipmentDelivered}
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
    />
  );
}

export default BoxCardWithData;
