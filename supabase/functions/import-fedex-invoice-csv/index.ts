import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { notifyShippingOverageDetected } from "../_shared/shippingLabelNotifications.ts";
import {
  normalizeTrackingNumber,
  parseFedexInvoiceCsv,
  parseMoneyToCents,
  resolveFedexInvoiceColumns,
  rowsToObjects,
} from "../_shared/fedexInvoiceCsvImport.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const adminEmails = () =>
  (Deno.env.get("ADMIN_EMAILS") || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

const requireAdminSupabase = async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return { error: jsonResponse({ error: "Missing Supabase configuration" }, 500) };
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { error: jsonResponse({ error: "Missing auth token" }, 401) };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: authUser, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authUser?.user) {
    return { error: jsonResponse({ error: "Invalid auth token" }, 401) };
  }
  const email = String(authUser.user.email || "").trim().toLowerCase();
  if (!adminEmails().includes(email)) {
    return { error: jsonResponse({ error: "Admin access required" }, 403) };
  }

  return { supabase };
};

const quotedCentsFromShipment = (shipment: Record<string, unknown>): number | null => {
  if (shipment.label_quoted_amount_cents != null && Number.isFinite(Number(shipment.label_quoted_amount_cents))) {
    return Math.round(Number(shipment.label_quoted_amount_cents));
  }
  const d = Number(shipment.shipping_cost ?? shipment.shipping_estimate ?? 0);
  if (Number.isFinite(d) && d > 0) return Math.round(d * 100);
  return null;
};

const buildReasonSummary = (
  rowObj: Record<string, string>,
  reasonIdx: number,
  headers: string[],
  billedCents: number,
  quotedCents: number | null,
) => {
  const parts: string[] = [];
  parts.push(`FedEx invoice CSV import — billed ${(billedCents / 100).toFixed(2)} vs quoted ${
    quotedCents == null ? "unknown" : (quotedCents / 100).toFixed(2)
  }.`);
  if (reasonIdx >= 0 && headers[reasonIdx]) {
    const v = rowObj[headers[reasonIdx]] || "";
    if (v) parts.push(`Line detail (${headers[reasonIdx]}): ${v}`);
  }
  return parts.join("\n");
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const gate = await requireAdminSupabase(req);
  if ("error" in gate) return gate.error;
  const { supabase } = gate;

  try {
    const body = await req.json().catch(() => ({}));
    const csvText = String(body.csvText || "");
    if (!csvText.trim()) {
      return jsonResponse({ error: "csvText is required" }, 400);
    }

    const explicit = body.columnMap && typeof body.columnMap === "object"
      ? body.columnMap as { tracking?: string; invoice?: string; amount?: string; reason?: string }
      : undefined;

    let grid: string[][];
    try {
      grid = parseFedexInvoiceCsv(csvText);
    } catch (e) {
      return jsonResponse(
        { error: `CSV parse failed: ${e instanceof Error ? e.message : String(e)}` },
        400,
      );
    }

    const { headers, rows: rowObjects } = rowsToObjects(grid);
    if (!headers.length) {
      return jsonResponse({ error: "CSV has no header row" }, 400);
    }

    const col = resolveFedexInvoiceColumns(headers, explicit);
    if (!col.ok) {
      return jsonResponse({ error: col.error, headers }, 400);
    }
    const { map } = col;

    const stats = {
      rowCount: rowObjects.length,
      parsedRows: 0,
      matchedShipments: 0,
      matchedNoOverage: 0,
      overagesCreated: 0,
      duplicatesSkipped: 0,
      skippedMissingFields: 0,
      skippedNoQuoteBaseline: 0,
      ambiguousShipmentMatches: 0,
      parseErrors: [] as Array<{ rowIndex: number; message: string }>,
      unmatched: [] as Array<{
        rowIndex: number;
        tracking: string;
        invoice: string | null;
        billedCents: number | null;
        raw: Record<string, string>;
      }>,
      createdEventIds: [] as string[],
    };

    for (let i = 0; i < rowObjects.length; i++) {
      const rowObj = rowObjects[i];
      const rowIndex = i + 2;
      const trackRaw = map.trackingIdx >= 0 ? String(rowObj[headers[map.trackingIdx]] || "").trim() : "";
      const tracking = normalizeTrackingNumber(trackRaw);
      const invRaw = map.invoiceIdx >= 0 ? String(rowObj[headers[map.invoiceIdx]] || "").trim() : "";
      const invoiceRef = invRaw || null;
      const amtRaw = map.amountIdx >= 0 ? String(rowObj[headers[map.amountIdx]] || "").trim() : "";
      const billedCents = parseMoneyToCents(amtRaw);

      if (!tracking || billedCents == null) {
        stats.skippedMissingFields += 1;
        stats.parseErrors.push({
          rowIndex: rowIndex,
          message: !tracking ? "missing tracking" : "missing or invalid amount",
        });
        continue;
      }

      stats.parsedRows += 1;

      const { data: shipments, error: shipErr } = await supabase
        .from("shipments")
        .select(
          "id, box_id, user_id, tracking_number, tracking_url, label_quoted_amount_cents, shipping_cost, shipping_estimate",
        )
        .eq("tracking_number", tracking)
        .limit(3);

      if (shipErr) {
        stats.parseErrors.push({ rowIndex, message: shipErr.message });
        continue;
      }

      if ((shipments || []).length > 1) {
        stats.ambiguousShipmentMatches += 1;
      }

      const shipment = (shipments || [])[0] as Record<string, unknown> | undefined;
      if (!shipment) {
        stats.unmatched.push({
          rowIndex,
          tracking,
          invoice: invoiceRef,
          billedCents,
          raw: { ...rowObj },
        });
        continue;
      }

      stats.matchedShipments += 1;

      const quotedCents = quotedCentsFromShipment(shipment);
      if (quotedCents == null) {
        stats.skippedNoQuoteBaseline += 1;
        stats.parseErrors.push({
          rowIndex: rowIndex,
          message: "matched shipment but no label_quoted_amount_cents or shipping_cost/estimate",
        });
        continue;
      }

      if (billedCents <= quotedCents) {
        stats.matchedNoOverage += 1;
        continue;
      }

      const overageCents = billedCents - quotedCents;

      let dupQuery = supabase
        .from("shipping_overage_events")
        .select("id")
        .eq("fedex_tracking_number", tracking)
        .eq("carrier_billed_amount_cents", billedCents);
      if (invoiceRef) {
        dupQuery = dupQuery.eq("fedex_invoice_reference", invoiceRef);
      } else {
        dupQuery = dupQuery.is("fedex_invoice_reference", null);
      }

      const { data: dup, error: dupErr } = await dupQuery.maybeSingle();
      if (dupErr) {
        stats.parseErrors.push({ rowIndex, message: dupErr.message });
        continue;
      }
      if (dup?.id) {
        stats.duplicatesSkipped += 1;
        continue;
      }

      let boxId = String(shipment.box_id || "").trim() || null;
      if (!boxId) {
        const { data: link } = await supabase
          .from("shipment_boxes")
          .select("box_id")
          .eq("shipment_id", String(shipment.id))
          .limit(1)
          .maybeSingle();
        if (link?.box_id) boxId = String(link.box_id);
      }
      const userId = String(shipment.user_id || "").trim() || null;

      const reasonSummary = buildReasonSummary(rowObj, map.reasonIdx, headers, billedCents, quotedCents);
      const reasonCodes = map.reasonIdx >= 0 && headers[map.reasonIdx] && rowObj[headers[map.reasonIdx]]
        ? [String(rowObj[headers[map.reasonIdx]] || "")]
        : null;

      const insertRow: Record<string, unknown> = {
        shipment_id: shipment.id,
        box_id: boxId,
        user_id: userId,
        source: "fedex_invoice_csv",
        fedex_tracking_number: tracking,
        fedex_invoice_reference: invoiceRef,
        original_estimated_amount_cents: quotedCents,
        carrier_billed_amount_cents: billedCents,
        overage_amount_cents: overageCents,
        reason_codes: reasonCodes,
        raw_carrier_payload: rowObj,
        detection_status: "detected",
        notes: `Imported from FedEx billing CSV (row ${rowIndex}).`,
      };

      const { data: created, error: insErr } = await supabase
        .from("shipping_overage_events")
        .insert([insertRow])
        .select("*")
        .single();

      if (insErr) {
        if (/duplicate|unique/i.test(insErr.message)) {
          stats.duplicatesSkipped += 1;
          continue;
        }
        stats.parseErrors.push({ rowIndex, message: insErr.message });
        continue;
      }

      stats.overagesCreated += 1;
      stats.createdEventIds.push(String(created.id));

      const notify = await notifyShippingOverageDetected({
        eventId: String(created.id),
        shipmentId: String(shipment.id),
        boxId,
        userId,
        trackingNumber: String(shipment.tracking_number || tracking),
        overageAmountCents: overageCents,
        carrierBilledAmountCents: billedCents,
        originalEstimatedAmountCents: quotedCents,
        reasonSummary,
      });

      if (notify.ok) {
        await supabase
          .from("shipping_overage_events")
          .update({ admin_alert_sent_at: new Date().toISOString() })
          .eq("id", created.id);
      }
    }

    return jsonResponse({ ok: true, stats, columnMap: map, headers });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
