import { parseBoxIdFromBinScan } from "./scanMatch";

/** True when bin has a home bay but is not confirmed placed in rack. */
export function needsHomeBayPlacement(assignment) {
  if (!assignment?.bay_code) return false;
  return String(assignment.status || "") !== "placed";
}

export { bayScanMatchesCode, explainBayScanMismatch } from "./scanMatch";

/** Resolve scan token to canonical boxes.id for admin warehouse flows. */
export async function resolveAdminBoxId(supabase, rawToken) {
  const raw = String(rawToken || "").trim();
  const parsed = parseBoxIdFromBinScan(raw) || raw;
  if (!parsed) return null;

  const { data: byId, error: errId } = await supabase
    .from("admin_ops_bins")
    .select("id")
    .eq("id", parsed)
    .maybeSingle();
  if (!errId && byId?.id) return String(byId.id);

  const { data: byInternal, error: errInt } = await supabase
    .from("admin_ops_bins")
    .select("id")
    .eq("internal_id", parsed)
    .maybeSingle();
  if (!errInt && byInternal?.id) return String(byInternal.id);

  const { data: bare, error: bareErr } = await supabase
    .from("boxes")
    .select("id")
    .eq("id", parsed)
    .maybeSingle();
  if (!bareErr && bare?.id) return String(bare.id);

  return null;
}
