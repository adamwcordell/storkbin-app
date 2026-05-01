import styles from "../styles/styles";
import BoxCardWithData from "./BoxCardWithData";

function BoxesPage({ appData }) {
  return (
    <div>
      <h2 style={styles.sectionTitle}>My Bins</h2>

      {appData.boxes.length === 0 ? (
        <div style={styles.panel}>
          <p style={styles.mutedText}>No bins yet. Create a draft bin from the Dashboard.</p>
        </div>
      ) : (
        appData.boxes.map((box) => <BoxCardWithData key={box.id} appData={appData} box={box} />)
      )}
    </div>
  );
}

export default BoxesPage;
