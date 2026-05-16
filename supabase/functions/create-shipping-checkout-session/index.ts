import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  derivePhysicalAddressFromBoxes,
  loadOrCreateProfileForCheckout,
} from "../_shared/ensureProfileForCheckout.ts";
import { EARLY_TERMINATION_FEE_CENTS, isWithinMinimumTerm } from "../_shared/earlyTermination.ts";
import {
  type ShippingQuote,
  addressKeyForBundle,
  buildCheckoutGroups,
  getShippingQuote,
  hasValidAddressForQuote,
  mergeShipmentAddressWithPackageMeta,
  shippingLineKeyForGroupBoxes,
  withFedexShipMeta,
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

const stripeRequest = async (
  path: string,
  body: URLSearchParams,
  stripeSecretKey: string,
) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message || "Stripe request failed";
    throw new Error(message);
  }

  return payload;
};

const toStripeMetadataValue = (value: unknown) => String(value || "").slice(0, 500);

const formatAddressLine = (address: Record<string, unknown> | null | undefined) => {
  if (!address) return "shipping address";

  return [
    address.address_line1,
    address.city,
    address.state,
    address.zip,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
};

const getShipmentDirectionForCartType = (cartType: string | null | undefined) => {
  if (cartType === "ship_to_customer") return "to_customer";
  if (cartType === "return_to_storage") return "to_storage";
  return "";
};

const findOpenShipmentForBox = async (
  supabase: ReturnType<typeof createClient>,
  boxId: string,
  direction: string,
) => {
  const { data: links, error: linkErr } = await supabase
    .from("shipment_boxes")
    .select("shipment_id")
    .eq("box_id", boxId);
  if (linkErr) return { shipment: null as Record<string, unknown> | null, error: linkErr };
  const ids = [...new Set((links || []).map((r: { shipment_id: string }) => String(r.shipment_id)))];
  if (!ids.length) return { shipment: null, error: null };
  const { data: ships, error: shipErr } = await supabase
    .from("shipments")
    .select("*")
    .in("id", ids)
    .eq("shipment_direction", direction)
    .in("shipping_status", ["pending_payment", "paid", "label_created", "in_transit"]);
  if (shipErr) return { shipment: null, error: shipErr };
  const list = (ships || []) as Array<Record<string, unknown> & { created_at?: string }>;
  list.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return { shipment: list[0] || null, error: null };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ error: "Missing required Edge Function secrets" }, 500);
    }

    const body = await req.json();
    const userId = String(body.userId || "").trim();
    const boxIds = Array.isArray(body.boxIds)
      ? body.boxIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];
    const successUrl = String(body.successUrl || "").trim();
    const cancelUrl = String(body.cancelUrl || "").trim();
    const shippingSelections = (
      body.shippingSelections && typeof body.shippingSelections === "object" && !Array.isArray(body.shippingSelections)
        ? body.shippingSelections
        : {}
    ) as Record<string, string>;
    const commercialDestination = body.commercialDestination === true;
    const rawEarlyFee = (body as Record<string, unknown>).earlyTerminationFeeCents;
    const earlyTerminationFeeCents =
      typeof rawEarlyFee === "number" && Number.isFinite(rawEarlyFee)
        ? Math.round(rawEarlyFee)
        : typeof rawEarlyFee === "string" && /^\d+$/.test(rawEarlyFee.trim())
          ? parseInt(rawEarlyFee.trim(), 10)
          : 0;

    if (!userId || boxIds.length === 0 || !successUrl || !cancelUrl) {
      return jsonResponse({ error: "userId, boxIds, successUrl, and cancelUrl are required" }, 400);
    }

    const uniqueBoxIds = Array.from(new Set(boxIds));

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: boxes, error: boxesError } = await supabase
      .from("boxes")
      .select(
        "id,box_number,user_id,status,fulfillment_status,checkout_status,cart_type,requested_shipping_address,requested_shipping_address_source,return_shipment_empty,subscription_started_at,early_termination_fee_waived,cancel_status,stripe_subscription_id",
      )
      .eq("user_id", userId)
      .in("id", uniqueBoxIds);

    if (boxesError) {
      return jsonResponse({ error: `Could not load shipping cart boxes: ${boxesError.message}` }, 500);
    }

    if (!boxes || boxes.length !== uniqueBoxIds.length) {
      return jsonResponse({ error: "One or more selected bins were not found" }, 404);
    }

    const shipAddr = derivePhysicalAddressFromBoxes(boxes as Array<Record<string, unknown>>);
    if (
      !shipAddr ||
      !shipAddr.addressLine1 ||
      !shipAddr.city ||
      !shipAddr.state ||
      !shipAddr.zip
    ) {
      return jsonResponse(
        {
          error:
            "Missing shipping address on your cart. Open the cart and confirm ship-to / return addresses before checkout.",
        },
        400,
      );
    }

    const { profile, errorMessage: profileEnsureError } = await loadOrCreateProfileForCheckout(
      supabase,
      userId,
      shipAddr,
    );

    if (profileEnsureError || !profile) {
      return jsonResponse(
        { error: profileEnsureError || "Could not load or create profile for checkout" },
        404,
      );
    }

    let stripeCustomerId = profile.stripe_customer_id as string | null;

    if (!stripeCustomerId) {
      const customerParams = new URLSearchParams();
      if (profile.email) customerParams.append("email", profile.email);
      if (profile.full_name) customerParams.append("name", profile.full_name);
      customerParams.append("metadata[supabase_user_id]", userId);

      const customer = await stripeRequest("customers", customerParams, stripeSecretKey);
      stripeCustomerId = customer.id;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", userId);

      if (updateError) {
        return jsonResponse({ error: "Failed to save Stripe customer ID" }, 500);
      }
    }

    let earlyTerminationValidatedBoxId: string | null = null;
    if (earlyTerminationFeeCents > 0) {
      if (earlyTerminationFeeCents !== EARLY_TERMINATION_FEE_CENTS) {
        return jsonResponse({ error: "Invalid early termination fee amount." }, 400);
      }
      if (uniqueBoxIds.length !== 1) {
        return jsonResponse(
          {
            error: "Early termination with shipping must be the only checkout group in your cart.",
          },
          400,
        );
      }
      const b = boxes[0] as Record<string, unknown>;
      const prelimGroups = buildCheckoutGroups(boxes as Array<Record<string, unknown>>).groups;
      if (prelimGroups.length !== 1 || prelimGroups[0].direction !== "to_customer") {
        return jsonResponse(
          { error: "Early termination checkout only supports warehouse-to-you shipping." },
          400,
        );
      }
      if (String(b.status) !== "stored") {
        return jsonResponse(
          { error: "Early termination with shipping is only for bins currently in storage." },
          400,
        );
      }
      if (String(b.checkout_status) !== "in_cart" || String(b.cart_type) !== "ship_to_customer") {
        return jsonResponse({ error: "Invalid cart state for early termination checkout." }, 400);
      }
      if (b.early_termination_fee_waived === true) {
        return jsonResponse({ error: "Early termination fee does not apply to this subscription." }, 400);
      }
      const cs = String(b.cancel_status || "none");
      if (cs === "approved" || cs === "requested") {
        return jsonResponse({ error: "A cancellation is already in progress for this bin." }, 400);
      }
      if (!isWithinMinimumTerm(b.subscription_started_at as string | null)) {
        return jsonResponse(
          { error: "Minimum term is already complete; use standard shipping checkout without the penalty line." },
          400,
        );
      }
      earlyTerminationValidatedBoxId = String(b.id);
    }

    const { groups } = buildCheckoutGroups(boxes as Array<Record<string, unknown>>);

    const shipmentRows = [] as Array<Record<string, unknown>>;
    const lineItems = [] as Array<{
      shipment: Record<string, unknown>;
      direction: string;
      primaryBox: Record<string, unknown>;
      groupBoxes: Array<Record<string, unknown>>;
    }>;

    for (const group of groups) {
      const direction = group.direction;
      const groupBoxes = group.boxes;
      const primaryBox = groupBoxes[0];
      const shippingAddress = primaryBox.requested_shipping_address as Record<string, unknown> | null;

      for (const box of groupBoxes) {
        const dir = getShipmentDirectionForCartType(String(box.cart_type || ""));
        if (!dir || dir !== direction) {
          return jsonResponse({ error: `Bin ${box.box_number || box.id} is not a valid shipping cart item` }, 400);
        }
        if (box.checkout_status !== "paid") {
          return jsonResponse({ error: `Bin ${box.box_number || box.id} is not eligible for shipping checkout` }, 400);
        }
        if (direction === "to_customer" && !(box.status === "stored" && box.fulfillment_status === "stored")) {
          return jsonResponse({ error: `Bin ${box.box_number || box.id} is not eligible to be shipped to customer` }, 400);
        }
        if (direction === "to_storage" && !(box.status === "at_customer" && box.fulfillment_status === "bin_with_customer")) {
          return jsonResponse({ error: `Bin ${box.box_number || box.id} is not eligible to be returned to storage` }, 400);
        }
        if (!box.requested_shipping_address) {
          return jsonResponse({ error: `Missing shipping address for bin ${box.box_number || box.id}` }, 400);
        }
        if (direction === "to_storage" && group.packageProfile === "return_empty_multi") {
          const k0 = addressKeyForBundle(shippingAddress);
          const k1 = addressKeyForBundle(box.requested_shipping_address as Record<string, unknown>);
          if (k0 !== k1) {
            return jsonResponse(
              { error: "All bins in an empty-return bundle must use the same ship-from address." },
              400,
            );
          }
        }
      }

      if (direction === "to_storage" && group.packageProfile === "return_empty_multi") {
        const emptyBoxIds = groupBoxes
          .filter((b) => Boolean((b as Record<string, unknown>).return_shipment_empty))
          .map((b) => String(b.id));
        if (emptyBoxIds.length) {
          const { data: invRows, error: invErr } = await supabase
            .from("items")
            .select("id,box_id")
            .in("box_id", emptyBoxIds);
          if (invErr) {
            return jsonResponse({ error: `Could not verify inventory: ${invErr.message}` }, 500);
          }
          if ((invRows || []).length > 0) {
            return jsonResponse(
              {
                error:
                  "Returning empty flat requires an empty inventory list. Open each bin’s inventory list and tap Unpack item on every line before checkout.",
              },
              400,
            );
          }
        }
      }

      if (!shippingAddress || !hasValidAddressForQuote(shippingAddress)) {
        return jsonResponse({ error: "Missing or incomplete shipping address for a checkout group." }, 400);
      }

      const pendingIds = new Set<string>();
      for (const box of groupBoxes) {
        const { shipment: pending, error: pErr } = await findOpenShipmentForBox(
          supabase,
          String(box.id),
          direction,
        );
        if (pErr) {
          return jsonResponse({ error: pErr.message }, 500);
        }
        if (pending && pending.charge_status === "paid") {
          return jsonResponse(
            { error: `Bin ${box.box_number || box.id} already has a paid open shipment` },
            400,
          );
        }
        if (pending) pendingIds.add(String(pending.id));
      }
      if (pendingIds.size > 1) {
        return jsonResponse(
          {
            error:
              "These bins have conflicting open shipments. Remove them from the cart, refresh, and add them again together.",
          },
          400,
        );
      }

      const lineKey = shippingLineKeyForGroupBoxes(groupBoxes as Array<Record<string, unknown>>);
      const preferred = String(shippingSelections[lineKey] || "").trim();

      let quote: ShippingQuote;
      try {
        quote = await getShippingQuote({
          boxId: String(primaryBox.id),
          direction,
          shippingAddress,
          packageProfile: group.packageProfile,
          emptyPieceCount: group.emptyPieceCount,
          preferredServiceType: preferred || undefined,
          commercialDestination,
        });
      } catch (quoteErr) {
        const msg = quoteErr instanceof Error ? quoteErr.message : String(quoteErr);
        return jsonResponse({ error: msg }, 400);
      }

      const mergedAddress = withFedexShipMeta(
        mergeShipmentAddressWithPackageMeta(
          shippingAddress as Record<string, unknown>,
          group.packageProfile,
          group.emptyPieceCount,
        ),
        {
          serviceType: quote.serviceType,
          serviceName: quote.serviceName,
          estimatedDeliveryDate: quote.estimatedDeliveryDate,
          estimatedDeliveryWeekday: quote.estimatedDeliveryWeekday,
          transitTimeRaw: quote.transitTimeRaw,
          deliverySummary: quote.deliverySummary,
        },
      );

      let shipment: Record<string, unknown>;

      const existingId = pendingIds.size === 1 ? [...pendingIds][0] : null;

      if (!existingId) {
        const { data: createdShipment, error: shipmentError } = await supabase
          .from("shipments")
          .insert([
            {
              box_id: primaryBox.id,
              user_id: primaryBox.user_id,
              shipping_address: mergedAddress,
              shipping_estimate: quote.amountUsd,
              shipping_cost: quote.amountUsd,
              shipment_direction: direction,
              shipping_status: "pending_payment",
              charge_status: "pending_payment",
              charge_attempted_at: new Date().toISOString(),
              charge_failure_reason: null,
              label_status: "needed",
            },
          ])
          .select("*")
          .single();

        if (shipmentError) {
          return jsonResponse({ error: `Could not create shipment: ${shipmentError.message}` }, 500);
        }

        const inserts = groupBoxes.map((b, idx) => ({
          shipment_id: createdShipment.id,
          box_id: b.id,
          user_id: b.user_id,
          stack_position: idx + 1,
        }));
        const { error: shipmentBoxError } = await supabase.from("shipment_boxes").insert(inserts);
        if (shipmentBoxError) {
          return jsonResponse({ error: `Could not link shipment box: ${shipmentBoxError.message}` }, 500);
        }

        shipment = createdShipment as Record<string, unknown>;
      } else {
        const { error: updateShipmentError } = await supabase
          .from("shipments")
          .update({
            shipping_address: mergedAddress,
            shipping_estimate: quote.amountUsd,
            shipping_cost: quote.amountUsd,
            shipping_status: "pending_payment",
            charge_status: "pending_payment",
            charge_attempted_at: new Date().toISOString(),
            charge_failure_reason: null,
            label_status: "needed",
          })
          .eq("id", existingId);

        if (updateShipmentError) {
          return jsonResponse({ error: `Could not refresh shipment: ${updateShipmentError.message}` }, 500);
        }

        const { data: refreshed, error: refErr } = await supabase
          .from("shipments")
          .select("*")
          .eq("id", existingId)
          .single();
        if (refErr || !refreshed) {
          return jsonResponse({ error: refErr?.message || "Could not load shipment" }, 500);
        }
        shipment = refreshed as Record<string, unknown>;

        for (let idx = 0; idx < groupBoxes.length; idx += 1) {
          const b = groupBoxes[idx];
          const { data: linkRow } = await supabase
            .from("shipment_boxes")
            .select("shipment_id")
            .eq("shipment_id", existingId)
            .eq("box_id", b.id)
            .maybeSingle();
          if (!linkRow) {
            const { error: insErr } = await supabase.from("shipment_boxes").insert({
              shipment_id: existingId,
              box_id: b.id,
              user_id: b.user_id,
              stack_position: idx + 1,
            });
            if (insErr) return jsonResponse({ error: insErr.message }, 500);
          }
        }
      }

      shipmentRows.push(shipment);
      lineItems.push({ shipment, direction, primaryBox, groupBoxes });
    }

    const sessionParams = new URLSearchParams();
    sessionParams.append("mode", "payment");
    sessionParams.append("customer", stripeCustomerId);
    sessionParams.append("success_url", successUrl);
    sessionParams.append("cancel_url", cancelUrl);
    sessionParams.append("payment_method_types[0]", "card");
    sessionParams.append("metadata[flow]", "customer_shipping");
    sessionParams.append("metadata[supabase_user_id]", userId);
    sessionParams.append("metadata[shipment_ids]", shipmentRows.map((shipment) => shipment.id).join(","));
    sessionParams.append("metadata[box_ids]", uniqueBoxIds.join(","));
    if (earlyTerminationValidatedBoxId && earlyTerminationFeeCents > 0) {
      sessionParams.append("metadata[early_termination_fee_cents]", String(earlyTerminationFeeCents));
      sessionParams.append("metadata[early_termination_box_id]", earlyTerminationValidatedBoxId);
    }
    sessionParams.append("payment_intent_data[metadata][flow]", "customer_shipping");
    sessionParams.append("payment_intent_data[metadata][supabase_user_id]", userId);
    sessionParams.append("payment_intent_data[metadata][shipment_ids]", shipmentRows.map((shipment) => shipment.id).join(","));
    sessionParams.append("payment_intent_data[metadata][box_ids]", uniqueBoxIds.join(","));
    if (earlyTerminationValidatedBoxId && earlyTerminationFeeCents > 0) {
      sessionParams.append(
        "payment_intent_data[metadata][early_termination_fee_cents]",
        String(earlyTerminationFeeCents),
      );
      sessionParams.append(
        "payment_intent_data[metadata][early_termination_box_id]",
        earlyTerminationValidatedBoxId,
      );
    }

    lineItems.forEach(({ shipment, direction, primaryBox, groupBoxes }, index) => {
      const shipmentCost = Number(shipment.shipping_cost);
      if (!Number.isFinite(shipmentCost) || shipmentCost <= 0) {
        throw new Error("Shipment is missing a valid FedEx shipping_cost from checkout.");
      }
      const binList = groupBoxes.map((b) => String(b.box_number || b.id)).join(", ");
      const isBundledEmptyReturn =
        direction === "to_storage" && groupBoxes.length > 1;
      const headline =
        direction === "to_storage"
          ? isBundledEmptyReturn
            ? `Return empty flat bins to storage (${groupBoxes.length} bins, one label)`
            : "Return shipping to storage"
          : "Shipping to customer";
      const name = `${headline} — ${groupBoxes.length === 1 ? `Bin ${binList}` : `Bins ${binList}`}`;
      sessionParams.append(`line_items[${index}][price_data][currency]`, "usd");
      sessionParams.append(`line_items[${index}][price_data][unit_amount]`, String(Math.round(shipmentCost * 100)));
      sessionParams.append(`line_items[${index}][price_data][product_data][name]`, name);
      sessionParams.append(
        `line_items[${index}][price_data][product_data][description]`,
        formatAddressLine(primaryBox.requested_shipping_address as Record<string, unknown> | null),
      );
      sessionParams.append(
        `line_items[${index}][price_data][product_data][metadata][box_id]`,
        toStripeMetadataValue(groupBoxes.map((b) => b.id).join(",")),
      );
      sessionParams.append(`line_items[${index}][price_data][product_data][metadata][shipment_direction]`, direction);
      sessionParams.append(`line_items[${index}][quantity]`, "1");
    });

    if (earlyTerminationValidatedBoxId && earlyTerminationFeeCents > 0) {
      const feeIdx = lineItems.length;
      sessionParams.append(`line_items[${feeIdx}][price_data][currency]`, "usd");
      sessionParams.append(`line_items[${feeIdx}][price_data][unit_amount]`, String(earlyTerminationFeeCents));
      sessionParams.append(`line_items[${feeIdx}][price_data][product_data][name]`, "Early termination penalty");
      sessionParams.append(
        `line_items[${feeIdx}][price_data][product_data][description]`,
        "One-time minimum-term contract break fee (includes outbound shipping in this checkout)",
      );
      sessionParams.append(`line_items[${feeIdx}][quantity]`, "1");
    }

    const session = await stripeRequest("checkout/sessions", sessionParams, stripeSecretKey);

    return jsonResponse({
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
      shipmentIds: shipmentRows.map((shipment) => shipment.id),
    });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
