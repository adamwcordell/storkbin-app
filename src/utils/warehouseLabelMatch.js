import { supabase } from "../supabaseClient";
import { buildDisplayBinRef, resolveCustomerEmailForBin } from "./binDisplayRef";
import {
  binScanMatchesBox,
  explainLabelScanMismatch,
  validateLabelMatchScan,
} from "./scanMatch";
import { getEdgeFunctionErrorMessage } from "./edgeFunctionErrors";
import { binQrScanTitle, shippingLabelScanTitle } from "./scanPromptTitles";
import { isStarterKitShipmentRow } from "./warehouseBinWorkflow";

export async function fetchShipmentKitBoxIds(shipmentId) {
  const sid = String(shipmentId || "").trim();
  if (!sid) return [];

  const { data, error } = await supabase
    .from("shipment_boxes")
    .select("box_id")
    .eq("shipment_id", sid);

  if (error) throw new Error(error.message);

  return [...new Set((data || []).map((row) => String(row.box_id)).filter(Boolean))];
}

function sortBoxIdsByLabel(a, b, metaById) {
  const la = String(metaById[a]?.boxNumber || metaById[a]?.boxId || a);
  const lb = String(metaById[b]?.boxNumber || metaById[b]?.boxId || b);
  return la.localeCompare(lb, undefined, { numeric: true });
}

/**
 * Bin QR scan(s) + FedEx tracking barcode match.
 * Starter kits: scan every bin on the shipment, then one label barcode (same as admin dashboard).
 */
export async function runWarehouseLabelMatch({
  box,
  assignment,
  scanPrompt,
  invokeEdge,
  kitBoxIds = null,
  assignmentsByBoxId = null,
  displayMetaByBoxId = null,
}) {
  const boxId = String(box.id || "").trim();
  const shipmentId = String(box.latest_shipment_id || "").trim();
  const starterFlow = isStarterKitShipmentRow(box, assignment);

  let kitIds = Array.isArray(kitBoxIds) && kitBoxIds.length ? [...kitBoxIds] : [boxId];
  if (starterFlow && shipmentId && (!kitBoxIds || kitBoxIds.length === 0)) {
    kitIds = await fetchShipmentKitBoxIds(shipmentId);
    if (!kitIds.length) kitIds = [boxId];
  }

  const metaById = displayMetaByBoxId || {};
  const sortedKitIds = [...new Set(kitIds.map((id) => String(id)).filter(Boolean))].sort((a, b) =>
    sortBoxIdsByLabel(a, b, metaById),
  );

  if (starterFlow && sortedKitIds.length > 1) {
    const confirmed = window.confirm(
      `This is a ${sortedKitIds.length}-bin starter kit on one label.\nYou will scan all ${sortedKitIds.length} bin QRs, then the FedEx barcode on the label. Continue?`,
    );
    if (!confirmed) {
      throw new Error("Label match cancelled.");
    }
  }

  const binQrByBoxId = {};

  for (let i = 0; i < sortedKitIds.length; i += 1) {
    const bid = sortedKitIds[i];
    const meta = metaById[bid] || {};
    const displayBinRef =
      meta.displayRef ||
      buildDisplayBinRef({
        email: meta.email || resolveCustomerEmailForBin({ row: box }),
        boxNumber: meta.boxNumber,
        boxId: bid,
      });
    const kitAssignment = assignmentsByBoxId?.[bid] || (bid === boxId ? assignment : null);

    const binScanned = await scanPrompt({
      title: binQrScanTitle(displayBinRef, {
        kitIndex: sortedKitIds.length > 1 ? i + 1 : null,
        kitTotal: sortedKitIds.length > 1 ? sortedKitIds.length : null,
      }),
      scanMode: "qr_url",
      delayScanStartMs: i > 0 ? 1200 : 0,
      decodeCooldownMs: i > 0 ? 800 : 0,
    });

    if (!binScanned || !String(binScanned).trim()) {
      throw new Error(
        sortedKitIds.length > 1
          ? "Each bin QR scan is required to confirm the full kit."
          : "Bin QR scan is required before matching the shipping label.",
      );
    }

    if (!binScanMatchesBox(binScanned, bid, kitAssignment?.bin_qr_code)) {
      throw new Error(
        sortedKitIds.length > 1
          ? `Bin QR scan does not match ${displayBinRef}.`
          : "Bin QR scan does not match this bin.",
      );
    }

    if (starterFlow) {
      binQrByBoxId[bid] = String(binScanned).trim();
    } else if (bid === boxId) {
      binQrByBoxId[bid] = String(binScanned).trim();
    }
  }

  const expectedTracking = String(box.latest_tracking_number || "").trim();
  if (!expectedTracking) {
    throw new Error("No tracking number on this shipment yet. Purchase and print the carrier label from Admin first.");
  }

  const labelQrCode = await scanPrompt({
    title: shippingLabelScanTitle(expectedTracking),
    scanMode: "barcode",
    delayScanStartMs: 2000,
    decodeCooldownMs: 1000,
  });

  if (!labelQrCode || !String(labelQrCode).trim()) {
    throw new Error("Shipping label barcode scan is required to confirm the match.");
  }

  const priorBinScans = Object.values(binQrByBoxId).map((v) => String(v).trim()).filter(Boolean);
  if (
    !validateLabelMatchScan(labelQrCode, expectedTracking, {
      priorBinScans,
    })
  ) {
    throw new Error(
      explainLabelScanMismatch(labelQrCode, expectedTracking, { priorBinScans }),
    );
  }

  const verifyBody = {
    action: "mark_label_verified",
    boxId,
    labelQrCode: String(labelQrCode).trim(),
  };

  if (shipmentId) verifyBody.shipmentId = shipmentId;

  if (starterFlow && Object.keys(binQrByBoxId).length) {
    verifyBody.binQrByBoxId = binQrByBoxId;
  } else {
    verifyBody.binQrScan = binQrByBoxId[boxId] || Object.values(binQrByBoxId)[0];
  }

  const verified = await invokeEdge("admin-storage-ops", verifyBody);
  if (verified.error || verified.data?.error) {
    const detail =
      (await getEdgeFunctionErrorMessage(verified.error, verified.data)) ||
      verified.data?.error ||
      verified.error?.message ||
      "Could not verify label QR match.";
    throw new Error(detail);
  }

  return {
    ok: true,
    matchedTracking: verified.data?.matchedTracking || expectedTracking,
    kitBinCount: sortedKitIds.length,
  };
}
