/**
 * redact-transcript.js
 *
 * Produces a redacted excerpt of a call transcript for display to a user,
 * so a validation-failure fallback never surfaces the raw, unredacted
 * transcript (which may contain the caller's spoken phone number, email
 * address, or other identifying detail).
 *
 * Redacts:
 *   - phone numbers (E.164 and common grouped/display formats), via the
 *     same maskPhone() used elsewhere in this skill for consistency
 *     (e.g. "+15854142924" -> "+1585414****")
 *   - email addresses (e.g. "jerlyn@designlady.com" -> "[redacted email]")
 *
 * KNOWN LIMITATION: this does not attempt to detect or redact spoken street
 * addresses. Unlike phone numbers and emails, mailing addresses have no
 * reliable, general regex pattern -- a lightweight detector here would
 * either miss most real addresses or over-match ordinary sentences. If a
 * transcript is likely to contain a spoken address, treat this redaction as
 * partial, not complete.
 *
 * Usage:
 *   node redact-transcript.js --transcript-file <path>
 *   node redact-transcript.js --transcript "<inline text>"
 *   cat transcript.txt | node redact-transcript.js
 */

const fs = require("fs");
const path = require("path");

const { maskPhone } = require("./phone-utils.js");

// Same grouped-display phone pattern validate_repository.py already treats as
// this repo's canonical matcher, so redaction here stays consistent with
// phone handling elsewhere in the codebase. Its separator character class
// (`[\s().-]*`) allows zero separators between digits, so it already matches
// bare E.164 numbers too -- a single pass, not a separate bare-number sweep,
// which would otherwise double-mask the same substring.
const GROUPED_PHONE_RE = /(?<!\w)\+[1-9](?:[\s().-]*\d){6,14}(?![\s().-]*\d)/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function redactPhones(text) {
  return text.replace(GROUPED_PHONE_RE, (match) => maskPhone(match));
}

function redactEmails(text) {
  return text.replace(EMAIL_RE, "[redacted email]");
}

function redactTranscript(transcript) {
  const text = String(transcript || "");
  return redactEmails(redactPhones(text));
}

module.exports = {
  redactTranscript,
  redactPhones,
  redactEmails,
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

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let transcript;
  if (args["transcript-file"]) {
    transcript = fs.readFileSync(path.resolve(args["transcript-file"]), "utf8");
  } else if (typeof args.transcript === "string") {
    transcript = args.transcript;
  } else {
    transcript = readStdin();
  }

  console.log(redactTranscript(transcript));
}

if (require.main === module) {
  main();
}
