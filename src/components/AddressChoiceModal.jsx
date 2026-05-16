import { useMemo, useState } from "react";
import styles from "../styles/styles";
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

function AddressChoiceModal({
  box,
  mode = "to_customer",
  addressRole = "Recipient",
  profileAddress,
  userEmail = "",
  onCancel,
  onSubmit,
}) {
  const hasProfileAddress = Boolean(
    profileAddress?.address_line1 &&
      profileAddress?.city &&
      profileAddress?.state &&
      profileAddress?.zip
  );

  const [addressSource, setAddressSource] = useState(() =>
    hasProfileAddress ? "profile" : "custom"
  );

  const [customAddress, setCustomAddress] = useState(() => ({
    ...emptyAddress,
    email: userEmail || "",
  }));

  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [suggested, setSuggested] = useState(null);
  const [validationBusy, setValidationBusy] = useState(false);

  const copyProfileToCustom = () => {
    if (!profileAddress) return;

    setCustomAddress({
      full_name: profileAddress.full_name || "",
      email: profileAddress.email || userEmail || "",
      address_line1: profileAddress.address_line1 || "",
      address_line2: profileAddress.address_line2 || "",
      city: profileAddress.city || "",
      state: normalizeUsStateOrProvinceCode(String(profileAddress.state || ""), "US"),
      zip: profileAddress.zip || "",
    });

    setAddressSource("custom");
    setErrorMessage("");
    setFieldErrors({});
    setSuggested(null);
  };

  const updateCustomAddress = (field, value) => {
    setFieldErrors({});
    setSuggested(null);
    setErrorMessage("");
    setCustomAddress((currentAddress) => ({
      ...currentAddress,
      [field]: value,
    }));
  };

  const applyModalSuggestion = () => {
    if (!suggested) return;
    setCustomAddress((c) => ({
      ...c,
      full_name: String(suggested.full_name || c.full_name || ""),
      email: String(suggested.email || c.email || userEmail || ""),
      address_line1: String(suggested.address_line1 || ""),
      address_line2: String(suggested.address_line2 || ""),
      city: String(suggested.city || ""),
      state: normalizeUsStateOrProvinceCode(String(suggested.state || ""), "US"),
      zip: String(suggested.zip || ""),
    }));
    setSuggested(null);
    setFieldErrors({});
    setErrorMessage("Suggestion applied — review and confirm again.");
  };

  const cleanCustomAddress = useMemo(
    () => ({
      full_name: customAddress.full_name.trim(),
      email: customAddress.email.trim() || userEmail || "",
      address_line1: customAddress.address_line1.trim(),
      address_line2: customAddress.address_line2.trim(),
      city: customAddress.city.trim(),
      state: normalizeUsStateOrProvinceCode(customAddress.state.trim(), "US"),
      zip: customAddress.zip.trim().replace(/\s+/g, ""),
    }),
    [customAddress, userEmail]
  );

  const useProfileSuggestionInForm = () => {
    if (!suggested || !profileAddress) return;
    setAddressSource("custom");
    setCustomAddress({
      full_name: profileAddress.full_name || "",
      email: profileAddress.email || userEmail || "",
      address_line1: String(suggested.address_line1 || ""),
      address_line2: String(suggested.address_line2 || ""),
      city: String(suggested.city || ""),
      state: normalizeUsStateOrProvinceCode(String(suggested.state || ""), "US"),
      zip: String(suggested.zip || ""),
    });
    setSuggested(null);
    setFieldErrors({});
    setErrorMessage("Suggestion copied into the form — review and confirm.");
  };

  const submitAddressChoice = async () => {
    setValidationBusy(true);
    setErrorMessage("");
    setFieldErrors({});
    setSuggested(null);

    try {
      if (addressSource === "profile") {
        if (!hasProfileAddress) {
          setErrorMessage("We could not find a complete address on file. Please enter a different address.");
          return;
        }

        const validated = await validateShippingAddress({
          ...profileAddress,
          email: profileAddress.email || userEmail || "",
        });
        if (!validated.ok) {
          setErrorMessage(validated.message);
          setFieldErrors(validated.fieldErrors || {});
          setSuggested(validated.suggested || null);
          return;
        }

        onSubmit({
          source: "profile",
          address: validated.resolved,
        });
        return;
      }

      const validated = await validateShippingAddress(cleanCustomAddress);
      if (!validated.ok) {
        setErrorMessage(validated.message);
        setFieldErrors(validated.fieldErrors || {});
        setSuggested(validated.suggested || null);
        return;
      }

      onSubmit({
        source: "custom",
        address: validated.resolved,
      });
    } catch (err) {
      setErrorMessage(err?.message || "Something went wrong. Please try again.");
    } finally {
      setValidationBusy(false);
    }
  };

  const title =
    mode === "from_customer"
      ? `Choose ship-from address for bin ${box?.id}`
      : `Choose destination address for bin ${box?.id}`;

  const helperText =
    mode === "from_customer"
      ? "Choose the address you will ship this bin from. This address will be saved on the cart item and used to create this shipment at checkout."
      : "Choose where this bin should be shipped. This address will be saved on the cart item and used to create this shipment at checkout.";

  const profileAddressLine = profileAddress
    ? [
        profileAddress.full_name,
        profileAddress.address_line1,
        profileAddress.address_line2,
        [profileAddress.city, profileAddress.state, profileAddress.zip]
          .filter(Boolean)
          .join(", "),
      ]
        .filter(Boolean)
        .join(" · ")
    : "No complete address on file.";

  return (
    <div style={modalOverlayStyle}>
      <div style={modalStyle}>
        <div style={modalHeaderStyle}>
          <div>
            <h3 style={{ margin: 0 }}>{title}</h3>
            <p style={{ ...styles.smallText, marginTop: "6px" }}>{helperText}</p>
          </div>

          <button style={styles.secondaryButton} onClick={onCancel}>
            Close
          </button>
        </div>

        <div style={styles.panel}>
          <label style={radioRowStyle}>
            <input
              type="radio"
              name={`address-source-${box?.id}`}
              value="profile"
              checked={addressSource === "profile"}
              onChange={() => {
                setAddressSource("profile");
                setErrorMessage("");
                setFieldErrors({});
                setSuggested(null);
              }}
              disabled={!hasProfileAddress}
            />
            <span>
              <strong>Use address on file</strong>
              <br />
              <span style={styles.smallText}>{profileAddressLine}</span>
            </span>
          </label>

          {!hasProfileAddress && (
            <p style={styles.warningText}>
              We could not find a complete address on file. Please enter a different address below.
            </p>
          )}
        </div>

        <div style={styles.panel}>
          <label style={radioRowStyle}>
            <input
              type="radio"
              name={`address-source-${box?.id}`}
              value="custom"
              checked={addressSource === "custom"}
              onChange={() => {
                setAddressSource("custom");
                setErrorMessage("");
                setFieldErrors({});
                setSuggested(null);
              }}
            />
            <span>
              <strong>Enter a different address</strong>
              <br />
              <span style={styles.smallText}>{addressRole} details · U.S. addresses only</span>
            </span>
          </label>

          {profileAddress && (
            <button
              style={{ ...styles.secondaryButton, marginTop: "10px" }}
              onClick={copyProfileToCustom}
              type="button"
            >
              Start with address on file
            </button>
          )}

          {addressSource === "custom" && (
            <div style={{ marginTop: "12px" }}>
              <ShippingAddressForm
                value={customAddress}
                onFieldChange={updateCustomAddress}
                fieldErrors={fieldErrors}
                disabled={validationBusy}
                suggested={suggested}
                onApplySuggestion={applyModalSuggestion}
                idPrefix={`addr-modal-${box?.id || "x"}`}
              />
            </div>
          )}
        </div>

        {addressSource === "profile" && errorMessage && (
          <div style={{ marginTop: "12px" }}>
            <p style={styles.warningText}>{errorMessage}</p>
            {suggested && (
              <div style={styles.addressSuggestionPanel}>
                <div style={{ ...styles.smallText, fontWeight: 600, marginBottom: "6px" }}>
                  FedEx suggested a corrected address
                </div>
                <button type="button" style={styles.secondaryButton} onClick={useProfileSuggestionInForm}>
                  Open form with this suggestion
                </button>
              </div>
            )}
          </div>
        )}

        {addressSource === "custom" && errorMessage && (
          <p style={{ ...styles.warningText, marginTop: "10px" }}>{errorMessage}</p>
        )}

        <div style={modalFooterStyle}>
          <button style={styles.secondaryButton} onClick={onCancel} disabled={validationBusy}>
            Cancel
          </button>

          <button style={styles.primaryButton} onClick={submitAddressChoice} disabled={validationBusy}>
            {validationBusy ? "Validating..." : "Use This Address"}
          </button>
        </div>
      </div>
    </div>
  );
}

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  zIndex: 1000,
};

const modalStyle = {
  background: "#fff",
  borderRadius: "16px",
  padding: "20px",
  width: "min(720px, 100%)",
  maxHeight: "90vh",
  overflowY: "auto",
  boxShadow: "0 20px 50px rgba(0, 0, 0, 0.2)",
};

const modalHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "flex-start",
  marginBottom: "16px",
};

const modalFooterStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "12px",
  marginTop: "16px",
};

const radioRowStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "flex-start",
};

export default AddressChoiceModal;
