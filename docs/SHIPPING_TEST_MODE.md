# Shipping test mode

Staging-only fake FedEx rates and labels for end-to-end workflow testing **without purchasing real FedEx labels**.

Test mode is controlled entirely by Supabase Edge Function secrets and runtime checks in shared shipping code. It does **not** change Stripe logic or Supabase schema.

---

## Quick reference

| Action | What to do |
|--------|------------|
| **Enable** | Set secrets (below) → deploy four functions (first time only) |
| **Disable (rollback)** | Unset `SHIPPING_TEST_MODE` + restore production `FEDEX_ENV` / `APP_URL` → **no redeploy required** |
| **Remove code entirely** | Revert git changes + redeploy four functions (optional; not needed for normal rollback) |

---

## 1. Secrets introduced or changed

Shipping test mode uses **one new secret** and relies on **two existing secrets** that you typically already set per environment.

### New secret

| Secret | Enable value | Rollback value | Notes |
|--------|--------------|----------------|-------|
| `SHIPPING_TEST_MODE` | `1` | **Unset / remove** (or any value other than `1`) | Master switch. When not exactly `1`, test mode is **off** regardless of deployed code. |

### Existing secrets (often changed for staging vs production)

| Secret | Typical staging (test mode) | Production rollback | Notes |
|--------|----------------------------|---------------------|-------|
| `FEDEX_ENV` | `sandbox` or unset | `production` or `live` | Must match FedEx API keys in use. Test mode also activates when this is sandbox. |
| `APP_URL` | Vercel staging URL, e.g. `https://storkbin-app.vercel.app` | Production URL, e.g. `https://storkbin.com` | Used for email links and staging-host detection. |

### Not introduced by shipping test mode (unchanged, but required for real FedEx after rollback)

These were **not added** for test mode, but must be correct when returning to production FedEx:

| Secret | Production expectation |
|--------|------------------------|
| `FEDEX_CLIENT_ID` | FedEx Developer Portal **production** API key |
| `FEDEX_CLIENT_SECRET` | Production secret |
| `FEDEX_ACCOUNT_NUMBER` | Live FedEx shipping account (9 digits) |
| `FEDEX_SHIPPER_*` | Warehouse origin overrides (if used) |

No other secrets were added or modified specifically for shipping test mode.

---

## 2. Code files modified

| File | Role |
|------|------|
| `supabase/functions/_shared/shippingTestMode.ts` | **New.** Gating (`isShippingTestModeActive`), `TEST*` tracking helpers, fake label PDF generator |
| `supabase/functions/_shared/fedexShippingRates.ts` | `getShippingQuote()` returns fake rates when test mode active |
| `supabase/functions/_shared/fedexPurchaseLabel.ts` | `purchaseFedexLabelForShipment()` skips FedEx Ship API; creates fake label + same DB/email path |
| `supabase/functions/sweep-shipment-tracking/index.ts` | Skips FedEx track polling for `TEST*` tracking numbers |
| `supabase/functions/purchase-shipping-label/index.ts` | Response includes `testMode` and `provider` fields (harmless when test mode off) |

### Edge functions that bundle the above (deploy when enabling or reverting code)

| Function | Direct edits? |
|----------|---------------|
| `quote-cart-shipping` | No — uses shared `getShippingQuote()` |
| `create-shipping-checkout-session` | No — uses shared `getShippingQuote()` for Stripe line amounts (**must redeploy with cart quotes**) |
| `quote-starter-shipment-label` | No — uses shared `getShippingQuote()` |
| `purchase-shipping-label` | Yes — response fields |
| `sweep-shipment-tracking` | Yes — skip `TEST*` polling |

### Not modified

- Stripe checkout / webhook functions
- Supabase migrations / schema
- Frontend (`src/`)
- `shipment-carrier-simulator` (still used to advance `TEST*` shipments manually)

---

## 3. Rollback checklist

Use this before pointing real customers at production shipping or before buying live FedEx labels.

### Frontend behavior after rollback (no redeploy required)

- **Label purchase** always calls `purchase-shipping-label` first (live FedEx when test mode is off).
- **Simulator fallbacks** (`admin_generate_label`, `shipment-carrier-simulator`) only run on **staging hosts** (`localhost`, `*.vercel.app`). On production (`storkbin.com`), a FedEx failure surfaces an error instead of creating a fake label.
- **Mock `/labels` and `/track` pages** only link from `STORK-*`, `TEST*`, or `MOCK-FDX-*` tracking numbers. Real FedEx labels use `data:application/pdf` URLs and real tracking links go to `fedex.com`.
- **Match Shipping Label (QR)** scans the FedEx barcode or tracking QR on the printed label — unchanged for production.

- [ ] **Unset `SHIPPING_TEST_MODE`** (or set to anything other than `1`)
- [ ] **Set `FEDEX_ENV=production`** (or `live`)
- [ ] **Set `APP_URL`** to your production site URL (not `*.vercel.app` staging)
- [ ] **Confirm production FedEx credentials** are set: `FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET`, `FEDEX_ACCOUNT_NUMBER`
- [ ] **Smoke-test a quote** — should hit real FedEx (may take longer; amounts are live-rated)
- [ ] **Do not purchase a label** until quotes look like real FedEx responses (optional: use `fedex-rate-probe` admin tool first)
- [ ] **Existing `TEST*` shipments** — leave as-is or clean up in admin; they will not receive FedEx track updates (by design). Do not drop off test labels at FedEx.
- [ ] **(Optional)** Revert git + redeploy functions only if you want test-mode code removed from bundles entirely (not required for operational rollback)

---

## 4. Rollback command sequence

### Single-command disable (PowerShell)

From the repo root, with Supabase CLI logged in and linked to project `wslymzcbbevnoybbsbgq`:

```powershell
npx supabase secrets unset SHIPPING_TEST_MODE; npx supabase secrets set FEDEX_ENV=production APP_URL=https://storkbin.com
```

Replace `https://storkbin.com` with your real production `APP_URL` if different.

### Step-by-step (same effect)

```powershell
cd C:\Users\adamw\Desktop\StorkBin

# 1. Turn off test mode (most important step)
npx supabase secrets unset SHIPPING_TEST_MODE

# 2. Restore production FedEx environment
npx supabase secrets set FEDEX_ENV=production

# 3. Restore production app URL (emails + gating)
npx supabase secrets set APP_URL=https://storkbin.com

# 4. Verify secrets (names only; values are hidden)
npx supabase secrets list
```

### Optional: remove test-mode code from deployed bundles

Only needed if you want to revert the feature in git, not just disable it:

```powershell
git checkout HEAD -- supabase/functions/_shared/shippingTestMode.ts `
  supabase/functions/_shared/fedexShippingRates.ts `
  supabase/functions/_shared/fedexPurchaseLabel.ts `
  supabase/functions/purchase-shipping-label/index.ts `
  supabase/functions/sweep-shipment-tracking/index.ts

# If shippingTestMode.ts was never committed, delete it:
Remove-Item supabase/functions/_shared/shippingTestMode.ts -ErrorAction SilentlyContinue

npx supabase functions deploy quote-cart-shipping quote-starter-shipment-label purchase-shipping-label sweep-shipment-tracking
```

---

## 5. Does rollback require secret changes, redeploy, or both?

| Goal | Secret changes | Redeploy |
|------|----------------|----------|
| **Disable test mode; use real FedEx again** | **Yes** — unset `SHIPPING_TEST_MODE`, set production `FEDEX_ENV` + `APP_URL` | **No** — deployed code checks secrets at runtime; when `SHIPPING_TEST_MODE` ≠ `1`, all FedEx paths behave as before |
| **Remove test-mode code from Edge bundles** | No (unless also disabling) | **Yes** — revert files + redeploy the four functions |

**Operational rollback = secret changes only.** Redeploy is optional cleanup.

Safety note: even with test-mode code deployed, production is protected by the gate in `isShippingTestModeActive()`:

- Requires `SHIPPING_TEST_MODE=1` **and**
- (`FEDEX_ENV` is sandbox **or** `APP_URL` is a staging host)

So `SHIPPING_TEST_MODE=1` alone on `FEDEX_ENV=production` + production `APP_URL` is **ignored** (logged warning, no fake labels).

---

## How to enable

### Prerequisites

- Staging frontend (e.g. Vercel password-protected site)
- FedEx **sandbox** keys recommended (or accept that sandbox + staging URL is enough to activate)
- Resend / email secrets already configured (emails still send in test mode)

### Secrets (Supabase → Project Settings → Edge Functions → Secrets)

```
SHIPPING_TEST_MODE=1
FEDEX_ENV=sandbox
APP_URL=https://storkbin-app.vercel.app
```

Use your actual Vercel URL for `APP_URL`.

### Deploy (first enable or after code changes)

```powershell
cd C:\Users\adamw\Desktop\StorkBin
npx supabase functions deploy quote-cart-shipping quote-starter-shipment-label purchase-shipping-label sweep-shipment-tracking
```

---

## How to disable

See [Rollback command sequence](#4-rollback-command-sequence) above.

Minimum step:

```powershell
npx supabase secrets unset SHIPPING_TEST_MODE
```

Then restore production `FEDEX_ENV` and `APP_URL` before live shipping.

---

## Expected behavior when enabled

### Quotes (`quote-cart-shipping`, `quote-starter-shipment-label`)

- No FedEx OAuth or rate API calls
- Returns realistic fake options, e.g. FedEx Ground / Home Delivery (~$13–$27 depending on package profile)
- Quote metadata uses `provider: "fedex_test"` internally

### Label purchase (`purchase-shipping-label`)

- No FedEx Ship API call
- Tracking number: `TEST` + 9 digits (e.g. `TEST123456789`), deterministic per shipment ID
- PDF label with red banner: **TEST — NOT VALID FOR SHIPPING**
- Same DB updates, box lifecycle, and customer/ops emails as production
- API response includes `"testMode": true`, `"provider": "fedex_test"`
- `shipping_address.storkbin_shipping_test_mode: true` stored on the shipment JSON

### Tracking sweep (`sweep-shipment-tracking`)

- Skips polling FedEx for `TEST*` tracking numbers
- Advance status with **shipment-carrier-simulator** or **beta-ops-admin** override tools

### Stripe

- Unchanged — shipping checkout still creates real Stripe sessions (use Stripe test mode on staging if you do not want real charges)

---

## Expected behavior when disabled

- `SHIPPING_TEST_MODE` unset or not `1` → all shipping functions use live FedEx APIs exactly as before the feature
- Existing `TEST*` labels/shipments in the database are inert artifacts; they are not valid for carrier drop-off

---

## Fastest staging test workflow

1. Log in on Vercel → add a **return-to-storage** bin to the shipping cart with a complete address
2. Open checkout → confirm `quote-cart-shipping` returns instant fake rates (no FedEx errors)
3. Complete shipping checkout → confirm label email with `TEST*` tracking and test PDF
4. Admin → **shipment-carrier-simulator** → advance to `in_transit` → `delivered`

---

## Related docs

- [FEDEX_PRODUCTION_READINESS.md](./FEDEX_PRODUCTION_READINESS.md) — production FedEx secrets and API checklist
