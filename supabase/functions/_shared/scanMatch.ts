/** Normalize warehouse scanner input for bin ↔ label matching. */

export const normalizeDigits = (raw: unknown) => String(raw || "").replace(/\D/g, "");

/** Extract box id from StorkBin scan URL or raw id string. */
export const parseBoxIdFromBinScan = (raw: unknown): string => {
  const s = String(raw || "").trim();
  if (!s) return "";

  const scanPathMatch = s.match(/\/scan\/([^/?#]+)/i);
  if (scanPathMatch?.[1]) {
    try {
      return decodeURIComponent(scanPathMatch[1]).trim();
    } catch {
      return scanPathMatch[1].trim();
    }
  }

  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p.toLowerCase() === "scan");
      if (idx >= 0 && parts[idx + 1]) {
        return decodeURIComponent(parts[idx + 1]).trim();
      }
    } catch {
      /* fall through */
    }
  }

  return s;
};

export const binScanMatchesBox = (
  scan: unknown,
  boxId: string,
  recordedBinQr?: string | null,
): boolean => {
  const expected = String(boxId || "").trim();
  if (!expected) return false;

  const parsed = parseBoxIdFromBinScan(scan);
  if (parsed && parsed === expected) return true;

  const scanTrim = String(scan || "").trim();
  if (scanTrim && scanTrim === expected) return true;

  const recorded = String(recordedBinQr || "").trim();
  if (recorded) {
    if (scanTrim === recorded) return true;
    if (parseBoxIdFromBinScan(recorded) === expected && parsed === expected) return true;
  }

  return false;
};

/** FedEx label barcodes are usually the tracking number (digits). */
export const labelScanMatchesTracking = (
  labelScan: unknown,
  trackingNumber: unknown,
): boolean => {
  const scanDigits = normalizeDigits(labelScan);
  const trackingDigits = normalizeDigits(trackingNumber);
  if (!scanDigits || !trackingDigits) return false;
  if (scanDigits === trackingDigits) return true;

  const minLen = 10;
  if (scanDigits.length >= minLen && trackingDigits.length >= minLen) {
    if (scanDigits.endsWith(trackingDigits) || trackingDigits.endsWith(scanDigits)) return true;
    if (scanDigits.includes(trackingDigits) || trackingDigits.includes(scanDigits)) return true;
  }

  const scanRaw = String(labelScan || "").trim().toUpperCase();
  const trackingRaw = String(trackingNumber || "").trim().toUpperCase();
  return Boolean(scanRaw && trackingRaw && scanRaw === trackingRaw);
};

export const formatStorkbinShipmentRef = (shipmentId: string) => {
  const id = String(shipmentId || "").trim();
  if (!id) return "";
  return `STORSHIP-${id.slice(0, 8).toUpperCase()}`;
};
