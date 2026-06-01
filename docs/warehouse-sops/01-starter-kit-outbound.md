# SOP 01 — Starter kit outbound (new customer, empty bins to home)

## Trigger

Customer completes **initial purchase** checkout. Bins appear in Admin → **Starter kits** (blue grouped rows for multi-bin kits).

**Fulfillment:** `paid_waiting_to_ship_bin`  
**Shipment direction:** `to_customer`  
**One FedEx label** covers all bins in the kit (stacked empty collapsed bins).

---

## Prerequisites

- [ ] Admin logged in on phone or desktop
- [ ] Empty collapsed bins ready (count = plan bin count on order)
- [ ] Printed bin QR stickers (from Admin → Open Details → print sticker sheet) **or** print after bay assign
- [ ] FedEx label printer / PDF workflow ready

---

## Step-by-step

### 1. Assign bay (each bin)

**Queue:** Starter kits or Bins received  
**Button:** **Assign Bay**

1. Tap **Assign Bay** on the bin row.
2. Enter bay code (e.g. `A1`) — prompt shows available bays.
3. Repeat for **every bin** in the kit if they are separate rows.

**System:** `bin_storage_assignments.status` → `assigned`

**Note:** Starter outbound may **skip** “Store in Bay” — go straight to QR apply when row shows assigned + starter hint.

---

### 2. Apply bin QR sticker (each bin)

**Button:** **Apply Bin QR Sticker** (once per bin)

1. Print sticker from **Open Details** if not already printed (3.5" × 4" sheet with logo + QR + name lines).
2. Physically apply sticker to the **correct** collapsed bin.
3. Tap **Apply Bin QR Sticker**.
4. **Scan** the sticker QR with phone camera (in-app scanner opens).
   - Must decode full URL containing `/scan/…`
   - Must **not** type bin number only
5. Confirm success; row advances when all kit bins are `qr_applied`.

**Multi-bin kit:** Repeat for **every** bin in the blue block before label purchase.

**System:** `status` → `qr_applied`, `bin_qr_code` stored

---

### 3. Choose shipping & purchase label (once per kit)

**Button:** **Choose shipping & label** (any one row in the kit)

1. Tap on **one** kit row (same shipment for all bins).
2. Modal opens: FedEx rates for **stacked empty bins**.
3. Confirm dimensions checkbox (collapsed stack L×W×H matches modal).
4. Select service (Ground / Home Delivery etc.).
5. **Purchase label** — charges FedEx (or test mode if enabled).

**Output:**

- Tracking number on row
- **View Label** PDF — bin ref printed on label; kit bins may have QR overlay on PDF

**System:** `shipping_status` → `label_created`

**Do not** purchase a second label for sibling bins in the same kit.

---

### 4. Match shipping label (all bins in kit)

**Button:** **Match Shipping Label (QR)**

1. Attach printed FedEx label to the **package** (all bins stacked as one shipment).
2. Tap **Match Shipping Label (QR)** on a kit row.
3. If multi-bin: confirm prompt — scan **each bin QR** in order (1/N, 2/N, …).
4. Scan **FedEx label barcode** once (same tracking for whole kit).
5. Success alert shows matched tracking.

**System:** Each bin → `label_verified` (starter path may pass through `outbound_labeled`)

---

### 5. Hand off to carrier

- [ ] Package at FedEx drop / pickup
- [ ] Row hint: **“Label OK — waiting on carrier/tracking.”**
- Tracking updates via automated sweep (no manual “mark shipped” for customers)

---

## Kit checklist (printable)

| Step | Bin 1 | Bin 2 | Bin 3 | … |
|------|-------|-------|-------|---|
| Bay assigned | ☐ | ☐ | ☐ | |
| QR sticker applied + scanned | ☐ | ☐ | ☐ | |
| Label purchased (once) | ☐ | | | |
| Label matched (all bin QRs + FedEx) | ☐ | ☐ | ☐ | |
| With carrier | ☐ | | | |

---

## Common errors

| Error | Fix |
|-------|-----|
| Scan doesn’t match bin | Wrong sticker on bin; re-scan correct QR |
| “Create Carrier Label” missing | Refresh; ensure **all** kit bins are `qr_applied` |
| Label purchase failed | Exceptions tab; check FedEx config / address |
| Match fails tracking | Scan barcode on **this** shipment’s label, not another package |

---

## What we do NOT do for starter kits

- Do **not** use **Store in Bay** / **Pick + Stage** unless row explicitly shows warehouse intake (rare for starter outbound).
- Do **not** ship a full-storage-dimension box — kit uses **empty collapsed stack** dimensions only.
