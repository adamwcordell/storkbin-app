/** FedEx US address APIs expect 2-letter stateOrProvinceCode; full names can resolve to wrong countries. */

const US_STATE_NAME_TO_CODE: Record<string, string> = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  "DISTRICT OF COLUMBIA": "DC",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "AMERICAN SAMOA": "AS",
  GUAM: "GU",
  "NORTHERN MARIANA ISLANDS": "MP",
  "PUERTO RICO": "PR",
  "US VIRGIN ISLANDS": "VI",
};

const US_STATE_CODES = new Set(Object.values(US_STATE_NAME_TO_CODE));

/** True if `code` is a known U.S. state or territory abbreviation (e.g. OR, DC, PR). */
export function isKnownUsStateCode(code: string): boolean {
  const c = String(code || "").trim().toUpperCase();
  return c.length > 0 && US_STATE_CODES.has(c);
}

/**
 * Returns 2-letter US state/territory code when country is US; otherwise returns trimmed uppercase input (max 14 chars).
 */
export function normalizeUsStateOrProvinceCode(stateRaw: string, countryCode: string): string {
  const cc = String(countryCode || "US").trim().toUpperCase() || "US";
  const raw = String(stateRaw || "").trim().toUpperCase().replace(/\./g, "");
  if (!raw) return "";

  if (cc !== "US") {
    return raw.slice(0, 14);
  }

  if (raw.length <= 2) {
    return raw.slice(0, 2);
  }

  const collapsed = raw.replace(/\s+/g, " ");
  const mapped = US_STATE_NAME_TO_CODE[collapsed];
  if (mapped) return mapped;
  // Unknown multi-char for US: never pass through (FedEx can return foreign region names here).
  return "";
}
