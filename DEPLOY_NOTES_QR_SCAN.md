# Deploy notes: QR sticker & scan routing

## Frontend

- Install dependencies (adds **`qrcode`** for client-side QR generation):

  ```bash
  npm install
  ```

- Deploy the Vite app as usual (`npm run build` then host the `dist/` output).

- Ensure **`public/storkbin_color_vertical.png`** is deployed with static assets (already under `public/`).

## Routes

- **`/scan/:boxIdOrToken`** is registered in both the logged-out and logged-in routers:

  - Logged out: gate page with sign-in / sign-up links and `redirect` query preservation (`/login?redirect=/scan/<uuid>`).
  - Logged in: resolves to **`/admin/boxes/:id`** for admins (via `admin_ops_bins` / `boxes`) or **`/bins/:id?from_scan=1`** for the owning customer (same bin card as My Bins; query prompts an automatic trip to **Cart** after return/ship-to-me address prep so they can pick FedEx + Stripe). Other users see a safe access-denied message.

## Edge functions / database

- **No new migrations** and **no edge function changes** for this feature. Scan routing and sticker printing are entirely client-side; QR URLs use the public bin UUID only (no customer PII in the QR payload).

## Behavior preserved

- Return shipping still uses the existing **`create-shipping-checkout-session`** + **`quote-cart-shipping`** pipeline; **`to_storage`** labels continue to follow existing post-payment automation.
- **`to_customer`** / starter **QR-before-label** rules are unchanged (server-side behavior not modified here).
