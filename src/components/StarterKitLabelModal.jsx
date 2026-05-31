import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../styles/styles";
import { supabase, supabaseFunctionAuthHeaders } from "../supabaseClient";
import { getEdgeFunctionErrorMessage } from "../utils/edgeFunctionErrors";
import { filterFedexCartGroundOptions, fedexOptionDetailParts } from "../utils/fedexDisplayHelpers";
import { formatStarterEmptyStackPackage } from "../utils/starterKitShipping";

const QUOTE_TIMEOUT_MS = 60_000;

function formatStarterQuoteError(message) {
  const msg = String(message || "").trim();
  if (!msg) return "Could not load FedEx rates.";
  if (/admin access required/i.test(msg)) {
    return `${msg} Add your login email to the Supabase Edge secret ADMIN_EMAILS (Dashboard → Edge Functions → Secrets), then retry.`;
  }
  if (/invalid auth token|missing auth token|jwt/i.test(msg)) {
    return `${msg} Try signing out and back in, then open this modal again.`;
  }
  return msg;
}

async function invokeStarterQuoteEdge(body) {
  const auth = await supabaseFunctionAuthHeaders();
  return supabase.functions.invoke("quote-starter-shipment-label", {
    body,
    headers: auth,
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

function StarterKitLabelModal({
  shipmentId,
  pieceCount,
  kitDescription,
  onPurchaseLabel,
  onClose,
  onSuccess,
}) {
  const [loading, setLoading] = useState(true);
  const [quoteError, setQuoteError] = useState("");
  const [options, setOptions] = useState([]);
  const [packageInfo, setPackageInfo] = useState(null);
  const [destination, setDestination] = useState(null);
  const [selectedServiceType, setSelectedServiceType] = useState("");
  const [dimensionsConfirmed, setDimensionsConfirmed] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const loadSeqRef = useRef(0);

  const localPackage = useMemo(
    () => formatStarterEmptyStackPackage(pieceCount),
    [pieceCount],
  );

  const displayPackage = packageInfo || localPackage;

  const loadQuotes = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setQuoteError("");

    try {
      const result = await withTimeout(
        invokeStarterQuoteEdge({ shipmentId, action: "quote" }),
        QUOTE_TIMEOUT_MS,
        "FedEx rate quote",
      );

      if (seq !== loadSeqRef.current) return;

      if (result.error || result.data?.error) {
        const msg = await getEdgeFunctionErrorMessage(result.error, result.data);
        setQuoteError(formatStarterQuoteError(msg));
        return;
      }

      const { data } = result;
      const filtered = filterFedexCartGroundOptions(data?.options || []);
      setOptions(filtered);
      setPackageInfo(data?.package || localPackage);
      setDestination(data?.destination || null);

      const preferred =
        filtered.find((o) => o.serviceType === data?.cheapest?.serviceType) || filtered[0];
      if (preferred?.serviceType) {
        setSelectedServiceType(preferred.serviceType);
      }
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setQuoteError(formatStarterQuoteError(err instanceof Error ? err.message : String(err)));
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [shipmentId, localPackage]);

  useEffect(() => {
    loadQuotes();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [loadQuotes]);

  const selectedOption = options.find((o) => o.serviceType === selectedServiceType) || null;

  const handlePurchase = async () => {
    if (!selectedOption) {
      alert("Select a FedEx shipping method.");
      return;
    }
    if (!dimensionsConfirmed) {
      alert("Confirm the package dimensions before purchasing the label.");
      return;
    }

    setPurchasing(true);
    try {
      const save = await withTimeout(
        invokeStarterQuoteEdge({
          shipmentId,
          action: "save_selection",
          fedexServiceType: selectedOption.serviceType,
          fedexServiceName: selectedOption.serviceName || selectedOption.cartLabel,
          amountUsd: selectedOption.amountUsd,
          dimensionsConfirmed: true,
          estimatedDeliveryDate: selectedOption.estimatedDeliveryDate,
          estimatedDeliveryWeekday: selectedOption.estimatedDeliveryWeekday,
          transitTimeRaw: selectedOption.transitTimeRaw,
          deliverySummary: selectedOption.deliverySummary,
        }),
        QUOTE_TIMEOUT_MS,
        "Save shipping selection",
      );

      if (save.error || save.data?.error) {
        const msg = await getEdgeFunctionErrorMessage(save.error, save.data);
        alert(formatStarterQuoteError(msg) || "Could not save shipping selection.");
        return;
      }

      const purchaseResult = await onPurchaseLabel({
        shipmentId,
        fedexServiceType: selectedOption.serviceType,
        fedexServiceName: selectedOption.serviceName || selectedOption.cartLabel,
        selectedRateAmountUsd: selectedOption.amountUsd,
        dimensionsConfirmed: true,
        estimatedDeliveryDate: selectedOption.estimatedDeliveryDate,
        estimatedDeliveryWeekday: selectedOption.estimatedDeliveryWeekday,
        transitTimeRaw: selectedOption.transitTimeRaw,
        deliverySummary: selectedOption.deliverySummary,
      });

      if (purchaseResult?.trackingNumber) {
        alert(
          `Label created.\n\nLabel ID (tracking): ${purchaseResult.trackingNumber}\nFedEx prints the same Username-001 bin ref as the sticker; each bin QR is overlaid on the PDF.\nNext: Match Shipping Label — scan each bin QR, then scan the FedEx barcode.`,
        );
      }

      onSuccess?.();
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <ModalOverlay>
      <div style={panelStyle}>
        <header style={modalHeaderStyle}>
          <h3 style={modalTitleStyle}>Starter kit — shipping & label</h3>
          <p style={styles.mutedText}>
            {kitDescription || "Starter kit outbound"} · Shipment {shipmentId}
          </p>
          {destination?.city && (
            <p style={styles.smallText}>
              Ship to: {[destination.city, destination.state, destination.zip].filter(Boolean).join(", ")}
            </p>
          )}
        </header>

        <section style={sectionStyle}>
          <h4 style={sectionHeadingStyle}>Package size (confirm before label)</h4>
          <p style={styles.bodyText}>
            <strong>{displayPackage.summary}</strong>
          </p>
          <ul style={listStyle}>
            {(displayPackage.detailLines || localPackage.detailLines).map((line) => (
              <li key={line} style={styles.smallText}>
                {line}
              </li>
            ))}
          </ul>
          <label style={confirmLabelStyle}>
            <input
              type="checkbox"
              checked={dimensionsConfirmed}
              onChange={(e) => setDimensionsConfirmed(e.target.checked)}
            />
            <span>
              I confirm this shipment uses <strong>collapsed empty bins stacked</strong> with the dimensions
              above (not expanded 12&quot; storage height).
            </span>
          </label>
        </section>

        <section style={sectionStyle}>
          <h4 style={sectionHeadingStyle}>FedEx rates</h4>
          {loading && (
            <p style={styles.mutedText}>
              Loading live FedEx rates… (usually under 15 seconds; times out after 60s)
            </p>
          )}
          {quoteError && (
            <p style={styles.warningText}>
              {quoteError}{" "}
              <button type="button" style={styles.linkButton} onClick={loadQuotes}>
                Retry
              </button>
            </p>
          )}
          {!loading && !quoteError && options.length === 0 && (
            <p style={styles.warningText}>No FedEx ground/home delivery rates returned for this address.</p>
          )}
          <div style={optionsWrapStyle}>
            {options.map((opt) => {
              const label = opt.cartLabel || opt.serviceName || opt.serviceType;
              const details = fedexOptionDetailParts(opt);
              const checked = selectedServiceType === opt.serviceType;
              return (
                <label
                  key={opt.serviceType}
                  style={{
                    ...optionRowStyle,
                    borderColor: checked ? "#2563eb" : "#e2e8f0",
                    background: checked ? "#eff6ff" : "#fff",
                  }}
                >
                  <input
                    type="radio"
                    name="starter-fedex-service"
                    checked={checked}
                    onChange={() => setSelectedServiceType(opt.serviceType)}
                  />
                  <span style={optionBodyStyle}>
                    <span style={optionTitleStyle}>
                      {label} — ${Number(opt.amountUsd).toFixed(2)}
                    </span>
                    {details.map((d) => (
                      <span key={d} style={styles.smallText}>
                        {d}
                      </span>
                    ))}
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        <footer style={modalFooterStyle}>
          <button type="button" style={styles.secondaryButton} onClick={onClose} disabled={purchasing}>
            Cancel
          </button>
          <button
            type="button"
            style={styles.primaryButton}
            onClick={handlePurchase}
            disabled={purchasing || loading || !selectedOption || !dimensionsConfirmed}
          >
            {purchasing ? "Purchasing label…" : "Purchase FedEx label"}
          </button>
        </footer>
      </div>
    </ModalOverlay>
  );
}

function ModalOverlay({ children }) {
  return <div style={overlayStyle}>{children}</div>;
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 1200,
};

const panelStyle = {
  background: "#fff",
  borderRadius: 12,
  maxWidth: 560,
  width: "100%",
  maxHeight: "90vh",
  overflow: "auto",
  boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
  padding: "20px 22px",
};

const modalHeaderStyle = { marginBottom: 16 };
const modalTitleStyle = { margin: "0 0 8px", fontSize: "1.25rem" };
const sectionStyle = { marginBottom: 20 };
const sectionHeadingStyle = { margin: "0 0 8px", fontSize: "1rem" };
const listStyle = { margin: "8px 0 12px", paddingLeft: 20 };
const confirmLabelStyle = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  marginTop: 12,
  fontSize: "0.9rem",
  lineHeight: 1.45,
};
const optionsWrapStyle = { display: "flex", flexDirection: "column", gap: 8 };
const optionRowStyle = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "10px 12px",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  cursor: "pointer",
};
const optionBodyStyle = { display: "flex", flexDirection: "column", gap: 2 };
const optionTitleStyle = { fontWeight: 600 };
const modalFooterStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 8,
  paddingTop: 12,
  borderTop: "1px solid #e2e8f0",
};

export default StarterKitLabelModal;
