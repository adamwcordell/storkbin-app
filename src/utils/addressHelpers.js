/** Normalize shipping fields client-side when Edge / FedEx validation is unavailable. */
export function normalizeAddressLocal(address) {
  const country = String(address.country_code || "US").trim().toUpperCase() || "US";
  return {
    ...address,
    full_name: String(address.full_name || "").trim(),
    email: String(address.email || "").trim(),
    address_line1: String(address.address_line1 || "").trim(),
    address_line2: String(address.address_line2 || "").trim(),
    city: String(address.city || "").trim(),
    state: String(address.state || "").trim().toUpperCase(),
    zip: String(address.zip || "").trim(),
    country_code: country,
  };
}

/** True when supabase.functions.invoke failed before a usable JSON body (e.g. function missing, network). */
export function isInvokeUnreachableFunctionsError(error) {
  if (!error) return false;
  const name = String(error.name || "");
  const msg = String(error.message || "").toLowerCase();
  return (
    name === "FunctionsFetchError" ||
    msg.includes("failed to send a request to the edge function") ||
    msg.includes("failed to send") ||
    msg.includes("networkerror") ||
    msg.includes("load failed")
  );
}
