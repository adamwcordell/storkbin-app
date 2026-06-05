import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useScanPrompt } from "../hooks/useScanPrompt";
import { supabase, supabaseFunctionAuthHeaders } from "../supabaseClient";
import { buildDisplayBinRef, resolveCustomerEmailForBin } from "../utils/binDisplayRef";
import { getCustomerBinScanUrl } from "../utils/binScanUrl";
import { bayScanMatchesCode, needsHomeBayPlacement } from "../utils/binIntake";
import { binScanMatchesBox, explainBayScanMismatch } from "../utils/scanMatch";
import { getBayScanUrl } from "../utils/bayScanUrl";
import WarehouseWorkflowPanel from "../components/WarehouseWorkflowPanel";
import {
  canPickForSendToCustomer,
  getWarehouseWorkflow,
  shouldShowReturnIntakeActions,
} from "../utils/warehouseWorkflow";
import { getEdgeFunctionErrorMessage } from "../utils/edgeFunctionErrors";
import styles from "../styles/styles";

function isStarterKitShipmentRow(row) {
  return (
    row?.checkout_status === "paid" &&
    row?.fulfillment_status === "paid_waiting_to_ship_bin" &&
    row?.latest_shipment_direction === "to_customer" &&
    Boolean(row?.latest_shipment_id)
  );
}

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
    email: resolveCustomerEmailForBin({
      row: box,
      profileById: profileEmail ? { [box.user_id]: { email: profileEmail } } : {},
    }),
    boxNumber: box.box_number,
    boxId: box.id,
  });
  const workflowOpts = { isStarterKitShipmentRow: () => isStarterKitShipmentRow(box) };
  const outboundPick = canPickForSendToCustomer(box, assignment, workflowOpts);
  const showReturnPlacement = shouldShowReturnIntakeActions(box, assignment, workflowOpts);
  const alreadyPlaced = bayCode && assignment?.status === "placed";
  const outboundPrepDone = ["picked", "in_staging", "label_verified", "qr_applied", "outbound_labeled"].includes(
    String(assignment?.status || ""),
  );
  const workflow = getWarehouseWorkflow(
    {
      ...box,
      latest_shipment_direction: box.latest_shipment_direction,
      latest_shipping_status: box.latest_shipping_status,
      latest_charge_status: box.latest_charge_status,
    },
    assignment,
    workflowOpts,
  );
  const pageTitle = outboundPick || (outboundPrepDone && box.latest_shipment_direction === "to_customer")
    ? `Send bin · ${binLabel}`
    : `Receive bin · ${binLabel}`;

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
      message: `Point the camera at the bay sticker on rack slot ${bayCode} — not the bin QR you just scanned.`,
      expectedHint: getBayScanUrl(bayCode) || bayCode,
      scanMode: "qr_url",
      delayScanStartMs: 2000,
      decodeCooldownMs: 1000,
      manualPlaceholder: bayCode,
    });

    if (!bayScan || !String(bayScan).trim()) {
      return;
    }

    if (!bayScanMatchesCode(bayScan, bayCode)) {
      alert(explainBayScanMismatch(bayScan, bayCode));
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

  const handleMarkPicked = async () => {
    if (busy) return;

    const binScanned = await scanPrompt({
      title: `Pick — scan bin ${binLabel}`,
      message: `Scan the bin QR on the physical bin you are pulling from home bay ${bayCode || "the rack"}.`,
      expectedHint: getCustomerBinScanUrl(box.id) || box.id,
      scanMode: "qr_url",
    });
    if (!binScanned || !String(binScanned).trim()) return;
    if (!binScanMatchesBox(binScanned, box.id, assignment?.bin_qr_code)) {
      alert("Bin QR scan does not match this bin.");
      return;
    }

    setBusy(true);
    try {
      const auth = await supabaseFunctionAuthHeaders();
      const pickedResult = await supabase.functions.invoke("admin-storage-ops", {
        body: {
          action: "mark_picked",
          boxId: box.id,
          binQrCode: String(binScanned).trim(),
        },
        headers: auth,
      });
      if (pickedResult.error || pickedResult.data?.error) {
        const msg = await getEdgeFunctionErrorMessage(pickedResult.error, pickedResult.data);
        alert(msg || "Could not mark picked.");
        return;
      }

      const stagedResult = await supabase.functions.invoke("admin-storage-ops", {
        body: { action: "mark_in_staging", boxId: box.id },
        headers: auth,
      });
      if (stagedResult.error || stagedResult.data?.error) {
        const msg = await getEdgeFunctionErrorMessage(stagedResult.error, stagedResult.data);
        alert(msg || "Could not mark in staging.");
        return;
      }

      await loadIntake();
      alert(`Bin ${binLabel} picked and staged. Continue on Admin dashboard to print the ship label.`);
    } finally {
      setBusy(false);
    }
  };

  const actionPanelStyle = {
    ...styles.panel,
    borderLeft: `4px solid ${outboundPick ? "#5a7a9d" : needsHomeBayPlacement(assignment) ? "#4a6741" : "#9ca3af"}`,
    maxWidth: "520px",
    marginTop: 16,
  };

  return (
    <div>
      {scanModal}

      <div style={styles.pageHeaderRow}>
        <div>
          <h2 style={styles.sectionTitle}>{pageTitle}</h2>
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

      <section style={actionPanelStyle}>
        {outboundPick ? (
          <>
            <p style={{ ...styles.smallText, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Pick for outbound ship
            </p>
            <h3 style={{ margin: "0 0 12px", fontSize: "32px", fontWeight: 700, color: "#2d3b2d" }}>
              {bayCode ? `Home bay ${bayCode}` : "Pick bin"}
            </h3>
            <p style={{ ...styles.mutedText, marginBottom: "20px" }}>
              Customer paid to ship this bin to their address. Pull it from rack{" "}
              <strong>{bayCode || "(assign home bay first)"}</strong>, scan the bin QR, and stage it for labeling.
            </p>
            <button
              type="button"
              style={styles.primaryButton}
              disabled={busy || !bayCode}
              onClick={() => void handleMarkPicked()}
            >
              {busy ? "Saving…" : "Pick + Stage Scan"}
            </button>
            {!bayCode ? (
              <p style={{ ...styles.warningText, marginTop: 12 }}>
                Assign a home bay on the Admin dashboard before picking.
              </p>
            ) : null}
          </>
        ) : outboundPrepDone && box.latest_shipment_direction === "to_customer" ? (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: "18px", color: "#2d3b2d" }}>Picked and staged</h3>
            <p style={styles.mutedText}>
              This bin is in staging ({assignment?.status?.replace(/_/g, " ")}). Continue on the Admin dashboard to
              print the carrier label.
            </p>
            <Link to="/admin" style={{ ...styles.primaryButton, display: "inline-block", marginTop: 12 }}>
              Admin dashboard
            </Link>
          </>
        ) : !bayCode ? (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: "18px" }}>No home bay assigned</h3>
            <p style={styles.mutedText}>
              Assign a permanent home bay for this bin from the Admin dashboard before intake.
            </p>
            <Link to="/admin" style={styles.primaryButton}>
              Go to Admin
            </Link>
          </>
        ) : alreadyPlaced && !showReturnPlacement ? (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: "18px", color: "#2d3b2d" }}>
              Already in home bay {bayCode}
            </h3>
            <p style={styles.mutedText}>This bin is confirmed placed in its rack location.</p>
          </>
        ) : showReturnPlacement ? (
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
        ) : (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: "18px" }}>No warehouse action here</h3>
            <p style={styles.mutedText}>Open the Admin dashboard for next steps on this bin.</p>
            <Link to="/admin" style={styles.primaryButton}>
              Admin dashboard
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
