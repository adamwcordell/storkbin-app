import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildDisplayBinRef, resolveCustomerEmailForBin } from "./binDisplayRef.ts";
import { escapeHtml, sendResendEmail } from "./shippingLabelNotifications.ts";
import { STORKBIN_PLANS, getStorkBinPlan, type StorkBinPlan } from "./storkbinPlans.ts";

type Supabase = ReturnType<typeof createClient>;

const SUPPORT_EMAIL = (Deno.env.get("CUSTOMER_SUPPORT_EMAIL") || "Hello@StorkBin.com").trim();

export type CustomerEmailType =
  | "booking_confirmation"
  | "bins_shipped_to_customer"
  | "bins_received_by_customer"
  | "bin_requested"
  | "bins_shipped_to_storage"
  | "bins_received_at_hq"
  | "auction_payment_warning";

const appBaseUrl = () => (Deno.env.get("APP_URL") || "https://storkbin.com").replace(/\/$/, "");

const formatUsd = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

const formatUsdFromCents = (cents: number) => formatUsd(Math.max(0, cents) / 100);

const firstNameFrom = (fullName: string | null | undefined) => {
  const trimmed = String(fullName || "").trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] || "there";
};

const emailShell = (bodyHtml: string) => `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f6f7f4;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#333;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f4;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e6e8e3;padding:28px 24px;">
        <tr><td style="font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
        <tr><td style="padding-top:28px;font-size:13px;line-height:1.5;color:#666;border-top:1px solid #ececec;margin-top:24px;">
          Questions? Reply to this email or write <a href="mailto:${SUPPORT_EMAIL}" style="color:#4a6741;">${escapeHtml(SUPPORT_EMAIL)}</a>.<br/>
          — The StorkBin Team
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const ctaButton = (href: string, label: string) =>
  `<p style="margin:24px 0 8px;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#4a6741;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px;">${escapeHtml(label)}</a></p>`;

const logEmailAttempt = async (
  supabase: Supabase,
  row: {
    userId?: string | null;
    emailType: CustomerEmailType;
    referenceKey: string;
    recipientEmail: string;
    subject: string;
    resendOk: boolean;
    errorMessage?: string | null;
  },
) => {
  const { error } = await supabase.from("customer_email_log").insert([
    {
      user_id: row.userId || null,
      email_type: row.emailType,
      reference_key: row.referenceKey,
      recipient_email: row.recipientEmail,
      subject: row.subject,
      resend_ok: row.resendOk,
      error_message: row.errorMessage || null,
    },
  ]);
  if (error && !/duplicate key|unique constraint/i.test(error.message)) {
    console.warn("customer_email_log insert", error.message);
  }
};

const alreadySent = async (supabase: Supabase, emailType: CustomerEmailType, referenceKey: string) => {
  const { data, error } = await supabase
    .from("customer_email_log")
    .select("id")
    .eq("email_type", emailType)
    .eq("reference_key", referenceKey)
    .eq("resend_ok", true)
    .maybeSingle();
  if (error) {
    console.warn("customer_email_log lookup", error.message);
    return false;
  }
  return Boolean(data?.id);
};

const sendOnce = async (
  supabase: Supabase,
  opts: {
    userId?: string | null;
    emailType: CustomerEmailType;
    referenceKey: string;
    to: string;
    subject: string;
    html: string;
    pdfBase64?: string | null;
    pdfFilename?: string;
  },
) => {
  const to = String(opts.to || "").trim();
  if (!to.includes("@")) {
    return { ok: false, skipped: "missing customer email" };
  }

  if (await alreadySent(supabase, opts.emailType, opts.referenceKey)) {
    return { ok: true, skipped: "already sent" };
  }

  const result = await sendResendEmail({
    to,
    subject: opts.subject,
    html: opts.html,
    pdfBase64: opts.pdfBase64 || undefined,
    pdfFilename: opts.pdfFilename,
  });

  await logEmailAttempt(supabase, {
    userId: opts.userId,
    emailType: opts.emailType,
    referenceKey: opts.referenceKey,
    recipientEmail: to,
    subject: opts.subject,
    resendOk: result.ok,
    errorMessage: result.error || result.skipped || null,
  });

  return result;
};

export type CustomerEmailContent = {
  subject: string;
  html: string;
  pdfBase64?: string | null;
  pdfFilename?: string;
};

export type BookingPlanLine = {
  planId: string;
  planName: string;
  binCount: number;
  setupFeeCents: number;
  monthlyRateCents: number;
  storageChargedCents: number;
  billingCycle: "monthly" | "annual";
};

export type BookingOrderSummary = {
  totalBinCount: number;
  amountChargedCents: number;
  minimumMonths: number;
  billingCycle: "monthly" | "annual";
  planLines: BookingPlanLine[];
  monthlyPerBinCents: number;
  totalMonthlyCents: number;
  computedTotalCents: number;
  amountMatchesComputed: boolean;
};

export type CustomerEmailBuildInput = {
  firstName?: string;
  customerName?: string | null;
  userId?: string | null;
  checkoutSessionId?: string | null;
  binCount?: number;
  amountChargedCents?: number;
  bookingSummary?: BookingOrderSummary | null;
  trackingNumber?: string;
  trackingUrl?: string;
  binLabels?: string[];
  binLabel?: string;
  binName?: string;
  boxId?: string | null;
  daysPastDue?: number;
  outstandingBalanceCents?: number;
  auctionEligibilityDate?: string;
  labelPdfBase64?: string | null;
  labelUrl?: string | null;
};

const EMAIL_TYPE_BY_NUMBER: Record<string, CustomerEmailType> = {
  "1": "booking_confirmation",
  "2": "bins_shipped_to_customer",
  "3": "bins_received_by_customer",
  "4": "bin_requested",
  "5": "bins_shipped_to_storage",
  "6": "bins_received_at_hq",
  "7": "auction_payment_warning",
};

export const parseCustomerEmailType = (raw: unknown): CustomerEmailType | null => {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return null;
  if (EMAIL_TYPE_BY_NUMBER[key]) return EMAIL_TYPE_BY_NUMBER[key];
  const types: CustomerEmailType[] = [
    "booking_confirmation",
    "bins_shipped_to_customer",
    "bins_received_by_customer",
    "bin_requested",
    "bins_shipped_to_storage",
    "bins_received_at_hq",
    "auction_payment_warning",
  ];
  return types.includes(key as CustomerEmailType) ? (key as CustomerEmailType) : null;
};

export const readProfileForEmail = async (supabase: Supabase, userId: string) => {
  const { data } = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .eq("id", userId)
    .maybeSingle();
  return data as { id: string; email?: string | null; full_name?: string | null } | null;
};

export const readBoxLabelForEmail = async (supabase: Supabase, boxId: string, userId?: string | null) => {
  const { data: box } = await supabase
    .from("boxes")
    .select("id,box_number,customer_bin_name,user_id")
    .eq("id", boxId)
    .maybeSingle();
  if (!box) return { binLabel: boxId, binName: "Unnamed bin" };

  let email = "";
  if (userId) {
    const profile = await readProfileForEmail(supabase, userId);
    email = String(profile?.email || "");
  }
  const displayRef = buildDisplayBinRef({
    email,
    boxNumber: box.box_number,
    boxId: box.id,
  });
  const binName = String(box.customer_bin_name || "").trim() || "Unnamed bin";
  return { binLabel: displayRef, binName };
};

const dollarsToCents = (value: unknown) => Math.round(Math.max(0, Number(value) || 0) * 100);

const catalogPlanFor = (planId: string, binCount?: number): StorkBinPlan | null => {
  const byId = getStorkBinPlan(planId);
  if (byId) return byId;
  if (binCount && binCount > 0) {
    return STORKBIN_PLANS.find((plan) => plan.binCount === binCount) || null;
  }
  return null;
};

const inferBillingCycleFromTotals = (
  amountChargedCents: number,
  expectedMonthlyCents: number,
  expectedAnnualCents: number,
): "monthly" | "annual" => {
  if (amountChargedCents === expectedAnnualCents) return "annual";
  if (amountChargedCents === expectedMonthlyCents) return "monthly";
  const annualDelta = Math.abs(amountChargedCents - expectedAnnualCents);
  const monthlyDelta = Math.abs(amountChargedCents - expectedMonthlyCents);
  return annualDelta < monthlyDelta ? "annual" : "monthly";
};

const storageChargeLabel = (billingCycle: "monthly" | "annual") =>
  billingCycle === "annual"
    ? "11 months prepaid storage (12th month free on annual)"
    : "First month storage";

type BoxPlanRow = {
  id: string;
  subscription_plan_id?: string | null;
  subscription_plan_name?: string | null;
  plan_bin_count?: number | null;
  plan_setup_fee?: number | null;
  plan_monthly_rate?: number | null;
  minimum_months?: number | null;
  subscription_group_id?: string | null;
};

const loadBoxesForCheckoutSession = async (
  supabase: Supabase,
  userId: string,
  checkoutSessionId: string,
) => {
  const boxIds = new Set<string>();
  const { data: shipments } = await supabase
    .from("shipments")
    .select("id, box_id, shipment_boxes(box_id)")
    .eq("stripe_checkout_session_id", checkoutSessionId)
    .eq("user_id", userId);

  for (const shipment of shipments || []) {
    if (shipment.box_id) boxIds.add(String(shipment.box_id));
    for (const linked of shipment.shipment_boxes || []) {
      if (linked?.box_id) boxIds.add(String(linked.box_id));
    }
  }

  if (!boxIds.size) return [] as BoxPlanRow[];

  const { data: boxes } = await supabase
    .from("boxes")
    .select(
      "id, subscription_plan_id, subscription_plan_name, plan_bin_count, plan_setup_fee, plan_monthly_rate, minimum_months, subscription_group_id",
    )
    .eq("user_id", userId)
    .in("id", [...boxIds]);

  return (boxes || []) as BoxPlanRow[];
};

const groupBoxesIntoPlanLines = (
  boxes: BoxPlanRow[],
): Array<Omit<BookingPlanLine, "storageChargedCents" | "billingCycle">> => {
  const groups = new Map<string, BoxPlanRow[]>();
  for (const box of boxes) {
    const key = String(box.subscription_group_id || box.subscription_plan_id || box.id);
    const list = groups.get(key) || [];
    list.push(box);
    groups.set(key, list);
  }

  const lines: Array<Omit<BookingPlanLine, "storageChargedCents" | "billingCycle">> = [];
  for (const groupBoxes of groups.values()) {
    const first = groupBoxes[0];
    const planId = String(first.subscription_plan_id || "");
    const binCount = groupBoxes.length || Number(first.plan_bin_count || 1);
    const catalog = catalogPlanFor(planId, binCount);
    lines.push({
      planId: catalog?.id || planId || "unknown",
      planName: String(first.subscription_plan_name || catalog?.name || `${binCount} Bin${binCount === 1 ? "" : "s"}`),
      binCount,
      setupFeeCents: catalog?.setupFeeCents ?? dollarsToCents(first.plan_setup_fee),
      monthlyRateCents: catalog?.monthlyRateCents ?? dollarsToCents(first.plan_monthly_rate),
    });
  }

  return lines;
};

const buildPlanLinesFromCatalog = (binCount: number) => {
  const catalog =
    STORKBIN_PLANS.find((plan) => plan.binCount === binCount) ||
    STORKBIN_PLANS.find((plan) => plan.id === "two_bins")!;
  return [
    {
      planId: catalog.id,
      planName: catalog.name,
      binCount: catalog.binCount,
      setupFeeCents: catalog.setupFeeCents,
      monthlyRateCents: catalog.monthlyRateCents,
    },
  ];
};

export const resolveBookingOrderSummary = async (
  supabase: Supabase,
  opts: {
    userId: string;
    checkoutSessionId?: string | null;
    binCount: number;
    amountChargedCents: number;
  },
): Promise<BookingOrderSummary> => {
  const checkoutSessionId = String(opts.checkoutSessionId || "").trim();
  let planLineBases = checkoutSessionId
    ? groupBoxesIntoPlanLines(await loadBoxesForCheckoutSession(supabase, opts.userId, checkoutSessionId))
    : [];

  if (!planLineBases.length) {
    planLineBases = buildPlanLinesFromCatalog(Math.max(1, opts.binCount || 1));
  }

  const expectedMonthlyCents = planLineBases.reduce(
    (sum, line) => sum + line.setupFeeCents + line.monthlyRateCents,
    0,
  );
  const expectedAnnualCents = planLineBases.reduce(
    (sum, line) => sum + line.setupFeeCents + line.monthlyRateCents * 11,
    0,
  );
  const amountChargedCents = Math.max(0, Number(opts.amountChargedCents || 0));
  const billingCycle = inferBillingCycleFromTotals(
    amountChargedCents || expectedMonthlyCents,
    expectedMonthlyCents,
    expectedAnnualCents,
  );

  const planLines: BookingPlanLine[] = planLineBases.map((line) => ({
    ...line,
    storageChargedCents: billingCycle === "annual" ? line.monthlyRateCents * 11 : line.monthlyRateCents,
    billingCycle,
  }));

  const totalBinCount = planLines.reduce((sum, line) => sum + line.binCount, 0) || Math.max(1, opts.binCount || 1);
  const totalMonthlyCents = planLines.reduce((sum, line) => sum + line.monthlyRateCents, 0);
  const monthlyPerBinCents =
    totalBinCount > 0 ? Math.round(totalMonthlyCents / totalBinCount) : STORKBIN_PLANS[0].monthlyRateCents;
  const minimumMonths = Math.max(
    12,
    ...planLines.map(() => 12),
    ...planLineBases.map(() => 12),
  );
  const computedTotalCents = planLines.reduce(
    (sum, line) => sum + line.setupFeeCents + line.storageChargedCents,
    0,
  );

  return {
    totalBinCount,
    amountChargedCents: amountChargedCents || computedTotalCents,
    minimumMonths,
    billingCycle,
    planLines,
    monthlyPerBinCents,
    totalMonthlyCents,
    computedTotalCents,
    amountMatchesComputed:
      amountChargedCents === computedTotalCents ||
      Math.abs(amountChargedCents - computedTotalCents) <= 1,
  };
};

const renderBookingOrderSummaryHtml = (summary: BookingOrderSummary) => {
  const planSections = summary.planLines.map((line) => {
    const setupLine =
      line.setupFeeCents > 0
        ? `<li>One-time startup fee: <strong>${formatUsdFromCents(line.setupFeeCents)}</strong></li>`
        : `<li>One-time startup fee: <strong>${formatUsd(0)}</strong> (no startup fee on this plan)</li>`;
    const storageLine = `<li>${storageChargeLabel(line.billingCycle)}: <strong>${formatUsdFromCents(line.storageChargedCents)}</strong></li>`;
    const planHeader =
      summary.planLines.length > 1
        ? `<li style="margin-top:8px;">Plan: <strong>${escapeHtml(line.planName)}</strong> (${line.binCount} bin${line.binCount === 1 ? "" : "s"})</li>${setupLine}${storageLine}`
        : `<li>Plan: <strong>${escapeHtml(line.planName)}</strong></li><li>Number of bins: <strong>${line.binCount}</strong></li>${setupLine}${storageLine}`;
    return planHeader;
  });

  const ongoingPerBin = formatUsdFromCents(summary.monthlyPerBinCents);
  const ongoingPlanTotal =
    summary.planLines.length === 1
      ? ` (${formatUsdFromCents(summary.totalMonthlyCents)}/month for your plan)`
      : ` (${formatUsdFromCents(summary.totalMonthlyCents)}/month total across your plans)`;

  const amountNote = summary.amountMatchesComputed
    ? ""
    : `<li style="font-size:14px;color:#666;">Line items above reflect your plan; amount charged matches your checkout total.</li>`;

  return `
    <ul style="padding-left:20px;margin:8px 0 16px;">
      ${planSections.join("")}
      <li style="margin-top:8px;"><strong>Amount charged today: ${formatUsdFromCents(summary.amountChargedCents)}</strong></li>
      ${amountNote}
      <li>Ongoing storage: <strong>${ongoingPerBin} per bin / month</strong>${ongoingPlanTotal}</li>
      <li>Minimum commitment: <strong>${summary.minimumMonths} months</strong></li>
    </ul>`;
};

const buildFallbackBookingSummary = (input: CustomerEmailBuildInput): BookingOrderSummary => {
  const binCount = Math.max(1, Number(input.binCount || 2));
  const planLineBases = buildPlanLinesFromCatalog(binCount);
  const expectedMonthlyCents = planLineBases.reduce(
    (sum, line) => sum + line.setupFeeCents + line.monthlyRateCents,
    0,
  );
  const expectedAnnualCents = planLineBases.reduce(
    (sum, line) => sum + line.setupFeeCents + line.monthlyRateCents * 11,
    0,
  );
  const amountChargedCents = Number(input.amountChargedCents || 0) || expectedMonthlyCents;
  const billingCycle = inferBillingCycleFromTotals(amountChargedCents, expectedMonthlyCents, expectedAnnualCents);
  const planLines: BookingPlanLine[] = planLineBases.map((line) => ({
    ...line,
    storageChargedCents: billingCycle === "annual" ? line.monthlyRateCents * 11 : line.monthlyRateCents,
    billingCycle,
  }));
  const computedTotalCents = planLines.reduce(
    (sum, line) => sum + line.setupFeeCents + line.storageChargedCents,
    0,
  );

  return {
    totalBinCount: binCount,
    amountChargedCents,
    minimumMonths: 12,
    billingCycle,
    planLines,
    monthlyPerBinCents: Math.round(planLineBases[0].monthlyRateCents / Math.max(1, planLineBases[0].binCount)),
    totalMonthlyCents: planLineBases[0].monthlyRateCents,
    computedTotalCents,
    amountMatchesComputed:
      amountChargedCents === computedTotalCents ||
      Math.abs(amountChargedCents - computedTotalCents) <= 1,
  };
};

const renderReturnLabelAccessHtml = (
  trackingNumber: string,
  labelPdfBase64?: string | null,
  labelUrl?: string | null,
) => {
  if (labelPdfBase64) {
    return `<p>Your return label is attached to this email as <strong>storkbin-return-label.pdf</strong>—print it and affix it clearly to your bin.</p>`;
  }

  const url = String(labelUrl || "").trim();
  if (url.startsWith("http") || url.startsWith("data:")) {
    return `${ctaButton(url, "Print return label")}<p style="font-size:14px;color:#666;">Use the button above to open and print your prepaid return label, then affix it clearly to your bin.</p>`;
  }

  return `<p>Need help printing your label? Reply to this email or contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#4a6741;">${escapeHtml(SUPPORT_EMAIL)}</a> and include tracking # <strong>${escapeHtml(trackingNumber)}</strong>.</p>`;
};

export const buildCustomerEmailContent = (
  emailType: CustomerEmailType,
  input: CustomerEmailBuildInput,
  bookingSummary?: BookingOrderSummary | null,
): CustomerEmailContent => {
  const firstName = firstNameFrom(input.firstName || input.customerName);
  const dashboardUrl = `${appBaseUrl()}/dashboard`;
  const binsUrl = `${appBaseUrl()}/bins`;
  const accountUrl = `${appBaseUrl()}/account`;
  const trackingNumber = String(input.trackingNumber || "7946TEST0000123456").trim();
  const trackingUrl =
    String(input.trackingUrl || "").trim() ||
    `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(trackingNumber)}`;

  switch (emailType) {
    case "booking_confirmation": {
      const summary =
        bookingSummary || input.bookingSummary || buildFallbackBookingSummary(input);
      return {
        subject: "You're all set with StorkBin!",
        html: emailShell(`
    <h1 style="margin:0 0 12px;font-size:22px;color:#2d3b2d;">You're all set with StorkBin!</h1>
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Thank you for choosing StorkBin—your items are one step closer to being securely stored and accessible whenever you need them.</p>
    <p><strong>Order summary</strong></p>
    ${renderBookingOrderSummaryHtml(summary)}
    <p><strong>What happens next?</strong></p>
    <ol style="padding-left:20px;margin:8px 0 16px;">
      <li style="margin-bottom:8px;"><strong>We prepare your empty StorkBins</strong><br/>Delivery is included with your plan. We’ll email you tracking once your bins ship.</li>
      <li style="margin-bottom:8px;"><strong>Start preparing your items</strong><br/>Gather what you'd like to store so you're ready to pack once your bins arrive.</li>
      <li style="margin-bottom:8px;"><strong>Pack your bins carefully</strong><br/>Use padding where needed and keep lids secure.</li>
      <li style="margin-bottom:8px;"><strong>Name your bin and log your items</strong><br/>In <a href="${escapeHtml(binsUrl)}" style="color:#4a6741;">My Bins</a>, give each bin a simple name and optionally log items inside.</li>
      <li style="margin-bottom:8px;"><strong>Send packed bins to storage</strong><br/>When you're ready, request return shipping from My Bins. Shipping is quoted at checkout whenever bins move.</li>
      <li><strong>We store your bins safely</strong><br/>Once they arrive at StorkBin HQ, we'll store them until you need them again.</li>
    </ol>
    ${ctaButton(dashboardUrl, "Open your dashboard")}
    <p style="font-size:14px;color:#666;">Manage billing anytime in <a href="${escapeHtml(accountUrl)}" style="color:#4a6741;">your account</a>.</p>
    <p>Welcome to easier, smarter storage.</p>
  `),
      };
    }

    case "bins_shipped_to_customer": {
      const binLabels = input.binLabels?.length ? input.binLabels : [input.binLabel || "Test-001"];
      const binsLine = `<p>Shipment includes: ${binLabels.map((b) => escapeHtml(b)).join(", ")}</p>`;
      return {
        subject: `Your StorkBins have shipped — tracking ${trackingNumber}`,
        html: emailShell(`
    <h1 style="margin:0 0 12px;font-size:22px;color:#2d3b2d;">Your StorkBins have shipped!</h1>
    <p>Your empty StorkBins are on the way.</p>
    ${binsLine}
    <p><strong>Tracking number:</strong> ${escapeHtml(trackingNumber)}</p>
    ${ctaButton(trackingUrl, "Track your shipment")}
    <p>When they arrive, we'll send another note with next steps for packing, naming your bins, and sending them to storage.</p>
  `),
      };
    }

    case "bins_received_by_customer":
      return {
        subject: "Your StorkBins have arrived — here's what to do next",
        html: emailShell(`
    <h1 style="margin:0 0 12px;font-size:22px;color:#2d3b2d;">Your StorkBins have arrived</h1>
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Your StorkBin(s) have officially arrived. You can now unpack, access, or update your items as needed.</p>
    <p><strong>A few reminders while your bins are with you:</strong></p>
    <ul style="padding-left:20px;">
      <li>If you add or remove items, update your inventory in your StorkBin account</li>
      <li>Keep lids securely closed before shipping back</li>
      <li>Keep bin labels attached and visible</li>
    </ul>
    <p>When you're ready to send your bins to storage, start a return shipment from your dashboard—we'll provide a label after checkout.</p>
    ${ctaButton(dashboardUrl, "Open your dashboard")}
  `),
      };

    case "bin_requested": {
      const binLabel = input.binLabel || "Test-001";
      const binName = input.binName || "Camping gear";
      return {
        subject: `We received your bin request — ${binLabel}`,
        html: emailShell(`
    <h1 style="margin:0 0 12px;font-size:22px;color:#2d3b2d;">We received your bin request</h1>
    <p>Thanks—we've received your request and are preparing your bin to ship. It has not shipped yet.</p>
    <p><strong>Request confirmation</strong><br/>
    Bin requested: <strong>${escapeHtml(binLabel)}</strong>${binName !== "Unnamed bin" ? ` (${escapeHtml(binName)})` : ""}</p>
    <p>You'll receive a separate email with tracking as soon as your bin is on the way.</p>
    <p><strong>What happens next?</strong></p>
    <ol style="padding-left:20px;">
      <li style="margin-bottom:8px;">We'll email tracking when your bin ships to you.</li>
      <li style="margin-bottom:8px;">When it arrives, add or remove items and update your bin name and inventory in your dashboard.</li>
      <li style="margin-bottom:8px;">When you're ready to send it back to storage, start a return shipment from your dashboard.</li>
      <li>We'll notify you when it arrives at StorkBin HQ and is stored again.</li>
    </ol>
    ${ctaButton(dashboardUrl, "View your bins")}
  `),
      };
    }

    case "bins_shipped_to_storage": {
      const binLabel = input.binLabel;
      const binName = input.binName;
      const labelPdfBase64 = input.labelPdfBase64;
      let binLine = "";
      if (binLabel) {
        binLine = `<p>Bin: <strong>${escapeHtml(binLabel)}</strong>${binName && binName !== "Unnamed bin" ? ` (${escapeHtml(binName)})` : ""}</p>`;
      }
      const binDetailUrl = input.boxId ? `${binsUrl}/${encodeURIComponent(String(input.boxId))}` : binsUrl;
      return {
        subject: `Your return label is ready — tracking ${trackingNumber}`,
        html: emailShell(`
    <h1 style="margin:0 0 12px;font-size:22px;color:#2d3b2d;">Your return label is ready</h1>
    <p>Your prepaid return label has been created. <strong>Your bin has not shipped yet</strong>—complete the steps below when you're ready to send it.</p>
    ${binLine}
    <p><strong>Tracking number:</strong> ${escapeHtml(trackingNumber)} (active once the carrier scans your package)</p>
    ${renderReturnLabelAccessHtml(trackingNumber, labelPdfBase64, input.labelUrl)}
    ${ctaButton(trackingUrl, "Track shipment")}
    <p><strong>Before you ship:</strong></p>
    <ul style="padding-left:20px;">
      <li>Confirm or update your bin name and inventory in <a href="${escapeHtml(binDetailUrl)}" style="color:#4a6741;">My Bins</a></li>
      <li>Securely close the lid</li>
      <li>Drop off at a carrier location or schedule a pickup</li>
    </ul>
    <p>We'll notify you when your bin arrives at StorkBin HQ and is stored.</p>
    ${ctaButton(binsUrl, "Open My Bins")}
  `),
        pdfBase64: labelPdfBase64,
        pdfFilename: labelPdfBase64 ? "storkbin-return-label.pdf" : undefined,
      };
    }

    case "bins_received_at_hq": {
      const binLabel = input.binLabel || "Test-001";
      const binName = input.binName || "Camping gear";
      return {
        subject: `Your StorkBin is stored — ${binLabel}`,
        html: emailShell(`
    <h1 style="margin:0 0 12px;font-size:22px;color:#2d3b2d;">Your StorkBin is stored</h1>
    <p>Good news—<strong>${escapeHtml(binLabel)}</strong>${binName !== "Unnamed bin" ? ` (${escapeHtml(binName)})` : ""} has arrived at StorkBin HQ and is now stored.</p>
    <p><strong>What this means</strong></p>
    <ul style="padding-left:20px;">
      <li>Your bin has been checked in and placed into storage</li>
      <li>Your items are safe and accessible anytime you need them</li>
    </ul>
    <p>View your bin's name and logged contents anytime in your dashboard. Inventory updates can only be made while the bin is in your possession—request the bin again if you need to make changes.</p>
    ${ctaButton(dashboardUrl, "View your bins")}
  `),
      };
    }

    case "auction_payment_warning": {
      const daysPastDue = input.daysPastDue ?? 12;
      const outstandingBalanceCents = input.outstandingBalanceCents ?? 3000;
      const auctionEligibilityDate =
        input.auctionEligibilityDate ||
        new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
      const paymentAccountUrl = `${appBaseUrl()}/account?payment=1`;
      return {
        subject: "Action needed: StorkBin payment past due",
        html: emailShell(`
    <h1 style="margin:0 0 12px;font-size:22px;color:#2d3b2d;">Action needed: update your payment</h1>
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>We were unable to process your recent StorkBin payment, and your account is currently <strong>${daysPastDue} day${daysPastDue === 1 ? "" : "s"}</strong> past due.</p>
    <p>To avoid interruption to your storage service, please update your payment method and resolve your outstanding balance as soon as possible.</p>
    <p><strong>Important account status</strong></p>
    <ul style="padding-left:20px;">
      <li>Days past due: <strong>${daysPastDue}</strong></li>
      <li>Outstanding balance: <strong>${formatUsdFromCents(outstandingBalanceCents)}</strong></li>
      <li>Auction eligibility date: <strong>${escapeHtml(new Date(auctionEligibilityDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))}</strong></li>
    </ul>
    <p>Accounts that remain unpaid for 45 days will result in stored bin(s) being removed from the StorkBin system and scheduled for auction or disposal in accordance with our Terms of Service.</p>
    ${ctaButton(paymentAccountUrl, "Update payment method")}
    <p style="font-size:14px;color:#666;">Log in to <a href="${escapeHtml(paymentAccountUrl)}" style="color:#4a6741;">your account</a> to review billing and resolve missed payments.</p>
  `),
      };
    }

    default:
      throw new Error(`Unsupported email type: ${emailType}`);
  }
};

const loadProfile = async (supabase: Supabase, userId: string) =>
  readProfileForEmail(supabase, userId);

const loadBoxLabel = async (supabase: Supabase, boxId: string, userId?: string | null) =>
  readBoxLabelForEmail(supabase, boxId, userId);

// --- Email #1: Booking confirmation ---

export const sendBookingConfirmationEmail = async (
  supabase: Supabase,
  opts: {
    userId: string;
    checkoutSessionId: string;
    binCount: number;
    amountChargedCents: number;
    customerEmail?: string | null;
    customerName?: string | null;
  },
) => {
  const profile = await loadProfile(supabase, opts.userId);
  const to = String(opts.customerEmail || profile?.email || "").trim();
  const bookingSummary = await resolveBookingOrderSummary(supabase, {
    userId: opts.userId,
    checkoutSessionId: opts.checkoutSessionId,
    binCount: opts.binCount,
    amountChargedCents: opts.amountChargedCents,
  });
  const content = buildCustomerEmailContent(
    "booking_confirmation",
    {
      customerName: opts.customerName || profile?.full_name,
      binCount: opts.binCount,
      amountChargedCents: opts.amountChargedCents,
    },
    bookingSummary,
  );

  return sendOnce(supabase, {
    userId: opts.userId,
    emailType: "booking_confirmation",
    referenceKey: opts.checkoutSessionId,
    to,
    ...content,
  });
};

// --- Email #2: Bins shipped to customer (tracking) ---

export const sendBinsShippedToCustomerEmail = async (
  supabase: Supabase,
  opts: {
    userId?: string | null;
    shipmentId: string;
    customerEmail: string;
    trackingNumber: string;
    trackingUrl: string;
    binLabels?: string[];
  },
) => {
  const content = buildCustomerEmailContent("bins_shipped_to_customer", {
    trackingNumber: opts.trackingNumber,
    trackingUrl: opts.trackingUrl,
    binLabels: opts.binLabels,
  });

  return sendOnce(supabase, {
    userId: opts.userId,
    emailType: "bins_shipped_to_customer",
    referenceKey: opts.shipmentId,
    to: opts.customerEmail,
    ...content,
  });
};

// --- Email #3: Customer received bins ---

export const sendBinsReceivedByCustomerEmail = async (
  supabase: Supabase,
  opts: {
    userId?: string | null;
    shipmentId: string;
    customerEmail: string;
    customerName?: string | null;
  },
) => {
  const content = buildCustomerEmailContent("bins_received_by_customer", {
    customerName: opts.customerName,
  });

  return sendOnce(supabase, {
    userId: opts.userId,
    emailType: "bins_received_by_customer",
    referenceKey: opts.shipmentId,
    to: opts.customerEmail,
    ...content,
  });
};

// --- Email #4: Bin requested ---

export const sendBinRequestedEmail = async (
  supabase: Supabase,
  opts: {
    userId?: string | null;
    shipmentId: string;
    boxId: string;
    customerEmail: string;
  },
) => {
  const { binLabel, binName } = await loadBoxLabel(supabase, opts.boxId, opts.userId);
  const content = buildCustomerEmailContent("bin_requested", { binLabel, binName });

  return sendOnce(supabase, {
    userId: opts.userId,
    emailType: "bin_requested",
    referenceKey: opts.shipmentId,
    to: opts.customerEmail,
    ...content,
  });
};

// --- Email #5: Customer ships bins back (return label + tracking) ---

export const sendBinsShippedToStorageEmail = async (
  supabase: Supabase,
  opts: {
    userId?: string | null;
    shipmentId: string;
    customerEmail: string;
    trackingNumber: string;
    trackingUrl: string;
    labelPdfBase64?: string | null;
    boxId?: string | null;
    labelUrl?: string | null;
  },
) => {
  let binLabel: string | undefined;
  let binName: string | undefined;
  if (opts.boxId) {
    const loaded = await loadBoxLabel(supabase, opts.boxId, opts.userId);
    binLabel = loaded.binLabel;
    binName = loaded.binName;
  }
  const content = buildCustomerEmailContent("bins_shipped_to_storage", {
    trackingNumber: opts.trackingNumber,
    trackingUrl: opts.trackingUrl,
    binLabel,
    binName,
    boxId: opts.boxId,
    labelPdfBase64: opts.labelPdfBase64,
    labelUrl: opts.labelUrl,
  });

  return sendOnce(supabase, {
    userId: opts.userId,
    emailType: "bins_shipped_to_storage",
    referenceKey: opts.shipmentId,
    to: opts.customerEmail,
    ...content,
  });
};

// --- Email #6: Bins received at HQ ---

export const sendBinsReceivedAtHqEmail = async (
  supabase: Supabase,
  opts: {
    userId?: string | null;
    shipmentId: string;
    boxId: string;
    customerEmail: string;
  },
) => {
  const { binLabel, binName } = await loadBoxLabel(supabase, opts.boxId, opts.userId);
  const content = buildCustomerEmailContent("bins_received_at_hq", { binLabel, binName });

  return sendOnce(supabase, {
    userId: opts.userId,
    emailType: "bins_received_at_hq",
    referenceKey: opts.shipmentId,
    to: opts.customerEmail,
    ...content,
  });
};

// --- Email #7: Auction / payment warning ---

export const sendAuctionPaymentWarningEmail = async (
  supabase: Supabase,
  opts: {
    userId: string;
    boxId: string;
    referenceKey: string;
    customerEmail: string;
    customerName?: string | null;
    daysPastDue: number;
    outstandingBalanceCents: number;
    auctionEligibilityDate: string;
    stripeSubscriptionId?: string | null;
  },
) => {
  const content = buildCustomerEmailContent("auction_payment_warning", {
    customerName: opts.customerName,
    daysPastDue: opts.daysPastDue,
    outstandingBalanceCents: opts.outstandingBalanceCents,
    auctionEligibilityDate: opts.auctionEligibilityDate,
  });

  return sendOnce(supabase, {
    userId: opts.userId,
    emailType: "auction_payment_warning",
    referenceKey: opts.referenceKey,
    to: opts.customerEmail,
    ...content,
  });
};

// --- Shipment lifecycle helpers ---

export const resolveShipmentCustomerEmail = async (
  supabase: Supabase,
  shipment: {
    user_id?: string | null;
    box_id?: string | null;
    shipping_address?: unknown;
  },
) => {
  const userId = String(shipment.user_id || "").trim();
  let profileEmail = "";
  if (userId) {
    const profile = await loadProfile(supabase, userId);
    profileEmail = String(profile?.email || "");
  }
  const addr =
    shipment.shipping_address && typeof shipment.shipping_address === "object"
      ? (shipment.shipping_address as Record<string, unknown>)
      : null;
  return resolveCustomerEmailForBin({
    profileEmail,
    shipmentAddress: addr,
    row: { user_email: profileEmail },
  });
};

export const notifyCustomerOnLabelCreated = async (
  supabase: Supabase,
  shipment: Record<string, unknown>,
  opts: {
    trackingNumber: string;
    trackingUrl: string;
    labelPdfBase64?: string | null;
  },
) => {
  const shipmentId = String(shipment.id || "");
  const direction = String(shipment.shipment_direction || "");
  const userId = String(shipment.user_id || "").trim() || null;
  const customerEmail = await resolveShipmentCustomerEmail(supabase, shipment);
  if (!customerEmail) return { ok: false, skipped: "no customer email" };

  if (direction === "to_customer") {
    const boxIds: string[] = [];
    const { data: linked } = await supabase
      .from("shipment_boxes")
      .select("box_id")
      .eq("shipment_id", shipmentId);
    for (const row of linked || []) {
      boxIds.push(String((row as { box_id: string }).box_id));
    }
    if (!boxIds.length && shipment.box_id) boxIds.push(String(shipment.box_id));

    const binLabels: string[] = [];
    for (const boxId of boxIds) {
      const { binLabel } = await loadBoxLabel(supabase, boxId, userId);
      binLabels.push(binLabel);
    }

    return sendBinsShippedToCustomerEmail(supabase, {
      userId,
      shipmentId,
      customerEmail,
      trackingNumber: opts.trackingNumber,
      trackingUrl: opts.trackingUrl,
      binLabels,
    });
  }

  if (direction === "to_storage") {
    return sendBinsShippedToStorageEmail(supabase, {
      userId,
      shipmentId,
      customerEmail,
      trackingNumber: opts.trackingNumber,
      trackingUrl: opts.trackingUrl,
      labelPdfBase64: opts.labelPdfBase64,
      boxId: shipment.box_id ? String(shipment.box_id) : null,
      labelUrl: shipment.label_url ? String(shipment.label_url) : null,
    });
  }

  return { ok: false, skipped: `unsupported direction ${direction}` };
};

export const notifyCustomerOnShipmentDelivered = async (
  supabase: Supabase,
  shipment: Record<string, unknown>,
) => {
  const shipmentId = String(shipment.id || "");
  const direction = String(shipment.shipment_direction || "");
  const userId = String(shipment.user_id || "").trim() || null;
  const customerEmail = await resolveShipmentCustomerEmail(supabase, shipment);
  if (!customerEmail) return { ok: false, skipped: "no customer email" };

  let customerName: string | null = null;
  if (userId) {
    const profile = await loadProfile(supabase, userId);
    customerName = profile?.full_name || null;
  }

  if (direction === "to_customer") {
    return sendBinsReceivedByCustomerEmail(supabase, {
      userId,
      shipmentId,
      customerEmail,
      customerName,
    });
  }

  if (direction === "to_storage") {
    const boxId = String(shipment.box_id || "").trim();
    if (!boxId) return { ok: false, skipped: "missing box_id" };
    return sendBinsReceivedAtHqEmail(supabase, {
      userId,
      shipmentId,
      boxId,
      customerEmail,
    });
  }

  return { ok: false, skipped: `unsupported direction ${direction}` };
};

export const notifyBinRequestedEmails = async (
  supabase: Supabase,
  shipmentIds: string[],
) => {
  const results: unknown[] = [];
  for (const shipmentId of shipmentIds) {
    const { data: shipment } = await supabase
      .from("shipments")
      .select("id,box_id,user_id,shipment_direction")
      .eq("id", shipmentId)
      .maybeSingle();
    if (!shipment || shipment.shipment_direction !== "to_customer") continue;

    const customerEmail = await resolveShipmentCustomerEmail(supabase, shipment);
    if (!customerEmail) continue;

    results.push(
      await sendBinRequestedEmail(supabase, {
        userId: String(shipment.user_id || "") || null,
        shipmentId,
        boxId: String(shipment.box_id || ""),
        customerEmail,
      }),
    );
  }
  return results;
};

export const sendAuctionWarningForFailedBox = async (
  supabase: Supabase,
  stripeSecretKey: string,
  box: {
    id: string;
    user_id: string;
    stripe_subscription_id?: string | null;
    subscription_payment_failed_at?: string | null;
    lifecycle_deadline_at?: string | null;
  },
  referenceKey: string,
) => {
  const profile = await loadProfile(supabase, box.user_id);
  const customerEmail = String(profile?.email || "").trim();
  if (!customerEmail) return { ok: false, skipped: "no customer email" };

  const failedAt = box.subscription_payment_failed_at
    ? new Date(box.subscription_payment_failed_at)
    : new Date();
  const daysPastDue = Math.max(
    1,
    Math.ceil((Date.now() - failedAt.getTime()) / (1000 * 60 * 60 * 24)),
  );

  let outstandingBalanceCents = 0;
  const subId = String(box.stripe_subscription_id || "").trim();
  if (subId && stripeSecretKey) {
    try {
      const res = await fetch(
        `https://api.stripe.com/v1/invoices?subscription=${encodeURIComponent(subId)}&limit=20&status=open`,
        { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
      );
      const payload = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray((payload as { data?: unknown[] }).data)) {
        outstandingBalanceCents = ((payload as { data: Array<Record<string, unknown>> }).data || []).reduce(
          (sum, inv) => sum + Number(inv.amount_remaining || inv.amount_due || 0),
          0,
        );
      }
    } catch (e) {
      console.warn("auction warning: could not load Stripe invoices", e);
    }
  }

  const auctionEligibilityDate =
    box.lifecycle_deadline_at || new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();

  return sendAuctionPaymentWarningEmail(supabase, {
    userId: box.user_id,
    boxId: box.id,
    referenceKey,
    customerEmail,
    customerName: profile?.full_name,
    daysPastDue,
    outstandingBalanceCents,
    auctionEligibilityDate,
    stripeSubscriptionId: subId || null,
  });
};
