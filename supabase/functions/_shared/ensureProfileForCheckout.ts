import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type CheckoutProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  stripe_customer_id: string | null;
};

const trim = (v: unknown) => String(v ?? "").trim();

export type PhysicalAddressInput = {
  fullName: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
};

/** Pull a usable postal address from cart boxes (requested_shipping_address JSON). */
export function derivePhysicalAddressFromBoxes(
  boxes: Array<Record<string, unknown>>,
): PhysicalAddressInput | null {
  for (const box of boxes) {
    const raw = box.requested_shipping_address as Record<string, unknown> | null | undefined;
    if (!raw || typeof raw !== "object") continue;
    const line1 = trim(raw.address_line1 ?? raw.addressLine1);
    if (!line1) continue;
    return {
      fullName: trim(raw.full_name ?? raw.fullName),
      email: trim(raw.email),
      addressLine1: line1,
      addressLine2: trim(raw.address_line2 ?? raw.addressLine2),
      city: trim(raw.city),
      state: trim(raw.state),
      zip: trim(raw.zip),
    };
  }
  return null;
}

/**
 * Loads `profiles` for Stripe checkout. If the row is missing (common for new users when client upsert
 * failed or was skipped), creates it from Auth admin + the validated checkout shipping address.
 */
export async function loadOrCreateProfileForCheckout(
  supabase: SupabaseClient,
  userId: string,
  address: PhysicalAddressInput,
): Promise<{ profile: CheckoutProfileRow | null; errorMessage: string | null }> {
  const { data: existing, error: readErr } = await supabase
    .from("profiles")
    .select("id,email,full_name,stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();

  if (readErr) {
    return { profile: null, errorMessage: readErr.message };
  }

  if (existing) {
    return { profile: existing as CheckoutProfileRow, errorMessage: null };
  }

  const { data: adminData, error: adminErr } = await supabase.auth.admin.getUserById(userId);
  if (adminErr || !adminData?.user) {
    return { profile: null, errorMessage: adminErr?.message || "User not found in Auth" };
  }

  const u = adminData.user;
  const meta = (u.user_metadata || {}) as Record<string, unknown>;
  const metaName = typeof meta.full_name === "string" ? trim(meta.full_name) : "";

  const email = trim(address.email) || trim(u.email) || "";
  const fullName = trim(address.fullName) || metaName;

  const upsertRow = {
    id: userId,
    email: email || null,
    full_name: fullName || null,
    address_line1: trim(address.addressLine1),
    address_line2: trim(address.addressLine2) || null,
    city: trim(address.city),
    state: trim(address.state),
    zip: trim(address.zip),
  };

  const { data: created, error: upErr } = await supabase
    .from("profiles")
    .upsert(upsertRow, { onConflict: "id" })
    .select("id,email,full_name,stripe_customer_id")
    .maybeSingle();

  if (upErr || !created) {
    return { profile: null, errorMessage: upErr?.message || "Failed to create profile for checkout" };
  }

  return { profile: created as CheckoutProfileRow, errorMessage: null };
}
