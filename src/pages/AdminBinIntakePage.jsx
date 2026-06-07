import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import BinQrStickerPrintModal from "../components/BinQrStickerPrintModal";
import StarterKitLabelModal from "../components/StarterKitLabelModal";
import { useScanPrompt } from "../hooks/useScanPrompt";
import { supabase, supabaseFunctionAuthHeaders } from "../supabaseClient";
import { buildDisplayBinRef, resolveCustomerEmailForBin } from "../utils/binDisplayRef";
import { getCustomerBinScanUrl } from "../utils/binScanUrl";
import { bayScanMatchesCode, needsHomeBayPlacement } from "../utils/binIntake";
import { binScanMatchesBox, explainBayScanMismatch } from "../utils/scanMatch";
import { getBayScanUrl } from "../utils/bayScanUrl";
import { isStagingShippingSimulatorAllowed, resolveShipmentLabelUrl } from "../utils/shipmentPublicUrls";
import WarehouseWorkflowPanel from "../components/WarehouseWorkflowPanel";
import {
  canApplyBinQrSticker,
  canPrintBinQrSticker,
  canGenerateLabelForBin,
  canMatchShippingLabelForBin,
  getPrimaryWarehouseAction,
  isOutboundStaged,
  isStarterKitShipmentRow,
} from "../utils/warehouseBinWorkflow";
import { runWarehouseLabelMatch } from "../utils/warehouseLabelMatch";
import {
  canPickForSendToCustomer,
  getWarehouseWorkflow,
  shouldShowReturnIntakeActions,
} from "../utils/warehouseWorkflow";
import { getEdgeFunctionErrorMessage } from "../utils/edgeFunctionErrors";
import styles from "../styles/styles";

export default function AdminBinIntakePage({ appData }) {
  const { boxId } = useParams();
  const { scanPrompt, scanModal } = useScanPrompt();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [box, setBox] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [profileEmail, setProfileEmail] = useState("");
  const [storageBays, setStorageBays] = useState([]);
  const [busy, setBusy] = useState(false);
  const [starterLabelModal, setStarterLabelModal] = useState(null);
  const [qrPrintModalOpen, setQrPrintModalOpen] = useState(false);

  const invokeEdge = useCallback(async (name, body) => {
    const auth = await supabaseFunctionAuthHeaders();
    return supabase.functions.invoke(name, { body, headers: auth });
  }, []);

  const refreshAfterAction = useCallback(async () => {
    await appData?.refreshAppData?.();
  }, [appData]);

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

    const [{ data: asn }, { data: storageState }] = await Promise.all([
      supabase
        .from("bin_storage_assignments")
        .select("*")
        .eq("box_id", canonicalId)
        .eq("is_current", true)
        .maybeSingle(),
      invokeEdge("admin-storage-ops", { action: "list_state" }),
    ]);

    setAssignment(asn || null);
    if (!storageState?.error) {
      setStorageBays(storageState?.bays || []);
    }

    const uid = String(resolvedBox.user_id || "").trim();
    if (uid) {
      const { data: profile } = await supabase.from("profiles").select("email").eq("id", uid).maybeSingle();
      setProfileEmail(String(profile?.email || "").trim());
    } else {
      setProfileEmail("");
    }

    setLoading(false);
  }, [appData?.isAdmin, boxId, invokeEdge]);

  useEffect(() => {
    void loadIntake();
  }, [loadIntake]);

  const workflowOpts = useMemo(
    () => ({ isStarterKitShipmentRow: (row) => isStarterKitShipmentRow(row) }),
    [],
  );

  const shipment = useMemo(() => {
    if (!box?.id) return null;
    return appData?.getShipmentForBox?.(box.id) || null;
  }, [appData, box?.id, appData?.shipments]);

  const displayRef = useMemo(() => {
    if (!box) return "";
    return buildDisplayBinRef({
      email: resolveCustomerEmailForBin({
        row: box,
        profileById: profileEmail ? { [box.user_id]: { email: profileEmail } } : {},
      }),
      boxNumber: box.box_number,
      boxId: box.id,
    });
  }, [box, profileEmail]);

  const handleConfirmPlaced = async () => {
    if (!box || !assignment?.bay_code || busy) return;
    const bayCode = String(assignment.bay_code).trim().toUpperCase();
    const binLabel = box.box_number || box.id;

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
    if (!bayScan || !String(bayScan).trim()) return;
    if (!bayScanMatchesCode(bayScan, bayCode)) {
      alert(explainBayScanMismatch(bayScan, bayCode));
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await invokeEdge("admin-storage-ops", {
        action: "mark_placed",
        boxId: box.id,
        intakeMode: true,
        binQrScan: String(binScan).trim(),
        bayQrScan: String(bayScan).trim(),
      });
      if (error || data?.error) {
        alert((await getEdgeFunctionErrorMessage(error, data)) || "Could not confirm placement.");
        return;
      }
      await loadIntake();
      await refreshAfterAction();
      alert(`Bin ${binLabel} stored in home bay ${bayCode}.`);
    } finally {
      setBusy(false);
    }
  };

  const handleMarkPicked = async () => {
    if (!box || busy) return;
    const bayCode = String(assignment?.bay_code || "").trim().toUpperCase();
    const binLabel = box.box_number || box.id;

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
      const pickedResult = await invokeEdge("admin-storage-ops", {
        action: "mark_picked",
        boxId: box.id,
        binQrCode: String(binScanned).trim(),
      });
      if (pickedResult.error || pickedResult.data?.error) {
        alert(
          (await getEdgeFunctionErrorMessage(pickedResult.error, pickedResult.data)) ||
            "Could not mark picked.",
        );
        return;
      }

      const stagedResult = await invokeEdge("admin-storage-ops", {
        action: "mark_in_staging",
        boxId: box.id,
      });
      if (stagedResult.error || stagedResult.data?.error) {
        alert(
          (await getEdgeFunctionErrorMessage(stagedResult.error, stagedResult.data)) ||
            "Could not mark in staging.",
        );
        return;
      }

      await loadIntake();
      await refreshAfterAction();
      alert(`Bin ${binLabel} picked and staged. Next: create the carrier label below.`);
    } finally {
      setBusy(false);
    }
  };

  const handleAssignBay = async () => {
    if (!box || busy) return;
    const { data: storageState } = await invokeEdge("admin-storage-ops", { action: "list_state" });
    const occupied = new Set(
      (storageState?.assignments || [])
        .map((r) => String(r.bay_code || "").trim().toUpperCase())
        .filter(Boolean),
    );
    const baysList = storageState?.bays || storageBays;
    const availableBayCodes = (baysList || [])
      .map((bay) => String(bay.bay_code || "").trim().toUpperCase())
      .filter((code) => code && !occupied.has(code));

    const promptDefault = availableBayCodes[0] || "A1";
    const bayCode = window.prompt(
      `Assign home bay for bin ${box.box_number || box.id}.\nAvailable: ${availableBayCodes.join(", ") || "(none free)"}`,
      promptDefault,
    );
    if (!bayCode) return;

    setBusy(true);
    try {
      const { data, error } = await invokeEdge("admin-storage-ops", {
        action: "assign_bay",
        boxId: box.id,
        bayCode: String(bayCode).trim().toUpperCase(),
        actor: appData.user?.email || "admin",
      });
      if (error || data?.error) {
        alert(data?.error || error?.message || "Could not assign bay.");
        return;
      }
      await loadIntake();
      await refreshAfterAction();
    } finally {
      setBusy(false);
    }
  };

  const handleCreateLabel = async () => {
    if (!box || busy) return;
    const ship =
      shipment ||
      (box.latest_shipment_id
        ? { id: box.latest_shipment_id, shipment_direction: box.latest_shipment_direction }
        : null);

    if (!ship?.id) {
      alert("No shipment found for this bin yet.");
      return;
    }

    if (isStarterKitShipmentRow(box)) {
      setStarterLabelModal({
        shipmentId: ship.id,
        pieceCount: 1,
        kitDescription: box.box_number || box.id,
      });
      return;
    }

    setBusy(true);
    try {
      await appData.generateLabel(ship, box);
      await loadIntake();
      await refreshAfterAction();
    } finally {
      setBusy(false);
    }
  };

  const handleMatchLabel = async () => {
    if (!box || busy) return;
    setBusy(true);
    try {
      const result = await runWarehouseLabelMatch({
        box,
        assignment,
        scanPrompt,
        invokeEdge,
      });
      await loadIntake();
      await refreshAfterAction();
      alert(
        result.matchedTracking
          ? `Match confirmed. Label tracking ${result.matchedTracking} is on the correct bin.`
          : "Bin QR and shipping label barcode matched and saved.",
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not complete label matching.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmQrPrinted = async () => {
    if (!box || busy) return;
    setBusy(true);
    try {
      const result = await invokeEdge("admin-storage-ops", {
        action: "mark_qr_printed",
        boxId: box.id,
      });
      if (result.error || result.data?.error) {
        alert(
          (await getEdgeFunctionErrorMessage(result.error, result.data)) ||
            "Could not mark QR sticker printed.",
        );
        return;
      }
      setQrPrintModalOpen(false);
      await loadIntake();
      await refreshAfterAction();
    } finally {
      setBusy(false);
    }
  };

  const handleApplyBinQr = async () => {
    if (!box || busy) return;
    const binQrCode = await scanPrompt({
      title: `Scan bin QR — ${box.box_number || box.id}`,
      message: "Scan the QR sticker you are applying to this physical bin.",
      expectedHint: getCustomerBinScanUrl(box.id) || box.id,
      scanMode: "qr_url",
    });
    if (!binQrCode || !String(binQrCode).trim()) return;
    if (!binScanMatchesBox(binQrCode, box.id)) {
      alert("That scan does not match this bin.");
      return;
    }

    setBusy(true);
    try {
      const result = await invokeEdge("admin-storage-ops", {
        action: "mark_qr_applied",
        boxId: box.id,
        binQrCode: String(binQrCode).trim(),
      });
      if (result.error || result.data?.error) {
        alert(
          (await getEdgeFunctionErrorMessage(result.error, result.data)) ||
            "Could not mark QR applied.",
        );
        return;
      }
      await loadIntake();
      await refreshAfterAction();
    } finally {
      setBusy(false);
    }
  };

  const handleSimulateCarrier = async (action) => {
    if (!box?.latest_shipment_id || busy) return;
    setBusy(true);
    try {
      const { data, error } = await invokeEdge("shipment-carrier-simulator", {
        action,
        shipmentId: String(box.latest_shipment_id),
      });
      if (error || data?.error) {
        alert(data?.error || error?.message || "Could not simulate carrier update.");
        return;
      }
      await loadIntake();
      await refreshAfterAction();
    } finally {
      setBusy(false);
    }
  };

  if (!appData?.isAdmin) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Warehouse scan</h2>
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
          Admin dashboard
        </Link>
      </div>
    );
  }

  const bayCode = String(assignment?.bay_code || "").trim().toUpperCase();
  const binLabel = box.box_number || box.id;
  const showReturnPlacement = shouldShowReturnIntakeActions(box, assignment, workflowOpts);
  const outboundPick = canPickForSendToCustomer(box, assignment, workflowOpts);
  const stagedOutbound = isOutboundStaged(box, assignment);
  const canLabel = canGenerateLabelForBin(box, assignment);
  const canMatch = canMatchShippingLabelForBin(box, assignment);
  const canQr = canApplyBinQrSticker(box, assignment);
  const primaryAction = getPrimaryWarehouseAction(box, assignment, {
    isStarterKitShipmentRow,
    showReturnPlacement,
  });

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

  const pageTitle = outboundPick || stagedOutbound ? `Send bin · ${binLabel}` : `Warehouse · ${binLabel}`;

  const labelPageUrl = resolveShipmentLabelUrl(
    box.latest_label_url,
    box.latest_tracking_number,
  );

  const shipStatus = String(box.latest_shipping_status || "");
  const waitingOnCarrier =
    box.latest_shipment_direction === "to_customer" &&
    shipStatus === "label_created" &&
    assignment?.status === "label_verified";

  const actionPanelStyle = {
    ...styles.panel,
    borderLeft: `4px solid ${outboundPick || stagedOutbound ? "#5a7a9d" : needsHomeBayPlacement(assignment) ? "#4a6741" : "#9ca3af"}`,
    maxWidth: 520,
    marginTop: 16,
  };

  const renderPrimaryAction = () => {
    if (primaryAction === "pick") {
      return (
        <>
          <p style={{ ...styles.smallText, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Step 1 — Pick
          </p>
          <h3 style={{ margin: "0 0 12px", fontSize: "28px", fontWeight: 700, color: "#2d3b2d" }}>
            {bayCode ? `Home bay ${bayCode}` : "Assign home bay first"}
          </h3>
          <p style={{ ...styles.mutedText, marginBottom: 20 }}>
            Pull this bin from rack <strong>{bayCode || "—"}</strong>, scan the bin QR, and stage it for labeling.
          </p>
          <button
            type="button"
            style={styles.primaryButton}
            disabled={busy || !bayCode}
            onClick={() => void handleMarkPicked()}
          >
            {busy ? "Saving…" : "Pick + Stage Scan"}
          </button>
        </>
      );
    }

    if (primaryAction === "create_label") {
      return (
        <>
          <p style={{ ...styles.smallText, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Step 2 — Label
          </p>
          <h3 style={{ margin: "0 0 12px", fontSize: "22px", fontWeight: 700, color: "#2d3b2d" }}>
            Create carrier label
          </h3>
          <p style={{ ...styles.mutedText, marginBottom: 20 }}>
            Bin is staged. Purchase/print the FedEx label here — you stay on this screen for the next step.
          </p>
          <button type="button" style={styles.primaryButton} disabled={busy} onClick={() => void handleCreateLabel()}>
            {busy ? "Working…" : isStarterKitShipmentRow(box) ? "Choose shipping & label" : "Create Carrier Label"}
          </button>
        </>
      );
    }

    if (primaryAction === "match_label" && isStarterKitShipmentRow(box)) {
      return (
        <>
          <h3 style={{ margin: "0 0 12px", fontSize: "22px", fontWeight: 700, color: "#2d3b2d" }}>
            Match starter kit label
          </h3>
          <p style={styles.mutedText}>
            Multi-bin starter kits still use the Admin dashboard so you can scan every bin QR on one label.
          </p>
          <Link to="/admin" style={{ ...styles.primaryButton, display: "inline-block", marginTop: 12 }}>
            Open Admin dashboard
          </Link>
        </>
      );
    }

    if (primaryAction === "match_label") {
      return (
        <>
          <p style={{ ...styles.smallText, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Step 3 — Match
          </p>
          <h3 style={{ margin: "0 0 12px", fontSize: "22px", fontWeight: 700, color: "#2d3b2d" }}>
            Match shipping label
          </h3>
          <p style={{ ...styles.mutedText, marginBottom: 12 }}>
            Scan this bin&apos;s QR, then scan the tracking barcode on the printed label.
          </p>
          {box.latest_tracking_number ? (
            <p style={styles.smallText}>
              Tracking: <strong>{box.latest_tracking_number}</strong>
            </p>
          ) : null}
          {labelPageUrl ? (
            <p style={{ margin: "8px 0 16px" }}>
              <a href={labelPageUrl} target="_blank" rel="noreferrer">
                Open label to print
              </a>
            </p>
          ) : null}
          <button type="button" style={styles.primaryButton} disabled={busy} onClick={() => void handleMatchLabel()}>
            {busy ? "Saving…" : "Match Shipping Label (QR)"}
          </button>
        </>
      );
    }

    if (primaryAction === "print_qr") {
      return (
        <>
          <p style={{ ...styles.smallText, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Step 1 — Print
          </p>
          <h3 style={{ margin: "0 0 12px", fontSize: "22px", fontWeight: 700, color: "#2d3b2d" }}>
            Print bin QR sticker
          </h3>
          <p style={{ ...styles.mutedText, marginBottom: 20 }}>
            Print the 3×6 sticker first, then apply it to the physical bin.
          </p>
          <button
            type="button"
            style={styles.primaryButton}
            disabled={busy}
            onClick={() => setQrPrintModalOpen(true)}
          >
            Print QR Sticker
          </button>
        </>
      );
    }

    if (primaryAction === "apply_qr") {
      return (
        <>
          <p style={{ ...styles.smallText, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Step 2 — Apply
          </p>
          <h3 style={{ margin: "0 0 12px", fontSize: "22px", fontWeight: 700, color: "#2d3b2d" }}>
            Apply bin QR sticker
          </h3>
          <button type="button" style={styles.primaryButton} disabled={busy} onClick={() => void handleApplyBinQr()}>
            {busy ? "Saving…" : "Apply Bin QR Sticker"}
          </button>
        </>
      );
    }

    if (primaryAction === "store_in_bay") {
      return (
        <>
          <p style={{ ...styles.smallText, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Store in bay
          </p>
          <h3 style={{ margin: "0 0 12px", fontSize: "28px", fontWeight: 700, color: "#2d3b2d" }}>
            Home bay {bayCode}
          </h3>
          <p style={{ ...styles.mutedText, marginBottom: 20 }}>
            Move the bin to rack <strong>{bayCode}</strong>, then scan bin + bay to confirm.
          </p>
          <button type="button" style={styles.primaryButton} disabled={busy} onClick={() => void handleConfirmPlaced()}>
            {busy ? "Saving…" : "Store in Bay"}
          </button>
        </>
      );
    }

    if (!bayCode) {
      return (
        <>
          <h3 style={{ margin: "0 0 8px", fontSize: "18px" }}>No home bay assigned</h3>
          <p style={styles.mutedText}>Assign a permanent home bay before warehouse ops on this bin.</p>
          <button type="button" style={styles.primaryButton} disabled={busy} onClick={() => void handleAssignBay()}>
            Assign home bay
          </button>
        </>
      );
    }

    if (waitingOnCarrier) {
      return (
        <>
          <h3 style={{ margin: "0 0 8px", fontSize: "18px", color: "#2d3b2d" }}>Label matched — waiting on carrier</h3>
          <p style={styles.mutedText}>No more warehouse steps until tracking moves or the bin returns.</p>
          {isStagingShippingSimulatorAllowed() ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              <button
                type="button"
                style={styles.secondaryButton}
                disabled={busy}
                onClick={() => void handleSimulateCarrier("set_in_transit")}
              >
                Simulate in transit
              </button>
            </div>
          ) : null}
        </>
      );
    }

    if (shipStatus === "in_transit" && isStagingShippingSimulatorAllowed()) {
      return (
        <>
          <h3 style={{ margin: "0 0 8px", fontSize: "18px" }}>In transit</h3>
          <button
            type="button"
            style={styles.secondaryButton}
            disabled={busy}
            onClick={() => void handleSimulateCarrier("set_delivered")}
          >
            Simulate delivered
          </button>
        </>
      );
    }

    if (
      box.status === "at_customer" ||
      box.fulfillment_status === "bin_with_customer" ||
      (box.latest_shipment_direction === "to_customer" &&
        ["in_transit", "out_for_delivery", "delivered"].includes(shipStatus))
    ) {
      return (
        <>
          <h3 style={{ margin: "0 0 8px", fontSize: "18px" }}>With customer</h3>
          <p style={styles.mutedText}>Shipped or delivered — no warehouse action on this bin.</p>
        </>
      );
    }

    if (assignment?.status === "placed" && !showReturnPlacement) {
      return (
        <>
          <h3 style={{ margin: "0 0 8px", fontSize: "18px", color: "#2d3b2d" }}>
            In home bay {bayCode}
          </h3>
          <p style={styles.mutedText}>Bin is confirmed placed. Scan again when the next workflow step applies.</p>
        </>
      );
    }

    return (
      <>
        <h3 style={{ margin: "0 0 8px", fontSize: "18px" }}>No action here</h3>
        <p style={styles.mutedText}>
          Use the Admin dashboard for other ops on this bin, or scan again when status changes.
        </p>
      </>
    );
  };

  return (
    <div>
      {scanModal}
      <BinQrStickerPrintModal
        open={qrPrintModalOpen}
        boxId={box.id}
        displayBinRef={displayRef}
        busy={busy}
        onClose={() => {
          if (!busy) setQrPrintModalOpen(false);
        }}
        onConfirmPrinted={handleConfirmQrPrinted}
      />

      {starterLabelModal ? (
        <StarterKitLabelModal
          shipmentId={starterLabelModal.shipmentId}
          pieceCount={starterLabelModal.pieceCount}
          kitDescription={starterLabelModal.kitDescription}
          onPurchaseLabel={appData.generateLabel}
          onClose={() => setStarterLabelModal(null)}
          onSuccess={async () => {
            setStarterLabelModal(null);
            await loadIntake();
            await refreshAfterAction();
          }}
        />
      ) : null}

      <div style={styles.pageHeaderRow}>
        <div>
          <h2 style={styles.sectionTitle}>{pageTitle}</h2>
          <p style={styles.mutedText}>{displayRef}</p>
        </div>
        <Link to={`/admin/boxes/${box.id}`} style={styles.linkButtonSecondary}>
          Full details
        </Link>
      </div>

      {workflow ? <WarehouseWorkflowPanel workflow={workflow} /> : null}

      <section style={actionPanelStyle}>{renderPrimaryAction()}</section>

      <p style={{ ...styles.smallText, marginTop: 16 }}>
        <Link to="/admin">Admin dashboard</Link> has the same actions for bulk/table workflows.
      </p>
    </div>
  );
}
