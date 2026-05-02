import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import styles from "../styles/styles";
import { supabase } from "../supabaseClient";
import CancelSubscriptionPanel from "../components/CancelSubscriptionPanel";

const emptyAddressForm = {
  full_name: "",
  email: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  zip: "",
};

function AccountPage({ appData }) {
  const location = useLocation();
  const showPaymentFocus = new URLSearchParams(location.search).get("payment") === "1";
  const [activeCancellationBoxId, setActiveCancellationBoxId] = useState(null);
  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [addressForm, setAddressForm] = useState(emptyAddressForm);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressMessage, setAddressMessage] = useState("");
  const [dismissedReactivationBoxIds, setDismissedReactivationBoxIds] = useState([]);

  const boxes = appData.boxes || [];
  const shipments = appData.shipments || [];
  const monthlyRate = Number(appData.MONTHLY_RATE || 0);
  const finalShippingRate = Number(appData.DEFAULT_SHIPPING_COST || 0);

  const missedPaymentItems = getMissedPaymentItems(boxes, shipments, {
    monthlyRate,
    finalShippingRate,
  });
  const reactivationItems = getReactivationItems(boxes).filter(
    (item) =>
      !item.box.reactivation_dismissed_at &&
      !dismissedReactivationBoxIds.includes(item.box.id)
  );
  const subscriptionBoxes = getSubscriptionBoxes(boxes);
  const totalDue = missedPaymentItems.reduce((sum, item) => sum + item.amount, 0);

  useEffect(() => {
    let isMounted = true;

    async function loadAddress() {
      if (!appData.user?.id) return;

      setAddressLoading(true);
      setAddressMessage("");

      const { data, error } = await supabase
        .from("profiles")
        .select("full_name,email,address_line1,address_line2,city,state,zip")
        .eq("id", appData.user.id)
        .maybeSingle();

      if (!isMounted) return;

      if (error) {
        setAddressMessage("We could not load your address on file.");
      } else {
        setAddressForm({
          full_name: data?.full_name || "",
          email: data?.email || appData.user.email || "",
          address_line1: data?.address_line1 || "",
          address_line2: data?.address_line2 || "",
          city: data?.city || "",
          state: data?.state || "",
          zip: data?.zip || "",
        });
      }

      setAddressLoading(false);
    }

    loadAddress();

    return () => {
      isMounted = false;
    };
  }, [appData.user?.id, appData.user?.email]);

  const makePayment = () => {
    if (appData.payAllFailedPayments) {
      appData.payAllFailedPayments();
      return;
    }

    if (missedPaymentItems[0]?.box?.id && appData.payShipping) {
      appData.payShipping(missedPaymentItems[0].box.id);
    }
  };

  const dismissReactivation = async (boxId) => {
    setDismissedReactivationBoxIds((currentIds) => (
      currentIds.includes(boxId) ? currentIds : [...currentIds, boxId]
    ));

    const { error } = await supabase
      .from("boxes")
      .update({ reactivation_dismissed_at: new Date().toISOString() })
      .eq("id", boxId)
      .eq("user_id", appData.user.id);

    if (error) {
      console.error("Could not dismiss reactivation prompt:", error.message);
      alert("We could not hide this reactivation notice. Please try again.");

      setDismissedReactivationBoxIds((currentIds) =>
        currentIds.filter((currentId) => currentId !== boxId)
      );
    }
  };

  const updateAddressField = (field, value) => {
    setAddressForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const saveAddress = async () => {
    const cleanAddress = {
      full_name: addressForm.full_name.trim(),
      email: addressForm.email.trim() || appData.user.email || "",
      address_line1: addressForm.address_line1.trim(),
      address_line2: addressForm.address_line2.trim(),
      city: addressForm.city.trim(),
      state: addressForm.state.trim(),
      zip: addressForm.zip.trim(),
    };

    if (!cleanAddress.address_line1 || !cleanAddress.city || !cleanAddress.state || !cleanAddress.zip) {
      setAddressMessage("Please enter a complete address before saving.");
      return;
    }

    setAddressSaving(true);
    setAddressMessage("");

    const { error } = await supabase.from("profiles").upsert({
      id: appData.user.id,
      ...cleanAddress,
    });

    if (error) {
      setAddressMessage(error.message);
    } else {
      setAddressMessage("Address saved.");
      setAddressFormOpen(false);
    }

    setAddressSaving(false);
  };

  return (
    <div>
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Account</h2>
        <p style={styles.mutedText}>Logged in as {appData.user.email}</p>
      </div>

      <div style={showPaymentFocus ? missedPaymentFocusPanelStyle : missedPaymentPanelStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h3 style={sectionTitleStyle}>Missed payments</h3>
            <p style={sectionSubtitleStyle}>
              Payments owed to keep active bins and shipments in good standing.
            </p>
          </div>
        </div>

        {missedPaymentItems.length > 0 ? (
          <>
            <div style={invoiceTableStyle}>
              {missedPaymentItems.map((item) => (
                <div key={item.key} style={invoiceRowStyle}>
                  <div style={invoiceDescriptionStyle}>
                    <strong>{item.title}</strong>
                    <div style={invoiceMetaStyle}>{item.detail}</div>
                  </div>

                  <div style={invoiceAmountStyle}>{formatMoney(item.amount)}</div>
                </div>
              ))}

              <div style={totalRowStyle}>
                <div style={totalLabelStyle}>Total due</div>
                <div style={totalAmountStyle}>{formatMoney(totalDue)}</div>
              </div>
            </div>

            <div style={paymentActionRowStyle}>
              <button style={styles.primaryButton} onClick={makePayment}>
                Make Payment
              </button>
            </div>
          </>
        ) : (
          <div style={emptyStateStyle}>No missed payments.</div>
        )}
      </div>

      {reactivationItems.length > 0 && (
        <div style={reactivationPanelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h3 style={sectionTitleStyle}>Reactivate subscription</h3>
              <p style={sectionSubtitleStyle}>
                Optional restart for subscriptions that ended while the bin was still with you.
              </p>
            </div>
          </div>

          <div style={reactivationListStyle}>
            {reactivationItems.map((item) => (
              <div key={item.box.id} style={reactivationCardStyle}>
                <div>
                  <strong>Bin {item.box.box_number || item.box.id}</strong>
                  <div style={invoiceMetaStyle}>
                    Restart this subscription if you want service to continue.
                  </div>
                </div>

                <div style={reactivationActionsStyle}>
                  <button
                    style={styles.secondaryButton}
                    onClick={() =>
                      appData.addSubscriptionReactivationToCart?.(item.box.id, {
                        hasBin: true,
                      })
                    }
                  >
                    Reactivate Bin
                  </button>

                  <button
                    style={styles.secondaryButton}
                    onClick={() => dismissReactivation(item.box.id)}
                  >
                    No thanks
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={accountGridStyle}>
        <div style={styles.panel}>
          <h3 style={sectionTitleStyle}>Billing</h3>
          <div style={settingsListStyle}>
            <div style={settingsRowStyle}>
              <div>
                <strong>Payment method</strong>
                <div style={invoiceMetaStyle}>
                  Manage the card used for subscriptions and shipment charges.
                </div>
              </div>

              <button
                style={styles.secondaryButton}
                onClick={() => appData.openPaymentMethodManager?.()}
                disabled={!appData.openPaymentMethodManager}
                title={!appData.openPaymentMethodManager ? "Stripe payment method management will be connected later." : undefined}
              >
                Manage payment method
              </button>
            </div>

            <div style={settingsRowStyle}>
              <div>
                <strong>Invoices</strong>
                <div style={invoiceMetaStyle}>
                  Receipts and invoice history will appear here once Stripe is connected.
                </div>
              </div>

              <span style={mutedPillStyle}>Coming soon</span>
            </div>
          </div>
        </div>

        <div style={styles.panel}>
          <h3 style={sectionTitleStyle}>Shipping address</h3>
          <div style={settingsListStyle}>
            <div style={settingsRowStyle}>
              <div>
                <strong>Default address</strong>
                <div style={invoiceMetaStyle}>{formatAddress(addressForm)}</div>
              </div>

              <button
                style={styles.secondaryButton}
                onClick={() => setAddressFormOpen((isOpen) => !isOpen)}
                disabled={addressLoading}
              >
                {addressFormOpen ? "Close" : "Manage address"}
              </button>
            </div>

            {addressFormOpen && (
              <div style={addressFormPanelStyle}>
                <div style={addressGridStyle}>
                  <input
                    style={styles.input}
                    placeholder="Full name"
                    value={addressForm.full_name}
                    onChange={(event) => updateAddressField("full_name", event.target.value)}
                  />

                  <input
                    style={styles.input}
                    placeholder="Email"
                    value={addressForm.email}
                    onChange={(event) => updateAddressField("email", event.target.value)}
                  />

                  <input
                    style={styles.input}
                    placeholder="Address line 1"
                    value={addressForm.address_line1}
                    onChange={(event) => updateAddressField("address_line1", event.target.value)}
                  />

                  <input
                    style={styles.input}
                    placeholder="Address line 2"
                    value={addressForm.address_line2}
                    onChange={(event) => updateAddressField("address_line2", event.target.value)}
                  />

                  <input
                    style={styles.input}
                    placeholder="City"
                    value={addressForm.city}
                    onChange={(event) => updateAddressField("city", event.target.value)}
                  />

                  <input
                    style={styles.input}
                    placeholder="State"
                    value={addressForm.state}
                    onChange={(event) => updateAddressField("state", event.target.value)}
                  />

                  <input
                    style={styles.input}
                    placeholder="ZIP"
                    value={addressForm.zip}
                    onChange={(event) => updateAddressField("zip", event.target.value)}
                  />
                </div>

                <div style={formActionRowStyle}>
                  {addressMessage && <span style={addressMessageStyle}>{addressMessage}</span>}
                  <button style={styles.primaryButton} onClick={saveAddress} disabled={addressSaving}>
                    {addressSaving ? "Saving..." : "Save address"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={styles.panel}>
          <h3 style={sectionTitleStyle}>Subscriptions</h3>
          <div style={settingsListStyle}>
            {subscriptionBoxes.length > 0 ? (
              subscriptionBoxes.map((box) => {
                const cancellationIsOpen = activeCancellationBoxId === box.id;
                const hasCancellationStatus = ["requested", "approved", "rejected"].includes(box.cancel_status);

                if (hasCancellationStatus) {
                  return (
                    <div key={box.id} style={subscriptionItemStyle}>
                      <div style={cancellationStatusCardStyle}>
                        <div style={subscriptionInfoStyle}>
                          <strong>Bin {box.box_number || box.id}</strong>
                          {box.customer_bin_name && (
                            <div style={invoiceMetaStyle}>{box.customer_bin_name}</div>
                          )}
                          <div style={cancellationDetailStyle}>{getCancellationStatusDetail(box)}</div>
                        </div>

                        <div style={cancellationPillRowStyle}>
                          <span style={getCancellationPillStyle(box.cancel_status)}>
                            {getCancellationPillText(box.cancel_status)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={box.id} style={subscriptionItemStyle}>
                    {cancellationIsOpen ? (
                      <div style={cancellationCardStyle}>
                        <div style={cancellationCardHeaderStyle}>
                          <div>
                            <strong>Bin {box.box_number || box.id}</strong>
                            {box.customer_bin_name && (
                              <div style={invoiceMetaStyle}>{box.customer_bin_name}</div>
                            )}
                            <div style={invoiceMetaStyle}>{getSubscriptionSummary(box)}</div>
                          </div>
                        </div>

                        <CancelSubscriptionPanel
                          box={box}
                          monthlyRate={monthlyRate}
                          cancellationRequested={false}
                          cancellationApproved={false}
                          cancellationRejected={false}
                          onRequestCancellation={appData.requestCancellation}
                          onBack={() => setActiveCancellationBoxId(null)}
                        />
                      </div>
                    ) : (
                      <div style={settingsRowStyle}>
                        <div style={subscriptionInfoStyle}>
                          <strong>Bin {box.box_number || box.id}</strong>
                          {box.customer_bin_name && (
                            <div style={invoiceMetaStyle}>{box.customer_bin_name}</div>
                          )}
                          <div style={invoiceMetaStyle}>{getSubscriptionSummary(box)}</div>
                        </div>

                        <button
                          style={styles.dangerButton}
                          onClick={() => setActiveCancellationBoxId(box.id)}
                        >
                          Cancel subscription
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div style={emptyStateStyle}>No active subscriptions.</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: "12px" }}>
        <Link style={styles.linkButtonSecondary} to="/bins">
          Back to My Bins
        </Link>
      </div>
    </div>
  );
}

function getMissedPaymentItems(boxes, shipments, rates) {
  return boxes
    .filter((box) => {
      if (box.lifecycle_status === "auction" || box.lifecycle_status === "removed_from_system") {
        return false;
      }

      if (box.subscription_lifecycle_status === "terminated") {
        return false;
      }

      return (
        box.subscription_payment_status === "failed" ||
        box.cancellation_shipping_charge_status === "failed" ||
        box.fulfillment_status === "shipment_payment_failed" ||
        hasFailedShipment(box, shipments)
      );
    })
    .map((box) => {
      if (box.cancellation_shipping_charge_status === "failed") {
        return {
          key: `${box.id}-final-shipping`,
          box,
          title: `Final shipping payment failed · Bin ${box.box_number || box.id}`,
          detail: buildCountdownDetail(box, "auction"),
          amount: rates.finalShippingRate,
        };
      }

      if (box.subscription_payment_status === "failed" && box.status === "at_customer") {
        return {
          key: `${box.id}-customer-subscription`,
          box,
          title: `Monthly payment failed · Bin ${box.box_number || box.id}`,
          detail: buildCountdownDetail(box, "subscription termination"),
          amount: rates.monthlyRate,
        };
      }

      if (box.subscription_payment_status === "failed") {
        return {
          key: `${box.id}-stored-subscription`,
          box,
          title: `Monthly payment failed · Bin ${box.box_number || box.id}`,
          detail: buildCountdownDetail(box, "auction"),
          amount: rates.monthlyRate,
        };
      }

      return {
        key: `${box.id}-shipment`,
        box,
        title: `Shipping payment failed · Bin ${box.box_number || box.id}`,
        detail: buildCountdownDetail(box, "auction"),
        amount: rates.finalShippingRate,
      };
    });
}

function getReactivationItems(boxes) {
  return boxes
    .filter((box) => {
      return (
        box.status === "at_customer" &&
        box.subscription_lifecycle_status === "terminated" &&
        box.lifecycle_status !== "auction" &&
        box.lifecycle_status !== "removed_from_system"
      );
    })
    .map((box) => ({ box }));
}

function getSubscriptionBoxes(boxes) {
  return boxes.filter((box) => {
    return (
      box.checkout_status === "paid" &&
      box.lifecycle_status !== "auction" &&
      box.lifecycle_status !== "removed_from_system" &&
      box.subscription_lifecycle_status !== "terminated"
    );
  });
}

function getSubscriptionSummary(box) {
  if (box.cancel_status === "requested") {
    return "Cancellation requested and waiting for review.";
  }

  if (box.cancel_status === "approved") {
    return box.subscription_ends_at
      ? `Cancellation approved. Ends ${new Date(box.subscription_ends_at).toLocaleDateString()}.`
      : "Cancellation approved.";
  }

  if (box.subscription_payment_status === "failed") {
    return "Payment issue needs attention.";
  }

  return "Active subscription.";
}


function getCancellationPillText(cancelStatus) {
  if (cancelStatus === "approved") {
    return "Cancellation scheduled";
  }

  if (cancelStatus === "rejected") {
    return "Cancellation rejected";
  }

  return "Cancellation pending";
}

function getCancellationStatusDetail(box) {
  if (box.cancel_status === "approved") {
    return box.subscription_ends_at
      ? `Approved. Subscription ends ${new Date(box.subscription_ends_at).toLocaleDateString()}.`
      : "Approved. Subscription end date is being finalized.";
  }

  if (box.cancel_status === "rejected") {
    return "Request was not approved. Contact StorkBin for help.";
  }

  return box.subscription_ends_at
    ? `Request received. Subscription is scheduled to end on ${new Date(box.subscription_ends_at).toLocaleDateString()}.`
    : "Request received and waiting for review.";
}

function hasFailedShipment(box, shipments) {
  return shipments.some((shipment) => {
    if (shipment.charge_status !== "failed") {
      return false;
    }

    return (
      shipment.box_id === box.id ||
      shipment.latest_box_id === box.id ||
      shipment.box_ids?.includes?.(box.id) ||
      shipment.shipment_boxes?.some?.((shipmentBox) => shipmentBox.box_id === box.id)
    );
  });
}

function buildCountdownDetail(box, outcomeLabel) {
  const days = getGraceDaysRemaining(box);

  if (days === null) {
    return `Resolve this payment to avoid ${outcomeLabel}.`;
  }

  if (days <= 0) {
    return "Deadline reached. Contact StorkBin.";
  }

  return `${days} ${days === 1 ? "day" : "days"} until ${outcomeLabel}.`;
}

function getGraceDaysRemaining(box) {
  const deadline = getGraceDeadline(box);

  if (!deadline) {
    return null;
  }

  const deadlineTime = new Date(deadline).getTime();

  if (Number.isNaN(deadlineTime)) {
    return null;
  }

  const now = new Date().getTime();
  const diff = deadlineTime - now;

  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function getGraceDeadline(box) {
  if (box.lifecycle_deadline_at) {
    return box.lifecycle_deadline_at;
  }

  if (box.cancellation_shipping_charge_failed_at) {
    return addDays(box.cancellation_shipping_charge_failed_at, 45);
  }

  if (box.last_payment_failed_at && box.status === "at_customer") {
    return addDays(box.last_payment_failed_at, 30);
  }

  if (box.last_payment_failed_at) {
    return addDays(box.last_payment_failed_at, 60);
  }

  return null;
}

function addDays(dateString, days) {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function formatAddress(address) {
  if (!address?.address_line1 || !address?.city || !address?.state || !address?.zip) {
    return "No complete address on file.";
  }

  return [
    address.full_name,
    address.address_line1,
    address.address_line2,
    [address.city, address.state, address.zip].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatMoney(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

const missedPaymentPanelStyle = {
  ...styles.panel,
  border: "1px solid rgba(216, 140, 122, 0.55)",
  backgroundColor: "rgba(216, 140, 122, 0.08)",
};

const missedPaymentFocusPanelStyle = {
  ...missedPaymentPanelStyle,
  boxShadow: "0 0 0 2px rgba(216, 140, 122, 0.16)",
};

const reactivationPanelStyle = {
  ...styles.panel,
  border: "1px solid rgba(79, 151, 111, 0.45)",
  backgroundColor: "rgba(79, 151, 111, 0.08)",
};

const sectionHeaderStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "16px",
  marginBottom: "16px",
};

const sectionTitleStyle = {
  margin: 0,
  fontSize: "20px",
};

const sectionSubtitleStyle = {
  margin: "6px 0 0 0",
  color: "#666",
  fontSize: "14px",
  lineHeight: 1.4,
};

const invoiceTableStyle = {
  border: "1px solid rgba(0, 0, 0, 0.08)",
  borderRadius: "12px",
  overflow: "hidden",
  backgroundColor: "#FFFFFF",
};

const invoiceRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 120px",
  gap: "16px",
  alignItems: "center",
  padding: "14px 16px",
  borderBottom: "1px solid rgba(0, 0, 0, 0.08)",
};

const invoiceDescriptionStyle = {
  minWidth: 0,
};

const invoiceMetaStyle = {
  marginTop: "4px",
  color: "#666",
  fontSize: "13px",
  lineHeight: 1.35,
};

const invoiceAmountStyle = {
  textAlign: "right",
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
};

const totalRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 120px",
  gap: "16px",
  alignItems: "center",
  padding: "16px",
  backgroundColor: "rgba(0, 0, 0, 0.03)",
};

const totalLabelStyle = {
  textAlign: "right",
  fontWeight: 800,
  textDecoration: "underline",
};

const totalAmountStyle = {
  textAlign: "right",
  fontWeight: 900,
  fontSize: "18px",
  fontVariantNumeric: "tabular-nums",
  textDecoration: "underline",
};

const paymentActionRowStyle = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  marginTop: "14px",
};

const emptyStateStyle = {
  padding: "16px",
  border: "1px dashed rgba(0, 0, 0, 0.16)",
  borderRadius: "12px",
  color: "#666",
  backgroundColor: "#FFFFFF",
};

const reactivationListStyle = {
  display: "grid",
  gap: "12px",
};

const reactivationCardStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "16px",
  alignItems: "center",
  padding: "14px 16px",
  border: "1px solid rgba(79, 151, 111, 0.18)",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
};

const reactivationActionsStyle = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  gap: "8px",
  minWidth: "260px",
};

const accountGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "16px",
  marginTop: "16px",
};

const settingsListStyle = {
  display: "grid",
  gap: "12px",
  marginTop: "14px",
};

const settingsRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "16px",
  alignItems: "center",
  padding: "14px 16px",
  border: "1px solid rgba(0, 0, 0, 0.08)",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
};

const subscriptionItemStyle = {
  display: "grid",
  gap: "10px",
};


const cancellationStatusCardStyle = {
  padding: "16px",
  border: "1px solid rgba(0, 0, 0, 0.08)",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
};

const cancellationDetailStyle = {
  ...invoiceMetaStyle,
  marginTop: "8px",
  maxWidth: "100%",
};

const cancellationPillRowStyle = {
  display: "flex",
  justifyContent: "center",
  marginTop: "12px",
};

const cancellationCardStyle = {
  padding: "14px 16px",
  border: "1px solid rgba(0, 0, 0, 0.08)",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
};

const cancellationCardHeaderStyle = {
  paddingBottom: "12px",
  marginBottom: "12px",
  borderBottom: "1px solid rgba(0, 0, 0, 0.08)",
};


const subscriptionInfoStyle = {
  minWidth: 0,
};

function getCancellationPillStyle(cancelStatus) {
  const baseStyle = {
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    whiteSpace: "nowrap",
    alignSelf: "flex-start",
  };

  if (cancelStatus === "approved") {
    return {
      ...baseStyle,
      backgroundColor: "rgba(216, 140, 122, 0.15)",
      color: "#8A3B2D",
    };
  }

  if (cancelStatus === "rejected") {
    return {
      ...baseStyle,
      backgroundColor: "rgba(0, 0, 0, 0.06)",
      color: "#555",
    };
  }

  return {
    ...baseStyle,
    backgroundColor: "rgba(216, 140, 122, 0.15)",
    color: "#8A3B2D",
  };
}

const addressFormPanelStyle = {
  padding: "14px 16px",
  border: "1px solid rgba(0, 0, 0, 0.08)",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
};

const addressGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "10px",
};

const formActionRowStyle = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: "12px",
  marginTop: "10px",
};

const addressMessageStyle = {
  color: "#666",
  fontSize: "13px",
};

const mutedPillStyle = {
  padding: "6px 10px",
  borderRadius: "999px",
  backgroundColor: "rgba(0, 0, 0, 0.06)",
  color: "#666",
  fontSize: "13px",
  fontWeight: 700,
  whiteSpace: "nowrap",
};

export default AccountPage;
