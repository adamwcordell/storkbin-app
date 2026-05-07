import { useEffect } from "react";

export default function CheckoutSuccess() {
  useEffect(() => {
    localStorage.removeItem("cart");
  }, []);

  return (
    <div
      style={{
        backgroundColor: "#f7f7f7",
        paddingTop: "40px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          padding: "20px 24px",
          borderRadius: "12px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          maxWidth: "440px",
          width: "100%",
          textAlign: "center"
        }}
      >
        <div style={{
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          backgroundColor: "#e6f4ea",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 8px auto",
          fontSize: "20px",
          color: "#2e7d32"
        }}>
          ✓
        </div>

        <h1 style={{ marginBottom: "6px", fontSize: "20px", color: "#333" }}>
          Order Confirmed
        </h1>

        <p style={{ fontSize: "13px", marginBottom: "6px" }}>
          Thanks for choosing StorkBin!
        </p>

        <p style={{ fontSize: "12.5px", marginBottom: "12px", lineHeight: "1.35" }}>
          Keep an eye on your inbox - we’ll send you a welcome email with everything you need to get started managing your bins.
        </p>

        <a
          href="/"
          style={{
            display: "inline-block",
            backgroundColor: "#111",
            color: "#fff",
            padding: "8px 14px",
            borderRadius: "16px",
            textDecoration: "none",
            fontSize: "12.5px"
          }}
        >
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
