# StorkBin Sanity Tests

Run this after backend or lifecycle changes:

```bash
npm run sanity
```

This is a no-click automated sanity layer. The default mode is read-only and checks the live Supabase state machine:

- required `boxes`, `shipments`, `shipment_boxes`, and `admin_ops_bins` fields exist
- `admin_ops_bins` returns one row per box in sampled data
- paid, non-removed boxes remain eligible for Customer My Bins
- removed boxes stay out of customer visibility logic
- failed payment boxes have a computable grace deadline
- auction boxes are treated as non-self-serve recovery cases
- failed shipment charges are blocked at `pending_payment`
- label-created shipments have printed labels/tracking metadata
- grouped shipments do not exceed 3 boxes per shipment
- in-transit/delivered shipment statuses match linked box statuses by direction

## Environment

The script uses the existing project Supabase URL/anon key fallback. You can override them when needed:

```bash
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_ANON_KEY="your-anon-key" \
npm run sanity
```

For admin-only/RLS-protected checks, use a service role key locally only. Do not commit it:

```bash
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" npm run sanity
```

## Optional mutation smoke test

The mutation smoke test is intentionally opt-in because it changes shipment state.

Only run it against a disposable test shipment where:

- `charge_status = paid`
- `shipping_status = paid`
- it is safe to generate a mock label

```bash
SANITY_SHIPMENT_ID="shipment-uuid-here" \
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
npm run sanity:mutation
```

The first version only smoke-tests `admin_generate_label`. Keep broader mutation coverage in a disposable staging DB or with explicit seeded test data.
