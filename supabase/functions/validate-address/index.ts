import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { FEDEX_DEVELOPER_SETUP_HINT } from "../_shared/fedexApiHints.ts";
import { fedexAuthorizedJsonHeaders } from "../_shared/fedexRestHeaders.ts";
import { isKnownUsStateCode, normalizeUsStateOrProvinceCode } from "../_shared/usStateNormalize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const FEDEX_ENV = (Deno.env.get("FEDEX_ENV") || "sandbox").trim().toLowerCase();
const FEDEX_BASE_URL =
  FEDEX_ENV === "production" || FEDEX_ENV === "live"
    ? "https://apis.fedex.com"
    : "https://apis-sandbox.fedex.com";

const US_ZIP_RE = /^\d{5}(-\d{4})?$/;

type FieldErrors = Record<string, string>;

const normalizeResolved = (address: Record<string, unknown>) => {
  const addressLine1 = String(address.address_line1 || "").trim();
  const city = String(address.city || "").trim();
  const state = String(address.state || "").trim().toUpperCase();
  const zip = String(address.zip || "").trim();
  const countryCode = String(address.country_code || "US").trim().toUpperCase() || "US";
  return {
    address_line1: addressLine1,
    address_line2: String(address.address_line2 || "").trim(),
    city,
    state,
    zip,
    country_code: countryCode,
    full_name: String(address.full_name || "").trim(),
    email: String(address.email || "").trim(),
  };
};

/** FedEx REST parameter keys → our form field keys */
const fedexKeyToField = (key: string): string => {
  const k = String(key || "").toLowerCase();
  if (k.includes("streetline") || k.includes("addressline") || k === "streetlines") return "address_line1";
  if (k.includes("line2") || k.includes("secondary")) return "address_line2";
  if (k.includes("city")) return "city";
  if (k.includes("state") || k.includes("province")) return "state";
  if (k.includes("postal") || k.includes("zip")) return "zip";
  return "_form";
};

const mergeFieldErrors = (acc: FieldErrors, field: string, msg: string) => {
  const prev = acc[field];
  acc[field] = prev ? `${prev} ${msg}` : msg;
};

const fedexPayloadErrorsToFieldErrors = (payload: Record<string, unknown>): FieldErrors => {
  const out: FieldErrors = {};
  const errs = payload?.errors;
  if (!Array.isArray(errs)) return out;
  for (const e of errs) {
    const rec = e as Record<string, unknown>;
    const msg = String(rec?.message || "FedEx rejected this value").trim();
    const pl = rec?.parameterList;
    if (Array.isArray(pl) && pl.length) {
      for (const p of pl) {
        const pr = p as Record<string, unknown>;
        const field = fedexKeyToField(String(pr?.key || ""));
        const val = pr?.value != null ? ` (${String(pr.value)})` : "";
        mergeFieldErrors(out, field, `${msg}${val}`.trim());
      }
    } else {
      mergeFieldErrors(out, "_form", msg);
    }
  }
  return out;
};

const formatFedexApiErrors = (payload: Record<string, unknown>): string => {
  const errs = payload?.errors;
  if (!Array.isArray(errs) || errs.length === 0) return "";
  return errs
    .map((e: Record<string, unknown>) => {
      const code = e.code != null ? `[${e.code}] ` : "";
      const msg = String(e.message || "FedEx error");
      const pl = e.parameterList;
      let hint = "";
      if (Array.isArray(pl) && pl.length) {
        hint = ` — fields: ${pl.map((p: Record<string, unknown>) => `${String(p.key || "?")}=${String(p.value || "")}`).join("; ")}`;
      }
      return `${code}${msg}${hint}`;
    })
    .join(" | ");
};

const firstStreetFromOutput = (output: Record<string, unknown>): string => {
  const tok = output?.streetLinesToken;
  if (Array.isArray(tok) && tok[0]) return String(tok[0]).trim();
  const lines = output?.streetLines;
  if (Array.isArray(lines) && lines[0]) return String(lines[0]).trim();
  return "";
};

const collectAttributeTexts = (output: Record<string, unknown>): string[] => {
  const attrs = output?.attributes;
  if (!Array.isArray(attrs)) return [];
  return attrs.map((a) => {
    if (a && typeof a === "object") {
      const o = a as Record<string, unknown>;
      return String(o.value ?? o.name ?? "").trim().toUpperCase();
    }
    return String(a || "").trim().toUpperCase();
  }).filter(Boolean);
};

const FOREIGN_REGION_RE =
  /REGI[OÓ]N|METROPOLITANA|SANTIAGO|PROVINCIA|COMUNA|DEPARTAMENTO/i;

/**
 * FedEx sometimes returns Chilean/foreign admin labels in city or state for U.S. ZIPs.
 * For U.S. domestic, trust the customer's chosen state and only keep FedEx city when it looks sane.
 */
const clampUsDomesticResolution = (
  resolved: Record<string, unknown>,
  input: Record<string, unknown>,
  inputZip: string,
  countryCode: string,
): Record<string, unknown> => {
  if (String(countryCode || "").toUpperCase() !== "US" || !US_ZIP_RE.test(inputZip)) {
    return resolved;
  }
  const userState = normalizeUsStateOrProvinceCode(String(input.state || "").trim(), "US");
  if (!isKnownUsStateCode(userState)) return resolved;

  const userCity = String(input.city || "").trim();
  let city = String(resolved.city ?? "").trim();
  const stateStr = String(resolved.state ?? "");

  if (
    !city ||
    FOREIGN_REGION_RE.test(city) ||
    FOREIGN_REGION_RE.test(stateStr) ||
    city.length > 48
  ) {
    city = userCity;
  }

  return {
    ...resolved,
    state: userState,
    city: city || userCity,
    country_code: "US",
  };
};

const buildResolvedFromFedex = (
  output: Record<string, unknown>,
  input: Record<string, unknown>,
  countryCode: string,
) => {
  const line1 = firstStreetFromOutput(output) || String(input.address_line1 || "").trim();
  const city = String(output?.city || input.city || "").trim();
  const state = normalizeUsStateOrProvinceCode(
    String(output?.stateOrProvinceCode || input.state || "").trim(),
    countryCode,
  );
  const zip = String(output?.postalCode || input.zip || "").trim();
  const base = {
    ...normalizeResolved(input),
    address_line1: line1,
    address_line2: String(input.address_line2 || "").trim(),
    city,
    state,
    zip,
    country_code: countryCode,
  };
  return clampUsDomesticResolution(base, input, zip, countryCode);
};

const requiredFieldErrors = (
  addressLine1: string,
  city: string,
  state: string,
  zip: string,
): FieldErrors => {
  const fe: FieldErrors = {};
  if (!addressLine1) fe.address_line1 = "Street address is required.";
  if (!city) fe.city = "City is required.";
  if (!state) fe.state = "Choose a state.";
  if (!zip) fe.zip = "ZIP code is required.";
  else if (!US_ZIP_RE.test(zip)) {
    fe.zip = "Use a 5-digit ZIP or ZIP+4 (e.g. 97201 or 97201-1234).";
  }
  return fe;
};

const getFedexAccessToken = async () => {
  const clientId = Deno.env.get("FEDEX_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("FEDEX_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) {
    throw new Error("FedEx credentials are not configured");
  }

  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");
  body.append("client_id", clientId);
  body.append("client_secret", clientSecret);

  const response = await fetch(`${FEDEX_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.errors?.[0]?.message || payload?.error || "FedEx auth failed");
  }

  return String(payload.access_token);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed", validated: false }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const raw = (body.address || {}) as Record<string, unknown>;
    const { storkbin_package: _pkg, ...address } = raw;

    const addressLine1 = String(address.address_line1 || "").trim();
    const city = String(address.city || "").trim();
    const stateRaw = String(address.state || "").trim();
    const zip = String(address.zip || "").trim().replace(/\s+/g, "");
    const countryCode = String(address.country_code || "US").trim().toUpperCase() || "US";
    const state = normalizeUsStateOrProvinceCode(stateRaw, countryCode);

    const localErrors = requiredFieldErrors(addressLine1, city, state, zip);
    if (Object.keys(localErrors).length) {
      return jsonResponse({
        validated: false,
        message: "Please fix the highlighted fields.",
        fieldErrors: localErrors,
        suggested: null,
        code: "REQUIRED_FIELDS",
      });
    }

    const clientId = Deno.env.get("FEDEX_CLIENT_ID") || "";
    const clientSecret = Deno.env.get("FEDEX_CLIENT_SECRET") || "";
    if (!clientId || !clientSecret) {
      return jsonResponse(
        {
          validated: false,
          error:
            "FedEx is not configured (FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET). Address validation is required before checkout.",
        },
        503,
      );
    }

    let token: string;
    try {
      token = await getFedexAccessToken();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResponse(
        { validated: false, error: `FedEx authentication failed: ${msg}. Check Edge Function secrets.` },
        502,
      );
    }

    const fedexPayload = {
      addressesToValidate: [
        {
          address: {
            streetLines: [addressLine1, String(address.address_line2 || "").trim()].filter(Boolean),
            city,
            stateOrProvinceCode: state,
            postalCode: zip,
            countryCode,
          },
        },
      ],
    };

    let response: Response;
    try {
      response = await fetch(`${FEDEX_BASE_URL}/address/v1/addresses/resolve`, {
        method: "POST",
        headers: fedexAuthorizedJsonHeaders(token),
        body: JSON.stringify(fedexPayload),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResponse(
        { validated: false, error: `Could not reach FedEx address validation: ${msg}` },
        502,
      );
    }

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const detail = formatFedexApiErrors(payload) || String(payload?.error || "FedEx address API error");
      const blob = `${detail} ${JSON.stringify(payload?.errors || [])}`.toUpperCase();
      const credentialLike =
        response.status === 401 ||
        response.status === 403 ||
        blob.includes("FORBIDDEN") ||
        blob.includes("COULD NOT AUTHORIZE YOUR CREDENTIAL") ||
        blob.includes("NOT AUTHORIZED");
      const fieldErrors = fedexPayloadErrorsToFieldErrors(payload);
      if (Object.keys(fieldErrors).length === 0) {
        mergeFieldErrors(fieldErrors, "_form", detail);
      }
      if (credentialLike) {
        return jsonResponse(
          {
            validated: false,
            error: `FedEx address validation failed (${detail}). ${FEDEX_DEVELOPER_SETUP_HINT}`,
          },
          502,
        );
      }
      return jsonResponse({
        validated: false,
        message: `FedEx could not validate this address. ${detail}`,
        fieldErrors,
        suggested: null,
        code: "FEDEX_REJECTED",
      });
    }

    const output = payload?.output?.resolvedAddresses?.[0] as Record<string, unknown> | undefined;
    const attrTexts = output ? collectAttributeTexts(output) : [];
    const joined = attrTexts.join(" ");
    const hasUnknown = joined.includes("UNKNOWN");
    const hasUnverified = joined.includes("UNVERIFIED");
    const primaryClassification = attrTexts[0] || "RESOLVED";

    const suggested = output
      ? buildResolvedFromFedex(output, address, countryCode === "US" ? "US" : String(output?.countryCode || countryCode).trim().toUpperCase())
      : null;

    if (!output) {
      return jsonResponse({
        validated: false,
        message: "FedEx did not return a resolved address. Check each line and try again.",
        fieldErrors: {
          _form: "No match found for this address.",
        },
        suggested: null,
        code: "NO_RESOLUTION",
      });
    }

    if (hasUnknown) {
      return jsonResponse({
        validated: false,
        message: "FedEx could not verify this address against their records.",
        fieldErrors: {
          address_line1: "Check street number and spelling.",
          city: "Check city spelling.",
          state: "Confirm state matches the ZIP.",
          zip: "Confirm ZIP for this city and state.",
        },
        suggested,
        code: "UNKNOWN",
      });
    }

    // UNVERIFIED often means apartment-level uncertainty, not a wrong country — accept when U.S. ZIP/state look sound.
    if (
      hasUnverified &&
      !hasUnknown &&
      countryCode === "US" &&
      suggested &&
      US_ZIP_RE.test(String(suggested.zip || "")) &&
      String(suggested.state || "").trim().length === 2
    ) {
      return jsonResponse({
        validated: true,
        resolved: { ...suggested, country_code: "US" },
        classification: "UNVERIFIED_ACCEPTED",
        provider: `fedex_${FEDEX_ENV}`,
      });
    }

    if (hasUnverified) {
      return jsonResponse({
        validated: false,
        message:
          "FedEx could not fully verify this address. Use the suggested address below, or correct any highlighted fields.",
        fieldErrors: {},
        suggested,
        code: "UNVERIFIED",
      });
    }

    // U.S. domestic: always persist US — FedEx countryCode is unreliable in sandbox and some edge cases.
    const effectiveCountry = countryCode === "US" ? "US" : String(output?.countryCode || countryCode).trim().toUpperCase() || countryCode;

    const resolved = buildResolvedFromFedex(output, address, effectiveCountry);

    return jsonResponse({
      validated: true,
      resolved,
      classification: primaryClassification || "VALIDATED",
      provider: `fedex_${FEDEX_ENV}`,
    });
  } catch (error) {
    return jsonResponse(
      { validated: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
