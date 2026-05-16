import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Supabase = ReturnType<typeof createClient>;

const getLinkedBoxIds = async (supabase: Supabase, shipment: { id: string; box_id?: string | null }) => {
  const { data: linkedRows, error: linkErr } = await supabase
    .from("shipment_boxes")
    .select("box_id")
    .eq("shipment_id", shipment.id);
  if (linkErr) throw new Error(linkErr.message);
  const ids = (linkedRows || []).map((r: { box_id: string }) => String(r.box_id));
  if (ids.length > 0) return ids;
  return shipment.box_id ? [String(shipment.box_id)] : [];
};

/**
 * Keeps `boxes.status` / `boxes.fulfillment_status` aligned with `shipments.shipping_status`
 * for carrier-driven lifecycle (matches shipment-carrier-simulator semantics).
 *
 * Carrier `exception`: sets `boxes.fulfillment_status` to `shipment_carrier_exception` only —
 * does **not** change `boxes.status` (physical channel: stored / in_transit_to_* / at_customer preserved).
 */
export const applyShipmentLifecycleToBoxes = async (
  supabase: Supabase,
  shipment: { id: string; box_id?: string | null; shipment_direction?: string | null },
  shippingStatus: string,
) => {
  const boxIds = await getLinkedBoxIds(supabase, shipment);
  if (boxIds.length === 0) return;

  let status: string | null = null;
  let fulfillmentStatus: string | null = null;

  if (shippingStatus === "exception") {
    fulfillmentStatus = "shipment_carrier_exception";
  } else if (shippingStatus === "label_created") {
    if (shipment.shipment_direction === "to_storage") {
      fulfillmentStatus = "awaiting_customer_dropoff";
      status = "at_customer";
    } else {
      fulfillmentStatus = "label_created";
    }
  } else if (shippingStatus === "in_transit" || shippingStatus === "out_for_delivery") {
    if (shipment.shipment_direction === "to_customer") {
      status = "in_transit_to_customer";
      fulfillmentStatus = "shipped_to_customer";
    } else if (shipment.shipment_direction === "to_storage") {
      status = "in_transit_to_storage";
      fulfillmentStatus = "awaiting_storage_arrival";
    }
  } else if (shippingStatus === "delivered") {
    if (shipment.shipment_direction === "to_customer") {
      status = "at_customer";
      fulfillmentStatus = "bin_with_customer";
    } else if (shipment.shipment_direction === "to_storage") {
      status = "stored";
      fulfillmentStatus = "stored";
    }
  }

  if (!fulfillmentStatus) return;

  const updates: Record<string, unknown> = {
    fulfillment_status: fulfillmentStatus,
  };
  if (status) updates.status = status;

  const { error } = await supabase.from("boxes").update(updates).in("id", boxIds);
  if (error) throw new Error(error.message);
};
