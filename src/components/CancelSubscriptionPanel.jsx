import { useState } from "react";
import styles from "../styles/styles";

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
  onRequestCancellation,
  requestCancellation,
  onBack,
  onClose,
}) {
  const boxIsStored = box.status === "stored";
  const boxIsWithCustomer = box.status === "at_customer";
  const boxIsInTransit =
    box.status === "in_transit_to_customer" ||
    box.status === "in_transit_to_storage" ||
    box.fulfillment_status === "bin_shipped_to_customer";

  const [shippingAddressSource, setShippingAddressSource] = useState("profile");
  const [customAddress, setCustomAddress] = useState(emptyAddress);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cancelAction = onBack || onClose;
  const requestAction = onRequestCancellation || requestCancellation;

  const updateCustomAddress = (field, value) => {
    setCustomAddress((current) => ({
      ...current,
      [field]: value,
    }));
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

    const shippingPreference = {
      source: boxIsStored ? shippingAddressSource : null,
      address: boxIsStored && shippingAddressSource === "custom" ? customAddress : null,
    };

    if (boxIsStored && shippingAddressSource === "custom") {
      const missingRequiredAddress =
        !customAddress.address_line1?.trim() ||
        !customAddress.city?.trim() ||
        !customAddress.state?.trim() ||
        !customAddress.zip?.trim();

      if (missingRequiredAddress) {
        alert("Please enter a complete return shipping address.");
        return;
      }
    }

    setIsSubmitting(true);

    try {
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

      <p style={textStyle}>
        You can request cancellation anytime, but your subscription remains active through your 6-month minimum term.
      </p>

      <p style={textStyle}>
        If your bin is still in storage when your subscription ends, we’ll automatically bill your card on file for shipping and send it to your selected address. If your bin is with you when your subscription ends, simply keep it.
      </p>

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
              onChange={() => setShippingAddressSource("profile")}
            />{" "}
            Use my address on file
          </label>

          <label style={radioLabelStyle}>
            <input
              type="radio"
              name={`cancellation-address-${box.id}`}
              value="custom"
              checked={shippingAddressSource === "custom"}
              onChange={() => setShippingAddressSource("custom")}
            />{" "}
            Use a different address
          </label>

          {shippingAddressSource === "custom" && (
            <div style={customAddressGridStyle}>
              <input
                style={styles.input}
                placeholder="Full name"
                value={customAddress.full_name}
                onChange={(event) => updateCustomAddress("full_name", event.target.value)}
              />
              <input
                style={styles.input}
                placeholder="Email"
                value={customAddress.email}
                onChange={(event) => updateCustomAddress("email", event.target.value)}
              />
              <input
                style={styles.input}
                placeholder="Address line 1"
                value={customAddress.address_line1}
                onChange={(event) => updateCustomAddress("address_line1", event.target.value)}
              />
              <input
                style={styles.input}
                placeholder="Address line 2"
                value={customAddress.address_line2}
                onChange={(event) => updateCustomAddress("address_line2", event.target.value)}
              />
              <input
                style={styles.input}
                placeholder="City"
                value={customAddress.city}
                onChange={(event) => updateCustomAddress("city", event.target.value)}
              />
              <input
                style={styles.input}
                placeholder="State"
                value={customAddress.state}
                onChange={(event) => updateCustomAddress("state", event.target.value)}
              />
              <input
                style={styles.input}
                placeholder="ZIP"
                value={customAddress.zip}
                onChange={(event) => updateCustomAddress("zip", event.target.value)}
              />
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
            disabled={isSubmitting}
          >
            {isSubmitting ? "Scheduling..." : "Confirm cancellation"}
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

const textStyle = {
  margin: "10px 0",
  lineHeight: 1.45,
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

const customAddressGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "10px",
  marginTop: "12px",
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
