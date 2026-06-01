# SOP 02 — Send bin to customer (warehouse outbound)

## Trigger

Existing customer with bin **stored in warehouse** requests **“Send Me My Bin”** from the app, pays shipping, and shipment is created.

**Queue:** **Send to customer**  
**Shipment direction:** `to_customer`  
**Bin status:** `stored` → outbound prep → with customer

This is **not** a starter kit (bin has been in storage; may contain customer items).

---

## Prerequisites

- [ ] Customer shipping charge **paid** (`latest_charge_status` = paid)
- [ ] Shipment row exists (`latest_shipment_id` present)
- [ ] No payment failure on row

---

## Step-by-step

### 1. Assign bay (if not already assigned)

**Queue:** Bins received or Send to customer  
**Button:** **Assign Bay**

Only if row shows stored with **no** current assignment.

1. Tap **Assign Bay**.
2. Enter bay code.

**System:** `assigned`

---

### 2. Store in bay

**Button:** **Store in Bay**

When assignment is `assigned` and bin is normal warehouse inventory (not starter-kit outbound).

1. Physically place bin in the assigned bay.
2. Tap **Store in Bay**.
3. Optional: placement note / photo URL in prompts.

**System:** `placed`, box `status` → `stored`, `fulfillment_status` → `stored`

---

### 3. Pick + stage

**Button:** **Pick + Stage Scan**

When bin is `placed`, outbound to customer, shipping paid.

1. Pull bin from bay to staging area.
2. Tap **Pick + Stage Scan**.
3. Confirm dialog (intended: bin QR + staging scan; marks picked + in staging in system).

**System:** `picked` → `in_staging`

---

### 4. Create carrier label

**Button:** **Create Carrier Label**

When bin is staged (`in_staging` or picked path complete), label needed, shipping paid.

1. Tap **Create Carrier Label**.
2. System purchases FedEx label (full bin dimensions / weight rules apply).
3. Print label from **View Label** link on row.

**System:** `shipping_status` → `label_created`

**Note:** If button missing, read hint — often **“Pick + stage first, then label, then match QR.”**

---

### 5. Match shipping label

**Button:** **Match Shipping Label (QR)**

When label exists and bin is in staging (warehouse outbound path).

1. Attach FedEx label to package.
2. Tap **Match Shipping Label (QR)**.
3. Scan **bin QR** if prompted (when bin QR was recorded earlier).
4. Scan **FedEx barcode** on label.
5. Confirm matched tracking in success message.

**System:** `label_verified`

---

### 6. Carrier handoff & tracking

- [ ] Package with carrier
- Row hint: **“Label OK — waiting on carrier/tracking.”**
- When delivered: customer has bin (`at_customer`); no further warehouse clicks

---

## Flow diagram (warehouse outbound)

```
Assign Bay → Store in Bay → Pick + Stage → Create Label → Match Label → Carrier
   assigned      placed      in_staging    label_created   label_verified
```

---

## Common errors

| Situation | Action |
|-----------|--------|
| Payment failed | **Exceptions** — customer must fix payment on Account page |
| No shipment row | Refresh; webhook delay — escalate if >30 min |
| Label purchase failed | Retry; check FedEx; see Exceptions |
| “Shipped or delivered — no warehouse click” | Already done |

---

## Difference from starter kit (SOP 01)

| | Starter kit | Send to customer |
|---|-------------|------------------|
| Bins | New empty collapsed | Stored bin (may be full) |
| QR apply | Required before label | Optional unless match prompts |
| Label modal | Choose rate + stack dims | Create Carrier Label |
| Pick/stage | Usually skipped | Required |
| Labels per order | One per kit | One per bin |
