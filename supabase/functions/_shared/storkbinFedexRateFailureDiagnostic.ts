/** Starter-kit quote failure capture (redacted). No effect unless capture is enabled. */

export type StorkbinFedexRateAttemptDiagnostic = {
  attemptLabel: string;
  startedAt: string;
  completedAt: string;
  endpointUrl: string;
  status: number;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  didContinueToNextAttempt: boolean;
  continueReason: string | null;
};

export type StorkbinFedexRateFailure = {
  endpointUrl: string;
  environment: "sandbox" | "production";
  attemptLabel: string;
  accountNumberLast4: string | "none";
  usedAccountNumberSource: "none" | "sandbox_default" | "FEDEX_ACCOUNT_NUMBER";
  carrierCodes: unknown;
  rateRequestType: unknown;
  recipientResidential: boolean | null;
  packageDimensions: Record<string, unknown> | null;
  packageWeight: Record<string, unknown> | null;
  originPostalCode: string | null;
  destinationPostalCode: string | null;
  fedexHttpStatus: number;
  fedexTransactionId: string;
  fedexErrorCode: string | null;
  fedexErrorMessage: string | null;
  requestBodyRedacted: Record<string, unknown>;
  attemptDiagnostics: StorkbinFedexRateAttemptDiagnostic[];
  debugRateLane?: {
    mode: "sandbox_sample" | "customer";
    originPostalCode: string;
    destinationPostalCode: string;
  } | null;
};

let captureEnabled = false;
let lastFailure: StorkbinFedexRateFailure | null = null;
let captureDebugRateLane: StorkbinFedexRateFailure["debugRateLane"] = null;

export const enableStorkbinFedexRateFailureCapture = (opts?: {
  debugRateLane?: StorkbinFedexRateFailure["debugRateLane"];
}): void => {
  captureEnabled = true;
  lastFailure = null;
  captureDebugRateLane = opts?.debugRateLane ?? null;
};

export const takeStorkbinFedexRateFailure = (): StorkbinFedexRateFailure | null => {
  const out = lastFailure;
  lastFailure = null;
  captureEnabled = false;
  captureDebugRateLane = null;
  return out;
};

const maskAccountLast4 = (raw: string): string | "none" => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "none";
  if (digits.length >= 4) return digits.slice(-4);
  return digits.padStart(4, "*");
};

const redactRequestBody = (body: Record<string, unknown>): Record<string, unknown> => {
  const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  const walk = (node: unknown): unknown => {
    if (node == null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(walk);
    const o = node as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "accountNumber" && v && typeof v === "object") {
        const an = v as Record<string, unknown>;
        const val = String(an.value ?? "").trim();
        next[k] = {
          ...an,
          value: val ? `***${val.slice(-4)}` : an.value,
        };
        continue;
      }
      next[k] = walk(v);
    }
    return next;
  };
  return walk(clone) as Record<string, unknown>;
};

const resolveUsedAccountNumberSource = (
  accountValue: string,
): StorkbinFedexRateFailure["usedAccountNumberSource"] => {
  if (!accountValue) return "none";
  const configured = (Deno.env.get("FEDEX_ACCOUNT_NUMBER") || "").trim();
  if (configured && accountValue === configured) return "FEDEX_ACCOUNT_NUMBER";
  const sandboxDefault = (Deno.env.get("FEDEX_SANDBOX_ACCOUNT_NUMBER") || "740561073").trim();
  if (accountValue === sandboxDefault) return "sandbox_default";
  return "sandbox_default";
};

const extractFedexError = (payload: Record<string, unknown>) => {
  const errs = payload?.errors;
  if (!Array.isArray(errs) || errs.length === 0) {
    return { code: null as string | null, message: null as string | null };
  }
  const first = errs[0] as Record<string, unknown>;
  return {
    code: first?.code != null ? String(first.code) : null,
    message: first?.message != null ? String(first.message) : null,
  };
};

/** Logs one line per FedEx rate attempt when starter-kit capture is enabled. */
export const logStorkbinFedexRateAttempt = (input: {
  attemptLabel: string;
  endpointUrl: string;
  fedexHttpStatus: number;
  fedexPayload: Record<string, unknown>;
  ok: boolean;
}): void => {
  if (!captureEnabled) return;
  const err = extractFedexError(input.fedexPayload);
  console.error(
    JSON.stringify({
      STORKBIN_FEDEX_RATE_ATTEMPT: {
        attemptLabel: input.attemptLabel,
        endpointUrl: input.endpointUrl,
        fedexHttpStatus: input.fedexHttpStatus,
        fedexErrorCode: err.code,
        fedexErrorMessage: err.message,
        ok: input.ok,
      },
    }),
  );
};

export const recordStorkbinFedexRateFailure = (input: {
  endpointUrl: string;
  environment: "sandbox" | "production";
  attemptLabel: string;
  requestBody: Record<string, unknown>;
  fedexHttpStatus: number;
  fedexTransactionId: string;
  fedexPayload: Record<string, unknown>;
  attemptDiagnostics: StorkbinFedexRateAttemptDiagnostic[];
}): void => {
  if (!captureEnabled) return;

  const body = input.requestBody;
  const rs = body.requestedShipment as Record<string, unknown> | undefined;
  const shipper = rs?.shipper as Record<string, unknown> | undefined;
  const recipient = rs?.recipient as Record<string, unknown> | undefined;
  const shipperAddr = shipper?.address as Record<string, unknown> | undefined;
  const recipientAddr = recipient?.address as Record<string, unknown> | undefined;
  const accountValue = String(
    (body.accountNumber as Record<string, unknown> | undefined)?.value ?? "",
  ).trim();
  const lineItems = Array.isArray(rs?.requestedPackageLineItems)
    ? (rs!.requestedPackageLineItems as unknown[])
    : [];
  const firstLine =
    lineItems[0] && typeof lineItems[0] === "object"
      ? (lineItems[0] as Record<string, unknown>)
      : null;
  const err = extractFedexError(input.fedexPayload);

  lastFailure = {
    endpointUrl: input.endpointUrl,
    environment: input.environment,
    attemptLabel: input.attemptLabel,
    accountNumberLast4: accountValue ? maskAccountLast4(accountValue) : "none",
    usedAccountNumberSource: resolveUsedAccountNumberSource(accountValue),
    carrierCodes: body.carrierCodes ?? null,
    rateRequestType: rs?.rateRequestType ?? null,
    recipientResidential:
      recipientAddr?.residential === true
        ? true
        : recipientAddr?.residential === false
          ? false
          : null,
    packageDimensions:
      firstLine?.dimensions && typeof firstLine.dimensions === "object"
        ? (firstLine.dimensions as Record<string, unknown>)
        : null,
    packageWeight:
      firstLine?.weight && typeof firstLine.weight === "object"
        ? (firstLine.weight as Record<string, unknown>)
        : null,
    originPostalCode:
      shipperAddr?.postalCode != null ? String(shipperAddr.postalCode) : null,
    destinationPostalCode:
      recipientAddr?.postalCode != null ? String(recipientAddr.postalCode) : null,
    fedexHttpStatus: input.fedexHttpStatus,
    fedexTransactionId: input.fedexTransactionId,
    fedexErrorCode: err.code,
    fedexErrorMessage: err.message,
    requestBodyRedacted: redactRequestBody(body),
    attemptDiagnostics: input.attemptDiagnostics,
    debugRateLane: captureDebugRateLane,
  };
};
