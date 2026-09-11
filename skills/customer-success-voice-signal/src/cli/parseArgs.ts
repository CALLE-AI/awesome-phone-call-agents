export interface CliArgs {
  fixture?: string;
  trigger?: string;
  stdin: boolean;
  live: boolean;
  dryRun: boolean;
  places: boolean;
  list: boolean;
  last: boolean;
  verbose: boolean;
  help: boolean;
  /** Fetch an existing CALL-E run and map it — no new ring. */
  fromCall?: string;
}

export class CliParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliParseError";
  }
}

const KNOWN = new Set([
  "--help",
  "-h",
  "--live",
  "--dry-run",
  "--list",
  "--last",
  "--stdin",
  "--verbose",
  "-v",
  "PLACES",
  "--places",
  "--fixture",
  "-f",
  "--trigger",
  "-t",
  "--from-call",
]);

/**
 * Parse Stage Manager CLI argv (without node/tsx binary).
 * Throws CliParseError on unknown flags or missing option values.
 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    stdin: false,
    live: false,
    dryRun: false,
    places: false,
    list: false,
    last: false,
    verbose: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--help" || a === "-h") {
      args.help = true;
      continue;
    }
    if (a === "--live") {
      args.live = true;
      continue;
    }
    if (a === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (a === "--list") {
      args.list = true;
      continue;
    }
    if (a === "--last") {
      args.last = true;
      continue;
    }
    if (a === "--stdin") {
      args.stdin = true;
      continue;
    }
    if (a === "--verbose" || a === "-v") {
      args.verbose = true;
      continue;
    }
    if (a === "PLACES" || a === "--places") {
      args.places = true;
      continue;
    }
    if (a === "--fixture" || a === "-f") {
      const val = argv[++i];
      if (!val || val.startsWith("-")) {
        throw new CliParseError("Missing value for --fixture");
      }
      args.fixture = val;
      continue;
    }
    if (a.startsWith("--fixture=")) {
      args.fixture = a.slice("--fixture=".length);
      if (!args.fixture) throw new CliParseError("Missing value for --fixture");
      continue;
    }
    if (a === "--trigger" || a === "-t") {
      const val = argv[++i];
      if (!val || val.startsWith("-")) {
        throw new CliParseError("Missing value for --trigger");
      }
      args.trigger = val;
      continue;
    }
    if (a.startsWith("--trigger=")) {
      args.trigger = a.slice("--trigger=".length);
      if (!args.trigger) throw new CliParseError("Missing value for --trigger");
      continue;
    }
    if (a === "--from-call") {
      const val = argv[++i];
      if (!val || val.startsWith("-")) {
        throw new CliParseError("Missing value for --from-call");
      }
      args.fromCall = val;
      continue;
    }
    if (a.startsWith("--from-call=")) {
      args.fromCall = a.slice("--from-call=".length);
      if (!args.fromCall) throw new CliParseError("Missing value for --from-call");
      continue;
    }
    if (a.endsWith(".json") && !a.startsWith("-") && !args.fixture) {
      args.fixture = a;
      continue;
    }

    if (a.startsWith("-")) {
      const flag = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
      if (!KNOWN.has(flag) && !KNOWN.has(a)) {
        throw new CliParseError(`Unknown option: ${a}`);
      }
    }

    throw new CliParseError(`Unexpected argument: ${a}`);
  }

  if (args.stdin && args.fixture) {
    throw new CliParseError("Conflicting inputs: use --stdin or --fixture, not both");
  }
  if (args.fromCall && args.dryRun) {
    throw new CliParseError("Conflicting inputs: --from-call cannot be used with --dry-run");
  }

  return args;
}
