import { createSdkPort } from "./calle.js";
import { formatPreview, previewReceipt } from "./plan.js";
import { assertLiveWindow, readSearchRequest } from "./request.js";
import { reservePrivateReport } from "./report.js";
import { runSearch } from "./workflow.js";

interface Args {
  command: "preview" | "run";
  request: string;
  live: boolean;
  confirmAuthorized: boolean;
  receipt?: string;
  output?: string;
}

function usage(): never {
  throw new Error("Usage: preview --request FILE | run --request FILE --live --confirm-authorized --receipt RECEIPT --output FILE");
}

function parseArgs(argv: string[]): Args {
  const command = argv[0];
  if (command !== "preview" && command !== "run") usage();
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const request = value("--request");
  if (!request) usage();
  return {
    command,
    request,
    live: argv.includes("--live"),
    confirmAuthorized: argv.includes("--confirm-authorized"),
    receipt: value("--receipt"),
    output: value("--output"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const request = await readSearchRequest(args.request);
  if (args.command === "preview") {
    console.log(formatPreview(request));
    return;
  }
  if (!args.live || !args.confirmAuthorized || !args.receipt || !args.output) usage();
  if (args.receipt !== previewReceipt(request)) {
    throw new Error("The confirmation receipt does not match the current request. Preview the request again; no call was placed.");
  }
  assertLiveWindow(request);
  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) throw new Error("CALLE_API_KEY is required for live mode; no call was placed.");
  const reservation = await reservePrivateReport(args.output);
  try {
    const port = await createSdkPort({ apiKey, baseUrl: process.env.CALLE_BASE_URL });
    const report = await runSearch(request, port, { checkpoint: (value) => reservation.checkpoint(value) });
    await reservation.finalize(report);
    console.log(`Search finished. Redacted report written to ${args.output}.`);
  } catch (error) {
    await reservation.closeIncomplete();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
