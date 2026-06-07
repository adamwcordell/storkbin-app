/** Shown when FedEx returns auth/scope/unavailable errors — usually config, not customer address. */
export const FEDEX_DEVELOPER_SETUP_HINT =
  "FedEx setup: enable **Comprehensive Rates and Transit Times** on your developer project (`/rate/v1/comprehensiverates/quotes`). For sandbox, set `FEDEX_ENABLE_STANDARD_RATES_API=1` and enable **Rates and Transit Times** (`/rate/v1/rates/quotes`). Match `FEDEX_ENV` to your keys (`sandbox` vs `production`/`live`), set `FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET`, and `FEDEX_ACCOUNT_NUMBER` in Supabase Edge secrets, and confirm the shipping account is linked to the same project.";

/** Sandbox Comprehensive Rates returned SERVICE.UNAVAILABLE after OAuth succeeded. */
export const FEDEX_SANDBOX_COMPREHENSIVE_UNAVAILABLE_MESSAGE =
  "FedEx sandbox could not price this shipment. OAuth succeeded, but the Comprehensive Rates endpoint returned SERVICE.UNAVAILABLE. This likely means the FedEx sandbox project/account is not authorized for Comprehensive rating. Try production credentials or contact FedEx support.";
