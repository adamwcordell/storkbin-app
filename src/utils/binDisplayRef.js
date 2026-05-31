/** Admin-style bin label: `Adam-001` from customer email + box number. */

/** Same sources as admin dashboard rows (profiles, shipment address, etc.). */
export function resolveCustomerEmailForBin({ row, profileById = {}, shipment = null } = {}) {
  const direct = String(row?.customer_email || "").trim();
  if (direct.includes("@")) return direct;

  const profileEmail = String(profileById[String(row?.user_id || "")]?.email || "").trim();
  if (profileEmail.includes("@")) return profileEmail;

  const userEmail = String(row?.user_email || "").trim();
  if (userEmail.includes("@")) return userEmail;

  const addr = row?.requested_shipping_address;
  if (addr && typeof addr === "object" && !Array.isArray(addr)) {
    const shipEmail = String(addr.email || "").trim();
    if (shipEmail.includes("@")) return shipEmail;
  }

  const shipAddr = shipment?.shipping_address;
  if (shipAddr && typeof shipAddr === "object" && !Array.isArray(shipAddr)) {
    const shipEmail = String(shipAddr.email || "").trim();
    if (shipEmail.includes("@")) return shipEmail;
  }

  return "";
}

export function formatEmailPrefixForBinRef(email) {
  const local = String(email || "")
    .trim()
    .toLowerCase()
    .split("@")[0];
  if (!local) return "User";
  return local
    .replace(/[^a-z0-9._-]/g, "")
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function buildDisplayBinRef({ email, boxNumber, boxId }) {
  const safePrefix = formatEmailPrefixForBinRef(email);
  const numericBox = String(boxNumber || "").match(/\d+/)?.[0];
  const binSuffix = numericBox
    ? String(Number(numericBox)).padStart(3, "0")
    : String(boxId || "").slice(-6);
  return `${safePrefix}-${binSuffix}`;
}
