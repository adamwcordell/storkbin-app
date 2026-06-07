import { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "../styles/styles";

const QR_FORMATS_KEY = "qr";
const BARCODE_FORMATS_KEY = "barcode";

async function loadScannerFormats(scanMode) {
  const { Html5QrcodeSupportedFormats } = await import("html5-qrcode");
  if (scanMode === QR_FORMATS_KEY) {
    return [Html5QrcodeSupportedFormats.QR_CODE];
  }
  return [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.CODE_93,
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.PDF_417,
    Html5QrcodeSupportedFormats.DATA_MATRIX,
  ];
}

/**
 * Full-screen camera scan modal for warehouse admin flows (mobile-first).
 * scanMode: "qr_url" (bin stickers) | "barcode" (FedEx label barcodes + QR).
 */
export default function QrScanModal({
  title,
  message = "",
  scanMode = QR_FORMATS_KEY,
  delayScanStartMs = 0,
  decodeCooldownMs = 0,
  onResult,
  onCancel,
}) {
  const reactId = useId().replace(/:/g, "");
  const readerId = `qr-reader-${reactId}`;
  const scannerRef = useRef(null);
  const finishedRef = useRef(false);
  const decodeArmedAtRef = useRef(0);
  const [cameraError, setCameraError] = useState("");
  const [starting, setStarting] = useState(true);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
    } catch {
      /* ignore stop races */
    }
    try {
      scanner.clear();
    } catch {
      /* ignore */
    }
  }, []);

  const finish = useCallback(
    async (value) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      await stopScanner();
      onResult(value?.trim() || null);
    },
    [onResult, stopScanner],
  );

  const handleCancel = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    await stopScanner();
    onCancel();
  }, [onCancel, stopScanner]);

  useEffect(() => {
    finishedRef.current = false;
    decodeArmedAtRef.current = 0;
    setCameraError("");
    setStarting(true);
    let cancelled = false;

    (async () => {
      try {
        if (delayScanStartMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayScanStartMs));
          if (cancelled) return;
        }

        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;

        const formats = await loadScannerFormats(scanMode);
        if (cancelled) return;

        const scanner = new Html5Qrcode(readerId, /* verbose */ false);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const edge = Math.min(viewfinderWidth, viewfinderHeight) * 0.72;
              return { width: edge, height: edge };
            },
            formatsToSupport: formats,
          },
          (decodedText) => {
            const cooldown = Math.max(0, Number(decodeCooldownMs) || 0);
            if (cooldown > 0 && decodeArmedAtRef.current > 0) {
              if (Date.now() - decodeArmedAtRef.current < cooldown) return;
            }
            finish(decodedText);
          },
          () => {},
        );

        decodeArmedAtRef.current = Date.now();

        if (!cancelled) {
          setStarting(false);
        }
      } catch (err) {
        if (!cancelled) {
          setStarting(false);
          setCameraError(
            err?.message || "Could not start the camera. Allow camera access in your browser.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [readerId, scanMode, delayScanStartMs, decodeCooldownMs, finish, stopScanner]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="qr-scan-title">
      <div style={panelStyle}>
        <header style={headerStyle}>
          <h3 id="qr-scan-title" style={titleStyle}>
            {title}
          </h3>
          {message ? <p style={messageStyle}>{message}</p> : null}
        </header>

        <div style={cameraWrapStyle}>
          <div id={readerId} className="qr-scan-reader" style={readerStyle} />
          {starting && !cameraError ? (
            <p style={cameraStatusStyle}>Starting camera…</p>
          ) : null}
          {cameraError ? <p style={cameraErrorStyle}>{cameraError}</p> : null}
        </div>

        <footer style={footerStyle}>
          <button type="button" style={styles.secondaryButton} onClick={handleCancel}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.55)",
  display: "flex",
  alignItems: "stretch",
  justifyContent: "center",
  padding: 0,
  zIndex: 1300,
};

const panelStyle = {
  background: "#fff",
  width: "100%",
  maxWidth: 520,
  maxHeight: "100dvh",
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
};

const headerStyle = {
  padding: "16px 18px 8px",
};

const titleStyle = {
  margin: "0 0 8px",
  fontSize: "1.15rem",
  lineHeight: 1.3,
};

const messageStyle = {
  margin: "0 0 8px",
  fontSize: "0.92rem",
  lineHeight: 1.45,
  color: "#555",
};

const cameraWrapStyle = {
  position: "relative",
  minHeight: 280,
  background: "#111",
  overflow: "hidden",
};

const readerStyle = {
  width: "100%",
  minHeight: 280,
};

const cameraStatusStyle = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 12,
  margin: 0,
  textAlign: "center",
  color: "#fff",
  fontSize: "0.85rem",
  textShadow: "0 1px 2px rgba(0,0,0,0.6)",
};

const cameraErrorStyle = {
  margin: 0,
  padding: "12px 16px",
  background: "#FEF3C7",
  color: "#92400E",
  fontSize: "0.85rem",
  lineHeight: 1.45,
};

const footerStyle = {
  padding: "12px 18px 18px",
  display: "flex",
  justifyContent: "flex-end",
};
