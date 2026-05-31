/**
 * Unpaid initial-purchase cart rows store provisional `box_number` values in `boxes`.
 * Paid checkout replaces them with permanent numbers in initialPurchaseFulfillment.
 * UI cart labels are derived here so removals re-sequence from 001 without touching paid bins.
 */

export function isInitialPurchaseCartPlaceholder(box) {
  return (
    box?.checkout_status === "in_cart" &&
    box?.cart_type === "initial_purchase"
  );
}

/** Stable order: plan groups by earliest row `created_at`, then group id, then box id. */
export function sortInitialPurchaseCartBoxes(boxes) {
  const groupFirstCreated = new Map();
  for (const box of boxes) {
    const groupId = String(box.subscription_group_id || box.id);
    const created = new Date(box.created_at || 0).getTime();
    const prev = groupFirstCreated.get(groupId);
    if (prev == null || created < prev) {
      groupFirstCreated.set(groupId, created);
    }
  }

  return [...boxes].sort((a, b) => {
    const groupA = String(a.subscription_group_id || a.id);
    const groupB = String(b.subscription_group_id || b.id);
    const createdA = groupFirstCreated.get(groupA) ?? 0;
    const createdB = groupFirstCreated.get(groupB) ?? 0;
    if (createdA !== createdB) return createdA - createdB;
    if (groupA !== groupB) return groupA.localeCompare(groupB);
    return String(a.id).localeCompare(String(b.id));
  });
}

export function formatCartDisplayBinNumber(indexOneBased) {
  return String(indexOneBased).padStart(3, "0");
}

/** Map box id → display label (001…) for all initial-purchase cart placeholders in `cartBoxes`. */
export function buildCartDisplayBinNumberByBoxId(cartBoxes) {
  const placeholders = sortInitialPurchaseCartBoxes(
    (cartBoxes || []).filter(isInitialPurchaseCartPlaceholder),
  );
  const map = new Map();
  placeholders.forEach((box, index) => {
    map.set(String(box.id), formatCartDisplayBinNumber(index + 1));
  });
  return map;
}

/** Cart UI label: sequential placeholder label when in cart; otherwise persisted `box_number`. */
export function getCartDisplayBinLabel(box, displayByBoxId) {
  const id = String(box?.id ?? "");
  if (displayByBoxId?.has(id)) {
    return displayByBoxId.get(id);
  }
  if (box?.box_number != null && String(box.box_number).trim() !== "") {
    return String(box.box_number).trim();
  }
  return id;
}

/** Labels for one initial-purchase cart group (comma-separated), in display order. */
export function formatInitialPurchaseGroupBinLabels(groupBoxes, displayByBoxId) {
  const sorted = sortInitialPurchaseCartBoxes(groupBoxes || []);
  return sorted.map((box) => getCartDisplayBinLabel(box, displayByBoxId)).join(", ");
}

/** When allocating provisional DB numbers, ignore unpaid cart placeholders (display is derived separately). */
export function collectUsedBoxNumbersForAllocation(allBoxes) {
  return new Set(
    (allBoxes || [])
      .filter((box) => !isInitialPurchaseCartPlaceholder(box))
      .map((box) => box.box_number)
      .filter(Boolean)
      .map(String),
  );
}

export function allocateNextBoxNumbers(allBoxes, count) {
  const usedNumbers = collectUsedBoxNumbersForAllocation(allBoxes);
  const numbers = [];
  let candidate = 1;

  while (numbers.length < count) {
    const nextNumber = formatCartDisplayBinNumber(candidate);
    if (!usedNumbers.has(nextNumber)) {
      numbers.push(nextNumber);
      usedNumbers.add(nextNumber);
    }
    candidate += 1;
  }

  return numbers;
}
