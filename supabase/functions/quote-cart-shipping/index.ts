import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  addressKeyForBundle,
  buildCheckoutGroups,
  getShippingQuote,
  hasValidAddressForQuote,
  shippingLineKeyForGroupBoxes,
} from "../_shared/fedexShippingRates.ts";

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

const getShipmentDirectionForCartType = (cartType: string | null | undefined) => {
  if (cartType === "ship_to_customer") return "to_customer";
  if (cartType === "return_to_storage") return "to_storage";
  return "";
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return jsonResponse({ error: "Missing Supabase configuration" }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    const userId = userData?.user?.id;
    if (userErr || !userId) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const requestBody = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const shippingSelectionsRaw = requestBody.shippingSelections;
    const shippingSelections = (
      shippingSelectionsRaw && typeof shippingSelectionsRaw === "object" && !Array.isArray(shippingSelectionsRaw)
        ? shippingSelectionsRaw
        : {}
    ) as Record<string, string>;
    const commercialDestination = requestBody.commercialDestination === true;

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: boxes, error: boxesError } = await supabase
      .from("boxes")
      .select(
        "id,box_number,user_id,status,fulfillment_status,checkout_status,cart_type,requested_shipping_address,requested_shipping_address_source,return_shipment_empty",
      )
      .eq("user_id", userId)
      .in("cart_type", ["ship_to_customer", "return_to_storage"])
      .in("checkout_status", ["in_cart", "paid"]);

    if (boxesError) {
      return jsonResponse({ error: boxesError.message }, 500);
    }

    const list = (boxes || []) as Array<Record<string, unknown>>;
    if (list.length === 0) {
      return jsonResponse({ lines: [], totalShippingUsd: 0 });
    }

    const { groups } = buildCheckoutGroups(list);
    const lines: Array<{
      lineKey: string;
      boxIds: string[];
      amountUsd: number | null;
      error: string | null;
      fedexServiceName?: string | null;
      fedexServiceType?: string | null;
      fedexEstimatedDeliveryDate?: string | null;
      fedexDeliverySummary?: string | null;
      fedexOptions?: Array<{
        serviceType: string;
        serviceName: string;
        amountUsd: number;
        estimatedDeliveryDate: string | null;
        estimatedDeliveryWeekday: string | null;
        transitTimeRaw: string | null;
        deliverySummary: string | null;
      }>;
    }> = [];

    for (const group of groups) {
      const groupBoxes = group.boxes;
      const lineKey = shippingLineKeyForGroupBoxes(groupBoxes);
      const boxIds = groupBoxes.map((b) => String(b.id));
      const direction = group.direction;
      const primaryBox = groupBoxes[0];
      const shippingAddress = primaryBox.requested_shipping_address as Record<string, unknown> | null;

      let blockReason: string | null = null;
      for (const box of groupBoxes) {
        const dir = getShipmentDirectionForCartType(String(box.cart_type || ""));
        if (!dir || dir !== direction) {
          blockReason = "Invalid shipping cart item";
          break;
        }
        if (direction === "to_customer" && !(box.status === "stored" && box.fulfillment_status === "stored")) {
          blockReason = "Bin not eligible to ship";
          break;
        }
        if (direction === "to_storage" && !(box.status === "at_customer" && box.fulfillment_status === "bin_with_customer")) {
          blockReason = "Bin not eligible to return";
          break;
        }
        if (!box.requested_shipping_address) {
          blockReason = "Missing address";
          break;
        }
        if (direction === "to_storage" && group.packageProfile === "return_empty_multi") {
          const k0 = addressKeyForBundle(shippingAddress);
          const k1 = addressKeyForBundle(box.requested_shipping_address as Record<string, unknown>);
          if (k0 !== k1) {
            blockReason = "Address mismatch in bundle";
            break;
          }
        }
      }

      if (!blockReason && direction === "to_storage" && group.packageProfile === "return_empty_multi") {
        const emptyBoxIds = groupBoxes
          .filter((b) => Boolean((b as Record<string, unknown>).return_shipment_empty))
          .map((b) => String(b.id));
        if (emptyBoxIds.length) {
          // Select columns that exist on all deployments (`status` may be absent — do not select it).
          const { data: invRows, error: invErr } = await supabase
            .from("items")
            .select("id,box_id")
            .in("box_id", emptyBoxIds);
          if (invErr) {
            console.error("quote-cart-shipping: items lookup failed", invErr.message);
            blockReason = "Could not verify inventory; try again or contact support if this continues.";
          } else if ((invRows || []).length > 0) {
            blockReason =
              "Returning empty flat requires an empty inventory list. Unpack every item on each bin before checkout.";
          }
        }
      }

      if (blockReason || !shippingAddress || !hasValidAddressForQuote(shippingAddress)) {
        lines.push({
          lineKey,
          boxIds,
          amountUsd: null,
          error: blockReason || "Incomplete address",
        });
        continue;
      }

      try {
        const preferred = String(shippingSelections[lineKey] || "").trim();
        const quote = await getShippingQuote({
          boxId: String(primaryBox.id),
          direction,
          shippingAddress,
          packageProfile: group.packageProfile,
          emptyPieceCount: group.emptyPieceCount,
          preferredServiceType: preferred || undefined,
          commercialDestination,
        });
        lines.push({
          lineKey,
          boxIds,
          amountUsd: quote.amountUsd,
          error: null,
          fedexServiceName: quote.serviceName || null,
          fedexServiceType: quote.serviceType || null,
          fedexEstimatedDeliveryDate: quote.estimatedDeliveryDate,
          fedexDeliverySummary: quote.deliverySummary,
          fedexOptions: quote.options,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lines.push({ lineKey, boxIds, amountUsd: null, error: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg });
      }
    }

    const totalShippingUsd = lines.reduce(
      (s, l) => s + (typeof l.amountUsd === "number" && Number.isFinite(l.amountUsd) ? l.amountUsd : 0),
      0,
    );

    return jsonResponse({ lines, totalShippingUsd });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
