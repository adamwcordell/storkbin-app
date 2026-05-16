import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { loadOrCreateProfileForCheckout } from "./ensureProfileForCheckout.ts";
import { getStorkBinPlan } from "./storkbinPlans.ts";
import { attachStarterEmptyBinPackageMeta } from "./fedexPurchaseLabel.ts";
import { createPerBinSubscription, resolveBinStorageStripeProductId, stripeFormRequest } from "./stripeFormApi.ts";

const DEFAULT_SHIPPING_COST = 18;

const buildShippingAddressFromMetadata = (metadata: Record<string, string | undefined>) => ({
  full_name: metadata.shipping_full_name || "",
  email: metadata.shipping_email || "",
  address_line1: metadata.shipping_address_line1 || "",
  address_line2: metadata.shipping_address_line2 || "",
  city: metadata.shipping_city || "",
  state: metadata.shipping_state || "",
  zip: metadata.shipping_zip || "",
});

const getMissingShippingAddressFields = (shippingAddress: Record<string, string>) =>
  Object.entries(shippingAddress)
    .filter(([key, value]) => key !== "address_line2" && !value)
    .map(([key]) => key);

const getStripeId = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "id" in value && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return "";
};

const getNextBoxNumbers = async (supabase: ReturnType<typeof createClient>, count: number) => {
  const { data, error } = await supabase
    .from("boxes")
    .select("box_number")
    .not("box_number", "is", null);

  if (error) throw new Error(`Could not read existing box numbers: ${error.message}`);

  const usedNumbers = new Set(
    (data || [])
      .map((row: { box_number: string | null }) => row.box_number)
      .filter(Boolean) as string[],
  );

  const numbers: string[] = [];
  let candidate = 1;

  while (numbers.length < count) {
    const nextNumber = String(candidate).padStart(3, "0");

    if (!usedNumbers.has(nextNumber)) {
      numbers.push(nextNumber);
      usedNumbers.add(nextNumber);
    }

    candidate += 1;
  }

  return numbers;
};

const chunkArray = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const reserveStorageBaysForBoxes = async ({
  supabase,
  boxIds,
}: {
  supabase: ReturnType<typeof createClient>;
  boxIds: string[];
}) => {
  if (boxIds.length === 0) return [];

  const { data: activeBays, error: activeBaysError } = await supabase
    .from("storage_bays")
    .select("bay_code")
    .eq("is_active", true)
    .order("bay_code", { ascending: true });

  if (activeBaysError) {
    throw new Error(`Could not load active storage bays: ${activeBaysError.message}`);
  }

  const { data: currentAssignments, error: currentAssignmentsError } = await supabase
    .from("bin_storage_assignments")
    .select("bay_code")
    .eq("is_current", true);

  if (currentAssignmentsError) {
    throw new Error(`Could not load active bay assignments: ${currentAssignmentsError.message}`);
  }

  const occupiedBayCodes = new Set(
    (currentAssignments || [])
      .map((assignment: { bay_code?: string | null }) => String(assignment.bay_code || ""))
      .filter(Boolean),
  );

  const availableBayCodes = (activeBays || [])
    .map((row: { bay_code?: string | null }) => String(row.bay_code || ""))
    .filter(Boolean)
    .filter((bayCode) => !occupiedBayCodes.has(bayCode));

  if (availableBayCodes.length < boxIds.length) {
    throw new Error(
      `Not enough available storage bays for new subscription group. Needed ${boxIds.length}, available ${availableBayCodes.length}.`,
    );
  }

  const assignmentRows = boxIds.map((boxId, index) => ({
    box_id: boxId,
    bay_code: availableBayCodes[index],
    status: "assigned",
    assigned_by: "system:auto_initial_checkout",
    assigned_at: new Date().toISOString(),
    is_current: true,
  }));

  const { data: insertedAssignments, error: insertError } = await supabase
    .from("bin_storage_assignments")
    .insert(assignmentRows)
    .select("*");

  if (insertError) {
    throw new Error(`Could not create storage bay assignments: ${insertError.message}`);
  }

  return insertedAssignments || [];
};

export type InitialPurchasePlanGroup = {
  planId: string;
  subscriptionGroupId: string;
  billingCycle: "monthly" | "annual";
};

const parseCompactRowsSequential = (metadata: Record<string, unknown>): InitialPurchasePlanGroup[] => {
  const out: InitialPurchasePlanGroup[] = [];
  for (let i = 0; i < 48; i += 1) {
    const raw = metadata[`b_${i}`];
    if (raw === undefined || raw === null || !String(raw).trim()) break;
    const parts = String(raw).trim().split("|");
    const planId = String(parts[0] || "").trim();
    const subscriptionGroupId = String(parts[1] || "").trim();
    const billingCycle =
      String(parts[2] || "monthly").toLowerCase() === "annual" ? ("annual" as const) : ("monthly" as const);
    if (!planId || !subscriptionGroupId) break;
    out.push({ planId, subscriptionGroupId, billingCycle });
  }
  return out;
};

const parseBundleJsonRows = (metadata: Record<string, unknown>): InitialPurchasePlanGroup[] => {
  const rawBundle = metadata.bundle_json;
  if (!rawBundle) return [];
  try {
    const parsed = JSON.parse(String(rawBundle));
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    return parsed
      .map((row: Record<string, unknown>) => ({
        planId: String(row.planId || row.plan_id || row.p || "").trim(),
        subscriptionGroupId: String(
          row.subscriptionGroupId || row.subscription_group_id || row.s || "",
        ).trim(),
        billingCycle:
          String(row.billingCycle || row.billing_cycle || row.b || "monthly").toLowerCase() === "annual"
            ? ("annual" as const)
            : ("monthly" as const),
      }))
      .filter((row) => row.planId && row.subscriptionGroupId);
  } catch (e) {
    console.warn("initial_purchase bundle_json parse failed; using legacy plan metadata", e);
    return [];
  }
};

/**
 * Prefer compact b_0,b_1,… (sequential until first gap), then add any extra rows from bundle_json
 * by subscription_group_id so a dropped b_N key does not lose a whole plan line.
 */
export const parseInitialPurchasePlanGroups = (
  metadata: Record<string, unknown>,
): InitialPurchasePlanGroup[] => {
  const compact = parseCompactRowsSequential(metadata);
  const jsonRows = parseBundleJsonRows(metadata);
  const seen = new Set<string>();
  const merged: InitialPurchasePlanGroup[] = [];

  for (const row of compact) {
    if (seen.has(row.subscriptionGroupId)) continue;
    seen.add(row.subscriptionGroupId);
    merged.push(row);
  }
  for (const row of jsonRows) {
    if (seen.has(row.subscriptionGroupId)) continue;
    seen.add(row.subscriptionGroupId);
    merged.push(row);
  }

  if (merged.length > 0) {
    const rowCountRaw = metadata.bundle_row_count;
    const rowCount =
      typeof rowCountRaw === "number" && Number.isFinite(rowCountRaw)
        ? Math.floor(rowCountRaw)
        : Number.parseInt(String(rowCountRaw || ""), 10);
    if (Number.isFinite(rowCount) && rowCount > merged.length) {
      console.warn("initial_purchase: fewer plan groups parsed than bundle_row_count", {
        bundle_row_count: rowCount,
        parsed: merged.length,
      });
    }
    return merged;
  }

  const planId = String(metadata.plan_id || "").trim();
  const subscriptionGroupId = String(metadata.subscription_group_id || "").trim();
  if (!planId || !subscriptionGroupId) return [];
  const billingCycle =
    String(metadata.billing_cycle || "monthly").toLowerCase() === "annual" ? ("annual" as const) : ("monthly" as const);
  return [{ planId, subscriptionGroupId, billingCycle }];
};

export type FulfillInitialPurchaseResult = { status: number; body: Record<string, unknown> };

/**
 * Idempotent initial-purchase fulfillment after a paid Checkout Session.
 * Shared by stripe-webhook and finalize-initial-purchase-checkout.
 */
export const fulfillInitialPurchaseCheckoutSessionCompletedCore = async ({
  supabase,
  session,
  metadata,
  stripeSecretKey,
  stripeBinMonthlyPriceId,
  stripeBinStorageProductId,
}: {
  supabase: ReturnType<typeof createClient>;
  session: Record<string, unknown>;
  metadata: Record<string, unknown>;
  stripeSecretKey: string;
  /** Legacy Stripe Price id ($13 or $15); used only to resolve Product id when `stripeBinStorageProductId` is unset. */
  stripeBinMonthlyPriceId?: string | null;
  /** Optional explicit Stripe Product id for per-bin recurring prices (recommended). */
  stripeBinStorageProductId?: string | null;
}): Promise<FulfillInitialPurchaseResult> => {
  const userId = String(metadata.supabase_user_id ?? "").trim();
  const customerRaw = session?.customer;
  const stripeCustomerId =
    typeof customerRaw === "string" && customerRaw.trim()
      ? customerRaw.trim()
      : getStripeId(customerRaw);

  if (!userId || !stripeCustomerId) {
    return { status: 400, body: { error: "Missing checkout metadata" } };
  }

  if (!String(stripeBinMonthlyPriceId || "").trim() && !String(stripeBinStorageProductId || "").trim()) {
    return {
      status: 500,
      body: { error: "Missing STRIPE_BIN_MONTHLY_PRICE_ID or STRIPE_BIN_STORAGE_PRODUCT_ID" },
    };
  }

  let binProductId: string;
  try {
    binProductId = await resolveBinStorageStripeProductId(stripeSecretKey, {
      explicitProductId: stripeBinStorageProductId,
      legacyPriceId: stripeBinMonthlyPriceId,
    });
  } catch (error) {
    return {
      status: 500,
      body: { error: error instanceof Error ? error.message : String(error) },
    };
  }

  let defaultPaymentMethodId = "";
  const piId = getStripeId(session?.payment_intent) ||
    (typeof session?.payment_intent === "string" ? session.payment_intent : "");
  let paymentIntentPayload: Record<string, unknown> | null = null;

  if (piId) {
    try {
      paymentIntentPayload = await stripeFormRequest(
        `payment_intents/${encodeURIComponent(piId)}`,
        "GET",
        stripeSecretKey,
      );
      defaultPaymentMethodId = String(paymentIntentPayload?.payment_method || "");

      if (defaultPaymentMethodId) {
        const customerUpdateParams = new URLSearchParams();
        customerUpdateParams.append(
          "invoice_settings[default_payment_method]",
          defaultPaymentMethodId,
        );

        await stripeFormRequest(
          `customers/${stripeCustomerId}`,
          "POST",
          stripeSecretKey,
          customerUpdateParams,
        );
      }
    } catch (e) {
      console.warn("initial_purchase: could not load PaymentIntent", e);
    }
  }

  const piMetaRaw = paymentIntentPayload?.metadata;
  const piMeta =
    piMetaRaw && typeof piMetaRaw === "object" && !Array.isArray(piMetaRaw)
      ? (piMetaRaw as Record<string, unknown>)
      : {};
  const metadataForBundles: Record<string, unknown> = { ...piMeta, ...metadata };

  const planGroups = parseInitialPurchasePlanGroups(metadataForBundles);
  if (planGroups.length === 0) {
    return { status: 400, body: { error: "Missing checkout metadata" } };
  }

  for (const entry of planGroups) {
    if (!getStorkBinPlan(entry.planId)) {
      return { status: 400, body: { error: `Unknown planId: ${entry.planId}` } };
    }
  }

  const shippingAddress = buildShippingAddressFromMetadata(
    metadata as Record<string, string | undefined>,
  );
  const missingShippingFields = getMissingShippingAddressFields(shippingAddress);

  if (missingShippingFields.length > 0) {
    return {
      status: 400,
      body: { error: "Missing required checkout shipping metadata", missingShippingFields },
    };
  }

  const { profile, errorMessage: profileEnsureError } = await loadOrCreateProfileForCheckout(
    supabase,
    userId,
    {
      fullName: shippingAddress.full_name,
      email: shippingAddress.email,
      addressLine1: shippingAddress.address_line1,
      addressLine2: shippingAddress.address_line2,
      city: shippingAddress.city,
      state: shippingAddress.state,
      zip: shippingAddress.zip,
    },
  );

  if (profileEnsureError || !profile) {
    return {
      status: 404,
      body: { error: profileEnsureError || "Could not load or create profile for checkout user" },
    };
  }

  if (profile.stripe_customer_id !== stripeCustomerId) {
    const { error: profileUpdateError } = await supabase
      .from("profiles")
      .update({ stripe_customer_id: stripeCustomerId })
      .eq("id", userId);

    if (profileUpdateError) {
      return {
        status: 500,
        body: { error: `Could not update Stripe customer ID: ${profileUpdateError.message}` },
      };
    }
  }

  const checkoutCreatedAtMs =
    typeof session?.created === "number"
      ? session.created * 1000
      : Date.now();

  let anchorBaseMs = checkoutCreatedAtMs;

  const customerForAnchor = await stripeFormRequest(
    `customers/${encodeURIComponent(String(stripeCustomerId))}`,
    "GET",
    stripeSecretKey,
  );

  const customerTestClockId =
    typeof customerForAnchor?.test_clock === "string"
      ? customerForAnchor.test_clock
      : customerForAnchor?.test_clock?.id || "";

  if (customerTestClockId) {
    const testClock = await stripeFormRequest(
      `test_helpers/test_clocks/${encodeURIComponent(customerTestClockId)}`,
      "GET",
      stripeSecretKey,
    );
    const frozenUnix = Number(testClock?.frozen_time || 0);
    if (frozenUnix > 0) {
      anchorBaseMs = Math.max(anchorBaseMs, frozenUnix * 1000);
    }
  } else {
    anchorBaseMs = Math.max(anchorBaseMs, Date.now());
  }

  const now = new Date(anchorBaseMs);
  const renewsAt = new Date(anchorBaseMs + 30 * 24 * 60 * 60 * 1000);

  let totalCreatedBoxes = 0;
  let totalCreatedSubscriptions = 0;
  let totalStorageAssignments = 0;
  let anyRecovered = false;
  const allStarterShipmentIds: string[] = [];

  for (const entry of planGroups) {
    const plan = getStorkBinPlan(entry.planId)!;
    const subscriptionGroupId = entry.subscriptionGroupId;
    const cartSubscriptionGroupId = subscriptionGroupId;

    const { data: existingBoxes, error: existingError } = await supabase
      .from("boxes")
      .select("id,checkout_status,cart_type,stripe_subscription_id")
      .eq("subscription_group_id", subscriptionGroupId);

    if (existingError) {
      return { status: 500, body: { error: `Idempotency check failed: ${existingError.message}` } };
    }

    const alreadyProcessed = (existingBoxes || []).some(
      (box: { checkout_status?: string | null; stripe_subscription_id?: string | null }) =>
        box.checkout_status === "paid" || Boolean(box.stripe_subscription_id),
    );

    let boxesForStarterShipments: Array<Record<string, unknown>> = [];

    if (alreadyProcessed) {
      anyRecovered = true;
      const existingBoxIds = (existingBoxes || [])
        .map((box: { id?: string | null }) => String(box.id || ""))
        .filter(Boolean);

      if (existingBoxIds.length === 0) {
        console.warn("initial_purchase: alreadyProcessed but no box ids for group; skipping group", {
          subscriptionGroupId,
        });
        continue;
      }

      const { data: existingStarterShipments, error: existingStarterShipmentsError } = await supabase
        .from("shipments")
        .select("id")
        .in("box_id", existingBoxIds)
        .eq("shipment_direction", "to_customer")
        .limit(1);

      if (existingStarterShipmentsError) {
        return {
          status: 500,
          body: {
            error: `Could not verify existing starter shipments: ${existingStarterShipmentsError.message}`,
          },
        };
      }

      if ((existingStarterShipments || []).length > 0) {
        if (cartSubscriptionGroupId) {
          await supabase
            .from("boxes")
            .delete()
            .eq("subscription_group_id", cartSubscriptionGroupId)
            .eq("user_id", userId)
            .eq("checkout_status", "in_cart")
            .eq("cart_type", "initial_purchase");
        }
        continue;
      }

      const { data: recoverableBoxes, error: recoverableBoxesError } = await supabase
        .from("boxes")
        .select("*")
        .eq("subscription_group_id", subscriptionGroupId)
        .eq("user_id", userId)
        .order("id", { ascending: true });

      if (recoverableBoxesError) {
        return {
          status: 500,
          body: { error: `Could not load recoverable boxes: ${recoverableBoxesError.message}` },
        };
      }

      boxesForStarterShipments = recoverableBoxes || [];
    }

    if (cartSubscriptionGroupId) {
      const { error: provisionalDeleteError } = await supabase
        .from("boxes")
        .delete()
        .eq("subscription_group_id", cartSubscriptionGroupId)
        .eq("user_id", userId)
        .eq("checkout_status", "in_cart")
        .eq("cart_type", "initial_purchase");

      if (provisionalDeleteError) {
        return {
          status: 500,
          body: { error: `Could not remove provisional cart boxes: ${provisionalDeleteError.message}` },
        };
      }
    }

    const createdSubscriptions: Array<{ id: string }> = [];
    let createdStorageAssignments: Array<Record<string, unknown>> = [];

    if (!alreadyProcessed) {
      const boxNumbers = await getNextBoxNumbers(supabase, plan.binCount);
      const billingCycleAnchorUnix = Math.floor(renewsAt.getTime() / 1000);
      const perBinMonthlyCents = Math.round(plan.monthlyRateCents / Math.max(1, plan.binCount));

      for (let index = 0; index < boxNumbers.length; index += 1) {
        const boxId = `${subscriptionGroupId}-${index + 1}`;
        let subscription;

        try {
          subscription = await createPerBinSubscription({
            stripeSecretKey,
            stripeCustomerId: String(stripeCustomerId),
            pricing: {
              kind: "price_data",
              productId: binProductId,
              unitAmountCents: perBinMonthlyCents,
              recurringInterval: "month",
            },
            billingCycleAnchorUnix,
            defaultPaymentMethodId,
            metadata: {
              flow: "monthly_storage_subscription",
              supabase_user_id: userId,
              subscription_group_id: subscriptionGroupId,
              box_id: boxId,
              box_index: index + 1,
              plan_id: plan.id,
              plan_name: plan.name,
              subscription_model: "one_subscription_per_bin",
              first_month_paid_in_checkout: true,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          if (!defaultPaymentMethodId || !/payment method/i.test(message)) {
            throw error;
          }

          console.warn("Retrying subscription creation without default payment method", {
            subscriptionGroupId,
            boxId,
            reason: message,
          });

          subscription = await createPerBinSubscription({
            stripeSecretKey,
            stripeCustomerId: String(stripeCustomerId),
            pricing: {
              kind: "price_data",
              productId: binProductId,
              unitAmountCents: perBinMonthlyCents,
              recurringInterval: "month",
            },
            billingCycleAnchorUnix,
            metadata: {
              flow: "monthly_storage_subscription",
              supabase_user_id: userId,
              subscription_group_id: subscriptionGroupId,
              box_id: boxId,
              box_index: index + 1,
              plan_id: plan.id,
              plan_name: plan.name,
              subscription_model: "one_subscription_per_bin",
              first_month_paid_in_checkout: true,
            },
          });
        }

        createdSubscriptions.push(subscription);
      }

      const boxRows = boxNumbers.map((boxNumber, index) => ({
        id: `${subscriptionGroupId}-${index + 1}`,
        box_number: boxNumber,
        user_id: userId,
        status: "stored",
        fulfillment_status: "paid_waiting_to_ship_bin",
        checkout_status: "paid",
        cart_type: null,
        lifecycle_status: "active",
        subscription_lifecycle_status: "active",
        subscription_payment_status: "paid",
        subscription_group_id: subscriptionGroupId,
        stripe_subscription_id: createdSubscriptions[index]?.id || null,
        subscription_plan_id: plan.id,
        subscription_plan_name: plan.name,
        plan_bin_count: plan.binCount,
        plan_setup_fee: plan.setupFeeCents / 100,
        plan_monthly_rate: plan.monthlyRateCents / 100,
        minimum_months: plan.minimumMonths,
        return_shipping_discount_percent: plan.returnShippingDiscountPercent,
        plan_initial_stack_size: plan.initialShipmentStackSize,
        requested_shipping_address: shippingAddress,
        requested_shipping_address_source: metadata.shipping_source || "customer_selected_checkout",
        price: (plan.setupFeeCents + plan.monthlyRateCents) / 100,
        subscription_started_at: now.toISOString(),
        renews_at: renewsAt.toISOString(),
      }));

      const { data: insertedBoxes, error: boxesError } = await supabase
        .from("boxes")
        .insert(boxRows)
        .select("*");

      if (boxesError) {
        return { status: 500, body: { error: `Could not create boxes: ${boxesError.message}` } };
      }

      boxesForStarterShipments = insertedBoxes || [];
      createdStorageAssignments = await reserveStorageBaysForBoxes({
        supabase,
        boxIds: boxRows.map((row) => row.id),
      });
    }

    // Never chunk a plan's starter bins below its bin count (e.g. stack 3 + four_bins must not become 3+1 kits).
    const configuredStack = Math.max(1, Number(plan.initialShipmentStackSize) || 1);
    const stackSize = Math.max(plan.binCount, configuredStack);
    const starterShipmentStacks = chunkArray(boxesForStarterShipments, stackSize);

    const paymentIntentIdForStarter = getStripeId(session?.payment_intent);
    const checkoutSessionIdForStarter = String(session?.id || "").trim();

    for (const shipmentStack of starterShipmentStacks) {
      const firstBox = shipmentStack[0];

      const starterShipAddress = attachStarterEmptyBinPackageMeta(
        shippingAddress as Record<string, unknown>,
        shipmentStack.length,
      );

      const { data: createdShipment, error: shipmentError } = await supabase
        .from("shipments")
        .insert([
          {
            box_id: firstBox.id,
            user_id: userId,
            shipping_address: starterShipAddress,
            shipping_estimate: DEFAULT_SHIPPING_COST,
            shipping_cost: DEFAULT_SHIPPING_COST,
            shipment_direction: "to_customer",
            shipping_status: "paid",
            charge_status: "paid",
            charge_attempted_at: now.toISOString(),
            charge_failure_reason: null,
            label_status: "needed",
            stripe_payment_intent_id: paymentIntentIdForStarter || null,
            stripe_checkout_session_id: checkoutSessionIdForStarter || null,
          },
        ])
        .select("*")
        .single();

      if (shipmentError) {
        return { status: 500, body: { error: `Could not create starter shipment: ${shipmentError.message}` } };
      }

      const shipmentBoxRows = shipmentStack.map((box: { id: string }, index: number) => ({
        shipment_id: createdShipment.id,
        box_id: box.id,
        user_id: userId,
        stack_position: index + 1,
      }));

      const { error: shipmentBoxesError } = await supabase
        .from("shipment_boxes")
        .insert(shipmentBoxRows);

      if (shipmentBoxesError) {
        return {
          status: 500,
          body: { error: `Could not link starter shipment boxes: ${shipmentBoxesError.message}` },
        };
      }

      allStarterShipmentIds.push(String(createdShipment.id));
    }

    totalCreatedBoxes += boxesForStarterShipments.length;
    totalCreatedSubscriptions += createdSubscriptions.length;
    totalStorageAssignments += createdStorageAssignments.length;
  }

  return {
    status: 200,
    body: {
      received: true,
      createdBoxes: totalCreatedBoxes,
      createdSubscriptions: totalCreatedSubscriptions,
      createdStorageAssignments: totalStorageAssignments,
      subscriptionGroupId: planGroups[0]?.subscriptionGroupId,
      subscriptionGroupIds: planGroups.map((g) => g.subscriptionGroupId),
      recoveredStarterShipments: anyRecovered,
      starterShipmentIds: allStarterShipmentIds,
      starterLabelPurchase:
        allStarterShipmentIds.length > 0
          ? {
              skipped: true,
              reason:
                "Outbound FedEx labels are manual: ops applies bin QR, then admin Create Carrier Label (no auto-purchase after payment).",
            }
          : null,
      bundleGroupCount: planGroups.length,
    },
  };
};
