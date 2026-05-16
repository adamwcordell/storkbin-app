import { supabase, supabaseFunctionAuthHeaders } from "../supabaseClient.js";
import { normalizeAddressLocal, isInvokeUnreachableFunctionsError } from "./addressHelpers.js";
import { getEdgeFunctionErrorMessage } from "./edgeFunctionErrors.js";
import { isKnownUspsStateCode, normalizeUsStateOrProvinceCode } from "./usStateNormalize.js";

const US = "US";

/** Normalize fields before calling validate-address (matches FedEx U.S. domestic expectations). */
export function normalizeShippingAddressInput(addr) {
  const cc = String(addr?.country_code || US)
    .trim()
    .toUpperCase() || US;
  return {
    full_name: String(addr?.full_name || "").trim(),
    email: String(addr?.email || "").trim(),
    address_line1: String(addr?.address_line1 || "").trim(),
    address_line2: String(addr?.address_line2 || "").trim(),
    city: String(addr?.city || "").trim(),
    state: normalizeUsStateOrProvinceCode(String(addr?.state || "").trim(), cc),
    zip: String(addr?.zip || "").trim().replace(/\s+/g, ""),
    country_code: cc,
  };
}

/** Client-side required checks (mirrors Edge function for instant feedback). */
export function getLocalRequiredFieldErrors(addr) {
  const errors = {};
  const zip = String(addr.zip || "").trim().replace(/\s+/g, "");
  if (!String(addr.address_line1 || "").trim()) errors.address_line1 = "Street address is required.";
  if (!String(addr.city || "").trim()) errors.city = "City is required.";
  if (!String(addr.state || "").trim()) errors.state = "Choose a state.";
  if (!zip) errors.zip = "ZIP code is required.";
  else if (!/^\d{5}(-\d{4})?$/.test(zip)) {
    errors.zip = "Use a 5-digit ZIP or ZIP+4 (e.g. 97201 or 97201-1234).";
  }
  return errors;
}

const US_ZIP_RE = /^\d{5}(-\d{4})?$/;

/**
 * True when the address looks like a normal U.S. domestic ship-to (used to allow profile save
 * if FedEx sandbox / remote validation fails with a false negative).
 */
export function titleCaseWords(s) {
  return String(s || "")
    .trim()
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

export function isPlausibleUsDomesticAddress(addr) {
  const a = normalizeShippingAddressInput(addr);
  if (String(a.country_code || US).toUpperCase() !== "US") return false;
  if (!US_ZIP_RE.test(a.zip)) return false;
  if (!isKnownUspsStateCode(a.state)) return false;
  if (!String(a.address_line1 || "").trim()) return false;
  if (!String(a.city || "").trim()) return false;
  return true;
}

export function formatSuggestedAddressLines(s) {
  if (!s || typeof s !== "object") return "";
  const parts = [
    s.full_name,
    s.address_line1,
    s.address_line2,
    [s.city, s.state, s.zip].filter(Boolean).join(", "),
  ].filter((p) => String(p || "").trim());
  return parts.join("\n");
}

/**
 * Calls validate-address Edge function. Prefer `data.validated` (HTTP 200) for structured errors.
 * @param {object} rawAddress
 * @param {{ localFallbackOnUnreachable?: boolean }} [options]
 * @returns {Promise<{ ok: true, resolved: object, classification?: string, provider?: string, localFallback?: boolean } | { ok: false, message: string, fieldErrors: object, suggested?: object|null, code?: string }>}
 */
export async function validateShippingAddress(rawAddress, options = {}) {
  const { localFallbackOnUnreachable = false } = options;
  const normalized = normalizeShippingAddressInput(rawAddress);
  const localErr = getLocalRequiredFieldErrors(normalized);
  if (Object.keys(localErr).length) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: localErr,
      suggested: null,
    };
  }

  const auth = await supabaseFunctionAuthHeaders();
  const { data, error } = await supabase.functions.invoke("validate-address", {
    body: { address: normalized },
    headers: auth,
  });

  if (error && localFallbackOnUnreachable && isInvokeUnreachableFunctionsError(error)) {
    return { ok: true, resolved: normalizeAddressLocal(normalized), localFallback: true };
  }

  if (error) {
    const msg = await getEdgeFunctionErrorMessage(error, data);
    return { ok: false, message: msg, fieldErrors: {}, suggested: null };
  }

  if (!data || typeof data !== "object") {
    return { ok: false, message: "Empty response from address validator.", fieldErrors: {}, suggested: null };
  }

  if (data.validated === true && data.resolved) {
    return {
      ok: true,
      resolved: { ...normalized, ...data.resolved },
      classification: data.classification,
      provider: data.provider,
    };
  }

  if (data.validated === false) {
    return {
      ok: false,
      message: String(data.message || "Address could not be validated."),
      fieldErrors: typeof data.fieldErrors === "object" && data.fieldErrors && !Array.isArray(data.fieldErrors)
        ? { ...data.fieldErrors }
        : {},
      suggested: data.suggested && typeof data.suggested === "object" ? data.suggested : null,
      code: data.code,
    };
  }

  if (data.error) {
    return {
      ok: false,
      message: String(data.error),
      fieldErrors: {},
      suggested: data.suggested && typeof data.suggested === "object" ? data.suggested : null,
    };
  }

  if (data.resolved) {
    if (String(data.classification || "").toUpperCase() === "UNVERIFIED") {
      return {
        ok: false,
        message: "FedEx could not fully verify this address.",
        fieldErrors: { _form: "Unverified with FedEx." },
        suggested: data.resolved,
        code: "UNVERIFIED",
      };
    }
    return {
      ok: true,
      resolved: { ...normalized, ...data.resolved },
      classification: data.classification,
      provider: data.provider,
    };
  }

  return { ok: false, message: "Unexpected validator response.", fieldErrors: {}, suggested: null };
}
