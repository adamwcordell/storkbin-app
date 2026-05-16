import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import styles from "../styles/styles";
import { SUPPORT_EMAIL } from "../config/supportContact";

function fmtTs(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

export default function AdminBetaHealthPage({ appData }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const { data: res, error } = await appData.invokeEdge("beta-ops-admin", { action: "health" });
    if (error || res?.error) {
      setData(null);
      setErr(res?.error || error?.message || "Failed to load beta health");
    } else {
      setData(res);
    }
    setLoading(false);
  }, [appData]);

  useEffect(() => {
    if (appData.isAdmin) load();
  }, [appData.isAdmin, load]);

  if (!appData.isAdmin) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Beta health</h2>
        <p style={styles.warningText}>You do not have admin access.</p>
      </div>
    );
  }

  const hb = (id) => (data?.heartbeats || []).find((h) => h.id === id);

  return (
    <div style={styles.panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={styles.sectionTitle}>Beta ops health</h2>
          <p style={styles.mutedText}>Safety rails, sweeps, and recovery signals for paid beta.</p>
        </div>
        <button type="button" style={styles.secondaryButton} disabled={loading} onClick={() => load()}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {err ? <p style={styles.warningText}>{err}</p> : null}

      {!loading && data && (
        <>
          {(data.carrierExceptionShipments || []).length > 0 && (
            <p style={{ ...styles.warningText, marginTop: 12 }}>
              <strong>{(data.carrierExceptionShipments || []).length}</strong> shipment(s) in FedEx{" "}
              <strong>exception</strong> — review below and FedEx tracking.
            </p>
          )}
          <section style={{ ...styles.subPanel, marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Sweeps &amp; alerts</h3>
            <p style={styles.smallText}>
              <strong>Tracking sweep</strong> last run: {fmtTs(hb("tracking_sweep")?.last_run_at)} —{" "}
              {JSON.stringify(hb("tracking_sweep")?.last_summary || {})}
            </p>
            <p style={styles.smallText}>
              <strong>Beta safety rails</strong> last run: {fmtTs(hb("safety_rails")?.last_run_at)} —{" "}
              {JSON.stringify(hb("safety_rails")?.last_summary || {})}
            </p>
            <p style={styles.smallText}>
              Schedule <code>POST sweep-shipment-tracking</code> and <code>POST beta-safety-rails</code> with the
              service role (same as your smoke test). Customer support:{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
          </section>

          <section style={{ ...styles.subPanel, marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Stripe webhooks</h3>
            <p style={styles.smallText}>{data.stripeWebhookFailuresNote}</p>
          </section>

          <HealthTable
            title={`Failed label purchases (${(data.failedLabelPurchases || []).length})`}
            rows={data.failedLabelPurchases || []}
            empty="None detected."
          />
          <HealthTable
            title={`Paid, label still needed (${(data.paidShipmentsMissingLabels || []).length})`}
            rows={data.paidShipmentsMissingLabels || []}
            empty="None detected."
          />
          <HealthTable
            title={`Stuck at label_created (${(data.stuckLabelCreated || []).length})`}
            rows={data.stuckLabelCreated || []}
            empty="None detected."
          />
          <HealthTable
            title={`FedEx carrier exception (${(data.carrierExceptionShipments || []).length})`}
            rows={data.carrierExceptionShipments || []}
            empty="None — no shipment rows in shipping_status exception."
          />

          <section style={{ ...styles.subPanel, marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>
              Unresolved overage events ({(data.unresolvedOverageEvents || []).length})
            </h3>
            {(data.unresolvedOverageEvents || []).length === 0 ? (
              <p style={styles.mutedText}>None.</p>
            ) : (
              <ul style={styles.smallText}>
                {(data.unresolvedOverageEvents || []).map((e) => (
                  <li key={e.id} style={{ marginBottom: 8 }}>
                    {e.id} · shipment {e.shipment_id} · bin {e.box_id || "—"} · $
                    {((e.overage_amount_cents || 0) / 100).toFixed(2)}{" "}
                    <button
                      type="button"
                      style={{ marginLeft: 8, fontSize: 12 }}
                      onClick={async () => {
                        if (!window.confirm("Dismiss this overage event?")) return;
                        const { data: r, error } = await appData.invokeEdge("shipping-overage-admin", {
                          action: "update_status",
                          id: e.id,
                          detectionStatus: "dismissed",
                          notes: "Dismissed from Beta health page",
                        });
                        if (error || r?.error) alert(error?.message || r?.error || "Failed");
                        else load();
                      }}
                    >
                      Dismiss
                    </button>
                    {e.box_id ? (
                      <>
                        {" "}
                        <Link to={`/admin/boxes/${encodeURIComponent(e.box_id)}`}>Bin</Link>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function HealthTable({ title, rows, empty }) {
  return (
    <section style={{ ...styles.subPanel, marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {rows.length === 0 ? (
        <p style={styles.mutedText}>{empty}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: "6px 4px" }}>Bin</th>
                <th style={{ padding: "6px 4px" }}>Shipment</th>
                <th style={{ padding: "6px 4px" }}>Ship status</th>
                <th style={{ padding: "6px 4px" }}>Label</th>
                <th style={{ padding: "6px 4px" }}>Tracking</th>
                <th style={{ padding: "6px 4px" }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "6px 4px" }}>{r.box_id || "—"}</td>
                  <td style={{ padding: "6px 4px", fontFamily: "monospace", fontSize: 12 }}>{r.id}</td>
                  <td style={{ padding: "6px 4px" }}>{r.shipping_status}</td>
                  <td style={{ padding: "6px 4px" }}>{r.label_status}</td>
                  <td style={{ padding: "6px 4px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.tracking_number || "—"}
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    {r.box_id ? (
                      <Link to={`/admin/boxes/${encodeURIComponent(r.box_id)}`}>Open bin</Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
