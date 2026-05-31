import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { attachStarterEmptyBinPackageMeta } from "../_shared/fedexPurchaseLabel.ts";
import {
  describeStarterEmptyStackPackage,
  FEDEX_SANDBOX_SAMPLE_LANE,
  getShippingQuote,
  hasValidAddressForQuote,
  withFedexShipMeta,
} from "../_shared/fedexShippingRates.ts";
import { isFedexRateDebugEnabled, isFedexSandboxEnv } from "../_shared/fedexAuth.ts";
import {
  enableStorkbinFedexRateFailureCapture,
  takeStorkbinFedexRateFailure,
} from "../_shared/storkbinFedexRateFailureDiagnostic.ts";

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
  (Deno.env.get("ADMIN_EMAILS") || "adamwcordell@gmail.com")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Supabase configuration" }, 500);
    }

    const token = String(req.headers.get("authorization") || req.headers.get("Authorization") || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    if (!token) return jsonResponse({ error: "Missing auth token" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: authUser, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authUser?.user) return jsonResponse({ error: "Invalid auth token" }, 401);
    if (!adminEmails().includes(String(authUser.user.email || "").trim().toLowerCase())) {
      return jsonResponse({ error: "Admin access required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const shipmentId = String(body.shipmentId || "").trim();
    if (!shipmentId) return jsonResponse({ error: "shipmentId is required" }, 400);

    const { data: shipment, error: shipErr } = await supabase
      .from("shipments")
      .select("id,shipment_direction,shipping_address,shipping_status,charge_status,label_status")
      .eq("id", shipmentId)
      .maybeSingle();

    if (shipErr) return jsonResponse({ error: shipErr.message }, 500);
    if (!shipment) return jsonResponse({ error: "Shipment not found" }, 404);

    if (String(shipment.shipment_direction || "") !== "to_customer") {
      return jsonResponse({ error: "Only outbound (to_customer) starter shipments can be quoted here" }, 400);
    }

    const { data: srows, error: sbErr } = await supabase
      .from("shipment_boxes")
      .select("box_id")
      .eq("shipment_id", shipmentId);
    if (sbErr) return jsonResponse({ error: sbErr.message }, 500);

    const boxIds = [
      ...new Set((srows || []).map((r: { box_id: string }) => String(r.box_id)).filter(Boolean)),
    ];
    if (!boxIds.length) return jsonResponse({ error: "Shipment has no linked bins" }, 400);

    const { data: boxRows, error: boxErr } = await supabase
      .from("boxes")
      .select("id,fulfillment_status,checkout_status")
      .in("id", boxIds);
    if (boxErr) return jsonResponse({ error: boxErr.message }, 500);

    const byId = new Map(
      (boxRows || []).map((b: { id: string; fulfillment_status?: string | null }) => [
        String(b.id),
        String(b.fulfillment_status || ""),
      ]),
    );
    const allStarter =
      boxIds.every((id) => byId.has(id)) &&
      boxIds.every((id) => byId.get(id) === "paid_waiting_to_ship_bin");
    if (!allStarter) {
      return jsonResponse({ error: "This shipment is not a starter kit outbound shipment" }, 400);
    }

    const pieceCount = boxIds.length;
    const addressRaw = (shipment.shipping_address || {}) as Record<string, unknown>;
    const addressWithPackage = attachStarterEmptyBinPackageMeta(addressRaw, pieceCount);
    const packageSummary = describeStarterEmptyStackPackage(pieceCount);

    if (!hasValidAddressForQuote(addressWithPackage)) {
      return jsonResponse(
        {
          error: "Shipment is missing a complete customer address (street, city, state, ZIP)",
          package: packageSummary,
        },
        400,
      );
    }

    const action = String(body.action || "quote").trim().toLowerCase();

    if (action === "save_selection") {
      const serviceType = String(body.fedexServiceType || "").trim();
      const serviceName = String(body.fedexServiceName || "").trim();
      const amountUsd = Number(body.amountUsd);
      const dimensionsConfirmed = body.dimensionsConfirmed === true;

      if (!serviceType || !Number.isFinite(amountUsd) || amountUsd <= 0) {
        return jsonResponse({ error: "fedexServiceType and amountUsd are required" }, 400);
      }
      if (!dimensionsConfirmed) {
        return jsonResponse({ error: "dimensionsConfirmed must be true before purchasing a label" }, 400);
      }

      const merged = withFedexShipMeta(addressWithPackage, {
        serviceType,
        serviceName: serviceName || serviceType,
        estimatedDeliveryDate: body.estimatedDeliveryDate ? String(body.estimatedDeliveryDate) : null,
        estimatedDeliveryWeekday: body.estimatedDeliveryWeekday
          ? String(body.estimatedDeliveryWeekday)
          : null,
        transitTimeRaw: body.transitTimeRaw ? String(body.transitTimeRaw) : null,
        deliverySummary: body.deliverySummary ? String(body.deliverySummary) : null,
      });

      const { error: upErr } = await supabase
        .from("shipments")
        .update({
          shipping_address: merged,
          shipping_cost: amountUsd,
          shipping_estimate: amountUsd,
        })
        .eq("id", shipmentId);

      if (upErr) return jsonResponse({ error: upErr.message }, 500);

      return jsonResponse({
        ok: true,
        shipmentId,
        savedServiceType: serviceType,
        savedAmountUsd: amountUsd,
        package: packageSummary,
      });
    }

    const debugSampleLaneRequested =
      body.debugSampleLane === true ||
      String(Deno.env.get("STORKBIN_FEDEX_DEBUG_SAMPLE_LANE") || "").trim() === "1";
    if (debugSampleLaneRequested && !isFedexSandboxEnv()) {
      return jsonResponse({ error: "debugSampleLane is allowed in FedEx sandbox only" }, 400);
    }
    const debugSampleLane = debugSampleLaneRequested && isFedexSandboxEnv();

    const fedexRateDebug = isFedexRateDebugEnabled();

    if (debugSampleLane && fedexRateDebug) {
      console.error(
        JSON.stringify({
          STORKBIN_FEDEX_DEBUG_SAMPLE_LANE: {
            lane: `${FEDEX_SANDBOX_SAMPLE_LANE.originPostalCode}→${FEDEX_SANDBOX_SAMPLE_LANE.destinationPostalCode}`,
            packageProfile: "starter_empty_multi",
            pieceCount,
            note: "Rating postals only; same package dims/weight as production quote. Shipment address unchanged.",
          },
        }),
      );
    }

    if (fedexRateDebug) {
      enableStorkbinFedexRateFailureCapture({
        debugRateLane: debugSampleLane
          ? {
              mode: "sandbox_sample",
              originPostalCode: FEDEX_SANDBOX_SAMPLE_LANE.originPostalCode,
              destinationPostalCode: FEDEX_SANDBOX_SAMPLE_LANE.destinationPostalCode,
            }
          : null,
      });
    }
    const quote = await getShippingQuote({
      boxId: boxIds[0],
      direction: "to_customer",
      shippingAddress: addressWithPackage,
      packageProfile: "starter_empty_multi",
      emptyPieceCount: pieceCount,
      debugFedexSampleLane: debugSampleLane,
    });

    return jsonResponse({
      ok: true,
      shipmentId,
      pieceCount,
      ...(debugSampleLane
        ? {
            debugSampleLane: true,
            debugRateLane: {
              mode: "sandbox_sample",
              originPostalCode: FEDEX_SANDBOX_SAMPLE_LANE.originPostalCode,
              destinationPostalCode: FEDEX_SANDBOX_SAMPLE_LANE.destinationPostalCode,
            },
          }
        : {}),
      package: packageSummary,
      destination: {
        city: String(addressWithPackage.city || ""),
        state: String(addressWithPackage.state || ""),
        zip: String(addressWithPackage.zip || ""),
      },
      options: quote.options,
      cheapest: {
        serviceType: quote.serviceType,
        serviceName: quote.serviceName,
        amountUsd: quote.amountUsd,
        estimatedDeliveryDate: quote.estimatedDeliveryDate,
        estimatedDeliveryWeekday: quote.estimatedDeliveryWeekday,
        transitTimeRaw: quote.transitTimeRaw,
        deliverySummary: quote.deliverySummary,
      },
    });
  } catch (error) {
    if (isFedexRateDebugEnabled()) {
      const fedexFailure = takeStorkbinFedexRateFailure();
      if (fedexFailure) {
        console.error(JSON.stringify({ STORKBIN_FEDEX_RATE_FAILURE: fedexFailure }));
      }
    }
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
