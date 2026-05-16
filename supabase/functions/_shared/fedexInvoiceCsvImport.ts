/**
 * FedEx Billing Online / invoice CSV: flexible header detection and row parsing.
 * Column names vary by export; we match common patterns (case-insensitive).
 */

import { parse } from "https://deno.land/std@0.224.0/csv/parse.ts";

export type FedexInvoiceColumnMap = {
  trackingIdx: number;
  invoiceIdx: number;
  amountIdx: number;
  reasonIdx: number;
};

const norm = (s: string) =>
  String(s || "")
    .replace(/^\ufeff/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Parse currency like $1,234.56 or (12.34) for negatives — returns cents, or null. */
export const parseMoneyToCents = (raw: string): number | null => {
  const s = String(raw || "").trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[$\s]/g, "").replace(/,/g, "").replace(/^\(/, "").replace(/\)$/, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return neg ? -cents : cents;
};

const findColumn = (headers: string[], patterns: RegExp[], exclude?: RegExp[]): number => {
  const H = headers.map(norm);
  for (let i = 0; i < H.length; i++) {
    if (exclude?.some((x) => x.test(H[i]))) continue;
    if (patterns.some((p) => p.test(H[i]))) return i;
  }
  return -1;
};

/** Resolve column indices from header row. Optional explicit header names (exact match, case-insensitive). */
export const resolveFedexInvoiceColumns = (
  headers: string[],
  explicit?: { tracking?: string; invoice?: string; amount?: string; reason?: string },
): { ok: true; map: FedexInvoiceColumnMap } | { ok: false; error: string } => {
  const H = headers.map((h) => String(h || "").trim());
  const idxOf = (name?: string) => {
    if (!name) return -1;
    const t = norm(name);
    return H.findIndex((h) => norm(h) === t);
  };

  let trackingIdx = explicit?.tracking ? idxOf(explicit.tracking) : -1;
  let invoiceIdx = explicit?.invoice ? idxOf(explicit.invoice) : -1;
  let amountIdx = explicit?.amount ? idxOf(explicit.amount) : -1;
  let reasonIdx = explicit?.reason ? idxOf(explicit.reason) : -1;

  if (trackingIdx < 0) {
    trackingIdx = findColumn(
      headers,
      [
        /express or ground tracking/,
        /master tracking number/,
        /^tracking id$/,
        /tracking number/,
        /airbill|air waybill/,
        /trk.?nbr/,
        /^tracking$/,
      ],
    );
  }

  if (invoiceIdx < 0) {
    invoiceIdx = findColumn(
      headers,
      [/invoice number/, /^invoice #/, /^invoice no\.?$/, /invoice id/, /^invoice$/],
      [/invoice date/, /invoice type/],
    );
  }

  if (amountIdx < 0) {
    amountIdx = findColumn(
      headers,
      [
        /net charge amount/,
        /^net amount$/,
        /total charge amount/,
        /actual charge/,
        /^net charge$/,
        /charge amount/,
        /transportation charge amount/,
        /billed amount/,
      ],
      [/discount|credit|rebate|refund/i],
    );
  }

  if (reasonIdx < 0) {
    reasonIdx = findColumn(headers, [
      /service description/,
      /charge description/,
      /detail description/,
      /surcharge description/,
      /^description$/,
      /adjustment/,
      /service type/,
    ]);
  }

  if (trackingIdx < 0) return { ok: false, error: "Could not find a tracking column (looked for Tracking ID, Master Tracking, etc.)" };
  if (amountIdx < 0) {
    return { ok: false, error: "Could not find a billed amount column (looked for Net Charge Amount, Net Amount, etc.)" };
  }

  return {
    ok: true,
    map: {
      trackingIdx,
      invoiceIdx,
      amountIdx,
      reasonIdx,
    },
  };
};

export const parseFedexInvoiceCsv = (csvText: string): string[][] => {
  const t = String(csvText || "").trim();
  if (!t) return [];
  return parse(t, { skipFirstRow: false }) as string[][];
};

export const rowsToObjects = (grid: string[][]): { headers: string[]; rows: Record<string, string>[] } => {
  if (!grid.length) return { headers: [], rows: [] };
  const headers = (grid[0] || []).map((h) => String(h ?? "").trim());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r] || [];
    if (line.every((c) => String(c ?? "").trim() === "")) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `col_${c}`;
      obj[key] = String(line[c] ?? "").trim();
    }
    rows.push(obj);
  }
  return { headers, rows };
};

export const normalizeTrackingNumber = (s: string) =>
  String(s || "")
    .replace(/\s+/g, "")
    .trim();
