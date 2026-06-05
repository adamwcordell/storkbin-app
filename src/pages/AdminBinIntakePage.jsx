import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useScanPrompt } from "../hooks/useScanPrompt";
import { supabase, supabaseFunctionAuthHeaders } from "../supabaseClient";
import { buildDisplayBinRef, resolveCustomerEmailForBin } from "../utils/binDisplayRef";
import { getCustomerBinScanUrl } from "../utils/binScanUrl";
import { bayScanMatchesCode, needsHomeBayPlacement } from "../utils/binIntake";
import { binScanMatchesBox } from "../utils/scanMatch";
import WarehouseWorkflowPanel from "../components/WarehouseWorkflowPanel";
import { getWarehouseWorkflow } from "../utils/warehouseWorkflow";
import { getEdgeFunctionErrorMessage } from "../utils/edgeFunctionErrors";
import styles from "../styles/styles";

export default function AdminBinIntakePage({ appData }) {
  const { boxId } = useParams();
  const navigate = useNavigate();
  const { scanPrompt, scanModal } = useScanPrompt();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [box, setBox] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [profileEmail, setProfileEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const loadIntake = useCallback(async () => {
    if (!boxId || !appData?.isAdmin) return;

    setLoading(true);
    setLoadError("");

    const { data: adminRow, error: adminErr } = await supabase
      .from("admin_ops_bins")
      .select("*")
      .eq("id", boxId)
      .maybeSingle();

    if (adminErr) {
      setLoadError(adminErr.message);
      setLoading(false);
      return;
    }

    let resolvedBox = adminRow;
    if (!resolvedBox) {
      const { data: bare, error: bareErr } = await supabase
        .from("boxes")
        .select("*")
        .eq("id", boxId)
        .maybeSingle();
      if (bareErr || !bare) {
        setLoadError(bareErr?.message || "Bin not found.");
        setLoading(false);
        return;
      }
      resolvedBox = bare;
    }

    const canonicalId = String(resolvedBox.id || boxId);
    setBox(resolvedBox);

    const { data: asn } = await supabase
      .from("bin_storage_assignments")
      .select("*")
      .eq("box_id", canonicalId)
      .eq("is_current", true)
      .maybeSingle();
    setAssignment(asn || null);

    const uid = String(resolvedBox.user_id || "").trim();
    if (uid) {
      const { data: profile } = await supabase.from("profiles").select("email").eq("id", uid).maybeSingle();
      setProfileEmail(String(profile?.email || "").trim());
    } else {
      setProfileEmail("");
    }

    setLoading(false);
  }, [appData?.isAdmin, boxId]);

  useEffect(() => {
    void loadIntake();
  }, [loadIntake]);

  if (!appData?.isAdmin) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Warehouse intake</h2>
        <p style={styles.warningText}>Admin access required.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Loading bin…</h2>
      </div>
    );
  }

  if (loadError || !box) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Bin not found</h2>
        <p style={styles.warningText}>{loadError || "Could not load this bin."}</p>
        <Link to="/admin" style={styles.linkButtonSecondary}>
          Back to Admin
        </Link>
      </div>
    );
  }

  const bayCode = String(assignment?.bay_code || "").trim().toUpperCase();
  const binLabel = box.box_number || box.id;
  const displayRef = buildDisplayBinRef({
    email: resolveCustomerEmailForBin({ row: box, profileById: profileEmail ? { [box.user_id]: { email: profileEmail } } : {} }),
    boxNumber: box.box_number,
    boxId: box.id,
  });
  const awaitingPlacement = needsHomeBayPlacement(assignment);
  const alreadyPlaced = bayCode && assignment?.status === "placed";
  const workflow = getWarehouseWorkflow(
    {
      ...box,
      latest_shipment_direction: box.latest_shipment_direction,
      latest_shipping_status: box.latest_shipping_status,
    },
    assignment,
    { isStarterKitShipmentRow: () => false },
  );

  const handleConfirmPlaced = async () => {
    if (!bayCode || busy) return;

    const binScan = await scanPrompt({
      title: `Scan bin — ${binLabel}`,
      message: "Scan the QR sticker on this physical bin to confirm you have the correct bin.",
      expectedHint: getCustomerBinScanUrl(box.id) || box.id,
      scanMode: "qr_url",
    });
    if (!binScan || !String(binScan).trim()) return;
    if (!binScanMatchesBox(binScan, box.id, assignment?.bin_qr_code)) {
      alert("That scan does not match this bin. Use the sticker on the bin you are placing.");
      return;
    }

    const bayScan = await scanPrompt({
      title: `Scan bay ${bayCode}`,
      message: `Place the bin in home bay ${bayCode}, then scan the bay QR at that rack slot.`,
      expectedHint: bayCode,
      scanMode: "qr_url",
    });

    if (!bayScan || !String(bayScan).trim()) {
      return;
    }

    if (!bayScanMatchesCode(bayScan, bayCode)) {
      alert(`Bay scan does not match home bay ${bayCode}.\n\nYou scanned:\n${String(bayScan).slice(0, 120)}`);
      return;
    }

    setBusy(true);
    try {
      const auth = await supabaseFunctionAuthHeaders();
      const { data, error } = await supabase.functions.invoke("admin-storage-ops", {
        body: {
          action: "mark_placed",
          boxId: box.id,
          intakeMode: true,
          binQrScan: String(binScan).trim(),
          bayQrScan: String(bayScan).trim(),
        },
        headers: auth,
      });

      if (error || data?.error) {
        const msg = await getEdgeFunctionErrorMessage(error, data);
        alert(msg || "Could not confirm placement.");
        return;
      }

      await loadIntake();
      alert(`Bin ${binLabel} confirmed in home bay ${bayCode}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {scanModal}

      <div style={styles.pageHeaderRow}>
        <div>
          <h2 style={styles.sectionTitle}>Receive bin · {binLabel}</h2>
          <p style={styles.mutedText}>{displayRef}</p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button type="button" style={styles.secondaryButton} onClick={() => navigate("/admin")}>
            Admin dashboard
          </button>
          <Link to={`/admin/boxes/${box.id}`} style={styles.linkButtonSecondary}>
            Full bin details
          </Link>
        </div>
      </div>

      {workflow ? <WarehouseWorkflowPanel workflow={workflow} /> : null}

      <section
        style={{
          ...styles.panel,
          borderLeft: awaitingPlacement ? "4px solid #4a6741" : "4px solid #9ca3af",
          maxWidth: "520px",
          marginTop: 16,
        }}
      >
        {!bayCode ? (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: "18px" }}>No home bay assigned</h3>
            <p style={styles.mutedText}>
              Assign a permanent home bay for this bin from the Admin dashboard before intake.
            </p>
            <Link to="/admin" style={styles.primaryButton}>
              Go to Admin
            </Link>
          </>
        ) : alreadyPlaced ? (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: "18px", color: "#2d3b2d" }}>
              Already in home bay {bayCode}
            </h3>
            <p style={styles.mutedText}>This bin is confirmed placed in its rack location.</p>
          </>
        ) : (
          <>
            <p style={{ ...styles.smallText, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Place bin here
            </p>
            <h3 style={{ margin: "0 0 12px", fontSize: "32px", fontWeight: 700, color: "#2d3b2d" }}>
              Home bay {bayCode}
            </h3>
            <p style={{ ...styles.mutedText, marginBottom: "20px" }}>
              Move the bin to rack location <strong>{bayCode}</strong>, then confirm below and scan the bay QR or label
              at that slot.
            </p>
            <button
              type="button"
              style={styles.primaryButton}
              disabled={busy}
              onClick={() => void handleConfirmPlaced()}
            >
              {busy ? "Saving…" : "Place bin (scan bin + bay)"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
