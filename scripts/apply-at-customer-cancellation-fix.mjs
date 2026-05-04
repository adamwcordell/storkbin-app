import fs from "fs";
import path from "path";

const appPath = path.join(process.cwd(), "src", "App.jsx");

if (!fs.existsSync(appPath)) {
  console.error("Could not find src/App.jsx. Run this from your StorkBin project root.");
  process.exit(1);
}

let app = fs.readFileSync(appPath, "utf8");

if (app.includes("at_customer_cancelled_past_end_fix")) {
  console.log("At-customer cancellation lifecycle fix already applied.");
  process.exit(0);
}

const marker = "const processLifecycleUpdates = async (boxList) => {";
const markerIndex = app.indexOf(marker);

if (markerIndex === -1) {
  console.error("Could not find processLifecycleUpdates in src/App.jsx. No changes made.");
  process.exit(1);
}

const bodyStart = app.indexOf("{", markerIndex);
const insertAfter = bodyStart + 1;

const patch = `

    // at_customer_cancelled_past_end_fix
    // If a bin is already with the customer and its approved cancellation end date has passed,
    // terminate the subscription lifecycle so the customer-facing reactivation/renewal flow can appear.
    // Stored-bin cancellations are still handled by the existing final-shipment branch below.
    const nowForAtCustomerCancellation = new Date();

    for (const box of boxList) {
      const cancellationEndDate = box.subscription_ends_at
        ? new Date(box.subscription_ends_at)
        : null;

      const shouldTerminateCustomerHeldCancelledBin =
        box.cancel_status === "approved" &&
        box.status === "at_customer" &&
        box.subscription_lifecycle_status !== "terminated" &&
        cancellationEndDate &&
        cancellationEndDate <= nowForAtCustomerCancellation;

      if (!shouldTerminateCustomerHeldCancelledBin) {
        continue;
      }

      const { error: atCustomerCancellationError } = await supabase
        .from("boxes")
        .update({
          subscription_lifecycle_status: "terminated",
          subscription_status: "terminated",
          subscription_terminated_at: nowForAtCustomerCancellation.toISOString(),
          lifecycle_attention_reason: null,
          lifecycle_deadline_at: null,
        })
        .eq("id", box.id);

      if (atCustomerCancellationError) {
        console.error(
          "Failed to terminate customer-held cancelled bin",
          box.id,
          atCustomerCancellationError
        );
      }
    }

`;

app = app.slice(0, insertAfter) + patch + app.slice(insertAfter);

fs.writeFileSync(appPath, app);
console.log("Patched src/App.jsx: restored at-customer cancellation termination branch.");
