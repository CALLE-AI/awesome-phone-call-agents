/**
 * Vertex / Gemini transcription for T3.3 voice.
 * Credentials and the generateContent call live in the shared Vertex client.
 */
import {
  extractCandidateText,
  vertexGenerate,
  type VertexGenerateDeps,
} from "../_shared/vertex.ts";
import { type TranscribeVoice } from "./voice.ts";

export type VertexTranscriberDeps = VertexGenerateDeps;

export function createVertexTranscriber(deps: VertexTranscriberDeps): TranscribeVoice {
  return async (audio, mimeType) => {
    const parsed = await vertexGenerate(deps, {
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Transcribe the spoken words only. Do not add commentary. If the audio is unintelligible, reply with an empty string.",
            },
            {
              inlineData: {
                mimeType,
                data: bytesToBase64(audio),
              },
            },
          ],
        },
      ],
    });
    return extractCandidateText(parsed);
  };
}

export function vertexTranscriberFromEnv(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
  fetchImpl: typeof fetch = fetch,
): TranscribeVoice {
  return createVertexTranscriber({
    project: requireNamedEnv("GOOGLE_VERTEX_PROJECT", getEnv),
    location: requireNamedEnv("GOOGLE_VERTEX_LOCATION", getEnv),
    model: requireNamedEnv("GEMINI_MODEL", getEnv),
    credentialsJson: requireNamedEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", getEnv),
    fetch: fetchImpl,
  });
}

function requireNamedEnv(
  name: string,
  getEnv: (key: string) => string | undefined,
): string {
  const value = getEnv(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export { testServiceAccountJson } from "../_shared/vertex.ts";
