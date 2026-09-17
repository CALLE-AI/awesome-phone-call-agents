import "server-only";

import OpenAI from "openai";

import {
  REALTIME_CLIENT_SECRET_TTL_SECONDS,
  REALTIME_MODEL,
  SENIOR_PHONE_AI_INSTRUCTIONS,
} from "./constants";

export type BrowserRealtimeCredential = Readonly<{
  expiresAt: number;
  model: typeof REALTIME_MODEL;
  value: string;
}>;

export async function createBrowserRealtimeCredential(apiKey: string): Promise<BrowserRealtimeCredential> {
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 10_000 });
  const credential = await client.realtime.clientSecrets.create({
    expires_after: {
      anchor: "created_at",
      seconds: REALTIME_CLIENT_SECRET_TTL_SECONDS,
    },
    session: {
      type: "realtime",
      model: REALTIME_MODEL,
      output_modalities: ["audio"],
      instructions: SENIOR_PHONE_AI_INSTRUCTIONS,
      max_output_tokens: 512,
      tracing: null,
      audio: {
        input: {
          noise_reduction: { type: "near_field" },
          transcription: { model: "gpt-4o-mini-transcribe" },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "auto",
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { voice: "marin", speed: 0.95 },
      },
    },
  });

  return {
    expiresAt: credential.expires_at,
    model: REALTIME_MODEL,
    value: credential.value,
  };
}
