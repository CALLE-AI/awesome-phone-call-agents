import { readFile } from "node:fs/promises";
import { buildCallGoal, calculateException, validatePhone } from "./domain.mjs";
import { getCallRun, planCall, recoverCall, runCall } from "./calle.mjs";
import { sanitizeForDisplay } from "./display.mjs";
import { recordRun, reserveRun } from "./ledger.mjs";

function argsToObject(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

async function loadPacket() {
  const value = await readFile(new URL("../fixtures/exception.json", import.meta.url), "utf8");
  return JSON.parse(value);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(sanitizeForDisplay(value), null, 2)}\n`);
}

const [command = "demo", ...rest] = process.argv.slice(2);
const options = argsToObject(rest);
const packet = await loadPacket();

if (command === "demo") {
  const exception = calculateException(packet);
  const goal = buildCallGoal(packet, {
    authorizedBy: "demo reviewer",
    recipientConsent: true,
  });
  print({
    mode: "dry-run",
    placedCall: false,
    exception: {
      packetId: exception.packetId,
      unitDifference: exception.unitDifference,
      totalDifference: exception.totalDifference,
      currency: exception.currency,
    },
    safety: {
      humanApprovalRequired: true,
      recipientConsentRequired: true,
      impersonationAllowed: false,
    },
    callGoal: goal,
  });
} else if (command === "plan") {
  const phone = validatePhone(options.phone || "");
  const goal = buildCallGoal(packet, {
    authorizedBy: options["authorized-by"],
    recipientConsent: options["recipient-consent"] === "yes",
  });
  print(await planCall({
    phone,
    region: options.region,
    language: options.language,
    goal,
  }));
} else if (command === "run") {
  if (options.confirm !== "RUN") {
    throw new Error("Refusing to place a call. Pass --confirm RUN after reviewing the CALL-E plan.");
  }
  if (!options["plan-id"] || !options["confirm-token"]) {
    throw new Error("Both --plan-id and --confirm-token are required.");
  }
  const reservation = await reserveRun(options["plan-id"]);
  const result = await runCall({
    planId: options["plan-id"],
    confirmToken: options["confirm-token"],
  });
  await recordRun(reservation);
  print(result);
} else if (command === "status") {
  if (!options["run-id"]) {
    throw new Error("Pass --run-id with the opaque CALL-E run identifier.");
  }
  print(await getCallRun(options["run-id"]));
} else if (command === "recover") {
  if (!options["recovery-id"]) {
    throw new Error("Pass --recovery-id from the uncertain CALL-E start result.");
  }
  print(await recoverCall(options["recovery-id"]));
} else {
  throw new Error(`Unknown command: ${command}`);
}
