import { ImageResponse } from "next/og";

export const alt = "AsyncFounders — persistent company memory for distributed teams";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function SignalMark() {
  return <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 92 }}>
    <div style={{ width: 22, height: 38, background: "#050805" }} />
    <div style={{ width: 22, height: 66, background: "#18e36b" }} />
    <div style={{ width: 22, height: 92, background: "#050805" }} />
  </div>;
}

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f7faf7", color: "#050805", padding: "72px 80px", fontFamily: "Arial, sans-serif", position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: "radial-gradient(#bde8ca 1.5px, transparent 1.5px)", backgroundSize: "18px 18px", opacity: .45 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <SignalMark />
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 62, fontWeight: 700, letterSpacing: "-3px" }}>asyncfounders<span style={{ color: "#18e36b" }}>.</span></div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 980 }}>
        <div style={{ display: "flex", color: "#087837", fontSize: 22, fontWeight: 700, letterSpacing: "3px", marginBottom: 22 }}>THE ASYNC COMPANY MIDDLEMAN</div>
        <div style={{ display: "flex", fontSize: 76, lineHeight: .98, fontWeight: 700, letterSpacing: "-4px" }}>Talk once. The company remembers.</div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 27, color: "#526057" }}>Source-backed team memory, delivered through consented AI callbacks.</div>
      </div>
      <div style={{ position: "absolute", right: 0, bottom: 0, width: 250, height: 18, background: "#18e36b" }} />
    </div>,
    size,
  );
}
