/** Shown when FedEx returns auth/scope errors (FORBIDDEN, etc.), not bad street addresses. */
export const FEDEX_DEVELOPER_SETUP_HINT =
  "FedEx: this app calls **Comprehensive** rates (`/rate/v1/comprehensiverates/quotes`), not the legacy `/rate/v1/rates/quotes` path—portal must enable **Comprehensive Rates and Transit Times**. If `FEDEX_ENV` is unset it defaults to sandbox; production keys need `FEDEX_ENV=production` or `live`. Confirm keys, enabled APIs, and linked account on the same project; some parent/child setups need Child Key/Secret.";
