const normalizeFedexServiceTypeKey = (st) =>
  String(st || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");

/** StorkBin checkout: same allowlist as edge `fedexShippingRates.ts` (Ground / Home Delivery / Economy / SmartPost). */
function isStorkbinCheckoutGroundServiceType(st) {
  const u = normalizeFedexServiceTypeKey(st);
  if (u === "GROUND_HOME_DELIVERY") return true;
  if (u === "FEDEX_GROUND") return true;
  if (u === "FEDEX_GROUND_ECONOMY") return true;
  if (u === "SMART_POST" || u === "SMARTPOST") return true;
  return false;
}

function storkbinFedexGroundCartLabel(st) {
  const u = normalizeFedexServiceTypeKey(st);
  if (u === "GROUND_HOME_DELIVERY") return "FedEx Home Delivery";
  if (u === "FEDEX_GROUND") return "FedEx Ground";
  if (u === "FEDEX_GROUND_ECONOMY") return "FedEx Ground Economy";
  if (u === "SMART_POST" || u === "SMARTPOST") return "FedEx Ground Economy";
  return null;
}

/**
 * Cart / checkout UI: residential/economy ground-style FedEx options only (no Express).
 * Server should already filter; this is a safety net for older payloads.
 */
export function filterFedexCartGroundOptions(options) {
  if (!Array.isArray(options) || options.length === 0) return [];
  return [...options]
    .filter((o) => isStorkbinCheckoutGroundServiceType(o.serviceType))
    .sort((a, b) => Number(a.amountUsd) - Number(b.amountUsd))
    .map((o) => {
      const label = storkbinFedexGroundCartLabel(o.serviceType) || o.serviceName || o.serviceType;
      return {
        ...o,
        serviceName: storkbinFedexGroundCartLabel(o.serviceType) || o.serviceName,
        cartLabel: label,
      };
    });
}

/** @deprecated Use `filterFedexCartGroundOptions`; kept for imports. */
export function filterFedexCartToThreeServices(options) {
  return filterFedexCartGroundOptions(options);
}

/** Human-readable FedEx delivery date (matches edge `formatFedExDateForSummary` behavior). */
export function formatFedexDeliveryDate(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const dateOnly = trimmed.includes("T") ? trimmed.slice(0, trimmed.indexOf("T")) : trimmed.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    const stripped = trimmed.replace(/T[\d:.-]+Z?$/i, "").trim();
    return stripped || trimmed;
  }
  const d = new Date(`${dateOnly}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateOnly;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/** Mirrors `_shared/fedexShippingRates.ts` `humanizeTransitTime` for cart copy. */
export function humanizeFedexTransitTime(raw) {
  if (raw == null || typeof raw !== "string") return null;
  const up = raw.toUpperCase().trim();
  if (!up) return null;
  const wordToN = {
    ONE: "1",
    TWO: "2",
    THREE: "3",
    FOUR: "4",
    FIVE: "5",
    SIX: "6",
    SEVEN: "7",
    EIGHT: "8",
    NINE: "9",
    TEN: "10",
  };
  const m = up.match(/^(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)_(DAY|DAYS)$/);
  if (m) {
    const n = wordToN[m[1]] || "?";
    return `About ${n} business day${n === "1" ? "" : "s"} (FedEx transit estimate)`;
  }
  if (up.includes("SAME_DAY")) return "Same business day (FedEx estimate)";
  if (up === "ONE_DAY" || up.includes("NEXT_DAY")) return "About 1 business day (FedEx estimate)";
  return up.replace(/_/g, " ").toLowerCase();
}

/** Second line(s) under each shipping method row (date + transit). */
export function fedexOptionDetailParts(option) {
  const parts = [];
  const dateStr = formatFedexDeliveryDate(option.estimatedDeliveryDate);
  if (dateStr) parts.push(`Estimated delivery: ${dateStr}`);
  const tt = humanizeFedexTransitTime(option.transitTimeRaw);
  if (tt) parts.push(tt);
  if (parts.length === 0 && option.deliverySummary) {
    parts.push(String(option.deliverySummary).trim());
  }
  return parts;
}
