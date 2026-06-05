/** Client-side scan helpers (mirrors supabase/functions/_shared/scanMatch.ts). */

export const normalizeDigits = (raw) => String(raw || "").replace(/\D/g, "");

export function parseBoxIdFromBinScan(raw) {
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
      /* ignore */
    }
  }

  return s;
}

export function binScanMatchesBox(scan, boxId, recordedBinQr = null) {
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
}

export function isBinScanUrl(scan) {
  return /\/scan\//i.test(String(scan || ""));
}

export function parseBayCodeFromScan(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";

  const bayPath = s.match(/\/bay\/([^/?#]+)/i);
  if (bayPath?.[1]) {
    try {
      return decodeURIComponent(bayPath[1]).trim().toUpperCase();
    } catch {
      return bayPath[1].trim().toUpperCase();
    }
  }

  return s.toUpperCase();
}

export function bayScanMatchesCode(scan, bayCode) {
  const expected = String(bayCode || "").trim().toUpperCase();
  if (!expected) return false;

  const raw = String(scan || "").trim();
  if (!raw) return false;
  if (isBinScanUrl(raw)) return false;

  return parseBayCodeFromScan(raw) === expected;
}

export function explainBayScanMismatch(scan, bayCode) {
  const expected = String(bayCode || "").trim().toUpperCase();
  if (isBinScanUrl(scan)) {
    return (
      `That scan is a bin QR, not bay ${expected}. ` +
      `Move the bin to rack slot ${expected} and scan the bay sticker there (or type ${expected} below).`
    );
  }
  return (
    `Bay scan does not match home bay ${expected}. ` +
    `Scan the bay QR at rack slot ${expected}, or type ${expected} below.`
  );
}

export function isLabelPageUrl(scan) {
  return /\/labels\//i.test(String(scan || ""));
}

export function explainLabelScanMismatch(scan, trackingNumber) {
  const expected = String(trackingNumber || "").trim();
  if (isBinScanUrl(scan)) {
    return (
      "That scan is a bin QR, not the shipping label barcode. " +
      "Point the camera at the tracking number on the printed label" +
      (expected ? ` (expected ${expected})` : "") +
      ", or paste the tracking below."
    );
  }
  if (isLabelPageUrl(scan)) {
    return (
      "That is the label preview web link, not the barcode. " +
      "Scan or paste the tracking number from the printed label" +
      (expected ? ` (${expected})` : "") +
      "."
    );
  }
  return (
    `Label scan does not match tracking${expected ? ` ${expected}` : ""}. ` +
    "Scan the FedEx barcode on the shipping label, or paste the tracking number below."
  );
}

export function labelScanMatchesTracking(labelScan, trackingNumber) {
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
}
