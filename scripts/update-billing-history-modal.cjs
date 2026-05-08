const fs = require("fs");
const path = require("path");

const componentPath = path.join("src", "components", "BillingHistoryPanel.jsx");

if (!fs.existsSync(componentPath)) {
  console.error(`Missing file: ${componentPath}`);
  process.exit(1);
}

const current = fs.readFileSync(componentPath, "utf8");
const backupPath = `${componentPath}.backup-${Date.now()}`;
fs.writeFileSync(backupPath, current);

const next = `import { useState } from "react";
import { supabase } from "../supabaseClient";

function BillingHistoryPanel({ user }) {
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadInvoices = async () => {
    if (!user?.id) {
      setInvoices([]);
      setErrorMessage("You need to be logged in to view invoices.");
      setLoaded(true);
      return;
    }

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
    }

    setLoaded(true);
    setLoading(false);
  };

  const openModal = () => {
    setOpen(true);
    if (!loaded && !loading) loadInvoices();
  };

  const closeModal = () => {
    setOpen(false);
  };

  return (
    <>
      <div style={cardStyle}>
        <div>
          <strong>Invoices</strong>
          <div style={metaStyle}>View Stripe invoice history, receipts, and PDFs.</div>
        </div>

        <button type="button" style={buttonStyle} onClick={openModal}>
          View invoices
        </button>
      </div>

      {open && (
        <div style={overlayStyle} role="presentation" onClick={closeModal}>
          <div
            style={modalStyle}
            role="dialog"
            aria-modal="true"
            aria-labelledby="billing-history-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div style={modalHeaderStyle}>
              <div>
                <h2 id="billing-history-title" style={modalTitleStyle}>Billing history</h2>
                <div style={metaStyle}>Recent Stripe invoices for your StorkBin account.</div>
              </div>

              <div style={modalActionsStyle}>
                <button type="button" style={secondaryButtonStyle} onClick={loadInvoices} disabled={loading}>
                  {loading ? "Loading..." : "Refresh"}
                </button>
                <button type="button" style={closeButtonStyle} onClick={closeModal} aria-label="Close billing history">
                  ×
                </button>
              </div>
            </div>

            <div style={modalBodyStyle}>
              {errorMessage && <div style={errorStyle}>{errorMessage}</div>}
              {!errorMessage && loading && invoices.length === 0 && <div style={emptyStyle}>Loading billing history...</div>}
              {!loading && loaded && !errorMessage && invoices.length === 0 && <div style={emptyStyle}>No invoices found yet.</div>}

              {invoices.length > 0 && (
                <div style={tableWrapStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Invoice</th>
                        <th style={thStyle}>Date</th>
                        <th style={thStyle}>Description</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                        <th style={thStyle}>Status</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Links</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((invoice) => (
                        <tr key={invoice.id} style={trStyle}>
                          <td style={tdStyle}><strong>{invoice.number || "Invoice"}</strong></td>
                          <td style={tdStyle}>{formatStripeDate(invoice.created)}</td>
                          <td style={tdStyle}>{getInvoiceDescription(invoice)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                            <strong>{formatStripeAmount(invoice.total, invoice.currency)}</strong>
                          </td>
                          <td style={tdStyle}><span style={statusStyle(invoice.status)}>{invoice.status || "unknown"}</span></td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            <div style={linksStyle}>
                              {invoice.hostedInvoiceUrl && (
                                <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer" style={linkStyle}>View</a>
                              )}
                              {invoice.invoicePdf && (
                                <a href={invoice.invoicePdf} target="_blank" rel="noreferrer" style={linkStyle}>PDF</a>
                              )}
                              {!invoice.hostedInvoiceUrl && !invoice.invoicePdf && <span style={mutedTextStyle}>No link</span>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
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
    return new Intl.NumberFormat(undefined, { style: "currency", currency: String(currency || "USD") }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function statusStyle(status) {
  const normalized = String(status || "").toLowerCase();
  const base = { ...pillStyle, textTransform: "capitalize" };
  if (normalized === "paid") return { ...base, backgroundColor: "#E8F8EF", color: "#176D36" };
  if (["open", "draft"].includes(normalized)) return { ...base, backgroundColor: "#FFF6DA", color: "#7A5600" };
  if (["void", "uncollectible"].includes(normalized)) return { ...base, backgroundColor: "#F7E7E2", color: "#8A3B2D" };
  return base;
}

const cardStyle = {
  border: "1px solid rgba(0,0,0,0.08)",
  borderRadius: "14px",
  backgroundColor: "#fff",
  padding: "16px",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "14px",
  alignItems: "center",
};

const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  backgroundColor: "rgba(0,0,0,0.45)",
  display: "grid",
  placeItems: "center",
  padding: "24px",
};

const modalStyle = {
  width: "min(980px, 100%)",
  maxHeight: "82vh",
  backgroundColor: "#fff",
  borderRadius: "18px",
  boxShadow: "0 24px 70px rgba(0,0,0,0.25)",
  overflow: "hidden",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
};

const modalHeaderStyle = {
  padding: "20px 22px",
  borderBottom: "1px solid rgba(0,0,0,0.08)",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "16px",
  alignItems: "center",
};

const modalTitleStyle = { margin: 0, fontSize: "22px" };
const modalActionsStyle = { display: "flex", gap: "10px", alignItems: "center" };
const modalBodyStyle = { padding: "18px 22px 22px", overflow: "auto" };
const tableWrapStyle = { overflowX: "auto" };
const tableStyle = { width: "100%", borderCollapse: "collapse", minWidth: "760px" };
const thStyle = { textAlign: "left", padding: "10px 10px", fontSize: "12px", color: "#666", borderBottom: "1px solid rgba(0,0,0,0.12)", whiteSpace: "nowrap" };
const trStyle = { borderBottom: "1px solid rgba(0,0,0,0.07)" };
const tdStyle = { padding: "12px 10px", verticalAlign: "middle", fontSize: "14px" };
const linksStyle = { display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" };
const metaStyle = { marginTop: "4px", color: "#666", fontSize: "13px", lineHeight: 1.35 };
const mutedTextStyle = { color: "#666", fontSize: "13px", whiteSpace: "nowrap" };
const emptyStyle = { padding: "14px", border: "1px dashed rgba(0,0,0,0.16)", borderRadius: "12px", color: "#666" };
const errorStyle = { ...emptyStyle, border: "1px solid rgba(216,140,122,0.35)", backgroundColor: "rgba(216,140,122,0.08)", color: "#8A3B2D" };
const pillStyle = { padding: "7px 11px", borderRadius: "999px", backgroundColor: "rgba(0,0,0,0.06)", color: "#666", fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap" };
const buttonStyle = { border: 0, backgroundColor: "#e8e8e8", borderRadius: "8px", padding: "10px 12px", cursor: "pointer", fontWeight: 700 };
const secondaryButtonStyle = { border: "1px solid rgba(0,0,0,0.12)", backgroundColor: "#fff", borderRadius: "999px", padding: "8px 12px", cursor: "pointer", fontWeight: 700 };
const closeButtonStyle = { border: 0, backgroundColor: "rgba(0,0,0,0.06)", borderRadius: "999px", width: "36px", height: "36px", cursor: "pointer", fontSize: "24px", lineHeight: 1 };
const linkStyle = { ...secondaryButtonStyle, textDecoration: "none", color: "inherit", display: "inline-block" };

export default BillingHistoryPanel;
`;

fs.writeFileSync(componentPath, next);
console.log(`Updated ${componentPath} to use a compact invoice card with a pop-out billing history modal.`);
console.log(`Backup saved to ${backupPath}`);
