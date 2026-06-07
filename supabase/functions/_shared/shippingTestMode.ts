import QRCode from "https://esm.sh/qrcode@1.5.4";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { isFedexSandboxEnv } from "./fedexAuth.ts";

const qrPngBytes = async (payload: string) => {
  const dataUrl = await QRCode.toDataURL(payload, {
    width: 280,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#111111", light: "#ffffff" },
  });
  const b64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

/** Prefix for fake tracking numbers created in shipping test mode. */
export const SHIPPING_TEST_TRACKING_PREFIX = "TEST";

export const isShippingTestModeSecretSet = (): boolean =>
  String(Deno.env.get("SHIPPING_TEST_MODE") || "").trim() === "1";

/** True when APP_URL points at local dev or a Vercel preview/staging host. */
export const isStagingAppUrl = (): boolean => {
  const raw = String(Deno.env.get("APP_URL") || "").trim().toLowerCase();
  if (!raw) return false;
  try {
    const host = new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host.endsWith(".vercel.app")) return true;
    if (host.startsWith("staging.") || host.includes(".staging.")) return true;
  } catch {
    if (raw.includes("localhost") || raw.includes("127.0.0.1") || raw.includes(".vercel.app")) {
      return true;
    }
  }
  return false;
};

/**
 * Shipping test mode is ON only when SHIPPING_TEST_MODE=1 is explicitly set and the
 * environment is non-production FedEx and/or a staging APP_URL. Never auto-enables
 * on a production FedEx + production APP_URL stack.
 */
export const isShippingTestModeActive = (): boolean => {
  if (!isShippingTestModeSecretSet()) return false;
  if (isFedexSandboxEnv() || isStagingAppUrl()) return true;
  console.warn(
    "[shippingTestMode] SHIPPING_TEST_MODE=1 is set but ignored: FEDEX_ENV is production/live and APP_URL is not a staging host.",
  );
  return false;
};

export const isTestTrackingNumber = (tracking: string | null | undefined): boolean => {
  const t = String(tracking || "").trim().toUpperCase();
  return t.startsWith(SHIPPING_TEST_TRACKING_PREFIX);
};

/** Deterministic fake tracking number for a shipment (stable across retries). */
export const generateTestTrackingNumber = (seed: string): string => {
  let hash = 0;
  const s = String(seed || "shipment");
  for (let i = 0; i < s.length; i += 1) {
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) >>> 0;
  }
  const nine = String(hash % 1_000_000_000).padStart(9, "0");
  return `${SHIPPING_TEST_TRACKING_PREFIX}${nine}`;
};

export type TestLabelPdfInput = {
  trackingNumber: string;
  shipmentRef: string;
  direction: "to_customer" | "to_storage";
  serviceName?: string;
  displayRefs?: string[];
};

/** Minimal PDF shipping label marked TEST / NOT VALID FOR SHIPPING. */
export const buildTestLabelPdfBase64 = async (input: TestLabelPdfInput): Promise<string> => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();

  page.drawRectangle({
    x: 0,
    y: height - 72,
    width,
    height: 72,
    color: rgb(0.85, 0.1, 0.1),
  });
  page.drawText("TEST — NOT VALID FOR SHIPPING", {
    x: 48,
    y: height - 48,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  let y = height - 120;
  const line = (text: string, size = 11, bold = false) => {
    page.drawText(text, {
      x: 48,
      y,
      size,
      font: bold ? fontBold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= size + 8;
  };

  line("StorkBin shipping test label", 14, true);
  line(`Tracking: ${input.trackingNumber}`, 12, true);
  line(`Shipment ref: ${input.shipmentRef}`);
  line(`Direction: ${input.direction === "to_storage" ? "Return to warehouse" : "Outbound to customer"}`);
  if (input.serviceName) line(`Service: ${input.serviceName}`);
  if (input.displayRefs?.length) {
    line(`Bins: ${input.displayRefs.slice(0, 5).join(", ")}`);
  }
  line("This label was generated in SHIPPING_TEST_MODE.");
  line("Do not affix to a real package or drop off at FedEx.");

  try {
    const png = await qrPngBytes(input.trackingNumber);
    const embedded = await pdfDoc.embedPng(png);
    const qrSize = 168;
    const qrX = width - qrSize - 40;
    const qrY = 52;
    page.drawText("SCAN FOR MATCH", {
      x: qrX,
      y: qrY + qrSize + 10,
      size: 12,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText(input.trackingNumber, {
      x: qrX,
      y: qrY - 4,
      size: 10,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawImage(embedded, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    line("Match step: scan the large tracking QR at bottom right (not the bin sticker).", 10, true);
  } catch (e) {
    console.warn("[shippingTestMode] QR embed on test label failed", e);
  }

  const outBytes = await pdfDoc.save();
  let binary = "";
  for (let i = 0; i < outBytes.length; i += 1) binary += String.fromCharCode(outBytes[i]);
  return btoa(binary);
};
