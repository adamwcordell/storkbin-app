/**
 * TEMP — QR / scan flow testing for admins only.
 * REMOVE THIS PAGE + route + nav link before production launch (search: AdminQrFlowLabPage, qr-flow-lab).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import BinQrStickerSheet from "../components/BinQrStickerSheet";
import { supabase } from "../supabaseClient";
import styles from "../styles/styles";
import { getAdminBinScanUrl, getCustomerBinScanUrl } from "../utils/binScanUrl";
import { isSafeBoxIdPathSegment, RFC_UUID_RE } from "../utils/boxIdRef";

function canonicalBoxIdFromAdminRow(row) {
  if (!row) return "";
  return String(row.box_id ?? row.id ?? "").trim();
}

function openBinPath(path) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  window.open(`${origin}${path}`, "_blank", "noopener,noreferrer");
}

async function resolveToCanonicalBoxId(raw) {
  const t = String(raw || "").trim();
  if (!t) {
    return { id: null, error: "Enter a bin reference or pick one from the list." };
  }
  if (!isSafeBoxIdPathSegment(t)) {
    return { id: null, error: "That reference contains characters that are not allowed in a bin link." };
  }

  const { data: byRowId, error: eRow } = await supabase
    .from("admin_ops_bins")
    .select("id, internal_id, box_id")
    .eq("id", t)
    .maybeSingle();

  if (!eRow && byRowId) {
    const id = canonicalBoxIdFromAdminRow(byRowId);
    if (id) return { id, error: null };
  }

  const { data: byInternal, error: eInt } = await supabase
    .from("admin_ops_bins")
    .select("id, internal_id, box_id")
    .eq("internal_id", t)
    .maybeSingle();

  if (!eInt && byInternal) {
    const id = canonicalBoxIdFromAdminRow(byInternal);
    if (id) return { id, error: null };
  }

  const { data: bare, error: eBare } = await supabase.from("boxes").select("id").eq("id", t).maybeSingle();
  if (!eBare && bare?.id) {
    return { id: String(bare.id).trim(), error: null };
  }

  if (RFC_UUID_RE.test(t)) {
    return { id: t, error: null };
  }

  return {
    id: null,
    error:
      "No bin matched that reference. Pick a row below, or paste the id from Admin → bin detail (Database ID / internal id).",
  };
}

export default function AdminQrFlowLabPage({ appData }) {
  const [binRefInput, setBinRefInput] = useState("");
  const [resolvedBoxId, setResolvedBoxId] = useState(null);
  const [resolveError, setResolveError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const [adminRows, setAdminRows] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listFilter, setListFilter] = useState("");

  const customerScanUrl = useMemo(
    () => (resolvedBoxId ? getCustomerBinScanUrl(resolvedBoxId) : ""),
    [resolvedBoxId],
  );
  const adminScanUrl = useMemo(() => (resolvedBoxId ? getAdminBinScanUrl(resolvedBoxId) : ""), [resolvedBoxId]);

  const loadAdminBinList = useCallback(async () => {
    if (!appData.isAdmin) return;
    setListLoading(true);
    const { data, error } = await supabase
      .from("admin_ops_bins")
      .select("id, internal_id, box_number, user_id, status, fulfillment_status")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      setAdminRows([]);
    } else {
      setAdminRows(data || []);
    }
    setListLoading(false);
  }, [appData.isAdmin]);

  useEffect(() => {
    void loadAdminBinList();
  }, [loadAdminBinList]);

  const runResolve = async (ref) => {
    const value = ref != null ? String(ref) : binRefInput;
    setResolving(true);
    setResolveError("");
    const { id, error } = await resolveToCanonicalBoxId(value);
    setResolving(false);
    if (id) {
      setResolvedBoxId(id);
      setBinRefInput(String(value).trim());
      setResolveError("");
    } else {
      setResolvedBoxId(null);
      setResolveError(error || "Could not resolve bin.");
    }
  };

  const filteredRows = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    if (!q) return adminRows.slice(0, 80);
    return adminRows
      .filter((r) => {
        const id = canonicalBoxIdFromAdminRow(r);
        const internal = String(r.internal_id || "").toLowerCase();
        const num = String(r.box_number ?? "").toLowerCase();
        return (
          id.toLowerCase().includes(q) ||
          internal.includes(q) ||
          num.includes(q) ||
          String(r.user_id || "")
            .toLowerCase()
            .includes(q)
        );
      })
      .slice(0, 80);
  }, [adminRows, listFilter]);

  const copyCustomerScanUrl = async () => {
    if (!customerScanUrl) return;
    try {
      await navigator.clipboard.writeText(customerScanUrl);
      setCopyMsg("Copied customer sticker URL.");
    } catch {
      setCopyMsg("Could not copy — select the URL manually.");
    }
    window.setTimeout(() => setCopyMsg(""), 3500);
  };

  const copyAdminScanUrl = async () => {
    if (!adminScanUrl) return;
    try {
      await navigator.clipboard.writeText(adminScanUrl);
      setCopyMsg("Copied warehouse sticker URL.");
    } catch {
      setCopyMsg("Could not copy — select the URL manually.");
    }
    window.setTimeout(() => setCopyMsg(""), 3500);
  };

  if (!appData.isAdmin) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>QR flow lab</h2>
        <p style={styles.warningText}>You do not have admin access.</p>
      </div>
    );
  }

  const enc = (id) => encodeURIComponent(id);

  return (
    <div style={styles.panel}>
      <div
        style={{
          padding: "12px 14px",
          borderRadius: "8px",
          background: "rgba(220, 38, 38, 0.12)",
          border: "1px solid rgba(220, 38, 38, 0.35)",
          marginBottom: "18px",
        }}
      >
        <strong style={{ color: "#991b1b" }}>Temporary testing page</strong>
        <p style={{ ...styles.smallText, margin: "6px 0 0", color: "#444" }}>
          Remove <code style={{ fontSize: "12px" }}>AdminQrFlowLabPage</code>, the{" "}
          <code style={{ fontSize: "12px" }}>/admin/qr-flow-lab</code> route, and the Admin nav link before launch
          (search the repo for <code style={{ fontSize: "12px" }}>qr-flow-lab</code>).
        </p>
      </div>

      <h2 style={styles.sectionTitle}>QR flow lab</h2>
      <p style={styles.mutedText}>
        Find any bin from the warehouse list (by <strong>database id</strong>, <strong>internal id</strong>, or bin
        number), then open the same screens customers and admins hit after scanning the QR. Bin ids may look like
        UUIDs but are not required to be RFC UUIDs. Use a <strong>private window</strong> to test the logged-out gate
        while staying signed in here.
      </p>

      <label style={{ display: "block", marginTop: "16px" }}>
        <span style={{ ...styles.smallText, fontWeight: 600 }}>Bin reference</span>
        <input
          style={{
            width: "100%",
            maxWidth: "560px",
            display: "block",
            marginTop: "6px",
            boxSizing: "border-box",
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid #ddd",
            fontSize: "14px",
          }}
          placeholder="Database id (e.g. 94b12639-1778442713884-1) or internal id"
          value={binRefInput}
          onChange={(e) => setBinRefInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runResolve();
            }
          }}
        />
      </label>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "10px", alignItems: "center" }}>
        <button type="button" style={styles.primaryButton} disabled={resolving} onClick={() => void runResolve()}>
          {resolving ? "Resolving…" : "Resolve bin"}
        </button>
        <button type="button" style={styles.secondaryButton} disabled={listLoading} onClick={() => void loadAdminBinList()}>
          Refresh bin list
        </button>
      </div>

      {resolveError ? (
        <p style={{ ...styles.warningText, marginTop: "12px", maxWidth: "640px" }}>{resolveError}</p>
      ) : null}

      <section style={{ marginTop: "22px" }}>
        <h3 style={{ fontSize: "16px", margin: "0 0 8px" }}>Pick from admin bins</h3>
        <p style={styles.smallText}>
          {listLoading ? "Loading…" : `${adminRows.length} bins loaded (latest 500). Filter and click a row.`}
        </p>
        <input
          style={{
            width: "100%",
            maxWidth: "400px",
            marginTop: "8px",
            boxSizing: "border-box",
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid #ddd",
            fontSize: "14px",
          }}
          placeholder="Filter by bin #, id, internal id, user id…"
          value={listFilter}
          onChange={(e) => setListFilter(e.target.value)}
        />
        <div
          style={{
            marginTop: "10px",
            maxHeight: "220px",
            overflowY: "auto",
            border: "1px solid #e5e5e5",
            borderRadius: "8px",
            background: "#fafafa",
          }}
        >
          {filteredRows.length === 0 ? (
            <p style={{ ...styles.smallText, padding: "12px" }}>No rows match.</p>
          ) : (
            filteredRows.map((r) => {
              const cid = canonicalBoxIdFromAdminRow(r);
              const label = r.box_number != null ? `Bin ${r.box_number}` : `Bin ${cid.slice(0, 12)}…`;
              return (
                <button
                  key={`${cid}-${r.internal_id || ""}`}
                  type="button"
                  onClick={() => {
                    setBinRefInput(cid);
                    void runResolve(cid);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    borderBottom: "1px solid #e8e8e8",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: "13px",
                    lineHeight: 1.4,
                  }}
                >
                  <strong>{label}</strong>
                  <span style={{ color: "#666" }}>
                    {" "}
                    · {r.status || "—"} / {r.fulfillment_status || "—"}
                  </span>
                  <br />
                  <span style={{ fontSize: "12px", color: "#555" }}>
                    id: <code>{cid}</code>
                    {r.internal_id ? (
                      <>
                        {" "}
                        · internal: <code>{r.internal_id}</code>
                      </>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      {resolvedBoxId && (
        <>
          <section style={{ marginTop: "22px", padding: "14px", background: "rgba(143,175,143,0.15)", borderRadius: "8px" }}>
            <p style={{ ...styles.smallText, margin: "0 0 6px" }}>
              <strong>Canonical box id</strong> (encode this in the QR):
            </p>
            <code style={{ fontSize: "13px", wordBreak: "break-all" }}>{resolvedBoxId}</code>
          </section>

          <section style={{ marginTop: "22px" }}>
            <h3 style={{ fontSize: "16px", margin: "0 0 10px" }}>Same as scanning the QR</h3>
            <p style={{ ...styles.smallText, marginBottom: "12px" }}>
              <strong>Customer view</strong> — bin card with QR follow-up. <strong>Admin view</strong> —{" "}
              <code>/scan</code> smart router (lifecycle-driven admin bin detail).
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" }}>
              <button
                type="button"
                style={styles.primaryButton}
                onClick={() => openBinPath(`/scan/${enc(resolvedBoxId)}?customer=1`)}
              >
                Customer view (scan ?customer=1 → your bin card)
              </button>
              <button
                type="button"
                style={{ ...styles.primaryButton, background: "#4b5563" }}
                onClick={() => openBinPath(`/scan/${enc(resolvedBoxId)}?admin=1`)}
              >
                Admin view (scan ?admin=1 → warehouse router)
              </button>
              <button type="button" style={styles.secondaryButton} onClick={() => openBinPath(`/bins/${enc(resolvedBoxId)}`)}>
                Customer: bin detail (My Bins path, no scan)
              </button>
              <button type="button" style={styles.secondaryButton} onClick={() => openBinPath(`/admin/boxes/${enc(resolvedBoxId)}`)}>
                Admin: open bin detail directly
              </button>
            </div>
          </section>

          <section style={{ marginTop: "20px" }}>
            <h3 style={{ fontSize: "16px", margin: "0 0 8px" }}>QR URLs (print different stickers)</h3>
            <p style={{ ...styles.smallText, margin: "0 0 6px" }}>
              <strong>Customer sticker</strong> (on the bin — encodes <code>?customer=1</code>):
            </p>
            <p style={{ ...styles.smallText, wordBreak: "break-all", margin: "0 0 10px" }}>{customerScanUrl}</p>
            <p style={{ ...styles.smallText, margin: "0 0 6px" }}>
              <strong>Warehouse sticker</strong> (staff — encodes <code>?admin=1</code>):
            </p>
            <p style={{ ...styles.smallText, wordBreak: "break-all", margin: "0 0 10px" }}>{adminScanUrl}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
              <button type="button" style={styles.secondaryButton} onClick={() => void copyCustomerScanUrl()}>
                Copy customer QR URL
              </button>
              <button type="button" style={styles.secondaryButton} onClick={() => void copyAdminScanUrl()}>
                Copy warehouse QR URL
              </button>
              {copyMsg ? <span style={styles.smallText}>{copyMsg}</span> : null}
            </div>
          </section>

          <section style={{ marginTop: "22px" }}>
            <h3 style={{ fontSize: "16px", margin: "0 0 8px" }}>Logged-out scan gate</h3>
            <p style={styles.smallText}>
              Copy the scan URL and open it in an incognito/private window (or sign out elsewhere).
            </p>
          </section>

          <section style={{ marginTop: "22px" }}>
            <h3 style={{ fontSize: "16px", margin: "0 0 10px" }}>Sticker preview</h3>
            <BinQrStickerSheet boxId={resolvedBoxId} />
          </section>
        </>
      )}

      <p style={{ ...styles.mutedText, marginTop: "28px" }}>
        <Link to="/admin" style={styles.linkButtonSecondary}>
          ← Admin dashboard
        </Link>
      </p>
    </div>
  );
}
