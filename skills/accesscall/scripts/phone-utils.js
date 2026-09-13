/**
 * phone-utils.js
 *
 * E.164 phone number validation and masking utilities used before any
 * `plan_call` invocation and in any logged output or printed summary.
 *
 * The E.164 regex here matches the one this repository already validates
 * elsewhere (see scripts/validate_repository.py's Dify template checks:
 * `^\+[1-9]\d{6,14}$`, i.e. a leading `+`, a non-zero first digit, and a
 * total of 7-15 digits) so accesscall's phone handling stays consistent with
 * the rest of the repo rather than inventing a second definition of E.164.
 *
 * Usage:
 *   node phone-utils.js --validate "+15550101234"
 *   node phone-utils.js --mask "+15550101234"
 */

const path = require("path");

const E164_RE = /^\+[1-9]\d{6,14}$/;

function isE164(value) {
  return typeof value === "string" && E164_RE.test(value);
}

/**
 * Validates a phone number is E.164. Throws with a clear, user-facing
 * message if not -- callers must surface this to the user and ask them to
 * correct the number rather than silently passing it through to plan_call.
 */
function assertE164(value) {
  if (!isE164(value)) {
    throw new Error(
      `"${value}" is not a valid E.164 phone number (expected a leading "+", a non-zero first digit, ` +
        `and 7-15 total digits, e.g. "+15550101234"). Ask the user to correct it -- do not guess or reformat it yourself.`,
    );
  }
  return value;
}

/**
 * Masks all but the leading digits of a phone number for logs and printed
 * summaries, e.g. "+15550101234" -> "+1555010****". The last 4 characters are
 * always masked; only pass the unmasked value to the actual plan_call/run_call
 * API invocation itself.
 */
function maskPhone(value) {
  const str = String(value || "");
  if (str.length <= 4) return "*".repeat(str.length);
  return str.slice(0, -4) + "*".repeat(4);
}

module.exports = {
  E164_RE,
  isE164,
  assertE164,
  maskPhone,
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptName = path.basename(__filename);

  if (typeof args.validate === "string") {
    if (isE164(args.validate)) {
      console.log(`VALID: "${args.validate}" is E.164.`);
    } else {
      console.error(`INVALID: "${args.validate}" is not E.164. Ask the user to correct it.`);
      process.exitCode = 1;
    }
    return;
  }

  if (typeof args.mask === "string") {
    console.log(maskPhone(args.mask));
    return;
  }

  console.error(`Usage: node ${scriptName} --validate "<number>" | --mask "<number>"`);
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}
