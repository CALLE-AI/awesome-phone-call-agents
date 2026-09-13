/**
 * Voice preflight CLI.
 *
 * Exit codes, so a pipeline can gate on this the way the other apps in this
 * repository do:
 *
 *   0  no blocking finding
 *  20  a blocking finding, the call should not go out as written
 *  30  usage or input file error
 *  40  the provider refused or answered with no audio
 *
 * Progress goes to stderr and the result goes to stdout, so `--json` stays
 * parseable while a CI log still shows what happened.
 */

import { mkdirSync } from "node:fs";
import { loadDescriptor, loadScript } from "./config.js";
import { renderPreview, renderResult } from "./format.js";
import { parseAllowedHosts } from "./hosts.js";
import { preflight } from "./preflight.js";
import { ConfigError, ProviderError } from "./types.js";

const USAGE = `Voice preflight

  preview --script <file> --provider <file> [--json]
      Print what would be sent, the locked lines and the offline findings.
      Contacts nothing and reads no credential.

  render --script <file> --provider <file> [--json] [--cache <dir>]
         [--allow-host <host>]
      Synthesise the task through the provider, measure the audio and check it.
      Needs the credential named by the descriptor's authEnv.

Environment
  VOICE_ALLOWED_HOSTS   comma separated hostnames the credential may travel to
  <authEnv>             whatever the descriptor names, for example FISH_AUDIO_TOKEN

The descriptor never holds a credential. It names the variable that does.`;

interface Args {
  command: string;
  script?: string;
  provider?: string;
  cache: string;
  json: boolean;
  allowHosts: string[];
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    command: argv[0] ?? "help",
    cache: ".voice-cache",
    json: false,
    allowHosts: [],
  };
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new ConfigError(`${flag} needs a value.`);
      }
      i += 1;
      return value;
    };
    if (flag === "--script") args.script = next();
    else if (flag === "--provider") args.provider = next();
    else if (flag === "--cache") args.cache = next();
    else if (flag === "--allow-host") args.allowHosts.push(next());
    else if (flag === "--json") args.json = true;
    else throw new ConfigError(`Unknown option ${flag}.`);
  }
  return args;
}

function allowedFrom(args: Args, env: NodeJS.ProcessEnv): Set<string> {
  const fromEnv = (env["VOICE_ALLOWED_HOSTS"] ?? "").split(",");
  return parseAllowedHosts([...args.allowHosts, ...fromEnv]);
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}\n`);
    return 30;
  }
  if (args.command === "help" || args.command === "--help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (args.command !== "preview" && args.command !== "render") {
    process.stderr.write(`Unknown command ${args.command}.\n\n${USAGE}\n`);
    return 30;
  }
  if (args.script === undefined || args.provider === undefined) {
    process.stderr.write(`${args.command} needs --script and --provider.\n\n${USAGE}\n`);
    return 30;
  }

  try {
    const script = loadScript(args.script);
    const descriptor = loadDescriptor(args.provider);

    if (args.command === "preview" && !args.json) {
      process.stdout.write(`${renderPreview(script, descriptor)}\n\n`);
    }

    const doRender = args.command === "render";
    if (doRender) mkdirSync(args.cache, { recursive: true });
    const result = await preflight({
      script,
      descriptor,
      cacheDir: args.cache,
      allowedHosts: allowedFrom(args, process.env),
      doRender,
    });

    process.stdout.write(
      args.json ? `${JSON.stringify(result, null, 2)}\n` : `${renderResult(result)}\n`,
    );
    return result.ok ? 0 : 20;
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 30;
    }
    if (error instanceof ProviderError) {
      process.stderr.write(`${error.message}\n`);
      return 40;
    }
    throw error;
  }
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("cli.ts") || invoked.endsWith("cli.js")) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
      process.exit(1);
    });
}
