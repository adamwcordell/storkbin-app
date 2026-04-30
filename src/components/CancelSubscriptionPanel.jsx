import { useState } from "react";
import styles from "../styles/styles";

function CancelSubscriptionPanel({
  box,
  monthlyRate,
  cancellationRequested,
  cancellationApproved,
  cancellationRejected,
  onBack,
  onRequestCancellation,
}) {
  const boxIsStored = box.status === "stored";
  const boxIsWithCustomer = box.status === "at_customer";
  const boxIsInTransit =
    box.status === "in_transit_to_customer" ||
    box.fulfillment_status === "bin_shipped_to_customer";

  const [shippingAddressSource, setShippingAddressSource] = useState("profile");
  const [customAddress, setCustomAddress] = useState({
    full_name: "",
    email: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    zip: "",
  });

  const subscriptionEndDate = box.subscription_ends_at
    ? new Date(box.subscription_ends_at).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const cancellationLocked = cancellationRequested || cancellationApproved;

  const updateCustomAddress = (field, value) => {
    setCustomAddress({
      ...customAddress,
      [field]: value,
    });
  };

  const submitCancellation = () => {
    onRequestCancellation(box.id, {
      source: boxIsStored ? shippingAddressSource : null,
      address: shippingAddressSource === "custom" ? customAddress : null,
    });
  };

  return (
    <div style={styles.subPanel}>
      <h4>Cancel Subscription</h4>

      <p style={styles.smallText}>
        Your storage subscription is ${monthlyRate}/month after the one-time
        setup fee. You can request cancellation anytime, but your subscription
        remains active through your 6-month minimum term.
      </p>

      <p style={styles.smallText}>
        Your one-time setup fee includes the purchase of your bin. You do not
        need to return the bin to cancel your subscription.
      </p>

      {boxIsStored && (
        <p style={styles.warningText}>
          If your bin is still in storage when your subscription ends, we’ll
          automatically bill your card on file for shipping and send it to your
          selected address. If billing fails, the bin will not ship until payment
          is resolved.
        </p>
      )}

      {cancellationRequested && (
        <p style={styles.warningText}>
          Cancellation requested and waiting for admin review.
          {subscriptionEndDate
            ? ` Your subscription is scheduled to end on ${subscriptionEndDate}.`
            : " Your subscription will end after your 6-month minimum term."}
        </p>
      )}

      {cancellationApproved && (
        <p style={styles.successText}>
          Cancellation approved.
          {subscriptionEndDate
            ? ` Your subscription ends on ${subscriptionEndDate}.`
            : ""}
        </p>
      )}

      {cancellationRejected && (
        <p style={styles.warningText}>
          Your previous cancellation request was rejected. You may submit a new
          cancellation request.
        </p>
      )}

      {boxIsStored && (
        <div style={styles.panel}>
          <h4>Your bin is currently stored</h4>

          <p style={styles.smallText}>
            Choose where we should ship your bin if it is still in storage when
            your subscription ends.
          </p>

          <label style={styles.smallText}>
            <input
              type="radio"
              name={`shipping-address-${box.id}`}
              value="profile"
              checked={shippingAddressSource === "profile"}
              onChange={() => setShippingAddressSource("profile")}
              disabled={cancellationLocked}
            />{" "}
            Ship to my address on file
          </label>

          <br />

          <label style={styles.smallText}>
            <input
              type="radio"
              name={`shipping-address-${box.id}`}
              value="custom"
              checked={shippingAddressSource === "custom"}
              onChange={() => setShippingAddressSource("custom")}
              disabled={cancellationLocked}
            />{" "}
            Ship to a different address
          </label>

          {shippingAddressSource === "custom" && (
            <div style={{ marginTop: "12px" }}>
              <input
                style={styles.input}
                placeholder="Full name"
                value={customAddress.full_name}
                onChange={(event) =>
                  updateCustomAddress("full_name", event.target.value)
                }
                disabled={cancellationLocked}
              />

              <input
                style={styles.input}
                placeholder="Email"
                value={customAddress.email}
                onChange={(event) =>
                  updateCustomAddress("email", event.target.value)
                }
                disabled={cancellationLocked}
              />

              <input
                style={styles.input}
                placeholder="Address line 1"
                value={customAddress.address_line1}
                onChange={(event) =>
                  updateCustomAddress("address_line1", event.target.value)
                }
                disabled={cancellationLocked}
              />

              <input
                style={styles.input}
                placeholder="Address line 2"
                value={customAddress.address_line2}
                onChange={(event) =>
                  updateCustomAddress("address_line2", event.target.value)
                }
                disabled={cancellationLocked}
              />

              <input
                style={styles.input}
                placeholder="City"
                value={customAddress.city}
                onChange={(event) =>
                  updateCustomAddress("city", event.target.value)
                }
                disabled={cancellationLocked}
              />

              <input
                style={styles.input}
                placeholder="State"
                value={customAddress.state}
                onChange={(event) =>
                  updateCustomAddress("state", event.target.value)
                }
                disabled={cancellationLocked}
              />

              <input
                style={styles.input}
                placeholder="ZIP"
                value={customAddress.zip}
                onChange={(event) =>
                  updateCustomAddress("zip", event.target.value)
                }
                disabled={cancellationLocked}
              />
            </div>
          )}

          <button
            style={styles.dangerButton}
            onClick={submitCancellation}
            disabled={cancellationLocked}
          >
            {cancellationRequested
              ? "Cancellation Requested"
              : cancellationApproved
              ? "Cancellation Approved"
              : "Request Cancellation"}
          </button>
        </div>
      )}

      {boxIsWithCustomer && (
        <div style={styles.panel}>
          <h4>Your bin is currently with you</h4>

          <p style={styles.smallText}>
            Since your setup fee includes your bin purchase, you can keep the
            bin after cancellation. Your subscription will stop after your
            6-month minimum term or current subscription period.
          </p>

          <button
            style={styles.dangerButton}
            onClick={submitCancellation}
            disabled={cancellationLocked}
          >
            {cancellationRequested
              ? "Cancellation Requested"
              : cancellationApproved
              ? "Cancellation Approved"
              : "Request Cancellation"}
          </button>
        </div>
      )}

      {boxIsInTransit && (
        <p style={styles.warningText}>
          This subscription cannot be cancelled while your bin is in transit.
          Once your bin arrives, you’ll be able to request cancellation.
        </p>
      )}

      {!boxIsStored && !boxIsWithCustomer && !boxIsInTransit && (
        <p style={styles.warningText}>
          This subscription cannot be cancelled from this status yet.
        </p>
      )}

      <div style={{ marginTop: "12px" }}>
        <button style={styles.secondaryButton} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

export default CancelSubscriptionPanel;
