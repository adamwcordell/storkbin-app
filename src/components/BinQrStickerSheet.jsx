import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { getCustomerBinScanUrl } from "../utils/binScanUrl";

const LOGO_SRC = "/storkbin_color_vertical.png";

/**
 * Printable 3" × 6" bin QR sticker: white field, logo, QR, handwritten name lines.
 * Screen: scaled preview. Print: @page size matches sticker.
 */
export default function BinQrStickerSheet({ boxId, displayBinRef = "" }) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const scanUrl = boxId ? getCustomerBinScanUrl(boxId) : "";
  const binLabel = String(displayBinRef || "").trim();

  useEffect(() => {
    if (!scanUrl) return undefined;
    let cancelled = false;
    QRCode.toDataURL(scanUrl, {
      width: 900,
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

  return (
    <div className="bin-qr-sticker-wrap">
      <style>{`
        .bin-qr-sticker-wrap {
          display: flex;
          justify-content: center;
          padding: 12px;
          background: #f4f4f4;
        }
        .bin-qr-sticker-root {
          width: 3in;
          height: 6in;
          box-sizing: border-box;
          background: #ffffff;
          color: #1a1a1a;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0.2in 0.18in 0.22in;
          font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
          border: 1px solid #e8e8e8;
          overflow: hidden;
        }
        .bin-qr-sticker-logo {
          height: 0.44in;
          width: auto;
          max-width: 2.2in;
          object-fit: contain;
          margin-bottom: 0.06in;
          flex-shrink: 0;
        }
        .bin-qr-sticker-id {
          margin: 0 0 0.08in;
          font-size: 11pt;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-align: center;
          line-height: 1.2;
          flex-shrink: 0;
        }
        .bin-qr-sticker-qr {
          width: 1.42in;
          height: 1.42in;
          object-fit: contain;
          image-rendering: pixelated;
          flex-shrink: 0;
        }
        .bin-qr-sticker-lines {
          width: 100%;
          margin-top: 0.12in;
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          gap: 0.14in;
        }
        .bin-qr-sticker-field {
          width: 100%;
        }
        .bin-qr-sticker-label {
          font-size: 8pt;
          font-weight: 600;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: #2c2c2c;
          margin: 0 0 0.03in 0;
        }
        .bin-qr-sticker-rule {
          border: 0;
          border-bottom: 1px solid #bdbdbd;
          margin: 0.04in 0 0 0;
          height: 0.26in;
        }
        .bin-qr-sticker-hint {
          margin-top: auto;
          padding-top: 0.1in;
          font-size: 6.5pt;
          line-height: 1.35;
          color: #666666;
          text-align: center;
          letter-spacing: 0.02em;
          flex-shrink: 0;
        }
        @media print {
          .bin-qr-sticker-wrap {
            padding: 0;
            background: #ffffff;
          }
          .bin-qr-sticker-root {
            border: none;
            width: 3in;
            height: 6in;
            overflow: visible;
          }
          @page {
            size: 3in 6in;
            margin: 0;
          }
        }
      `}</style>

      <div className="bin-qr-sticker-root">
        <img className="bin-qr-sticker-logo" src={LOGO_SRC} alt="" />

        {binLabel ? <p className="bin-qr-sticker-id">{binLabel}</p> : null}

        {qrDataUrl ? (
          <img className="bin-qr-sticker-qr" src={qrDataUrl} alt="Bin QR code" />
        ) : (
          <div
            className="bin-qr-sticker-qr"
            style={{
              background: "#fafafa",
              border: "1px dashed #ccc",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "9px",
              color: "#888",
              textAlign: "center",
              padding: "8px",
            }}
          >
            Generating QR…
          </div>
        )}

        <div className="bin-qr-sticker-lines">
          <div className="bin-qr-sticker-field">
            <p className="bin-qr-sticker-label">Bin Name</p>
            <hr className="bin-qr-sticker-rule" />
          </div>
          <div className="bin-qr-sticker-field">
            <p className="bin-qr-sticker-label">Rename Bin</p>
            <hr className="bin-qr-sticker-rule" />
          </div>
          <div className="bin-qr-sticker-field">
            <p className="bin-qr-sticker-label">Rename Bin</p>
            <hr className="bin-qr-sticker-rule" />
          </div>
          <div className="bin-qr-sticker-field">
            <p className="bin-qr-sticker-label">Rename Bin</p>
            <hr className="bin-qr-sticker-rule" />
          </div>
        </div>

        <p className="bin-qr-sticker-hint">
          Name your bin when it arrives. To rename later, cross out the old name and write below.
        </p>
      </div>
    </div>
  );
}
