import { useState } from "react";
import { Link } from "react-router-dom";
import { getEdgeFunctionErrorMessage } from "../utils/edgeFunctionErrors";
import styles from "../styles/styles";

const EMAIL_TYPES = [
  { value: "1", label: "1 — Booking confirmation" },
  { value: "2", label: "2 — Bins shipped to customer" },
  { value: "3", label: "3 — Bins received by customer" },
  { value: "4", label: "4 — Bin requested" },
  { value: "5", label: "5 — Return label ready (to storage)" },
  { value: "6", label: "6 — Bin stored at HQ" },
  { value: "7", label: "7 — Payment past due warning" },
];

export default function AdminCustomerEmailTestPage({ appData }) {
  const [emailType, setEmailType] = useState("1");
  const [to, setTo] = useState(appData.user?.email || "");
  const [includeLabelPdf, setIncludeLabelPdf] = useState(true);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState("");

  if (!appData.isAdmin) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Customer email test</h2>
        <p style={styles.warningText}>You do not have admin access.</p>
      </div>
    );
  }

  const invoke = async (action) => {
    setLoading(true);
    setError("");
    setResponse(null);

    const body = { action, emailType: Number(emailType) || emailType };
    if (emailType === "5") {
      body.includeLabelPdf = includeLabelPdf;
    }
    if (action === "send") {
      const recipient = String(to || "").trim();
      if (!recipient.includes("@")) {
        setError("Enter a valid recipient email before sending.");
        setLoading(false);
        return;
      }
      body.to = recipient;
    }

    const { data, error: invokeError } = await appData.invokeEdge("test-customer-email", body);

    if (invokeError || data?.error) {
      const message =
        (await getEdgeFunctionErrorMessage(invokeError, data)) || data?.error || "Request failed";
      setError(message);
    } else {
      setResponse(data);
    }

    setLoading(false);
  };

  return (
    <div style={styles.panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={styles.sectionTitle}>Customer email test</h2>
          <p style={styles.mutedText}>
            Internal tool for previewing and sending test customer emails via{" "}
            <code>test-customer-email</code>. Subjects are prefixed with <strong>[TEST]</strong>. No shipments,
            Stripe, FedEx, or <code>customer_email_log</code> writes.
          </p>
        </div>
        <Link to="/admin/beta-health" style={styles.linkButtonSecondary}>
          ← Beta health
        </Link>
      </div>

      <section style={{ ...styles.subPanel, marginTop: 16, maxWidth: 560 }}>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={styles.smallText}>Email type</span>
          <select
            value={emailType}
            onChange={(e) => {
              setEmailType(e.target.value);
              if (e.target.value === "5") setIncludeLabelPdf(true);
            }}
            disabled={loading}
            style={{ ...styles.input, display: "block", width: "100%", marginTop: 6 }}
          >
            {EMAIL_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {emailType === "5" ? (
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
            <input
              type="checkbox"
              checked={includeLabelPdf}
              onChange={(e) => setIncludeLabelPdf(e.target.checked)}
              disabled={loading}
              style={{ marginTop: 3 }}
            />
            <span style={styles.smallText}>
              Attach sample return label PDF (simulates production — FedEx attaches the real label).
              Uncheck to preview the no-attachment fallback (contact support).
            </span>
          </label>
        ) : null}

        <label style={{ display: "block", marginBottom: 16 }}>
          <span style={styles.smallText}>Recipient (send only)</span>
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={loading}
            placeholder="you@example.com"
            style={{ ...styles.input, display: "block", width: "100%", marginTop: 6 }}
          />
        </label>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button
            type="button"
            style={styles.secondaryButton}
            disabled={loading}
            onClick={() => invoke("secretsCheck")}
          >
            Check Secrets
          </button>
          <button
            type="button"
            style={styles.secondaryButton}
            disabled={loading}
            onClick={() => invoke("preview")}
          >
            Preview
          </button>
          <button
            type="button"
            style={styles.primaryButton}
            disabled={loading}
            onClick={() => invoke("send")}
          >
            Send Test Email
          </button>
        </div>
      </section>

      {error ? (
        <p style={{ ...styles.warningText, marginTop: 16 }}>{error}</p>
      ) : null}

      {loading ? <p style={{ ...styles.mutedText, marginTop: 16 }}>Working…</p> : null}

      {response ? (
        <section style={{ ...styles.subPanel, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Response</h3>
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: "#f4f5f2",
              border: "1px solid #e0e3dc",
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.45,
              overflow: "auto",
              maxHeight: "min(70vh, 640px)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {JSON.stringify(response, null, 2)}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
