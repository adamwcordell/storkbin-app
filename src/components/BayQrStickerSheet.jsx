import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { getBayScanUrl } from "../utils/bayScanUrl";

/**
 * Printable bay location sticker (smaller than bin sticker).
 */
export default function BayQrStickerSheet({ bayCode }) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const code = String(bayCode || "").trim().toUpperCase();
  const scanUrl = code ? getBayScanUrl(code) : "";

  useEffect(() => {
    if (!scanUrl) return undefined;
    let cancelled = false;
    QRCode.toDataURL(scanUrl, {
      width: 640,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#111111", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [scanUrl]);

  if (!code) return null;

  return (
    <div className="bay-qr-sticker-wrap">
      <style>{`
        .bay-qr-sticker-wrap {
          display: flex;
          justify-content: center;
          padding: 12px;
          background: #f4f4f4;
        }
        .bay-qr-sticker-root {
          width: 2.5in;
          height: 3in;
          box-sizing: border-box;
          background: #ffffff;
          border: 2px solid #2d3b2d;
          border-radius: 6px;
          padding: 0.2in;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          font-family: Helvetica, Arial, sans-serif;
        }
        .bay-qr-sticker-code {
          font-size: 28pt;
          font-weight: 800;
          letter-spacing: 0.06em;
          color: #2d3b2d;
          margin: 0 0 0.12in;
        }
        .bay-qr-sticker-qr {
          width: 1.6in;
          height: 1.6in;
          object-fit: contain;
        }
        .bay-qr-sticker-sub {
          margin-top: 0.1in;
          font-size: 9pt;
          color: #555;
        }
        @media print {
          .bay-qr-sticker-wrap { background: none; padding: 0; }
          .bay-qr-sticker-root { break-inside: avoid; }
        }
      `}</style>
      <div className="bay-qr-sticker-root">
        <div className="bay-qr-sticker-code">{code}</div>
        {qrDataUrl ? (
          <img className="bay-qr-sticker-qr" src={qrDataUrl} alt={`Bay ${code} QR`} />
        ) : (
          <div style={{ width: "1.6in", height: "1.6in", background: "#eee" }} />
        )}
        <div className="bay-qr-sticker-sub">StorkBin rack location</div>
      </div>
    </div>
  );
}
