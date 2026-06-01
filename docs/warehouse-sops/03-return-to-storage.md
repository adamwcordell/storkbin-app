# SOP 03 — Return to storage (customer → warehouse)

## Trigger

Customer with bin **at their home** chooses **Send bin back to storage**, pays **full-bin** return shipping in the app.

**Queue:** **Return to storage**  
**Shipment direction:** `to_storage`

---

## What warehouse usually does

**Most of this flow is automated** after customer payment:

1. Return FedEx label is generated (webhook / edge automation).
2. Customer receives label by email.
3. Customer drops package with carrier.
4. Tracking updates move bin toward **in transit to storage** / **awaiting storage arrival**.

**Typical admin experience:** Row visible in **Return to storage** tab with hint:

> *“Return shipment — usually no warehouse click until inbound tracking.”*

---

## Warehouse monitoring checklist

| Stage | What to watch | Warehouse action |
|-------|---------------|------------------|
| Label paid | `shipping_status` paid / label_created | None — customer ships |
| In transit | Tracking active | Monitor Exceptions only |
| Delivered to warehouse | Tracking delivered / bin received | **SOP 04** intake |
| Payment failed | Charge failed | **SOP 05** — do not accept bin without payment fix |

---

## When bins arrive physically

1. Confirm tracking shows **delivered** to StorkBin address (or internal receipt process).
2. Inspect bin condition; note damage per policy.
3. Follow **SOP 04 — Bin intake & storage**:
   - **Assign Bay**
   - **Store in Bay**
4. Customer inventory in app remains their responsibility; bin is `stored` again.

---

## What we do NOT do

- Do **not** manually create outbound labels on return tab rows.
- Do **not** use starter-kit collapsed dimensions for returns — customer pays **full bin** rate.
- Empty-flat multi-bin return bundles are **disabled** in customer app (legacy carts excepted).

---

## Cancellation / subscription end (related)

When customer **cancels** while bin is **in warehouse**, system may schedule final return shipment to customer address (auto-charge). That appears under different fulfillment paths — not this SOP.

If bin is **at customer** and subscription ends, customer may use return flow above or keep bin per plan terms.

---

## Escalation

- Label not created after payment > 1 hour → Exceptions / check FedEx automation
- Customer says they shipped but no tracking → verify tracking # on row
- Wrong bin received → note bin QR / bin #; contact ops
