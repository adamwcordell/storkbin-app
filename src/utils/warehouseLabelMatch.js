import { getCustomerBinScanUrl } from "./binScanUrl";
import {
  binScanMatchesBox,
  explainLabelScanMismatch,
  labelScanMatchesTracking,
} from "./scanMatch";
import { getEdgeFunctionErrorMessage } from "./edgeFunctionErrors";

/**
 * Run bin QR + shipping label barcode match for a single warehouse outbound bin.
 * Returns { ok: true } or throws with a user-facing message.
 */
export async function runWarehouseLabelMatch({
  box,
  assignment,
  scanPrompt,
  invokeEdge,
}) {
  const boxId = String(box.id || "").trim();
  const binScanned = await scanPrompt({
    title: `Scan bin QR — ${box.box_number || boxId}`,
    message: "Confirm bin QR before matching the shipping label.",
    expectedHint: getCustomerBinScanUrl(boxId) || boxId,
    scanMode: "qr_url",
  });
  if (!binScanned || !String(binScanned).trim()) {
    throw new Error("Bin QR scan is required before matching the shipping label.");
  }
  if (!binScanMatchesBox(binScanned, boxId, assignment?.bin_qr_code)) {
    throw new Error("Bin QR scan does not match this bin.");
  }

  const expectedTracking = String(box.latest_tracking_number || "").trim();
  if (!expectedTracking) {
    throw new Error("No tracking number on this shipment yet. Create the carrier label first.");
  }

  const labelQrCode = await scanPrompt({
    title: `Scan shipping label (${expectedTracking})`,
    message: "Point the camera at the tracking barcode on the printed label — not the bin QR.",
    expectedHint: expectedTracking,
    scanMode: "barcode",
    delayScanStartMs: 2000,
    decodeCooldownMs: 1000,
    manualPlaceholder: expectedTracking,
  });
  if (!labelQrCode || !String(labelQrCode).trim()) {
    throw new Error("Shipping label barcode scan is required to confirm the match.");
  }
  if (!labelScanMatchesTracking(labelQrCode, expectedTracking)) {
    throw new Error(explainLabelScanMismatch(labelQrCode, expectedTracking));
  }

  const verifyBody = {
    action: "mark_label_verified",
    boxId,
    labelQrCode: String(labelQrCode).trim(),
    binQrScan: String(binScanned).trim(),
  };
  if (box.latest_shipment_id) {
    verifyBody.shipmentId = String(box.latest_shipment_id);
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
  };
}
