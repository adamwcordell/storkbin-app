import { needsHomeBayPlacement } from "./binIntake";

/** Human-readable home bay line for admin UI (permanent bay_code, not workflow location). */
export function formatHomeBayLine(assignment, box) {
  const code = String(assignment?.bay_code || "").trim().toUpperCase();
  if (!code) return null;

  const status = String(assignment?.status || "");
  const physical = String(box?.status || "");

  let secondary = "";
  if (physical === "at_customer") {
    secondary = "With customer — home bay reserved";
  } else if (physical === "in_transit_to_storage") {
    secondary = "Return in transit";
  } else if (physical === "in_transit_to_customer") {
    secondary = "Outbound in transit";
  } else if (status === "placed") {
    secondary = "In rack";
  } else if (needsHomeBayPlacement(assignment)) {
    secondary = "Place in home bay";
  } else if (status === "away_from_warehouse") {
    secondary = "Away from warehouse";
  } else if (["picked", "in_staging", "label_verified", "qr_applied", "outbound_labeled"].includes(status)) {
    secondary = `Outbound prep (${status.replace(/_/g, " ")})`;
  }

  return {
    primary: `Home bay: ${code}`,
    secondary,
  };
}
