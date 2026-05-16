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
