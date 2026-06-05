import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import styles, { colors } from "../styles/styles";

/**
 * Printable mock FedEx-style label for beta testing.
 * Match Shipping Label scans the tracking number (barcode mode), not this page URL.
 */
export default function MockShippingLabelPage({ appData }) {
  const { trackingRef } = useParams();
  const tracking = decodeURIComponent(String(trackingRef || "").trim());
  const [labelDataUrl, setLabelDataUrl] = useState("");
  const [meta, setMeta] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!tracking) return;

    let cancelled = false;
    (async () => {
      setLoadError("");
      const { data, error } = await supabase
        .from("shipments")
        .select("id, tracking_number, label_url, shipment_direction, shipping_address, label_status")
        .eq("tracking_number", tracking)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        return;
      }
      if (!data) return;

      setMeta(data);
      const url = String(data.label_url || "").trim();
      if (url.startsWith("data:")) {
        setLabelDataUrl(url);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tracking]);

  const directionLabel = useMemo(() => {
    if (meta?.shipment_direction === "to_storage") return "Return to warehouse";
    if (meta?.shipment_direction === "to_customer") return "Outbound to customer";
    return "Shipping test label";
  }, [meta?.shipment_direction]);

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
          <h1 style={{ ...styles.sectionTitle, margin: 0 }}>Mock shipping label</h1>
          <p style={styles.mutedText}>Beta test label — not valid for FedEx drop-off.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={styles.primaryButton} onClick={() => window.print()}>
            Print
          </button>
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
      </div>

      {loadError ? <p style={styles.warningText}>{loadError}</p> : null}

      {labelDataUrl ? (
        <iframe
          title={`Label ${tracking}`}
          src={labelDataUrl}
          style={{ width: "100%", minHeight: 640, border: "1px solid #ddd", borderRadius: 8 }}
        />
      ) : (
        <section
          className="mock-label-print-area"
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
              background: "#c62828",
              color: "#fff",
              padding: "10px 14px",
              fontWeight: 800,
              fontSize: 15,
              margin: "-24px -24px 20px",
              letterSpacing: "0.04em",
            }}
          >
            TEST — NOT VALID FOR SHIPPING
          </div>

          <p style={{ margin: "0 0 6px", fontSize: 13, color: colors.gray, textTransform: "uppercase" }}>
            StorkBin mock label
          </p>
          <p style={{ margin: "0 0 18px", fontSize: 14, color: colors.charcoal }}>{directionLabel}</p>

          <p style={{ margin: "0 0 8px", fontSize: 12, color: colors.gray }}>Tracking / barcode value</p>
          <p
            style={{
              margin: 0,
              fontSize: "clamp(1.5rem, 6vw, 2.25rem)",
              fontWeight: 800,
              fontFamily: "ui-monospace, Consolas, monospace",
              letterSpacing: "0.06em",
              wordBreak: "break-all",
            }}
          >
            {tracking}
          </p>

          {meta?.shipping_address?.storkbin_display_refs?.length ? (
            <p style={{ margin: "18px 0 0", fontSize: 14 }}>
              Bins: {meta.shipping_address.storkbin_display_refs.join(", ")}
            </p>
          ) : null}

          <p style={{ margin: "24px 0 0", fontSize: 13, lineHeight: 1.5, color: colors.gray }}>
            On Admin, use <strong>Match Shipping Label (QR)</strong>: scan the bin QR, then scan this tracking number
            (FedEx barcode mode). You can paste <code>{tracking}</code> in the manual field if needed.
          </p>
        </section>
      )}
    </div>
  );
}
