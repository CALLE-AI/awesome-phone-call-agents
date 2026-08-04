import { useState } from "react";
import { Landing } from "./screens/Landing";
import { Configure } from "./screens/Configure";
import { Preview } from "./screens/Preview";
import { Authorize } from "./screens/Authorize";
import { LiveCall } from "./screens/LiveCall";
import { ResultScreen } from "./screens/Result";
import type { RecoveryRequest, RecoveryResult } from "./types";

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

  return (
    <main className="app">
      <header>
        <h1>Agent Gallery</h1>
        <p className="mode-badge">Dry run is the default. No call is placed without explicit authorization.</p>
      </header>
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
