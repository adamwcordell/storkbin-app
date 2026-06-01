# SOP 04 — Bin intake & storage (assign bay, store in bay)

## Trigger

Physical bin must be located in the warehouse rack system:

- New inventory received (returns — SOP 03)
- Existing bin re-entering warehouse
- Any bin in **Bins received** queue without placement

---

## Step-by-step

### 1. Locate bin in Admin

**Queue:** **Bins received** (fastest) or **All** (search bin # / email)

Row criteria:

- `status` = stored (or becoming stored)
- No current bay assignment **or** assignment = `assigned` but not yet placed

---

### 2. Assign bay

**Button:** **Assign Bay**

1. Tap **Assign Bay**.
2. Prompt shows available bays (e.g. `A1`, `B2`).
3. Enter bay code for the rack slot you will use.
4. Physically reserve that slot.

**Rules:**

- One bin per bay (system clears prior occupant on assign).
- Use consistent bay naming from **storage_bays** table.

**System:** New `bin_storage_assignments` row, `status` = `assigned`, `is_current` = true

---

### 3. Store in bay

**Button:** **Store in Bay**

1. Move bin into the assigned bay location.
2. Tap **Store in Bay**.
3. Optional: placement note; photo URL (future use).

**System:**

- Assignment → `placed`
- Box → `status` = `stored`, `fulfillment_status` = `stored`

---

## After storage

Bin is available for:

- **Send to customer** flow (SOP 02) when customer requests retrieval
- Ongoing monthly storage (no daily warehouse action)

---

## Starter kit exception

Bins on **starter kit outbound** may show `assigned` without **Store in Bay** — they ship directly from prep bench. Follow **SOP 01** instead of storing in rack long-term.

---

## QR stickers

Intake from **returns** does not require new QR if sticker intact. If missing/damaged:

1. Open **Admin → Open Details** for bin.
2. Print replacement sticker.
3. Apply and use **Apply Bin QR Sticker** if row is in starter-like prep state.

---

## Checklist (receiving a return)

- [ ] Bin # matches tracking / customer record
- [ ] Bay assigned
- [ ] Bin physically in bay
- [ ] **Store in Bay** clicked
- [ ] Row left **Bins received** queue
