import styles from "../styles/styles";
import { SUPPORT_EMAIL } from "../config/supportContact";

/**
 * @param {{ variant?: "return" | "outbound" }} props
 * - `return` — customer prints/attaches the FedEx label (send back to storage)
 * - `outbound` — warehouse ships to the customer (Send me my bin); no customer label steps
 */
export default function ShippingSafetyNotice({ variant = "return" }) {
  const isOutbound = variant === "outbound";

  return (
    <div
      style={{
        ...styles.subPanel,
        marginBottom: 16,
        borderLeft: "4px solid #1a6bb3",
        background: "#f4f9ff",
      }}
    >
      <h4 style={{ marginTop: 0, marginBottom: 8 }}>
        {isOutbound ? "Before we ship your bin" : "Before you ship"}
      </h4>
      <ul style={{ ...styles.smallText, margin: 0, paddingLeft: "1.2rem", lineHeight: 1.5 }}>
        <li>
          <strong>50 lb maximum</strong> per shipping label (packed contents + bin). Heavier shipments may be refused
          or surcharged by the carrier.
        </li>
        <li>
          <strong>No prohibited items</strong> (hazardous materials, illegal goods, etc.). You are responsible for
          carrier compliance.
        </li>
        {!isOutbound ? (
          <>
            <li>
              <strong>Label must match the correct bin</strong> — only attach a label that StorkBin issued for{" "}
              <em>this</em> bin&apos;s shipment. Wrong-bin labels can delay or lose inventory.
            </li>
            <li>
              If the <strong>label or tracking looks wrong</strong>, do not ship until resolved — email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with your bin number and a short description.
            </li>
          </>
        ) : null}
      </ul>
    </div>
  );
}
