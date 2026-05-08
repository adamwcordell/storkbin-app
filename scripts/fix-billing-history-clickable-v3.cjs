const fs = require('fs');
const path = require('path');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const panelFile = 'src/components/BillingHistoryPanel.jsx';

if (!fs.existsSync('src/pages/AccountPage.jsx')) {
  throw new Error('Run this script from the StorkBin project root. Missing src/pages/AccountPage.jsx');
}

const panelContent = `import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

function BillingHistoryPanel() {
  const [isOpen, setIsOpen] = useState(() => isBillingQueryOpen());
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const billingUrl = useMemo(() => getBillingUrl(), []);

  useEffect(() => {
    if (isOpen && !loaded && !loading) {
      loadInvoices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const loadInvoices = async () => {
    if (loading) return;

    setLoading(true);
    setErrorMessage("");

    const { data, error } = await supabase.functions.invoke("get-customer-invoices", {
      body: { limit: 20 },
    });

    if (error) {
      setInvoices([]);
      setErrorMessage(error.message || "We could not load your invoices right now.");
    } else {
      setInvoices(Array.isArray(data?.invoices) ? data.invoices : []);
      setLoaded(true);
    }

    setLoading(false);
  };

  const openInvoices = () => {
    setIsOpen(true);
    markBillingQueryOpen();
  };

  const closeInvoices = () => {
    setIsOpen(false);
    clearBillingQueryOpen();
  };

  const handleOpenClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    openInvoices();
  };

  return (
    <section style={panelStyle} aria-label="Billing history">
      <div style={headerStyle}>
        <div>
          <strong>Invoices</strong>
          <div style={metaStyle}>
            View recent Stripe invoices, receipts, and downloadable PDFs.
          </div>
        </div>

        {isOpen ? (
          <button type="button" style={buttonStyle} onClick={closeInvoices}>
            Hide invoices
          </button>
        ) : (
          <a href={billingUrl} style={buttonStyle} onClick={handleOpenClick}>
            View invoices
          </a>
        )}
      </div>

      {!isOpen && (
        <a href={billingUrl} style={openCardStyle} onClick={handleOpenClick}>
          <strong>Open billing history</strong>
          <span style={openCardMetaStyle}>See recent payments and invoice PDFs.</span>
        </a>
      )}

      {isOpen && (
        <div style={contentStyle}>
          <div style={refreshRowStyle}>
            <button type="button" style={smallButtonStyle} onClick={loadInvoices} disabled={loading}>
              {loading ? "Loading..." : "Refresh invoices"}
            </button>
          </div>

          {errorMessage && <div style={errorStyle}>{errorMessage}</div>}

          {!errorMessage && loading && invoices.length === 0 && (
            <div style={emptyStyle}>Loading billing history...</div>
          )}

          {!loading && !errorMessage && loaded && invoices.length === 0 && (
            <div style={emptyStyle}>No invoices found yet.</div>
          )}

          {invoices.length > 0 && (
            <div style={listStyle}>
              {invoices.map((invoice) => (
                <div key={invoice.id} style={rowStyle}>
                  <div style={mainStyle}>
                    <strong>{invoice.number || "Invoice"}</strong>
                    <div style={metaStyle}>{getInvoiceDescription(invoice)}</div>
                    <div style={metaStyle}>{formatStripeDate(invoice.created)}</div>
                  </div>

                  <div style={amountStyle}>
                    <span>{formatStripeAmount(invoice.total, invoice.currency)}</span>
                    <span style={getStatusStyle(invoice.status)}>{invoice.status || "unknown"}</span>
                  </div>

                  <div style={actionsStyle}>
                    {invoice.hostedInvoiceUrl ? (
                      <a style={linkStyle} href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                        View
                      </a>
                    ) : null}

                    {invoice.invoicePdf ? (
                      <a style={linkStyle} href={invoice.invoicePdf} target="_blank" rel="noreferrer">
                        PDF
                      </a>
                    ) : null}

                    {!invoice.hostedInvoiceUrl && !invoice.invoicePdf && (
                      <span style={mutedPillStyle}>No link</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function isBillingQueryOpen() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("billing") === "invoices";
}

function getBillingUrl() {
  if (typeof window === "undefined") return "/account?billing=invoices";
  const url = new URL(window.location.href);
  url.searchParams.set("billing", "invoices");
  return `${url.pathname}${url.search}${url.hash}`;
}

function markBillingQueryOpen() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("billing", "invoices");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function clearBillingQueryOpen() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("billing");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function getInvoiceDescription(invoice) {
  if (invoice.description) return invoice.description;
  if (invoice.billingReason === "subscription_cycle") return "Monthly subscription invoice";
  if (invoice.billingReason === "subscription_create") return "Subscription started";
  if (invoice.billingReason === "manual") return "Manual invoice";
  return "StorkBin invoice";
}

function formatStripeDate(timestampSeconds) {
  if (!timestampSeconds) return "Date unavailable";
  const date = new Date(Number(timestampSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatStripeAmount(amountCents, currency = "USD") {
  const amount = Number(amountCents || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(currency || "USD"),
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function getStatusStyle(status) {
  const normalizedStatus = String(status || "").toLowerCase();
  if (normalizedStatus === "paid") {
    return { ...mutedPillStyle, backgroundColor: "#E8F8EF", color: "#176D36" };
  }
  if (["open", "draft"].includes(normalizedStatus)) {
    return { ...mutedPillStyle, backgroundColor: "#FFF6DA", color: "#7A5600" };
  }
  return mutedPillStyle;
}

const panelStyle = {
  position: "relative",
  zIndex: 2,
  display: "grid",
  gap: "12px",
  padding: "14px 16px",
  border: "1px solid rgba(0, 0, 0, 0.08)",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
};

const headerStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "16px",
  alignItems: "center",
};

const buttonStyle = {
  appearance: "none",
  border: "1px solid rgba(0, 0, 0, 0.16)",
  borderRadius: "999px",
  backgroundColor: "#FFFFFF",
  color: "#1F2933",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  padding: "9px 14px",
  pointerEvents: "auto",
  position: "relative",
  textDecoration: "none",
  whiteSpace: "nowrap",
  zIndex: 3,
};

const smallButtonStyle = {
  ...buttonStyle,
  padding: "7px 12px",
  fontSize: "13px",
};

const openCardStyle = {
  border: "1px dashed rgba(0, 0, 0, 0.16)",
  borderRadius: "12px",
  backgroundColor: "rgba(0, 0, 0, 0.02)",
  color: "#1F2933",
  cursor: "pointer",
  display: "grid",
  gap: "4px",
  padding: "12px",
  pointerEvents: "auto",
  position: "relative",
  textAlign: "left",
  textDecoration: "none",
  zIndex: 3,
};

const openCardMetaStyle = { color: "#666", fontSize: "13px", fontWeight: 400 };
const refreshRowStyle = { display: "flex", justifyContent: "flex-end" };
const contentStyle = { display: "grid", gap: "10px" };
const listStyle = { display: "grid", gap: "10px" };

const rowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 120px auto",
  gap: "12px",
  alignItems: "center",
  padding: "12px",
  border: "1px solid rgba(0, 0, 0, 0.08)",
  borderRadius: "12px",
  backgroundColor: "rgba(0, 0, 0, 0.02)",
};

const mainStyle = { minWidth: 0 };
const amountStyle = {
  textAlign: "right",
  display: "grid",
  justifyItems: "end",
  gap: "6px",
  fontWeight: 700,
};
const actionsStyle = { display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "8px" };
const metaStyle = { marginTop: "4px", color: "#666", fontSize: "13px", lineHeight: 1.35 };

const emptyStyle = {
  padding: "12px",
  border: "1px dashed rgba(0, 0, 0, 0.16)",
  borderRadius: "12px",
  color: "#666",
  backgroundColor: "#FFFFFF",
};

const errorStyle = {
  ...emptyStyle,
  border: "1px solid rgba(216, 140, 122, 0.35)",
  backgroundColor: "rgba(216, 140, 122, 0.08)",
  color: "#8A3B2D",
};

const mutedPillStyle = {
  padding: "6px 10px",
  borderRadius: "999px",
  backgroundColor: "rgba(0, 0, 0, 0.06)",
  color: "#666",
  fontSize: "12px",
  fontWeight: 700,
  textTransform: "capitalize",
  whiteSpace: "nowrap",
};

const linkStyle = {
  ...buttonStyle,
  padding: "7px 12px",
  fontSize: "13px",
};

export default BillingHistoryPanel;
`;

write(panelFile, panelContent);
console.log('Billing History clickable v3 applied. It now uses real links with URL fallback plus React click handling.');
