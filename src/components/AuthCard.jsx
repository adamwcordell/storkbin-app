import styles from "../styles/styles";
import StorkBinLogo from "./StorkBinLogo";

function AuthCard({
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSignUp,
  onLogIn,
  onForgotPassword,
  errorMessage,
  successMessage,
}) {
  const emailTrimmed = String(email || "").trim();
  const canRequestReset = Boolean(emailTrimmed);

  return (
    <form
      style={styles.authCard}
      onSubmit={(event) => {
        event.preventDefault();
        onLogIn();
      }}
    >
      <div style={{ marginBottom: "20px", display: "flex", justifyContent: "center" }}>
        <StorkBinLogo to="/" showTagline variant="authPanel" />
      </div>
      <p style={styles.subtitle}>Log in or create your account.</p>

      {errorMessage ? (
        <div style={inlineErrorBox} role="alert">
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div style={inlineSuccessBox} role="status">
          {successMessage}
        </div>
      ) : null}

      <input
        style={styles.input}
        placeholder="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
      />

      <input
        style={styles.input}
        placeholder="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onLogIn();
          }
        }}
      />

      <div style={styles.row}>
        <button style={styles.primaryButton} type="button" onClick={onSignUp}>
          Sign Up
        </button>
        <button style={styles.secondaryButton} type="submit">
          Log In
        </button>
      </div>

      <div style={styles.row}>
        <button
          type="button"
          style={{
            ...forgotPasswordButtonStyle,
            opacity: canRequestReset ? 1 : 0.45,
            cursor: canRequestReset ? "pointer" : "not-allowed",
          }}
          onClick={onForgotPassword}
          disabled={!canRequestReset}
          title={
            canRequestReset
              ? "Send a password reset link to this email"
              : "Enter your email above, then click Forgot password"
          }
        >
          Forgot password?
        </button>
      </div>
      <p style={styles.smallText}>
        {canRequestReset
          ? "We’ll email you a reset link."
          : "Enter your email first to use password reset."}
      </p>
      <p style={styles.smallText}>No username login — your username is your email.</p>
    </form>
  );
}

const inlineErrorBox = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: "8px",
  backgroundColor: "#FFF5F5",
  border: "1px solid #E8B4B4",
  color: "#7A1F1F",
  fontSize: "13px",
  lineHeight: 1.4,
  marginBottom: "10px",
};

const inlineSuccessBox = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: "8px",
  backgroundColor: "#F0FAF2",
  border: "1px solid #B8D4BE",
  color: "#1E4620",
  fontSize: "13px",
  lineHeight: 1.4,
  marginBottom: "10px",
};

const forgotPasswordButtonStyle = {
  background: "none",
  border: "none",
  color: "#7A9D7A",
  fontWeight: 600,
  padding: 0,
};

export default AuthCard;
