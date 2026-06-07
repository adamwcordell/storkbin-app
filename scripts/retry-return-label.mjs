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

const projectUrl = env.SUPABASE_URL;
const anonKey = env.SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const shipmentId = process.argv[2] || "ef19cdb6-be37-43d4-bc7c-20a1507cba1e";

const adminEmail = process.env.ADMIN_EMAIL || "adamwcordell@gmail.com";

/** Service-role magic-link OTP → short-lived admin JWT for purchase-shipping-label. */
async function adminJwt() {
  const gen = await fetch(`${projectUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: adminEmail }),
  }).then((r) => r.json());
  if (!gen?.email_otp) {
    throw new Error(`Admin generate_link failed: ${JSON.stringify(gen).slice(0, 300)}`);
  }
  const verify = await fetch(`${projectUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: adminEmail, token: gen.email_otp }),
  });
  const data = await verify.json();
  if (!verify.ok || !data.access_token) {
    throw new Error(`Admin verify failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.access_token;
}

async function getShipment() {
  const res = await fetch(
    `${projectUrl}/rest/v1/shipments?select=id,shipping_status,label_status,label_failure_reason,tracking_number&id=eq.${encodeURIComponent(shipmentId)}`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  return (await res.json())[0];
}

const before = await getShipment();
console.log("Before:", before);

const jwt = await adminJwt();
const purchaseRes = await fetch(`${projectUrl}/functions/v1/purchase-shipping-label`, {
  method: "POST",
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${jwt}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ shipmentId }),
});
const purchaseBody = await purchaseRes.json();
console.log("Purchase HTTP", purchaseRes.status);
console.log(JSON.stringify(purchaseBody, null, 2).slice(0, 2000));

const after = await getShipment();
console.log("After:", after);

const emails = await fetch(
  `${projectUrl}/rest/v1/customer_email_log?email_type=eq.bins_shipped_to_storage&reference_key=eq.${encodeURIComponent(shipmentId)}&select=recipient_email,sent_at,resend_ok`,
  { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
).then((r) => r.json());
console.log("Email log:", emails);
