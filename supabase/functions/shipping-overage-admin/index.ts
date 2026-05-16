import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { notifyShippingOverageDetected } from "../_shared/shippingLabelNotifications.ts";

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

  return { supabase, adminEmail: email };
};

const enrichEvents = async (
  supabase: ReturnType<typeof createClient>,
  events: Array<Record<string, unknown>>,
) => {
  if (!events.length) return [];

  const shipmentIds = [...new Set(events.map((e) => String(e.shipment_id || "")).filter(Boolean))];
  const userIds = [...new Set(events.map((e) => String(e.user_id || "")).filter(Boolean))];
  const boxIds = [...new Set(events.map((e) => String(e.box_id || "")).filter(Boolean))];

  const { data: ships } = await supabase
    .from("shipments")
    .select(
      "id, tracking_number, tracking_url, shipment_direction, label_quoted_amount_cents, shipping_cost, shipping_estimate, box_id, user_id",
    )
    .in("id", shipmentIds);

  const shipById = new Map((ships || []).map((s: { id: string }) => [String(s.id), s]));

  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, email, full_name").in("id", userIds)
    : { data: [] as Array<Record<string, unknown>> };

  const profileById = new Map((profiles || []).map((p: { id: string }) => [String(p.id), p]));

  const { data: boxes } = boxIds.length
    ? await supabase.from("boxes").select("id, box_number, user_id").in("id", boxIds)
    : { data: [] as Array<Record<string, unknown>> };

  const boxById = new Map((boxes || []).map((b: { id: string }) => [String(b.id), b]));

  return events.map((ev) => {
    const sid = String(ev.shipment_id || "");
    const ship = shipById.get(sid) as Record<string, unknown> | undefined;
    const uid = String(ev.user_id || ship?.user_id || "");
    const bid = String(ev.box_id || ship?.box_id || "");
    const profile = profileById.get(uid) as Record<string, unknown> | undefined;
    const box = boxById.get(bid) as Record<string, unknown> | undefined;
    return {
      ...ev,
      shipment_tracking_number: ship?.tracking_number || null,
      shipment_tracking_url: ship?.tracking_url || null,
      shipment_direction: ship?.shipment_direction || null,
      customer_email: profile?.email || null,
      customer_name: profile?.full_name || null,
      box_number: box?.box_number || null,
    };
  });
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const gate = await requireAdminSupabase(req);
  if ("error" in gate) return gate.error;
  const { supabase, adminEmail } = gate;

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    if (action === "list") {
      const { data: events, error } = await supabase
        .from("shipping_overage_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(150);

      if (error) return jsonResponse({ error: error.message }, 500);
      const enriched = await enrichEvents(supabase, (events || []) as Array<Record<string, unknown>>);
      const openCount = (events || []).filter((e) => String(e.detection_status) === "detected").length;
      return jsonResponse({ ok: true, events: enriched, openCount });
    }

    if (action === "create") {
      const shipmentId = String(body.shipmentId || "").trim();
      const carrierBilledCents = Number(body.carrierBilledAmountCents);
      if (!shipmentId) return jsonResponse({ error: "shipmentId is required" }, 400);
      if (!Number.isFinite(carrierBilledCents) || carrierBilledCents < 0) {
        return jsonResponse({ error: "carrierBilledAmountCents must be a non-negative number (cents)" }, 400);
      }

      const { data: shipment, error: shipErr } = await supabase
        .from("shipments")
        .select("id, box_id, user_id, tracking_number, label_quoted_amount_cents, shipping_cost, shipping_estimate")
        .eq("id", shipmentId)
        .maybeSingle();

      if (shipErr) return jsonResponse({ error: shipErr.message }, 500);
      if (!shipment) return jsonResponse({ error: "Shipment not found" }, 404);

      let boxId = String(shipment.box_id || "").trim() || null;
      if (!boxId) {
        const { data: link } = await supabase
          .from("shipment_boxes")
          .select("box_id")
          .eq("shipment_id", shipmentId)
          .limit(1)
          .maybeSingle();
        if (link?.box_id) boxId = String(link.box_id);
      }

      const userId = String(shipment.user_id || "").trim() || null;

      const quotedFromRow =
        shipment.label_quoted_amount_cents != null && Number.isFinite(Number(shipment.label_quoted_amount_cents))
          ? Math.round(Number(shipment.label_quoted_amount_cents))
          : null;
      const dollars = Number(shipment.shipping_cost ?? shipment.shipping_estimate ?? 0);
      const quotedFromMoney =
        quotedFromRow == null && Number.isFinite(dollars) && dollars > 0
          ? Math.round(dollars * 100)
          : quotedFromRow;

      const originalEstimated = body.originalEstimatedAmountCents != null &&
          Number.isFinite(Number(body.originalEstimatedAmountCents))
        ? Math.round(Number(body.originalEstimatedAmountCents))
        : quotedFromMoney;

      let overageCents = body.overageAmountCents != null && Number.isFinite(Number(body.overageAmountCents))
        ? Math.round(Number(body.overageAmountCents))
        : null;
      if (overageCents == null && originalEstimated != null) {
        overageCents = Math.max(0, carrierBilledCents - originalEstimated);
      }

      const reasonCodes = body.reasonCodes ?? null;
      const notes = String(body.notes || "").trim() || null;
      const fedexInvoiceReference = String(body.fedexInvoiceReference || "").trim() || null;
      const source = String(body.source || "manual_admin").trim() || "manual_admin";

      const reasonSummary =
        notes ||
        (typeof reasonCodes === "string" ? reasonCodes : JSON.stringify(reasonCodes || {})) ||
        "Carrier adjustment recorded (no detail text).";

      const insertRow: Record<string, unknown> = {
        shipment_id: shipmentId,
        box_id: boxId,
        user_id: userId,
        source,
        fedex_tracking_number: String(shipment.tracking_number || "").trim() || null,
        fedex_invoice_reference: fedexInvoiceReference,
        original_estimated_amount_cents: originalEstimated,
        carrier_billed_amount_cents: carrierBilledCents,
        overage_amount_cents: overageCents,
        reason_codes: reasonCodes,
        raw_carrier_payload: body.rawCarrierPayload && typeof body.rawCarrierPayload === "object"
          ? body.rawCarrierPayload
          : null,
        detection_status: "detected",
        notes,
      };

      const { data: created, error: insErr } = await supabase
        .from("shipping_overage_events")
        .insert([insertRow])
        .select("*")
        .single();

      if (insErr) return jsonResponse({ error: insErr.message }, 500);

      const notify = await notifyShippingOverageDetected({
        eventId: String(created.id),
        shipmentId,
        boxId,
        userId,
        trackingNumber: String(shipment.tracking_number || "").trim() || null,
        overageAmountCents: overageCents,
        carrierBilledAmountCents: carrierBilledCents,
        originalEstimatedAmountCents: originalEstimated,
        reasonSummary,
      });

      const alertAt = new Date().toISOString();
      if (notify.ok) {
        await supabase
          .from("shipping_overage_events")
          .update({ admin_alert_sent_at: alertAt })
          .eq("id", created.id);
      }

      return jsonResponse({
        ok: true,
        event: created,
        notify,
      });
    }

    if (action === "update_status") {
      const id = String(body.id || "").trim();
      const detectionStatus = String(body.detectionStatus || "").trim().toLowerCase();
      if (!id) return jsonResponse({ error: "id is required" }, 400);

      const allowed = new Set(["reviewed", "dismissed", "approved", "rejected"]);
      if (!allowed.has(detectionStatus)) {
        return jsonResponse({ error: `detectionStatus must be one of: ${[...allowed].join(", ")}` }, 400);
      }

      const now = new Date().toISOString();
      const updates: Record<string, unknown> = {
        detection_status: detectionStatus,
        updated_at: now,
        reviewed_at: now,
        reviewed_by: adminEmail,
      };

      if (detectionStatus === "dismissed") {
        updates.dismissed_at = now;
        updates.dismissed_by = adminEmail;
      }

      if (String(body.notes || "").trim()) {
        updates.notes = String(body.notes || "").trim();
      }

      const { data: updated, error: upErr } = await supabase
        .from("shipping_overage_events")
        .update(updates)
        .eq("id", id)
        .select("*")
        .single();

      if (upErr) return jsonResponse({ error: upErr.message }, 500);
      return jsonResponse({ ok: true, event: updated });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
