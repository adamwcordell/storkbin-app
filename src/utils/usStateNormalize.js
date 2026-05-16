/** FedEx US APIs expect 2-letter states; full names like "Oregon" can produce wrong international matches. */

const US_STATE_NAME_TO_CODE = {
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

/** Two-letter USPS / FedEx state & territory codes we accept for U.S. domestic. */
export const USPS_STATE_CODES = new Set(Object.values(US_STATE_NAME_TO_CODE));

export function isKnownUspsStateCode(code) {
  return USPS_STATE_CODES.has(String(code || "").trim().toUpperCase());
}

/** For `<select>`: value and visible label are both the 2-letter USPS / territory code (FedEx). */
const USPS_CODES_SORTED = [...new Set(Object.values(US_STATE_NAME_TO_CODE))].sort((a, b) =>
  a.localeCompare(b),
);

export const US_STATE_SELECT_OPTIONS = [
  { value: "", label: "State" },
  ...USPS_CODES_SORTED.map((code) => ({ value: code, label: code })),
];

export function normalizeUsStateOrProvinceCode(stateRaw, countryCode = "US") {
  const cc = String(countryCode || "US")
    .trim()
    .toUpperCase() || "US";
  const raw = String(stateRaw || "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "");
  if (!raw) return "";

  if (cc !== "US") {
    return raw.slice(0, 14);
  }

  if (raw.length <= 2) {
    return raw.slice(0, 2);
  }

  const collapsed = raw.replace(/\s+/g, " ");
  if (US_STATE_NAME_TO_CODE[collapsed]) return US_STATE_NAME_TO_CODE[collapsed];
  // Unknown multi-char for US: do not pass foreign region strings through as "state"
  return "";
}
