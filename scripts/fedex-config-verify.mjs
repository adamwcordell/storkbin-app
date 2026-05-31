/**
 * Temporary safe FedEx config verification (no secrets in output).
 *
 * Loads env from repo root: .env, .env.local (optional).
 *
 *   node scripts/fedex-config-verify.mjs
 *
 * Or: npm run fedex:verify-config
 *
 * Primary rate endpoint: Comprehensive Rates (`/rate/v1/comprehensiverates/quotes`).
 * Standard Rates (`/rate/v1/rates/quotes`) only when FEDEX_ENABLE_STANDARD_RATES_API=1.
 *
 * Lanes (debug):
 *   default / --sample-lane     → 65247 → 75063 (FedEx sandbox sample)
 *   --customer-lane             → 84401 → 84401 (StorkBin warehouse/customer same-ZIP test)
 *   STORKBIN_FEDEX_DEBUG_CUSTOMER_LANE=1  same as --customer-lane
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliArgs = new Set(process.argv.slice(2));
const useCustomerLane =
  cliArgs.has("--customer-lane") ||
  String(process.env.STORKBIN_FEDEX_DEBUG_CUSTOMER_LANE || "").trim() === "1";
const rateLane = useCustomerLane
  ? { mode: "customer", originPostalCode: "84401", destinationPostalCode: "84401" }
  : { mode: "sandbox_sample", originPostalCode: "65247", destinationPostalCode: "75063" };

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

loadEnvFile(join(repoRoot, ".env"));
loadEnvFile(join(repoRoot, ".env.local"));

const envFlagTrue = (key) =>
  ["1", "true", "yes"].includes(String(process.env[key] || "").trim().toLowerCase());

const fedexEnvRaw = (process.env.FEDEX_ENV || "sandbox").trim().toLowerCase();
const isProduction = fedexEnvRaw === "production" || fedexEnvRaw === "live";
const envLabel = isProduction ? "production" : "sandbox";
const apiBase = isProduction ? "https://apis.fedex.com" : "https://apis-sandbox.fedex.com";
const oauthUrl = `${apiBase}/oauth/token`;
const comprehensiveRateEndpoint = `${apiBase}/rate/v1/comprehensiverates/quotes`;
const legacyRateEndpoint = `${apiBase}/rate/v1/rates/quotes`;
const enableStandardRatesApi = envFlagTrue("FEDEX_ENABLE_STANDARD_RATES_API");

const secretPresent = (key) => Boolean(String(process.env[key] || "").trim());

const configuredAccount = String(process.env.FEDEX_ACCOUNT_NUMBER || "").trim();
const sandboxFallbackAccount = String(
  process.env.FEDEX_SANDBOX_ACCOUNT_NUMBER || "740561073",
).trim();

const resolveAccountForRate = () => {
  if (configuredAccount) {
    return { account: configuredAccount, source: "FEDEX_ACCOUNT_NUMBER" };
  }
  if (!isProduction) {
    return { account: sandboxFallbackAccount, source: "FEDEX_SANDBOX_ACCOUNT_NUMBER_or_default" };
  }
  return { account: "", source: "missing" };
};

const accountLast4 = (account) => {
  const digits = String(account || "").replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  if (digits.length > 0) return digits.padStart(4, "*");
  return null;
};

const extractFedexError = (payload) => {
  const errs = payload?.errors;
  if (!Array.isArray(errs) || errs.length === 0) {
    return { code: null, message: null };
  }
  const first = errs[0];
  return {
    code: first?.code != null ? String(first.code) : null,
    message: first?.message != null ? String(first.message) : null,
  };
};

const shipDateStamp = () => new Date().toISOString().slice(0, 10);

const report = {
  env: envLabel,
  fedexEnvRaw: fedexEnvRaw || "sandbox",
  oauthUrl,
  primaryRateEndpoint: comprehensiveRateEndpoint,
  standardRatesApiEnabled: enableStandardRatesApi,
  debugRateLane: rateLane,
  secretsPresent: {
    FEDEX_CLIENT_ID: secretPresent("FEDEX_CLIENT_ID"),
    FEDEX_CLIENT_SECRET: secretPresent("FEDEX_CLIENT_SECRET"),
    FEDEX_ACCOUNT_NUMBER: secretPresent("FEDEX_ACCOUNT_NUMBER"),
  },
  accountNumberLast4: null,
  accountNumberSource: "missing",
  oauthStatus: "skipped",
  oauthHttpStatus: null,
  oauthErrorCode: null,
  oauthErrorMessage: null,
  rateStatus: "skipped",
  rateEndpointSucceeded: null,
  rateAttempts: [],
  rateHttpStatus: null,
  fedexErrorCode: null,
  fedexErrorMessage: null,
};

const { account, source } = resolveAccountForRate();
report.accountNumberSource = source;
report.accountNumberLast4 = accountLast4(account);

if (!report.secretsPresent.FEDEX_CLIENT_ID || !report.secretsPresent.FEDEX_CLIENT_SECRET) {
  report.oauthStatus = "failed";
  report.oauthErrorMessage = "FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET must both be set.";
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

const oauthBody = new URLSearchParams();
oauthBody.append("grant_type", "client_credentials");
oauthBody.append("client_id", process.env.FEDEX_CLIENT_ID);
oauthBody.append("client_secret", process.env.FEDEX_CLIENT_SECRET);

let accessToken = "";

try {
  const oauthRes = await fetch(oauthUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: oauthBody,
  });
  report.oauthHttpStatus = oauthRes.status;
  const oauthPayload = await oauthRes.json().catch(() => ({}));

  if (oauthRes.ok && oauthPayload?.access_token) {
    report.oauthStatus = "ok";
    accessToken = String(oauthPayload.access_token);
  } else {
    report.oauthStatus = "failed";
    const err = extractFedexError(oauthPayload);
    report.oauthErrorCode = err.code;
    report.oauthErrorMessage =
      err.message || String(oauthPayload?.error || `OAuth failed (HTTP ${oauthRes.status})`);
  }
} catch (e) {
  report.oauthStatus = "failed";
  report.oauthErrorMessage = e instanceof Error ? e.message : String(e);
}

if (report.oauthStatus !== "ok" || !accessToken) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

if (!account) {
  report.rateStatus = "failed";
  report.fedexErrorMessage = "FEDEX_ACCOUNT_NUMBER is required for production rate verification.";
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

/** Comprehensive Rates request (matches StorkBin edge function shape). */
const buildComprehensiveRateBody = (accountNumber, rateRequestType) => ({
  ...(accountNumber ? { accountNumber: { value: accountNumber } } : {}),
  carrierCodes: ["FDXG"],
  rateRequestControlParameters: { returnTransitTimes: true },
  requestedShipment: {
    shipDateStamp: shipDateStamp(),
    shipper: {
      address: {
        postalCode: rateLane.originPostalCode,
        countryCode: "US",
      },
    },
    recipient: {
      address: {
        postalCode: rateLane.destinationPostalCode,
        countryCode: "US",
        residential: true,
      },
    },
    pickupType: "DROPOFF_AT_FEDEX_LOCATION",
    packagingType: "YOUR_PACKAGING",
    rateRequestType,
    requestedPackageLineItems: [
      {
        weight: { units: "LB", value: 10 },
      },
    ],
  },
});

const rateSteps = [];
for (const acct of [...new Set([account, sandboxFallbackAccount].filter(Boolean))]) {
  const last4 = accountLast4(acct) || "unknown";
  rateSteps.push({
    endpoint: comprehensiveRateEndpoint,
    label: `list_${last4}`,
    body: buildComprehensiveRateBody(acct, ["LIST"]),
  });
  rateSteps.push({
    endpoint: comprehensiveRateEndpoint,
    label: `account_list_${last4}`,
    body: buildComprehensiveRateBody(acct, ["ACCOUNT", "LIST"]),
  });
}

if (enableStandardRatesApi) {
  rateSteps.push({
    endpoint: legacyRateEndpoint,
    label: "list_no_account",
    body: buildComprehensiveRateBody(null, ["LIST"]),
  });
}

const tryRateStep = async (step) => {
  const rateRes = await fetch(step.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-locale": "en_US",
    },
    body: JSON.stringify(step.body),
  });
  const ratePayload = await rateRes.json().catch(() => ({}));
  const rateErr = extractFedexError(ratePayload);
  const hasRateReply = Boolean(ratePayload?.output?.rateReplyDetails);
  const ok = rateRes.ok && !rateErr.code && (hasRateReply || rateRes.ok);

  return {
    label: step.label,
    endpoint: step.endpoint,
    httpStatus: rateRes.status,
    ok,
    fedexErrorCode: rateErr.code,
    fedexErrorMessage: rateErr.message,
  };
};

try {
  for (const step of rateSteps) {
    const attempt = await tryRateStep(step);
    report.rateAttempts.push({
      label: attempt.label,
      endpoint: attempt.endpoint,
      httpStatus: attempt.httpStatus,
      ok: attempt.ok,
      fedexErrorCode: attempt.fedexErrorCode,
      fedexErrorMessage: attempt.fedexErrorMessage,
    });

    if (attempt.ok) {
      report.rateStatus = "ok";
      report.rateEndpointSucceeded = attempt.endpoint;
      report.rateHttpStatus = attempt.httpStatus;
      break;
    }

    report.rateHttpStatus = attempt.httpStatus;
    report.fedexErrorCode = attempt.fedexErrorCode;
    report.fedexErrorMessage =
      attempt.fedexErrorMessage || `Rate request failed (HTTP ${attempt.httpStatus})`;
  }

  if (report.rateStatus !== "ok") {
    report.rateStatus = "failed";
  }
} catch (e) {
  report.rateStatus = "failed";
  report.fedexErrorMessage = e instanceof Error ? e.message : String(e);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.rateStatus === "ok" ? 0 : 1);
