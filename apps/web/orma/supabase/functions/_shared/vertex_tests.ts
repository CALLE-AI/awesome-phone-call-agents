/**
 * T7.2a Deno tests for the shared Vertex client in vertex.ts.
 * Pin with:
 * `deno test --allow-read supabase/functions/_shared/vertex.ts supabase/functions/_shared/vertex_tests.ts`
 */
import { createVertexTranscriber } from "../telegram/voice_vertex.ts";
import {
  extractCandidateText,
  testServiceAccountJson,
  vertexGenerate,
  vertexGenerateContentUrl,
} from "./vertex.ts";

const testFn = (Deno as { test?: (name: string, fn: () => Promise<void>) => void }).test;
if (typeof testFn === "function" && !import.meta.main) {
  type RecordedCall = {
    url: string;
    method: string;
    headers: Headers;
    body: string;
  };

  function decodeJwtSegment(segment: string): Record<string, unknown> {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (segment.length % 4)) % 4);
    return JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))),
    ) as Record<string, unknown>;
  }

  testFn("malformed service-account JSON fails before any request", async () => {
    const calls: RecordedCall[] = [];
    try {
      await vertexGenerate(
        {
          project: "nryn-personal",
          location: "us-central1",
          model: "gemini-3.8-flash",
          credentialsJson: "{not json",
          fetch: async (input) => {
            calls.push({
              url: String(input),
              method: "GET",
              headers: new Headers(),
              body: "",
            });
            throw new Error("network must not be reached");
          },
        },
        {},
      );
      throw new Error("expected malformed credentials to fail");
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "GOOGLE_APPLICATION_CREDENTIALS_JSON is not JSON") {
        throw new Error("must report non-JSON credentials");
      }
    }
    if (calls.length !== 0) throw new Error("no request may precede credential parsing");
  });

  testFn("incomplete service-account JSON fails before any request", async () => {
    const cases = [
      { label: "client_email", json: { private_key: "k" } },
      { label: "private_key", json: { client_email: "sa@nryn-personal.iam.gserviceaccount.com" } },
    ];
    for (const missing of cases) {
      try {
        await vertexGenerate(
          {
            project: "p",
            location: "l",
            model: "m",
            credentialsJson: JSON.stringify(missing.json),
            fetch: async () => {
              throw new Error("network must not be reached");
            },
          },
          {},
        );
        throw new Error(`expected missing ${missing.label} to fail`);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "GOOGLE_APPLICATION_CREDENTIALS_JSON is missing fields") {
          throw new Error(`must report incomplete credentials for ${missing.label}`);
        }
      }
    }
  });

  testFn("generateContent exchanges the JWT for a bearer token at the pinned endpoints", async () => {
    const calls: RecordedCall[] = [];
    const generateUrl = vertexGenerateContentUrl("nryn-personal", "us-central1", "gemini-3.8-flash");
    const credentialsJson = await testServiceAccountJson();
    const credentials = JSON.parse(credentialsJson) as { client_email: string };
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : "",
      });
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "ya29.shared-test" }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url === generateUrl) {
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "prose text" }] } }],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    const body = { contents: [{ role: "user", parts: [{ text: "write the report" }] }] };
    const parsed = await vertexGenerate(
      { project: "nryn-personal", location: "us-central1", model: "gemini-3.8-flash", credentialsJson, fetch: fetchImpl },
      body,
    );
    if (calls.length !== 2) throw new Error(`expected two requests, saw ${calls.length}`);
    const token = calls[0];
    if (token.url !== "https://oauth2.googleapis.com/token") {
      throw new Error("token exchange must hit the Google OAuth token endpoint");
    }
    if (token.method !== "POST") throw new Error("token exchange must POST");
    if (token.headers.get("content-type") !== "application/x-www-form-urlencoded") {
      throw new Error("token exchange must send a form body");
    }
    const form = new URLSearchParams(token.body);
    if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") {
      throw new Error("token exchange must request the jwt-bearer grant");
    }
    const assertion = form.get("assertion");
    if (!assertion) throw new Error("token exchange must carry the signed assertion");
    const assertionParts = assertion.split(".");
    if (assertionParts.length !== 3) throw new Error("assertion must be a three-part JWT");
    const header = decodeJwtSegment(assertionParts[0]);
    if (header.alg !== "RS256" || header.typ !== "JWT") {
      throw new Error("JWT header must name RS256 and JWT");
    }
    const jwtPayload = decodeJwtSegment(assertionParts[1]);
    if (jwtPayload.iss !== credentials.client_email || jwtPayload.sub !== credentials.client_email) {
      throw new Error("JWT must name the service account as issuer and subject");
    }
    if (jwtPayload.aud !== "https://oauth2.googleapis.com/token") {
      throw new Error("JWT must target the token endpoint");
    }
    if (jwtPayload.scope !== "https://www.googleapis.com/auth/cloud-platform") {
      throw new Error("JWT must request the cloud-platform scope");
    }
    const generate = calls[1];
    if (generate.url !== generateUrl) {
      throw new Error("generateContent must use project, location and model in the URL");
    }
    if (generate.headers.get("authorization") !== "Bearer ya29.shared-test") {
      throw new Error("generateContent must carry the exchanged bearer token");
    }
    if (generate.headers.get("content-type") !== "application/json") {
      throw new Error("generateContent must send JSON");
    }
    if (JSON.parse(generate.body) === undefined) throw new Error("generateContent must send the caller body");
    if (JSON.stringify(JSON.parse(generate.body)) !== JSON.stringify(body)) {
      throw new Error("generateContent must send the caller body unchanged");
    }
    if (extractCandidateText(parsed) !== "prose text") {
      throw new Error("generateContent must return the parsed Vertex response");
    }
  });

  testFn("vertexGenerateContentUrl builds regional and global endpoints", async () => {
    const regional = vertexGenerateContentUrl("nryn-personal", "us-central1", "gemini-3.8-flash");
    if (
      regional !==
        "https://us-central1-aiplatform.googleapis.com/v1/projects/nryn-personal/locations/us-central1/publishers/google/models/gemini-3.8-flash:generateContent"
    ) {
      throw new Error("regional endpoint must name the location host, project and model");
    }
    const global = vertexGenerateContentUrl("nryn-personal", "global", "gemini-3.8-flash");
    if (
      global !==
        "https://aiplatform.googleapis.com/v1/projects/nryn-personal/locations/global/publishers/google/models/gemini-3.8-flash:generateContent"
    ) {
      throw new Error("global location must use the unscoped host");
    }
  });

  testFn("a non-OK generate response fails", async () => {
    const generateUrl = vertexGenerateContentUrl("nryn-personal", "us-central1", "gemini-3.8-flash");
    const credentialsJson = await testServiceAccountJson();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "ya29.shared-test" }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url === generateUrl) {
        return new Response(JSON.stringify({ error: { message: "quota" } }), { status: 500 });
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await vertexGenerate(
        { project: "nryn-personal", location: "us-central1", model: "gemini-3.8-flash", credentialsJson, fetch: fetchImpl },
        {},
      );
      throw new Error("expected a non-OK generate response to fail");
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "vertex generateContent failed") {
        throw new Error("must fail on a non-OK generate response");
      }
    }
  });

  testFn("a non-OK token response fails before generateContent", async () => {
    const credentialsJson = await testServiceAccountJson();
    const calls: RecordedCall[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : "",
      });
      if (init?.method === "POST" && url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 500 });
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await vertexGenerate(
        { project: "nryn-personal", location: "us-central1", model: "gemini-3.8-flash", credentialsJson, fetch: fetchImpl },
        {},
      );
      throw new Error("expected a non-OK token response to fail");
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "google token exchange failed") {
        throw new Error("must fail on a non-OK token response");
      }
    }
    if (calls.length !== 1) throw new Error(`expected only the token request, saw ${calls.length}`);
  });

  testFn("a token 200 without access_token fails before generateContent", async () => {
    const credentialsJson = await testServiceAccountJson();
    const calls: RecordedCall[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : "",
      });
      if (init?.method === "POST" && url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ token_type: "Bearer", expires_in: 3599 }),
          { headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await vertexGenerate(
        { project: "nryn-personal", location: "us-central1", model: "gemini-3.8-flash", credentialsJson, fetch: fetchImpl },
        {},
      );
      throw new Error("expected a token response without access_token to fail");
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "google token exchange failed") {
        throw new Error("must fail when the token response lacks access_token");
      }
    }
    if (calls.length !== 1) throw new Error(`expected only the token request, saw ${calls.length}`);
  });

  testFn("candidate text extraction joins parts and tolerates missing fields", async () => {
    const joined = extractCandidateText({
      candidates: [{ content: { parts: [{ text: "one " }, { text: "two" }, {}] } }],
    });
    if (joined !== "one two") throw new Error("extraction must join part text in order");
    if (extractCandidateText({}) !== "") throw new Error("extraction must tolerate no candidates");
    if (extractCandidateText({ candidates: [] }) !== "") {
      throw new Error("extraction must tolerate an empty candidate list");
    }
    if (extractCandidateText({ candidates: [{ content: {} }] }) !== "") {
      throw new Error("extraction must tolerate missing parts");
    }
  });

  testFn("voice transcription posts the instruction and inline audio", async () => {
    const audio = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x01]);
    const instruction =
      "Transcribe the spoken words only. Do not add commentary. If the audio is unintelligible, reply with an empty string.";
    const generateUrl = vertexGenerateContentUrl("nryn-personal", "us-central1", "gemini-3.8-flash");
    const credentialsJson = await testServiceAccountJson();
    let generateBody = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "ya29.shared-test" }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url === generateUrl) {
        generateBody = typeof init?.body === "string" ? init.body : "";
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "book dentist" }, {}] } }],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    const transcribe = createVertexTranscriber({
      project: "nryn-personal",
      location: "us-central1",
      model: "gemini-3.8-flash",
      credentialsJson,
      fetch: fetchImpl,
    });
    const text = await transcribe(audio, "audio/ogg");
    if (text !== "book dentist") throw new Error("transcriber must return the extracted candidate text");
    const posted = JSON.parse(generateBody) as {
      contents?: Array<{ role?: string; parts?: Array<Record<string, unknown>> }>;
    };
    const parts = posted.contents?.[0]?.parts;
    if (posted.contents?.[0]?.role !== "user") throw new Error("transcription must send a user turn");
    if (parts?.[0]?.text !== instruction) {
      throw new Error("transcription must send the transcription instruction");
    }
    const inline = parts?.[1]?.inlineData as { mimeType?: string; data?: string } | undefined;
    if (inline?.mimeType !== "audio/ogg") throw new Error("transcription must name the audio mime type");
    if (inline?.data !== btoa("OggS\u0000\u0001")) {
      throw new Error("transcription must inline the base64 audio bytes");
    }
  });
}
