import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import styles, { colors } from "../styles/styles";

const STATUS_LABELS = {
  pending_payment: "Awaiting payment",
  paid: "Paid — label pending",
  label_created: "Label created",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  exception: "Exception",
  cancelled: "Cancelled",
};

export default function MockShipmentTrackPage({ appData }) {
  const { trackingRef } = useParams();
  const tracking = decodeURIComponent(String(trackingRef || "").trim());
  const [meta, setMeta] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!tracking) return undefined;

    let cancelled = false;
    (async () => {
      setLoadError("");
      const { data, error } = await supabase
        .from("shipments")
        .select(
          "id, tracking_number, tracking_url, label_url, shipment_direction, shipping_status, label_status, carrier_tracking_last_detail, updated_at"
        )
        .eq("tracking_number", tracking)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        return;
      }
      setMeta(data || null);
    })();

    return () => {
      cancelled = true;
    };
  }, [tracking]);

  const directionLabel = useMemo(() => {
    if (meta?.shipment_direction === "to_storage") return "Return to warehouse";
    if (meta?.shipment_direction === "to_customer") return "Outbound to customer";
    return "Shipment";
  }, [meta?.shipment_direction]);

  const statusLabel = useMemo(() => {
    const key = String(meta?.shipping_status || "").trim();
    return STATUS_LABELS[key] || (key ? key.replace(/_/g, " ") : "Unknown");
  }, [meta?.shipping_status]);

  if (!tracking) {
    return (
      <div style={styles.panel}>
        <p style={styles.warningText}>Missing tracking reference.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 16px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ ...styles.sectionTitle, margin: 0 }}>Shipment tracking</h1>
          <p style={styles.mutedText}>Beta mock tracking — not FedEx.com.</p>
        </div>
        {appData?.isAdmin ? (
          <Link to="/admin" style={styles.linkButtonSecondary}>
            Admin
          </Link>
        ) : (
          <Link to="/login" style={styles.linkButtonSecondary}>
            Log in
          </Link>
        )}
      </div>

      {loadError ? <p style={styles.warningText}>{loadError}</p> : null}

      <section
        style={{
          background: colors.white,
          border: "2px solid #111",
          borderRadius: 4,
          padding: 24,
          textAlign: "left",
        }}
      >
        <div
          style={{
            background: "#1565c0",
            color: "#fff",
            padding: "10px 14px",
            fontWeight: 800,
            fontSize: 15,
            margin: "-24px -24px 20px",
            letterSpacing: "0.04em",
          }}
        >
          STORKBIN MOCK TRACKING
        </div>

        <p style={{ margin: "0 0 6px", fontSize: 12, color: colors.gray }}>Tracking number</p>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: "clamp(1.25rem, 5vw, 1.85rem)",
            fontWeight: 800,
            fontFamily: "ui-monospace, Consolas, monospace",
            letterSpacing: "0.06em",
            wordBreak: "break-all",
          }}
        >
          {tracking}
        </p>

        <p style={{ margin: "0 0 6px", fontSize: 12, color: colors.gray }}>Direction</p>
        <p style={{ margin: "0 0 18px", fontSize: 15, color: colors.charcoal }}>{directionLabel}</p>

        <p style={{ margin: "0 0 6px", fontSize: 12, color: colors.gray }}>Status</p>
        <p style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: colors.charcoal }}>{statusLabel}</p>

        {meta?.carrier_tracking_last_detail ? (
          <p style={{ margin: "0 0 18px", fontSize: 13, color: colors.gray }}>{meta.carrier_tracking_last_detail}</p>
        ) : null}

        {!meta && !loadError ? (
          <p style={{ ...styles.mutedText, marginBottom: 18 }}>
            No shipment record found for this tracking number. Status may still update after label match.
          </p>
        ) : null}

        <p style={{ margin: 0, fontSize: 14 }}>
          <Link to={`/labels/${encodeURIComponent(tracking)}`}>View mock shipping label</Link>
        </p>
      </section>
    </div>
  );
}
