type NotifyArgs = {
  to: string | string[];
  subject: string;
  html: string;
  pdfBase64?: string | null;
  pdfFilename?: string;
};

export const escapeHtml = (s: string) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const sendResendEmail = async (args: NotifyArgs): Promise<{ ok: boolean; skipped?: string; error?: string }> => {
  const apiKey = (Deno.env.get("RESEND_API_KEY") || "").trim();
  if (!apiKey) {
    return { ok: false, skipped: "RESEND_API_KEY not set" };
  }

  const from = (Deno.env.get("RESEND_FROM_EMAIL") || "").trim();
  if (!from) {
    return { ok: false, skipped: "RESEND_FROM_EMAIL not set" };
  }

  const toList = Array.isArray(args.to) ? args.to : [args.to];
  const body: Record<string, unknown> = {
    from,
    to: toList,
    subject: args.subject,
    html: args.html,
  };

  if (args.pdfBase64 && args.pdfFilename) {
    body.attachments = [
      {
        filename: args.pdfFilename,
        content: args.pdfBase64,
      },
    ];
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String((payload as { message?: string })?.message || res.statusText || "Resend failed");
    return { ok: false, error: msg };
  }

  return { ok: true };
};

const opsNotificationEmail = (): string | null => {
  const direct = (Deno.env.get("OPS_LABEL_NOTIFICATION_EMAIL") || "").trim();
  if (direct) return direct;
  const admins = (Deno.env.get("ADMIN_EMAILS") || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return admins[0] || null;
};

export const notifyCustomerReturnLabel = async (opts: {
  customerEmail: string;
  trackingNumber: string;
  trackingUrl: string;
  labelPdfBase64: string | null;
}) => {
  const html = `
    <p>Your return shipping label for StorkBin is ready.</p>
    <p><strong>Tracking:</strong> ${opts.trackingNumber}<br/>
    <a href="${opts.trackingUrl}">Track on FedEx</a></p>
    <p>Print the attached PDF and affix it to your package.</p>
  `;
  return sendResendEmail({
    to: opts.customerEmail,
    subject: "Your StorkBin return shipping label",
    html,
    pdfBase64: opts.labelPdfBase64 || undefined,
    pdfFilename: opts.labelPdfBase64 ? "storkbin-return-label.pdf" : undefined,
  });
};

/** All ops/admin recipients for operational alerts (comma-separated ADMIN_EMAILS + optional OPS). */
export const opsAdminEmailList = (): string[] => {
  const out = new Set<string>();
  const pushList = (raw: string) => {
    raw.split(",").forEach((v) => {
      const t = v.trim().toLowerCase();
      if (t) out.add(t);
    });
  };
  pushList(Deno.env.get("OPS_LABEL_NOTIFICATION_EMAIL") || "");
  pushList(Deno.env.get("ADMIN_EMAILS") || "");
  return [...out];
};

export const notifyShippingOverageDetected = async (opts: {
  eventId: string;
  shipmentId: string;
  boxId: string | null;
  userId: string | null;
  trackingNumber: string | null;
  overageAmountCents: number | null;
  carrierBilledAmountCents: number | null;
  originalEstimatedAmountCents: number | null;
  reasonSummary: string;
}) => {
  const recipients = opsAdminEmailList();
  if (recipients.length === 0) {
    return { ok: false, skipped: "No ADMIN_EMAILS configured" };
  }
  const fmtMoney = (cents: number | null) =>
    cents == null || !Number.isFinite(cents)
      ? "—"
      : `$${(cents / 100).toFixed(2)}`;
  const html = `
    <p><strong>StorkBin — FedEx / carrier shipping adjustment detected</strong></p>
    <ul>
      <li><strong>Event id:</strong> ${opts.eventId}</li>
      <li><strong>Shipment:</strong> ${opts.shipmentId}</li>
      <li><strong>Bin:</strong> ${opts.boxId || "—"}</li>
      <li><strong>Customer (user id):</strong> ${opts.userId || "—"}</li>
      <li><strong>Tracking:</strong> ${opts.trackingNumber || "—"}</li>
      <li><strong>Quoted (est.):</strong> ${fmtMoney(opts.originalEstimatedAmountCents)}</li>
      <li><strong>Carrier billed:</strong> ${fmtMoney(opts.carrierBilledAmountCents)}</li>
      <li><strong>Overage:</strong> ${fmtMoney(opts.overageAmountCents)}</li>
    </ul>
    <p><strong>Reason / detail</strong><br/>${escapeHtml(opts.reasonSummary).replace(/\n/g, "<br/>")}</p>
    <p>Open <strong>Admin Dashboard</strong> → “Carrier shipping adjustments” to review or dismiss.</p>
  `;
  return sendResendEmail({
    to: recipients,
    subject: `[StorkBin Ops] Shipping overage — ${opts.trackingNumber || opts.shipmentId}`,
    html,
  });
};

/** Digest email for beta safety rails (stuck shipments, stale tracking, label failures). */
export const notifyBetaSafetyRailDigest = async (subject: string, html: string) => {
  const recipients = opsAdminEmailList();
  if (recipients.length === 0) {
    return { ok: false, skipped: "No ADMIN_EMAILS configured" };
  }
  return sendResendEmail({
    to: recipients,
    subject,
    html,
  });
};

export const notifyOpsOutboundLabel = async (opts: {
  trackingNumber: string;
  trackingUrl: string;
  direction: string;
  shipmentId: string;
}) => {
  const to = opsNotificationEmail();
  if (!to) {
    return { ok: false, skipped: "No OPS_LABEL_NOTIFICATION_EMAIL or ADMIN_EMAILS" };
  }
  const html = `
    <p>A FedEx outbound label was purchased automatically.</p>
    <p><strong>Shipment:</strong> ${opts.shipmentId}<br/>
    <strong>Direction:</strong> ${opts.direction}<br/>
    <strong>Tracking:</strong> ${opts.trackingNumber}<br/>
    <a href="${opts.trackingUrl}">FedEx tracking</a></p>
    <p>Open the shipment in Admin for the printable label (stored on the shipment row).</p>
  `;
  return sendResendEmail({
    to,
    subject: `[StorkBin Ops] Label created — ${opts.trackingNumber}`,
    html,
  });
};
