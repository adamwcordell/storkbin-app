# StorkBin warehouse SOPs

Standard operating procedures for warehouse staff, aligned with the **Admin Dashboard** (`/admin`) and **Admin Bin Detail** (`/admin/boxes/:id`) in the StorkBin app.

## Documents

| # | SOP | When to use |
|---|-----|-------------|
| 00 | [Overview & queues](./00-overview-and-queues.md) | Daily orientation, which tab to open |
| 01 | [Starter kit outbound](./01-starter-kit-outbound.md) | New customer orders empty bins shipped to their home |
| 02 | [Send bin to customer](./02-send-bin-to-customer.md) | Customer requests a stored bin back from warehouse |
| 03 | [Return to storage](./03-return-to-storage.md) | Customer ships a bin back to StorkBin |
| 04 | [Bin intake & storage](./04-bin-intake-storage.md) | Assign bay, store bin in rack |
| 05 | [Exceptions & auction](./05-exceptions-and-auction.md) | Payment failures, state mismatch, auction |

## How to make PDFs (no special software)

1. Open any `.md` file in VS Code, Cursor, or GitHub.
2. **Option A — Browser:** Paste into [Markdown to PDF](https://www.markdowntopdf.com/) or use a VS Code extension (“Markdown PDF”).
3. **Option B — Print:** Preview the rendered markdown → **Print** → **Save as PDF**.
4. **Option C — ChatGPT:** Copy the prompt in [CHATGPT-PDF-PROMPT.md](./CHATGPT-PDF-PROMPT.md) plus one SOP file; ask for a formatted PDF-style layout.

## Before every shift

- Log in at the production app URL with an **admin** account (`ADMIN_EMAILS` / `VITE_ADMIN_EMAILS` must include your email).
- Open **Admin Dashboard** → click **Refresh** if rows look stale.
- Use a phone or tablet with camera for **Apply Bin QR Sticker** and **Match Shipping Label** (camera opens in-app).

## Bay / assignment status glossary

| Status | Meaning |
|--------|---------|
| `assigned` | Bay reserved; bin not yet physically placed |
| `placed` | Bin stored in bay |
| `picked` | Bin pulled from bay (warehouse outbound) |
| `in_staging` | Bin in staging area, ready for label attach |
| `qr_applied` | Bin QR sticker applied and scanned (starter kit) |
| `outbound_labeled` | Shipping label attached (starter kit path) |
| `label_verified` | Bin QR + FedEx barcode matched to shipment |

## Support

- App issues: note bin #, customer email, and screenshot of Admin row.
- FedEx / label failures: check **Exceptions** queue and bin **Open Details**.

*Last aligned to app: May 2026*
