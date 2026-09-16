/**
 * The whole flow against a local fake provider. No credentials, no network
 * beyond loopback, nothing billed, nothing dialled.
 *
 * Four cases. The last three are the point of the app: a script can be
 * well written and still be wrong once somebody has to speak it.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeProvider, CHARS_PER_SECOND } from "../fake/tts-server.js";
import { renderFindings } from "../src/format.js";
import { preflight } from "../src/preflight.js";
import type { ProviderDescriptor, Script } from "../src/types.js";

const KEY = "demo-key";
const CODE_LINE = "read back the six digit approval code shown on the request";

function descriptor(url: string, languages: readonly string[]): ProviderDescriptor {
  return {
    name: "local-fake",
    endpoint: `${url}/speak`,
    method: "POST",
    authHeader: "x-api-key",
    authEnv: "LOCAL_FAKE_KEY",
    bodyTemplate: '{"text":"{text}","voice":"{voice}"}',
    audio: { kind: "body" },
    format: "wav",
    maxChars: 4000,
    languages,
  };
}

function script(over: Partial<Script>): Script {
  return {
    id: "deployment-approval",
    task: `This is an automated approval call from the release pipeline. I am not a person. To approve, ${CODE_LINE}. The code is 999833.`,
    locale: "en-IN",
    voiceId: "demo-voice",
    maxSpokenSeconds: 45,
    locked: [
      { text: CODE_LINE, reason: "the gate approves only when a live person returns the code" },
      { text: "I am not a person", reason: "the AI disclosure has to be spoken" },
    ],
    ...over,
  };
}

async function main(): Promise<void> {
  const fake = await startFakeProvider({ expectKey: KEY });
  const cache = mkdtempSync(join(tmpdir(), "voice-preflight-demo-"));
  const env = { LOCAL_FAKE_KEY: KEY };
  const run = async (label: string, s: Script, d: ProviderDescriptor): Promise<void> => {
    process.stdout.write(`\n${label}\n`);
    const result = await preflight({
      script: s,
      descriptor: d,
      cacheDir: cache,
      allowedHosts: [],
      doRender: true,
      env,
    });
    const seconds = result.render?.seconds;
    process.stdout.write(
      `  rendered ${result.render?.bytes ?? 0} bytes, ${seconds === null || seconds === undefined ? "duration unknown" : `${seconds.toFixed(1)}s spoken`}\n`,
    );
    for (const line of renderFindings(result.findings).split("\n")) {
      process.stdout.write(`  ${line}\n`);
    }
    process.stdout.write(`  Verdict ${result.ok ? "ok" : "refused"}\n`);
  };

  try {
    await run("1. The script as written, heard before anybody dials", script({}), descriptor(fake.url, ["en-US", "en-IN"]));

    await run(
      "2. Somebody tidied the wording and the code sentence went with it",
      script({ task: "This is an automated approval call. I am not a person. Please approve when ready." }),
      descriptor(fake.url, ["en-US", "en-IN"]),
    );

    await run(
      "3. The recipient speaks Hindi and the chosen voice does not",
      script({ locale: "hi-IN" }),
      descriptor(fake.url, ["en-US", "en-GB"]),
    );

    await run(
      "4. The script grew past the spoken budget the operator set",
      script({ task: `I am not a person. To approve, ${CODE_LINE}. ${"Extra context. ".repeat(40)}` , maxSpokenSeconds: 20 }),
      descriptor(fake.url, ["en-US", "en-IN"]),
    );

    process.stdout.write(
      `\nThe fake speaks at ${CHARS_PER_SECOND} characters a second, so case 4 crosses the budget on arithmetic rather than on luck.\n`,
    );
  } finally {
    await fake.close();
  }
}

await main();
