import type { BinLabelOverlayItem } from "./binDisplayRef.ts";

import QRCode from "https://esm.sh/qrcode@1.5.4";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const dataUrlToBytes = (dataUrl: string) => {
  const b64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

const qrPngBytes = async (scanUrl: string) => {
  const dataUrl = await QRCode.toDataURL(scanUrl, {
    width: 280,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#111111", light: "#ffffff" },
  });
  return dataUrlToBytes(dataUrl);
};

/**
 * Overlay StorkBin bin QR(s) + display ref(s) on FedEx label PDF (first page).
 * Best-effort: returns original base64 if overlay fails.
 */
export const overlayBinQrsOnFedexLabelPdfBase64 = async (
  pdfBase64: string,
  items: BinLabelOverlayItem[],
): Promise<{ base64: string; overlaid: boolean }> => {
  const clean = String(pdfBase64 || "").trim();
  if (!clean || !items.length) return { base64: clean, overlaid: false };

  try {
    const pdfBytes = dataUrlToBytes(`data:application/pdf;base64,${clean}`);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const page = pdfDoc.getPages()[0];
    if (!page) return { base64: clean, overlaid: false };

    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();

    const count = Math.min(items.length, 5);
    const qrSize = count > 2 ? 48 : count > 1 ? 56 : 72;
    const gap = 6;
    const rowWidth = count * qrSize + (count - 1) * gap;
    let x = Math.max(24, width - rowWidth - 28);
    const y = height * 0.56;

    for (let i = 0; i < count; i += 1) {
      const item = items[i];
      if (!item.scanUrl) continue;
      const png = await qrPngBytes(item.scanUrl);
      const embedded = await pdfDoc.embedPng(png);
      page.drawImage(embedded, { x, y, width: qrSize, height: qrSize });

      const ref = String(item.displayRef || "").slice(0, 18);
      const textWidth = font.widthOfTextAtSize(ref, 7);
      page.drawText(ref, {
        x: x + (qrSize - textWidth) / 2,
        y: y - 10,
        size: 7,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      x += qrSize + gap;
    }

    const outBytes = await pdfDoc.save();
    let binary = "";
    for (let i = 0; i < outBytes.length; i += 1) binary += String.fromCharCode(outBytes[i]);
    return { base64: btoa(binary), overlaid: true };
  } catch (e) {
    console.error("overlayBinQrsOnFedexLabelPdfBase64 failed", e);
    return { base64: clean, overlaid: false };
  }
};
