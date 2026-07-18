export const colors = {
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

  /** Sticky top chrome aligned with marketing `PublicSiteHeader` (sage / white / charcoal). */
  appStickyHeader: {
    position: "relative",
    top: "auto",
    zIndex: "auto",
    backgroundColor: colors.white,
    borderBottom: `1px solid ${colors.lightGray}`,
    boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
    marginBottom: "24px",
    borderRadius: "12px",
    overflow: "hidden",
    pointerEvents: "auto",
  },

  appStickyHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
    flexWrap: "wrap",
    padding: "14px 20px",
    minHeight: 112,
    pointerEvents: "auto",
  },

  appStickyNavRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    padding: "10px 20px 16px",
    borderTop: `1px solid ${colors.lightGray}`,
    backgroundColor: colors.white,
    pointerEvents: "auto",
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

  /** Customer dashboard bin cards — same shell as cart shipping lines (sage accent, clear sections). */
  boxCustomerBinCard: {
    backgroundColor: colors.white,
    borderRadius: "12px",
    marginBottom: "20px",
    border: `1px solid ${colors.lightGray}`,
    borderLeft: `5px solid ${colors.primaryDark}`,
    boxShadow: "0 3px 12px rgba(0,0,0,0.07)",
    overflow: "hidden",
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

  /** One ship/return row in the cart — strong edges so bins do not visually blend together. */
  cartShippingLineCard: {
    backgroundColor: colors.white,
    borderRadius: "12px",
    marginBottom: "22px",
    border: `1px solid ${colors.lightGray}`,
    borderLeft: `5px solid ${colors.primaryDark}`,
    boxShadow: "0 3px 12px rgba(0,0,0,0.07)",
    overflow: "hidden",
  },
  cartShippingBinBand: {
    backgroundColor: "rgba(143, 175, 143, 0.18)",
    padding: "14px 18px",
    borderBottom: `1px solid ${colors.lightGray}`,
  },
  cartShippingBinTitleLine: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 700,
    color: colors.charcoal,
    letterSpacing: "-0.02em",
    lineHeight: 1.3,
  },
  cartShippingBinNumber: {
    color: colors.primaryDark,
    fontWeight: 700,
  },
  cartShippingBinName: {
    fontWeight: 600,
    color: colors.charcoal,
  },
  cartShippingFlowLabel: {
    margin: "8px 0 0 0",
    fontSize: "13px",
    fontWeight: 600,
    color: colors.gray,
    lineHeight: 1.35,
  },
  cartShippingInner: {
    padding: "16px 18px 18px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    backgroundColor: colors.white,
  },
  cartShippingNote: {
    margin: 0,
    fontSize: "13px",
    color: colors.gray,
    lineHeight: 1.5,
  },
  cartShippingAddrBlock: {
    padding: "12px 14px",
    backgroundColor: colors.background,
    borderRadius: "10px",
    border: `1px solid ${colors.lightGray}`,
  },
  cartShippingAddrLabel: {
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: colors.primaryDark,
    marginBottom: "6px",
  },
  cartShippingAddrText: {
    fontSize: "14px",
    color: colors.charcoal,
    lineHeight: 1.45,
  },
  cartShippingFedexFrame: {
    border: `1px solid ${colors.lightGray}`,
    borderRadius: "10px",
    overflow: "hidden",
    backgroundColor: colors.white,
  },
  cartShippingFedexRowSelected: {
    backgroundColor: "rgba(143, 175, 143, 0.12)",
  },
  cartShippingFedexRowIdle: {
    backgroundColor: colors.background,
  },
  cartShippingActions: {
    display: "flex",
    justifyContent: "flex-end",
    paddingTop: "4px",
    borderTop: `1px solid ${colors.lightGray}`,
    marginTop: "2px",
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

  fieldLabel: {
    display: "block",
    fontSize: "12px",
    fontWeight: 600,
    color: colors.charcoal,
    marginBottom: "4px",
  },

  fieldErrorHint: {
    color: "#b00020",
    fontSize: "12px",
    margin: "0 0 10px 0",
    lineHeight: 1.35,
  },

  inputInvalid: {
    borderColor: "#b00020",
  },

  addressSuggestionPanel: {
    border: `1px solid ${colors.primaryDark}`,
    backgroundColor: colors.white,
    borderRadius: "10px",
    padding: "12px",
    marginBottom: "12px",
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

  authCard: {
    backgroundColor: colors.white,
    padding: "28px 24px",
    borderRadius: "12px",
    width: "100%",
    maxWidth: "480px",
    margin: "0 auto",
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    border: `1px solid ${colors.lightGray}`,
    boxSizing: "border-box",
    textAlign: "left",
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

  cartToast: {
    position: "fixed",
    left: "50%",
    bottom: "20px",
    transform: "translateX(-50%)",
    backgroundColor: colors.charcoal,
    color: colors.white,
    borderRadius: "999px",
    padding: "10px 16px",
    fontSize: "14px",
    fontWeight: 600,
    boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
    zIndex: 2000,
    transition: "opacity 0.35s ease",
    pointerEvents: "none",
  },

  cartToastVisible: {
    opacity: 1,
  },

  cartToastHidden: {
    opacity: 0,
  },
};

export default styles;
