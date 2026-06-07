import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import styles from "../styles/styles";
import BoxCardWithData from "./BoxCardWithData";

function BoxesPage({ appData }) {
  const location = useLocation();
  const visibleBoxes = (appData.boxes || []).filter(
    (box) =>
      box.checkout_status === "paid" &&
      box.lifecycle_status !== "removed_from_system"
  );

  useEffect(() => {
    if (!appData.user?.id || typeof appData.refreshAppData !== "function") return;
    void appData.refreshAppData();
  }, [appData.user?.id, appData.refreshAppData, location.key]);

  return (
    <div>
      <h2 style={styles.sectionTitle}>My Bins</h2>

      {appData.boxesLoading ? (
        <div style={styles.panel}>
          <p style={styles.mutedText}>Loading your bins…</p>
        </div>
      ) : visibleBoxes.length === 0 ? (
        <div style={styles.panel}>
          <p style={styles.mutedText}>No bins yet. Create a draft bin from the Dashboard.</p>
        </div>
      ) : (
        visibleBoxes.map((box) => <BoxCardWithData key={box.id} appData={appData} box={box} />)
      )}
    </div>
  );
}

export default BoxesPage;
