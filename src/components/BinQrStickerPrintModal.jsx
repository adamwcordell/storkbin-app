import BinQrStickerSheet from "./BinQrStickerSheet";
import styles from "../styles/styles";

const backdrop = {
  position: "fixed",
  inset: 0,
  zIndex: 10040,
  backgroundColor: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "24px 16px",
  overflowY: "auto",
};

const card = {
  backgroundColor: "#FFFFFF",
  borderRadius: "12px",
  padding: "20px",
  maxWidth: "520px",
  width: "100%",
  boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
};

const headerRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
};

export default function BinQrStickerPrintModal({
  open,
  onClose,
  boxId,
  displayBinRef = "",
  onConfirmPrinted,
  confirmLabel = "Done — ready to apply",
  busy = false,
}) {
  if (!open || !boxId) return null;

  const handlePrint = () => {
    const style = document.createElement("style");
    style.setAttribute("data-admin-sticker-print", "1");
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        .admin-bin-qr-sticker-print-target,
        .admin-bin-qr-sticker-print-target * { visibility: visible !important; }
        .admin-bin-qr-sticker-print-target { position: absolute; left: 0; top: 0; width: 3in; }
        .admin-sticker-modal-actions { display: none !important; }
      }
    `;
    document.head.appendChild(style);
    requestAnimationFrame(() => {
      window.print();
      requestAnimationFrame(() => {
        document.querySelectorAll("style[data-admin-sticker-print]").forEach((el) => el.remove());
      });
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Print bin QR sticker"
      style={backdrop}
      onClick={onClose}
    >
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={headerRow}>
          <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#2d3b2d" }}>Print bin QR sticker</h3>
          <button type="button" style={styles.linkButtonSecondary} onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <p style={{ ...styles.smallText, marginTop: 8 }}>
          3×6 in layout — use your browser print dialog. Disable headers/footers for best results.
        </p>
        <div className="admin-bin-qr-sticker-print-target">
          <BinQrStickerSheet boxId={boxId} displayBinRef={displayBinRef} />
        </div>
        <div className="admin-sticker-modal-actions" style={{ ...styles.row, marginTop: 14, flexWrap: "wrap" }}>
          <button type="button" style={styles.primaryButton} onClick={handlePrint} disabled={busy}>
            Print…
          </button>
          {onConfirmPrinted ? (
            <button
              type="button"
              style={styles.secondaryButton}
              disabled={busy}
              onClick={() => void onConfirmPrinted()}
            >
              {busy ? "Saving…" : confirmLabel}
            </button>
          ) : (
            <button type="button" style={styles.secondaryButton} onClick={onClose} disabled={busy}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
