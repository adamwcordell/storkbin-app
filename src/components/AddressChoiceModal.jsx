import { useEffect, useMemo, useState } from "react";
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

  const [addressSource, setAddressSource] = useState(
    hasProfileAddress ? "profile" : "custom"
  );

  const [customAddress, setCustomAddress] = useState({
    ...emptyAddress,
    email: userEmail,
  });

  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setAddressSource(hasProfileAddress ? "profile" : "custom");
    setCustomAddress({ ...emptyAddress, email: userEmail });
    setErrorMessage("");
  }, [box?.id, hasProfileAddress, userEmail]);

  const copyProfileToCustom = () => {
    if (!profileAddress) return;

    setCustomAddress({
      full_name: profileAddress.full_name || "",
      email: profileAddress.email || userEmail || "",
      address_line1: profileAddress.address_line1 || "",
      address_line2: profileAddress.address_line2 || "",
      city: profileAddress.city || "",
      state: profileAddress.state || "",
      zip: profileAddress.zip || "",
    });

    setAddressSource("custom");
  };

  const updateCustomAddress = (field, value) => {
    setCustomAddress((currentAddress) => ({
      ...currentAddress,
      [field]: value,
    }));
  };

  const cleanCustomAddress = useMemo(
    () => ({
      full_name: customAddress.full_name.trim(),
      email: customAddress.email.trim() || userEmail || "",
      address_line1: customAddress.address_line1.trim(),
      address_line2: customAddress.address_line2.trim(),
      city: customAddress.city.trim(),
      state: customAddress.state.trim(),
      zip: customAddress.zip.trim(),
    }),
    [customAddress, userEmail]
  );

  const submitAddressChoice = () => {
    if (addressSource === "profile") {
      if (!hasProfileAddress) {
        setErrorMessage("We could not find a complete address on file. Please enter a different address.");
        return;
      }

      onSubmit({ source: "profile", address: profileAddress });
      return;
    }

    if (
      !cleanCustomAddress.address_line1 ||
      !cleanCustomAddress.city ||
      !cleanCustomAddress.state ||
      !cleanCustomAddress.zip
    ) {
      setErrorMessage("Please enter a complete shipping address.");
      return;
    }

    onSubmit({ source: "custom", address: cleanCustomAddress });
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
              onChange={() => setAddressSource("profile")}
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
              onChange={() => setAddressSource("custom")}
            />
            <span>
              <strong>Enter a different address</strong>
              <br />
              <span style={styles.smallText}>{addressRole} details</span>
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
            <div style={formGridStyle}>
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

        {errorMessage && <p style={styles.warningText}>{errorMessage}</p>}

        <div style={modalFooterStyle}>
          <button style={styles.secondaryButton} onClick={onCancel}>
            Cancel
          </button>

          <button style={styles.primaryButton} onClick={submitAddressChoice}>
            Use This Address
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

const formGridStyle = {
  display: "grid",
  gap: "10px",
  marginTop: "12px",
};

export default AddressChoiceModal;
