import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
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
  const [trackingQrDataUrl, setTrackingQrDataUrl] = useState("");
  const [meta, setMeta] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!tracking) {
      setTrackingQrDataUrl("");
      return undefined;
    }
    let cancelled = false;
    QRCode.toDataURL(tracking, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#111111", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setTrackingQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setTrackingQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [tracking]);

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
      } else if (/^https?:\/\//i.test(url) && !/\/labels\//i.test(url)) {
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
    return "Shipping label";
  }, [meta?.shipment_direction]);

  const pageTitle = labelDataUrl ? "Shipping label" : "Mock shipping label";

  if (!tracking) {
    return (
      <div style={styles.panel}>
        <p style={styles.warningText}>Missing tracking reference.</p>
      </div>
    );
  }

  return (
    <div className="mock-label-page" style={{ maxWidth: 720, margin: "0 auto", padding: "20px 16px 40px" }}>
      <style>{`
        @media print {
          .mock-label-page-toolbar { display: none !important; }
          .mock-label-screen-hint { display: none !important; }
          .mock-label-print-area { border: 2px solid #111 !important; }
        }
      `}</style>
      <div
        className="mock-label-page-toolbar"
        style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}
      >
        <div>
          <h1 style={{ ...styles.sectionTitle, margin: 0 }}>{pageTitle}</h1>
          <p style={styles.mutedText}>
            {labelDataUrl
              ? "Print this label, then match the tracking barcode on the bin scan page."
              : "Beta test label — not valid for FedEx drop-off."}
          </p>
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
              margin: "0 0 16px",
              fontSize: "clamp(1.25rem, 5vw, 1.85rem)",
              fontWeight: 800,
              fontFamily: "ui-monospace, Consolas, monospace",
              letterSpacing: "0.06em",
              wordBreak: "break-all",
            }}
          >
            {tracking}
          </p>

          <p style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 700, color: colors.charcoal }}>
            Scan this QR in Match Shipping Label (step 2)
          </p>
          {trackingQrDataUrl ? (
            <img
              src={trackingQrDataUrl}
              alt={`Tracking QR ${tracking}`}
              width={200}
              height={200}
              style={{ display: "block", width: 200, height: 200, border: "1px solid #ddd" }}
            />
          ) : (
            <p style={styles.mutedText}>Generating scannable QR…</p>
          )}
          <p style={{ margin: "10px 0 0", fontSize: 11, color: colors.gray }}>
            QR encodes tracking only: <span style={{ fontFamily: "monospace" }}>{tracking}</span>
          </p>

          {meta?.shipping_address?.storkbin_display_refs?.length ? (
            <p style={{ margin: "18px 0 0", fontSize: 14 }}>
              Bins: {meta.shipping_address.storkbin_display_refs.join(", ")}
            </p>
          ) : null}

          <p
            className="mock-label-screen-hint"
            style={{ margin: "24px 0 0", fontSize: 13, lineHeight: 1.5, color: colors.gray }}
          >
            On Admin: <strong>Match Shipping Label (QR)</strong> → scan bin QR, then scan the QR above (or paste{" "}
            <code>{tracking}</code> manually).
          </p>
        </section>
      )}
    </div>
  );
}
