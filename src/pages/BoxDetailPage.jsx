import { Link, useParams, useSearchParams } from "react-router-dom";
import styles from "../styles/styles";
import BoxCardWithData from "./BoxCardWithData";

function BoxDetailPage({ appData }) {
  const { boxId } = useParams();
  const [searchParams] = useSearchParams();
  const openedFromQrScan = searchParams.get("from_scan") === "1";
  const box = appData.boxes.find((currentBox) => String(currentBox.id) === String(boxId));

  if (!box) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Bin not found</h2>
        <p style={styles.mutedText}>This bin may not exist or may not belong to your account.</p>
        <Link to="/bins">Back to My Bins</Link>
      </div>
    );
  }

  return (
    <div>
      <div style={styles.pageHeaderRow}>
        <div>
          <h2 style={styles.sectionTitle}>Bin {box.box_number || box.id}</h2>
          <p style={styles.mutedText}>
            {openedFromQrScan
              ? "From your bin QR — inventory and return shipping."
              : "Inventory, shipment actions, and subscription controls."}
          </p>
        </div>
        <Link style={styles.linkButtonSecondary} to={openedFromQrScan ? "/dashboard" : "/bins"}>
          {openedFromQrScan ? "App home" : "Back to My Bins"}
        </Link>
      </div>

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
