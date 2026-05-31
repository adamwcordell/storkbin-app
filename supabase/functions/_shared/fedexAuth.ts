const FEDEX_ENV = (Deno.env.get("FEDEX_ENV") || "sandbox").trim().toLowerCase();

export const getFedexApiBaseUrl = () =>
  FEDEX_ENV === "production" || FEDEX_ENV === "live"
    ? "https://apis.fedex.com"
    : "https://apis-sandbox.fedex.com";

export const getFedexAccessToken = async () => {
  const baseUrl = getFedexApiBaseUrl();
  const clientId = Deno.env.get("FEDEX_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("FEDEX_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) {
    throw new Error("FedEx credentials are not configured");
  }

  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");
  body.append("client_id", clientId);
  body.append("client_secret", clientSecret);

  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(
      String(payload?.errors?.[0]?.message || payload?.error || "FedEx auth failed"),
    );
  }

  return String(payload.access_token);
};

export const fedexEnvLabel = () => `fedex_${FEDEX_ENV}`;

export const isFedexSandboxEnv = () => FEDEX_ENV !== "production" && FEDEX_ENV !== "live";

export const isFedexRateDebugEnabled = () =>
  ["1", "true", "yes"].includes(String(Deno.env.get("FEDEX_RATE_DEBUG") || "").trim().toLowerCase());

/** Sandbox: portal test account when unset. Production: FEDEX_ACCOUNT_NUMBER is required. */
export const resolveFedexAccountNumber = (): string => {
  const configured = (Deno.env.get("FEDEX_ACCOUNT_NUMBER") || "").trim();
  if (configured) return configured;
  if (isFedexSandboxEnv()) {
    return (Deno.env.get("FEDEX_SANDBOX_ACCOUNT_NUMBER") || "740561073").trim();
  }
  return "";
};

/**
 * Account numbers to try for rating (sandbox tries portal test account before a possibly mismatched configured number).
 */
export const resolveFedexRatingAccountCandidates = (): string[] => {
  const configured = (Deno.env.get("FEDEX_ACCOUNT_NUMBER") || "").trim();
  if (!isFedexSandboxEnv()) {
    return configured ? [configured] : [];
  }
  const sandboxDefault = (Deno.env.get("FEDEX_SANDBOX_ACCOUNT_NUMBER") || "740561073").trim();
  const out: string[] = [];
  if (sandboxDefault) out.push(sandboxDefault);
  if (configured && configured !== sandboxDefault) out.push(configured);
  if (!out.length && configured) out.push(configured);
  return [...new Set(out)];
};
