import { useMemo } from "react";
import ShippingSafetyNotice from "./ShippingSafetyNotice";
import styles from "../styles/styles";
import { BILLING_CYCLES, ANNUAL_PREPAY_BILLED_MONTHS, getPlanBillingSummary, NO_STARTUP_FEE_LABEL } from "../config/subscriptionPlans";
import { FULL_BIN_OVERWEIGHT_NOTICE, RETURN_EMPTY_BUNDLE_MAX_BINS } from "../config/shippingPackages";
import { fedexOptionDetailParts, filterFedexCartGroundOptions } from "../utils/fedexDisplayHelpers";
import {
  buildCartDisplayBinNumberByBoxId,
  formatInitialPurchaseGroupBinLabels,
  getCartDisplayBinLabel,
} from "../utils/cartBinDisplay";

const addressKeyForBundle = (address) => {
  if (!address) return "";
  return [
    String(address.address_line1 || "")
      .toLowerCase()
      .trim(),
    String(address.city || "")
      .toLowerCase()
      .trim(),
    String(address.state || "")
      .toUpperCase()
      .trim(),
    String(address.zip || "").trim(),
  ].join("|");
};

const shippingLineKeySingle = (box) => `box:${box.id}`;
/** Must match `shippingLineKeyForGroupBoxes` in `quote-cart-shipping` / `fedexShippingRates`. */
const shippingLineKeyForGroup = (groupBoxes) =>
  groupBoxes.length === 1
    ? `box:${groupBoxes[0].id}`
    : `bundle:${groupBoxes.map((b) => b.id).sort().join("-")}`;

const lineStyle = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: "12px 20px",
  alignItems: "baseline",
  padding: "6px 0",
  textAlign: "left",
};

const cartBlockStyle = {
  textAlign: "left",
};

const cartLineItemsStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const cartDividerStyle = {
  borderTop: "1px solid #E5E5E5",
  margin: "8px 0 4px",
};

const cartRemoveRowStyle = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: "12px",
};

function CartMoneyRow({ label, amount, detail, strong = false }) {
  return (
    <div style={lineStyle}>
      <div style={{ minWidth: 0 }}>
        <span
          style={{
            fontSize: strong ? "15px" : "14px",
            fontWeight: strong ? 700 : 500,
            color: "#333333",
            lineHeight: 1.35,
          }}
        >
          {label}
        </span>
        {detail ? (
          <span
            style={{
              display: "block",
              fontSize: "12px",
              color: "#666666",
              marginTop: "3px",
              lineHeight: 1.45,
            }}
          >
            {detail}
          </span>
        ) : null}
      </div>
      <span
        style={{
          fontSize: strong ? "15px" : "14px",
          fontWeight: strong ? 700 : 600,
          color: "#333333",
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {amount}
      </span>
    </div>
  );
}

function Cart({
  cartBoxes,
  grandTotal,
  /** Added to cart total when breaking minimum term while the bin is in storage (paid with shipping in one checkout). */
  earlyTerminationCartFeeUsd = 0,
  monthlyRate,
  setupFee,
  initialPurchaseBillingByGroup = {},
  shippingQuotes = { loading: false, lines: [], error: null },
  refreshShippingQuotes,
  shippingSelections = {},
  setShippingSelections,
  onRemoveFromCart,
  onCheckout,
  checkoutBusy = false,
}) {
  const formatAddress = (address) => {
    if (!address) return "";

    return [
      address.address_line1,
      address.address_line2,
      [address.city, address.state, address.zip].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join(", ");
  };

  const formatMoney = (amount) => `$${Number(amount || 0).toFixed(2)}`;

  const cartDisplayBinByBoxId = useMemo(
    () => buildCartDisplayBinNumberByBoxId(cartBoxes),
    [cartBoxes],
  );

  const displayBinNumberOnly = (box) => getCartDisplayBinLabel(box, cartDisplayBinByBoxId);

  const displayBinName = (box) =>
    box.customer_bin_name && String(box.customer_bin_name).trim()
      ? String(box.customer_bin_name).trim()
      : "Unnamed bin";

  const quoteByLineKey = useMemo(() => {
    const m = new Map();
    for (const line of shippingQuotes?.lines || []) {
      if (line?.lineKey) m.set(line.lineKey, line);
    }
    return m;
  }, [shippingQuotes?.lines]);

  /** Match cart UI row to `quote-cart-shipping` line (handles any `lineKey` / id string drift). */
  const findQuoteLineForSingleBox = (box) => {
    const key = shippingLineKeySingle(box);
    const fromMap = quoteByLineKey.get(key);
    if (fromMap) return { lineKey: key, row: fromMap };
    const id = String(box.id);
    for (const line of shippingQuotes?.lines || []) {
      if (line?.lineKey && Array.isArray(line.boxIds) && line.boxIds.some((bid) => String(bid) === id)) {
        return { lineKey: line.lineKey, row: line };
      }
    }
    return { lineKey: key, row: undefined };
  };

  const findQuoteLineForBundle = (bundle) => {
    const key = shippingLineKeyForGroup(bundle);
    const fromMap = quoteByLineKey.get(key);
    if (fromMap) return { lineKey: key, row: fromMap };
    const idSet = new Set(bundle.map((b) => String(b.id)));
    const want = idSet.size;
    for (const line of shippingQuotes?.lines || []) {
      if (!line?.boxIds?.length) continue;
      const bids = line.boxIds.map((x) => String(x));
      if (bids.length !== want) continue;
      if (bids.every((bid) => idSet.has(bid))) {
        return { lineKey: line.lineKey, row: line };
      }
    }
    return { lineKey: key, row: undefined };
  };

  /** Priced FedEx rows for UI; fall back to summary fields if `fedexOptions` missing (older responses / edge cases). */
  const fedexOptionsList = (row) => {
    if (!row || row.error) return [];
    const raw = row.fedexOptions;
    if (Array.isArray(raw) && raw.length > 0) return raw;
    if (
      typeof row.amountUsd === "number" &&
      Number.isFinite(row.amountUsd) &&
      row.fedexServiceType
    ) {
      return [
        {
          serviceType: row.fedexServiceType,
          serviceName: row.fedexServiceName || row.fedexServiceType,
          amountUsd: row.amountUsd,
          estimatedDeliveryDate: row.fedexEstimatedDeliveryDate ?? null,
          estimatedDeliveryWeekday: null,
          transitTimeRaw: null,
          deliverySummary: row.fedexDeliverySummary ?? null,
        },
      ];
    }
    return [];
  };

  const fedExLineError = (lineKey) => {
    const row = quoteByLineKey.get(lineKey);
    if (!row?.error) return null;
    return row.error.length > 140 ? `${row.error.slice(0, 140)}…` : row.error;
  };

  const fedexCartServiceOptions = (row) => filterFedexCartGroundOptions(fedexOptionsList(row));

  const resolvedFedexServiceType = (lineKey, row) => {
    const opts = fedexCartServiceOptions(row);
    if (!opts.length) return null;
    const pick = shippingSelections[lineKey];
    if (pick && opts.some((o) => o.serviceType === pick)) return pick;
    if (row?.fedexServiceType && opts.some((o) => o.serviceType === row.fedexServiceType)) {
      return row.fedexServiceType;
    }
    return opts[0]?.serviceType ?? null;
  };

  const renderFedexServicePicker = (lineKey, quoteRow) => {
    const legendStyle = {
      fontSize: "13px",
      fontWeight: 600,
      margin: "0 0 10px",
      padding: 0,
      color: "#333333",
    };

    if (shippingQuotes?.loading && !quoteRow) {
      return (
        <div>
          <div style={legendStyle}>Shipping method</div>
          <p style={{ ...styles.smallText, color: "#666", margin: 0 }}>Fetching FedEx rates…</p>
        </div>
      );
    }

    if (!quoteRow && !shippingQuotes?.loading) {
      return (
        <div>
          <div style={legendStyle}>Shipping method</div>
          <p style={{ ...styles.smallText, color: "#666", margin: 0 }}>
            No shipping quote matched this cart line yet. Refresh the page or wait for rates to finish loading.
          </p>
        </div>
      );
    }

    if (quoteRow?.error) {
      const msg =
        quoteRow.error.length > 220 ? `${quoteRow.error.slice(0, 220)}…` : quoteRow.error;
      return (
        <div>
          <div style={legendStyle}>Shipping method</div>
          <p style={{ ...styles.smallText, color: "#b00020", margin: 0 }}>{msg}</p>
        </div>
      );
    }

    if (shippingQuotes?.loading && quoteRow) {
      return (
        <div>
          <div style={legendStyle}>Shipping method</div>
          <p style={{ ...styles.smallText, color: "#666", margin: 0 }}>Updating FedEx rates…</p>
        </div>
      );
    }

    const rawOpts = fedexOptionsList(quoteRow);
    if (!rawOpts.length) {
      return (
        <div>
          <div style={legendStyle}>Shipping method</div>
          <p style={{ ...styles.smallText, color: "#666", margin: 0 }}>
            No priced FedEx options for this shipment. Check the address or try again shortly.
          </p>
        </div>
      );
    }

    const sorted = fedexCartServiceOptions(quoteRow);
    if (!sorted.length) {
      return (
        <div>
          <div style={legendStyle}>Shipping method</div>
          <p style={{ ...styles.smallText, color: "#666", margin: 0 }}>
            FedEx did not return any priced services for this shipment. Try Refresh FedEx rates or adjust the address.
          </p>
        </div>
      );
    }
    const selectedType = resolvedFedexServiceType(lineKey, quoteRow);
    const groupHeadingId = `ship-method-h-${lineKey.replace(/[^a-zA-Z0-9-]/g, "-")}`;

    return (
      <div role="radiogroup" aria-labelledby={groupHeadingId}>
        <div id={groupHeadingId} style={legendStyle}>
          Shipping method
        </div>
        <div style={styles.cartShippingFedexFrame}>
          {sorted.map((o, idx) => {
            const id = `fedex-${lineKey}-${o.serviceType}`;
            const checked = selectedType === o.serviceType;
            const detailLines = fedexOptionDetailParts(o);
            return (
              <label
                key={o.serviceType}
                htmlFor={id}
                style={{
                  display: "flex",
                  gap: "12px",
                  alignItems: "flex-start",
                  cursor: "pointer",
                  padding: "12px 14px",
                  borderTop: idx === 0 ? "none" : "1px solid #E5E5E5",
                  ...(checked ? styles.cartShippingFedexRowSelected : styles.cartShippingFedexRowIdle),
                }}
              >
                <input
                  id={id}
                  type="radio"
                  name={`fedex-service-${lineKey}`}
                  checked={checked}
                  onChange={() => {
                    if (typeof setShippingSelections !== "function") return;
                    setShippingSelections((prev) => ({
                      ...(typeof prev === "object" && prev ? prev : {}),
                      [lineKey]: o.serviceType,
                    }));
                  }}
                  style={{ marginTop: "4px", flexShrink: 0 }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "#333333", lineHeight: 1.35 }}>
                    {o.cartLabel || o.serviceName || o.serviceType}: {formatMoney(o.amountUsd)}
                  </span>
                  {detailLines.map((line, di) => (
                    <span
                      key={`${o.serviceType}-d-${di}`}
                      style={{
                        display: "block",
                        fontSize: "12px",
                        color: "#555",
                        marginTop: "5px",
                        lineHeight: 1.45,
                      }}
                    >
                      {line}
                    </span>
                  ))}
                </span>
              </label>
            );
          })}
        </div>
        <p
          style={{
            fontSize: "11px",
            color: "#777",
            margin: "8px 0 0",
            lineHeight: 1.45,
          }}
        >
          Delivery dates and transit are FedEx estimates when quoted, not guaranteed.
        </p>
      </div>
    );
  };

  const initialPurchaseGroups = Object.values(
    cartBoxes
      .filter((box) => box.cart_type === "initial_purchase")
      .reduce((groups, box) => {
        const groupId = box.subscription_group_id || box.id;

        if (!groups[groupId]) {
          const billingCycle =
            initialPurchaseBillingByGroup[groupId] || BILLING_CYCLES.MONTHLY;
          const setupFeeAmount = Number(box.plan_setup_fee ?? setupFee);
          const monthlyRateAmount = Number(box.plan_monthly_rate ?? monthlyRate);
          const billingSummary = getPlanBillingSummary(
            { setupFee: setupFeeAmount, monthlyRate: monthlyRateAmount },
            billingCycle
          );
          groups[groupId] = {
            groupId,
            boxes: [],
            planName: box.subscription_plan_name || "1 Bin",
            setupFee: setupFeeAmount,
            monthlyRate: monthlyRateAmount,
            binCount: Number(box.plan_bin_count || 1),
            billingCycle,
            dueToday: Number(billingSummary.dueToday || 0),
          };
        }

        groups[groupId].boxes.push(box);
        return groups;
      }, {})
  );

  const shippingBoxes = cartBoxes.filter(
    (box) =>
      box.cart_type === "ship_to_customer" ||
      box.cart_type === "return_to_storage"
  );

  const shipToCustomerRows = cartBoxes.filter((b) => b.cart_type === "ship_to_customer");

  const returnFullRows = cartBoxes.filter(
    (b) => b.cart_type === "return_to_storage" && !b.return_shipment_empty
  );

  const returnEmptyBoxes = cartBoxes.filter(
    (b) => b.cart_type === "return_to_storage" && b.return_shipment_empty
  );

  const returnEmptyBundleRows = (() => {
    const byAddr = new Map();
    for (const b of returnEmptyBoxes) {
      const k = addressKeyForBundle(b.requested_shipping_address);
      if (!byAddr.has(k)) byAddr.set(k, []);
      byAddr.get(k).push(b);
    }
    const rows = [];
    for (const list of byAddr.values()) {
      const sorted = [...list].sort((a, b) =>
        String(a.box_number || a.id).localeCompare(String(b.box_number || b.id), undefined, {
          numeric: true,
        })
      );
      for (let i = 0; i < sorted.length; i += RETURN_EMPTY_BUNDLE_MAX_BINS) {
        rows.push(sorted.slice(i, i + RETURN_EMPTY_BUNDLE_MAX_BINS));
      }
    }
    return rows;
  })();

  const reactivationBoxes = cartBoxes.filter(
    (box) => box.cart_type === "reactivate_subscription"
  );

  const getShippingDetails = (box) => {
    const binNumber = displayBinNumberOnly(box);
    const binName = displayBinName(box);

    if (box.cart_type === "ship_to_customer") {
      return {
        binNumber,
        binName,
        flowLabel: "Ship bin to you",
        note: FULL_BIN_OVERWEIGHT_NOTICE,
        addressLabel: `Destination${
          box.requested_shipping_address_source
            ? ` (${box.requested_shipping_address_source})`
            : ""
        }`,
        addressText:
          formatAddress(box.requested_shipping_address) || "Selected address",
      };
    }

    if (box.return_shipment_empty) {
      return {
        binNumber,
        binName,
        flowLabel: "Return empty flat bin to storage",
        note: "One prepaid label; pack flat bins together as instructed.",
        addressLabel: `Ship-from${
          box.requested_shipping_address_source
            ? ` (${box.requested_shipping_address_source})`
            : ""
        }`,
        addressText:
          formatAddress(box.requested_shipping_address) || "Selected ship-from address",
      };
    }

    return {
      binNumber,
      binName,
      flowLabel: "Return full bin to storage",
      note: FULL_BIN_OVERWEIGHT_NOTICE,
      addressLabel: `Ship-from${
        box.requested_shipping_address_source
          ? ` (${box.requested_shipping_address_source})`
          : ""
      }`,
      addressText:
        formatAddress(box.requested_shipping_address) || "Selected ship-from address",
    };
  };

  const getEmptyBundleDetails = (bundle) => {
    const primary = bundle[0];
    const nums = bundle.map((b) => displayBinNumberOnly(b)).join(" · ");
    const namesJoined = bundle.map((b) => displayBinName(b)).join(" · ");
    return {
      binNumber: nums,
      binName: bundle.length === 1 ? displayBinName(bundle[0]) : namesJoined,
      flowLabel: "Return empty flat bins (one label)",
      note: "Ship-from address must match for all bins on this label.",
      addressLabel: `Ship-from${
        primary.requested_shipping_address_source
          ? ` (${primary.requested_shipping_address_source})`
          : ""
      }`,
      addressText:
        formatAddress(primary.requested_shipping_address) || "Selected ship-from address",
    };
  };

  const renderShippingLineDetails = (lineKey, details, quoteRow, children = null) => {
    const errLine = quoteRow?.error
      ? quoteRow.error.length > 140
        ? `${quoteRow.error.slice(0, 140)}…`
        : quoteRow.error
      : fedExLineError(lineKey);
    return (
      <>
        <div style={styles.cartShippingBinBand}>
          <p style={styles.cartShippingBinTitleLine}>
            <span style={styles.cartShippingBinNumber}>Bin {details.binNumber}</span>
            <span style={{ color: "#555", fontWeight: 500 }}> · </span>
            <span style={styles.cartShippingBinName}>{details.binName}</span>
          </p>
          <p style={styles.cartShippingFlowLabel}>{details.flowLabel}</p>
        </div>
        <div style={styles.cartShippingInner}>
          {details.note ? <p style={styles.cartShippingNote}>{details.note}</p> : null}
          <div style={styles.cartShippingAddrBlock}>
            <div style={styles.cartShippingAddrLabel}>{details.addressLabel}</div>
            <div style={styles.cartShippingAddrText}>{details.addressText}</div>
          </div>
          {errLine ? (
            <p style={{ ...styles.smallText, margin: 0, color: "#b00020" }}>{errLine}</p>
          ) : null}
          {children}
        </div>
      </>
    );
  };

  return (
    <div style={{ ...styles.cartCard, ...cartBlockStyle }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: "16px",
          alignItems: "start",
        }}
      >
        <div>
          <h2 style={{ ...styles.sectionTitle, textAlign: "left" }}>Cart</h2>
          <p style={{ ...styles.mutedText, textAlign: "left" }}>
            {cartBoxes.length === 0
              ? "Your cart is empty."
              : `${cartBoxes.length} bin${cartBoxes.length === 1 ? "" : "s"} in cart`}
          </p>
        </div>

        {cartBoxes.length > 0 && (
          <div style={{ textAlign: "right" }}>
            <p style={styles.smallText}>Cart total</p>
            {earlyTerminationCartFeeUsd > 0 && (
              <p style={{ ...styles.smallText, margin: "0 0 4px", color: "#555", lineHeight: 1.4 }}>
                Includes {formatMoney(earlyTerminationCartFeeUsd)} early termination fee + FedEx shipping below.
              </p>
            )}
            <p style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "#333333" }}>
              {formatMoney(grandTotal)}
            </p>
          </div>
        )}
      </div>

      {cartBoxes.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          {shippingBoxes.length > 0 ? <ShippingSafetyNotice /> : null}
          {earlyTerminationCartFeeUsd > 0 && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px 14px",
                borderRadius: "8px",
                border: "1px solid rgba(184, 207, 184, 0.9)",
                backgroundColor: "rgba(143, 175, 143, 0.12)",
              }}
            >
              <p style={{ ...styles.smallText, margin: 0, lineHeight: 1.5 }}>
                <strong>Early termination</strong> — Choose a FedEx service for this shipment. Stripe checkout will
                charge the termination fee ({formatMoney(earlyTerminationCartFeeUsd)}) and your selected shipping in
                one payment.
              </p>
            </div>
          )}
          {shippingBoxes.length > 0 && typeof refreshShippingQuotes === "function" && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "14px" }}>
              <button
                type="button"
                style={{
                  ...styles.secondaryButton,
                  padding: "6px 12px",
                  fontSize: "13px",
                  opacity: shippingQuotes?.loading ? 0.6 : 1,
                }}
                disabled={Boolean(shippingQuotes?.loading)}
                onClick={() => refreshShippingQuotes()}
              >
                Refresh FedEx rates
              </button>
            </div>
          )}
          {shippingQuotes?.error && shippingBoxes.length > 0 && (
            <p style={{ ...styles.smallText, marginBottom: "12px", color: "#b00020" }}>
              {shippingQuotes.error}
            </p>
          )}
          {initialPurchaseGroups.map((group) => {
            const amount = Number(group.dueToday ?? group.setupFee + group.monthlyRate);
            const isAnnual = group.billingCycle === BILLING_CYCLES.ANNUAL;
            const annualStorageDue = group.monthlyRate * ANNUAL_PREPAY_BILLED_MONTHS;
            const binLabels = formatInitialPurchaseGroupBinLabels(group.boxes, cartDisplayBinByBoxId);

            return (
              <div key={group.groupId} style={{ ...styles.cartItem, ...cartBlockStyle, marginBottom: "14px" }}>
                <div style={cartLineItemsStyle}>
                  <CartMoneyRow
                    label={`${group.planName} subscription`}
                    amount={isAnnual ? `${formatMoney(annualStorageDue)}/year` : `${formatMoney(group.monthlyRate)}/mo`}
                    detail={
                      isAnnual
                        ? "11 months due at checkout · 1 month free"
                        : "First month due at checkout"
                    }
                  />
                  <CartMoneyRow
                    label="Startup fee"
                    amount={
                      Number(group.setupFee) === 0
                        ? NO_STARTUP_FEE_LABEL
                        : formatMoney(group.setupFee)
                    }
                    detail={Number(group.setupFee) === 0 ? undefined : "One-time fee"}
                  />
                  <CartMoneyRow label="Empty-bin delivery" amount="Included" />
                  <div style={cartDividerStyle} />
                  <CartMoneyRow label="Due today" amount={formatMoney(amount)} strong />
                  <CartMoneyRow label="Bins in this plan" amount={binLabels} detail={isAnnual ? "Annual billing selected" : "Monthly billing selected"} />
                </div>
                <div style={cartRemoveRowStyle}>
                  <button
                    type="button"
                    style={styles.warningButton}
                    onClick={() => onRemoveFromCart(group.boxes[0]?.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}

          {shipToCustomerRows.map((box) => {
            const details = getShippingDetails(box);
            const { lineKey: quoteLineKey, row: quoteRow } = findQuoteLineForSingleBox(box);
            return (
              <div key={box.id} style={styles.cartShippingLineCard}>
                {renderShippingLineDetails(
                  quoteLineKey,
                  details,
                  quoteRow,
                  <>
                    {renderFedexServicePicker(quoteLineKey, quoteRow)}
                    <div style={styles.cartShippingActions}>
                      <button style={styles.warningButton} onClick={() => onRemoveFromCart(box.id)}>
                        Remove from cart
                      </button>
                    </div>
                  </>,
                )}
              </div>
            );
          })}

          {returnFullRows.map((box) => {
            const details = getShippingDetails(box);
            const { lineKey: quoteLineKey, row: quoteRow } = findQuoteLineForSingleBox(box);
            return (
              <div key={box.id} style={styles.cartShippingLineCard}>
                {renderShippingLineDetails(
                  quoteLineKey,
                  details,
                  quoteRow,
                  <>
                    {renderFedexServicePicker(quoteLineKey, quoteRow)}
                    <div style={styles.cartShippingActions}>
                      <button style={styles.warningButton} onClick={() => onRemoveFromCart(box.id)}>
                        Remove from cart
                      </button>
                    </div>
                  </>,
                )}
              </div>
            );
          })}

          {returnEmptyBundleRows.map((bundle) => {
            const details = getEmptyBundleDetails(bundle);
            const { lineKey: quoteLineKey, row: quoteRow } = findQuoteLineForBundle(bundle);
            return (
              <div key={quoteLineKey} style={styles.cartShippingLineCard}>
                {renderShippingLineDetails(
                  quoteLineKey,
                  details,
                  quoteRow,
                  <>
                    {renderFedexServicePicker(quoteLineKey, quoteRow)}
                    <div style={{ ...styles.cartShippingActions, flexDirection: "column", alignItems: "flex-end" }}>
                      {bundle.map((b) => (
                        <button
                          key={b.id}
                          style={styles.warningButton}
                          onClick={() => onRemoveFromCart(b.id)}
                        >
                          Remove bin {displayBinNumberOnly(b)} from cart
                        </button>
                      ))}
                    </div>
                  </>,
                )}
              </div>
            );
          })}

          {reactivationBoxes.map((box) => {
            const amount = Number(box.price ?? monthlyRate);

            return (
              <div key={box.id} style={{ ...styles.cartItem, ...cartBlockStyle, marginBottom: "14px" }}>
                <div style={cartLineItemsStyle}>
                  <CartMoneyRow
                    label="Reactivate subscription"
                    amount={`${formatMoney(amount)}/mo`}
                    detail={`Bin ${box.box_number || box.id} · Due at checkout`}
                  />
                  <div style={cartDividerStyle} />
                  <CartMoneyRow label="Due today" amount={formatMoney(amount)} strong />
                </div>
                <div style={cartRemoveRowStyle}>
                  <button type="button" style={styles.warningButton} onClick={() => onRemoveFromCart(box.id)}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}

          <div style={{ ...cartDividerStyle, marginTop: "16px", marginBottom: "12px" }} />
          <CartMoneyRow label="Total" amount={formatMoney(grandTotal)} strong />
          <p style={{ ...styles.smallText, margin: "10px 0 0", lineHeight: 1.5, textAlign: "left" }}>
            New subscriptions, shipping moves, and subscription reactivation use Stripe Checkout.
            {earlyTerminationCartFeeUsd > 0
              ? ` Includes ${formatMoney(earlyTerminationCartFeeUsd)} early termination fee plus shipping.`
              : ""}
          </p>

          <button
            type="button"
            style={{
              ...styles.primaryButton,
              marginTop: "16px",
              width: "100%",
              ...(checkoutBusy ? { opacity: 0.85, cursor: "wait" } : {}),
            }}
            onClick={onCheckout}
            disabled={checkoutBusy}
          >
            {checkoutBusy ? "Preparing checkout…" : "Checkout"}
          </button>
        </div>
      )}
    </div>
  );
}

export default Cart;
