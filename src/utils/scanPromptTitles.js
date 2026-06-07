/** Warehouse scan modal titles (display bin ref = e.g. Adamwcordell-001). */

export function binQrScanTitle(displayBinRef, { kitIndex, kitTotal } = {}) {
  const ref = String(displayBinRef || "").trim() || "Bin";
  const base = `Scan ${ref} Bin QR`;
  if (kitIndex != null && kitTotal != null && Number(kitTotal) > 1) {
    return `Bin ${kitIndex} of ${kitTotal} — ${base}`;
  }
  return base;
}

export function pickBinQrScanTitle(displayBinRef) {
  return `Pick — ${binQrScanTitle(displayBinRef)}`;
}

export function bayQrScanTitle(bayCode) {
  const code = String(bayCode || "").trim().toUpperCase();
  return code ? `Scan Bay ${code} QR` : "Scan Bay QR";
}

export function shippingLabelScanTitle(trackingNumber) {
  const tracking = String(trackingNumber || "").trim();
  return tracking ? `Scan Shipping Label — ${tracking}` : "Scan Shipping Label";
}
