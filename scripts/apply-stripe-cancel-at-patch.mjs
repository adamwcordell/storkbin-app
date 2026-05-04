import fs from "fs";
import path from "path";

const appPath = path.join(process.cwd(), "src", "App.jsx");

if (!fs.existsSync(appPath)) {
  console.error("Could not find src/App.jsx. Run this from your StorkBin project root.");
  process.exit(1);
}

let app = fs.readFileSync(appPath, "utf8");

if (app.includes("schedule-stripe-cancellation")) {
  console.log("App.jsx already calls schedule-stripe-cancellation. No changes made.");
  process.exit(0);
}

const target = `    if (error) {
      alert(error.message);
    } else {
      alert(
`;

const replacement = `    if (error) {
      alert(error.message);
    } else {
      if (box.stripe_subscription_id) {
        const { error: stripeCancelError } = await supabase.functions.invoke(
          "schedule-stripe-cancellation",
          {
            body: {
              stripeSubscriptionId: box.stripe_subscription_id,
              cancelAt: subscriptionEndsAt.toISOString(),
            },
          }
        );

        if (stripeCancelError) {
          alert(
            "Cancellation was saved in StorkBin, but Stripe could not be scheduled. Please contact support before relying on this cancellation."
          );
          console.error("Stripe cancellation scheduling failed:", stripeCancelError);
        }
      }

      alert(
`;

const index = app.indexOf(target);

if (index === -1) {
  console.error("Could not find the cancellation success block in src/App.jsx. No changes made.");
  process.exit(1);
}

app = app.slice(0, index) + replacement + app.slice(index + target.length);

fs.writeFileSync(appPath, app);
console.log("Patched src/App.jsx to schedule Stripe cancellation at subscription_ends_at.");
