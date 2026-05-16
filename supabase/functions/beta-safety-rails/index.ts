import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { escapeHtml, notifyBetaSafetyRailDigest } from "../_shared/shippingLabelNotifications.ts";

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

const numEnv = (key: string, fallback: number) => {
  const n = Number(Deno.env.get(key) || "");
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

type ShipRow = {
  id: string;
  box_id: string | null;
  shipping_status: string | null;
  charge_status: string | null;
  label_status: string | null;
  label_failure_reason: string | null;
  tracking_number: string | null;
  last_tracking_poll_at: string | null;
  label_purchased_at: string | null;
  created_at: string | null;
  charge_attempted_at: string | null;
  beta_rail_last_alert_at: string | null;
  admin_suppress_rail_alerts_until: string | null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" }, 500);
    }

    const stuckLabelHours = numEnv("BETA_RAIL_STUCK_LABEL_CREATED_HOURS", 48);
    const staleTrackHours = numEnv("BETA_RAIL_STALE_TRACKING_HOURS", 72);
    const paidNoLabelHours = numEnv("BETA_RAIL_PAID_NO_LABEL_HOURS", 6);
    const alertThrottleHours = numEnv("BETA_RAIL_ALERT_THROTTLE_HOURS", 24);

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const now = new Date();

    const sel =
      "id,box_id,shipping_status,charge_status,label_status,label_failure_reason,tracking_number,last_tracking_poll_at,label_purchased_at,created_at,charge_attempted_at,beta_rail_last_alert_at,admin_suppress_rail_alerts_until";

    const [a, b, c, d, e] = await Promise.all([
      supabase.from("shipments").select(sel).eq("shipping_status", "label_created").limit(200),
      supabase
        .from("shipments")
        .select(sel)
        .eq("charge_status", "paid")
        .eq("shipping_status", "paid")
        .eq("label_status", "needed")
        .limit(200),
      supabase.from("shipments").select(sel).eq("charge_status", "paid").eq("label_status", "purchase_failed").limit(200),
      supabase.from("shipments").select(sel).eq("label_status", "created").not("tracking_number", "is", null).limit(200),
      supabase.from("shipments").select(sel).eq("charge_status", "paid").not("label_failure_reason", "is", null).limit(100),
    ]);

    const loadErr = a.error || b.error || c.error || d.error || e.error;
    if (loadErr) {
      return jsonResponse({ error: loadErr.message }, 500);
    }

    const rowsById = new Map<string, ShipRow>();
    for (
      const row of [...(a.data || []), ...(b.data || []), ...(c.data || []), ...(d.data || []), ...(e.data || [])] as ShipRow[]
    ) {
      rowsById.set(row.id, row);
    }
    const all = [...rowsById.values()];
    const issues: Array<{ shipmentId: string; boxId: string | null; kind: string; detail: string }> = [];

    const suppressOk = (s: ShipRow) => {
      const u = s.admin_suppress_rail_alerts_until ? new Date(s.admin_suppress_rail_alerts_until).getTime() : 0;
      return u > now.getTime();
    };

    const throttleOk = (s: ShipRow) => {
      const t = s.beta_rail_last_alert_at ? new Date(s.beta_rail_last_alert_at).getTime() : 0;
      if (!t) return true;
      return now.getTime() - t > alertThrottleHours * 3600_000;
    };

    /** Best-effort “how long has this row been in this situation” without `shipments.updated_at`. */
    const anchor = (s: ShipRow) => {
      const lp = s.label_purchased_at ? new Date(s.label_purchased_at).getTime() : 0;
      const ca = s.charge_attempted_at ? new Date(s.charge_attempted_at).getTime() : 0;
      const cr = s.created_at ? new Date(s.created_at).getTime() : 0;
      const lt = s.last_tracking_poll_at ? new Date(s.last_tracking_poll_at).getTime() : 0;
      return Math.max(lp, ca, cr, lt) || 0;
    };

    for (const s of all) {
      if (suppressOk(s)) continue;

      const charge = String(s.charge_status || "");
      const shipSt = String(s.shipping_status || "");
      const lab = String(s.label_status || "");

      if (charge === "paid" && (lab === "purchase_failed" || Boolean(s.label_failure_reason))) {
        if (throttleOk(s)) {
          issues.push({
            shipmentId: s.id,
            boxId: s.box_id,
            kind: "label_purchase_failed_after_payment",
            detail: String(s.label_failure_reason || "purchase_failed").slice(0, 400),
          });
        }
        continue;
      }

      if (charge === "paid" && shipSt === "paid" && (lab === "needed" || !lab)) {
        const paidAnchor = s.charge_attempted_at ? new Date(s.charge_attempted_at).getTime() : anchor(s);
        if (paidAnchor && now.getTime() - paidAnchor > paidNoLabelHours * 3600_000 && throttleOk(s)) {
          issues.push({
            shipmentId: s.id,
            boxId: s.box_id,
            kind: "paid_missing_label",
            detail: `label_status=${lab || "null"}`,
          });
        }
      }

      if (shipSt === "label_created") {
        const a = anchor(s);
        if (a && now.getTime() - a > stuckLabelHours * 3600_000 && throttleOk(s)) {
          issues.push({
            shipmentId: s.id,
            boxId: s.box_id,
            kind: "stuck_label_created",
            detail: `since label/update ${new Date(a).toISOString()}`,
          });
        }
      }

      const tn = String(s.tracking_number || "").trim();
      if (charge === "paid" && tn && lab === "created" && shipSt !== "delivered") {
        const last = s.last_tracking_poll_at ? new Date(s.last_tracking_poll_at).getTime() : 0;
        const stale = !last || now.getTime() - last > staleTrackHours * 3600_000;
        if (stale && throttleOk(s)) {
          issues.push({
            shipmentId: s.id,
            boxId: s.box_id,
            kind: "tracking_not_updated",
            detail: `last_tracking_poll_at=${s.last_tracking_poll_at || "null"}`,
          });
        }
      }
    }

    const byId = new Map<string, (typeof issues)[0]>();
    for (const i of issues) {
      if (!byId.has(i.shipmentId)) byId.set(i.shipmentId, i);
    }
    const unique = [...byId.values()];

    const summary = {
      scanned: all.length,
      issues: unique.length,
      kinds: unique.reduce<Record<string, number>>((acc, i) => {
        acc[i.kind] = (acc[i.kind] || 0) + 1;
        return acc;
      }, {}),
    };

    await supabase.from("beta_ops_heartbeat").upsert(
      {
        id: "safety_rails",
        last_run_at: now.toISOString(),
        last_summary: summary,
      },
      { onConflict: "id" },
    );

    if (unique.length === 0) {
      return jsonResponse({ ok: true, ...summary, emailed: false });
    }

    const rowsHtml = unique
      .map(
        (i) =>
          `<tr><td>${escapeHtml(i.kind)}</td><td>${escapeHtml(i.shipmentId)}</td><td>${escapeHtml(
            String(i.boxId || "—"),
          )}</td><td>${escapeHtml(i.detail)}</td></tr>`,
      )
      .join("");

    const html = `
      <p><strong>StorkBin beta — shipment safety digest</strong></p>
      <p>${unique.length} open issue(s). Review in <strong>Admin → Beta health</strong> and bin detail.</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
        <thead><tr><th>Kind</th><th>Shipment</th><th>Bin</th><th>Detail</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    const notify = await notifyBetaSafetyRailDigest(`[StorkBin Ops] Beta shipment alerts (${unique.length})`, html);

    const stamp = now.toISOString();
    for (const i of unique) {
      await supabase.from("shipments").update({ beta_rail_last_alert_at: stamp }).eq("id", i.shipmentId);
    }

    return jsonResponse({
      ok: true,
      ...summary,
      emailed: notify.ok,
      emailSkipped: notify.skipped,
      emailError: notify.error,
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
