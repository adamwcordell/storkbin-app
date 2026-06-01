import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import styles from "../styles/styles";
import BoxCardWithData from "./BoxCardWithData";

function BoxDetailPage({ appData }) {
  const location = useLocation();
  const { boxId } = useParams();
  const [searchParams] = useSearchParams();
  const openedFromQrScan = searchParams.get("from_scan") === "1";
  const box = appData.boxes.find((currentBox) => String(currentBox.id) === String(boxId));
  const [binLoadDone, setBinLoadDone] = useState(false);

  useEffect(() => {
    if (!appData.user?.id || typeof appData.refreshAppData !== "function") return undefined;
    let cancelled = false;
    setBinLoadDone(false);
    void appData.refreshAppData().finally(() => {
      if (!cancelled) setBinLoadDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [appData.user?.id, appData.refreshAppData, location.key, boxId]);

  if (!box) {
    if (openedFromQrScan && !binLoadDone) {
      return (
        <div style={styles.panel} className="scan-bin-page">
          <h2 style={styles.sectionTitle}>Opening your bin…</h2>
          <p style={styles.mutedText}>Loading inventory.</p>
        </div>
      );
    }
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Bin not found</h2>
        <p style={styles.mutedText}>This bin may not exist or may not belong to your account.</p>
        <Link to="/bins">Back to My Bins</Link>
      </div>
    );
  }

  return (
    <div className={openedFromQrScan ? "scan-bin-page" : undefined}>
      {openedFromQrScan ? (
        <div style={{ marginBottom: "16px", textAlign: "left" }}>
          <h2 style={{ ...styles.sectionTitle, marginBottom: "4px" }}>
            {box.customer_bin_name?.trim() || `Bin ${box.box_number || box.id}`}
          </h2>
          <p style={{ ...styles.mutedText, margin: 0 }}>
            Bin {box.box_number || box.id} — add inventory, then send back when ready.
          </p>
        </div>
      ) : (
        <div style={styles.pageHeaderRow} className="page-header-row">
          <div>
            <h2 style={styles.sectionTitle}>Bin {box.box_number || box.id}</h2>
            <p style={styles.mutedText}>Inventory, shipment actions, and subscription controls.</p>
          </div>
          <Link style={styles.linkButtonSecondary} to="/bins">
            Back to My Bins
          </Link>
        </div>
      )}

      <BoxCardWithData
        appData={appData}
        box={box}
        navigateToCartAfterShippingPrep={openedFromQrScan}
        scanMinimalUi={openedFromQrScan}
      />
    </div>
  );
}

export default BoxDetailPage;
