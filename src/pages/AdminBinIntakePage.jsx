import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useScanPrompt } from "../hooks/useScanPrompt";
import { supabase, supabaseFunctionAuthHeaders } from "../supabaseClient";
import { buildDisplayBinRef, resolveCustomerEmailForBin } from "../utils/binDisplayRef";
import { bayQrScanTitle, binQrScanTitle, pickBinQrScanTitle } from "../utils/scanPromptTitles";
import { bayScanMatchesCode, needsHomeBayPlacement } from "../utils/binIntake";
import { binScanMatchesBox, explainBayScanMismatch } from "../utils/scanMatch";
import { isStagingShippingSimulatorAllowed } from "../utils/shipmentPublicUrls";
import WarehouseWorkflowPanel from "../components/WarehouseWorkflowPanel";
import {
  canMatchShippingLabelForBin,
  getBinScanAdminDeskNote,
  getPrimaryWarehouseAction,
  isOutboundStaged,
  isStarterKitShipmentRow,
  kitBinsReadyForLabelMatch,
} from "../utils/warehouseBinWorkflow";
import { fetchShipmentKitBoxIds, runWarehouseLabelMatch } from "../utils/warehouseLabelMatch";
import {
  canPickForSendToCustomer,
  getWarehouseWorkflow,
  shouldShowReturnIntakeActions,
  canSimulateReturnInTransitFromLabel,
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
  const [allAssignments, setAllAssignments] = useState([]);
  const [kitBoxIds, setKitBoxIds] = useState([]);
  const [busy, setBusy] = useState(false);

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
      setAllAssignments(storageState?.assignments || []);
    }

    if (isStarterKitShipmentRow(resolvedBox, asn) && resolvedBox.latest_shipment_id) {
      try {
        const ids = await fetchShipmentKitBoxIds(resolvedBox.latest_shipment_id);
        setKitBoxIds(ids.length ? ids : [canonicalId]);
      } catch {
        setKitBoxIds([canonicalId]);
      }
    } else {
      setKitBoxIds([]);
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
    () => ({
      isStarterKitShipmentRow: (row, asn) => isStarterKitShipmentRow(row, asn ?? assignment),
    }),
    [assignment],
  );

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
      title: binQrScanTitle(displayRef),
      scanMode: "qr_url",
    });
    if (!binScan || !String(binScan).trim()) return;
    if (!binScanMatchesBox(binScan, box.id, assignment?.bin_qr_code)) {
      alert("That scan does not match this bin. Use the sticker on the bin you are placing.");
      return;
    }

    const bayScan = await scanPrompt({
      title: bayQrScanTitle(bayCode),
      scanMode: "qr_url",
      delayScanStartMs: 2000,
      decodeCooldownMs: 1000,
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
      title: pickBinQrScanTitle(displayRef),
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
      alert(`Bin ${binLabel} picked and staged. Purchase and print the carrier label from the Admin dashboard.`);
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

  const assignmentsByBoxId = useMemo(() => {
    const map = {};
    for (const row of allAssignments) {
      map[String(row.box_id)] = row;
    }
    if (assignment && box?.id) {
      map[String(box.id)] = assignment;
    }
    return map;
  }, [allAssignments, assignment, box?.id]);

  const handleMatchLabel = async () => {
    if (!box || busy) return;
    setBusy(true);
    try {
      const ids = kitBoxIds.length ? kitBoxIds : [String(box.id)];
      const displayMetaByBoxId = {
        [String(box.id)]: {
          displayRef,
          email: profileEmail,
          boxNumber: box.box_number,
        },
      };

      const otherIds = ids.filter((id) => String(id) !== String(box.id));
      if (otherIds.length) {
        const { data: kitRows } = await supabase
          .from("admin_ops_bins")
          .select("id, box_number, user_id")
          .in("id", otherIds);

        const userIds = [...new Set((kitRows || []).map((r) => r.user_id).filter(Boolean))];
        let emailsByUserId = {};
        if (userIds.length) {
          const { data: profiles } = await supabase.from("profiles").select("id, email").in("id", userIds);
          emailsByUserId = Object.fromEntries((profiles || []).map((p) => [p.id, p.email]));
        }

        for (const row of kitRows || []) {
          const rid = String(row.id);
          displayMetaByBoxId[rid] = {
            displayRef: buildDisplayBinRef({
              email: emailsByUserId[row.user_id] || "",
              boxNumber: row.box_number,
              boxId: rid,
            }),
            email: emailsByUserId[row.user_id],
            boxNumber: row.box_number,
          };
        }
      }

      const result = await runWarehouseLabelMatch({
        box,
        assignment,
        scanPrompt,
        invokeEdge,
        kitBoxIds: ids,
        assignmentsByBoxId,
        displayMetaByBoxId,
      });
      await loadIntake();
      await refreshAfterAction();
      const kitMsg =
        result.kitBinCount > 1 ? ` All ${result.kitBinCount} bin QRs matched on this label.` : "";
      alert(
        result.matchedTracking
          ? `Match confirmed. Label tracking ${result.matchedTracking} is on the correct bin.${kitMsg}`
          : `Bin QR and shipping label barcode matched and saved.${kitMsg}`,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not complete label matching.");
    } finally {
      setBusy(false);
    }
  };

  const handleApplyBinQr = async () => {
    if (!box || busy) return;
    const binQrCode = await scanPrompt({
      title: binQrScanTitle(displayRef),
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
  const isStarterKit = isStarterKitShipmentRow(box, assignment);
  const kitReadyForMatch = kitBinsReadyForLabelMatch(kitBoxIds, assignmentsByBoxId);
  const kitAwaitingApply =
    isStarterKit &&
    kitBoxIds.length > 1 &&
    canMatchShippingLabelForBin(box, assignment) &&
    !kitReadyForMatch;
  const adminDeskNote = getBinScanAdminDeskNote(box, assignment);
  const primaryAction = getPrimaryWarehouseAction(box, assignment, {
    isStarterKitShipmentRow,
    showReturnPlacement,
    surface: "bin_scan",
    kitBoxIds,
    assignmentsByBoxId,
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

    if (primaryAction === "match_label") {
      const kitCount = kitBoxIds.length > 1 ? kitBoxIds.length : 0;
      return (
        <>
          <p style={{ ...styles.smallText, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {kitCount ? "Match kit label" : "Step 3 — Match"}
          </p>
          <h3 style={{ margin: "0 0 12px", fontSize: "22px", fontWeight: 700, color: "#2d3b2d" }}>
            Match shipping label
          </h3>
          <p style={{ ...styles.mutedText, marginBottom: 12 }}>
            {kitCount
              ? `Scan all ${kitCount} bin QRs on this shipment, then scan the tracking QR or barcode on the printed label.`
              : "Scan this bin's QR, then scan the tracking QR or barcode on the printed label."}
          </p>
          {box.latest_tracking_number ? (
            <p style={styles.smallText}>
              Tracking: <strong>{box.latest_tracking_number}</strong>
            </p>
          ) : null}
          <button type="button" style={styles.primaryButton} disabled={busy} onClick={() => void handleMatchLabel()}>
            {busy ? "Saving…" : kitCount ? `Match ${kitCount}-Bin Label` : "Match Shipping Label"}
          </button>
        </>
      );
    }

    if (kitAwaitingApply) {
      const pendingIds = kitBoxIds.filter((bid) => {
        const a = assignmentsByBoxId[String(bid)];
        return !a || !["qr_applied", "outbound_labeled"].includes(String(a.status || ""));
      });
      return (
        <>
          <h3 style={{ margin: "0 0 12px", fontSize: "22px", fontWeight: 700, color: "#2d3b2d" }}>
            Apply QR on all kit bins
          </h3>
          <p style={styles.mutedText}>
            Before matching the shipping label, apply and scan the bin QR sticker on every bin in this{" "}
            {kitBoxIds.length}-bin kit ({pendingIds.length} still pending).
          </p>
          <p style={styles.smallText}>Open each bin from the Admin dashboard or scan its bin QR URL.</p>
        </>
      );
    }

    if (adminDeskNote === "print_qr_sticker" && primaryAction !== "apply_qr") {
      return (
        <>
          <p style={{ ...styles.smallText, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Admin desk
          </p>
          <h3 style={{ margin: "0 0 12px", fontSize: "22px", fontWeight: 700, color: "#2d3b2d" }}>
            Print QR sticker needed
          </h3>
          <p style={{ ...styles.mutedText, marginBottom: 16 }}>
            Print the 3×6 bin QR sticker from the Admin dashboard (computer + printer), then return here to apply it.
          </p>
          <Link to="/admin" style={{ ...styles.primaryButton, display: "inline-block" }}>
            Open Admin dashboard
          </Link>
        </>
      );
    }

    if (adminDeskNote === "purchase_label") {
      return (
        <>
          <p style={{ ...styles.smallText, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Admin desk
          </p>
          <h3 style={{ margin: "0 0 12px", fontSize: "22px", fontWeight: 700, color: "#2d3b2d" }}>
            Shipping label needed
          </h3>
          <p style={{ ...styles.mutedText, marginBottom: 16 }}>
            Purchase and print the FedEx label from the Admin dashboard, then return here to match the label barcode.
          </p>
          <Link to="/admin" style={{ ...styles.primaryButton, display: "inline-block" }}>
            Open Admin dashboard
          </Link>
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

    if (canSimulateReturnInTransitFromLabel(box) && isStagingShippingSimulatorAllowed()) {
      return (
        <>
          <h3 style={{ margin: "0 0 8px", fontSize: "18px", color: "#2d3b2d" }}>Return label with customer</h3>
          <p style={styles.mutedText}>
            Customer has the FedEx label. Simulate carrier pickup to test inbound tracking and warehouse intake.
          </p>
          <button
            type="button"
            style={styles.secondaryButton}
            disabled={busy}
            onClick={() => void handleSimulateCarrier("set_in_transit")}
          >
            Simulate in transit
          </button>
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
        Print QR stickers and purchase shipping labels on the{" "}
        <Link to="/admin">Admin dashboard</Link> (computer + printer). This page is for camera scans only.
      </p>
    </div>
  );
}
