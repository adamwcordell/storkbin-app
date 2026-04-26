import styles from "../styles/styles";

function AuthCard({ email, password, onEmailChange, onPasswordChange, onSignUp, onLogIn }) {
  return (
    <div style={styles.authCard}>
      <h1 style={styles.title}>StorkBin</h1>
      <p style={styles.subtitle}>Log in or create your account.</p>

      <input
        style={styles.input}
        placeholder="Email"
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
      />

      <input
        style={styles.input}
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
      />

      <div style={styles.row}>
        <button style={styles.primaryButton} onClick={onSignUp}>
          Sign Up
        </button>
        <button style={styles.secondaryButton} onClick={onLogIn}>
          Log In
        </button>
      </div>
    </div>
  );
}

export default AuthCard;
