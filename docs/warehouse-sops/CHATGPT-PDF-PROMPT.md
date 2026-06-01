# ChatGPT prompt — StorkBin warehouse SOP PDFs

Copy everything below the line into ChatGPT (or Claude). Attach or paste the contents of one or more files from `docs/warehouse-sops/` (especially SOP 01–05).

---

## PROMPT START

You are a technical writer producing **print-ready Standard Operating Procedures (SOPs)** for StorkBin warehouse staff.

**Brand:** StorkBin — calm, sage-green storage brand; professional but plain language for warehouse workers on phones and clipboards.

**Output format:** For each SOP I provide, produce:

1. **Cover block:** SOP title, document ID (e.g. WH-SOP-01), version 1.0, date, “StorkBin Warehouse”
2. **One-page executive summary** (bullets, max 8 items)
3. **Numbered procedure** with checkboxes ☐ for each physical step
4. **Decision table** or simple flowchart (ASCII or Mermaid) where helpful
5. **Common errors / fixes** table
6. **Sign-off line:** Operator name, date, supervisor initials

**Design rules for PDF:**

- US Letter, 1" margins
- 11pt body, 14pt section headings
- Use tables for checklists; avoid walls of text
- Highlight **button names exactly as in the app** in bold (e.g. **Apply Bin QR Sticker**, **Match Shipping Label (QR)**)
- Include a footer: “StorkBin Confidential — Warehouse SOP”
- If multiple SOPs, separate with page breaks

**Audience:** Warehouse operators who use the StorkBin Admin Dashboard on mobile. They scan QR codes with the in-app camera. They do not need database or code details.

**Accuracy constraints — do not invent steps:**

- Starter kit: assign bay → apply bin QR on **each** bin → **one** FedEx label per kit (Choose shipping & label) → match **all** bin QRs + one FedEx barcode
- Warehouse send-to-customer: assign bay → store in bay → pick + stage → create carrier label → match label
- Return to storage: mostly automated after customer pays; warehouse monitors tracking then intake (assign + store)
- Empty-flat return shipping is **not** offered to customers anymore
- Assignment statuses: assigned → placed → picked → in_staging → qr_applied → label_verified (paths differ by flow)

**Task:** Convert the following StorkBin warehouse SOP markdown into polished PDF-ready markdown (or HTML I can print to PDF). Preserve all steps; improve clarity and add visual structure only.

[PASTE SOP CONTENT HERE — start with README + 00-overview, then 01-starter-kit, 02-send-bin, 03-return, 04-intake, 05-exceptions]

After generating, tell me: “Print this HTML to PDF” or give export instructions for Chrome Print → Save as PDF.

## PROMPT END

---

## Tips

- **One SOP per ChatGPT run** = cleaner PDFs (WH-SOP-01 Starter Kit, etc.).
- For a **single combined handbook**, paste all `.md` files and ask for a table of contents.
- ChatGPT cannot email you a binary PDF directly; save the HTML/markdown it outputs, open in browser, **Ctrl+P → Save as PDF**.

## Files to paste (in order)

1. `00-overview-and-queues.md`
2. `01-starter-kit-outbound.md`
3. `02-send-bin-to-customer.md`
4. `03-return-to-storage.md`
5. `04-bin-intake-storage.md`
6. `05-exceptions-and-auction.md`
