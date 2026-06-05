import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import styles from "../styles/styles";
import OperationsControls from "../components/OperationsControls";
import BinQrStickerSheet from "../components/BinQrStickerSheet";
import { buildDisplayBinRef, resolveCustomerEmailForBin } from "../utils/binDisplayRef";
import { formatHomeBayLine } from "../utils/homeBayDisplay";

function buildShipmentStubFromAdminRow(row) {
  if (!row?.latest_shipment_id) return null;

  return {
    id: row.latest_shipment_id,
    user_id: row.user_id,
    shipment_direction: row.latest_shipment_direction,
    shipping_status: row.latest_shipping_status,
    charge_status: row.latest_charge_status,
    label_status: row.latest_label_status,
    tracking_number: row.latest_tracking_number,
    tracking_url: row.latest_tracking_url,
    label_url: row.latest_label_url,
    shipping_cost: row.latest_shipping_cost,
    shipping_estimate: row.latest_shipping_cost,
    shipping_address: row.requested_shipping_address || {},
    carrier: null,
    charge_failure_reason: null,
    shipment_boxes: [],
  };
}

function AdminBoxDetailPage({ appData }) {
  const { boxId } = useParams();
  const navigate = useNavigate();
  const [remoteBox, setRemoteBox] = useState(null);
  const [remoteShipment, setRemoteShipment] = useState(null);
  const [remoteItems, setRemoteItems] = useState([]);
  const [currentAssignment, setCurrentAssignment] = useState(null);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [remoteLoadError, setRemoteLoadError] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [stickerModalOpen, setStickerModalOpen] = useState(false);
  const [profileEmailForBox, setProfileEmailForBox] = useState("");

  const localBox = useMemo(
    () => appData.boxes.find((b) => String(b.id) === String(boxId)),
    [appData.boxes, boxId]
  );

  useEffect(() => {
    if (!boxId || !appData.isAdmin) return undefined;

    if (localBox) {
      setRemoteBox(null);
      setRemoteShipment(null);
      setRemoteItems([]);
      setRemoteLoadError("");
      setRemoteLoading(false);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      setRemoteLoading(true);
      setRemoteLoadError("");

      const loadByResolvedId = async (adminRow, resolvedId) => {
        if (!adminRow || !resolvedId) return;

        setRemoteBox(adminRow);

        const shipmentId = adminRow.latest_shipment_id;
        if (shipmentId) {
          const { data: shipRow } = await supabase
            .from("shipments")
            .select("*, shipment_boxes(*)")
            .eq("id", shipmentId)
            .maybeSingle();

          if (!cancelled) {
            setRemoteShipment(shipRow || buildShipmentStubFromAdminRow(adminRow));
          }
        } else if (!cancelled) {
          setRemoteShipment(null);
        }

        const { data: items } = await supabase
          .from("items")
          .select("*")
          .eq("box_id", resolvedId);

        if (!cancelled) {
          setRemoteItems(items || []);
          setRemoteLoading(false);
        }
      };

      const { data: byPrimaryId, error: primaryError } = await supabase
        .from("admin_ops_bins")
        .select("*")
        .eq("id", boxId)
        .maybeSingle();

      if (cancelled) return;

      if (primaryError) {
        setRemoteBox(null);
        setRemoteShipment(null);
        setRemoteItems([]);
        setRemoteLoadError(primaryError.message);
        setRemoteLoading(false);
        return;
      }

      if (byPrimaryId) {
        await loadByResolvedId(byPrimaryId, byPrimaryId.id);
        return;
      }

      const { data: byInternalId, error: internalError } = await supabase
        .from("admin_ops_bins")
        .select("*")
        .eq("internal_id", boxId)
        .maybeSingle();

      if (cancelled) return;

      if (internalError) {
        setRemoteBox(null);
        setRemoteShipment(null);
        setRemoteItems([]);
        setRemoteLoadError(internalError.message);
        setRemoteLoading(false);
        return;
      }

      if (byInternalId) {
        await loadByResolvedId(byInternalId, byInternalId.id);
        return;
      }

      const { data: bareBox, error: bareError } = await supabase
        .from("boxes")
        .select("*")
        .eq("id", boxId)
        .maybeSingle();

      if (cancelled) return;

      if (bareError || !bareBox) {
        setRemoteBox(null);
        setRemoteShipment(null);
        setRemoteItems([]);
        setRemoteLoadError(
          bareError?.message ||
            "This bin was not found in the admin operations view or boxes table."
        );
        setRemoteLoading(false);
        return;
      }

      setRemoteBox(bareBox);
      setRemoteShipment(null);
      const { data: items } = await supabase.from("items").select("*").eq("box_id", bareBox.id);
      if (!cancelled) {
        setRemoteItems(items || []);
        setRemoteLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [boxId, appData.isAdmin, localBox]);

  const resolvedBoxId = localBox?.id || remoteBox?.id || null;

  useEffect(() => {
    if (!appData.isAdmin || !resolvedBoxId) {
      setCurrentAssignment(null);
      setAssignmentLoading(false);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      setAssignmentLoading(true);
      const { data } = await supabase
        .from("bin_storage_assignments")
        .select("*")
        .eq("box_id", resolvedBoxId)
        .eq("is_current", true)
        .maybeSingle();

      if (!cancelled) {
        setCurrentAssignment(data || null);
        setAssignmentLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appData.isAdmin, resolvedBoxId]);

  const boxForProfileEmail = localBox || remoteBox;
  const userIdForProfile = boxForProfileEmail?.user_id;

  useEffect(() => {
    if (!userIdForProfile) {
      setProfileEmailForBox("");
      return undefined;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", userIdForProfile)
        .maybeSingle();

      if (!cancelled) {
        setProfileEmailForBox(!error && data?.email ? String(data.email).trim() : "");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userIdForProfile]);

  if (!appData?.isAdmin) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Admin</h2>
        <p style={styles.warningText}>You do not have admin access.</p>
      </div>
    );
  }

  const box = localBox || remoteBox;

  if (!box) {
    const showLoading =
      Boolean(boxId) && !remoteLoadError && (remoteLoading || !localBox);

    if (showLoading) {
      return (
        <div style={styles.panel}>
          <h2 style={styles.sectionTitle}>Loading bin…</h2>
          <p style={styles.mutedText}>Fetching bin details for admin.</p>
        </div>
      );
    }

    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Bin not found</h2>
        {remoteLoadError ? <p style={styles.warningText}>{remoteLoadError}</p> : null}
        <button type="button" style={buttonLink} onClick={() => navigate("/admin")}>
          Back to Admin
        </button>
      </div>
    );
  }

  const shipment =
    (localBox && appData.getShipmentForBox?.(box.id)) ||
    remoteShipment ||
    (!localBox ? buildShipmentStubFromAdminRow(box) : null);

  const boxItems = localBox
    ? appData.items.filter((item) => item.box_id === box.id)
    : remoteItems;
  const binLabel = box.box_number || box.id;

  const customerEmailForRef = resolveCustomerEmailForBin({
    row: box,
    profileById: profileEmailForBox ? { [String(box.user_id)]: { email: profileEmailForBox } } : {},
    shipment,
  });

  const displayBinRef = buildDisplayBinRef({
    email: customerEmailForRef,
    boxNumber: box.box_number,
    boxId: box.id,
  });

  const shippingAddress = shipment?.shipping_address || {};
  const rawShippingCost = Number(
    shipment?.shipping_cost ||
      shipment?.shipping_estimate ||
      appData.DEFAULT_SHIPPING_COST ||
      18
  );
  const shippingCost = Number.isFinite(rawShippingCost) ? rawShippingCost : 0;

  const subscriptionEndDate = (() => {
    if (!box.subscription_ends_at) return "Not scheduled";
    const d = new Date(box.subscription_ends_at);
    if (Number.isNaN(d.getTime())) return "Not scheduled";
    return d.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  })();

  const assignmentStatus = String(currentAssignment?.status || "");
  const isStarterKitFlow =
    box.fulfillment_status === "paid_waiting_to_ship_bin" &&
    shipment?.shipment_direction === "to_customer";
  const isWarehouseOutbound =
    shipment?.shipment_direction === "to_customer" &&
    box.status === "stored" &&
    box.fulfillment_status !== "paid_waiting_to_ship_bin";

  const isLabelStillNeeded =
    shipment &&
    shipment.charge_status === "paid" &&
    shipment.shipping_status === "paid" &&
    (shipment.label_status === "needed" ||
      shipment.label_status === "label_needed" ||
      shipment.label_status === "purchase_failed" ||
      !shipment.label_status);

  const opsAllowed =
    box.lifecycle_status !== "auction" && box.lifecycle_status !== "removed_from_system";

  const isReturnLabelAutomationRetry =
    shipment?.shipment_direction === "to_storage" &&
    shipment?.label_status === "purchase_failed" &&
    isLabelStillNeeded;

  const canGenerateLabelForWorkflow =
    isReturnLabelAutomationRetry ||
    (isLabelStillNeeded &&
      shipment?.shipment_direction !== "to_storage" &&
      ((isStarterKitFlow && assignmentStatus === "qr_applied") ||
        (isWarehouseOutbound &&
          ["picked", "in_staging", "label_verified"].includes(assignmentStatus))));

  const canGenerateLabel = opsAllowed && canGenerateLabelForWorkflow;

  const canMarkInTransit =
    opsAllowed &&
    shipment &&
    ["label_created", "in_transit", "out_for_delivery", "exception"].includes(String(shipment.shipping_status || ""));

  const canMarkDelivered =
    opsAllowed &&
    shipment &&
    ["label_created", "in_transit", "out_for_delivery"].includes(String(shipment.shipping_status || ""));

  const canAdminRetryLabel =
    opsAllowed &&
    shipment &&
    (String(shipment.label_status || "") === "purchase_failed" || Boolean(shipment.label_failure_reason));

  const canSuppressRails = opsAllowed && shipment?.id;

  const nextAction = getNextAction({
    box,
    shipment,
    canGenerateLabel,
    assignmentStatus,
    assignmentLoading,
    isStarterKitFlow,
    isWarehouseOutbound,
  });

  return (
    <div>
      <div style={topBar}>
        <div>
          <h2 style={{ ...styles.sectionTitle, marginBottom: 4 }}>
            Admin · Bin {binLabel}
          </h2>
          <p style={styles.mutedText}>
            Worker view for warehouse, shipment, and inventory status.
          </p>
        </div>

        <div style={styles.row}>
          <Link to={`/bins/${box.id}`} style={buttonLink}>
            Customer View
          </Link>
          <button type="button" style={buttonLink} onClick={() => setStickerModalOpen(true)}>
            Print / Reprint QR sticker
          </button>
          <button type="button" style={buttonLink} onClick={() => navigate("/admin")}>
            Back to Admin
          </button>
        </div>
      </div>

      <section style={opsCard}>
        <div style={sectionTitleRow}>
          <div>
            <h3 style={compactHeading}>Next Action</h3>
            <p style={styles.mutedText}>{nextAction.message}</p>
          </div>

          <div style={styles.row}>
            {canGenerateLabel && (
              <button
                style={styles.primaryButton}
                type="button"
                onClick={() => appData.generateLabel?.(shipment, box)}
              >
                Create Carrier Label
              </button>
            )}

            {!canGenerateLabel && !canMarkInTransit && !canMarkDelivered && (
              <span style={quietBadge}>{nextAction.badge}</span>
            )}
          </div>
        </div>
      </section>

      <section style={opsCard}>
        <h3 style={compactHeading}>Bin Status</h3>

        <div style={infoGrid}>
          <InfoRow label="Bin number" value={binLabel} />
          <InfoRow
            label="Database ID"
            value={String(resolvedBoxId || box.id || "—")}
            wide
          />
          <InfoRow label="Physical location" value={box.status || "unknown"} />
          <InfoRow label="Fulfillment step" value={box.fulfillment_status || "pending"} />
          <InfoRow label="Checkout" value={box.checkout_status || "unknown"} />
          <InfoRow label="Cancellation" value={box.cancel_status || "none"} />
          <InfoRow label="Lifecycle" value={box.lifecycle_status || "active"} />
          <InfoRow
            label="Home bay"
            value={
              currentAssignment?.bay_code
                ? (() => {
                    const line = formatHomeBayLine(currentAssignment, box);
                    return line
                      ? `${line.primary}${line.secondary ? ` — ${line.secondary}` : ""}`
                      : `Home bay: ${currentAssignment.bay_code}`;
                  })()
                : "No home bay assigned"
            }
          />
          <InfoRow label="Customer" value={box.customer_email || box.user_email || box.user_id || "unknown"} />
          <InfoRow label="Subscription end" value={subscriptionEndDate} />
        </div>
      </section>

      <section style={opsCard}>
        <h3 style={compactHeading}>Shipment</h3>

        {!shipment ? (
          <div style={emptyState}>
            <strong>No shipment yet</strong>
            <p style={styles.smallText}>
              A label can only be generated after a shipment row exists.
            </p>
          </div>
        ) : (
          <>
            {shipment.shipping_status === "exception" && (
              <p style={{ ...styles.warningText, marginBottom: 12 }}>
                <strong>FedEx carrier exception</strong> on this shipment. Bin fulfillment is set to{" "}
                <strong>Shipment Carrier Exception</strong> for admin attention; physical{" "}
                <code>boxes.status</code> is unchanged. Resolve with FedEx or use overrides when appropriate.
              </p>
            )}
            <div style={infoGrid}>
              <InfoRow label="Direction" value={shipment.shipment_direction || "not set"} />
              <InfoRow label="Shipping status" value={shipment.shipping_status || "not started"} />
              <InfoRow label="Charge status" value={shipment.charge_status || "not started"} />
              <InfoRow label="Label status" value={shipment.label_status || "not created"} />
              <InfoRow label="Carrier" value={shipment.carrier || "not assigned"} />
              <InfoRow label="Tracking" value={shipment.tracking_number || "not assigned"} />
              <InfoRow
                label="Last tracking poll"
                value={
                  shipment.last_tracking_poll_at
                    ? new Date(shipment.last_tracking_poll_at).toLocaleString()
                    : "never"
                }
              />
              <InfoRow
                label="Carrier detail"
                value={shipment.carrier_tracking_last_detail || "—"}
                wide
              />
              <InfoRow label="Shipping cost" value={`$${shippingCost.toFixed(2)}`} />
              <InfoRow label="Address" value={formatAddress(shippingAddress)} wide />
            </div>

            <div style={{ ...styles.row, marginTop: 12, flexWrap: "wrap", gap: 8 }}>
              {canAdminRetryLabel && (
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => appData.adminRetryLabelPurchase?.(shipment)}
                >
                  Retry label purchase
                </button>
              )}
              {canMarkInTransit && (
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => appData.markShipmentInTransit?.(shipment)}
                >
                  Mark in transit (override)
                </button>
              )}
              {canMarkDelivered && (
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => appData.markShipmentDelivered?.(shipment)}
                >
                  Mark delivered / stored (override)
                </button>
              )}
              {canSuppressRails && (
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => appData.suppressRailAlertsForShipment?.(shipment, 168)}
                >
                  Silence beta rail emails (7d)
                </button>
              )}
            </div>

            {(shipment.label_url || shipment.tracking_url) && (
              <div style={{ ...styles.row, marginTop: 14 }}>
                {shipment.label_url && (
                  <a href={shipment.label_url} target="_blank" rel="noreferrer">
                    View Label
                  </a>
                )}

                {shipment.tracking_url && (
                  <a href={shipment.tracking_url} target="_blank" rel="noreferrer">
                    Track Shipment
                  </a>
                )}
              </div>
            )}

            {shipment.charge_failure_reason && (
              <p style={styles.warningText}>
                Charge failure: {shipment.charge_failure_reason}
              </p>
            )}

            {shipment.label_failure_reason && (
              <p style={styles.warningText}>
                Label purchase: {shipment.label_failure_reason}
              </p>
            )}
          </>
        )}
      </section>

      <section style={opsCard}>
        <details>
          <summary style={summaryStyle}>Manager Overrides</summary>
          <div style={{ marginTop: 12 }}>
            <p style={styles.smallText}>
              Use only for manager-approved corrections (status, storage, cancellation edge cases).
            </p>
            <OperationsControls
              boxId={box.id}
              onUpdateFulfillmentStatus={appData.updateFulfillmentStatus}
            />
          </div>
        </details>
      </section>

      {(box.cancel_status === "requested" || box.cancel_status === "approved") && (
        <section style={opsCard}>
          <h3 style={compactHeading}>Cancellation</h3>

          <div style={infoGrid}>
            <InfoRow label="Status" value={box.cancel_status} />
            <InfoRow label="Scheduled end" value={subscriptionEndDate} />
          </div>

          <div style={{ ...styles.row, marginTop: 14 }}>
            <button
              style={styles.secondaryButton}
              onClick={() => appData.overrideCancellationEndDate(box.id)}
            >
              Override End Date
            </button>
          </div>
        </section>
      )}

      {stickerModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Print bin QR sticker"
          style={stickerModalBackdrop}
          onClick={() => setStickerModalOpen(false)}
        >
          <div style={stickerModalCard} onClick={(e) => e.stopPropagation()}>
            <div style={stickerModalHeaderRow}>
              <h3 style={{ ...compactHeading, margin: 0 }}>Print bin QR sticker</h3>
              <button type="button" style={buttonLink} onClick={() => setStickerModalOpen(false)}>
                Close
              </button>
            </div>
            <p style={{ ...styles.smallText, marginTop: 8 }}>
              3.5×4 in layout — use your browser print dialog. Disable headers/footers for best results.
            </p>
            <div className="admin-bin-qr-sticker-print-target">
              <BinQrStickerSheet boxId={box.id} displayBinRef={displayBinRef} />
            </div>
            <div className="admin-sticker-modal-actions" style={{ ...styles.row, marginTop: 14, flexWrap: "wrap" }}>
              <button
                type="button"
                style={styles.primaryButton}
                onClick={() => {
                  const style = document.createElement("style");
                  style.setAttribute("data-admin-sticker-print", "1");
                  style.textContent = `
                    @media print {
                      body * { visibility: hidden !important; }
                      .admin-bin-qr-sticker-print-target,
                      .admin-bin-qr-sticker-print-target * { visibility: visible !important; }
                      .admin-bin-qr-sticker-print-target { position: absolute; left: 0; top: 0; width: 100%; }
                      .admin-sticker-modal-actions { display: none !important; }
                    }
                  `;
                  document.head.appendChild(style);
                  requestAnimationFrame(() => {
                    window.print();
                    requestAnimationFrame(() => {
                      document.querySelectorAll("style[data-admin-sticker-print]").forEach((el) => el.remove());
                    });
                  });
                }}
              >
                Print…
              </button>
              <button type="button" style={styles.secondaryButton} onClick={() => setStickerModalOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <section style={opsCard}>
        <h3 style={compactHeading}>Inventory</h3>

        {boxItems.length === 0 ? (
          <p style={styles.mutedText}>No inventory items.</p>
        ) : (
          <div style={compactTable}>
            {boxItems.map((item) => (
              <div key={item.id} style={tableRow}>
                <div>
                  <strong>{item.name}</strong>
                  <p style={styles.smallText}>
                    {item.description || "No description"}
                  </p>
                </div>

                <div style={rightAligned}>
                  <span style={quietBadge}>{item.status || "packed"}</span>
                  {item.image_url && (
                    <a href={item.image_url} target="_blank" rel="noreferrer">
                      Image
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InfoRow({ label, value, wide = false }) {
  return (
    <div style={wide ? wideInfoRow : infoRow}>
      <span style={infoLabel}>{label}</span>
      <span style={infoValue}>{value}</span>
    </div>
  );
}

function getNextAction({
  box,
  shipment,
  canGenerateLabel,
  assignmentStatus,
  assignmentLoading,
  isStarterKitFlow,
  isWarehouseOutbound,
}) {
  if (assignmentLoading) {
    return {
      badge: "Loading",
      message: "Loading storage assignment state to determine the next workflow action.",
    };
  }

  if (box.lifecycle_status === "auction") {
    return {
      badge: "Auction",
      message: "This bin is flagged for auction handling. Do not ship without manager review.",
    };
  }

  if (box.lifecycle_status === "removed_from_system") {
    return {
      badge: "Removed",
      message:
        "This bin is marked removed from the system. Do not run normal warehouse or shipment prep without manager approval.",
    };
  }

  if (!shipment) {
    return {
      badge: "No shipment",
      message: "No shipment exists yet. No warehouse shipping action is available.",
    };
  }

  if (shipment.charge_status === "failed") {
    return {
      badge: "Payment failed",
      message: "Shipping payment failed. Wait for customer payment before shipping.",
    };
  }

  if (isStarterKitFlow) {
    if (assignmentStatus === "assigned") {
      return {
        badge: "Prep bin",
        message: "Apply the bin QR code first, then continue to label generation.",
      };
    }
    if (assignmentStatus === "qr_applied" && shipment.shipping_status === "label_created") {
      return {
        badge: "Match label QR",
        message:
          "Carrier label exists. Attach the shipping sticker, then scan the label QR to confirm it matches this bin.",
      };
    }
    if (assignmentStatus === "outbound_labeled" || assignmentStatus === "label_verified") {
      return {
        badge: "Await carrier scan",
        message: "Label is matched and recorded. FedEx tracking should move this shipment automatically.",
      };
    }
  }

  if (isWarehouseOutbound) {
    if (assignmentStatus === "placed") {
      return {
        badge: "Pick required",
        message: "Pick this bin from its bay before continuing shipment prep.",
      };
    }
    if (assignmentStatus === "picked") {
      return {
        badge: "Stage bin",
        message: "Move the picked bin to staging before label verification.",
      };
    }
    if (assignmentStatus === "in_staging") {
      return {
        badge: "Match label QR",
        message:
          "When the carrier label is printed, scan the shipping label QR to confirm it matches this bin (same step as attaching the label).",
      };
    }
  }

  if (shipment.shipment_direction === "to_storage" && shipment.shipping_status === "paid") {
    return {
      badge: "Await customer dropoff",
      message: "Return label should be auto-sent after payment. Wait for carrier movement updates.",
    };
  }

  if (canGenerateLabel) {
    return {
      badge: "Needs label",
      message: "Create the carrier shipping label when prep allows it.",
    };
  }

  if (shipment.shipping_status === "delivered") {
    return {
      badge: "Complete",
      message: "Shipment is delivered. No shipment action is needed.",
    };
  }

  if (shipment.shipping_status === "label_created") {
    return {
      badge: "Await carrier scan",
      message: "Label exists. FedEx tracking should move this shipment to in transit automatically.",
    };
  }

  if (shipment.shipping_status === "in_transit") {
    return {
      badge: "In transit",
      message: "Shipment is in transit. FedEx status should update delivered automatically.",
    };
  }

  return {
    badge: "No action",
    message: "No shipment action is currently available for this state.",
  };
}

function formatAddress(address) {
  if (!address) return "No address saved";

  return [
    address.full_name,
    address.address_line1,
    address.address_line2,
    [address.city, address.state, address.zip].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(", ") || "No address saved";
}

const stickerModalBackdrop = {
  position: "fixed",
  inset: 0,
  zIndex: 10040,
  backgroundColor: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "24px 16px",
  overflowY: "auto",
};

const stickerModalCard = {
  backgroundColor: "#FFFFFF",
  borderRadius: "12px",
  padding: "20px",
  maxWidth: "520px",
  width: "100%",
  boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
};

const stickerModalHeaderRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
};

const topBar = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "16px",
  marginBottom: "16px",
};

const opsCard = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #E5E5E5",
  borderRadius: "8px",
  padding: "18px",
  marginBottom: "14px",
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
};

const sectionTitleRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "16px",
};

const compactHeading = {
  margin: "0 0 8px 0",
  fontSize: "18px",
  fontWeight: 600,
  color: "#333333",
};

const infoGrid = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "0",
  borderTop: "1px solid #E5E5E5",
  marginTop: "10px",
};

const infoRow = {
  display: "grid",
  gridTemplateColumns: "160px 1fr",
  gap: "12px",
  padding: "10px 0",
  borderBottom: "1px solid #E5E5E5",
};

const wideInfoRow = {
  display: "grid",
  gridTemplateColumns: "160px 1fr",
  gap: "12px",
  padding: "10px 0",
  borderBottom: "1px solid #E5E5E5",
  gridColumn: "1 / -1",
};

const infoLabel = {
  color: "#555555",
  fontSize: "13px",
};

const infoValue = {
  color: "#333333",
  fontSize: "14px",
  fontWeight: 600,
  wordBreak: "break-word",
};

const buttonLink = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#E5E5E5",
  color: "#333333",
  textDecoration: "none",
  border: "none",
  padding: "10px 14px",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: 500,
  font: "inherit",
};

const quietBadge = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: "999px",
  padding: "5px 9px",
  fontSize: "12px",
  fontWeight: 600,
  color: "#555555",
  backgroundColor: "#F7F7F7",
  border: "1px solid #E5E5E5",
};

const summaryStyle = {
  cursor: "pointer",
  fontWeight: 600,
  color: "#333333",
};

const emptyState = {
  borderTop: "1px solid #E5E5E5",
  marginTop: "10px",
  paddingTop: "12px",
};

const compactTable = {
  borderTop: "1px solid #E5E5E5",
  marginTop: "10px",
};

const tableRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "16px",
  padding: "12px 0",
  borderBottom: "1px solid #E5E5E5",
};

const rightAligned = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
};

export default AdminBoxDetailPage;
