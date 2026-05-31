import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  binScanMatchesBox,
  labelScanMatchesTracking,
  parseBoxIdFromBinScan,
} from "../_shared/scanMatch.ts";

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

/** boxes.id is canonical; clients may pass internal_id by mistake. */
const resolveBoxPrimaryKey = async (
  supabase: ReturnType<typeof createClient>,
  raw: unknown,
): Promise<string> => {
  const id = String(raw || "").trim();
  if (!id) return "";

  const { data: byId, error: byIdError } = await supabase
    .from("boxes")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (byIdError) throw new Error(byIdError.message);
  if (byId?.id) return String(byId.id);

  const { data: byInternal, error: byInternalError } = await supabase
    .from("boxes")
    .select("id")
    .eq("internal_id", id)
    .maybeSingle();
  if (byInternalError) throw new Error(byInternalError.message);
  if (byInternal?.id) return String(byInternal.id);

  return id;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    if (action === "list_state") {
      const { data: assignments, error: assignmentError } = await supabase
        .from("bin_storage_assignments")
        .select("*")
        .eq("is_current", true);
      if (assignmentError) return jsonResponse({ error: assignmentError.message }, 500);

      const { data: bays, error: baysError } = await supabase
        .from("storage_bays")
        .select("*")
        .eq("is_active", true)
        .order("bay_code", { ascending: true });
      if (baysError) return jsonResponse({ error: baysError.message }, 500);

      return jsonResponse({ assignments: assignments || [], bays: bays || [] });
    }

    const boxIdRaw = String(body.boxId || "").trim();
    const actor = String(body.actor || "admin").trim();
    if (!boxIdRaw) return jsonResponse({ error: "boxId is required" }, 400);
    const boxId = await resolveBoxPrimaryKey(supabase, boxIdRaw);

    if (action === "assign_bay") {
      const bayCode = String(body.bayCode || "").trim().toUpperCase();
      if (!bayCode) return jsonResponse({ error: "bayCode is required" }, 400);

      const { error: clearCurrentError } = await supabase
        .from("bin_storage_assignments")
        .update({ is_current: false, released_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("box_id", boxId)
        .eq("is_current", true);
      if (clearCurrentError) return jsonResponse({ error: clearCurrentError.message }, 500);

      const { error: clearBayError } = await supabase
        .from("bin_storage_assignments")
        .update({ is_current: false, released_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("bay_code", bayCode)
        .eq("is_current", true);
      if (clearBayError) return jsonResponse({ error: clearBayError.message }, 500);

      const { data: inserted, error: insertError } = await supabase
        .from("bin_storage_assignments")
        .insert([
          {
            box_id: boxId,
            bay_code: bayCode,
            status: "assigned",
            assigned_by: actor,
            assigned_at: new Date().toISOString(),
            is_current: true,
          },
        ])
        .select("*")
        .single();
      if (insertError) return jsonResponse({ error: insertError.message }, 500);

      return jsonResponse({ ok: true, assignment: inserted });
    }

    if (action === "mark_placed") {
      const photoUrl = String(body.photoUrl || "").trim();
      const note = String(body.note || "").trim();

      const { data: assignment, error: assignmentError } = await supabase
        .from("bin_storage_assignments")
        .update({
          status: "placed",
          placed_at: new Date().toISOString(),
          placement_photo_url: photoUrl || null,
          placement_note: note || null,
          updated_at: new Date().toISOString(),
        })
        .eq("box_id", boxId)
        .eq("is_current", true)
        .select("*")
        .single();
      if (assignmentError) return jsonResponse({ error: assignmentError.message }, 500);

      const { error: boxError } = await supabase
        .from("boxes")
        .update({ status: "stored", fulfillment_status: "stored" })
        .eq("id", boxId);
      if (boxError) return jsonResponse({ error: boxError.message }, 500);

      return jsonResponse({ ok: true, assignment });
    }

    if (action === "mark_picked") {
      const { data: assignment, error: assignmentError } = await supabase
        .from("bin_storage_assignments")
        .update({
          status: "picked",
          picked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("box_id", boxId)
        .eq("is_current", true)
        .select("*")
        .single();
      if (assignmentError) return jsonResponse({ error: assignmentError.message }, 500);

      return jsonResponse({ ok: true, assignment });
    }

    if (action === "mark_qr_applied") {
      const binQrCode = String(body.binQrCode || "").trim();
      if (!binQrCode) {
        return jsonResponse(
          { error: "Scan the bin QR sticker and pass binQrCode (required to match labels later)" },
          400,
        );
      }

      const scanToken = parseBoxIdFromBinScan(binQrCode) || binQrCode;
      const scanBoxId = await resolveBoxPrimaryKey(supabase, scanToken);
      if (!binScanMatchesBox(binQrCode, boxId, null) && scanBoxId !== boxId) {
        return jsonResponse(
          {
            error:
              `Bin QR scan does not match this bin — scan the sticker on bin ${boxId} (paste the full /scan/… URL from the QR, not the bin number)`,
          },
          400,
        );
      }

      const { data: assignment, error: assignmentError } = await supabase
        .from("bin_storage_assignments")
        .update({
          status: "qr_applied",
          qr_applied_at: new Date().toISOString(),
          bin_qr_code: binQrCode,
          updated_at: new Date().toISOString(),
        })
        .eq("box_id", boxId)
        .eq("is_current", true)
        .select("*")
        .single();
      if (assignmentError) return jsonResponse({ error: assignmentError.message }, 500);

      return jsonResponse({
        ok: true,
        assignment,
        resolvedBoxId: parseBoxIdFromBinScan(binQrCode) || boxId,
      });
    }

    if (action === "mark_outbound_labeled") {
      const { data: assignment, error: assignmentError } = await supabase
        .from("bin_storage_assignments")
        .update({
          status: "outbound_labeled",
          outbound_labeled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("box_id", boxId)
        .eq("is_current", true)
        .select("*")
        .single();
      if (assignmentError) return jsonResponse({ error: assignmentError.message }, 500);

      return jsonResponse({ ok: true, assignment });
    }

    if (action === "mark_in_staging") {
      const { data: assignment, error: assignmentError } = await supabase
        .from("bin_storage_assignments")
        .update({
          status: "in_staging",
          staged_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("box_id", boxId)
        .eq("is_current", true)
        .select("*")
        .single();
      if (assignmentError) return jsonResponse({ error: assignmentError.message }, 500);

      return jsonResponse({ ok: true, assignment });
    }

    if (action === "mark_label_verified") {
      const labelQrCode = String(body.labelQrCode || "").trim();
      const shipmentIdRaw = String(body.shipmentId || "").trim();
      const binQrByBoxIdRaw = body.binQrByBoxId;
      const binQrScanSingle = String(body.binQrScan || "").trim();

      if (!labelQrCode) {
        return jsonResponse({ error: "labelQrCode is required" }, 400);
      }

      const now = new Date().toISOString();

      const assertLabelMatchesShipment = (
        ship: { tracking_number?: string | null; shipping_address?: unknown },
        shipmentId: string,
      ) => {
        const tracking = String(ship.tracking_number || "").trim();
        const addr = (ship.shipping_address || {}) as Record<string, unknown>;
        const metaTracking = String(addr.storkbin_label_match_tracking || "").trim();
        const expected = tracking || metaTracking;
        if (!expected) {
          return "Shipment has no tracking number yet — create the FedEx label first";
        }
        if (!labelScanMatchesTracking(labelQrCode, expected)) {
          return `Shipping label scan does not match this shipment's tracking (${expected}). Scan the barcode on the FedEx label for this package.`;
        }
        return null;
      };

      const singleBoxVerify = async (shipRow?: { tracking_number?: string | null; shipping_address?: unknown; id?: string }) => {
        if (shipRow?.id) {
          const labelErr = assertLabelMatchesShipment(shipRow, shipRow.id);
          if (labelErr) return jsonResponse({ error: labelErr }, 400);
        }

        const { data: asnBefore } = await supabase
          .from("bin_storage_assignments")
          .select("bin_qr_code, status")
          .eq("box_id", boxId)
          .eq("is_current", true)
          .maybeSingle();

        const binScan = binQrScanSingle || "";
        if (asnBefore?.bin_qr_code) {
          if (!binScan) {
            return jsonResponse(
              { error: "Scan the bin QR on this bin first, then scan the shipping label barcode" },
              400,
            );
          }
          if (!binScanMatchesBox(binScan, boxId, asnBefore.bin_qr_code)) {
            return jsonResponse({ error: "Bin QR scan does not match the sticker recorded for this bin" }, 400);
          }
        } else if (binScan && !binScanMatchesBox(binScan, boxId, null)) {
          return jsonResponse({ error: "Bin QR scan does not match this bin" }, 400);
        }

        const { data: assignment, error: assignmentError } = await supabase
          .from("bin_storage_assignments")
          .update({
            status: "label_verified",
            label_verified_at: now,
            label_qr_code: labelQrCode,
            updated_at: now,
          })
          .eq("box_id", boxId)
          .eq("is_current", true)
          .select("*")
          .single();
        if (assignmentError) return jsonResponse({ error: assignmentError.message }, 500);
        return jsonResponse({
          ok: true,
          assignment,
          scope: "single",
          matchedTracking: shipRow?.tracking_number || null,
        });
      };

      if (!shipmentIdRaw) {
        return await singleBoxVerify();
      }

      const { data: shipRow, error: shipErr } = await supabase
        .from("shipments")
        .select("id, shipment_direction, tracking_number, shipping_address")
        .eq("id", shipmentIdRaw)
        .maybeSingle();
      if (shipErr) return jsonResponse({ error: shipErr.message }, 500);
      if (!shipRow?.id) {
        return jsonResponse({ error: "Shipment not found for shipmentId" }, 404);
      }

      const labelErr = assertLabelMatchesShipment(shipRow, shipmentIdRaw);
      if (labelErr) return jsonResponse({ error: labelErr }, 400);

      const { data: shipBoxes, error: sbErr } = await supabase
        .from("shipment_boxes")
        .select("box_id")
        .eq("shipment_id", shipmentIdRaw);
      if (sbErr) return jsonResponse({ error: sbErr.message }, 500);

      const shipBoxIds = [...new Set((shipBoxes || []).map((r) => String(r.box_id)))];
      if (!shipBoxIds.length) {
        return jsonResponse({ error: "No bins linked to this shipment" }, 400);
      }
      if (!shipBoxIds.includes(boxId)) {
        return jsonResponse({ error: "boxId is not linked to this shipment" }, 400);
      }

      const { data: kitBoxes, error: kitErr } = await supabase
        .from("boxes")
        .select("id, fulfillment_status")
        .in("id", shipBoxIds);
      if (kitErr) return jsonResponse({ error: kitErr.message }, 500);

      const allStarterOutbound =
        (kitBoxes?.length || 0) > 0 &&
        (kitBoxes || []).every((b) => b.fulfillment_status === "paid_waiting_to_ship_bin") &&
        shipRow.shipment_direction === "to_customer";

      if (!allStarterOutbound) {
        return await singleBoxVerify(shipRow);
      }

      if (typeof binQrByBoxIdRaw !== "object" || binQrByBoxIdRaw === null || Array.isArray(binQrByBoxIdRaw)) {
        return jsonResponse(
          {
            error:
              "Starter kit shipments require binQrByBoxId: an object mapping each box_id to the scanned bin QR value",
          },
          400,
        );
      }

      const binQrByBoxId = binQrByBoxIdRaw as Record<string, unknown>;
      const needOutbound: string[] = [];

      for (const bid of shipBoxIds) {
        const scan = String(binQrByBoxId[bid] ?? "").trim();
        if (!scan) {
          return jsonResponse({ error: `Missing bin QR scan for box ${bid}` }, 400);
        }

        const { data: asn, error: asnErr } = await supabase
          .from("bin_storage_assignments")
          .select("bin_qr_code, status")
          .eq("box_id", bid)
          .eq("is_current", true)
          .maybeSingle();
        if (asnErr) return jsonResponse({ error: asnErr.message }, 500);
        if (!asn?.bin_qr_code || !String(asn.bin_qr_code).trim()) {
          return jsonResponse({ error: `Bin ${bid} has no recorded bin QR (apply bin sticker first)` }, 400);
        }
        if (String(asn.bin_qr_code).trim() !== scan) {
          return jsonResponse({ error: `Bin QR scan does not match recorded code for box ${bid}` }, 400);
        }
        if (asn.status !== "qr_applied" && asn.status !== "outbound_labeled") {
          return jsonResponse(
            { error: `Box ${bid} must be qr_applied or outbound_labeled before label verify (got ${asn.status})` },
            400,
          );
        }
        if (asn.status === "qr_applied") {
          needOutbound.push(bid);
        }
      }

      if (needOutbound.length) {
        const { error: obErr } = await supabase
          .from("bin_storage_assignments")
          .update({
            status: "outbound_labeled",
            outbound_labeled_at: now,
            updated_at: now,
          })
          .in("box_id", needOutbound)
          .eq("is_current", true)
          .eq("status", "qr_applied");
        if (obErr) return jsonResponse({ error: obErr.message }, 500);
      }

      const { data: updatedRows, error: lvErr } = await supabase
        .from("bin_storage_assignments")
        .update({
          status: "label_verified",
          label_verified_at: now,
          label_qr_code: labelQrCode,
          updated_at: now,
        })
        .in("box_id", shipBoxIds)
        .eq("is_current", true)
        .select("*");
      if (lvErr) return jsonResponse({ error: lvErr.message }, 500);

      return jsonResponse({
        ok: true,
        assignments: updatedRows || [],
        scope: "starter_kit",
        matchedTracking: shipRow.tracking_number,
        shipmentRef: (shipRow.shipping_address as Record<string, unknown>)?.storkbin_shipment_ref || null,
      });
    }

    return jsonResponse({ error: "Unsupported action" }, 400);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
