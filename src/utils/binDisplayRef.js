import { sortInitialPurchaseCartBoxes } from "./cartBinDisplay";

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

function resolveBoxNumberForLabel(box, displayByBoxId) {
  const id = String(box?.id || "");
  if (displayByBoxId?.has?.(id)) {
    return displayByBoxId.get(id);
  }
  if (box?.box_number != null && String(box.box_number).trim() !== "") {
    return String(box.box_number).trim();
  }
  return null;
}

/** Customer-facing label (e.g. Adam-001). Never shows the raw UUID when a number exists. */
export function getCustomerBinLabel(box, options = {}) {
  const email = String(options.email || "").trim();
  const boxNumber = resolveBoxNumberForLabel(box, options.displayByBoxId);

  if (email.includes("@")) {
    return buildDisplayBinRef({ email, boxNumber, boxId: box?.id });
  }

  if (boxNumber) return boxNumber;
  return buildDisplayBinRef({ email: "User", boxNumber: null, boxId: box?.id });
}

/** Comma-separated customer labels for a starter-kit / multi-bin cart group. */
export function formatCustomerBinLabelsForGroup(groupBoxes, options = {}) {
  const sorted = sortInitialPurchaseCartBoxes(groupBoxes || []);
  return sorted.map((box) => getCustomerBinLabel(box, options)).join(", ");
}
