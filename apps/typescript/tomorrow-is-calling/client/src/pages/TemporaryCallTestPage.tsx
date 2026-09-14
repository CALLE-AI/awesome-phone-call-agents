import { useState, type FormEvent } from "react";
import { createTestCall } from "../services/callEApi";

export function TemporaryCallTestPage() {
  const [name, setName] = useState("Vanessa");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const result = await createTestCall(phone, name);
      setMessage(`Call request accepted. Status: ${result.status}. Call ID: ${result.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to place test call.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#090b0f",
        color: "#f5f7fa",
        padding: "24px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "min(520px, 100%)",
          border: "1px solid #424854",
          padding: "28px",
          background: "#10141b",
        }}
      >
        <p style={{ marginTop: 0, fontFamily: "monospace", opacity: 0.65 }}>
          TEMPORARY CALL-E CONNECTION TEST
        </p>
        <h1 style={{ marginBottom: "8px" }}>Call my phone</h1>
        <p style={{ marginTop: 0, lineHeight: 1.5, opacity: 0.8 }}>
          This bypasses the transport workflow and tests only whether CALL-E can place a real outbound call.
        </p>

        <label style={{ display: "block", marginTop: "24px" }}>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            style={{ display: "block", width: "100%", marginTop: "8px", padding: "12px", boxSizing: "border-box" }}
          />
        </label>

        <label style={{ display: "block", marginTop: "18px" }}>
          Phone number
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+12105551234"
            inputMode="tel"
            required
            style={{ display: "block", width: "100%", marginTop: "8px", padding: "12px", boxSizing: "border-box" }}
          />
        </label>

        <p style={{ fontSize: "0.9rem", opacity: 0.68 }}>
          Use E.164 format: +1 followed by the 10-digit US number. The number must match the allowlist in your .env file.
        </p>

        <button
          type="submit"
          disabled={loading}
          style={{ width: "100%", marginTop: "16px", padding: "14px", cursor: loading ? "wait" : "pointer" }}
        >
          {loading ? "Calling…" : "Place test call"}
        </button>

        {message && <p style={{ marginTop: "20px", lineHeight: 1.5 }}>{message}</p>}
        {error && <p style={{ marginTop: "20px", lineHeight: 1.5 }}>Error: {error}</p>}
      </form>
    </main>
  );
}
