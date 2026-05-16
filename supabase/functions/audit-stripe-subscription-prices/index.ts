import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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

type StripeSubscription = {
  id: string;
  status?: string;
  customer?: string;
  items?: {
    data?: Array<{
      price?: {
        id?: string;
        unit_amount?: number | null;
        recurring?: { interval?: string | null } | null;
      } | null;
    }>;
  };
};

const listSubscriptionsPage = async (
  stripeSecretKey: string,
  params: URLSearchParams,
): Promise<{ data: StripeSubscription[]; has_more: boolean }> => {
  const response = await fetch(`https://api.stripe.com/v1/subscriptions?${params.toString()}`, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Stripe request failed");
  }
  return {
    data: (payload.data || []) as StripeSubscription[],
    has_more: Boolean(payload.has_more),
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return jsonResponse({ error: "Missing STRIPE_SECRET_KEY" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const expectedMonthlyCents = Math.max(1, Number(body.expectedMonthlyCents || 1500));
    const limit = Math.min(1000, Math.max(1, Number(body.limit || 300)));

    let startingAfter = "";
    let scanned = 0;
    const mismatches: Array<Record<string, unknown>> = [];
    const byAmount: Record<string, number> = {};

    while (scanned < limit) {
      const pageSize = Math.min(100, limit - scanned);
      const params = new URLSearchParams();
      params.append("limit", String(pageSize));
      params.append("status", "all");
      if (startingAfter) params.append("starting_after", startingAfter);

      const page = await listSubscriptionsPage(stripeSecretKey, params);
      const subs = page.data || [];
      if (subs.length === 0) break;

      for (const sub of subs) {
        scanned += 1;
        const firstItem = sub.items?.data?.[0];
        const amount = Number(firstItem?.price?.unit_amount ?? 0);
        const interval = String(firstItem?.price?.recurring?.interval || "");
        const amountKey = `${amount}:${interval || "none"}`;
        byAmount[amountKey] = (byAmount[amountKey] || 0) + 1;

        // We care about monthly subscription prices.
        if (interval !== "month") continue;
        if (amount !== expectedMonthlyCents) {
          mismatches.push({
            subscriptionId: sub.id,
            status: sub.status || null,
            unitAmount: amount,
            interval,
            priceId: firstItem?.price?.id || null,
            customer: sub.customer || null,
          });
        }
      }

      startingAfter = subs[subs.length - 1]?.id || "";
      if (!page.has_more || !startingAfter || scanned >= limit) break;
    }

    return jsonResponse({
      ok: true,
      expectedMonthlyCents,
      scannedSubscriptions: scanned,
      monthlyMismatches: mismatches.length,
      amountDistribution: byAmount,
      mismatches,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
