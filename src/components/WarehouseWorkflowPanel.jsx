import styles from "../styles/styles";

const flowTitles = {
  starter_kit: "Starter kit workflow",
  send_to_customer: "Send bin workflow",
  return_intake: "Return intake workflow",
};

const stepDot = (state) => {
  if (state === "done") {
    return { bg: "#4a6741", border: "#4a6741", mark: "#fff", text: "#2d3b2d" };
  }
  if (state === "current") {
    return { bg: "#e8f0e8", border: "#4a6741", mark: "#2d3b2d", text: "#2d3b2d" };
  }
  return { bg: "#f3f4f6", border: "#d1d5db", mark: "#6b7280", text: "#6b7280" };
};

export default function WarehouseWorkflowPanel({ workflow }) {
  if (!workflow?.steps?.length) return null;

  return (
    <div
      style={{
        marginTop: 8,
        marginBottom: 4,
        padding: "10px 12px",
        borderRadius: 8,
        background: "#f8faf8",
        border: "1px solid #e0e8e0",
      }}
    >
      <p style={{ ...styles.smallText, margin: "0 0 8px", fontWeight: 600, color: "#2d3b2d" }}>
        {flowTitles[workflow.flow] || "Warehouse workflow"}
      </p>
      <ol style={{ margin: 0, paddingLeft: 18, listStyle: "none" }}>
        {workflow.steps.map((s, i) => {
          const dot = stepDot(s.state);
          return (
            <li
              key={s.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                marginBottom: i < workflow.steps.length - 1 ? 6 : 0,
                fontSize: 13,
                color: dot.text,
              }}
            >
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 18,
                  height: 18,
                  marginTop: 1,
                  borderRadius: "50%",
                  background: dot.bg,
                  border: `2px solid ${dot.border}`,
                  color: dot.mark,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {s.state === "done" ? "✓" : i + 1}
              </span>
              <span style={{ lineHeight: 1.35 }}>
                {s.label}
                {s.state === "current" ? (
                  <span style={{ fontWeight: 600, color: "#4a6741" }}> — now</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
