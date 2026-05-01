import styles from "../styles/styles";

function AccountPage({ appData }) {
  return (
    <div style={styles.panel}>
      <h2 style={styles.sectionTitle}>Account</h2>
      <p style={styles.mutedText}>Logged in as {appData.user.email}</p>
      <p style={styles.smallText}>
        Profile address and payment method management will live here when we wire Stripe and saved addresses.
      </p>
    </div>
  );
}

export default AccountPage;
