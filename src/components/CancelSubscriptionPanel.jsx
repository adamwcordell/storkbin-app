import { useState } from "react";
import styles from "../styles/styles";
import { getCancellationEndDate } from "../config/subscriptionPlans";
import ShippingAddressForm from "./ShippingAddressForm.jsx";
import { normalizeUsStateOrProvinceCode } from "../utils/usStateNormalize.js";
import { validateShippingAddress } from "../utils/validateShippingAddress.js";

const emptyAddress = {
  full_name: "",
  email: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  zip: "",
};

function CancelSubscriptionPanel({
  box,
  earlyCancellationFeeUsd = 99,
  withinMinimumTerm = false,
  earlyTerminationQuote = null,
  onRequestCancellation,
  requestCancellation,
  onStartEarlyTermination,
  onBack,
  onClose,
  defaultEmail = "",
}) {
  const boxIsStored = box.status === "stored";
  const boxIsWithCustomer = box.status === "at_customer";
  const boxIsInTransit =
    box.status === "in_transit_to_customer" ||
    box.status === "in_transit_to_storage" ||
    box.fulfillment_status === "bin_shipped_to_customer";

  const [shippingAddressSource, setShippingAddressSource] = useState("profile");
  const [customAddress, setCustomAddress] = useState(() => ({
    ...emptyAddress,
    email: defaultEmail || "",
  }));
  const [addressFieldErrors, setAddressFieldErrors] = useState({});
  const [addressSuggested, setAddressSuggested] = useState(null);
  const [addressValidationMessage, setAddressValidationMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancellationPath, setCancellationPath] = useState("scheduled_end");

  const cancelAction = onBack || onClose;
  const requestAction = onRequestCancellation || requestCancellation;
  const quoteOk = earlyTerminationQuote?.status === "ok";
  const quoteLoading = earlyTerminationQuote?.status === "loading";
  const quoteError = earlyTerminationQuote?.status === "error";
  const penaltyTotal =
    quoteOk && earlyTerminationQuote.amountUsd != null
      ? Number(earlyTerminationQuote.amountUsd)
      : Number(earlyCancellationFeeUsd);

  const scheduledEndLabel = new Date(getCancellationEndDate(box)).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const updateCustomAddress = (field, value) => {
    setAddressFieldErrors({});
    setAddressSuggested(null);
    setAddressValidationMessage("");
    setCustomAddress((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const applyCancellationAddressSuggestion = () => {
    if (!addressSuggested) return;
    setCustomAddress((c) => ({
      ...c,
      full_name: String(addressSuggested.full_name || c.full_name || ""),
      email: String(addressSuggested.email || c.email || defaultEmail || ""),
      address_line1: String(addressSuggested.address_line1 || ""),
      address_line2: String(addressSuggested.address_line2 || ""),
      city: String(addressSuggested.city || ""),
      state: normalizeUsStateOrProvinceCode(String(addressSuggested.state || ""), "US"),
      zip: String(addressSuggested.zip || ""),
    }));
    setAddressSuggested(null);
    setAddressFieldErrors({});
    setAddressValidationMessage("Suggestion applied — review and confirm cancellation again.");
  };

  const submitCancellation = async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    if (isSubmitting) return;

    if (!requestAction) {
      alert("Cancellation is not available right now. Please refresh and try again.");
      return;
    }

    if (!boxIsStored && !boxIsWithCustomer) {
      alert("This subscription cannot be cancelled from this status yet.");
      return;
    }

    let customResolved = null;
    if (boxIsStored && shippingAddressSource === "custom") {
      const addr = {
        ...customAddress,
        email: (customAddress.email || "").trim() || defaultEmail || "",
      };
      const v = await validateShippingAddress(addr);
      if (!v.ok) {
        setAddressFieldErrors(v.fieldErrors || {});
        setAddressSuggested(v.suggested || null);
        setAddressValidationMessage(v.message || "Please fix your return address.");
        return;
      }
      customResolved = v.resolved;
    }

    const shippingPreference = {
      source: boxIsStored ? shippingAddressSource : null,
      address: boxIsStored && shippingAddressSource === "custom" ? customResolved : null,
    };

    setIsSubmitting(true);

    try {
      if (withinMinimumTerm && cancellationPath === "early_break") {
        if (!onStartEarlyTermination) {
          alert("Early termination checkout is not available. Please refresh and try again.");
          return;
        }
        await onStartEarlyTermination(box.id, shippingPreference);
        return;
      }

      await requestAction(box.id, shippingPreference);
      cancelAction?.();
    } catch (error) {
      console.error("Cancellation request failed:", error);
      alert(error?.message || "Cancellation could not be completed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={panelStyle}>
      <h3 style={titleStyle}>Cancel subscription · Bin {box.box_number || box.id}</h3>

      {box.early_termination_fee_waived && (
        <p style={smallTextStyle}>
          This subscription was reactivated after a prior end: there is no minimum-term cancellation penalty. If
          your bin is still in our warehouse when service ends, return shipping is charged separately when we ship
          your bin.
        </p>
      )}

      {withinMinimumTerm && quoteLoading && (
        <p style={smallTextStyle}>Loading your early termination fee from StorkBin…</p>
      )}

      {withinMinimumTerm && quoteError && (
        <p style={warningTextStyle}>
          {earlyTerminationQuote?.message ||
            "We could not load the exact fee from the server. The amount shown below is an estimate only; checkout will show the final charge."}
        </p>
      )}

      {withinMinimumTerm && (
        <div style={pathChoiceStyle}>
          <strong>How do you want to end this bin?</strong>
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name={`cancellation-path-${box.id}`}
              value="scheduled_end"
              checked={cancellationPath === "scheduled_end"}
              onChange={() => setCancellationPath("scheduled_end")}
            />{" "}
            Cancel after my minimum term — no extra fee. Your subscription ends on {scheduledEndLabel} (normal
            cancellation rules apply).
          </label>
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name={`cancellation-path-${box.id}`}
              value="early_break"
              checked={cancellationPath === "early_break"}
              onChange={() => setCancellationPath("early_break")}
            />{" "}
            {penaltyTotal != null ? (
              <>
                Early termination includes a one-time ${penaltyTotal.toFixed(2)} fee charged at checkout. Your subscription ends as soon as payment
                succeeds.
                {boxIsStored
                  ? " Your bin is in storage — you’ll go to the Cart next to pick FedEx shipping; checkout charges the fee plus shipping together."
                  : ""}
              </>
            ) : (
              <>
                Early termination includes a one-time fee; the final charge is
                confirmed at checkout. Your subscription ends as soon as payment succeeds.
                {boxIsStored ? " If your bin is in storage, you’ll pick shipping in the Cart and pay fee + shipping together." : ""}
              </>
            )}
          </label>
        </div>
      )}

      {boxIsStored && (
        <div style={addressChoiceStyle}>
          <strong>Return shipping address</strong>
          <p style={smallTextStyle}>
            Choose where we should send your bin if it is still in storage when your subscription ends.
          </p>

          <label style={radioLabelStyle}>
            <input
              type="radio"
              name={`cancellation-address-${box.id}`}
              value="profile"
              checked={shippingAddressSource === "profile"}
              onChange={() => {
                setShippingAddressSource("profile");
                setAddressFieldErrors({});
                setAddressSuggested(null);
                setAddressValidationMessage("");
              }}
            />{" "}
            Use my address on file
          </label>

          <label style={radioLabelStyle}>
            <input
              type="radio"
              name={`cancellation-address-${box.id}`}
              value="custom"
              checked={shippingAddressSource === "custom"}
              onChange={() => {
                setShippingAddressSource("custom");
                setAddressFieldErrors({});
                setAddressSuggested(null);
                setAddressValidationMessage("");
              }}
            />{" "}
            Use a different address
          </label>

          {shippingAddressSource === "custom" && (
            <div style={{ marginTop: "12px" }}>
              <p style={smallTextStyle}>U.S. addresses only. We verify with FedEx before scheduling return shipping.</p>
              <ShippingAddressForm
                value={customAddress}
                onFieldChange={updateCustomAddress}
                fieldErrors={addressFieldErrors}
                disabled={isSubmitting}
                suggested={addressSuggested}
                onApplySuggestion={applyCancellationAddressSuggestion}
                idPrefix={`cancel-addr-${box.id}`}
              />
              {addressValidationMessage && <p style={warningTextStyle}>{addressValidationMessage}</p>}
            </div>
          )}
        </div>
      )}

      {boxIsWithCustomer && (
        <p style={smallTextStyle}>
          This bin is currently with you, so no return shipment is needed when the subscription ends.
        </p>
      )}

      {boxIsInTransit && (
        <p style={warningTextStyle}>
          This subscription cannot be cancelled while the bin is in transit.
        </p>
      )}

      {!boxIsStored && !boxIsWithCustomer && !boxIsInTransit && (
        <p style={warningTextStyle}>
          This subscription cannot be cancelled from this status yet.
        </p>
      )}

      <div style={actionsStyle}>
        {(boxIsStored || boxIsWithCustomer) && (
          <button
            type="button"
            style={{
              ...dangerButtonStyle,
              opacity: isSubmitting ? 0.7 : 1,
              cursor: isSubmitting ? "not-allowed" : "pointer",
            }}
            onClick={submitCancellation}
            disabled={
              isSubmitting ||
              (withinMinimumTerm &&
                cancellationPath === "early_break" &&
                earlyTerminationQuote?.status === "loading")
            }
          >
            {isSubmitting
              ? withinMinimumTerm && cancellationPath === "early_break"
                ? "Starting checkout…"
                : "Scheduling…"
              : withinMinimumTerm && cancellationPath === "early_break"
                ? "Pay fee and end subscription"
                : "Confirm cancellation"}
          </button>
        )}

        <button type="button" style={styles.secondaryButton} onClick={cancelAction}>
          Nevermind
        </button>
      </div>
    </div>
  );
}

const panelStyle = {
  marginTop: "12px",
  padding: "16px",
  border: "1px solid rgba(0, 0, 0, 0.08)",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
};

const titleStyle = {
  ...styles.sectionTitle,
  marginTop: 0,
};

const smallTextStyle = {
  ...styles.smallText,
  lineHeight: 1.45,
};

const warningTextStyle = {
  ...styles.warningText,
  lineHeight: 1.45,
};

const addressChoiceStyle = {
  marginTop: "14px",
  padding: "12px",
  border: "1px solid rgba(0, 0, 0, 0.08)",
  borderRadius: "10px",
  backgroundColor: "rgba(0, 0, 0, 0.02)",
};

const radioLabelStyle = {
  display: "block",
  marginTop: "8px",
  fontSize: "14px",
};

const pathChoiceStyle = {
  marginTop: "12px",
  marginBottom: "8px",
  padding: "12px",
  borderRadius: "10px",
  border: "1px solid rgba(0, 0, 0, 0.1)",
  backgroundColor: "rgba(0, 0, 0, 0.02)",
};

const actionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  marginTop: "16px",
};

const dangerButtonStyle = {
  backgroundColor: "#A01E1E",
  color: "#FFFFFF",
  border: "none",
  borderRadius: "8px",
  padding: "10px 14px",
  fontWeight: 700,
};

export default CancelSubscriptionPanel;
