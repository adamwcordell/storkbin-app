/**
 * StorkBin beta smoke: structured PASS/FAIL, minimal manual steps.
 *
 *   npm run beta:smoke:setup   # create .env.smoke from prompts
 *   npm run beta:smoke         # run checks
 *   npm run beta:smoke:stripe  # also verify Stripe CLI on PATH
 *
 * Flags: --stripe  |  --skip-migrations  |  --skip-stripe-api  |  --debug-auth
 *
 * Env: SMOKE_DEBUG_AUTH=1  |  SMOKE_ENV_FILE=.env.smoke (default) or .env.test-matrix, etc.
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const args = new Set(process.argv.slice(2));
const wantStripeCli = args.has("--stripe");
const skipMigrations = args.has("--skip-migrations");
const skipStripeApi = args.has("--skip-stripe-api");
const wantDebugAuth = args.has("--debug-auth") || process.env.SMOKE_DEBUG_AUTH === "1";

const envRel = (process.env.SMOKE_ENV_FILE || "").trim() || ".env.smoke";
const envPath = path.isAbsolute(envRel) ? envRel : path.join(root, envRel);

/** @type {{ key: string, label: string, status: 'PASS'|'FAIL'|'SKIP', detail?: string }[]} */
const report = [];

function row(key, label, status, detail) {
  report.push({ key, label, status, detail: detail || "" });
}

function runCmd(cmd, cwd) {
  try {
    const stdout = execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr: "" };
  } catch (e) {
    return {
      ok: false,
      stdout: String(e.stdout || ""),
      stderr: String(e.stderr || e.message || ""),
      code: e.status,
    };
  }
}

function loadLocalMigrationVersions() {
  const dir = path.join(root, "supabase", "migrations");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/_.*$/, "").replace(/\.sql$/, ""))
    .filter((v) => /^\d{14}$/.test(v))
    .sort();
}

/**
 * Rows where LOCAL is a migration version and REMOTE is empty => not applied on remote.
 * @param {string} text
 * @param {string[]} localVersions from filenames
 */
function pendingLocalMigrations(cliStdout, localVersions) {
  const pending = new Set();
  for (const line of cliStdout.split("\n")) {
    if (!line.includes("│") && !line.includes("|")) continue;
    if (/LOCAL/i.test(line) && /REMOTE/i.test(line)) continue;
    const parts = line.split(/[│|]/).map((s) => s.trim());
    if (parts.length < 2) continue;
    const loc = parts[0].replace(/\s/g, "");
    const rem = parts[1].replace(/\s/g, "");
    if (/^\d{14}$/.test(loc) && !rem) pending.add(loc);
  }
  return localVersions.filter((v) => pending.has(v));
}

if (!fs.existsSync(envPath)) {
  console.error(`Missing env file (${envRel}). Run:  npm run beta:smoke:setup   (or set SMOKE_ENV_FILE=...)`);
  process.exit(1);
}

/** Non-empty `ADMIN_SMOKE_JWT=...` assignment line numbers (comments ignored). */
const scanAdminSmokeJwtAssignmentLines = (absPath) => {
  const all = [];
  const nonempty = [];
  if (!fs.existsSync(absPath)) return { all, nonempty };
  const lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || m[1] !== "ADMIN_SMOKE_JWT") continue;
    const lineNo = i + 1;
    all.push(lineNo);
    const val = String(m[2] || "")
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
    if (val.length > 0) nonempty.push(lineNo);
  }
  return { all, nonempty };
};

const adminJwtLineScan = scanAdminSmokeJwtAssignmentLines(envPath);

/** File wins over inherited shell vars (critical when clearing ADMIN_SMOKE_JWT in file). */
dotenv.config({ path: envPath, override: true });

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || "wslymzcbbevnoybbsbgq";
const supabaseUrl = process.env.SUPABASE_URL?.trim() || `https://${projectRef}.supabase.co`;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
const stripePriceId = process.env.STRIPE_BIN_MONTHLY_PRICE_ID?.trim();
const stripeForwardingOnly = process.env.STRIPE_FORWARDING_ONLY === "1";

let exitCode = 0;

/** Reject mistaken `.env.smoke` values (e.g. email pasted into SUPABASE_ANON_KEY). */
const isPlausibleSupabasePublishableKey = (value) => {
  const s = String(value || "").trim();
  if (!s) return false;
  if (s.startsWith("eyJ")) return true;
  if (s.startsWith("sb_publishable_")) return true;
  return false;
};

/**
 * @param {string} functionName
 * @param {Record<string, unknown>} body
 * @param {string} authBearer - user JWT or service role key (Authorization)
 * @param {{ apikey?: string }} [opts] - For user JWTs, pass `apikey: SUPABASE_ANON_KEY` (gateway expects publishable key, not the session token).
 */
async function edgePost(functionName, body, authBearer, opts = {}) {
  const apikey = opts.apikey ?? authBearer;
  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authBearer}`,
      "Content-Type": "application/json",
      apikey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text };
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** Deployed if not 404 NOT_FOUND */
async function edgeDeployedProbe(name, bearer, body) {
  const r = await edgePost(name, body, bearer);
  const raw = r.text || JSON.stringify(r.json);
  if (r.status === 404 && /NOT_FOUND|not found/i.test(raw)) {
    return { deployed: false, ...r };
  }
  return { deployed: true, ...r };
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

/**
 * @param {boolean} debug
 * @returns {Promise<{ ok: true, jwt: string, trace?: Record<string, unknown> } | { ok: false, error: string, trace?: Record<string, unknown> }>}
 */
async function getAdminJwtResult(debug) {
  const relEnvFile = path.relative(root, envPath).replace(/\\/g, "/") || path.basename(envPath);

  /** @type {Record<string, unknown> | undefined} */
  let trace = debug
    ? {
        smoke_env_file_relative: relEnvFile,
        smoke_env_file_is_default_dot_env_smoke: relEnvFile === ".env.smoke" || path.basename(envPath) === ".env.smoke",
        dotenv_loaded_with_override_true: true,
        admin_smoke_jwt_assignment_lines_in_file: adminJwtLineScan.all,
        admin_smoke_jwt_nonempty_assignment_lines_in_file: adminJwtLineScan.nonempty,
        duplicate_admin_smoke_jwt_assignments_in_file: adminJwtLineScan.all.length > 1,
        admin_smoke_jwt_env_blank_after_load: !process.env.ADMIN_SMOKE_JWT?.trim(),
        admin_smoke_email_present: Boolean(process.env.ADMIN_SMOKE_EMAIL?.trim()),
        admin_smoke_password_present: Boolean(process.env.ADMIN_SMOKE_PASSWORD?.trim()),
        test_user_email_present: Boolean(process.env.TEST_USER_EMAIL?.trim()),
        script_uses_ADMIN_SMOKE_EMAIL_only_not_TEST_USER_EMAIL: true,
        supabase_anon_key_starts_with_eyJ: Boolean(anonKey?.startsWith("eyJ")),
        supabase_anon_key_starts_with_sb_publishable_: Boolean(anonKey?.startsWith("sb_publishable_")),
      }
    : undefined;

  if (trace && trace.test_user_email_present && !trace.admin_smoke_email_present) {
    trace.warning_test_user_email_without_admin_smoke_email =
      "TEST_USER_EMAIL is set but ADMIN_SMOKE_EMAIL is blank — password login uses ADMIN_SMOKE_EMAIL only";
  }

  const email = process.env.ADMIN_SMOKE_EMAIL?.trim();
  const password = process.env.ADMIN_SMOKE_PASSWORD?.trim();

  const probeAdminGate = async (jwt) => {
    if (!jwt || !trace) return;
    const apikey = isPlausibleSupabasePublishableKey(anonKey) ? anonKey : "";
    if (!apikey) {
      trace.beta_ops_admin_probe_http = null;
      trace.user_considered_admin_by_edge = "skipped_no_plausible_anon_key";
      return;
    }
    const probe = await edgePost("beta-ops-admin", { action: "health" }, jwt, { apikey });
    trace.beta_ops_admin_probe_http = probe.status;
    if (probe.status === 200) trace.user_considered_admin_by_edge = true;
    else if (probe.status === 403) trace.user_considered_admin_by_edge = false;
    else trace.user_considered_admin_by_edge = "unknown";
    if (probe.json && typeof probe.json === "object" && "error" in probe.json) {
      trace.beta_ops_admin_probe_error_snippet = String((probe.json).error || "").slice(0, 120);
    }
  };

  if (email && password) {
    if (trace) {
      trace.auth_branch = "password_sign_in";
      trace.password_sign_in_attempted = true;
    }
    if (!isPlausibleSupabasePublishableKey(anonKey)) {
      if (trace) {
        trace.password_sign_in_succeeded = false;
        trace.access_token_returned = false;
        trace.user_considered_admin_by_edge = null;
        trace.block_reason = "supabase_anon_key_not_plausible_publishable_shape";
      }
      return {
        ok: false,
        error:
          "SUPABASE_ANON_KEY must be the project's anon / publishable key (starts with eyJ… or sb_publishable_…), not an email",
        trace,
      };
    }
    const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (trace) {
      trace.password_sign_in_succeeded = !error;
      trace.access_token_returned = Boolean(data?.session?.access_token);
      trace.sign_in_error_name = error?.name || null;
      trace.sign_in_error_message_snippet = error?.message ? String(error.message).slice(0, 120) : null;
    }
    if (error || !data.session?.access_token) {
      if (trace) trace.user_considered_admin_by_edge = null;
      return { ok: false, error: error?.message || "no session", trace };
    }
    await probeAdminGate(data.session.access_token);
    return { ok: true, jwt: data.session.access_token, trace };
  }

  const direct = process.env.ADMIN_SMOKE_JWT?.trim();
  if (direct) {
    if (trace) {
      trace.auth_branch = "jwt_direct_from_env";
      trace.password_sign_in_attempted = false;
      trace.password_sign_in_succeeded = false;
      trace.access_token_returned = true;
      trace.jwt_direct_likely_expired = isJwtLikelyExpired(direct);
    }
    if (isJwtLikelyExpired(direct)) {
      if (trace) {
        trace.access_token_returned = true;
        trace.user_considered_admin_by_edge = null;
      }
      return {
        ok: false,
        error:
          "ADMIN_SMOKE_JWT looks expired — paste a fresh access_token, or set ADMIN_SMOKE_EMAIL + ADMIN_SMOKE_PASSWORD (password wins when both are set)",
        trace,
      };
    }
    await probeAdminGate(direct);
    return { ok: true, jwt: direct, trace };
  }

  if (trace) {
    trace.auth_branch = "none";
    trace.password_sign_in_attempted = false;
    trace.password_sign_in_succeeded = false;
    trace.access_token_returned = false;
    trace.user_considered_admin_by_edge = null;
  }
  return { ok: false, error: "missing ADMIN_SMOKE_EMAIL / ADMIN_SMOKE_PASSWORD or ADMIN_SMOKE_JWT", trace };
}

function printBanner() {
  console.log("StorkBin beta smoke");
  const rel = path.relative(root, envPath).replace(/\\/g, "/") || path.basename(envPath);
  console.log(`Env file: ${rel}${rel === ".env.smoke" ? "" : "  (override via SMOKE_ENV_FILE)"}`);
  console.log(`Project ref: ${projectRef}`);
  console.log(`URL: ${supabaseUrl}`);
  console.log("");
}

function printSummaryAndStripeListenHint() {
  console.log("\n========== BETA SMOKE RESULT ==========");
  const order = [
    "supabase_connection",
    "db_schema",
    "db_migrations",
    "edge_deployed",
    "admin_auth",
    "tracking_sweep",
    "beta_safety_rails",
    "overage_admin",
    "invoice_import",
    "beta_ops_health",
    "stripe_webhook_edge",
    "stripe_api",
    "stripe_webhook_urls",
    "stripe_cli",
  ];
  const idx = (k) => {
    const i = order.indexOf(k);
    return i === -1 ? 999 : i;
  };
  const sorted = [...report].sort((a, b) => idx(a.key) - idx(b.key) || a.label.localeCompare(b.label));
  for (const r of sorted) {
    const tag = r.status.padEnd(5);
    const tail = r.detail ? ` — ${r.detail}` : "";
    console.log(`${tag}  ${r.label}${tail}`);
  }

  const overall = exitCode === 0 ? "PASS" : "FAIL";
  console.log(`\nOVERALL: ${overall}`);
  if (exitCode !== 0) {
    console.log("\nFix failures above, then re-run:  npm run beta:smoke");
  }

  console.log(`
--- Optional: live Stripe events to your webhook (true E2E) ---
In a second terminal (leave it running), paste exactly:

  stripe listen --forward-to ${supabaseUrl}/functions/v1/stripe-webhook

When it prints a line like:  Ready! Your webhook signing secret is whsec_xxxxx
Copy ONLY the whsec_... value into Supabase:
  Dashboard → Project Settings → Edge Functions → Secrets
  Name: STRIPE_WEBHOOK_SECRET   Value: (paste whsec_...)

Your deployed stripe-webhook already expects STRIPE_WEBHOOK_SECRET (see function code).
You do not need to paste anything into Stripe Dashboard for this local forwarder path.
`);
}

async function main() {
  printBanner();

  if (!serviceKey) {
    row("supabase_connection", "Supabase connection (service role)", "FAIL", "SUPABASE_SERVICE_ROLE_KEY missing");
    exitCode = 1;
    printSummaryAndStripeListenHint();
    process.exit(exitCode);
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  {
    const { error } = await supabase.from("shipments").select("id").limit(1);
    if (error) {
      row("supabase_connection", "Supabase connection (service role)", "FAIL", error.message);
      exitCode = 1;
    } else {
      row("supabase_connection", "Supabase connection (service role)", "PASS", "REST reachable with service role");
    }
  }

  const schemaChecks = [
    [
      "shipments Stripe + quote columns",
      supabase
        .from("shipments")
        .select(
          "id,stripe_checkout_session_id,stripe_payment_intent_id,label_quoted_amount_cents,label_quoted_currency,label_purchased_at",
        )
        .limit(1),
    ],
    [
      "shipping_overage_events",
      supabase.from("shipping_overage_events").select("id,detection_status,admin_alert_sent_at,dismissed_at").limit(1),
    ],
    ["boxes baseline", supabase.from("boxes").select("id,user_id,fulfillment_status,checkout_status").limit(1)],
    ["admin_ops_bins", supabase.from("admin_ops_bins").select("id,latest_shipment_id").limit(1)],
    ["beta_ops_heartbeat", supabase.from("beta_ops_heartbeat").select("id,last_run_at").limit(1)],
  ];

  const schemaErrors = [];
  for (const [label, q] of schemaChecks) {
    const { error } = await q;
    if (error) schemaErrors.push(`${label}: ${error.message}`);
  }
  if (schemaErrors.length) {
    row("db_schema", "Required tables / columns", "FAIL", schemaErrors.join(" | "));
    exitCode = 1;
  } else {
    row("db_schema", "Required tables / columns", "PASS", `${schemaChecks.length} selects OK`);
  }

  if (skipMigrations) {
    row("db_migrations", "Remote migrations vs local (Supabase CLI)", "SKIP", "--skip-migrations");
  } else {
    const locals = loadLocalMigrationVersions();
    const cli = runCmd("supabase migration list --linked", root);
    if (!cli.ok) {
      row(
        "db_migrations",
        "Remote migrations vs local (Supabase CLI)",
        "SKIP",
        `Could not run "supabase migration list --linked". Install/link CLI, or use --skip-migrations. ${cli.stderr.slice(0, 200)}`,
      );
    } else {
      const pending = pendingLocalMigrations(cli.stdout, locals);
      if (pending.length) {
        row(
          "db_migrations",
          "Remote migrations vs local (Supabase CLI)",
          "FAIL",
          `Not applied on remote: ${pending.join(", ")} — run: supabase db push --linked`,
        );
        exitCode = 1;
      } else {
        row(
          "db_migrations",
          "Remote migrations vs local (Supabase CLI)",
          "PASS",
          locals.length ? `${locals.length} local migration(s) reflected on remote` : "no local migrations dir",
        );
      }
    }
  }

  const requiredFunctions = [
    "sweep-shipment-tracking",
    "beta-safety-rails",
    "beta-ops-admin",
    "shipping-overage-admin",
    "import-fedex-invoice-csv",
    "stripe-webhook",
  ];
  const deployFailures = [];
  for (const fn of requiredFunctions) {
    const body =
      fn === "stripe-webhook"
        ? {}
        : fn === "beta-ops-admin"
          ? { action: "health" }
          : { limit: 1 };
    const probe = await edgeDeployedProbe(fn, serviceKey, body);
    if (!probe.deployed) deployFailures.push(`${fn} (HTTP ${probe.status})`);
  }
  if (deployFailures.length) {
    row("edge_deployed", "Deployed edge functions (HTTP reachability)", "FAIL", deployFailures.join("; "));
    exitCode = 1;
  } else {
    row("edge_deployed", "Deployed edge functions (HTTP reachability)", "PASS", requiredFunctions.join(", "));
  }

  const adminRes = await getAdminJwtResult(wantDebugAuth);
  if (wantDebugAuth && adminRes.trace) {
    console.log("\n=== SMOKE_AUTH_DEBUG (sanitized) ===");
    console.log(JSON.stringify(adminRes.trace, null, 2));
    console.log("=== end SMOKE_AUTH_DEBUG ===\n");
  }

  let adminJwt = null;
  if (!adminRes.ok) {
    row(
      "admin_auth",
      "Admin auth (JWT for protected functions)",
      "FAIL",
      `${adminRes.error}${wantDebugAuth ? "" : " — re-run with: npm run beta:smoke -- --debug-auth"}`,
    );
    exitCode = 1;
  } else {
    adminJwt = adminRes.jwt;
    row("admin_auth", "Admin auth (JWT for protected functions)", "PASS", "Bearer obtained");
  }

  const sweep = await edgePost("sweep-shipment-tracking", { limit: 5 }, serviceKey);
  if (!sweep.ok) {
    row("tracking_sweep", "Tracking sweep callable (sweep-shipment-tracking)", "FAIL", `HTTP ${sweep.status} ${JSON.stringify(sweep.json).slice(0, 240)}`);
    exitCode = 1;
  } else {
    row("tracking_sweep", "Tracking sweep callable (sweep-shipment-tracking)", "PASS", `HTTP ${sweep.status}`);
  }

  const rails = await edgePost("beta-safety-rails", {}, serviceKey);
  if (!rails.ok) {
    row("beta_safety_rails", "Beta safety rails sweep (beta-safety-rails)", "FAIL", `HTTP ${rails.status} ${JSON.stringify(rails.json).slice(0, 240)}`);
    exitCode = 1;
  } else {
    row("beta_safety_rails", "Beta safety rails sweep (beta-safety-rails)", "PASS", `HTTP ${rails.status}`);
  }

  if (!adminJwt) {
    row("beta_ops_health", "Beta ops health (beta-ops-admin)", "SKIP", "no admin JWT");
    row("overage_admin", "Overage admin callable (shipping-overage-admin)", "SKIP", "no admin JWT");
    row("invoice_import", "Invoice import callable (import-fedex-invoice-csv)", "SKIP", "no admin JWT");
  } else {
    const userEdgeApiKey = isPlausibleSupabasePublishableKey(anonKey) ? anonKey : serviceKey;
    const userEdgeOpts = { apikey: userEdgeApiKey };
    const bh = await edgePost("beta-ops-admin", { action: "health" }, adminJwt, userEdgeOpts);
    if (!bh.ok) {
      row("beta_ops_health", "Beta ops health (beta-ops-admin)", "FAIL", `HTTP ${bh.status} ${JSON.stringify(bh.json).slice(0, 240)}`);
      exitCode = 1;
    } else {
      row("beta_ops_health", "Beta ops health (beta-ops-admin)", "PASS", `HTTP ${bh.status}`);
    }
    const list = await edgePost("shipping-overage-admin", { action: "list" }, adminJwt, userEdgeOpts);
    if (!list.ok) {
      row("overage_admin", "Overage admin callable (shipping-overage-admin)", "FAIL", `HTTP ${list.status} ${JSON.stringify(list.json).slice(0, 240)}`);
      exitCode = 1;
    } else {
      row("overage_admin", "Overage admin callable (shipping-overage-admin)", "PASS", `openCount=${list.json?.openCount ?? "?"}`);
    }

    const tinyCsv = ["Tracking ID,Invoice Number,Net Charge Amount", "999999999999999,INV-SMOKE-1,$9.99"].join("\n");
    const imp = await edgePost("import-fedex-invoice-csv", { csvText: tinyCsv }, adminJwt, userEdgeOpts);
    if (!imp.ok) {
      row("invoice_import", "Invoice import callable (import-fedex-invoice-csv)", "FAIL", `HTTP ${imp.status} ${JSON.stringify(imp.json).slice(0, 240)}`);
      exitCode = 1;
    } else {
      const s = imp.json?.stats;
      row("invoice_import", "Invoice import callable (import-fedex-invoice-csv)", "PASS", `parsedRows=${s?.parsedRows ?? "?"}`);
    }
  }

  {
    const wh = await fetch(`${supabaseUrl}/functions/v1/stripe-webhook`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
        "Stripe-Signature": "t=0,v1=deadbeef",
      },
      body: "{}",
    });
    const t = await wh.text();
    let j;
    try {
      j = JSON.parse(t);
    } catch {
      j = {};
    }
    if (wh.status === 404) {
      row("stripe_webhook_edge", "stripe-webhook edge (secrets + handler)", "FAIL", "function not deployed");
      exitCode = 1;
    } else if (wh.status === 500 && /Missing required Edge Function secrets/i.test(t)) {
      row("stripe_webhook_edge", "stripe-webhook edge (secrets + handler)", "FAIL", j.error || "missing edge secrets");
      exitCode = 1;
    } else if (wh.status === 400 && /signature|Invalid Stripe/i.test(t)) {
      row("stripe_webhook_edge", "stripe-webhook edge (secrets + handler)", "PASS", "returns 400 on fake sig (secrets present)");
    } else {
      row("stripe_webhook_edge", "stripe-webhook edge (secrets + handler)", "FAIL", `HTTP ${wh.status} ${t.slice(0, 200)}`);
      exitCode = 1;
    }
  }

  if (skipStripeApi || !stripeSecret) {
    row(
      "stripe_api",
      "Stripe API key (balance check)",
      "SKIP",
      skipStripeApi ? "--skip-stripe-api" : "STRIPE_SECRET_KEY not set in .env.smoke",
    );
    row(
      "stripe_webhook_urls",
      "Stripe Dashboard webhook URLs (match this project)",
      "SKIP",
      skipStripeApi || !stripeSecret ? "needs STRIPE_SECRET_KEY" : "",
    );
  } else {
    try {
      const stripe = new Stripe(stripeSecret);
      await stripe.balance.retrieve();
      let apiDetail = "balance.retrieve OK";
      if (stripePriceId) {
        await stripe.prices.retrieve(stripePriceId);
        apiDetail += `; price ${stripePriceId} OK`;
      }
      row("stripe_api", "Stripe API key (+ optional price id)", "PASS", apiDetail);

      if (stripeForwardingOnly) {
        row(
          "stripe_webhook_urls",
          "Stripe Dashboard webhook URLs (match this project)",
          "SKIP",
          "STRIPE_FORWARDING_ONLY=1 (use stripe listen; see command below)",
        );
      } else {
        const hooks = await stripe.webhookEndpoints.list({ limit: 30 });
        const needle = `${projectRef}.supabase.co/functions/v1/stripe-webhook`;
        const matches = hooks.data.filter((h) => h.url && h.url.includes(needle));
        if (matches.length) {
          row("stripe_webhook_urls", "Stripe Dashboard webhook URLs (match this project)", "PASS", `${matches.length} endpoint(s) include …/stripe-webhook`);
        } else {
          row(
            "stripe_webhook_urls",
            "Stripe Dashboard webhook URLs (match this project)",
            "FAIL",
            `No Dashboard endpoint URL contains your project stripe-webhook — add one in Stripe, or set STRIPE_FORWARDING_ONLY=1 if you only use stripe listen`,
          );
          exitCode = 1;
        }
      }
    } catch (e) {
      row("stripe_api", "Stripe API key (+ optional price id)", "FAIL", String(e.message || e));
      row("stripe_webhook_urls", "Stripe Dashboard webhook URLs (match this project)", "SKIP", "Stripe API failed");
      exitCode = 1;
    }
  }

  if (!wantStripeCli && process.env.STRIPE_CLI !== "1") {
    row("stripe_cli", "Stripe CLI on PATH (--stripe)", "SKIP", "run: npm run beta:smoke:stripe");
  } else {
    try {
      execSync("stripe version", { stdio: "pipe" });
      row("stripe_cli", "Stripe CLI on PATH (--stripe)", "PASS", "stripe version OK");
    } catch {
      row("stripe_cli", "Stripe CLI on PATH (--stripe)", "FAIL", "stripe not found on PATH");
      exitCode = 1;
    }
  }

  printSummaryAndStripeListenHint();
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
