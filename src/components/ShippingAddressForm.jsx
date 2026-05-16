import styles from "../styles/styles";
import {
  isKnownUspsStateCode,
  normalizeUsStateOrProvinceCode,
  US_STATE_SELECT_OPTIONS,
} from "../utils/usStateNormalize.js";
import { formatSuggestedAddressLines } from "../utils/validateShippingAddress.js";

function fieldHint(fieldErrors, field) {
  const msg = fieldErrors?.[field];
  if (!msg) return null;
  return (
    <p style={styles.fieldErrorHint} role="status">
      {msg}
    </p>
  );
}

function inputStyle(fieldErrors, field) {
  const base = { ...styles.input };
  if (fieldErrors?.[field]) {
    return { ...base, ...styles.inputInvalid, marginBottom: "4px" };
  }
  return base;
}

/**
 * U.S. shipping address fields with labels and per-field validation messages.
 * `value`: { full_name, email, address_line1, address_line2, city, state, zip }
 * `fieldErrors`: keys match value fields plus optional `_form` for general issues.
 */
export default function ShippingAddressForm({
  value,
  onFieldChange,
  fieldErrors = {},
  disabled = false,
  suggested = null,
  onApplySuggestion,
  idPrefix = "ship-addr",
  showSuggestion = true,
}) {
  const v = value || {};
  const formErr = fieldErrors?._form;
  const stateCode = normalizeUsStateOrProvinceCode(String(v.state || ""), "US");
  const stateSelectValue = isKnownUspsStateCode(stateCode) ? stateCode : "";

  return (
    <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
      {showSuggestion && suggested && onApplySuggestion && (
        <div style={styles.addressSuggestionPanel}>
          <div style={{ ...styles.smallText, fontWeight: 600, marginBottom: "6px" }}>Suggested address (FedEx)</div>
          <pre
            style={{
              fontFamily: "inherit",
              fontSize: "13px",
              margin: "0 0 10px 0",
              whiteSpace: "pre-wrap",
              color: "#555",
            }}
          >
            {formatSuggestedAddressLines(suggested)}
          </pre>
          <button type="button" style={styles.secondaryButton} onClick={onApplySuggestion} disabled={disabled}>
            Use this address
          </button>
        </div>
      )}

      {formErr && (
        <p style={styles.fieldErrorHint} role="status">
          {formErr}
        </p>
      )}

      <label style={styles.fieldLabel} htmlFor={`${idPrefix}-full_name`}>
        Full name
      </label>
      <input
        id={`${idPrefix}-full_name`}
        style={inputStyle(fieldErrors, "full_name")}
        placeholder="Full name"
        value={v.full_name || ""}
        onChange={(e) => onFieldChange("full_name", e.target.value)}
        disabled={disabled}
        autoComplete="shipping name"
      />
      {fieldHint(fieldErrors, "full_name")}

      <label style={styles.fieldLabel} htmlFor={`${idPrefix}-email`}>
        Email
      </label>
      <input
        id={`${idPrefix}-email`}
        style={inputStyle(fieldErrors, "email")}
        placeholder="Email"
        type="email"
        value={v.email || ""}
        onChange={(e) => onFieldChange("email", e.target.value)}
        disabled={disabled}
        autoComplete="shipping email"
      />
      {fieldHint(fieldErrors, "email")}

      <label style={styles.fieldLabel} htmlFor={`${idPrefix}-line1`}>
        Street address
      </label>
      <input
        id={`${idPrefix}-line1`}
        style={inputStyle(fieldErrors, "address_line1")}
        placeholder="Street address, P.O. box, company name"
        value={v.address_line1 || ""}
        onChange={(e) => onFieldChange("address_line1", e.target.value)}
        disabled={disabled}
        autoComplete="shipping address-line1"
      />
      {fieldHint(fieldErrors, "address_line1")}

      <label style={styles.fieldLabel} htmlFor={`${idPrefix}-line2`}>
        Apt, suite, unit (optional)
      </label>
      <input
        id={`${idPrefix}-line2`}
        style={inputStyle(fieldErrors, "address_line2")}
        placeholder="Apartment, suite, unit, etc."
        value={v.address_line2 || ""}
        onChange={(e) => onFieldChange("address_line2", e.target.value)}
        disabled={disabled}
        autoComplete="shipping address-line2"
      />
      {fieldHint(fieldErrors, "address_line2")}

      <label style={styles.fieldLabel} htmlFor={`${idPrefix}-city`}>
        City
      </label>
      <input
        id={`${idPrefix}-city`}
        style={inputStyle(fieldErrors, "city")}
        placeholder="City"
        value={v.city || ""}
        onChange={(e) => onFieldChange("city", e.target.value)}
        disabled={disabled}
        autoComplete="shipping address-level2"
      />
      {fieldHint(fieldErrors, "city")}

      <label style={styles.fieldLabel} htmlFor={`${idPrefix}-state`}>
        State (2-letter code)
      </label>
      <select
        id={`${idPrefix}-state`}
        style={inputStyle(fieldErrors, "state")}
        value={stateSelectValue}
        onChange={(e) =>
          onFieldChange("state", normalizeUsStateOrProvinceCode(e.target.value, "US"))
        }
        disabled={disabled}
        aria-label="State"
        autoComplete="off"
      >
        {US_STATE_SELECT_OPTIONS.map((opt) => (
          <option key={opt.value || "__none__"} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {fieldHint(fieldErrors, "state")}

      <label style={styles.fieldLabel} htmlFor={`${idPrefix}-zip`}>
        ZIP code
      </label>
      <input
        id={`${idPrefix}-zip`}
        style={inputStyle(fieldErrors, "zip")}
        placeholder="ZIP or ZIP+4"
        value={v.zip || ""}
        onChange={(e) => onFieldChange("zip", e.target.value)}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="shipping postal-code"
        maxLength={10}
      />
      {fieldHint(fieldErrors, "zip")}
    </form>
  );
}
