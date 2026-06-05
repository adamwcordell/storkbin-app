import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import StarterKitLabelModal from "../components/StarterKitLabelModal";
import WarehouseWorkflowPanel from "../components/WarehouseWorkflowPanel";
import { useScanPrompt } from "../hooks/useScanPrompt";
import { supabase, supabaseFunctionAuthHeaders } from "../supabaseClient";
import { buildDisplayBinRef, resolveCustomerEmailForBin } from "../utils/binDisplayRef";
import { needsHomeBayPlacement } from "../utils/binIntake";
import { formatHomeBayLine } from "../utils/homeBayDisplay";
import { getWarehouseWorkflow } from "../utils/warehouseWorkflow";
import { getEdgeFunctionErrorMessage } from "../utils/edgeFunctionErrors";
import { getCustomerBinScanUrl } from "../utils/binScanUrl";
import { bayScanMatchesCode, binScanMatchesBox, parseBoxIdFromBinScan } from "../utils/scanMatch";
import styles from "../styles/styles";

const QUEUES = [
  { key: "all", label: "All" },
  { key: "starter_kits", label: "Starter kits" },
  { key: "ship_to_customer", label: "Send to customer" },
  { key: "return_to_storage", label: "Return to storage" },
  { key: "bins_received", label: "Bins received" },
  { key: "auction", label: "Auction" },
  { key: "exceptions", label: "Exceptions" },
];

const QUEUE_HELP = {
  all: "All paid bins. Use the other tabs to focus one customer flow at a time.",
  starter_kits:
    "New paid starter outbound: assign bay → apply bin QR on each bin → choose FedEx rate and confirm stacked empty-bin dimensions → purchase one label per kit. Then match label QR to every bin in the kit.",
  ship_to_customer:
    "“Send me my bin” outbound from the warehouse: assign bay if needed → store in bay → pick + stage → manually create FedEx label (beta) → match label → then carrier/tracking. No button often means we’re waiting on the carrier or the bin is already with the customer.",
  return_to_storage:
    "Customer return to storage: after they pay, the return label is usually automatic. This tab tracks return shipments until the bin is back in storage. Often there is no warehouse button while you wait on dropoff or tracking.",
  bins_received:
    "Bins back at the warehouse: scan the bin QR → see home bay → confirm placed. Use Receive bin (scan) or open a row after return delivery.",
  auction: "Auction lifecycle — review and mark removed when appropriate.",
  exceptions: "Payment failures or bin vs shipment state mismatch — fix payment or use Repair State.",
};

function isStarterKitShipmentRow(row) {
  return (
    row?.checkout_status === "paid" &&
    row?.fulfillment_status === "paid_waiting_to_ship_bin" &&
    row?.latest_shipment_direction === "to_customer" &&
    Boolean(row?.latest_shipment_id)
  );
}

function getStarterKitBinCount(row, kitBoxIds) {
  const planCount = Number(row?.plan_bin_count);
  const resolved = Array.isArray(kitBoxIds) ? kitBoxIds.length : 0;
  if (Number.isFinite(planCount) && planCount > 0) {
    return Math.max(planCount, resolved, 1);
  }
  return Math.max(resolved, 1);
}

function getStarterKitDescription(row, kitBoxIds) {
  const n = getStarterKitBinCount(row, kitBoxIds);
  if (n <= 1) return "Single-bin starter kit (one label).";
  return `${n}-bin starter kit (one label).`;
}

function AdminDashboardPage({ appData }) {
  const navigate = useNavigate();
  const { scanPrompt, scanModal } = useScanPrompt();

  const invokeEdge = async (name, body, options = {}) => {
    const auth = await supabaseFunctionAuthHeaders();
    return supabase.functions.invoke(name, {
      ...options,
      body,
      headers: { ...auth, ...(options.headers || {}) },
    });
  };

  const alertEdgeFailure = async (result, fallbackMessage) => {
    if (!result?.error && !result?.data?.error) return false;
    const message =
      (await getEdgeFunctionErrorMessage(result.error, result.data)) ||
      result.data?.error ||
      fallbackMessage;
    alert(message || fallbackMessage);
    return true;
  };

  const [adminRows, setAdminRows] = useState([]);
  const [storageAssignments, setStorageAssignments] = useState([]);
  const [storageBays, setStorageBays] = useState([]);
  const [storageStateLoaded, setStorageStateLoaded] = useState(false);
  const [loadingAdminRows, setLoadingAdminRows] = useState(false);
  const [adminRowsError, setAdminRowsError] = useState("");
  const [activeQueue, setActiveQueue] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [userProfileById, setUserProfileById] = useState({});
  /** shipment_id -> box_id[] for paid starter outbound rows (multi-bin kits share one label). */
  const [kitShipmentBoxIdsByShipmentId, setKitShipmentBoxIdsByShipmentId] = useState({});
  /** subscription_group_id -> box_id[] when view splits one kit across multiple shipment rows. */
  const [starterKitBoxIdsByGroupId, setStarterKitBoxIdsByGroupId] = useState({});
  const [overageEvents, setOverageEvents] = useState([]);
  const [overageOpenCount, setOverageOpenCount] = useState(0);
  const [overageForm, setOverageForm] = useState({
    shipmentId: "",
    billedDollars: "",
    notes: "",
  });
  const [overageSubmitBusy, setOverageSubmitBusy] = useState(false);
  const [fedexCsvText, setFedexCsvText] = useState("");
  const [starterLabelModal, setStarterLabelModal] = useState(null);
  const [fedexImportBusy, setFedexImportBusy] = useState(false);
  const [fedexImportResult, setFedexImportResult] = useState(null);

  const sweepFinalShipments = async () => {
    try {
      const { error } = await invokeEdge("sweep-final-shipments", {});

      if (error) {
        console.warn("Final shipment sweep failed:", error.message || error);
      }
    } catch (error) {
      console.warn("Final shipment sweep failed:", error?.message || error);
    }
  };

  const sweepAuctionEscalations = async () => {
    try {
      const { error } = await invokeEdge("sweep-auction-escalations", {});

      if (error) {
        console.warn("Auction escalation sweep failed:", error.message || error);
      }
    } catch (error) {
      console.warn("Auction escalation sweep failed:", error?.message || error);
    }
  };

  const [subscriptionReconcileBusy, setSubscriptionReconcileBusy] = useState(false);

  const formatMoneyCents = (cents) => {
    if (cents == null || cents === "" || Number.isNaN(Number(cents))) return "—";
    const n = Number(cents);
    return `$${(n / 100).toFixed(2)}`;
  };

  const submitOverageRecord = async () => {
    const shipmentId = String(overageForm.shipmentId || "").trim();
    const billed = Number.parseFloat(String(overageForm.billedDollars || "").trim());
    if (!shipmentId) {
      window.alert("Shipment id is required.");
      return;
    }
    if (!Number.isFinite(billed) || billed < 0) {
      window.alert("Carrier billed amount (USD) must be a valid non-negative number.");
      return;
    }
    setOverageSubmitBusy(true);
    try {
      const { data, error } = await invokeEdge("shipping-overage-admin", {
        action: "create",
        shipmentId,
        carrierBilledAmountCents: Math.round(billed * 100),
        notes: String(overageForm.notes || "").trim() || undefined,
      });
      if (error || data?.error) {
        window.alert(data?.error || error?.message || "Could not record adjustment.");
        return;
      }
      if (data?.notify?.skipped) {
        window.alert(
          `Event saved. Email alert was not sent (${data.notify.skipped}). Configure RESEND_API_KEY / RESEND_FROM_EMAIL / ADMIN_EMAILS.`,
        );
      } else {
        window.alert("Carrier adjustment recorded and ops alert sent (if email is configured).");
      }
      setOverageForm({ shipmentId: "", billedDollars: "", notes: "" });
      await loadAdminRows();
    } catch (e) {
      window.alert(e?.message || "Request failed.");
    } finally {
      setOverageSubmitBusy(false);
    }
  };

  const updateOverageStatus = async (id, detectionStatus) => {
    const { data, error } = await invokeEdge("shipping-overage-admin", {
      action: "update_status",
      id,
      detectionStatus,
    });
    if (error || data?.error) {
      window.alert(data?.error || error?.message || "Update failed.");
      return;
    }
    await loadAdminRows();
  };

  const runFedexInvoiceCsvImport = async () => {
    const text = String(fedexCsvText || "").trim();
    if (!text) {
      window.alert("Paste or upload a FedEx billing CSV first.");
      return;
    }
    setFedexImportBusy(true);
    setFedexImportResult(null);
    try {
      const { data, error } = await invokeEdge("import-fedex-invoice-csv", { csvText: text });
      if (error || data?.error) {
        window.alert(data?.error || error?.message || "Import failed.");
        setFedexImportResult(data || { error: error?.message });
        return;
      }
      setFedexImportResult(data);
      await loadAdminRows();
    } catch (e) {
      window.alert(e?.message || "Import failed.");
    } finally {
      setFedexImportBusy(false);
    }
  };

  const runSubscriptionReconciliation = async (dryRun = false) => {
    if (subscriptionReconcileBusy) return;
    setSubscriptionReconcileBusy(true);
    try {
      const { data, error } = await invokeEdge("sweep-subscription-reconciliation", {
        limit: 200,
        dryRun,
      });
      if (error) {
        window.alert(`Subscription reconciliation failed: ${error.message || error}`);
        return;
      }
      const s = data?.summary;
      if (s) {
        const prefix = dryRun ? "PREVIEW ONLY — no rows were updated.\n\n" : "";
        window.alert(
          prefix +
            `Stripe subscription reconciliation ${dryRun ? "preview" : "complete"}.\n\n` +
            `Scanned: ${s.scannedSubscriptions} subscriptions (${s.totalCandidates} total in queue).\n` +
            `Scheduled cancel synced: ${s.scheduledCancelSynced}\n` +
            `Termination synced: ${s.terminationSynced}\n` +
            `Marked failed (past_due): ${s.paymentFailedFromPastDue}\n` +
            `Healed payment (paid invoice): ${s.paymentHealed}\n` +
            `No changes: ${s.noChanges}\n` +
            `Stripe ID not found (skipped): ${s.skippedStripeNotFound ?? 0}\n` +
            `Errors: ${s.errors}`,
        );
      } else {
        window.alert("Subscription reconciliation finished (no summary in response).");
      }
    } catch (err) {
      window.alert(err?.message || "Subscription reconciliation failed.");
    } finally {
      setSubscriptionReconcileBusy(false);
    }
  };

  const loadAdminRows = async () => {
    if (!appData.isAdmin) return;

    setLoadingAdminRows(true);
    setAdminRowsError("");
    setStorageStateLoaded(false);

    await sweepFinalShipments();
    await sweepAuctionEscalations();

    const { data, error } = await supabase
      .from("admin_ops_bins")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setAdminRowsError(error.message);
      setAdminRows([]);
      setKitShipmentBoxIdsByShipmentId({});
      setStarterKitBoxIdsByGroupId({});
      setUserProfileById({});
    } else {
      let mergedAdminTable = data || [];

      try {
        const adminKeys = new Set(
          mergedAdminTable.map((r) => String(r.box_id ?? r.id ?? "").trim()).filter(Boolean)
        );

        const { data: waitingBins, error: waitingErr } = await supabase
          .from("boxes")
          .select("*")
          .eq("checkout_status", "paid")
          .eq("fulfillment_status", "paid_waiting_to_ship_bin")
          .order("created_at", { ascending: false })
          .limit(100);

        if (!waitingErr && waitingBins?.length) {
          const missingBins = waitingBins.filter((b) => !adminKeys.has(String(b.id)));
          if (missingBins.length) {
            const missingIds = missingBins.map((b) => String(b.id));
            const { data: sboxes } = await supabase
              .from("shipment_boxes")
              .select("box_id, shipment_id")
              .in("box_id", missingIds);

            const shipmentIds = [
              ...new Set((sboxes || []).map((s) => String(s.shipment_id)).filter(Boolean)),
            ];
            const shipById = new Map();
            if (shipmentIds.length) {
              const { data: ships } = await supabase.from("shipments").select("*").in("id", shipmentIds);
              (ships || []).forEach((s) => shipById.set(String(s.id), s));
            }

            const firstShipmentByBox = new Map();
            (sboxes || []).forEach((sb) => {
              const bid = String(sb.box_id);
              if (!firstShipmentByBox.has(bid)) {
                firstShipmentByBox.set(bid, shipById.get(String(sb.shipment_id)) || null);
              }
            });

            const syntheticRows = missingBins.map((box) => {
              const shipment = firstShipmentByBox.get(String(box.id));
              return {
                ...box,
                box_id: box.id,
                box_number: box.box_number || box.id,
                latest_shipment_id: shipment?.id || null,
                latest_shipment_direction: shipment?.shipment_direction || null,
                latest_shipping_status: shipment?.shipping_status || null,
                latest_charge_status: shipment?.charge_status || null,
                latest_label_status: shipment?.label_status || null,
                latest_tracking_number: shipment?.tracking_number || null,
                latest_tracking_url: shipment?.tracking_url || null,
                latest_label_url: shipment?.label_url || null,
                latest_shipping_cost: shipment?.shipping_cost || shipment?.shipping_estimate || null,
              };
            });

            mergedAdminTable = [...syntheticRows, ...mergedAdminTable];
          }
        }
      } catch (supplementErr) {
        console.warn("Admin starter-bin supplement skipped:", supplementErr);
      }

      const userIds = [
        ...new Set(
          mergedAdminTable
            .map((r) => String(r.user_id || "").trim())
            .filter(Boolean)
        ),
      ];

      let profileMap = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id,full_name,email")
          .in("id", userIds);

        (profiles || []).forEach((profile) => {
          profileMap[String(profile.id)] = {
            fullName: String(profile.full_name || "").trim(),
            email: String(profile.email || "").trim(),
          };
        });
      }
      setUserProfileById(profileMap);

      mergedAdminTable = mergedAdminTable.map((row) => {
        const email = resolveCustomerEmailForBin({ row, profileById: profileMap });
        return email ? { ...row, customer_email: email } : row;
      });

      setAdminRows(mergedAdminTable);

      const rowBoxId = (r) => String(r.box_id ?? r.id ?? "").trim();

      const groupMap = {};
      for (const row of mergedAdminTable) {
        if (row.checkout_status !== "paid" || row.fulfillment_status !== "paid_waiting_to_ship_bin") {
          continue;
        }
        const gid = String(row.subscription_group_id || "").trim();
        const bid = rowBoxId(row);
        if (!gid || !bid) continue;
        if (!groupMap[gid]) groupMap[gid] = [];
        groupMap[gid].push(bid);
      }
      for (const gid of Object.keys(groupMap)) {
        groupMap[gid] = [...new Set(groupMap[gid])];
      }
      setStarterKitBoxIdsByGroupId(groupMap);

      const starterOutboundBoxIds = [
        ...new Set(
          mergedAdminTable
            .filter((r) => {
              if (r.checkout_status !== "paid") return false;
              if (r.fulfillment_status === "paid_waiting_to_ship_bin") return true;
              return (
                r.latest_shipment_direction === "to_customer" &&
                Boolean(r.latest_shipment_id)
              );
            })
            .map(rowBoxId)
            .filter(Boolean)
        ),
      ];

      /** Must use mergedAdminTable (includes synthetic starter rows). Using raw `data` alone omits those shipment_ids so kitShipmentBoxIdsByShipmentId stays empty → no "Create Carrier Label" after QR. */
      const groupedOutboundShipmentIds = [
        ...new Set(
          mergedAdminTable
            .filter((r) => {
              if (r.checkout_status !== "paid" || r.latest_shipment_direction !== "to_customer" || !r.latest_shipment_id) {
                return false;
              }
              const ship = String(r.latest_shipping_status || "");
              if (["paid", "label_created", "in_transit"].includes(ship)) return true;
              if (
                r.fulfillment_status === "paid_waiting_to_ship_bin" &&
                String(r.latest_charge_status || "") === "paid" &&
                !["in_transit", "delivered", "cancelled", "exception"].includes(ship)
              ) {
                return true;
              }
              return false;
            })
            .map((r) => String(r.latest_shipment_id))
        ),
      ];

      const shipmentMap = {};
      const addShipmentBoxLink = (shipmentId, boxId) => {
        const sid = String(shipmentId || "").trim();
        const bid = String(boxId || "").trim();
        if (!sid || !bid) return;
        if (!shipmentMap[sid]) shipmentMap[sid] = [];
        shipmentMap[sid].push(bid);
      };

      if (starterOutboundBoxIds.length > 0) {
        const { data: sboxesByBox, error: sbBoxErr } = await supabase
          .from("shipment_boxes")
          .select("shipment_id, box_id")
          .in("box_id", starterOutboundBoxIds);

        if (!sbBoxErr && sboxesByBox?.length) {
          for (const sb of sboxesByBox) {
            addShipmentBoxLink(sb.shipment_id, sb.box_id);
          }
        }
      }

      if (groupedOutboundShipmentIds.length > 0) {
        const { data: sboxes, error: sbErr } = await supabase
          .from("shipment_boxes")
          .select("shipment_id, box_id")
          .in("shipment_id", groupedOutboundShipmentIds);

        if (!sbErr && sboxes?.length) {
          for (const sb of sboxes) {
            addShipmentBoxLink(sb.shipment_id, sb.box_id);
          }
        }
      }

      for (const sid of Object.keys(shipmentMap)) {
        shipmentMap[sid] = [...new Set(shipmentMap[sid])];
      }
      setKitShipmentBoxIdsByShipmentId(shipmentMap);
    }

    const { data: storageState, error: storageError } = await invokeEdge("admin-storage-ops", {
      action: "list_state",
    });

    if (!storageError && storageState) {
      setStorageAssignments(storageState.assignments || []);
      setStorageBays(storageState.bays || []);
      setStorageStateLoaded(true);
    } else {
      setStorageAssignments([]);
      setStorageBays([]);
      setStorageStateLoaded(true);
    }

    try {
      const { data: ov, error: ovErr } = await invokeEdge("shipping-overage-admin", { action: "list" });
      if (!ovErr && ov?.events) {
        setOverageEvents(ov.events);
        setOverageOpenCount(Number(ov.openCount) || 0);
      } else {
        setOverageEvents([]);
        setOverageOpenCount(0);
      }
    } catch {
      setOverageEvents([]);
      setOverageOpenCount(0);
    }

    setLoadingAdminRows(false);
  };

  useEffect(() => {
    loadAdminRows();
  }, [appData.isAdmin, appData.boxes.length, appData.shipments.length]);

  const fallbackRows = appData.boxes.map((box) => {
    const shipment = appData.getShipmentForBox(box.id);

    return {
      ...box,
      box_id: box.id,
      box_number: box.box_number || box.id,
      customer_email: box.customer_email || box.user_email || box.user_id,
      latest_shipment_id: shipment?.id || null,
      latest_shipment_direction: shipment?.shipment_direction || null,
      latest_shipping_status: shipment?.shipping_status || null,
      latest_charge_status: shipment?.charge_status || null,
      latest_label_status: shipment?.label_status || null,
      latest_tracking_number: shipment?.tracking_number || null,
      latest_tracking_url: shipment?.tracking_url || null,
      latest_label_url: shipment?.label_url || null,
      latest_shipping_cost: shipment?.shipping_cost || shipment?.shipping_estimate || null,
    };
  });

  const isLabelNeededShipmentRow = (row) =>
    row.latest_shipment_id &&
    row.latest_charge_status === "paid" &&
    row.latest_shipping_status === "paid" &&
    (row.latest_label_status === "needed" ||
      row.latest_label_status === "label_needed" ||
      row.latest_label_status === "purchase_failed" ||
      !row.latest_label_status);

  // Prefer real box PK (`id` on admin_ops_bins / boxes). `internal_id` is a different identifier and must not win.
  const getCanonicalBoxId = (row) => String(row.box_id ?? row.id ?? row.internal_id ?? "");

  const rawRows = useMemo(() => {
    if (adminRows.length === 0) return fallbackRows;

    const fallbackByBoxId = new Map(
      fallbackRows.map((row) => [getCanonicalBoxId(row), row])
    );

    const mergedAdminRows = adminRows.map((adminRow) => {
      const rowKey = getCanonicalBoxId(adminRow);
      const fallbackRow = fallbackByBoxId.get(rowKey);

      const starterViewStale =
        fallbackRow &&
        fallbackRow.checkout_status === "paid" &&
        fallbackRow.fulfillment_status === "paid_waiting_to_ship_bin" &&
        fallbackRow.latest_shipment_id &&
        adminRow.checkout_status === "paid" &&
        adminRow.fulfillment_status === "paid_waiting_to_ship_bin" &&
        !adminRow.latest_shipment_id;

      if (!fallbackRow || (!isLabelNeededShipmentRow(fallbackRow) && !starterViewStale)) {
        return adminRow;
      }

      // Keep the authoritative admin row, but overlay the live shipment fields from appData
      // when the fallback row is a paid shipment that still needs a label. This prevents
      // final-return shipments for terminated subscriptions from flashing and disappearing
      // when the admin_ops_bins view is stale or omits the latest shipment fields.
      return {
        ...adminRow,
        latest_shipment_id: fallbackRow.latest_shipment_id || adminRow.latest_shipment_id,
        latest_shipment_direction: fallbackRow.latest_shipment_direction || adminRow.latest_shipment_direction,
        latest_shipping_status: fallbackRow.latest_shipping_status || adminRow.latest_shipping_status,
        latest_charge_status: fallbackRow.latest_charge_status || adminRow.latest_charge_status,
        latest_label_status: fallbackRow.latest_label_status || adminRow.latest_label_status,
        latest_tracking_number: fallbackRow.latest_tracking_number || adminRow.latest_tracking_number,
        latest_tracking_url: fallbackRow.latest_tracking_url || adminRow.latest_tracking_url,
        latest_label_url: fallbackRow.latest_label_url || adminRow.latest_label_url,
        latest_shipping_cost: fallbackRow.latest_shipping_cost || adminRow.latest_shipping_cost,
        fulfillment_status: fallbackRow.fulfillment_status || adminRow.fulfillment_status,
      };
    });

    const existingAdminRowKeys = new Set(
      mergedAdminRows.map((row) => getCanonicalBoxId(row))
    );

    const missingLabelRows = fallbackRows.filter((row) => {
      const rowKey = getCanonicalBoxId(row);
      return isLabelNeededShipmentRow(row) && !existingAdminRowKeys.has(rowKey);
    });

    return [...mergedAdminRows, ...missingLabelRows];
  }, [adminRows, fallbackRows]);

  const operationalRows = useMemo(
    () => rawRows.filter((row) => row.checkout_status === "paid"),
    [rawRows]
  );

  const getResolvedKitBoxIds = (row) => {
    const selfId = getCanonicalBoxId(row);
    let ids = [];

    const sid = row?.latest_shipment_id ? String(row.latest_shipment_id) : "";
    if (sid) {
      const fromShip = kitShipmentBoxIdsByShipmentId[sid];
      if (Array.isArray(fromShip) && fromShip.length > 0) {
        ids = [...fromShip.map((id) => String(id))];
      }
    }

    const gid = String(row.subscription_group_id || "").trim();
    const fromGroup = gid ? starterKitBoxIdsByGroupId[gid] : null;
    if (Array.isArray(fromGroup) && fromGroup.length > ids.length) {
      ids = [...fromGroup.map((id) => String(id))];
    }

    if (ids.length === 0) return [selfId];
    return [...new Set(ids.filter(Boolean))];
  };

  const getStrictStarterKitBoxIds = (row) => {
    if (!isStarterKitShipmentRow(row)) return [];
    // Same resolution as kit grouping — strict-only shipment_boxes lookup left kitIds empty
    // when admin_ops_bins omits links, which hid "Create Carrier Label" after QR on every bin.
    return getResolvedKitBoxIds(row);
  };

  const resolveStarterKitShipmentId = (row) => {
    const kitIds = new Set(getResolvedKitBoxIds(row));
    if (kitIds.size === 0) return String(row.latest_shipment_id || "");

    let bestSid = "";
    let bestOverlap = 0;
    for (const [sid, boxIds] of Object.entries(kitShipmentBoxIdsByShipmentId)) {
      const overlap = (boxIds || []).filter((id) => kitIds.has(String(id))).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSid = sid;
      }
    }
    return bestSid || String(row.latest_shipment_id || "");
  };

  const formatKitBinLabels = (row) => {
    const ids = getResolvedKitBoxIds(row);
    if (!ids.length) return "Refresh to load kit bins from shipment";
    return ids
      .map((bid) => {
        const r = operationalRows.find((x) => getCanonicalBoxId(x) === bid);
        return r?.box_number || r?.customer_bin_name || bid;
      })
      .join(", ");
  };

  const kitReadyForLabelMatch = (row) => {
    if (!isStarterKitShipmentRow(row)) return true;
    if (row.latest_shipping_status !== "label_created") return false;
    const ids = getStrictStarterKitBoxIds(row);
    if (!ids.length) return false;
    return ids.every((bid) => {
      const a = storageAssignments.find((x) => String(x.box_id) === bid);
      return a && (a.status === "qr_applied" || a.status === "outbound_labeled");
    });
  };

  const getStarterKitGroupShipmentId = (row) => {
    if (!isStarterKitShipmentRow(row)) return "";
    if (
      !["paid", "label_created", "in_transit"].includes(
        String(row.latest_shipping_status || "")
      )
    ) {
      return "";
    }
    const ids = getResolvedKitBoxIds(row);
    if (!Array.isArray(ids) || ids.length <= 1) return "";
    const gid = String(row.subscription_group_id || "").trim();
    if (gid) return `kitgrp:${gid}`;
    const sid = String(row.latest_shipment_id || "");
    return sid;
  };

  /** Starter empty-bin outbound never uses physical warehouse intake (mark_placed / "Store in Bay"). */
  const suppressWarehouseIntakeForStarterOutbound = (row) =>
    isStarterKitShipmentRow(row) || Boolean(getStarterKitGroupShipmentId(row));

  // One admin row per bin so storage assignment + actions always match that bin (avoids grouped starter rows
  // sharing one action strip tied to only the first bin).
  const rows = useMemo(
    () =>
      operationalRows.map((row) => ({
        ...row,
        row_type: "box",
        grouped_boxes: [row],
        display_box_numbers: row.box_number || getCanonicalBoxId(row),
      })),
    [operationalRows]
  );

  const uniqueBoxRows = useMemo(() => {
    const byId = new Map();
    operationalRows.forEach((row) => {
      const key = getCanonicalBoxId(row);
      if (!byId.has(key)) byId.set(key, row);
    });
    return Array.from(byId.values());
  }, [operationalRows]);

  const getUserLabel = (row) => {
    const email = resolveCustomerEmailForBin({ row, profileById: userProfileById });
    if (email) return email;
    const profile = userProfileById[String(row.user_id || "")];
    if (profile?.fullName) return profile.fullName;
    if (row.user_id) return `User ${String(row.user_id).slice(0, 8)}`;
    return "Unknown";
  };

  const getUserFilterLabel = (userValue) => {
    if (!userValue) return "Unknown";
    if (String(userValue).includes("@")) return String(userValue);
    const profile = userProfileById[String(userValue)];
    if (profile?.fullName && profile?.email) return `${profile.fullName} (${profile.email})`;
    if (profile?.fullName) return profile.fullName;
    if (profile?.email) return profile.email;
    return `User ${String(userValue).slice(0, 8)}`;
  };

  const getDisplayBinRef = (row) =>
    buildDisplayBinRef({
      email: resolveCustomerEmailForBin({ row, profileById: userProfileById }),
      boxNumber: row.box_number,
      boxId: getCanonicalBoxId(row),
    });

  const users = useMemo(() => {
    const uniqueUsers = new Set(
      rows
        .map((row) => row.customer_email || row.user_id)
        .filter(Boolean)
    );

    return Array.from(uniqueUsers).sort();
  }, [rows]);

  const isFinalReturnToCustomerRow = (row) =>
    row.latest_shipment_direction === "to_customer" &&
    (row.cancel_status === "approved" ||
      row.cancel_status === "completed" ||
      row.subscription_status === "terminated" ||
      row.subscription_lifecycle_status === "terminated" ||
      row.lifecycle_status === "terminated");

  const getExpectedBoxStateForShipment = (row) => {
    if (!row.latest_shipment_id) return null;

    // Final return shipments are different from starter outbound shipments.
    // A canceled/terminated stored bin can be shipped back to the customer without
    // becoming an active at_customer/bin_with_customer subscription again.
    if (isFinalReturnToCustomerRow(row)) return null;

    if (row.latest_shipping_status === "label_created") {
      if (row.latest_shipment_direction === "to_storage") {
        return {
          status: "at_customer",
          fulfillment_status: "awaiting_customer_dropoff",
          label: "Return label ready — awaiting customer dropoff",
        };
      }
      return {
        status: null,
        fulfillment_status: "label_created",
        label: "Label created",
      };
    }

    if (row.latest_shipping_status === "in_transit") {
      if (row.latest_shipment_direction === "to_customer") {
        return {
          status: "in_transit_to_customer",
          fulfillment_status: "shipped_to_customer",
          label: "In transit to customer",
        };
      }

      if (row.latest_shipment_direction === "to_storage") {
        return {
          status: "in_transit_to_storage",
          fulfillment_status: "awaiting_storage_arrival",
          label: "In transit to storage",
        };
      }
    }

    if (row.latest_shipping_status === "delivered") {
      if (row.latest_shipment_direction === "to_customer") {
        return {
          status: "at_customer",
          fulfillment_status: "bin_with_customer",
          label: "Delivered to customer",
        };
      }

      if (row.latest_shipment_direction === "to_storage") {
        return {
          status: "stored",
          fulfillment_status: "stored",
          label: "Received into storage",
        };
      }
    }

    return null;
  };

  const getShipmentStateMismatch = (row) => {
    // Starter empty-bin outbound: shipment can move to label_created while the bin row is still
    // paid_waiting_to_ship_bin — that is not an exception. Multi-bin kits stay on one outbound label
    // after fulfillment becomes label_created; do not flag those as mismatches either.
    if (
      (isStarterKitShipmentRow(row) || Boolean(getStarterKitGroupShipmentId(row))) &&
      ["paid", "label_created"].includes(String(row.latest_shipping_status || ""))
    ) {
      return null;
    }

    const expected = getExpectedBoxStateForShipment(row);
    if (!expected) return null;

    const checkedRows = row.grouped_boxes?.length ? row.grouped_boxes : [row];
    const mismatchedBoxes = checkedRows.filter((boxRow) => {
      const statusMismatch = expected.status && boxRow.status !== expected.status;
      const fulfillmentMismatch =
        expected.fulfillment_status &&
        boxRow.fulfillment_status !== expected.fulfillment_status;

      return statusMismatch || fulfillmentMismatch;
    });

    if (mismatchedBoxes.length === 0) return null;

    return {
      expected,
      mismatchedBoxes,
    };
  };

  const getQueueKey = (row) => {
    const assignment = storageAssignments.find(
      (item) => String(item.box_id) === getCanonicalBoxId(row)
    );

    if (row.lifecycle_status === "auction") return "auction";

    if (
      row.latest_charge_status === "failed" ||
      row.fulfillment_status === "shipment_payment_failed" ||
      getShipmentStateMismatch(row)
    ) {
      return "exceptions";
    }

    const starterOutboundPaid =
      row.latest_shipment_direction === "to_customer" &&
      Boolean(row.latest_shipment_id) &&
      String(row.latest_charge_status || "") === "paid" &&
      ["paid", "label_created"].includes(String(row.latest_shipping_status || "")) &&
      (row.fulfillment_status === "paid_waiting_to_ship_bin" ||
        (row.fulfillment_status === "label_created" && Boolean(getStarterKitGroupShipmentId(row))));

    if (
      starterOutboundPaid &&
      (!assignment ||
        ["assigned", "qr_applied", "outbound_labeled", "picked", "in_staging", "label_verified"].includes(
          String(assignment.status || "")
        ))
    ) {
      return "starter_kits";
    }

    const needsFirstHomeBay =
      !assignment?.bay_code &&
      row.status === "stored" &&
      row.fulfillment_status !== "paid_waiting_to_ship_bin" &&
      !suppressWarehouseIntakeForStarterOutbound(row);

    const intakeStillNeeded =
      assignment?.bay_code &&
      needsHomeBayPlacement(assignment) &&
      row.fulfillment_status !== "paid_waiting_to_ship_bin" &&
      !suppressWarehouseIntakeForStarterOutbound(row) &&
      (row.status === "stored" ||
        row.latest_shipment_direction === "to_storage" ||
        row.fulfillment_status === "stored");

    if (row.checkout_status === "paid" && (needsFirstHomeBay || intakeStillNeeded)) {
      return "bins_received";
    }

    // ── Customer-initiated outbound ("Send me my bin") — not starter kits ──
    if (
      row.latest_shipment_id &&
      row.latest_shipment_direction === "to_customer" &&
      !isStarterKitShipmentRow(row)
    ) {
      if (
        assignment?.status === "placed" &&
        row.latest_charge_status === "paid" &&
        (row.latest_shipping_status === "paid" ||
          row.latest_label_status === "needed" ||
          row.latest_label_status === "purchase_failed" ||
          !row.latest_label_status)
      ) {
        return "ship_to_customer";
      }

      if (
        row.latest_shipping_status === "paid" ||
        row.latest_shipping_status === "label_created" ||
        row.latest_shipping_status === "in_transit" ||
        row.latest_shipping_status === "out_for_delivery"
      ) {
        return "ship_to_customer";
      }
    }

    // ── Return to storage (customer shipping bin back) ──
    if (
      row.latest_shipment_id &&
      row.latest_shipment_direction === "to_storage" &&
      (row.latest_shipping_status === "paid" ||
        row.latest_shipping_status === "label_created" ||
        row.latest_shipping_status === "in_transit" ||
        row.fulfillment_status === "awaiting_storage_arrival" ||
        row.status === "in_transit_to_storage")
    ) {
      return "return_to_storage";
    }

    return "all";
  };

  const queueCounts = useMemo(() => {
    const counts = Object.fromEntries(QUEUES.map((queue) => [queue.key, 0]));

    rows.forEach((row) => {
      counts.all += 1;
      const queueKey = getQueueKey(row);

      if (queueKey !== "all") {
        counts[queueKey] += 1;
      }
    });

    return counts;
  }, [rows, storageAssignments]);

  const filteredRows = rows.filter((row) => {
    const queueKey = getQueueKey(row);
    const searchableText = [
      row.display_box_numbers,
      row.box_number,
      row.id,
      row.box_id,
      row.customer_email,
      row.user_id,
      row.status,
      row.fulfillment_status,
      row.checkout_status,
      row.cancel_status,
      row.latest_shipping_status,
      row.latest_charge_status,
      row.latest_tracking_number,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesQueue = activeQueue === "all" || queueKey === activeQueue;
    const matchesSearch = searchableText.includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      row.status === statusFilter ||
      row.fulfillment_status === statusFilter ||
      row.latest_shipping_status === statusFilter ||
      row.latest_charge_status === statusFilter ||
      row.cancel_status === statusFilter;
    const matchesUser =
      userFilter === "all" ||
      row.customer_email === userFilter ||
      row.user_id === userFilter;

    return matchesQueue && matchesSearch && matchesStatus && matchesUser;
  });

  const filteredRowsSorted = useMemo(() => {
    const canonicalId = (r) => String(r.box_id ?? r.id ?? r.internal_id ?? "");

    return [...filteredRows].sort((a, b) => {
      const ga = getStarterKitGroupShipmentId(a);
      const gb = getStarterKitGroupShipmentId(b);
      if (ga && gb && ga !== gb) return ga.localeCompare(gb);
      if (ga && !gb) return -1;
      if (!ga && gb) return 1;
      const la = String(a.box_number || canonicalId(a));
      const lb = String(b.box_number || canonicalId(b));
      return la.localeCompare(lb, undefined, { numeric: true });
    });
  }, [filteredRows, kitShipmentBoxIdsByShipmentId, starterKitBoxIdsByGroupId]);

  const filteredBinsCount = useMemo(
    () =>
      filteredRowsSorted.reduce((total) => total + 1, 0),
    [filteredRowsSorted]
  );

  const paidRowsForSummary = uniqueBoxRows.filter(
    (row) => row.checkout_status === "paid"
  );

  const binsInStorageCount = paidRowsForSummary.filter(
    (row) => row.status === "stored"
  ).length;

  const binsInTransitCount = paidRowsForSummary.filter(
    (row) =>
      row.status === "in_transit_to_customer" ||
      row.status === "in_transit_to_storage" ||
      row.fulfillment_status === "shipped_to_customer" ||
      row.fulfillment_status === "awaiting_storage_arrival" ||
      row.latest_shipping_status === "in_transit"
  ).length;

  const binsWithCustomerCount = paidRowsForSummary.filter(
    (row) => row.status === "at_customer"
  ).length;

  const binsAtAuctionCount = paidRowsForSummary.filter(
    (row) => row.lifecycle_status === "auction"
  ).length;

  const dirtyShipmentStateCount = paidRowsForSummary.filter(
    (row) => getShipmentStateMismatch(row)
  ).length;

  const getShipmentFromRow = (row) => {
    const shipmentId = isStarterKitShipmentRow(row)
      ? resolveStarterKitShipmentId(row)
      : String(row.latest_shipment_id || "");
    if (!shipmentId) return null;

    const loadedShipment = appData.shipments.find((shipment) => shipment.id === shipmentId);

    return {
      id: shipmentId,
      box_id: getCanonicalBoxId(row),
      user_id: row.user_id,
      shipment_direction: row.latest_shipment_direction || loadedShipment?.shipment_direction,
      shipping_status: row.latest_shipping_status || loadedShipment?.shipping_status,
      charge_status: row.latest_charge_status || loadedShipment?.charge_status,
      label_status: row.latest_label_status || loadedShipment?.label_status,
      tracking_number: row.latest_tracking_number || loadedShipment?.tracking_number,
      tracking_url: row.latest_tracking_url || loadedShipment?.tracking_url,
      label_url: row.latest_label_url || loadedShipment?.label_url,
      shipping_cost:
        row.latest_shipping_cost ||
        loadedShipment?.shipping_cost ||
        loadedShipment?.shipping_estimate,
      shipping_estimate:
        row.latest_shipping_cost ||
        loadedShipment?.shipping_cost ||
        loadedShipment?.shipping_estimate,
    };
  };

  const getBoxFromRow = (row) => ({
    ...row,
    id: getCanonicalBoxId(row),
  });

  const reloadAfterAction = async () => {
    await loadAdminRows();
  };

  const handleGenerateLabel = async (row) => {
    const shipment = getShipmentFromRow(row);
    const box = getBoxFromRow(row);

    if (!shipment) {
      alert("No shipment exists for this row yet.");
      return;
    }

    if (isStarterKitShipmentRow(row)) {
      const kitIds = getStrictStarterKitBoxIds(row);
      setStarterLabelModal({
        shipmentId: shipment.id,
        pieceCount: Math.max(kitIds.length, getStarterKitBinCount(row, kitIds), 1),
        kitDescription: getStarterKitDescription(row, kitIds),
        row,
      });
      return;
    }

    await appData.generateLabel(shipment, box);
    reloadAfterAction();
  };

  const handleRepairShipmentState = async (row) => {
    const shipment = getShipmentFromRow(row);
    const mismatch = getShipmentStateMismatch(row);

    if (!shipment || !mismatch) {
      alert("No shipment state mismatch found for this row.");
      return;
    }

    const affectedBins = mismatch.mismatchedBoxes
      .map((boxRow) => boxRow.box_number || boxRow.box_id || boxRow.id)
      .join(", ");

    const confirmed = window.confirm(
      `Repair shipment state for ${affectedBins}? This will sync linked box states from shipment ${shipment.id}.`
    );

    if (!confirmed) return;

    const { error } = await supabase.rpc("admin_repair_shipment_box_states", {
      p_shipment_id: shipment.id,
    });

    if (error) {
      alert(error.message);
      return;
    }

    alert("Shipment state repaired from shipment source of truth.");
    reloadAfterAction();
  };

  const handleSimulateCarrierStep = async (row, action) => {
    if (!row.latest_shipment_id) {
      alert("No shipment exists for this row yet.");
      return;
    }

    const { data, error } = await invokeEdge("shipment-carrier-simulator", {
      action,
      shipmentId: String(row.latest_shipment_id),
    });

    if (error || data?.error) {
      alert(data?.error || error?.message || "Could not simulate carrier update.");
      return;
    }

    await loadAdminRows();
  };

  const handleMarkRemovedFromSystem = async (row) => {
    const boxId = getCanonicalBoxId(row);
    const label = row.box_number || boxId;

    const confirmed = window.confirm(
      `Mark bin ${label} as removed from the StorkBin system? This preserves history but hides it from the customer.`
    );

    if (!confirmed) return;

    const { error } = await supabase.rpc("admin_mark_box_removed_from_system", {
      p_box_id: boxId,
    });

    if (error) {
      alert(error.message);
      return;
    }

    alert("Bin marked removed from system.");
    reloadAfterAction();
  };

  const handleAssignBay = async (row) => {
    const availableBayCodes = (storageBays || [])
      .map((bay) => bay.bay_code)
      .filter((bayCode) => {
        const occupant = storageAssignments.find(
          (assignment) => assignment.bay_code === bayCode && assignment.is_current
        );
        return !occupant || String(occupant.box_id) === getCanonicalBoxId(row);
      });

    const promptDefault = availableBayCodes[0] || "A1";
    const bayCode = window.prompt(
      `Assign bay for bin ${row.box_number || getCanonicalBoxId(row)}.\nAvailable: ${availableBayCodes.join(", ") || "(none free)"}`,
      promptDefault
    );
    if (!bayCode) return;

    const { data, error } = await invokeEdge("admin-storage-ops", {
      action: "assign_bay",
      boxId: getCanonicalBoxId(row),
      bayCode: String(bayCode).toUpperCase(),
      actor: appData.user?.email || "admin",
    });
    if (error || data?.error) {
      alert(data?.error || error?.message || "Could not assign bay.");
      return;
    }

    await loadAdminRows();
  };

  const handleReceiveBinScan = async () => {
    const scanned = await scanPrompt({
      title: "Receive bin",
      message: "Scan the QR sticker on the bin that just arrived at the warehouse.",
      scanMode: "qr_url",
    });
    if (!scanned || !String(scanned).trim()) return;

    const token = parseBoxIdFromBinScan(scanned) || String(scanned).trim();
    const { data: byId } = await supabase.from("boxes").select("id").eq("id", token).maybeSingle();
    const { data: byInternal } = await supabase
      .from("admin_ops_bins")
      .select("id")
      .eq("internal_id", token)
      .maybeSingle();
    const boxId = byId?.id || byInternal?.id || token;
    navigate(`/admin/intake/${boxId}`);
  };

  const handleMarkPlaced = async (row) => {
    const boxId = getCanonicalBoxId(row);
    const assignment = storageAssignments.find((item) => String(item.box_id) === boxId);
    const bayCode = String(assignment?.bay_code || "").trim().toUpperCase();

    let binQrScan = "";
    let bayQrScan = "";

    if (bayCode) {
      const binScanned = await scanPrompt({
        title: `Scan bin — ${row.box_number || boxId}`,
        message: "Scan the bin QR sticker on the physical bin.",
        expectedHint: getCustomerBinScanUrl(boxId) || boxId,
        scanMode: "qr_url",
      });
      if (!binScanned || !String(binScanned).trim()) return;
      if (!binScanMatchesBox(binScanned, boxId, assignment?.bin_qr_code)) {
        alert("Bin QR scan does not match this bin.");
        return;
      }
      binQrScan = String(binScanned).trim();

      const bayScanned = await scanPrompt({
        title: `Scan bay ${bayCode}`,
        message: `Place the bin in home bay ${bayCode}, then scan the bay QR at that rack slot.`,
        expectedHint: bayCode,
        scanMode: "qr_url",
      });
      if (!bayScanned || !String(bayScanned).trim()) return;
      if (!bayScanMatchesCode(bayScanned, bayCode)) {
        alert(`Bay scan does not match home bay ${bayCode}.`);
        return;
      }
      bayQrScan = String(bayScanned).trim();
    }

    const note = window.prompt("Placement note (optional):", "") || "";
    const photoUrl = window.prompt("Placement photo URL (optional for now):", "") || "";

    const { data, error } = await invokeEdge("admin-storage-ops", {
      action: "mark_placed",
      boxId,
      note,
      photoUrl,
      intakeMode: Boolean(bayCode),
      binQrScan,
      bayQrScan,
    });
    if (error || data?.error) {
      alert(data?.error || error?.message || "Could not mark placed.");
      return;
    }
    await loadAdminRows();
  };

  const handleMarkPicked = async (row) => {
    const boxId = getCanonicalBoxId(row);
    const assignment = storageAssignments.find((item) => String(item.box_id) === boxId);

    const binScanned = await scanPrompt({
      title: `Pick — scan bin ${row.box_number || boxId}`,
      message: "Scan the bin QR on the physical bin you are pulling from the rack.",
      expectedHint: getCustomerBinScanUrl(boxId) || boxId,
      scanMode: "qr_url",
    });
    if (!binScanned || !String(binScanned).trim()) return;
    if (!binScanMatchesBox(binScanned, boxId, assignment?.bin_qr_code)) {
      alert("Bin QR scan does not match this bin.");
      return;
    }

    const pickedResult = await invokeEdge("admin-storage-ops", {
      action: "mark_picked",
      boxId,
      binQrCode: String(binScanned).trim(),
    });
    if (pickedResult.error || pickedResult.data?.error) {
      alert(pickedResult.data?.error || pickedResult.error?.message || "Could not mark picked.");
      return;
    }

    const stagedResult = await invokeEdge("admin-storage-ops", {
      action: "mark_in_staging",
      boxId,
    });
    if (stagedResult.error || stagedResult.data?.error) {
      alert(stagedResult.data?.error || stagedResult.error?.message || "Could not mark in staging.");
      return;
    }

    await loadAdminRows();
  };

  const canGenerateLabelForWorkflow = (row, assignment) => {
    const isLabelStillNeeded =
      row.latest_shipment_id &&
      row.latest_charge_status === "paid" &&
      row.latest_shipping_status === "paid" &&
      (row.latest_label_status === "needed" ||
        row.latest_label_status === "label_needed" ||
        row.latest_label_status === "purchase_failed" ||
        !row.latest_label_status);

    if (!isLabelStillNeeded) return false;
    if (row.lifecycle_status === "auction" || row.lifecycle_status === "removed_from_system") return false;

    if (row.latest_shipment_direction === "to_storage") {
      // Returns are automated after payment; allow admin only if FedEx automation failed.
      return row.latest_label_status === "purchase_failed";
    }

    const assignmentStatus = String(assignment?.status || "");
    const isStarterKitFlow =
      row.fulfillment_status === "paid_waiting_to_ship_bin" &&
      row.latest_shipment_direction === "to_customer";

    if (isStarterKitFlow) {
      if (String(assignment?.status || "") !== "qr_applied") return false;
      const kitIds = getStrictStarterKitBoxIds(row);
      if (!kitIds.length) return false;
      if (kitIds.length <= 1) return true;
      return kitIds.every((bid) => {
        const a = storageAssignments.find((x) => String(x.box_id) === bid);
        return a && String(a.status || "") === "qr_applied";
      });
    }

    const isWarehouseOutbound =
      row.latest_shipment_direction === "to_customer" &&
      row.status === "stored" &&
      row.fulfillment_status !== "paid_waiting_to_ship_bin";

    if (isWarehouseOutbound) {
      // Existing bins must be pulled from bay/staging before label generation.
      return ["picked", "in_staging", "label_verified"].includes(assignmentStatus);
    }

    return false;
  };

  const canMarkInTransit = () => false;

  const canMarkDelivered = () => false;

  const adminRowWouldShowActionButton = (row, assignment, shipmentStateMismatch) => {
    if (!storageStateLoaded) return true;
    if (row.lifecycle_status === "auction") return true;
    if (shipmentStateMismatch) return true;
    const opsAllowed =
      row.lifecycle_status !== "auction" && row.lifecycle_status !== "removed_from_system";
    if (!opsAllowed) return false;
    if (canGenerateLabelForWorkflow(row, assignment)) return true;
    if (row.status === "stored" && !assignment?.bay_code) return true;
    if (
      assignment &&
      assignment.status === "assigned" &&
      row.fulfillment_status !== "paid_waiting_to_ship_bin"
    ) {
      return true;
    }
    if (needsHomeBayPlacement(assignment) && row.status === "stored") {
      return true;
    }
    if (
      row.status === "stored" &&
      assignment?.status === "placed" &&
      row.latest_shipment_direction === "to_customer" &&
      row.latest_charge_status === "paid"
    ) {
      return true;
    }
    if (assignment?.status === "assigned" && row.fulfillment_status === "paid_waiting_to_ship_bin") {
      return true;
    }
    const matchStarter =
      assignment?.status === "qr_applied" &&
      row.fulfillment_status === "paid_waiting_to_ship_bin" &&
      row.latest_shipping_status === "label_created" &&
      kitReadyForLabelMatch(row);
    const matchWarehouse =
      assignment?.status === "in_staging" && row.latest_shipping_status === "label_created";
    if (matchStarter || matchWarehouse) return true;
    return false;
  };

  const getAdminNoActionHint = (row, assignment, shipmentStateMismatch) => {
    if (!storageStateLoaded) return null;
    if (row.lifecycle_status === "auction") return null;
    if (shipmentStateMismatch) return null;
    const opsAllowed =
      row.lifecycle_status !== "auction" && row.lifecycle_status !== "removed_from_system";
    if (!opsAllowed) {
      if (row.lifecycle_status === "removed_from_system") {
        return "Removed from system — no warehouse actions.";
      }
      return null;
    }
    if (adminRowWouldShowActionButton(row, assignment, shipmentStateMismatch)) return null;

    const ship = row.latest_shipping_status;
    const dir = row.latest_shipment_direction;
    const ast = String(assignment?.status || "");

    if (dir === "to_customer" && ship === "label_created" && ast === "label_verified") {
      return "Label OK — waiting on carrier/tracking.";
    }

    if (dir === "to_customer" && ship === "label_created" && ast === "placed") {
      return "Pick + stage first, then label, then match QR.";
    }

    if (dir === "to_customer" && ship === "paid" && ast === "qr_applied" && !isStarterKitShipmentRow(row)) {
      return "QR already applied — pick + stage this bin before creating the label.";
    }

    if (dir === "to_storage" && ship === "delivered" && assignment?.bay_code) {
      return `Return received — place in home bay ${assignment.bay_code}. Use Receive bin (scan) or Store in Bay.`;
    }

    if (dir === "to_customer" && (ship === "in_transit" || ship === "delivered")) {
      return "Shipped or delivered — no warehouse click.";
    }

    if (isStarterKitShipmentRow(row) && ship === "paid" && ast === "qr_applied") {
      const kitIds = getResolvedKitBoxIds(row);
      if (!kitIds.length) {
        return "Refresh page, then bin QR on every kit bin, then Create Carrier Label.";
      }
      const allQr = kitIds.every((bid) => {
        const a = storageAssignments.find((x) => String(x.box_id) === bid);
        return a && String(a.status || "") === "qr_applied";
      });
      if (!allQr) {
        return "Starter kit: apply bin QR on each bin in the blue block, then Create Carrier Label.";
      }
      if (canGenerateLabelForWorkflow(row, assignment)) {
        return "Ready — use Create Carrier Label (once per kit; any row in the blue block).";
      }
    }

    if (
      suppressWarehouseIntakeForStarterOutbound(row) &&
      dir === "to_customer" &&
      ship === "paid" &&
      ast === "assigned" &&
      row.fulfillment_status === "paid_waiting_to_ship_bin"
    ) {
      return "Starter kit: apply bin QR on each bin → Choose shipping & label → Match Shipping Label (scan bin QR + FedEx barcode). Bin # prints on sticker and FedEx label.";
    }

    if (dir === "to_storage") {
      return "Return shipment — usually no warehouse click until inbound tracking.";
    }

    if (!row.latest_shipment_id) {
      return "No shipment row yet (checkout/webhook) — Open Details.";
    }

    return "No warehouse button for this mix of status + bay step — Open Details or Exceptions.";
  };

  if (!appData.isAdmin) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Admin</h2>
        <p style={styles.warningText}>You do not have admin access.</p>
      </div>
    );
  }

  return (
    <div>
      {scanModal}
      <div style={styles.pageHeaderRow}>
        <div>
          <h2 style={styles.sectionTitle}>Admin Dashboard</h2>
          <p style={styles.mutedText}>
            Queues: starter kits · send to customer · return to storage · bins received · exceptions · auction.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" style={styles.primaryButton} onClick={() => void handleReceiveBinScan()}>
            Receive bin (scan)
          </button>
          <button style={styles.secondaryButton} onClick={loadAdminRows}>
            Refresh
          </button>
          <button
            style={styles.secondaryButton}
            onClick={() => runSubscriptionReconciliation(true)}
            disabled={subscriptionReconcileBusy}
            title="Dry run: show what would change, without updating the database"
          >
            {subscriptionReconcileBusy ? "Working…" : "Preview sub reconciliation"}
          </button>
          <button
            style={styles.secondaryButton}
            onClick={() => runSubscriptionReconciliation(false)}
            disabled={subscriptionReconcileBusy}
            title="Compare each paid bin’s Stripe subscription to the database and fix missed webhooks"
          >
            {subscriptionReconcileBusy ? "Reconciling…" : "Apply sub reconciliation"}
          </button>
        </div>
      </div>

      <div style={adminSummaryGridStyle}>
        <div style={adminSummaryCardStyle}>
          <p style={styles.smallText}>Bins in Storage</p>
          <h2 style={adminMetricStyle}>{binsInStorageCount}</h2>
        </div>

        <div style={adminSummaryCardStyle}>
          <p style={styles.smallText}>Bins in Transit</p>
          <h2 style={adminMetricStyle}>{binsInTransitCount}</h2>
        </div>

        <div style={adminSummaryCardStyle}>
          <p style={styles.smallText}>Bins with Customer</p>
          <h2 style={adminMetricStyle}>{binsWithCustomerCount}</h2>
        </div>

        <div style={adminSummaryCardStyle}>
          <p style={styles.smallText}>Bins at Auction</p>
          <h2 style={adminMetricStyle}>{binsAtAuctionCount}</h2>
        </div>

        <div style={{
          ...adminSummaryCardStyle,
          borderColor: dirtyShipmentStateCount > 0 ? "#F59E0B" : "#E5E5E5",
          backgroundColor: dirtyShipmentStateCount > 0 ? "#FFFBEB" : "#FFFFFF",
        }}>
          <p style={styles.smallText}>State Mismatches</p>
          <h2 style={{
            ...adminMetricStyle,
            color: dirtyShipmentStateCount > 0 ? "#92400E" : "#333333",
          }}>{dirtyShipmentStateCount}</h2>
        </div>

        <div
          style={{
            ...adminSummaryCardStyle,
            borderColor: overageOpenCount > 0 ? "#DC2626" : "#E5E5E5",
            backgroundColor: overageOpenCount > 0 ? "#FEF2F2" : "#FFFFFF",
          }}
        >
          <p style={styles.smallText}>Open carrier adjustments</p>
          <h2
            style={{
              ...adminMetricStyle,
              color: overageOpenCount > 0 ? "#991B1B" : "#333333",
            }}
          >
            {overageOpenCount}
          </h2>
        </div>
      </div>

      {overageOpenCount > 0 && (
        <div
          style={{
            ...styles.panel,
            marginBottom: 14,
            borderLeft: "4px solid #DC2626",
            backgroundColor: "#FEF2F2",
          }}
        >
          <strong style={{ color: "#991B1B" }}>
            {overageOpenCount} FedEx / carrier shipping adjustment{overageOpenCount === 1 ? "" : "s"} need review
          </strong>
          <p style={{ ...styles.smallText, marginTop: 6, marginBottom: 0 }}>
            Extra charges billed to the StorkBin FedEx account (re-weigh, surcharges, etc.). Review the table below —
            nothing is rebilled to customers automatically.
          </p>
        </div>
      )}

      {adminRowsError && (
        <div style={styles.panel}>
          <p style={styles.warningText}>
            Admin view could not load from Supabase yet: {adminRowsError}
          </p>
          <p style={styles.smallText}>
            Showing locally loaded boxes as a fallback.
          </p>
        </div>
      )}

      <div style={{ ...styles.panel, marginBottom: 16 }}>
        <h3 style={{ ...styles.sectionTitle, fontSize: "16px", marginBottom: 8 }}>
          Carrier shipping adjustments
        </h3>
        <p style={{ ...styles.smallText, marginBottom: 12 }}>
          When FedEx bills StorkBin more than the quoted label amount (re-weigh, DAS, address correction, etc.),
          record it here. Ops receives an email when Resend is configured. Automated invoice import can create these
          rows later; v1 is manual entry from FedEx billing / CSV.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 140px 1fr",
            gap: "10px",
            marginBottom: 12,
            alignItems: "end",
          }}
        >
          <label style={styles.smallText}>
            Shipment UUID
            <input
              type="text"
              value={overageForm.shipmentId}
              onChange={(e) => setOverageForm((f) => ({ ...f, shipmentId: e.target.value }))}
              placeholder="shipments.id"
              style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px" }}
            />
          </label>
          <label style={styles.smallText}>
            Carrier billed (USD)
            <input
              type="text"
              inputMode="decimal"
              value={overageForm.billedDollars}
              onChange={(e) => setOverageForm((f) => ({ ...f, billedDollars: e.target.value }))}
              placeholder="12.34"
              style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px" }}
            />
          </label>
          <div />
          <label style={{ ...styles.smallText, gridColumn: "1 / -1" }}>
            Notes (shown in email + table)
            <textarea
              value={overageForm.notes}
              onChange={(e) => setOverageForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="e.g. FedEx reweigh 62 lb billed vs 50 lb declared; invoice #…"
              style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", resize: "vertical" }}
            />
          </label>
        </div>
        <button
          type="button"
          style={styles.secondaryButton}
          disabled={overageSubmitBusy}
          onClick={() => submitOverageRecord()}
        >
          {overageSubmitBusy ? "Saving…" : "Record adjustment"}
        </button>

        <hr style={{ margin: "18px 0", border: "none", borderTop: "1px solid #e5e5e5" }} />

        <h4 style={{ fontSize: "14px", marginBottom: 8 }}>Import FedEx billing CSV</h4>
        <p style={{ ...styles.smallText, marginBottom: 8 }}>
          Paste an export from FedEx Billing Online (detail / line-level rows with tracking and net charge). Rows
          where the billed amount exceeds the shipment quoted amount create overage events
          and trigger the same ops email as manual entry. Unmatched tracking numbers are listed in the result — they
          are not dropped silently.
        </p>
        <div style={{ marginBottom: 8 }}>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            style={{ fontSize: "12px" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () => setFedexCsvText(String(reader.result || ""));
              reader.readAsText(f);
            }}
          />
        </div>
        <textarea
          value={fedexCsvText}
          onChange={(e) => setFedexCsvText(e.target.value)}
          rows={6}
          placeholder="Or paste CSV text here…"
          style={{ width: "100%", padding: "8px", fontSize: "11px", fontFamily: "monospace", resize: "vertical" }}
        />
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            style={styles.secondaryButton}
            disabled={fedexImportBusy}
            onClick={() => runFedexInvoiceCsvImport()}
          >
            {fedexImportBusy ? "Importing…" : "Run CSV import"}
          </button>
        </div>

        {fedexImportResult?.stats && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              backgroundColor: "#f8fafc",
              borderRadius: "8px",
              fontSize: "12px",
            }}
          >
            <strong>Last import summary</strong>
            <ul style={{ margin: "8px 0 0 16px", padding: 0 }}>
              <li>Data rows read: {fedexImportResult.stats.rowCount}</li>
              <li>Rows with tracking + valid amount: {fedexImportResult.stats.parsedRows}</li>
              <li>Matched to a StorkBin shipment: {fedexImportResult.stats.matchedShipments}</li>
              <li>Matched but billed ≤ quoted (no event): {fedexImportResult.stats.matchedNoOverage}</li>
              <li>Overage events created: {fedexImportResult.stats.overagesCreated}</li>
              <li>Duplicates skipped: {fedexImportResult.stats.duplicatesSkipped}</li>
              <li>Skipped (missing tracking/amount): {fedexImportResult.stats.skippedMissingFields}</li>
              <li>Skipped (no quote on shipment row): {fedexImportResult.stats.skippedNoQuoteBaseline}</li>
              <li>Multiple DB rows for same tracking (used first): {fedexImportResult.stats.ambiguousShipmentMatches}</li>
              <li>Unmatched rows: {fedexImportResult.stats.unmatched?.length ?? 0}</li>
              <li>Parse / DB errors: {fedexImportResult.stats.parseErrors?.length ?? 0}</li>
            </ul>
            {(fedexImportResult.stats.unmatched?.length ?? 0) > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer" }}>Show unmatched rows (tracking + invoice + amount)</summary>
                <pre
                  style={{
                    marginTop: 8,
                    maxHeight: 220,
                    overflow: "auto",
                    fontSize: "11px",
                    background: "#fff",
                    padding: 8,
                    borderRadius: 6,
                  }}
                >
                  {JSON.stringify(fedexImportResult.stats.unmatched, null, 2)}
                </pre>
              </details>
            )}
            {(fedexImportResult.stats.parseErrors?.length ?? 0) > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer" }}>Show row errors</summary>
                <pre
                  style={{
                    marginTop: 8,
                    maxHeight: 180,
                    overflow: "auto",
                    fontSize: "11px",
                    background: "#fff",
                    padding: 8,
                    borderRadius: 6,
                  }}
                >
                  {JSON.stringify(fedexImportResult.stats.parseErrors, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}

        {overageEvents.length === 0 ? (
          <p style={{ ...styles.mutedText, marginTop: 14 }}>No adjustment events yet.</p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                  <th style={{ padding: "6px 4px" }}>When</th>
                  <th style={{ padding: "6px 4px" }}>Status</th>
                  <th style={{ padding: "6px 4px" }}>Shipment</th>
                  <th style={{ padding: "6px 4px" }}>Tracking</th>
                  <th style={{ padding: "6px 4px" }}>Bin</th>
                  <th style={{ padding: "6px 4px" }}>Customer</th>
                  <th style={{ padding: "6px 4px" }}>Quoted</th>
                  <th style={{ padding: "6px 4px" }}>Billed</th>
                  <th style={{ padding: "6px 4px" }}>Overage</th>
                  <th style={{ padding: "6px 4px" }}>Detail</th>
                  <th style={{ padding: "6px 4px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {overageEvents.map((ev) => {
                  const sid = String(ev.shipment_id || "");
                  const bid = String(ev.box_id || "");
                  const open = String(ev.detection_status) === "detected";
                  return (
                    <tr
                      key={String(ev.id)}
                      style={{
                        borderBottom: "1px solid #eee",
                        backgroundColor: open ? "#FFF7ED" : "transparent",
                      }}
                    >
                      <td style={{ padding: "6px 4px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                        {ev.created_at ? String(ev.created_at).slice(0, 16).replace("T", " ") : "—"}
                      </td>
                      <td style={{ padding: "6px 4px", verticalAlign: "top" }}>
                        <span style={{ fontWeight: open ? 700 : 400 }}>{ev.detection_status || "—"}</span>
                        {ev.dismissed_at ? (
                          <div style={styles.smallText}>dismissed {String(ev.dismissed_at).slice(0, 10)}</div>
                        ) : null}
                      </td>
                      <td style={{ padding: "6px 4px", verticalAlign: "top", wordBreak: "break-all" }}>
                        {bid ? (
                          <Link to={`/admin/boxes/${bid}`} style={{ color: "#1D4ED8" }}>
                            Bin detail
                          </Link>
                        ) : null}
                        <div style={styles.smallText}>{sid.slice(0, 8)}…</div>
                      </td>
                      <td style={{ padding: "6px 4px", verticalAlign: "top", wordBreak: "break-all" }}>
                        {ev.shipment_tracking_url && ev.shipment_tracking_number ? (
                          <a href={String(ev.shipment_tracking_url)} target="_blank" rel="noreferrer">
                            {String(ev.shipment_tracking_number)}
                          </a>
                        ) : (
                          ev.shipment_tracking_number || ev.fedex_tracking_number || "—"
                        )}
                      </td>
                      <td style={{ padding: "6px 4px", verticalAlign: "top" }}>
                        {ev.box_number != null ? String(ev.box_number) : bid ? bid.slice(0, 8) : "—"}
                      </td>
                      <td style={{ padding: "6px 4px", verticalAlign: "top", wordBreak: "break-all" }}>
                        {ev.customer_email || ev.customer_name || ev.user_id || "—"}
                      </td>
                      <td style={{ padding: "6px 4px", verticalAlign: "top" }}>
                        {formatMoneyCents(ev.original_estimated_amount_cents)}
                      </td>
                      <td style={{ padding: "6px 4px", verticalAlign: "top" }}>
                        {formatMoneyCents(ev.carrier_billed_amount_cents)}
                      </td>
                      <td style={{ padding: "6px 4px", verticalAlign: "top", fontWeight: 600 }}>
                        {formatMoneyCents(ev.overage_amount_cents)}
                      </td>
                      <td style={{ padding: "6px 4px", verticalAlign: "top", maxWidth: 220 }}>
                        <div style={styles.smallText}>
                          {ev.notes ||
                            (ev.reason_codes != null ? JSON.stringify(ev.reason_codes) : "—")}
                        </div>
                        {ev.admin_alert_sent_at ? (
                          <div style={styles.smallText}>Alert email sent</div>
                        ) : (
                          <div style={styles.smallText}>No alert email logged</div>
                        )}
                      </td>
                      <td style={{ padding: "6px 4px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                        {open ? (
                          <>
                            <button
                              type="button"
                              style={{ ...styles.secondaryButton, fontSize: "11px", padding: "4px 8px" }}
                              onClick={() => updateOverageStatus(String(ev.id), "reviewed")}
                            >
                              Reviewed
                            </button>{" "}
                            <button
                              type="button"
                              style={{ ...styles.secondaryButton, fontSize: "11px", padding: "4px 8px" }}
                              onClick={() => updateOverageStatus(String(ev.id), "dismissed")}
                            >
                              Dismiss
                            </button>
                          </>
                        ) : (
                          <span style={styles.smallText}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "10px",
          marginBottom: "16px",
        }}
      >
        {QUEUES.map((queue) => (
          <button
            key={queue.key}
            type="button"
            aria-pressed={activeQueue === queue.key}
            style={{
              ...(activeQueue === queue.key ? styles.primaryButton : styles.secondaryButton),
              justifyContent: "space-between",
              display: "flex",
              width: "100%",
              ...(activeQueue === queue.key
                ? {
                    boxShadow: "0 0 0 2px #1D4ED8, 0 2px 8px rgba(37,99,235,0.25)",
                    fontWeight: 700,
                  }
                : {}),
            }}
            onClick={() => setActiveQueue(queue.key)}
          >
            <span>{queue.label}</span>
            <strong>{queueCounts[queue.key] || 0}</strong>
          </button>
        ))}
      </div>

      {activeQueue !== "all" && QUEUE_HELP[activeQueue] && (
        <div
          style={{
            marginBottom: "14px",
            padding: "12px 14px",
            borderRadius: "10px",
            border: "1px solid #E5E5E5",
            backgroundColor: "#FAFAFA",
          }}
        >
          <p style={{ ...styles.smallText, margin: 0, lineHeight: 1.5 }}>{QUEUE_HELP[activeQueue]}</p>
        </div>
      )}

      <div style={styles.boxCard}>
        <div style={filterWrapStyle}>
          <input
            style={{ ...styles.input, marginBottom: 0, width: "100%", boxSizing: "border-box" }}
            placeholder="Search bin, user, status, tracking..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />

          <div style={filterRowStyle}>
            <select
              style={{ ...styles.input, marginBottom: 0, width: "100%", boxSizing: "border-box" }}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="at_customer">At customer</option>
              <option value="stored">Stored</option>
              <option value="in_transit_to_customer">In transit to customer</option>
              <option value="in_transit_to_storage">In transit to storage</option>
              <option value="paid_waiting_to_ship_bin">Paid waiting to ship bin</option>
              <option value="ready_to_ship_to_customer">Ready to ship to customer</option>
              <option value="awaiting_customer_dropoff">Awaiting customer dropoff</option>
              <option value="label_created">Label created</option>
              <option value="in_transit">Shipment in transit</option>
              <option value="delivered">Shipment delivered</option>
              <option value="failed">Payment failed</option>
              <option value="auction">Auction</option>
              <option value="removed_from_system">Removed from system</option>
            </select>

            <select
              style={{ ...styles.input, marginBottom: 0, width: "100%", boxSizing: "border-box" }}
              value={userFilter}
              onChange={(event) => setUserFilter(event.target.value)}
            >
              <option value="all">All users</option>
              {users.map((userValue) => (
                <option key={userValue} value={userValue}>
                  {getUserFilterLabel(userValue)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p style={styles.smallText}>
          Showing {filteredRowsSorted.length} workflow rows ({filteredBinsCount} bins in this view,{" "}
          {uniqueBoxRows.length} total bins)
          {loadingAdminRows ? " · loading..." : ""}
        </p>
      </div>

      <div style={styles.boxCard}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
            <thead>
              <tr>
                <th style={tableHeaderStyle}>Bins</th>
                <th style={tableHeaderStyle}>User</th>
                <th style={tableHeaderStyle}>Physical</th>
                <th style={tableHeaderStyle}>Fulfillment</th>
                <th style={tableHeaderStyle}>Shipment</th>
                <th style={tableHeaderStyle}>Charge</th>
                <th style={tableHeaderStyle}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredRowsSorted.flatMap((row, index) => {
                const rowId = getCanonicalBoxId(row);
                const opsAllowed =
                  row.lifecycle_status !== "auction" && row.lifecycle_status !== "removed_from_system";
                const shipmentStateMismatch = getShipmentStateMismatch(row);
                const assignment = storageAssignments.find(
                  (item) => String(item.box_id) === rowId
                );
                const noActionHint = getAdminNoActionHint(row, assignment, shipmentStateMismatch);

                const kitGroupId = getStarterKitGroupShipmentId(row);
                const prevKitGroupId =
                  index > 0 ? getStarterKitGroupShipmentId(filteredRowsSorted[index - 1]) : "";
                const nextKitGroupId =
                  index < filteredRowsSorted.length - 1
                    ? getStarterKitGroupShipmentId(filteredRowsSorted[index + 1])
                    : "";
                const inStarterKitGroup = Boolean(kitGroupId);
                const kitGroupFirst = inStarterKitGroup && kitGroupId !== prevKitGroupId;
                const kitGroupLast = inStarterKitGroup && kitGroupId !== nextKitGroupId;

                const kitRowChrome = inStarterKitGroup
                  ? {
                      backgroundColor: "rgba(37, 99, 235, 0.07)",
                      borderLeft: "4px solid #2563EB",
                    }
                  : {};

                const rowsOut = [];

                if (kitGroupFirst) {
                  const kitIds = getResolvedKitBoxIds(row);
                  const kitBinCount = getStarterKitBinCount(row, kitIds);
                  const shipLabel = kitGroupId.startsWith("kitgrp:")
                    ? kitGroupId.slice(7, 15)
                    : String(row.latest_shipment_id || "").slice(0, 8);
                  rowsOut.push(
                    <tr key={`kit-banner-${kitGroupId}`}>
                      <td colSpan={7} style={starterKitGroupBannerCellStyle}>
                        <div
                          style={starterKitGroupBannerInnerStyle}
                          title={`Kit group: ${kitGroupId} · shipment: ${row.latest_shipment_id || "—"}`}
                        >
                          <span style={starterKitGroupBadgeStyle}>
                            {kitBinCount > 1 ? `${kitBinCount}-bin starter kit` : "Starter kit"}
                          </span>
                          <span style={starterKitGroupMetaStyle}>
                            {kitGroupId.startsWith("kitgrp:") ? "Kit" : "Shipment"} …{shipLabel} · {kitBinCount}{" "}
                            bins · one label · {getUserLabel(row)}
                          </span>
                          <span style={starterKitGroupBinsStyle}>Bins: {formatKitBinLabels(row)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                }

                rowsOut.push(
                  <tr
                    key={`${rowId}-${row.latest_shipment_id || "no-shipment"}`}
                    style={{
                      ...kitRowChrome,
                      ...(kitGroupFirst ? { borderTop: "2px solid #93C5FD" } : {}),
                      ...(kitGroupLast ? { borderBottom: "2px solid #2563EB" } : {}),
                    }}
                  >
                    <td style={tableCellStyle}>
                      <strong>{row.box_number || rowId}</strong>
                      {row.customer_bin_name && (
                        <p style={styles.smallText}>{row.customer_bin_name}</p>
                      )}
                      <p style={styles.smallText} title={`Internal ID: ${rowId}`}>
                        {getDisplayBinRef(row)}
                      </p>
                      {inStarterKitGroup && (
                        <p style={{ ...styles.smallText, marginTop: "6px", marginBottom: 0 }}>
                          Same kit as rows in this blue block (one outbound label).
                        </p>
                      )}
                      {!inStarterKitGroup && isStarterKitShipmentRow(row) && getResolvedKitBoxIds(row).length > 1 && (
                        <p style={{ ...styles.warningText, marginTop: "8px", marginBottom: 0 }}>
                          {getStarterKitDescription(row, getResolvedKitBoxIds(row))}{" "}
                          Bins: {formatKitBinLabels(row)}
                        </p>
                      )}
                      {!inStarterKitGroup &&
                        isStarterKitShipmentRow(row) &&
                        getResolvedKitBoxIds(row).length === 1 &&
                        getStarterKitBinCount(row, getResolvedKitBoxIds(row)) <= 1 && (
                        <p style={{ ...styles.smallText, marginTop: "6px", marginBottom: 0 }}>
                          {getStarterKitDescription(row, getResolvedKitBoxIds(row))}
                        </p>
                      )}
                      {!inStarterKitGroup &&
                        isStarterKitShipmentRow(row) &&
                        getResolvedKitBoxIds(row).length === 0 && (
                          <p style={{ ...styles.smallText, marginTop: "6px", marginBottom: 0 }}>
                            Kit shipment: refresh to load which bins share this label.
                          </p>
                        )}
                      <div style={{ marginTop: "8px" }}>
                        <Link style={styles.linkButtonSecondary} to={`/admin/boxes/${rowId}`}>
                          Open Details
                        </Link>
                      </div>
                    </td>

                    <td style={tableCellStyle}>
                      <span>{getUserLabel(row)}</span>
                    </td>

                    <td style={tableCellStyle}>{formatStatusLabel(row.status || "—")}</td>

                    <td style={tableCellStyle}>
                      {formatStatusLabel(row.fulfillment_status || "pending")}
                      {row.fulfillment_status === "shipment_carrier_exception" && (
                        <p style={{ ...styles.warningText, marginTop: 6, marginBottom: 0 }}>
                          Carrier exception (FedEx) — verify tracking; physical bin location unchanged.
                        </p>
                      )}
                      {(() => {
                        const homeLine = formatHomeBayLine(assignment, row);
                        if (!homeLine) return null;
                        return (
                          <>
                            <p style={styles.smallText}>{homeLine.primary}</p>
                            {homeLine.secondary ? (
                              <p style={{ ...styles.smallText, marginTop: 2, color: "#666" }}>
                                {homeLine.secondary}
                              </p>
                            ) : null}
                            <WarehouseWorkflowPanel
                              workflow={getWarehouseWorkflow(row, assignment, { isStarterKitShipmentRow })}
                            />
                          </>
                        );
                      })()}
                      {row.lifecycle_status === "auction" && (
                        <p style={styles.warningText}>Lifecycle: Auction</p>
                      )}
                      {row.lifecycle_status === "removed_from_system" && (
                        <p style={styles.smallText}>Lifecycle: Removed from system</p>
                      )}
                      {row.cancel_status && row.cancel_status !== "none" && (
                        <p style={styles.warningText}>Cancel: {row.cancel_status}</p>
                      )}
                      {shipmentStateMismatch && (
                        <div style={stateMismatchNoticeStyle}>
                          <strong>Shipment state mismatch</strong>
                          <p style={{ ...styles.smallText, margin: "4px 0 0 0" }}>
                            Expected {shipmentStateMismatch.expected.status || row.status} / {shipmentStateMismatch.expected.fulfillment_status}.
                          </p>
                        </div>
                      )}
                    </td>

                    <td style={tableCellStyle}>
                      {row.latest_shipment_id ? (
                        <>
                          <strong>{formatStatusLabel(row.latest_shipping_status || "not started")}</strong>
                          <p style={styles.smallText}>
                            {formatShipmentDirection(row.latest_shipment_direction)}
                          </p>
                          {row.latest_tracking_number && (
                            <p style={styles.smallText}>
                              {row.latest_tracking_url ? (
                                <a href={row.latest_tracking_url} target="_blank" rel="noreferrer">
                                  {row.latest_tracking_number}
                                </a>
                              ) : (
                                row.latest_tracking_number
                              )}
                            </p>
                          )}
                          {row.latest_label_url && (
                            <p style={styles.smallText}>
                              <a href={row.latest_label_url} target="_blank" rel="noreferrer">
                                View Label
                              </a>
                            </p>
                          )}
                          {row.latest_shipping_status === "exception" && (
                            <p style={{ ...styles.warningText, marginTop: 8, marginBottom: 0 }}>
                              Shipment status: <strong>exception</strong> — see FedEx; bin fulfillment flagged.
                            </p>
                          )}
                        </>
                      ) : (
                        <span style={styles.smallText}>No shipment</span>
                      )}
                    </td>

                    <td style={tableCellStyle}>
                      {formatStatusLabel(row.latest_charge_status || "—")}
                    </td>

                    <td style={tableCellStyle}>
                      {!storageStateLoaded ? (
                        <span style={styles.smallText}>Loading actions…</span>
                      ) : (
                        <>
                      <div style={actionRowStyle}>
                        {opsAllowed && canGenerateLabelForWorkflow(row, assignment) && (
                          <button style={styles.primaryButton} onClick={() => handleGenerateLabel(row)}>
                            {isStarterKitShipmentRow(row) ? "Choose shipping & label" : "Create Carrier Label"}
                          </button>
                        )}

                        {row.lifecycle_status === "auction" && (
                          <button
                            style={styles.dangerButton}
                            onClick={() => handleMarkRemovedFromSystem(row)}
                          >
                            Mark Removed From System
                          </button>
                        )}

                        {opsAllowed && row.status === "stored" && !assignment?.bay_code && (
                          <>
                            <button
                              style={styles.primaryButton}
                              onClick={() => handleAssignBay(row)}
                            >
                              Assign home bay (first time only)
                            </button>
                          </>
                        )}

                        {opsAllowed &&
                          assignment?.bay_code &&
                          needsHomeBayPlacement(assignment) &&
                          row.fulfillment_status !== "paid_waiting_to_ship_bin" &&
                          !suppressWarehouseIntakeForStarterOutbound(row) && (
                            <>
                              <button
                                style={styles.primaryButton}
                                onClick={() => navigate(`/admin/intake/${getCanonicalBoxId(row)}`)}
                              >
                                Receive / place in bay
                              </button>
                              <button
                                style={styles.secondaryButton}
                                onClick={() => handleMarkPlaced(row)}
                              >
                                Store in Bay
                              </button>
                            </>
                          )}

                        {opsAllowed &&
                          assignment &&
                          assignment.status === "assigned" &&
                          !assignment.bay_code &&
                          row.fulfillment_status !== "paid_waiting_to_ship_bin" &&
                          !suppressWarehouseIntakeForStarterOutbound(row) && (
                            <button
                              style={styles.primaryButton}
                              onClick={() => handleMarkPlaced(row)}
                            >
                              Store in Bay
                            </button>
                          )}

                        {opsAllowed &&
                          row.status === "stored" &&
                          ["placed", "qr_applied"].includes(String(assignment?.status || "")) &&
                          row.latest_shipment_direction === "to_customer" &&
                          row.latest_charge_status === "paid" &&
                          !isStarterKitShipmentRow(row) && (
                            <button
                              style={styles.primaryButton}
                              onClick={() => handleMarkPicked(row)}
                            >
                              Pick + Stage Scan
                            </button>
                          )}

                        {opsAllowed &&
                          assignment?.status === "assigned" &&
                          row.fulfillment_status === "paid_waiting_to_ship_bin" && (
                            <button
                              style={styles.primaryButton}
                              onClick={async () => {
                                const expectedScanUrl = getCustomerBinScanUrl(rowId);
                                const binQrCode = await scanPrompt({
                                  title: `Scan bin QR — ${row.box_number || rowId}`,
                                  message:
                                    "Point your camera at the bin QR sticker on the physical bin. The scan must be the full URL (includes /scan/…), not just the bin number.",
                                  expectedHint: expectedScanUrl || rowId,
                                  scanMode: "qr_url",
                                });
                                if (!binQrCode || !String(binQrCode).trim()) {
                                  alert("Bin QR scan is required.");
                                  return;
                                }
                                const scanValue = String(binQrCode).trim();
                                if (!binScanMatchesBox(scanValue, rowId)) {
                                  alert(
                                    `That scan does not match this bin.\n\nExpected URL like:\n${expectedScanUrl || rowId}\n\nYou pasted:\n${scanValue.slice(0, 120)}`,
                                  );
                                  return;
                                }
                                const result = await invokeEdge("admin-storage-ops", {
                                  action: "mark_qr_applied",
                                  boxId: rowId,
                                  binQrCode: scanValue,
                                });
                                if (await alertEdgeFailure(result, "Could not mark QR applied.")) {
                                  return;
                                }
                                await loadAdminRows();
                              }}
                            >
                              Apply Bin QR Sticker
                            </button>
                          )}

                        {opsAllowed &&
                          ((assignment?.status === "qr_applied" &&
                            row.fulfillment_status === "paid_waiting_to_ship_bin" &&
                            row.latest_shipping_status === "label_created" &&
                            kitReadyForLabelMatch(row)) ||
                            (assignment?.status === "in_staging" &&
                              row.latest_shipping_status === "label_created")) && (
                          <button
                            style={styles.primaryButton}
                            onClick={async () => {
                              try {
                                const starterFlow = isStarterKitShipmentRow(row);
                                const kitIds = starterFlow
                                  ? [...getResolvedKitBoxIds(row)].sort((a, b) => {
                                      const la =
                                        operationalRows.find((x) => getCanonicalBoxId(x) === a)?.box_number || a;
                                      const lb =
                                        operationalRows.find((x) => getCanonicalBoxId(x) === b)?.box_number || b;
                                      return String(la).localeCompare(String(lb), undefined, { numeric: true });
                                    })
                                  : [rowId];
                                const binQrByBoxId = {};

                                if (starterFlow && !kitIds.length) {
                                  alert("Kit bin list is not loaded yet — click Refresh, then try again.");
                                  return;
                                }

                                if (starterFlow && kitIds.length > 1) {
                                  const confirmed = window.confirm(
                                    `This is a ${kitIds.length}-bin starter kit on one label.\nYou will scan all ${kitIds.length} bin QRs, then one shipping-label QR. Continue?`
                                  );
                                  if (!confirmed) return;
                                }

                                if (starterFlow) {
                                  for (let i = 0; i < kitIds.length; i += 1) {
                                    const bid = kitIds[i];
                                    const label =
                                      operationalRows.find((x) => getCanonicalBoxId(x) === bid)?.box_number ||
                                      bid;
                                    const scanned = await scanPrompt({
                                      title:
                                        kitIds.length > 1
                                          ? `Bin ${i + 1} of ${kitIds.length} — ${label}`
                                          : `Scan bin QR — ${label}`,
                                      message: `Scan the bin QR sticker for bin ${label}.`,
                                      expectedHint: getCustomerBinScanUrl(bid) || bid,
                                      scanMode: "qr_url",
                                    });
                                    if (!scanned || !String(scanned).trim()) {
                                      alert("Each bin QR scan is required to confirm the full kit.");
                                      return;
                                    }
                                    binQrByBoxId[bid] = String(scanned).trim();
                                  }
                                }

                                let binQrScanSingle = "";
                                if (!starterFlow) {
                                  const scanned = await scanPrompt({
                                    title: `Scan bin QR — ${row.box_number || rowId}`,
                                    message: "Confirm bin QR before matching the shipping label.",
                                    expectedHint: getCustomerBinScanUrl(rowId) || rowId,
                                    scanMode: "qr_url",
                                  });
                                  if (!scanned || !String(scanned).trim()) {
                                    alert("Bin QR scan is required before matching the shipping label.");
                                    return;
                                  }
                                  binQrScanSingle = String(scanned).trim();
                                }

                                const trackingHint = row.latest_tracking_number
                                  ? ` (tracking ${row.latest_tracking_number})`
                                  : "";
                                const labelQrCode = await scanPrompt({
                                  title: `Scan FedEx label${trackingHint}`,
                                  message:
                                    starterFlow && kitIds.length > 1
                                      ? `Scan the FedEx barcode on the label (same label for all ${kitIds.length} bins).`
                                      : "Scan the FedEx barcode on the shipping label for this shipment.",
                                  expectedHint: row.latest_tracking_number
                                    ? String(row.latest_tracking_number)
                                    : "",
                                  scanMode: "barcode",
                                });
                                if (!labelQrCode || !String(labelQrCode).trim()) {
                                  alert("Shipping label barcode scan is required to confirm the match.");
                                  return;
                                }

                                const verifyBody = {
                                  action: "mark_label_verified",
                                  boxId: rowId,
                                  labelQrCode: String(labelQrCode).trim(),
                                };
                                if (binQrScanSingle) {
                                  verifyBody.binQrScan = binQrScanSingle;
                                }
                                if (row.latest_shipment_id) {
                                  verifyBody.shipmentId = String(row.latest_shipment_id);
                                }
                                if (starterFlow && Object.keys(binQrByBoxId).length) {
                                  verifyBody.binQrByBoxId = binQrByBoxId;
                                }

                                const verified = await invokeEdge("admin-storage-ops", verifyBody);
                                if (verified.error || verified.data?.error) {
                                  const detail =
                                    (await getEdgeFunctionErrorMessage(verified.error, verified.data)) ||
                                    verified.data?.error ||
                                    verified.error?.message ||
                                    "Could not verify label QR match.";
                                  alert(detail);
                                  return;
                                }
                                const matched = verified.data?.matchedTracking;
                                alert(
                                  matched
                                    ? `Match confirmed. Label tracking ${matched} is on the correct bin(s).`
                                    : "Bin QR and shipping label barcode matched and saved.",
                                );
                                await loadAdminRows();
                              } catch (err) {
                                alert(
                                  err instanceof Error
                                    ? err.message
                                    : "Could not complete label matching."
                                );
                              }
                            }}
                          >
                            Match Shipping Label (QR)
                          </button>
                        )}

                        {shipmentStateMismatch && (
                          <button
                            style={styles.dangerButton}
                            onClick={() => handleRepairShipmentState(row)}
                          >
                            Repair State
                          </button>
                        )}
                        {opsAllowed && row.latest_shipment_id && row.latest_shipping_status === "label_created" && (
                          <button
                            style={styles.secondaryButton}
                            onClick={() => handleSimulateCarrierStep(row, "set_in_transit")}
                          >
                            Simulate In Transit
                          </button>
                        )}
                        {opsAllowed && row.latest_shipment_id && row.latest_shipping_status === "in_transit" && (
                          <button
                            style={styles.secondaryButton}
                            onClick={() => handleSimulateCarrierStep(row, "set_delivered")}
                          >
                            Simulate Delivered
                          </button>
                        )}
                      </div>
                      {noActionHint && <p style={adminNoActionHintStyle}>{noActionHint}</p>}
                        </>
                      )}
                    </td>
                  </tr>
                );

                return rowsOut;
              })}

              {filteredRowsSorted.length === 0 && (
                <tr>
                  <td style={tableCellStyle} colSpan="7">
                    <p style={styles.mutedText}>No bins match this queue/filter.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {starterLabelModal && (
        <StarterKitLabelModal
          shipmentId={starterLabelModal.shipmentId}
          pieceCount={starterLabelModal.pieceCount}
          kitDescription={starterLabelModal.kitDescription}
          onClose={() => setStarterLabelModal(null)}
          onSuccess={() => {
            setStarterLabelModal(null);
            reloadAfterAction();
          }}
          onPurchaseLabel={async (purchaseOpts) => {
            const shipment = getShipmentFromRow(starterLabelModal.row);
            const box = getBoxFromRow(starterLabelModal.row);
            return appData.generateLabel(shipment, box, purchaseOpts);
          }}
        />
      )}
    </div>
  );
}

function formatStatusLabel(value) {
  if (!value) return "—";

  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatShipmentDirection(direction) {
  if (direction === "to_customer") return "To Customer";
  if (direction === "to_storage") return "Return to Storage";
  return "Direction Unknown";
}

const starterKitGroupBannerCellStyle = {
  padding: "0",
  border: "none",
  backgroundColor: "transparent",
};

const starterKitGroupBannerInnerStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "10px 14px",
  margin: "10px 0 6px 0",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid #93C5FD",
  backgroundColor: "rgba(37, 99, 235, 0.1)",
};

const starterKitGroupBadgeStyle = {
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#1D4ED8",
  backgroundColor: "#DBEAFE",
  padding: "4px 10px",
  borderRadius: "999px",
};

const starterKitGroupMetaStyle = {
  fontSize: "13px",
  color: "#1E3A8A",
  fontWeight: 600,
};

const starterKitGroupBinsStyle = {
  fontSize: "13px",
  color: "#334155",
  flex: "1 1 220px",
  minWidth: "0",
};

const adminSummaryGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
  marginBottom: "16px",
};

const adminSummaryCardStyle = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #E5E5E5",
  borderRadius: "10px",
  padding: "16px",
  textAlign: "center",
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
};

const adminMetricStyle = {
  margin: "6px 0 0 0",
  fontSize: "28px",
  fontWeight: 700,
  color: "#333333",
};

const filterWrapStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const filterRowStyle = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "12px",
};

const tableHeaderStyle = {
  textAlign: "left",
  padding: "10px",
  borderBottom: "1px solid #E5E5E5",
  fontSize: "13px",
  color: "#555555",
};

const tableCellStyle = {
  padding: "10px",
  borderBottom: "1px solid #E5E5E5",
  verticalAlign: "top",
  fontSize: "14px",
};

const actionRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  alignItems: "center",
};

const adminNoActionHintStyle = {
  margin: "10px 0 0 0",
  padding: "8px 10px",
  fontSize: "13px",
  lineHeight: 1.45,
  color: "#555555",
  backgroundColor: "#F4F4F5",
  borderRadius: "8px",
  border: "1px solid #E4E4E7",
  maxWidth: "420px",
};

const stateMismatchNoticeStyle = {
  backgroundColor: "#FFFBEB",
  border: "1px solid #F59E0B",
  borderRadius: "8px",
  color: "#92400E",
  marginTop: "8px",
  padding: "8px",
};

export default AdminDashboardPage;
