# FedEx production readiness checklist

Use this when moving StorkBin from FedEx **sandbox** to **live** rating and shipping.

## Supabase Edge secrets (project: set per environment)

| Secret | Sandbox | Production |
|--------|---------|------------|
| `FEDEX_ENV` | `sandbox` or unset | `production` or `live` |
| `FEDEX_CLIENT_ID` | Developer portal **Test** API key | Developer portal **Production** API key |
| `FEDEX_CLIENT_SECRET` | Test secret | Production secret |
| `FEDEX_ACCOUNT_NUMBER` | Omit or `740561073` (portal test account) | **Your live FedEx shipping account number** (9 digits, not the developer project id) |
| `FEDEX_SANDBOX_ACCOUNT_NUMBER` | Optional override for sandbox default | N/A |
| `FEDEX_SHIPPER_*` | Optional warehouse origin overrides | Set if warehouse address differs from defaults (postal, city, state, line1) |

Do **not** use production account numbers with sandbox keys (or vice versa). OAuth may succeed while rating returns `SERVICE.UNAVAILABLE`.

Optional (leave unset unless needed):

- `FEDEX_RATE_DEBUG=1` — verbose rate logs and failure capture (debug only)
- `FEDEX_ENABLE_STANDARD_RATES_API=1` — also call legacy `/rate/v1/rates/quotes` (only if that API is enabled on the project)
- `FEDEX_ENABLE_GROUND_ECONOMY_PROBES=1` — extra Ground Economy probes after main quote

## FedEx Developer Portal — required APIs

Enable on the **production** project (same org as production keys):

1. **Comprehensive Rates and Transit Times** — primary quote path in StorkBin
2. **Ship API** — label purchase (`purchase-shipping-label`, starter kit labels)
3. **Track API** (if tracking is used)

StorkBin does **not** require the standard **Rates and Transit Times** API (`/rate/v1/rates/quotes`) unless you set `FEDEX_ENABLE_STANDARD_RATES_API=1`.

## Account linking

In the FedEx Developer Portal for the production project:

1. Confirm the **shipping account number** in `FEDEX_ACCOUNT_NUMBER` is linked to the project.
2. Confirm the account is enabled for **Ground / Home Delivery** services you ship.
3. Production keys must be generated for the project that includes Comprehensive Rates and Ship.

Sandbox note: Comprehensive Rates may show as enabled in the portal but still return `503 SERVICE.UNAVAILABLE` on sandbox; treat live credentials as the path to real quotes.

## Endpoint used (unchanged in app)

| Purpose | URL |
|---------|-----|
| OAuth | `https://apis.fedex.com/oauth/token` |
| Rate quotes (primary) | `POST https://apis.fedex.com/rate/v1/comprehensiverates/quotes` |
| Label purchase | `POST https://apis.fedex.com/ship/v1/shipments` |

Sandbox host: `https://apis-sandbox.fedex.com` (same paths).

## Pre-flight test steps

1. **Local verify (production secrets in `.env.local`, not committed)**  
   ```bash
   FEDEX_ENV=production npm run fedex:verify-config
   ```  
   Expect: `oauthStatus: ok`, `rateStatus: ok`, `rateEndpointSucceeded` = Comprehensive URL.

2. **Set Supabase secrets** for the target project and redeploy edge functions that call FedEx:
   - `quote-starter-shipment-label` (admin starter kit quotes)
   - `quote-cart-shipping` (checkout, if used)
   - `purchase-shipping-label`

3. **Admin starter kit quote** — open Starter Kit Label modal, quote a real outbound shipment. Expect priced Ground / Home Delivery options (no fake/prepaid fallback).

4. **Purchase one test label** on a non-customer test shipment; confirm PDF, tracking number, and charges look reasonable.

5. **Monitor** first production labels for surcharges vs quote; FedEx quotes are estimates until invoiced.

## Rollback

Set `FEDEX_ENV=sandbox`, restore sandbox Client ID/Secret, redeploy. Do not mix sandbox keys with production account numbers.
