import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ShippingSafetyNotice from "../components/ShippingSafetyNotice";
import { supabase, supabaseFunctionAuthHeaders } from "../supabaseClient";

const SUCCESS_MESSAGES = {
  initial_purchase: {
    title: "Order Confirmed",
    eyebrow: "Thanks for choosing StorkBin!",
    body: "Keep an eye on your inbox - we’ll send you a welcome email with everything you need to get started managing your bins.",
    cta: "Back to dashboard",
    href: "/dashboard",
    clearCart: true,
  },
  subscription_payment_recovery: {
    title: "Payment Successful",
    eyebrow: "Your subscription payment has been processed successfully.",
    body: "Your bin remains active and no further action is required.",
    cta: "Return to dashboard",
    href: "/dashboard",
  },
  subscription_reactivation: {
    title: "Subscription reactivated",
    eyebrow: "Your first month is paid and monthly storage is active again on the same card.",
    body: "Stripe will bill the recurring storage rate each month until you cancel. There is no minimum-term cancellation fee on this reactivated plan; if you cancel later and the bin is still in our warehouse, we charge return shipping when we ship it to you.",
    cta: "View my bins",
    href: "/bins",
    clearCart: true,
  },
  final_settlement: {
    title: "Final Shipping Payment Successful",
    eyebrow: "Your final shipping payment has been received.",
    body: "Your shipment is now being prepared for return delivery.",
    cta: "View my bins",
    href: "/bins",
  },
  return_to_storage_shipping: {
    title: "Shipment Request Confirmed",
    eyebrow: "Your return shipment payment has been processed.",
    body: "A shipping label will be generated shortly. Please follow shipment instructions provided via email.",
    cta: "View my bins",
    href: "/bins",
    clearCart: true,
  },
  customer_retrieval_shipping: {
    title: "Shipment Request Confirmed",
    eyebrow: "Your shipment request has been received and payment was successful.",
    body: "Your bin is now being prepared for shipment.",
    cta: "View my bins",
    href: "/bins",
    clearCart: true,
  },
  shipping: {
    title: "Shipment Request Confirmed",
    eyebrow: "Your shipment payment has been processed.",
    body: "Your shipment request is now being prepared.",
    cta: "View my bins",
    href: "/bins",
    clearCart: true,
  },
  payment_method_update: {
    title: "Payment Method Updated",
    eyebrow: "Your default payment method has been updated successfully.",
    body: "Future StorkBin payments will use your updated payment method.",
    cta: "Return to account",
    href: "/account",
  },
  early_termination: {
    title: "Early Termination Successful",
    eyebrow: "Your early termination payment has been processed.",
    body: "Your subscription has ended successfully.",
    cta: "Back to account",
    href: "/account",
  },
  cancellation_requested: {
  title: "Cancellation Request Submitted",
  message:
    "Your cancellation request has been received. If your bin is currently in storage, we’ll prepare the final return shipment and notify you of any required shipping payment.",
  buttonText: "Back to Account",
  buttonLink: "/account",
},
};

const SHIPPING_SUCCESS_FLOWS = ["customer_retrieval_shipping", "return_to_storage_shipping", "shipping"];

export default function CheckoutSuccess({ appData }) {
  const [searchParams] = useSearchParams();
  const flow = searchParams.get("flow") || "initial_purchase";
  const stripeSessionId = searchParams.get("session_id");
  const warning = String(searchParams.get("warning") || "").trim();
  const message = SUCCESS_MESSAGES[flow] || SUCCESS_MESSAGES.initial_purchase;
  const resolvedHref = message.href || message.buttonLink || "/dashboard";
  const resolvedCta = message.cta || message.buttonText || "Back to dashboard";
  const bodyCopy = message.body || message.message || "";
  const eyebrowCopy = message.eyebrow || "";

  const reconcileKey = useMemo(
    () => `${flow}:${stripeSessionId || ""}`,
    [flow, stripeSessionId]
  );

  useEffect(() => {
    if (message.clearCart) {
      localStorage.removeItem("cart");
    }
  }, [message.clearCart]);

  /** If Stripe webhooks are delayed or missing (common in local dev), finalize DB from the browser once. */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await new Promise((r) => setTimeout(r, 400));
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token || cancelled) return;

      try {
        const auth = await supabaseFunctionAuthHeaders();
        if (flow === "initial_purchase") {
          if (stripeSessionId) {
            for (let attempt = 0; attempt < 4 && !cancelled; attempt += 1) {
              const { error } = await supabase.functions.invoke("finalize-initial-purchase-checkout", {
                body: { sessionId: stripeSessionId },
                headers: auth,
              });
              if (!error) break;
              await new Promise((r) => setTimeout(r, 800 + attempt * 400));
            }
          }
          for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
            const { error } = await supabase.functions.invoke("ensure-starter-shipments", {
              body: {},
              headers: auth,
            });
            if (!error) break;
            await new Promise((r) => setTimeout(r, 1000));
          }
        }

        if (
          stripeSessionId &&
          SHIPPING_SUCCESS_FLOWS.includes(flow)
        ) {
          await supabase.functions.invoke("finalize-customer-shipping-checkout", {
            body: { sessionId: stripeSessionId },
            headers: auth,
          });
          try {
            sessionStorage.removeItem("storkbin_early_term_cart");
          } catch {
            /* ignore */
          }
        }

        if (stripeSessionId && flow === "early_termination") {
          let shippingPreference = null;
          try {
            const raw = sessionStorage.getItem("storkbin_early_term");
            const parsed = raw ? JSON.parse(raw) : null;
            shippingPreference = parsed?.shippingPreference ?? null;
          } catch {
            shippingPreference = null;
          }
          for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
            const { error } = await supabase.functions.invoke("complete-early-termination", {
              body: { sessionId: stripeSessionId, shippingPreference },
              headers: auth,
            });
            if (!error) break;
            await new Promise((r) => setTimeout(r, 900 + attempt * 300));
          }
          sessionStorage.removeItem("storkbin_early_term");
        }
      } catch {
        /* non-blocking: webhook may have already applied updates */
      }

      if (!cancelled && typeof appData?.refreshAppData === "function") {
        await appData.refreshAppData();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reconcileKey, flow, stripeSessionId, appData?.refreshAppData]);

  return (
    <div
      style={{
        backgroundColor: "#f7f7f7",
        paddingTop: "40px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          padding: "20px 24px",
          borderRadius: "12px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          maxWidth: "440px",
          width: "100%",
          textAlign: "center"
        }}
      >
        <div style={{
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          backgroundColor: "#e6f4ea",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 8px auto",
          fontSize: "20px",
          color: "#2e7d32"
        }}>
          ✓
        </div>

        <h1 style={{ marginBottom: "6px", fontSize: "20px", color: "#333" }}>
          {message.title}
        </h1>

        {eyebrowCopy ? (
          <p style={{ fontSize: "13px", marginBottom: "6px" }}>
            {eyebrowCopy}
          </p>
        ) : null}

        {bodyCopy ? (
          <p style={{ fontSize: "12.5px", marginBottom: "12px", lineHeight: "1.35" }}>
            {bodyCopy}
          </p>
        ) : null}
        {warning ? (
          <p style={{ fontSize: "12.5px", marginBottom: "12px", lineHeight: "1.35", color: "#8A3B2D" }}>
            {warning}
          </p>
        ) : null}

        {SHIPPING_SUCCESS_FLOWS.includes(flow) ? (
          <div style={{ textAlign: "left", marginBottom: "14px" }}>
            <ShippingSafetyNotice />
          </div>
        ) : null}

        <Link
          to={resolvedHref.startsWith("/") ? resolvedHref : `/${resolvedHref}`}
          style={{
            display: "inline-block",
            backgroundColor: "#111",
            color: "#fff",
            padding: "8px 14px",
            borderRadius: "16px",
            textDecoration: "none",
            fontSize: "12.5px",
          }}
        >
          {resolvedCta}
        </Link>
      </div>
    </div>
  );
}
