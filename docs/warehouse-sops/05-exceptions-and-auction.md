# SOP 05 — Exceptions, auction & escalation

## Exceptions queue

**Trigger:** Payment failures or **shipment state mismatch** (bin status doesn’t match shipment record).

### Payment failed

**Signs:**

- `latest_charge_status` = failed
- `fulfillment_status` = shipment_payment_failed
- Subscription payment failed badges

**Warehouse rule:** **Do not ship. Do not create labels.**

**Actions:**

1. Note bin # and customer email.
2. Customer fixes payment via **Account** page (or support runs recovery).
3. **Refresh** Admin; row should leave Exceptions when paid.
4. Resume normal SOP (01 or 02).

---

### State mismatch

**Signs:**

- Row flagged in Exceptions with mismatch notice
- Buttons may include **Repair State** (if enabled) or support-only tools

**Warehouse rule:** Do not guess — **Refresh**, screenshot row, escalate to ops before physical movement.

---

## Auction queue

**Trigger:** Bin in `lifecycle_status` = **auction** (subscription/storage policy).

### Mark removed from system

**Button:** **Mark Removed From System**

Use when bin is **physically disposed** or removed from StorkBin inventory per auction policy.

1. Confirm manager approval.
2. Tap button on auction row.
3. Bin no longer appears in normal warehouse flows.

**Do not** ship auction bins without manager review (Admin Detail shows **Auction** badge).

---

## Admin tools (support / lead only)

| Tool | Purpose |
|------|---------|
| **Refresh** | Reload all admin rows + bay assignments |
| **Preview / Apply sub reconciliation** | Fix Stripe subscription drift vs database |
| **Open Details** | Sticker print, workflow badge, shipment links |

---

## FedEx / label failures

1. Check row **View Label** — may be empty if purchase failed
2. Check `latest_label_status` = purchase_failed
3. Retry **Create Carrier Label** or **Choose shipping & label** after fixing address/config
4. In test environments: `SHIPPING_TEST_MODE` produces fake labels — see `docs/SHIPPING_TEST_MODE.md`

---

## When to contact engineering

- All bins in kit stuck without **Create Carrier Label** after refresh + all QRs applied
- Scan modal camera fails on admin phone (use **paste scan value** fallback)
- Anon/customer can see wrong bins (RLS — should not happen post-migration)
- Webhook delay > 2 hours on new paid order with no shipment row

---

## Document control

Update these SOPs when Admin Dashboard buttons or queue help text change in:

- `src/pages/AdminDashboardPage.jsx` (`QUEUE_HELP`, action buttons)
- `supabase/functions/admin-storage-ops/index.ts` (assignment statuses)
