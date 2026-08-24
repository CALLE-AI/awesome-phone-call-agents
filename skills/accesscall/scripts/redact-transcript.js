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
 *     for consistency. FAILS CLOSED on shape: this skill is not US-only (it
 *     takes a language/region parameter), so rather than only matching
 *     specific country formats (E.164, NANP, ...) this looks for any digit
 *     run of plausible phone-number length (7-15 digits, optionally
 *     separated by spaces/dashes/dots/parens/a leading "+") and masks it --
 *     covering E.164 ("+15550101234"), NANP ("555-201-1234"), UK-style with
 *     no "+" ("020 7946 0958"), and other formats this skill hasn't been
 *     explicitly taught. This deliberately trades precision for recall: it
 *     will occasionally mask something that isn't a phone number (e.g. an
 *     order ID). That's an accepted tradeoff for a PII-redaction fallback --
 *     a missed real phone number is worse than an over-redacted non-number.
 *     Digit runs shorter than 7 (e.g. a bare 4-digit year) are left alone.
 *   - email addresses (e.g. "contact@example.com" -> "[redacted email]")
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

// Fail-closed, shape-agnostic phone candidate: an optional leading "+"
// followed by a run of digits/parens/spaces/dashes/dots, bounded so it can't
// run away across unrelated text. This is intentionally NOT restricted to
// any particular country's format (no NANP area-code/exchange constraint,
// no E.164-specific structure) -- this skill supports a language/region
// parameter, so a US-shaped-only pattern would silently miss real numbers
// from callers elsewhere (e.g. UK "020 7946 0958", which has no "+" and
// isn't NANP-shaped).
//
// The regex only bounds the *candidate span* loosely; the actual "is this
// phone-number length" decision is a digit count done in redactPhones()
// below (7-15 digits), not encoded in the character-class quantifiers here
// -- separators can appear at arbitrary positions, so counting digits after
// matching is far simpler and more precise than trying to make the regex
// itself enforce the count.
const PHONE_CANDIDATE_RE = /(?<!\d)\+?[\d(][\d()\s.-]{5,26}\d(?!\d)/g;
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function redactPhones(text) {
  return text.replace(PHONE_CANDIDATE_RE, (match) => {
    const digitCount = (match.match(/\d/g) || []).length;
    if (digitCount < MIN_PHONE_DIGITS || digitCount > MAX_PHONE_DIGITS) {
      return match; // Not phone-length (e.g. a bare 4-digit year) -- leave it.
    }
    return maskPhone(match);
  });
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
