/**
 * A local fake text-to-speech provider.
 *
 * It exists so the tests and the demo exercise the whole path with no
 * credentials, no network beyond loopback and nothing that bills. It returns a
 * real PCM WAV whose length is derived from the text, so the duration this app
 * measures is a genuine measurement of a genuine container rather than a stub.
 *
 * Two routes on purpose, because the descriptor supports two audio locations:
 * `/speak` answers with the bytes in the body, `/speak-json` answers with the
 * same bytes base64 encoded inside a JSON field.
 *
 * Three more exist for the trust boundaries a provider controls at runtime:
 * `/redirect` answers with a Location, `/speak-url` answers with a URL where it
 * claims the audio is and `/audio.wav` serves bytes without asking for the
 * credential, the way a link a provider hands out behaves.
 */

import { createServer, type Server } from "node:http";

/** Bytes per second of the fake audio. 8 kHz mono 16-bit. */
const SAMPLE_RATE = 8000;
const BYTES_PER_SAMPLE = 2;
export const BYTE_RATE = SAMPLE_RATE * BYTES_PER_SAMPLE;

/** Spoken pace the fake pretends to have, used to derive a duration from text. */
export const CHARS_PER_SECOND = 14;

/** Build a valid RIFF/WAVE buffer of the given duration, filled with silence. */
export function wavOfSeconds(seconds: number): Buffer {
  const dataSize = Math.max(BYTE_RATE, Math.round(seconds * BYTE_RATE));
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(BYTE_RATE, 28);
  buf.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

export interface FakeOptions {
  /** Credential the fake insists on, so the auth path is exercised. */
  expectKey: string;
  /** Header the credential must arrive in. */
  authHeader?: string;
  /** Force a status, so a test can drive the failure path. */
  failWith?: number;
  /** Where `/redirect` points. Relative stays on this origin, absolute leaves it. */
  redirectTo?: string;
  /** Status `/redirect` answers with. 302 by default. */
  redirectStatus?: number;
  /** URL `/speak-url` reports as the place the audio is. */
  audioUrl?: string;
}

export interface FakeProvider {
  url: string;
  server: Server;
  /** Every request seen, so a test can assert what was sent. */
  seen: Array<{ method: string; path: string; auth: string | undefined; body: string }>;
  close: () => Promise<void>;
}

export async function startFakeProvider(options: FakeOptions): Promise<FakeProvider> {
  const authHeader = (options.authHeader ?? "x-api-key").toLowerCase();
  const seen: FakeProvider["seen"] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const auth = req.headers[authHeader];
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      seen.push({
        method: req.method ?? "GET",
        path,
        auth: typeof auth === "string" ? auth : undefined,
        body,
      });

      // A link a provider hands out is fetched without the credential, so this
      // route does not ask for one.
      if (path === "/audio.wav") {
        res.writeHead(200, { "content-type": "audio/wav" });
        res.end(wavOfSeconds(1));
        return;
      }
      if (options.failWith !== undefined) {
        res.writeHead(options.failWith, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "forced" }));
        return;
      }
      if (auth !== options.expectKey) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      if (path === "/redirect") {
        res.writeHead(options.redirectStatus ?? 302, {
          location: options.redirectTo ?? "/speak",
        });
        res.end();
        return;
      }
      let text = "";
      try {
        const parsed: unknown = JSON.parse(body || "{}");
        if (parsed !== null && typeof parsed === "object") {
          const t = (parsed as Record<string, unknown>)["text"];
          if (typeof t === "string") text = t;
        }
      } catch {
        text = "";
      }
      const wav = wavOfSeconds(text.length / CHARS_PER_SECOND);
      if (path === "/speak-url") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { url: options.audioUrl ?? "/audio.wav" } }));
        return;
      }
      if (path === "/speak-json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ result: { audio: wav.toString("base64") } }));
        return;
      }
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(wav);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fake provider did not bind a port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
