import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  buildCustomerEmailContent,
  parseCustomerEmailType,
  readBoxLabelForEmail,
  readProfileForEmail,
  resolveBookingOrderSummary,
  type CustomerEmailBuildInput,
  type CustomerEmailType,
} from "../_shared/customerEmails.ts";
import { sendResendEmail } from "../_shared/shippingLabelNotifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const adminEmails = () =>
  (Deno.env.get("ADMIN_EMAILS") || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

const secretPresence = (name: string) =>
  String(Deno.env.get(name) || "").trim() ? "Present" : "Missing";

/** Minimal valid single-page PDF for optional attachment tests (not a real FedEx label). */
const DUMMY_LABEL_PDF_BASE64 =
  "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDYxMiA3OTJdL1BhcmVudCAyIDAgUi9Db250ZW50cyA0IDAgUj4+CmVuZG9iago0IDAgb2JqCjw8L0xlbmd0aCA0ND4+c3RyZWFtCjAgMCA2MTIgNzkyCmJlZ2luCmVuZCBlbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMTkgMDAwMDAgbiAKMDAwMDAwMDIyNCAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNS9Sb290IDEgMCBSL0luZm8gNSAwIFI+PgpzdGFydHhyZWYKMjk4CiUlRU9G";

const requireAdminSupabase = async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return { error: jsonResponse({ error: "Missing Supabase configuration" }, 500) };
  }

  const token = String(req.headers.get("authorization") || req.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return { error: jsonResponse({ error: "Missing auth token" }, 401) };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: authUser, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authUser?.user) {
    return { error: jsonResponse({ error: "Invalid auth token" }, 401) };
  }

  const email = String(authUser.user.email || "").trim().toLowerCase();
  if (!adminEmails().includes(email)) {
    return { error: jsonResponse({ error: "Admin access required" }, 403) };
  }

  return { supabase, adminEmail: email, adminUserId: String(authUser.user.id || "") };
};

const mergeFixtures = (
  fixtures: Record<string, unknown> | undefined,
): CustomerEmailBuildInput => {
  const f = fixtures && typeof fixtures === "object" ? fixtures : {};
  const input: CustomerEmailBuildInput = {};

  const assignString = (key: keyof CustomerEmailBuildInput) => {
    const value = f[key as string];
    if (value != null && String(value).trim()) {
      (input as Record<string, unknown>)[key] = String(value).trim();
    }
  };

  assignString("firstName");
  assignString("customerName");
  assignString("trackingNumber");
  assignString("trackingUrl");
  assignString("binLabel");
  assignString("binName");
  assignString("auctionEligibilityDate");

  if (Array.isArray(f.binLabels)) {
    input.binLabels = f.binLabels.map((v) => String(v)).filter(Boolean);
  }
  if (Number.isFinite(Number(f.binCount))) input.binCount = Number(f.binCount);
  if (Number.isFinite(Number(f.amountChargedCents))) {
    input.amountChargedCents = Number(f.amountChargedCents);
  }
  if (Number.isFinite(Number(f.daysPastDue))) input.daysPastDue = Number(f.daysPastDue);
  if (Number.isFinite(Number(f.outstandingBalanceCents))) {
    input.outstandingBalanceCents = Number(f.outstandingBalanceCents);
  }

  return input;
};

const resolveBuildInput = async (
  supabase: ReturnType<typeof createClient>,
  emailType: CustomerEmailType,
  body: Record<string, unknown>,
): Promise<CustomerEmailBuildInput> => {
  const input = mergeFixtures(body.fixtures as Record<string, unknown> | undefined);
  const userId = String(body.userId || "").trim() || null;
  const boxId = String(body.boxId || "").trim() || null;

  if (userId && !input.customerName && !input.firstName) {
    const profile = await readProfileForEmail(supabase, userId);
    if (profile?.full_name) input.customerName = profile.full_name;
  }

  const needsBoxLabel = ["bin_requested", "bins_shipped_to_storage", "bins_received_at_hq"].includes(
    emailType,
  );
  if (boxId && needsBoxLabel && !input.binLabel) {
    const { binLabel, binName } = await readBoxLabelForEmail(supabase, boxId, userId);
    input.binLabel = binLabel;
    input.binName = binName;
  }

  if (emailType === "bins_shipped_to_storage" && body.includeLabelPdf === true) {
    input.labelPdfBase64 = DUMMY_LABEL_PDF_BASE64;
  }

  if (emailType === "booking_confirmation") {
    if (!input.binCount) input.binCount = 2;
    if (boxId) input.boxId = boxId;
    if (userId) input.userId = userId;
    const checkoutSessionId = String(body.checkoutSessionId || "").trim();
    if (checkoutSessionId) input.checkoutSessionId = checkoutSessionId;
  }

  return input;
};

const testSubject = (subject: string) => `[TEST] ${subject}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const gate = await requireAdminSupabase(req);
  if ("error" in gate) return gate.error;
  const { supabase, adminEmail, adminUserId } = gate;

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "send").trim().toLowerCase();

    if (action === "secretscheck") {
      return jsonResponse({
        ok: true,
        action: "secretsCheck",
        RESEND_API_KEY: secretPresence("RESEND_API_KEY"),
        RESEND_FROM_EMAIL: secretPresence("RESEND_FROM_EMAIL"),
        APP_URL: secretPresence("APP_URL"),
      });
    }

    const emailType = parseCustomerEmailType(body.emailType);
    if (!emailType) {
      return jsonResponse(
        {
          error:
            "emailType is required (1–7 or booking_confirmation, bins_shipped_to_customer, bins_received_by_customer, bin_requested, bins_shipped_to_storage, bins_received_at_hq, auction_payment_warning)",
        },
        400,
      );
    }

    const buildInput = await resolveBuildInput(supabase, emailType, body);
    let bookingSummary = null;
    if (emailType === "booking_confirmation") {
      bookingSummary = await resolveBookingOrderSummary(supabase, {
        userId: String(buildInput.userId || body.userId || adminUserId || "").trim(),
        checkoutSessionId: buildInput.checkoutSessionId || String(body.checkoutSessionId || "").trim() || null,
        binCount: Math.max(1, Number(buildInput.binCount || 2)),
        amountChargedCents: Number(buildInput.amountChargedCents || 0),
      });
    }
    const content = buildCustomerEmailContent(emailType, buildInput, bookingSummary);
    const subject = testSubject(content.subject);

    if (action === "preview") {
      return jsonResponse({
        ok: true,
        action: "preview",
        emailType,
        subject,
        html: content.html,
        hasPdfAttachment: Boolean(content.pdfBase64),
        pdfFilename: content.pdfFilename || null,
        bookingSummary,
        requestedBy: adminEmail,
      });
    }

    if (action !== "send") {
      return jsonResponse({ error: "action must be secretsCheck, preview, or send" }, 400);
    }

    const to = String(body.to || "").trim();
    if (!to.includes("@")) {
      return jsonResponse({ error: "to is required for send (valid email address)" }, 400);
    }

    const result = await sendResendEmail({
      to,
      subject,
      html: content.html,
      pdfBase64: content.pdfBase64 || undefined,
      pdfFilename: content.pdfFilename,
    });

    return jsonResponse({
      ok: result.ok,
      action: "send",
      emailType,
      to,
      subject,
      resendOk: result.ok,
      skipped: result.skipped || null,
      error: result.error || null,
      hasPdfAttachment: Boolean(content.pdfBase64),
      requestedBy: adminEmail,
    });
  } catch (error) {
    console.error("test-customer-email", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});
