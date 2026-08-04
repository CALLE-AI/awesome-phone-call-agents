import { useState } from "react";
import { Landing } from "./screens/Landing";
import { Configure } from "./screens/Configure";
import { Preview } from "./screens/Preview";
import { Authorize } from "./screens/Authorize";
import { LiveCall } from "./screens/LiveCall";
import { ResultScreen } from "./screens/Result";
import { Steps } from "./screens/Steps";
import type { RecoveryRequest, RecoveryResult } from "./workflows/appointment-recovery/types";

export type Screen = "landing" | "configure" | "preview" | "authorize" | "live" | "result";

function emptyRequest(): RecoveryRequest {
  return {
    request_key: crypto.randomUUID(),
    business: { name: "", timezone: "", callback_number_e164: "" },
    customer: { given_name: "", phone_e164: "", consent_confirmed: false },
    appointment: { service: "", original_time: "", status: "missed" },
    replacement_windows: [{ start: "", end: "" }],
  };
}

export function App() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [request, setRequest] = useState<RecoveryRequest>(emptyRequest);
  const [callId, setCallId] = useState<string | null>(null);
  const [result, setResult] = useState<RecoveryResult | null>(null);
  // Held for this session only, never persisted, and needed from the
  // authorization gate onward because the polling endpoint is gated too.
  const [accessCode, setAccessCode] = useState("");

  return (
    <main className="app">
      <header className="masthead">
        <h1 className="wordmark">
          Agent Gallery <span>· Appointment Recovery</span>
        </h1>
        {/* The badge states the current mode rather than a slogan, so it stays
            true once the call is live instead of quietly contradicting it. */}
        <p className="mode-badge" data-state={screen === "live" ? "live" : "dry-run"}>
          {screen === "live" ? "Live call in progress" : "Dry run · no call placed"}
        </p>
      </header>
      <Steps current={screen} />
      {screen === "landing" && <Landing onStart={() => setScreen("configure")} />}
      {screen === "configure" && (
        <Configure
          request={request}
          onChange={setRequest}
          onPreview={() => setScreen("preview")}
          onBack={() => setScreen("landing")}
        />
      )}
      {screen === "preview" && (
        <Preview
          request={request}
          onAuthorize={() => setScreen("authorize")}
          onBack={() => setScreen("configure")}
        />
      )}
      {screen === "authorize" && (
        <Authorize
          request={request}
          accessCode={accessCode}
          onAccessCodeChange={setAccessCode}
          onStarted={(id) => {
            setCallId(id);
            setScreen("live");
          }}
          onBack={() => setScreen("preview")}
        />
      )}
      {screen === "live" && callId && (
        <LiveCall
          request={request}
          callId={callId}
          accessCode={accessCode}
          onResult={(r) => {
            setResult(r);
            setScreen("result");
          }}
        />
      )}
      {screen === "result" && result && (
        <ResultScreen
          result={result}
          onRestart={() => {
            setRequest(emptyRequest());
            setCallId(null);
            setResult(null);
            setScreen("landing");
          }}
        />
      )}
    </main>
  );
}
