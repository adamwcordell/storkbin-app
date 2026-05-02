import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../supabaseClient";
import styles from "../styles/styles";

const QUEUES = [
  { key: "all", label: "All" },
  { key: "needs_label", label: "Needs Label" },
  { key: "ready_to_ship", label: "Ready to Ship" },
  { key: "in_transit", label: "In Transit" },
  { key: "awaiting_storage", label: "Awaiting Storage" },
  { key: "failed_payment", label: "Failed Payment" },
  { key: "cancellations", label: "Cancellations" },
  { key: "drafts", label: "Drafts" },
  { key: "auction", label: "Auction" },
  { key: "state_mismatch", label: "State Mismatch" },
];

function AdminDashboardPage({ appData }) {
  const [adminRows, setAdminRows] = useState([]);
  const [loadingAdminRows, setLoadingAdminRows] = useState(false);
  const [adminRowsError, setAdminRowsError] = useState("");
  const [activeQueue, setActiveQueue] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");

  const loadAdminRows = async () => {
    if (!appData.isAdmin) return;

    setLoadingAdminRows(true);
    setAdminRowsError("");

    const { data, error } = await supabase
      .from("admin_ops_bins")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setAdminRowsError(error.message);
      setAdminRows([]);
    } else {
      setAdminRows(data || []);
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

  const rawRows = adminRows.length > 0 ? adminRows : fallbackRows;

  const shouldGroupStarterShipment = (row) =>
    row.latest_shipment_id &&
    row.latest_shipment_direction === "to_customer" &&
    row.fulfillment_status !== "bin_with_customer" &&
    row.latest_shipping_status !== "delivered";

  const rows = useMemo(() => {
    const grouped = [];
    const groupMap = new Map();

    rawRows.forEach((row) => {
      if (!shouldGroupStarterShipment(row)) {
        grouped.push({
          ...row,
          row_type: "box",
          grouped_boxes: [row],
          display_box_numbers: row.box_number || row.box_id || row.id,
        });
        return;
      }

      const groupKey = row.latest_shipment_id;

      if (!groupMap.has(groupKey)) {
        const group = {
          ...row,
          row_type: "starter_shipment",
          grouped_boxes: [],
          display_box_numbers: "",
        };

        groupMap.set(groupKey, group);
        grouped.push(group);
      }

      const group = groupMap.get(groupKey);
      group.grouped_boxes.push(row);
      group.display_box_numbers = group.grouped_boxes
        .map((groupedRow) => groupedRow.box_number || groupedRow.box_id)
        .join(", ");
    });

    return grouped;
  }, [rawRows]);

  const users = useMemo(() => {
    const uniqueUsers = new Set(
      rows
        .map((row) => row.customer_email || row.user_id)
        .filter(Boolean)
    );

    return Array.from(uniqueUsers).sort();
  }, [rows]);

  const getExpectedBoxStateForShipment = (row) => {
    if (!row.latest_shipment_id) return null;

    if (row.latest_shipping_status === "label_created") {
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
    if (row.lifecycle_status === "auction") return "auction";

    if (getShipmentStateMismatch(row)) return "state_mismatch";

    if (row.latest_charge_status === "failed" || row.fulfillment_status === "shipment_payment_failed") {
      return "failed_payment";
    }

    if (row.cancel_status === "requested") {
      return "cancellations";
    }

    if (row.checkout_status === "draft") {
      return "drafts";
    }

    if (
      row.latest_shipment_id &&
      (row.latest_label_status === "needed" ||
        row.latest_label_status === "label_needed" ||
        !row.latest_label_status) &&
      (row.latest_shipping_status === "paid" || row.latest_charge_status === "paid")
    ) {
      return "needs_label";
    }

    if (row.latest_shipping_status === "label_created") {
      return "ready_to_ship";
    }

    if (row.latest_shipping_status === "in_transit") {
      return "in_transit";
    }

    if (
      row.status === "in_transit_to_storage" ||
      row.fulfillment_status === "awaiting_storage_arrival"
    ) {
      return "awaiting_storage";
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
  }, [rows]);

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

  const paidRowsForSummary = rows.filter(
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
      row.fulfillment_status === "awaiting_storage_arrival"
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
    if (!row.latest_shipment_id) return null;

    const loadedShipment = appData.shipments.find(
      (shipment) => shipment.id === row.latest_shipment_id
    );

    return {
      id: row.latest_shipment_id,
      box_id: row.box_id || row.id,
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
    id: row.box_id || row.id,
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

    await appData.generateLabel(shipment, box);
    reloadAfterAction();
  };

  const handleMarkInTransit = async (row) => {
    const shipment = getShipmentFromRow(row);
    const box = getBoxFromRow(row);

    if (!shipment) {
      alert("No shipment exists for this row yet.");
      return;
    }

    await appData.markShipmentInTransit(shipment, box);
    reloadAfterAction();
  };

  const handleMarkDelivered = async (row) => {
    const shipment = getShipmentFromRow(row);
    const box = getBoxFromRow(row);

    if (!shipment) {
      alert("No shipment exists for this row yet.");
      return;
    }

    await appData.markShipmentDelivered(shipment, box);
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

  const handleMarkRemovedFromSystem = async (row) => {
    const boxId = row.box_id || row.id;
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

  const canGenerateLabel = (row) =>
    row.lifecycle_status !== "auction" &&
    row.lifecycle_status !== "removed_from_system" &&
    row.latest_shipment_id &&
    row.latest_charge_status === "paid" &&
    (row.latest_label_status === "needed" ||
      row.latest_label_status === "label_needed" ||
      !row.latest_label_status) &&
    row.latest_shipping_status === "paid";

  const canMarkInTransit = (row) =>
    row.lifecycle_status !== "auction" &&
    row.lifecycle_status !== "removed_from_system" &&
    row.latest_shipment_id &&
    row.latest_shipping_status === "label_created";

  const canMarkDelivered = (row) =>
    row.lifecycle_status !== "auction" &&
    row.lifecycle_status !== "removed_from_system" &&
    row.latest_shipment_id &&
    row.latest_shipping_status === "in_transit";

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
      <div style={styles.pageHeaderRow}>
        <div>
          <h2 style={styles.sectionTitle}>Admin Dashboard</h2>
          <p style={styles.mutedText}>
            Ops queues for labels, shipments, cancellations, failed payments, and warehouse movement.
          </p>
        </div>

        <button style={styles.secondaryButton} onClick={loadAdminRows}>
          Refresh
        </button>
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
      </div>

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
            style={{
              ...(activeQueue === queue.key ? styles.primaryButton : styles.secondaryButton),
              justifyContent: "space-between",
              display: "flex",
              width: "100%",
            }}
            onClick={() => setActiveQueue(queue.key)}
          >
            <span>{queue.label}</span>
            <strong>{queueCounts[queue.key] || 0}</strong>
          </button>
        ))}
      </div>

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
              <option value="requested">Cancellation requested</option>
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
                  {userValue}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p style={styles.smallText}>
          Showing {filteredRows.length} of {rows.length} rows
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
              {filteredRows.map((row) => {
                const rowId = row.box_id || row.id;
                const isGrouped = row.row_type === "starter_shipment";
                const shipmentStateMismatch = getShipmentStateMismatch(row);

                return (
                  <tr key={`${rowId}-${row.latest_shipment_id || "no-shipment"}-${isGrouped ? "group" : "box"}`}>
                    <td style={tableCellStyle}>
                      <strong>
                        {isGrouped
                          ? `Shipment (${row.grouped_boxes.length} bins)`
                          : row.box_number || rowId}
                      </strong>
                      {row.customer_bin_name && !isGrouped && (
                        <p style={styles.smallText}>{row.customer_bin_name}</p>
                      )}
                      <p style={styles.smallText}>
                        {isGrouped
                          ? row.display_box_numbers
                          : `ID: ${rowId}`}
                      </p>
                    </td>

                    <td style={tableCellStyle}>
                      <span>{row.customer_email || row.user_id || "Unknown"}</span>
                    </td>

                    <td style={tableCellStyle}>{formatStatusLabel(row.status || "—")}</td>

                    <td style={tableCellStyle}>
                      {formatStatusLabel(row.fulfillment_status || "pending")}
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
                        </>
                      ) : (
                        <span style={styles.smallText}>No shipment</span>
                      )}
                    </td>

                    <td style={tableCellStyle}>
                      {formatStatusLabel(row.latest_charge_status || "—")}
                    </td>

                    <td style={tableCellStyle}>
                      <div style={styles.row}>
                        {canGenerateLabel(row) && (
                          <button style={styles.primaryButton} onClick={() => handleGenerateLabel(row)}>
                            Generate Label
                          </button>
                        )}

                        {canMarkInTransit(row) && (
                          <button style={styles.primaryButton} onClick={() => handleMarkInTransit(row)}>
                            Mark In Transit
                          </button>
                        )}

                        {canMarkDelivered(row) && (
                          <button style={styles.secondaryButton} onClick={() => handleMarkDelivered(row)}>
                            {row.latest_shipment_direction === "to_storage"
                              ? "Receive Into Storage"
                              : "Mark Delivered"}
                          </button>
                        )}

                        {row.cancel_status === "requested" && (
                          <>
                            <button style={styles.primaryButton} onClick={() => appData.approveCancellation(rowId)}>
                              Approve
                            </button>
                            <button style={styles.dangerButton} onClick={() => appData.rejectCancellation(rowId)}>
                              Reject
                            </button>
                          </>
                        )}

                        {row.lifecycle_status === "auction" && (
                          <button
                            style={styles.dangerButton}
                            onClick={() => handleMarkRemovedFromSystem(row)}
                          >
                            Mark Removed From System
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

                        <Link style={styles.linkButtonSecondary} to={`/admin/boxes/${rowId}`}>
                          Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredRows.length === 0 && (
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

const stateMismatchNoticeStyle = {
  backgroundColor: "#FFFBEB",
  border: "1px solid #F59E0B",
  borderRadius: "8px",
  color: "#92400E",
  marginTop: "8px",
  padding: "8px",
};

export default AdminDashboardPage;
