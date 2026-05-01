const colors = {
  primary: "#8FAF8F",
  primaryDark: "#7A9D7A",
  charcoal: "#333333",
  gray: "#555555",
  lightGray: "#E5E5E5",
  background: "#F7F7F7",
  white: "#FFFFFF",
  accent: "#D88C7A",
};

const styles = {
  page: {
    backgroundColor: colors.background,
    minHeight: "100vh",
    padding: "24px",
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    color: colors.charcoal,
  },

  shell: {
    maxWidth: "1100px",
    margin: "0 auto",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "24px",
  },

  title: {
    color: colors.charcoal,
    fontSize: "32px",
    fontWeight: 600,
    margin: 0,
  },

  subtitle: {
    color: colors.gray,
    fontSize: "14px",
    marginTop: "4px",
  },

  sectionTitle: {
    color: colors.charcoal,
    fontSize: "22px",
    fontWeight: 600,
    marginBottom: "8px",
  },

  mutedText: {
    color: colors.gray,
    fontSize: "14px",
  },

  smallText: {
    color: colors.gray,
    fontSize: "13px",
  },

  successText: {
    color: colors.primaryDark,
    fontSize: "14px",
    fontWeight: 500,
  },

  warningText: {
    color: colors.accent,
    fontSize: "14px",
    fontWeight: 500,
  },

  boxCard: {
    backgroundColor: colors.white,
    borderRadius: "12px",
    padding: "20px",
    marginBottom: "16px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
  },

  boxHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
  },

  boxTitle: {
    color: colors.charcoal,
    margin: 0,
    fontSize: "18px",
    fontWeight: 600,
  },

  cartCard: {
    backgroundColor: colors.white,
    borderRadius: "12px",
    padding: "20px",
    marginBottom: "20px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
  },

  cartItem: {
    backgroundColor: colors.background,
    borderRadius: "10px",
    padding: "16px",
    border: `1px solid ${colors.lightGray}`,
  },

  panel: {
    backgroundColor: colors.background,
    borderRadius: "10px",
    padding: "16px",
    marginTop: "12px",
    border: `1px solid ${colors.lightGray}`,
  },

  subPanel: {
    backgroundColor: colors.white,
    borderRadius: "10px",
    padding: "16px",
    marginTop: "12px",
    border: `1px solid ${colors.lightGray}`,
  },

  row: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },

  input: {
    width: "100%",
    padding: "10px",
    borderRadius: "8px",
    border: `1px solid ${colors.lightGray}`,
    marginBottom: "10px",
    fontSize: "14px",
  },

  primaryButton: {
    backgroundColor: colors.primary,
    color: colors.white,
    border: "none",
    padding: "10px 14px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 500,
  },

  secondaryButton: {
    backgroundColor: colors.lightGray,
    color: colors.charcoal,
    border: "none",
    padding: "10px 14px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 500,
  },

  warningButton: {
    backgroundColor: colors.accent,
    color: colors.white,
    border: "none",
    padding: "10px 14px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 500,
  },

  dangerButton: {
    backgroundColor: "#b00020",
    color: colors.white,
    border: "none",
    padding: "10px 14px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 500,
  },

  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },

  modalContent: {
    backgroundColor: colors.white,
    padding: "24px",
    borderRadius: "12px",
    width: "100%",
    maxWidth: "460px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
  },

  navBar: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginBottom: "24px",
    padding: "8px",
    backgroundColor: colors.white,
    borderRadius: "12px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  },

  navLink: {
    color: colors.gray,
    textDecoration: "none",
    padding: "10px 12px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
  },

  navLinkActive: {
    color: colors.white,
    backgroundColor: colors.primary,
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "12px",
    marginBottom: "20px",
  },

  summaryCard: {
    backgroundColor: colors.white,
    borderRadius: "12px",
    padding: "16px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  },

  metric: {
    color: colors.charcoal,
    fontSize: "30px",
    fontWeight: 600,
    margin: "4px 0 0",
  },

  linkButton: {
    display: "inline-block",
    marginTop: "12px",
    backgroundColor: colors.primary,
    color: colors.white,
    textDecoration: "none",
    padding: "10px 14px",
    borderRadius: "8px",
    fontWeight: 500,
  },

  linkButtonSecondary: {
    display: "inline-block",
    backgroundColor: colors.lightGray,
    color: colors.charcoal,
    textDecoration: "none",
    padding: "10px 14px",
    borderRadius: "8px",
    fontWeight: 500,
  },

  pageHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    alignItems: "flex-start",
    marginBottom: "16px",
  },

  listRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    padding: "12px 0",
    borderBottom: `1px solid ${colors.lightGray}`,
  },
};

export default styles;
