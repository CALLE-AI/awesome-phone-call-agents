/**
 * redact-transcript.js
 *
 * Produces a redacted excerpt of a call transcript for display to a user,
 * so a validation-failure fallback never surfaces the raw, unredacted
 * transcript (which may contain the caller's spoken phone number, email
 * address, or other identifying detail).
 *
 * Redacts:
 *   - phone numbers, via the same maskPhone() used elsewhere in this skill
 *     for consistency. Covers E.164 ("+15854142924"), grouped international
 *     display format ("+1 (585) 414-2924"), and common US/NANP formats with
 *     no "+" -- "(585) 414-2924", "585-414-2924", "585.414.2924", and bare
 *     "5854142924" -- all masking down to "+1585414****" / "585414****".
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

// Two phone shapes, combined into ONE alternation regex so a single
// `.replace()` pass picks non-overlapping matches -- combining them via two
// separate sequential `.replace()` calls previously caused the same
// substring to be masked twice (e.g. "+1585414********" instead of
// "+1585414****"). Whichever alternative matches first at a given position
// wins; the engine then continues past that match, so the other alternative
// never gets a second chance at the same characters.
//
// 1. `+`-prefixed international/E.164 numbers (this repo's canonical
//    grouped-display matcher from validate_repository.py's Dify checks --
//    its separator class `[\s().-]*` allows zero separators, so it already
//    covers bare "+15854142924" too, not just spaced/grouped display forms).
const GROUPED_INTL_PHONE_RE = "(?<!\\w)\\+[1-9](?:[\\s().-]*\\d){6,14}(?![\\s().-]*\\d)";
// 2. Domestic NANP-shaped numbers with no `+`: "(585) 414-2924",
//    "585-414-2924", "585.414.2924", "5854142924", with an optional leading
//    "1". Area code and exchange digits are constrained to 2-9 (a real NANP
//    rule) so this doesn't over-match arbitrary 10-digit numbers like order
//    IDs -- deliberately narrower than a bare `\d{7,15}` catch-all.
const NANP_PHONE_RE = "(?<!\\d)(?:1[\\s.-]?)?\\(?[2-9]\\d{2}\\)?[\\s.-]?[2-9]\\d{2}[\\s.-]?\\d{4}(?!\\d)";

const PHONE_RE = new RegExp(`(?:${GROUPED_INTL_PHONE_RE})|(?:${NANP_PHONE_RE})`, "g");
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function redactPhones(text) {
  return text.replace(PHONE_RE, (match) => maskPhone(match));
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
