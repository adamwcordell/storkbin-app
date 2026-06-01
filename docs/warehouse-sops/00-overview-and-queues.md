# SOP 00 — Warehouse overview & admin queues

## Purpose

Orient warehouse staff to the StorkBin **Admin Dashboard** and which queue to work from.

## System entry

1. Sign in with an admin email.
2. Go to **Admin** (top nav) → **Admin Dashboard**.
3. Use **Refresh** after long idle periods or if buttons don’t match the floor.

## Queue tabs (work in this order of priority)

### Starter kits

**Customer action:** Pays for a new subscription; empty collapsed bins ship to their address.

**Warehouse summary:** Assign bay → apply bin QR on **each** bin in the kit → purchase **one** FedEx label for the stacked kit → match label to **every** bin QR.

→ Full steps: **SOP 01**

---

### Send to customer

**Customer action:** “Send me my bin” — stored bin ships from warehouse to customer.

**Warehouse summary:** Assign bay (if needed) → store in bay → pick + stage → create carrier label → match shipping label QR.

→ Full steps: **SOP 02**

---

### Return to storage

**Customer action:** Bin at customer’s home; they pay return shipping (full bin rate).

**Warehouse summary:** Return label is usually **automatic** after payment. Monitor tracking until bin arrives; often **no button** until carrier scans.

→ Full steps: **SOP 03**

---

### Bins received

Bins that still need **Assign Bay** or **Store in Bay** only. Once picked, staged, or on an outbound/return shipment, they leave this tab.

→ Full steps: **SOP 04**

---

### Exceptions

Payment failures or **bin vs shipment state mismatch**. Fix payment with customer or use **Repair State** / support — do not ship.

→ Full steps: **SOP 05**

---

### Auction

Bins in auction lifecycle. **Mark Removed From System** when physically disposed per policy.

→ Full steps: **SOP 05**

---

### All

Every paid bin. Use when searching by bin # or email; prefer focused tabs for daily work.

## Admin row columns (quick read)

| Column | What it tells you |
|--------|-------------------|
| Bin / customer | Who and which bin |
| Status / fulfillment | Physical + checkout state |
| Shipment | Direction (to customer / to storage), tracking, label link |
| Charge | Paid vs failed |
| Actions | **Only click buttons that appear** — gray hint text explains waits |

## When there is no button

Read the hint under the row. Common messages:

- **“Label OK — waiting on carrier/tracking.”** — Done on floor; wait for FedEx.
- **“Pick + stage first, then label, then match QR.”** — Warehouse outbound sequence incomplete.
- **“Starter kit: apply bin QR on each bin…”** — Finish QR stickers before label.
- **“Return shipment — usually no warehouse click until inbound tracking.”** — Monitor only.
- **“No shipment row yet”** — Checkout/webhook delay; refresh or escalate.

## Bin detail (deep dive)

Click **Open Details** on any row for:

- Printable **bin QR sticker** sheet
- Workflow badge (next step in plain language)
- Shipment + label links

## Physical + digital rule

Every scan step expects the **real sticker or FedEx barcode**, not typing the bin number. The app validates the `/scan/…` URL on bin QRs and tracking on label barcodes.
