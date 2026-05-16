import { Link } from "react-router-dom";
import { BRAND_TAGLINE } from "../config/brand";
import { colors } from "../styles/styles";

const MARK_SRC = "/storkbin-mark.png";

/**
 * Official StorkBin mark + wordmark. Mark lives in `public/storkbin-mark.png`.
 * Use `to` for client-side navigation (e.g. "/" or "/dashboard").
 * `variant="hero"` — larger mark + type (e.g. marketing header).
 * `variant="authPanel"` — extra-large mark + type (login card only).
 */
function StorkBinLogo({ to = "/", showTagline = true, compact = false, variant = "default" }) {
  const isAuthPanel = variant === "authPanel";
  const isHero = variant === "hero";
  const fontSize = isAuthPanel
    ? "clamp(28px, 6vw, 36px)"
    : isHero
      ? "clamp(28px, 3.5vw, 35px)"
      : compact
        ? "18px"
        : "22px";
  const markHeight = isAuthPanel ? 92 : isHero ? 70 : compact ? 32 : 40;
  const taglineSize = isAuthPanel
    ? "clamp(14px, 2.2vw, 17px)"
    : isHero
      ? "clamp(16px, 2vw, 19px)"
      : compact
        ? "11px"
        : "12px";
  const markMaxWidth = isAuthPanel ? 104 : isHero ? 90 : compact ? 40 : 48;
  const gap = isAuthPanel ? "16px" : isHero ? "18px" : "10px";

  const inner = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
        textDecoration: "none",
        flexDirection: isAuthPanel ? "column" : "row",
      }}
    >
      <img
        src={MARK_SRC}
        alt=""
        style={{
          flexShrink: 0,
          display: "block",
          objectFit: "contain",
          height: markHeight,
          width: "auto",
          maxWidth: markMaxWidth,
        }}
        decoding="async"
      />
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: isAuthPanel ? "center" : "flex-start",
          lineHeight: 1.15,
          textAlign: isAuthPanel ? "center" : "left",
        }}
      >
        <span
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 700,
            fontSize,
            letterSpacing: "-0.03em",
            color: colors.charcoal,
          }}
        >
          StorkBin
        </span>
        {showTagline ? (
          <span
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 500,
              fontSize: taglineSize,
              color: colors.primaryDark,
              marginTop: isAuthPanel ? "6px" : isHero ? "4px" : "2px",
            }}
          >
            {BRAND_TAGLINE}
          </span>
        ) : null}
      </span>
    </span>
  );

  if (to) {
    return (
      <Link
        to={to}
        style={{ textDecoration: "none", color: "inherit", display: "inline-flex" }}
        aria-label="StorkBin home"
      >
        {inner}
      </Link>
    );
  }

  return <div>{inner}</div>;
}

export default StorkBinLogo;
