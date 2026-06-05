import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import BayQrStickerSheet from "../components/BayQrStickerSheet";
import { supabase, supabaseFunctionAuthHeaders } from "../supabaseClient";
import { formatHomeBayLine } from "../utils/homeBayDisplay";
import { getBayScanUrl } from "../utils/bayScanUrl";
import styles from "../styles/styles";

export default function AdminStorageBaysPage({ appData }) {
  const [bays, setBays] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [binRows, setBinRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [printBay, setPrintBay] = useState(null);

  const load = useCallback(async () => {
    if (!appData?.isAdmin) return;
    setLoading(true);
    setError("");

    const auth = await supabaseFunctionAuthHeaders();
    const { data, error: edgeErr } = await supabase.functions.invoke("admin-storage-ops", {
      body: { action: "list_state" },
      headers: auth,
    });

    if (edgeErr || data?.error) {
      setError(data?.error || edgeErr?.message || "Could not load storage bays.");
      setLoading(false);
      return;
    }

    setBays(data?.bays || []);
    setAssignments(data?.assignments || []);

    const boxIds = [...new Set((data?.assignments || []).map((a) => String(a.box_id)).filter(Boolean))];
    if (boxIds.length) {
      const { data: rows } = await supabase
        .from("admin_ops_bins")
        .select("id, box_number, user_id, status, fulfillment_status, customer_email")
        .in("id", boxIds);
      setBinRows(rows || []);
    } else {
      setBinRows([]);
    }

    setLoading(false);
  }, [appData?.isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const byBay = new Map();
    for (const a of assignments) {
      const code = String(a.bay_code || "").trim().toUpperCase();
      if (code) byBay.set(code, a);
    }

    return (bays || [])
      .map((bay) => {
        const code = String(bay.bay_code || "").trim().toUpperCase();
        const asn = byBay.get(code) || null;
        const bin = asn ? binRows.find((r) => String(r.id) === String(asn.box_id)) : null;
        const homeLine = bin && asn ? formatHomeBayLine(asn, bin) : null;
        return { bay, code, asn, bin, homeLine };
      })
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [assignments, bays, binRows]);

  if (!appData?.isAdmin) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Storage bays</h2>
        <p style={styles.warningText}>Admin access required.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={styles.pageHeaderRow}>
        <div>
          <h2 style={styles.sectionTitle}>Storage bays</h2>
          <p style={styles.mutedText}>
            Permanent rack locations. Each bin keeps its home bay for life. Print bay QR stickers and affix at each
            slot.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={styles.secondaryButton} onClick={() => void load()}>
            Refresh
          </button>
          <Link to="/admin" style={styles.linkButtonSecondary}>
            Admin dashboard
          </Link>
        </div>
      </div>

      {loading ? <p style={styles.mutedText}>Loading bays…</p> : null}
      {error ? <p style={styles.warningText}>{error}</p> : null}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e5e5e5", textAlign: "left" }}>
              <th style={{ padding: "8px 10px" }}>Bay</th>
              <th style={{ padding: "8px 10px" }}>Home bin</th>
              <th style={{ padding: "8px 10px" }}>Bin status</th>
              <th style={{ padding: "8px 10px" }}>Assignment</th>
              <th style={{ padding: "8px 10px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ code, asn, bin, homeLine }) => (
              <tr key={code} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "10px", fontWeight: 700 }}>{code}</td>
                <td style={{ padding: "10px" }}>
                  {bin ? (
                    <>
                      <Link to={`/admin/boxes/${bin.id}`}>{bin.box_number || bin.id}</Link>
                      <p style={{ ...styles.smallText, margin: "4px 0 0" }}>{bin.customer_email || "—"}</p>
                    </>
                  ) : (
                    <span style={styles.mutedText}>Empty slot</span>
                  )}
                </td>
                <td style={{ padding: "10px" }}>{bin?.status || "—"}</td>
                <td style={{ padding: "10px" }}>
                  {asn ? (
                    <>
                      <span>{asn.status || "—"}</span>
                      {homeLine?.secondary ? (
                        <p style={{ ...styles.smallText, margin: "4px 0 0" }}>{homeLine.secondary}</p>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={{ padding: "10px" }}>
                  <button type="button" style={styles.secondaryButton} onClick={() => setPrintBay(code)}>
                    Print bay QR
                  </button>
                  {bin && asn?.status !== "placed" ? (
                    <Link
                      to={`/admin/intake/${bin.id}`}
                      style={{ ...styles.linkButtonSecondary, marginLeft: 8, display: "inline-block" }}
                    >
                      Intake
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {printBay ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10050,
            background: "rgba(0,0,0,0.45)",
            overflowY: "auto",
            padding: 24,
          }}
          onClick={() => setPrintBay(null)}
        >
          <div
            style={{
              maxWidth: 420,
              margin: "0 auto",
              background: "#fff",
              borderRadius: 12,
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <strong>Bay {printBay}</strong>
              <button type="button" style={styles.secondaryButton} onClick={() => setPrintBay(null)}>
                Close
              </button>
            </div>
            <p style={{ ...styles.smallText, wordBreak: "break-all" }}>{getBayScanUrl(printBay)}</p>
            <BayQrStickerSheet bayCode={printBay} />
            <button
              type="button"
              style={{ ...styles.primaryButton, marginTop: 12 }}
              onClick={() => window.print()}
            >
              Print
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
