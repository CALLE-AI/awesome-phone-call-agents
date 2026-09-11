import { ImageResponse } from "next/og";

export const alt = "ReadyLine — CALL-E-powered event load-in readiness";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#f4f3ed",
        color: "#16201a",
        fontFamily: "Arial, sans-serif",
        padding: "58px 64px",
      }}
    >
      <div
        style={{
          width: 112,
          height: "100%",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          borderRadius: 28,
          background: "#16201a",
          color: "white",
          paddingTop: 30,
          fontSize: 52,
          fontWeight: 800,
        }}
      >
        R
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", paddingLeft: 54 }}>
        <div style={{ display: "flex", color: "#17643b", fontSize: 22, fontWeight: 700, letterSpacing: 4 }}>
          CALL-E · EVENT OPERATIONS
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 82, fontWeight: 750, letterSpacing: -4 }}>
          ReadyLine
        </div>
        <div style={{ display: "flex", maxWidth: 810, marginTop: 18, color: "#667068", fontSize: 34, lineHeight: 1.25 }}>
          Turn vendor calls into one conflict-free load-in plan.
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: "auto" }}>
          {["Structured call evidence", "Deterministic checks", "Human approval"].map((label) => (
            <div
              key={label}
              style={{
                display: "flex",
                border: "2px solid #c8cbc1",
                borderRadius: 999,
                background: "#fffefa",
                padding: "13px 19px",
                fontSize: 19,
                fontWeight: 700,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>,
    size,
  );
}
