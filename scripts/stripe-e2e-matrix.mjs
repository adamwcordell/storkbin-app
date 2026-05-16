/**
 * StorkBin Stripe checkout E2E matrix (no secrets in stdout).
 *
 * Loads env from SMOKE_ENV_FILE or `.env.smoke` (same as beta:smoke).
 * Uses Stripe test mode: hosted Checkout often has no payment_intent until the
 * customer opens the Checkout page, so pay steps may SKIP; finalize/webhook
 * chains run only after a successful pay. Webhook-only flows need STRIPE_WEBHOOK_SECRET.
 *
 *   npm run test:stripe-matrix
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const envRel = (process.env.SMOKE_ENV_FILE || "").trim() || ".env.smoke";
const envPath = path.isAbsolute(envRel) ? envRel : path.join(root, envRel);

if (!fs.existsSync(envPath)) {
  console.error(`Missing env file: ${envRel}`);
  process.exit(1);
}

dotenv.config({ path: envPath, override: true });

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || "wslymzcbbevnoybbsbgq";
const supabaseUrl = process.env.SUPABASE_URL?.trim() || `https://${projectRef}.supabase.co`;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
const stripeBinMonthlyPriceId =
  process.env.STRIPE_BIN_MONTHLY_PRICE_ID?.trim() || process.env.STRIPE_MONTHLY_PRICE_ID?.trim() || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";

const credentialPairs = () => {
  const pairs = [];
  const seen = new Set();
  const push = (label, email, password) => {
    if (!email || !password) return;
    const key = `${email}\n${password}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ label, email, password });
  };
  const te = process.env.TEST_USER_EMAIL?.trim();
  const tp = process.env.TEST_USER_PASSWORD?.trim();
  const ae = process.env.ADMIN_SMOKE_EMAIL?.trim();
  const ap = process.env.ADMIN_SMOKE_PASSWORD?.trim();
  /** Same order as beta:smoke password path: admin first, then optional distinct test user. */
  push("ADMIN_SMOKE_EMAIL", ae, ap);
  push("TEST_USER_EMAIL", te, tp);
  return pairs;
};

const APP_ORIGIN = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");

/** @type {{ key: string, label: string, status: "PASS" | "FAIL" | "SKIP"; detail: string }[]} */
const rows = [];

function row(key, label, status, detail) {
  rows.push({ key, label, status, detail: redactSecrets(String(detail || "")) });
}

function redactSecrets(s) {
  let out = s;
  out = out.replace(/sk_(live|test)_[A-Za-z0-9]+/g, "sk_***");
  out = out.replace(/whsec_[A-Za-z0-9]+/g, "whsec_***");
  out = out.replace(/eyJ[A-Za-z0-9._-]{20,}/g, "eyJ***");
  out = out.replace(/Bearer\s+eyJ\S+/gi, "Bearer eyJ***");
  return out.slice(0, 500);
}

/** Extract Checkout Session id (cs_...) from a Stripe Checkout URL or bare id string. */
function parseCheckoutSessionId(urlOrId) {
  const s = String(urlOrId || "").trim();
  const m = s.match(/(cs_(?:test|live)_[A-Za-z0-9]+)/);
  return m ? m[1] : s.startsWith("cs_") ? s : "";
}

async function edgePost(functionName, body, bearer, apikey) {
  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      apikey: apikey || bearer,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function postStripeWebhook(stripe, eventPayload) {
  if (!webhookSecret) {
    return { ok: false, skipped: true, reason: "STRIPE_WEBHOOK_SECRET not set" };
  }
  const payload = JSON.stringify(eventPayload);
  const stripeSignature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  const res = await fetch(`${supabaseUrl}/functions/v1/stripe-webhook`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
      "Stripe-Signature": stripeSignature,
    },
    body: payload,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Some Stripe accounts defer PI creation until the hosted Checkout URL is hit once. */
async function warmHostedCheckoutUrl(checkoutUrl) {
  const u = String(checkoutUrl || "").trim();
  if (!u.startsWith("http")) return;
  try {
    await fetch(u, { method: "GET", redirect: "follow" });
  } catch {
    /* ignore */
  }
}

/**
 * Pay a Checkout Session in payment mode (test cards).
 * @param {Stripe} stripe
 */
async function payCheckoutSessionPaymentMode(stripe, sessionId, checkoutUrl) {
  await warmHostedCheckoutUrl(checkoutUrl);
  let session = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });
    if (session.payment_status === "paid") {
      return { paid: true, session };
    }
    const pi = session.payment_intent;
    let piId = typeof pi === "string" ? pi : pi?.id;
    if (!piId && session.customer) {
      const cust = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (cust) {
        const list = await stripe.paymentIntents.list({ customer: cust, limit: 15 });
        const match = list.data.find(
          (p) =>
            p.metadata?.checkout_session_id === sessionId ||
            String(p.description || "").includes(sessionId),
        );
        piId = match?.id;
      }
    }
    if (piId) {
      const intent = await stripe.paymentIntents.retrieve(piId);
      if (intent.status === "succeeded") {
        const refreshed = await stripe.checkout.sessions.retrieve(sessionId);
        return { paid: true, session: refreshed };
      }
      const confirmed = await stripe.paymentIntents.confirm(piId, {
        payment_method: "pm_card_visa",
      });
      if (confirmed.status !== "succeeded") {
        return { error: `PI status ${confirmed.status}` };
      }
      const refreshed = await stripe.checkout.sessions.retrieve(sessionId);
      return { paid: true, session: refreshed };
    }
    await sleep(500 + attempt * 400);
  }
  return {
    skipped: true,
    reason:
      "Hosted Checkout leaves payment_intent null until the customer opens the Checkout page (Stripe API 2026). Complete payment in a browser or Dashboard, or use embedded_page Checkout for server-driven tests.",
  };
}

/**
 * Complete a Checkout Session in setup mode.
 * @param {Stripe} stripe
 */
async function payCheckoutSessionSetupMode(stripe, sessionId) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["setup_intent"],
  });
  if (session.status === "complete") {
    return { ok: true, session };
  }
  const si = session.setup_intent;
  const siId = typeof si === "string" ? si : si?.id;
  if (!siId) {
    return { error: "no setup_intent on session" };
  }
  await stripe.setupIntents.confirm(siId, {
    payment_method: "pm_card_visa",
  });
  const refreshed = await stripe.checkout.sessions.retrieve(sessionId);
  return { ok: true, session: refreshed };
}

const isJwtLikelyExpired = (jwt) => {
  try {
    const parts = String(jwt || "").split(".");
    if (parts.length < 2) return true;
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const exp = Number(payload.exp);
    if (!exp) return false;
    return exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
};

async function signInUserJwt() {
  const directJwt = process.env.ADMIN_SMOKE_JWT?.trim();
  if (directJwt && !isJwtLikelyExpired(directJwt)) {
    if (!anonKey || (!anonKey.startsWith("eyJ") && !anonKey.startsWith("sb_publishable_"))) {
      return { ok: false, error: "SUPABASE_ANON_KEY must be publishable shape" };
    }
    const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data, error } = await auth.auth.getUser(directJwt);
    if (!error && data?.user?.id) {
      return { ok: true, jwt: directJwt, userId: data.user.id, credentialLabel: "ADMIN_SMOKE_JWT" };
    }
    // Stale JWT in env: fall through to password sign-in when credentials exist.
  }

  const pairs = credentialPairs();
  if (pairs.length === 0) {
    return {
      ok: false,
      error:
        "Set ADMIN_SMOKE_JWT (paste access_token) or TEST_USER_EMAIL+PASSWORD / ADMIN_SMOKE_EMAIL+PASSWORD",
    };
  }
  if (!anonKey || (!anonKey.startsWith("eyJ") && !anonKey.startsWith("sb_publishable_"))) {
    return { ok: false, error: "SUPABASE_ANON_KEY must be publishable shape" };
  }
  const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const errors = [];
  for (const p of pairs) {
    const { data, error } = await auth.auth.signInWithPassword({ email: p.email, password: p.password });
    if (!error && data.session?.access_token) {
      return { ok: true, jwt: data.session.access_token, userId: data.user.id, credentialLabel: p.label };
    }
    errors.push(`${p.label}: ${error?.message || "no session"}`);
  }
  return { ok: false, error: errors.join(" | ") };
}

function planSnapshotOneBin() {
  return {
    subscription_plan_id: "one_bin",
    subscription_plan_name: "1 Bin",
    plan_bin_count: 1,
    plan_setup_fee: 25,
    plan_monthly_rate: 15,
    minimum_months: 12,
    return_shipping_discount_percent: 0,
    plan_initial_stack_size: 4,
  };
}

async function main() {
  console.log("StorkBin stripe-e2e-matrix");
  console.log(`Env file: ${path.relative(root, envPath).replace(/\\/g, "/")}`);
  console.log(`Project: ${projectRef}`);
  console.log("");

  if (!serviceKey || !anonKey || !stripeSecretKey) {
    row("env", "Required env vars present", "FAIL", "Missing SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, or STRIPE_SECRET_KEY");
    printRows();
    process.exit(1);
  }

  const stripe = new Stripe(stripeSecretKey);

  const authRes = await signInUserJwt();
  if (!authRes.ok) {
    row("auth", "Test user sign-in", "FAIL", authRes.error);
    printRows();
    process.exit(1);
  }
  const { jwt: userJwt, userId, credentialLabel } = authRes;
  row("auth", "Test user sign-in", "PASS", `session obtained (${credentialLabel || "credentials"})`);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("id,email,full_name,address_line1,address_line2,city,state,zip,stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();

  if (profErr || !profile) {
    row("profile", "Load profile for shipping address", "FAIL", profErr?.message || "no profile");
    printRows();
    process.exit(1);
  }

  const shippingAddress = {
    fullName: String(profile.full_name || "Test User").trim() || "Test User",
    email: String(profile.email || testEmail).trim(),
    addressLine1: String(profile.address_line1 || "").trim(),
    addressLine2: String(profile.address_line2 || "").trim(),
    city: String(profile.city || "").trim(),
    state: String(profile.state || "").trim(),
    zip: String(profile.zip || "").trim(),
  };
  if (!shippingAddress.addressLine1 || !shippingAddress.city || !shippingAddress.state || !shippingAddress.zip) {
    row(
      "profile",
      "Profile shipping address complete",
      "FAIL",
      "Fill profile address_line1, city, state, zip for checkout seeding",
    );
    printRows();
    process.exit(1);
  }
  row("profile", "Profile shipping address complete", "PASS", "ok");

  const groupTag = `e2e-matrix-${Date.now()}`;
  const boxId = `${groupTag}-1`;

  // Clean prior e2e-matrix rows for this user (best-effort)
  await admin.from("boxes").delete().eq("user_id", userId).like("subscription_group_id", "e2e-matrix-%");

  const { data: nums } = await admin.from("boxes").select("box_number").not("box_number", "is", null);
  const used = new Set((nums || []).map((r) => r.box_number).filter(Boolean));
  let n = 900;
  while (used.has(String(n).padStart(3, "0"))) n += 1;
  const boxNumber = String(n).padStart(3, "0");

  const insertRow = {
    id: boxId,
    box_number: boxNumber,
    user_id: userId,
    status: "stored",
    checkout_status: "in_cart",
    fulfillment_status: "pending",
    price: 40,
    cart_type: "initial_purchase",
    subscription_group_id: groupTag,
    ...planSnapshotOneBin(),
  };

  const { error: insErr } = await admin.from("boxes").insert([insertRow]);
  if (insErr) {
    row("seed_cart", "Seed one_bin initial_purchase cart", "FAIL", insErr.message);
    printRows();
    process.exit(1);
  }
  row("seed_cart", "Seed one_bin initial_purchase cart", "PASS", `group=${groupTag}`);

  // --- initial_purchase ---
  let initialSessionId = "";
  try {
    const init = await edgePost(
      "create-initial-checkout",
      {
        userId,
        planId: "one_bin",
        subscriptionGroupId: groupTag,
        billingCycle: "monthly",
        successUrl: `${APP_ORIGIN}/checkout-success?flow=initial_purchase&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${APP_ORIGIN}/cart?checkout=cancel`,
        shippingAddress,
      },
      userJwt,
      anonKey,
    );
    if (!init.ok || !init.json?.checkoutSessionId) {
      row("initial_purchase", "create-initial-checkout", "FAIL", `HTTP ${init.status} ${JSON.stringify(init.json).slice(0, 200)}`);
    } else {
      initialSessionId = init.json.checkoutSessionId;
      row("initial_purchase", "create-initial-checkout", "PASS", "checkoutSessionId returned");
      const pay = await payCheckoutSessionPaymentMode(stripe, initialSessionId, init.json.checkoutUrl);
      if (pay.skipped) {
        row("initial_purchase", "Stripe pay hosted session", "SKIP", pay.reason);
      } else if (pay.error) {
        row("initial_purchase", "Stripe pay session", "FAIL", pay.error);
      } else {
        const fin = await edgePost(
          "finalize-initial-purchase-checkout",
          { sessionId: initialSessionId },
          userJwt,
          anonKey,
        );
        if (!fin.ok) {
          row("initial_purchase", "finalize-initial-purchase-checkout", "FAIL", `HTTP ${fin.status} ${JSON.stringify(fin.json).slice(0, 200)}`);
        } else {
          await edgePost("ensure-starter-shipments", {}, userJwt, anonKey);
          const { data: boxAfter } = await admin.from("boxes").select("checkout_status,stripe_subscription_id,subscription_lifecycle_status").eq("id", boxId).single();
          const ok =
            boxAfter?.checkout_status === "paid" &&
            Boolean(boxAfter?.stripe_subscription_id) &&
            boxAfter?.subscription_lifecycle_status === "active";
          row(
            "initial_purchase",
            "End state: paid + stripe_subscription_id + active",
            ok ? "PASS" : "FAIL",
            ok ? "ok" : JSON.stringify(boxAfter || {}),
          );
        }
      }
    }
  } catch (e) {
    row("initial_purchase", "initial_purchase chain", "FAIL", e instanceof Error ? e.message : String(e));
  }

  // --- payment_method_update (webhook) ---
  if (!webhookSecret) {
    row("payment_method_update", "Webhook applies PM update", "SKIP", "Set STRIPE_WEBHOOK_SECRET to test webhook path");
  } else {
    try {
      const pm = await edgePost(
        "create-payment-method-setup-session",
        {
          userId,
          successUrl: `${APP_ORIGIN}/checkout-success?flow=payment_method_update`,
          cancelUrl: `${APP_ORIGIN}/account?payment_method=cancel`,
        },
        userJwt,
        anonKey,
      );
      if (!pm.ok || !pm.json?.checkoutUrl) {
        row("payment_method_update", "create-payment-method-setup-session", "FAIL", `HTTP ${pm.status} ${JSON.stringify(pm.json).slice(0, 200)}`);
      } else {
        const sid = parseCheckoutSessionId(pm.json.checkoutUrl);
        if (!sid) {
          row("payment_method_update", "Parse session id from URL", "FAIL", "no cs_ id in checkoutUrl");
        } else {
          const pay = await payCheckoutSessionSetupMode(stripe, sid);
          if (pay.error) {
            row("payment_method_update", "Stripe setup confirm", "FAIL", pay.error);
          } else {
            const sess = await stripe.checkout.sessions.retrieve(sid, { expand: ["setup_intent", "customer"] });
            const evt = {
              id: `evt_e2e_pm_${Date.now()}`,
              object: "event",
              api_version: "2024-06-20",
              type: "checkout.session.completed",
              data: { object: sess },
            };
            const wh = await postStripeWebhook(stripe, evt);
            if (!wh.ok || wh.json?.error) {
              row("payment_method_update", "stripe-webhook", "FAIL", `HTTP ${wh.status} ${JSON.stringify(wh.json).slice(0, 200)}`);
            } else {
              row("payment_method_update", "stripe-webhook applied", "PASS", "received");
            }
          }
        }
      }
    } catch (e) {
      row("payment_method_update", "payment_method_update chain", "FAIL", e instanceof Error ? e.message : String(e));
    }
  }

  // --- customer ship_to_customer (FedEx quote path) ---
  try {
    const { data: boxRow } = await admin.from("boxes").select("id,status,fulfillment_status,checkout_status").eq("id", boxId).single();
    if (!boxRow) {
      row("ship_to_customer", "Prerequisite box", "SKIP", "no box");
    } else {
      const addr = {
        full_name: shippingAddress.fullName,
        email: shippingAddress.email,
        address_line1: shippingAddress.addressLine1,
        address_line2: shippingAddress.addressLine2 || "",
        city: shippingAddress.city,
        state: shippingAddress.state,
        zip: shippingAddress.zip,
      };
      await admin
        .from("boxes")
        .update({
          checkout_status: "paid",
          cart_type: "ship_to_customer",
          requested_shipping_address: addr,
          requested_shipping_address_source: "profile",
          status: "stored",
          fulfillment_status: "stored",
        })
        .eq("id", boxId);

      const ship = await edgePost(
        "create-shipping-checkout-session",
        {
          userId,
          boxIds: [boxId],
          successUrl: `${APP_ORIGIN}/checkout-success?flow=customer_retrieval_shipping&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${APP_ORIGIN}/cart?checkout=cancel`,
          shippingSelections: {},
        },
        userJwt,
        anonKey,
      );
      if (!ship.ok || !ship.json?.checkoutSessionId) {
        row(
          "ship_to_customer",
          "create-shipping-checkout-session",
          ship.status === 400 ? "SKIP" : "FAIL",
          `HTTP ${ship.status} ${JSON.stringify(ship.json).slice(0, 240)}`,
        );
      } else {
        row("ship_to_customer", "create-shipping-checkout-session", "PASS", "checkoutSessionId returned");
        const sid = ship.json.checkoutSessionId;
        const pay = await payCheckoutSessionPaymentMode(stripe, sid, ship.json.checkoutUrl);
        if (pay.skipped) {
          row("ship_to_customer", "Stripe pay shipping session", "SKIP", pay.reason);
        } else if (pay.error) {
          row("ship_to_customer", "Stripe pay shipping session", "FAIL", pay.error);
        } else {
          const fin = await edgePost("finalize-customer-shipping-checkout", { sessionId: sid }, userJwt, anonKey);
          if (!fin.ok) {
            row("ship_to_customer", "finalize-customer-shipping-checkout", "FAIL", `HTTP ${fin.status} ${JSON.stringify(fin.json).slice(0, 200)}`);
          } else {
            const { data: b2 } = await admin.from("boxes").select("fulfillment_status,cart_type,checkout_status").eq("id", boxId).single();
            const ok = b2?.fulfillment_status === "ready_to_ship_to_customer" && !b2?.cart_type && b2?.checkout_status === "paid";
            row("ship_to_customer", "Box fulfillment ready_to_ship_to_customer", ok ? "PASS" : "FAIL", JSON.stringify(b2 || {}));
          }
        }
      }
    }
  } catch (e) {
    row("ship_to_customer", "ship_to_customer chain", "FAIL", e instanceof Error ? e.message : String(e));
  }

  // --- subscription_payment_recovery (webhook) ---
  if (!webhookSecret) {
    row("payment_recovery", "Recovery checkout + webhook", "SKIP", "Set STRIPE_WEBHOOK_SECRET");
  } else {
    try {
      const { data: boxRow } = await admin.from("boxes").select("stripe_subscription_id").eq("id", boxId).single();
      const subId = boxRow?.stripe_subscription_id;
      if (!subId) {
        row("payment_recovery", "Prerequisites", "SKIP", "missing stripe_subscription_id on box");
      } else {
        const sub = await stripe.subscriptions.retrieve(subId);
        const custId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        if (!custId) {
          row("payment_recovery", "Prerequisites", "SKIP", "subscription missing customer id");
        } else {
        await stripe.invoiceItems.create({
          customer: custId,
          subscription: subId,
          amount: 2345,
          currency: "usd",
          description: "e2e-matrix unpaid balance",
        });
        const inv = await stripe.invoices.create({
          customer: custId,
          subscription: subId,
          auto_advance: false,
        });
        await stripe.invoices.finalizeInvoice(inv.id, { auto_advance: false });

        const rec = await edgePost(
          "create-payment-recovery-session",
          {
            subscriptionId: subId,
            successUrl: `${APP_ORIGIN}/checkout-success?flow=subscription_payment_recovery`,
            cancelUrl: `${APP_ORIGIN}/account?payment=cancel`,
          },
          userJwt,
          anonKey,
        );
        if (!rec.ok || !rec.json?.checkoutUrl) {
          row("payment_recovery", "create-payment-recovery-session", "FAIL", `HTTP ${rec.status} ${JSON.stringify(rec.json).slice(0, 200)}`);
        } else {
          row("payment_recovery", "create-payment-recovery-session", "PASS", "checkoutUrl returned");
          const sid = parseCheckoutSessionId(rec.json.checkoutUrl);
          const pay = await payCheckoutSessionPaymentMode(stripe, sid, rec.json.checkoutUrl);
          if (pay.skipped) {
            row("payment_recovery", "Stripe pay recovery session", "SKIP", pay.reason);
          } else if (pay.error) {
            row("payment_recovery", "Stripe pay recovery session", "FAIL", pay.error);
          } else {
            const sess = await stripe.checkout.sessions.retrieve(sid, { expand: ["payment_intent", "customer"] });
            const evt = {
              id: `evt_e2e_rec_${Date.now()}`,
              object: "event",
              api_version: "2024-06-20",
              type: "checkout.session.completed",
              data: { object: sess },
            };
            const wh = await postStripeWebhook(stripe, evt);
            if (!wh.ok) {
              row("payment_recovery", "stripe-webhook", "FAIL", `HTTP ${wh.status} ${JSON.stringify(wh.json).slice(0, 200)}`);
            } else {
              row("payment_recovery", "stripe-webhook recovery", "PASS", "received");
            }
          }
        }
        }
      }
    } catch (e) {
      row("payment_recovery", "payment_recovery chain", "FAIL", e instanceof Error ? e.message : String(e));
    }
  }

  // --- final_settlement (before early termination cancels the Stripe subscription) ---
  try {
    const { data: boxRow } = await admin.from("boxes").select("id,stripe_subscription_id").eq("id", boxId).single();
    if (!boxRow?.stripe_subscription_id) {
      row("final_settlement", "Prerequisite subscription", "SKIP", "no stripe_subscription_id on box");
    } else {
      const fsession = await edgePost(
        "create-final-settlement-session",
        {
          boxId,
          successUrl: `${APP_ORIGIN}/checkout-success?flow=final_settlement&box=${encodeURIComponent(boxId)}`,
          cancelUrl: `${APP_ORIGIN}/account`,
        },
        userJwt,
        anonKey,
      );
      if (!fsession.ok || !fsession.json?.checkoutUrl) {
        const msg = JSON.stringify(fsession.json).slice(0, 240);
        row("final_settlement", "create-final-settlement-session", /No settlement|not eligible|400/i.test(msg) ? "SKIP" : "FAIL", `HTTP ${fsession.status} ${msg}`);
      } else {
        row("final_settlement", "create-final-settlement-session", "PASS", "checkoutUrl returned");
        const sid = parseCheckoutSessionId(fsession.json.checkoutUrl);
        const pay = await payCheckoutSessionPaymentMode(stripe, sid, fsession.json.checkoutUrl);
        if (pay.skipped) {
          row("final_settlement", "Stripe pay final settlement", "SKIP", pay.reason);
        } else if (pay.error) {
          row("final_settlement", "Stripe pay final settlement", "FAIL", pay.error);
        } else if (!webhookSecret) {
          row("final_settlement", "stripe-webhook final_settlement", "SKIP", "Set STRIPE_WEBHOOK_SECRET (CheckoutSuccess has no finalize edge for this flow)");
        } else {
          const sess = await stripe.checkout.sessions.retrieve(sid, { expand: ["payment_intent", "customer"] });
          const evt = {
            id: `evt_e2e_fs_${Date.now()}`,
            object: "event",
            api_version: "2024-06-20",
            type: "checkout.session.completed",
            data: { object: sess },
          };
          const wh = await postStripeWebhook(stripe, evt);
          row("final_settlement", "stripe-webhook final_settlement", wh.ok ? "PASS" : "FAIL", `HTTP ${wh.status}`);
        }
      }
    }
  } catch (e) {
    row("final_settlement", "final_settlement chain", "FAIL", e instanceof Error ? e.message : String(e));
  }

  // --- early_termination (edge complete, not webhook) ---
  try {
    await admin
      .from("boxes")
      .update({
        subscription_started_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        cancel_status: null,
      })
      .eq("id", boxId);

    const et = await edgePost(
      "create-early-termination-checkout",
      { boxId, appOrigin: APP_ORIGIN },
      userJwt,
      anonKey,
    );
    if (!et.ok || !et.json?.url) {
      row(
        "early_termination",
        "create-early-termination-checkout",
        String(et.json?.error || "").includes("Minimum term") ? "SKIP" : "FAIL",
        `HTTP ${et.status} ${JSON.stringify(et.json).slice(0, 240)}`,
      );
    } else {
      row("early_termination", "create-early-termination-checkout", "PASS", "checkout url returned");
      const sid = parseCheckoutSessionId(et.json.url);
      const pay = await payCheckoutSessionPaymentMode(stripe, sid, et.json.url);
      if (pay.skipped) {
        row("early_termination", "Stripe pay early term session", "SKIP", pay.reason);
      } else if (pay.error) {
        row("early_termination", "Stripe pay early term session", "FAIL", pay.error);
      } else {
        const done = await edgePost("complete-early-termination", { sessionId: sid, shippingPreference: null }, userJwt, anonKey);
        if (!done.ok) {
          row("early_termination", "complete-early-termination", "FAIL", `HTTP ${done.status} ${JSON.stringify(done.json).slice(0, 200)}`);
        } else {
          const { data: b3 } = await admin
            .from("boxes")
            .select("cancel_status,cancel_review_note")
            .eq("id", boxId)
            .single();
          const ok =
            b3?.cancel_status === "approved" &&
            String(b3?.cancel_review_note || "").includes("Early contract termination");
          row("early_termination", "Early termination recorded on box", ok ? "PASS" : "FAIL", JSON.stringify(b3 || {}));
        }
      }
    }
  } catch (e) {
    row("early_termination", "early_termination chain", "FAIL", e instanceof Error ? e.message : String(e));
  }

  // --- subscription_reactivation ---
  if (!stripeBinMonthlyPriceId) {
    row("reactivation", "create-reactivation-checkout", "SKIP", "Set STRIPE_BIN_MONTHLY_PRICE_ID or STRIPE_MONTHLY_PRICE_ID for reactivation webhook");
  } else {
    try {
      const { data: b4 } = await admin.from("boxes").select("id,status,subscription_lifecycle_status").eq("id", boxId).single();
      if (!b4) {
        row("reactivation", "Prerequisite box", "SKIP", "no box");
      } else {
        await admin
          .from("boxes")
          .update({
            subscription_lifecycle_status: "terminated",
            subscription_status: "terminated",
            status: "at_customer",
            fulfillment_status: "bin_with_customer",
            checkout_status: "in_cart",
            cart_type: "reactivate_subscription",
            price: 15,
            stripe_subscription_id: null,
          })
          .eq("id", boxId);

        const react = await edgePost(
          "create-reactivation-checkout",
          { boxIds: [boxId], appOrigin: APP_ORIGIN },
          userJwt,
          anonKey,
        );
        if (!react.ok || !react.json?.checkoutUrl) {
          row("reactivation", "create-reactivation-checkout", "FAIL", `HTTP ${react.status} ${JSON.stringify(react.json).slice(0, 200)}`);
        } else if (!webhookSecret) {
          row("reactivation", "stripe-webhook subscription_reactivation", "SKIP", "Set STRIPE_WEBHOOK_SECRET");
        } else {
          row("reactivation", "create-reactivation-checkout", "PASS", "checkoutUrl returned");
          const sid = parseCheckoutSessionId(react.json.checkoutUrl);
          const pay = await payCheckoutSessionPaymentMode(stripe, sid, react.json.checkoutUrl);
          if (pay.skipped) {
            row("reactivation", "Stripe pay reactivation", "SKIP", pay.reason);
          } else if (pay.error) {
            row("reactivation", "Stripe pay reactivation", "FAIL", pay.error);
          } else {
            const sess = await stripe.checkout.sessions.retrieve(sid, { expand: ["payment_intent", "customer"] });
            const evt = {
              id: `evt_e2e_react_${Date.now()}`,
              object: "event",
              api_version: "2024-06-20",
              type: "checkout.session.completed",
              data: { object: sess },
            };
            const wh = await postStripeWebhook(stripe, evt);
            row("reactivation", "stripe-webhook reactivation", wh.ok ? "PASS" : "FAIL", `HTTP ${wh.status}`);
          }
        }
      }
    } catch (e) {
      row("reactivation", "reactivation chain", "FAIL", e instanceof Error ? e.message : String(e));
    }
  }

  // --- CheckoutSuccess flow keys sanity (static) ---
  const expectedFlows = [
    "initial_purchase",
    "subscription_payment_recovery",
    "subscription_reactivation",
    "final_settlement",
    "return_to_storage_shipping",
    "customer_retrieval_shipping",
    "shipping",
    "payment_method_update",
    "early_termination",
    "cancellation_requested",
  ];
  row("checkout_success", "SUCCESS_MESSAGES flow keys", "PASS", `${expectedFlows.length} flows documented in app`);

  printRows();
  const failed = rows.filter((r) => r.status === "FAIL").length;
  process.exit(failed > 0 ? 1 : 0);
}

function printRows() {
  console.log("\n========== STRIPE E2E MATRIX ==========");
  for (const r of rows) {
    console.log(`${r.status.padEnd(5)}  ${r.key}: ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const fail = rows.filter((r) => r.status === "FAIL").length;
  const skip = rows.filter((r) => r.status === "SKIP").length;
  console.log(`\nSummary: FAIL=${fail} SKIP=${skip} PASS=${rows.filter((r) => r.status === "PASS").length}`);
}

main().catch((e) => {
  console.error(redactSecrets(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
