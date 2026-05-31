/** Admin-style bin label: `Adam-001` from customer email + box number. */

export const resolveCustomerEmailForBin = (opts: {
  row?: Record<string, unknown> | null;
  profileEmail?: string | null;
  shipmentAddress?: Record<string, unknown> | null;
}): string => {
  const row = opts.row || {};
  const direct = String(row.customer_email || "").trim();
  if (direct.includes("@")) return direct;

  const profileEmail = String(opts.profileEmail || "").trim();
  if (profileEmail.includes("@")) return profileEmail;

  const userEmail = String(row.user_email || "").trim();
  if (userEmail.includes("@")) return userEmail;

  const reqAddr = row.requested_shipping_address;
  if (reqAddr && typeof reqAddr === "object" && !Array.isArray(reqAddr)) {
    const shipEmail = String((reqAddr as Record<string, unknown>).email || "").trim();
    if (shipEmail.includes("@")) return shipEmail;
  }

  const shipAddr = opts.shipmentAddress;
  if (shipAddr && typeof shipAddr === "object") {
    const shipEmail = String(shipAddr.email || "").trim();
    if (shipEmail.includes("@")) return shipEmail;
  }

  return "";
};

export const formatEmailPrefixForBinRef = (email: string) => {
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
};

export const buildDisplayBinRef = (opts: {
  email?: string | null;
  boxNumber?: string | null;
  boxId: string;
}) => {
  const safePrefix = formatEmailPrefixForBinRef(String(opts.email || ""));
  const numericBox = String(opts.boxNumber || "").match(/\d+/)?.[0];
  const binSuffix = numericBox
    ? String(Number(numericBox)).padStart(3, "0")
    : String(opts.boxId || "").slice(-6);
  return `${safePrefix}-${binSuffix}`;
};

export const getCustomerBinScanUrl = (boxId: string, appBase: string) => {
  const id = String(boxId || "").trim();
  const base = String(appBase || "").replace(/\/$/, "");
  if (!base || !id) return "";
  return `${base}/scan/${encodeURIComponent(id)}?customer=1`;
};

export type BinLabelOverlayItem = {
  boxId: string;
  displayRef: string;
  scanUrl: string;
};
