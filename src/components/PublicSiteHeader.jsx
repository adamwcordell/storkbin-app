import { Link } from "react-router-dom";
import StorkBinLogo from "./StorkBinLogo";
import { colors } from "../styles/styles";

const headerStyle = {
  position: "sticky",
  top: 0,
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  flexWrap: "wrap",
  padding: "18px 24px",
  backgroundColor: colors.white,
  borderBottom: `1px solid ${colors.lightGray}`,
  boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
};

const navStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
};

const linkStyle = {
  fontFamily: "'Inter', system-ui, sans-serif",
  fontSize: "14px",
  fontWeight: 500,
  color: colors.gray,
  textDecoration: "none",
  padding: "8px 10px",
  borderRadius: "8px",
};

const ctaPrimary = {
  ...linkStyle,
  backgroundColor: colors.primary,
  color: colors.white,
  fontWeight: 600,
};

const ctaGhost = {
  ...linkStyle,
  border: `1px solid ${colors.lightGray}`,
  color: colors.charcoal,
};

function PublicSiteHeader() {
  return (
    <header style={headerStyle}>
      <StorkBinLogo to="/" showTagline variant="hero" />
      <nav style={navStyle} aria-label="Marketing">
        <a href="#how-it-works" style={linkStyle}>
          How it works
        </a>
        <a href="#pricing" style={linkStyle}>
          Pricing
        </a>
        <a href="#faq" style={linkStyle}>
          FAQ
        </a>
        <Link to="/login" style={ctaGhost}>
          Log in
        </Link>
        <Link to="/signup" style={ctaPrimary}>
          Get started
        </Link>
      </nav>
    </header>
  );
}

export default PublicSiteHeader;
