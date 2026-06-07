import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.smoke", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function q(path, params = "") {
  const res = await fetch(`${url}/rest/v1/${path}${params ? `?${params}` : ""}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 800)}`);
  return JSON.parse(text);
}

const shipments = await q(
  "shipments",
  [
    "select=id,box_id,user_id,shipment_direction,shipping_status,charge_status,label_status,label_failure_reason,tracking_number,label_url,stripe_payment_intent_id,stripe_checkout_session_id,label_purchased_at,charge_attempted_at,created_at",
    "shipment_direction=eq.to_storage",
    "charge_status=eq.paid",
    "order=created_at.desc",
    "limit=20",
  ].join("&"),
);

console.log("=== Recent paid to_storage shipments ===");
for (const s of shipments) {
  console.log(
    JSON.stringify(
      {
        id: s.id,
        box_id: s.box_id,
        shipping_status: s.shipping_status,
        label_status: s.label_status,
        label_failure_reason: s.label_failure_reason,
        tracking_number: s.tracking_number,
        has_label_url: Boolean(s.label_url),
        stripe_pi: Boolean(s.stripe_payment_intent_id),
        stripe_cs: Boolean(s.stripe_checkout_session_id),
        label_purchased_at: s.label_purchased_at,
        charge_attempted_at: s.charge_attempted_at,
        created_at: s.created_at,
      },
      null,
      0,
    ),
  );
}

const boxIds = [...new Set(shipments.map((s) => s.box_id).filter(Boolean))];
if (boxIds.length) {
  const boxes = await q(
    "boxes",
    `select=id,box_number,status,fulfillment_status,checkout_status&id=in.(${boxIds.map(encodeURIComponent).join(",")})`,
  );
  console.log("\n=== Related boxes ===");
  for (const b of boxes) {
    console.log(
      JSON.stringify(
        {
          id: b.id,
          box_number: b.box_number,
          status: b.status,
          fulfillment_status: b.fulfillment_status,
        },
        null,
        0,
      ),
    );
  }
}

const shipmentIds = shipments.map((s) => s.id);
if (shipmentIds.length) {
  const emails = await q(
    "customer_email_log",
    `select=email_type,reference_key,recipient_email,sent_at,resend_ok,error_message&email_type=eq.bins_shipped_to_storage&reference_key=in.(${shipmentIds.map(encodeURIComponent).join(",")})&order=sent_at.desc`,
  );
  console.log("\n=== Return label emails ===");
  console.log(emails.length ? emails : "(none logged)");
}
