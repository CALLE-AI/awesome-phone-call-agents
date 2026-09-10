"use client";

import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import { useEffect, useRef, useState } from "react";

import {
  REALTIME_MODEL,
  REALTIME_TRANSPORT,
  SENIOR_PHONE_AI_INSTRUCTIONS,
} from "@/lib/realtime/constants";
import { RealtimeLatencyTracker, type TurnLatency } from "@/lib/realtime/metrics";

type SessionState = "idle" | "authorizing" | "connecting" | "listening" | "speaking" | "ended" | "error";

type CredentialResponse = Readonly<{
  expiresAt: number;
  model: string;
  value: string;
}>;

async function requestCredential(): Promise<CredentialResponse> {
  const response = await fetch("/api/realtime/client-secret", {
    method: "POST",
    cache: "no-store",
  });
  const body = (await response.json()) as CredentialResponse | { error?: string };
  if (!response.ok || !("value" in body)) {
    throw new Error("error" in body && body.error ? body.error : "Session authorization failed");
  }
  return body;
}

export function RealtimeHarness() {
  const sessionRef = useRef<RealtimeSession | null>(null);
  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latencyTrackerRef = useRef(new RealtimeLatencyTracker());
  const [state, setState] = useState<SessionState>("idle");
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [establishmentLatency, setEstablishmentLatency] = useState<number>();
  const [turnLatencies, setTurnLatencies] = useState<TurnLatency[]>([]);
  const [interruptions, setInterruptions] = useState(0);
  const [conversationItems, setConversationItems] = useState(0);
  const [error, setError] = useState<string>();

  const endSession = () => {
    if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
    sessionTimeoutRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    latencyTrackerRef.current.reset();
    setActive(false);
    setMuted(false);
    setState("ended");
  };

  useEffect(() => {
    const close = () => sessionRef.current?.close();
    window.addEventListener("beforeunload", close);
    return () => {
      window.removeEventListener("beforeunload", close);
      if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
      close();
    };
  }, []);

  const startSession = async () => {
    if (active) return;
    const startedAt = performance.now();
    setError(undefined);
    setEstablishmentLatency(undefined);
    setTurnLatencies([]);
    setInterruptions(0);
    setConversationItems(0);
    setState("authorizing");

    try {
      const credential = await requestCredential();
      setState("connecting");

      const agent = new RealtimeAgent({
        name: "Senior Phone AI",
        instructions: SENIOR_PHONE_AI_INSTRUCTIONS,
      });
      const session = new RealtimeSession(agent, {
        model: REALTIME_MODEL,
        transport: REALTIME_TRANSPORT,
        tracingDisabled: true,
        historyStoreAudio: false,
        config: {
          outputModalities: ["audio"],
          audio: {
            input: {
              noiseReduction: { type: "near_field" },
              transcription: { model: "gpt-4o-mini-transcribe" },
              turnDetection: {
                type: "semantic_vad",
                eagerness: "auto",
                createResponse: true,
                interruptResponse: true,
              },
            },
            output: { voice: "marin", speed: 0.95 },
          },
        },
      });
      sessionRef.current = session;
      setActive(true);

      session.on("transport_event", (event) => {
        const measurement = latencyTrackerRef.current.recordTransportEvent(event.type);
        if (measurement) setTurnLatencies((current) => [...current, measurement]);
      });
      session.on("audio_start", () => setState("speaking"));
      session.on("audio_stopped", () => setState("listening"));
      session.on("audio_interrupted", () => {
        setInterruptions((count) => count + 1);
        setState("listening");
      });
      session.on("history_updated", (history) => setConversationItems(history.length));
      session.on("error", () => {
        session.close();
        sessionRef.current = null;
        if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
        sessionTimeoutRef.current = null;
        setActive(false);
        setError("The realtime session reported an error. End it and try again.");
        setState("error");
      });

      await session.connect({ apiKey: credential.value, model: credential.model });
      setEstablishmentLatency(Math.round(performance.now() - startedAt));
      setState("listening");
      sessionTimeoutRef.current = setTimeout(() => {
        session.close();
        sessionRef.current = null;
        setActive(false);
        setMuted(false);
        setState("ended");
        setError("The 15-minute developer session limit was reached.");
      }, 15 * 60 * 1_000);
      session.sendMessage(
        "Begin with a brief disclosure that you are Senior Phone AI, an AI assistant, then invite me to speak.",
      );
    } catch (caught) {
      sessionRef.current?.close();
      sessionRef.current = null;
      setActive(false);
      setError(caught instanceof Error ? caught.message : "The realtime session could not start");
      setState("error");
    }
  };

  const toggleMute = () => {
    const next = !muted;
    sessionRef.current?.mute(next);
    setMuted(next);
  };

  const interrupt = () => {
    sessionRef.current?.interrupt();
    setState("listening");
  };

  return (
    <div className="harness-grid">
      <section className="harness-card" aria-labelledby="session-heading">
        <p className="eyebrow">Developer-only live test</p>
        <h1 id="session-heading">Realtime microphone harness</h1>
        <p>
          Starting a session requests microphone access and can incur OpenAI usage. The operator
          must place the OpenAI key only in the ignored server environment file. No token is entered
          or exposed in this page. Sessions close automatically after 15 minutes.
        </p>

        <div className="controls">
          <button disabled={active} onClick={startSession} type="button">
            Start live session
          </button>
          <button disabled={!active} onClick={toggleMute} type="button">
            {muted ? "Unmute microphone" : "Mute microphone"}
          </button>
          <button disabled={!active} onClick={interrupt} type="button">Stop AI speaking</button>
          <button className="danger" disabled={!active} onClick={endSession} type="button">
            End session
          </button>
        </div>

        <div className="session-state" aria-live="polite">
          <span className={`state-dot state-${state}`} aria-hidden="true" />
          <strong>{state}</strong>
          {muted ? <span>Microphone muted</span> : null}
        </div>
        {error ? <p className="error-message" role="alert">{error}</p> : null}
      </section>

      <aside className="metrics-card" aria-labelledby="metrics-heading">
        <p className="eyebrow">Observed in this browser</p>
        <h2 id="metrics-heading">Session measurements</h2>
        <dl>
          <div><dt>Transport</dt><dd>{REALTIME_TRANSPORT.toUpperCase()}</dd></div>
          <div><dt>Model</dt><dd>{REALTIME_MODEL}</dd></div>
          <div><dt>Establishment</dt><dd>{establishmentLatency === undefined ? "Not measured" : `${establishmentLatency} ms`}</dd></div>
          <div><dt>Conversation items</dt><dd>{conversationItems}</dd></div>
          <div><dt>Interruptions</dt><dd>{interruptions}</dd></div>
        </dl>
        <h3>Speech-stop to first audio</h3>
        {turnLatencies.length === 0 ? (
          <p>No completed measurement yet.</p>
        ) : (
          <ol className="latency-list">
            {turnLatencies.map((measurement) => (
              <li key={`${measurement.turn}-${measurement.measuredAt}`}>
                Turn {measurement.turn}: <strong>{measurement.milliseconds} ms</strong>
              </li>
            ))}
          </ol>
        )}
        <p className="fine-print">
          Measurements are local observations, not service guarantees. This page does not persist
          audio or transcripts.
        </p>
      </aside>
    </div>
  );
}
