/**
 * Manual verification for cart display bin numbering.
 * Run: node scripts/cart-bin-display-check.mjs
 */
import {
  buildCartDisplayBinNumberByBoxId,
  formatInitialPurchaseGroupBinLabels,
  isInitialPurchaseCartPlaceholder,
} from "../src/utils/cartBinDisplay.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`PASS: ${message}`);
  return true;
}

function box(id, groupId, boxNumber, createdAt) {
  return {
    id,
    subscription_group_id: groupId,
    box_number: boxNumber,
    checkout_status: "in_cart",
    cart_type: "initial_purchase",
    created_at: createdAt,
  };
}

const fourBinGroup = "group-four";
const twoBinGroup = "group-two";

const fourBins = [
  box("four-1", fourBinGroup, "001", "2026-01-01T00:00:00Z"),
  box("four-2", fourBinGroup, "002", "2026-01-01T00:00:01Z"),
  box("four-3", fourBinGroup, "003", "2026-01-01T00:00:02Z"),
  box("four-4", fourBinGroup, "004", "2026-01-01T00:00:03Z"),
];

const twoBins = [
  box("two-1", twoBinGroup, "005", "2026-01-02T00:00:00Z"),
  box("two-2", twoBinGroup, "006", "2026-01-02T00:00:01Z"),
];

const allSix = [...fourBins, ...twoBins];
const mapSix = buildCartDisplayBinNumberByBoxId(allSix);

assert(mapSix.get("four-1") === "001", "4-bin plan → first bin displays 001");
assert(mapSix.get("four-4") === "004", "4-bin plan → fourth bin displays 004");
assert(mapSix.get("two-1") === "005", "2-bin plan after 4-bin → displays 005");
assert(mapSix.get("two-2") === "006", "2-bin plan after 4-bin → displays 006");

const afterRemoveFour = buildCartDisplayBinNumberByBoxId(twoBins);
assert(afterRemoveFour.get("two-1") === "001", "after remove 4-bin → first remaining is 001");
assert(afterRemoveFour.get("two-2") === "002", "after remove 4-bin → second remaining is 002");

assert(
  formatInitialPurchaseGroupBinLabels(twoBins, afterRemoveFour) === "001, 002",
  "group label string is 001, 002",
);

const paidBin = {
  id: "paid-1",
  box_number: "001",
  checkout_status: "paid",
  cart_type: null,
};
assert(
  !isInitialPurchaseCartPlaceholder(paidBin),
  "paid bins are not cart placeholders",
);

if (process.exitCode) {
  console.error("\nSome cart bin display checks failed.");
  process.exit(1);
} else {
  console.log("\nAll cart bin display checks passed.");
}
