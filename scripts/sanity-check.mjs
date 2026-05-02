#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const REQUIRED_BOX_COLUMNS = [
  "id",
  "box_number",
  "user_id",
  "status",
  "fulfillment_status",
  "checkout_status",
  "subscription_group_id",
  "customer_bin_name",
  "cancel_status",
  "subscription_ends_at",
  "cancellation_shipping_charge_status",
  "cancellation_shipping_charge_failed_at",
  "subscription_payment_status",
  "last_payment_failed_at",
  "subscription_lifecycle_status",
  "lifecycle_status",
  "lifecycle_attention_reason",
  "lifecycle_deadline_at",
  "lifecycle_last_notified_at",
];

const REQUIRED_ADMIN_VIEW_COLUMNS = [
  "id",
  "box_number",
  "user_id",
  "status",
  "fulfillment_status",
  "checkout_status",
  "subscription_group_id",
  "customer_bin_name",
  "cancel_status",
  "subscription_ends_at",
  "cancellation_shipping_charge_status",
  "cancellation_shipping_charge_failed_at",
  "subscription_payment_status",
  "last_payment_failed_at",
  "subscription_lifecycle_status",
  "lifecycle_status",
  "lifecycle_attention_reason",
  "lifecycle_deadline_at",
  "latest_shipment_id",
  "latest_shipment_direction",
  "latest_shipping_status",
  "latest_charge_status",
  "latest_label_status",
  "latest_tracking_number",
  "latest_tracking_url",
  "latest_label_url",
  "latest_shipping_cost",
];

const VALID_BOX_STATUS = new Set([
  "stored",
  "at_customer",
  "in_transit_to_customer",
  "in_transit_to_storage",
]);

const VALID_FULFILLMENT_STATUS = new Set([
  "paid_waiting_to_ship_bin",
  "ready_to_ship_to_customer",
  "label_created",
  "shipped_to_customer",
  "awaiting_customer_dropoff",
  "awaiting_storage_arrival",
  "bin_with_customer",
  "stored",
  "shipment_payment_failed",
]);

const VALID_CHECKOUT_STATUS = new Set(["draft", "in_cart", "paid"]);
const VALID_LIFECYCLE_STATUS = new Set(["active", "auction", "removed_from_system"]);
const VALID_SHIPMENT_DIRECTION = new Set(["to_customer", "to_storage"]);
const VALID_SHIPPING_STATUS = new Set(["pending_payment", "paid", "label_created", "in_transit", "delivered"]);
const VALID_LABEL_STATUS = new Set(["needed", "printed"]);
const VALID_CHARGE_STATUS = new Set(["paid", "failed", "pending_auto_charge"]);

const argv = new Set(process.argv.slice(2));
const shouldRunMutationSmoke =
  argv.has("--mutation-smoke") ||
  process.env.SANITY_MUTATION_SMOKE === "1" ||
  process.env.RUN_MUTATION_TESTS === "true";
const mutationShipmentId = process.env.SANITY_SHIPMENT_ID;
const queryTimeoutMs = Number(process.env.SANITY_QUERY_TIMEOUT_MS || 12000);

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://wslymzcbbevnoybbsbgq.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzbHltemNiYmV2bm95YmJzYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMDE0OTAsImV4cCI6MjA5Mjc3NzQ5MH0.Tj8AtBqQbY_LZnMBi7sLH7obepfhIqZ6-oLfwoD5-8g";

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
let warnings = 0;
const checks = [];

function pass(message) {
  checks.push({ icon: "✅", message });
}

function warn(message) {
  warnings += 1;
  checks.push({ icon: "⚠️ ", message });
}

function fail(message) {
  failures += 1;
  checks.push({ icon: "❌", message });
}

function daysBetween(start, end) {
  return Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
}

async function withTimeout(label, buildQuery) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), queryTimeoutMs);
  try {
    return await buildQuery(controller.signal);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label}: timed out after ${queryTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function selectTable(table, columns = "*", options = {}) {
  const { data, error } = await withTimeout(table, (signal) => {
    let query = supabase.from(table).select(columns).abortSignal(signal);
    if (options.limit) query = query.limit(options.limit);
    return query;
  });
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

async function assertSelectable(table, columns) {
  const selectList = columns.join(",");
  const { error } = await withTimeout(`${table} required-column check`, (signal) =>
    supabase.from(table).select(selectList).limit(1).abortSignal(signal),
  );
  if (error) {
    fail(`${table} is not selectable with required columns: ${error.message}`);
    return false;
  }
  pass(`${table} exposes required columns`);
  return true;
}

function assertEnumValue(row, field, allowed, label) {
  const value = row[field];
  if (value == null || value === "") return;
  if (!allowed.has(value)) {
    fail(`${label} ${row.id ?? row.box_id ?? "unknown"} has unexpected ${field}: ${value}`);
  }
}

function getGraceDeadline(box) {
  if (box.lifecycle_deadline_at) return new Date(box.lifecycle_deadline_at);

  if (box.cancellation_shipping_charge_status === "failed" && box.cancellation_shipping_charge_failed_at) {
    const deadline = new Date(box.cancellation_shipping_charge_failed_at);
    deadline.setDate(deadline.getDate() + 45);
    return deadline;
  }

  if (box.subscription_payment_status === "failed" && box.last_payment_failed_at) {
    const deadline = new Date(box.last_payment_failed_at);
    deadline.setDate(deadline.getDate() + (box.status === "at_customer" ? 30 : 60));
    return deadline;
  }

  return null;
}

async function runReadOnlyChecks() {
  console.log("\nStorkBin automated sanity check");
  console.log("Mode: read-only DB/state-machine checks\n");

  const boxesOk = await assertSelectable("boxes", REQUIRED_BOX_COLUMNS);
  const shipmentsOk = await assertSelectable("shipments", [
    "id",
    "shipment_direction",
    "shipping_status",
    "label_status",
    "tracking_number",
    "tracking_url",
    "label_url",
    "charge_status",
    "charge_failure_reason",
    "shipping_cost",
  ]);
  const shipmentBoxesOk = await assertSelectable("shipment_boxes", ["shipment_id", "box_id"]);
  const adminViewOk = await assertSelectable("admin_ops_bins", REQUIRED_ADMIN_VIEW_COLUMNS);

  if (adminViewOk) {
    const { error: optionalAdminColumnError } = await withTimeout("admin_ops_bins optional lifecycle_last_notified_at check", (signal) =>
      supabase.from("admin_ops_bins").select("lifecycle_last_notified_at").limit(1).abortSignal(signal),
    );
    if (optionalAdminColumnError) {
      warn("admin_ops_bins does not expose optional lifecycle_last_notified_at; customer grace logic can still use boxes directly");
    }
  }

  if (!boxesOk || !shipmentsOk || !shipmentBoxesOk || !adminViewOk) return;

  const boxes = await selectTable("boxes", REQUIRED_BOX_COLUMNS.join(","), { limit: 1000 });
  const adminRows = await selectTable("admin_ops_bins", REQUIRED_ADMIN_VIEW_COLUMNS.join(","), { limit: 1000 });
  const shipments = await selectTable(
    "shipments",
    "id,shipment_direction,shipping_status,label_status,tracking_number,tracking_url,label_url,charge_status,shipping_cost",
    { limit: 1000 },
  );
  const shipmentBoxes = await selectTable("shipment_boxes", "shipment_id,box_id", { limit: 1000 });

  if (boxes.length === 0) warn("No boxes found; schema checks passed, but lifecycle checks need seed/live data");
  else pass(`Loaded ${boxes.length} boxes for lifecycle checks`);

  const transitBoxes = boxes.filter((box) =>
    box.status === "in_transit_to_customer" ||
    box.status === "in_transit_to_storage" ||
    box.fulfillment_status === "shipped_to_customer" ||
    box.fulfillment_status === "awaiting_storage_arrival"
  );

  const adminRowsWithLatestShipment = adminRows.filter((row) => row.latest_shipment_id);

  if (shipments.length === 0) {
    if (transitBoxes.length > 0 || adminRowsWithLatestShipment.length > 0) {
      fail(
        `No shipments are selectable, but transit/latest-shipment evidence exists. Transit boxes: ${transitBoxes.length}; admin rows with latest_shipment_id: ${adminRowsWithLatestShipment.length}. Check RLS/service-role key or missing shipment records.`,
      );
    } else {
      warn("No shipments found; logistics checks need shipment data");
    }
  } else {
    pass(`Loaded ${shipments.length} shipments for logistics checks`);
  }

  const adminIds = adminRows.map((row) => row.id);
  const duplicateAdminIds = [...new Set(adminIds.filter((id, index) => adminIds.indexOf(id) !== index))];
  if (duplicateAdminIds.length > 0) {
    fail(`admin_ops_bins duplicates boxes: ${duplicateAdminIds.slice(0, 10).join(", ")}`);
  } else {
    pass("admin_ops_bins returns one row per box in sampled data");
  }

  const shipmentIds = new Set(shipments.map((shipment) => shipment.id));
  const unreadableLatestShipmentIds = adminRowsWithLatestShipment
    .map((row) => row.latest_shipment_id)
    .filter((shipmentId) => !shipmentIds.has(shipmentId));
  if (unreadableLatestShipmentIds.length > 0) {
    fail(
      `admin_ops_bins references shipment(s) that are not selectable from shipments: ${[...new Set(unreadableLatestShipmentIds)].slice(0, 10).join(", ")}. This usually means RLS blocks shipments for the current key, or the view is pointing at orphaned shipment data.`,
    );
  }

  const transitBoxesWithoutLatestShipment = adminRows.filter((row) =>
    (row.status === "in_transit_to_customer" ||
      row.status === "in_transit_to_storage" ||
      row.fulfillment_status === "shipped_to_customer" ||
      row.fulfillment_status === "awaiting_storage_arrival") &&
    !row.latest_shipment_id
  );
  if (transitBoxesWithoutLatestShipment.length > 0) {
    fail(
      `Transit box(es) have no latest_shipment_id in admin_ops_bins: ${transitBoxesWithoutLatestShipment.map((row) => row.id).slice(0, 10).join(", ")}. Shipment lifecycle should remain shipment-driven through shipment_boxes.`,
    );
  }

  for (const box of boxes) {
    assertEnumValue(box, "status", VALID_BOX_STATUS, "Box");
    assertEnumValue(box, "fulfillment_status", VALID_FULFILLMENT_STATUS, "Box");
    assertEnumValue(box, "checkout_status", VALID_CHECKOUT_STATUS, "Box");
    assertEnumValue(box, "lifecycle_status", VALID_LIFECYCLE_STATUS, "Box");

    if (box.lifecycle_status === "removed_from_system" && box.checkout_status !== "paid") {
      warn(`Removed box ${box.id} is not paid; verify this is intentional history/admin data`);
    }

    if (box.lifecycle_status === "auction") {
      if (!box.lifecycle_attention_reason) warn(`Auction box ${box.id} has no lifecycle_attention_reason`);
      if (box.cancellation_shipping_charge_status === "paid" && box.subscription_payment_status !== "failed") {
        warn(`Auction box ${box.id} has paid cancellation shipping and no failed subscription payment marker`);
      }
    }

    const deadline = getGraceDeadline(box);
    const hasFailedPayment =
      box.cancellation_shipping_charge_status === "failed" || box.subscription_payment_status === "failed";
    if (hasFailedPayment && box.lifecycle_status === "active") {
      if (!deadline) {
        fail(`Active failed-payment box ${box.id} has no computable grace deadline`);
      } else {
        pass(`Failed-payment box ${box.id} has grace deadline ${deadline.toISOString().slice(0, 10)}`);
      }
    }
  }

  const paidVisibleBoxes = boxes.filter(
    (box) => box.checkout_status === "paid" && box.lifecycle_status !== "removed_from_system",
  );
  pass(`Customer My Bins eligibility sample: ${paidVisibleBoxes.length} paid non-removed boxes`);

  for (const shipment of shipments) {
    assertEnumValue(shipment, "shipment_direction", VALID_SHIPMENT_DIRECTION, "Shipment");
    assertEnumValue(shipment, "shipping_status", VALID_SHIPPING_STATUS, "Shipment");
    assertEnumValue(shipment, "label_status", VALID_LABEL_STATUS, "Shipment");
    assertEnumValue(shipment, "charge_status", VALID_CHARGE_STATUS, "Shipment");

    const linkedBoxes = shipmentBoxes.filter((link) => link.shipment_id === shipment.id);
    if (linkedBoxes.length === 0) {
      warn(`Shipment ${shipment.id} is not linked to any boxes through shipment_boxes`);
    }

    if (shipment.charge_status === "failed" && shipment.shipping_status !== "pending_payment") {
      fail(`Failed-charge shipment ${shipment.id} should be pending_payment, got ${shipment.shipping_status}`);
    }

    if (shipment.shipping_status === "label_created") {
      if (shipment.label_status !== "printed") fail(`Label-created shipment ${shipment.id} should have label_status printed`);
      if (!shipment.tracking_number) warn(`Label-created shipment ${shipment.id} has no tracking_number`);
      if (!shipment.label_url) warn(`Label-created shipment ${shipment.id} has no label_url`);
    }
  }

  const groupedShipments = new Map();
  for (const link of shipmentBoxes) {
    groupedShipments.set(link.shipment_id, (groupedShipments.get(link.shipment_id) ?? 0) + 1);
  }
  const oversizeShipments = [...groupedShipments.entries()].filter(([, count]) => count > 3);
  if (oversizeShipments.length > 0) {
    fail(`Shipment(s) linked to more than 3 boxes: ${oversizeShipments.map(([id, count]) => `${id} (${count})`).join(", ")}`);
  } else if (groupedShipments.size > 0) {
    pass("Grouped shipment rule respected in sampled data: max 3 boxes per shipment");
  }

  const statusByDirection = {
    to_customer: {
      in_transit: { boxStatus: "in_transit_to_customer", fulfillment: "shipped_to_customer" },
      delivered: { boxStatus: "at_customer", fulfillment: "bin_with_customer" },
    },
    to_storage: {
      in_transit: { boxStatus: "in_transit_to_storage", fulfillment: "awaiting_storage_arrival" },
      delivered: { boxStatus: "stored", fulfillment: "stored" },
    },
  };
  const boxesById = new Map(boxes.map((box) => [box.id, box]));
  for (const shipment of shipments) {
    const expected = statusByDirection[shipment.shipment_direction]?.[shipment.shipping_status];
    if (!expected) continue;
    const linkedBoxIds = shipmentBoxes.filter((link) => link.shipment_id === shipment.id).map((link) => link.box_id);
    for (const boxId of linkedBoxIds) {
      const box = boxesById.get(boxId);
      if (!box) continue;
      if (box.status !== expected.boxStatus || box.fulfillment_status !== expected.fulfillment) {
        fail(
          `Shipment ${shipment.id} (${shipment.shipment_direction}/${shipment.shipping_status}) expects box ${boxId} to be ${expected.boxStatus}/${expected.fulfillment}, got ${box.status}/${box.fulfillment_status}`,
        );
      }
    }
  }

  const graceRows = boxes.filter((box) => box.lifecycle_status === "active" && getGraceDeadline(box));
  for (const box of graceRows) {
    const deadline = getGraceDeadline(box);
    const remaining = daysBetween(new Date(), deadline);
    if (remaining <= 5 && remaining >= 0) warn(`Box ${box.id} is inside critical grace window: ${remaining} day(s) remaining`);
  }
}

async function runMutationSmokeChecks() {
  console.log("\nMutation smoke mode requested");
  if (!mutationShipmentId) {
    fail("SANITY_SHIPMENT_ID is required for --mutation-smoke; skipped RPC mutation checks");
    return;
  }

  const before = await selectTable("shipments", "id,shipping_status,label_status,charge_status", { limit: 1000 });
  const target = before.find((shipment) => shipment.id === mutationShipmentId);
  if (!target) {
    fail(`SANITY_SHIPMENT_ID ${mutationShipmentId} was not found`);
    return;
  }

  if (target.charge_status !== "paid" || target.shipping_status !== "paid") {
    fail(`Shipment ${mutationShipmentId} must be paid/paid before admin_generate_label; got ${target.charge_status}/${target.shipping_status}`);
    return;
  }

  const { error } = await withTimeout("admin_generate_label", (signal) =>
    supabase.rpc("admin_generate_label", { p_shipment_id: mutationShipmentId }).abortSignal(signal),
  );
  if (error) {
    fail(`admin_generate_label RPC failed: ${error.message}`);
    return;
  }

  pass(`admin_generate_label RPC succeeded for shipment ${mutationShipmentId}`);
}

try {
  await runReadOnlyChecks();
  if (shouldRunMutationSmoke) await runMutationSmokeChecks();
} catch (error) {
  fail(error.message);
}

for (const check of checks) console.log(`${check.icon} ${check.message}`);

console.log(`\nResult: ${failures} failure(s), ${warnings} warning(s), ${checks.length} check(s)`);

if (failures > 0) process.exit(1);
