/**
 * parse-recap.js
 *
 * Extracts the labeled closing recap (see ../references/call-task-template.md)
 * from a raw call transcript string and returns an object matching
 * ../references/intake-result.schema.json.
 *
 * Deliberately has zero external dependencies (no jszip/xml-js/docx like
 * format-to-vpat.js): this script only needs to read a transcript string and
 * the schema JSON file, both doable with Node's built-in `fs`. Keeping it
 * dependency-free also means it can run even in an environment where
 * format-to-vpat.js's npm packages haven't been installed.
 *
 * The recap format this parses (one label per line):
 *
 *   Assistive technology: <value>
 *   Task attempted: <value>
 *   Barrier category: <value>
 *   Severity: <value>
 *   Consent to follow-up: <yes|no>
 *   Follow-up contact: <value, or 'none'>
 *   Follow-up contact confirmed: <yes|no>
 *
 * SECURITY: recap lines are only ever read from the BOT's final, uninterrupted
 * speaking turn -- i.e. lines explicitly tagged "[HH:MM:SS] BOT:" (or an
 * untagged continuation of that same tagged turn) that occur strictly after
 * the last "[HH:MM:SS] USER:"-tagged line in the transcript. The transcript
 * MUST use these speaker tags; an untagged transcript cannot be attributed
 * and is treated as having no recap. This exists specifically so a caller
 * cannot speak the label format themselves (e.g. "Assistive technology:
 * screen_reader") and have it accepted as if the bot had validated and
 * recapped it -- that would let a callee forge compliance data. If the bot's
 * recap cannot be cleanly isolated to that final segment, this fails rather
 * than accepting a partial or scattered match.
 *
 * Per SKILL.md: if the recap is missing, incomplete, or fails schema
 * validation, this never guesses field values -- it reports exactly what's
 * wrong so a *redacted* excerpt of the transcript can be surfaced to the user
 * instead (see scripts/redact-transcript.js; never surface the raw transcript).
 *
 * Usage:
 *   node parse-recap.js --transcript-file <path-to-transcript.txt>
 *   node parse-recap.js --transcript "<inline transcript text>"
 *   cat transcript.txt | node parse-recap.js
 */

const fs = require("fs");
const path = require("path");

const SCHEMA_PATH = path.join(__dirname, "..", "references", "intake-result.schema.json");

// Recap label -> schema field. Order matters: "Follow-up contact confirmed"
// must be tried before "Follow-up contact" would even be relevant, though the
// anchored `:` after each label already makes the two unambiguous.
const FIELD_PATTERNS = [
  { label: "Assistive technology", field: "assistive_tech", kind: "enumish" },
  { label: "Task attempted", field: "task_attempted", kind: "text" },
  { label: "Barrier category", field: "barrier_category", kind: "enumish" },
  { label: "Severity", field: "severity", kind: "enumish" },
  { label: "Consent to follow-up", field: "consent_followup", kind: "yesno" },
  { label: "Follow-up contact confirmed", field: "followup_contact_confirmed", kind: "yesno" },
  { label: "Follow-up contact", field: "followup_contact", kind: "text-or-none" },
];

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

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
}

/**
 * Tags every transcript line with its speaker. A line with an explicit
 * "[HH:MM:SS] BOT:" / "[HH:MM:SS] USER:" prefix sets the current speaker and
 * strips the prefix; an untagged line (a wrapped continuation of the same
 * quote) inherits whatever speaker was last explicitly tagged. Lines before
 * any speaker tag has appeared are speaker: null (untrusted, attributable to
 * no one).
 */
function tagLines(transcript) {
  const rawLines = String(transcript || "").split(/\r?\n/);
  let currentSpeaker = null;
  return rawLines.map((rawLine) => {
    const match = rawLine.match(/^\s*\[[^\]]*\]\s*(BOT|USER)\s*:\s*(.*)$/i);
    if (match) {
      currentSpeaker = match[1].toUpperCase();
      return { speaker: currentSpeaker, text: match[2].trim() };
    }
    return { speaker: currentSpeaker, text: rawLine.trim() };
  });
}

/**
 * Isolates the bot's final, uninterrupted speaking turn: every line strictly
 * after the last USER-tagged line, filtered to BOT-tagged lines only. A real
 * recap is the last thing the bot says before the call ends, with no caller
 * turn in between it and the end of the transcript -- so anything the caller
 * said, anywhere, at any point, is never eligible to be read as the recap,
 * regardless of its content. If there are no USER-tagged lines at all (e.g. a
 * voicemail-only transcript), the whole transcript is treated as the final
 * segment. If there are no BOT-tagged lines in that segment either (e.g. an
 * untagged transcript, or the caller's line really was the last thing said),
 * the segment is empty and no recap can be attributed -- callers must treat
 * that as "no recap found," never guess.
 */
function getFinalBotSegment(taggedLines) {
  let lastUserIdx = -1;
  for (let i = 0; i < taggedLines.length; i++) {
    if (taggedLines[i].speaker === "USER") lastUserIdx = i;
  }
  return taggedLines.slice(lastUserIdx + 1).filter((line) => line.speaker === "BOT");
}

function normalizeYesNo(rawValue) {
  const value = rawValue.trim().replace(/[.\s]+$/, "").toLowerCase();
  if (value === "yes") return true;
  if (value === "no") return false;
  return undefined; // Ambiguous -- do not guess; caller treats as unparsed.
}

/**
 * Extracts labeled recap lines from a raw transcript string. Only considers
 * lines within the bot's final, uninterrupted speaking turn (see
 * getFinalBotSegment) -- content spoken by the caller, anywhere in the
 * transcript, is never eligible, no matter what it says.
 */
function extractRecapFields(transcript) {
  const found = {};
  const finalBotSegment = getFinalBotSegment(tagLines(transcript));

  for (const { text } of finalBotSegment) {
    for (const { label, field } of FIELD_PATTERNS) {
      const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.+?)\\s*$`, "i");
      const match = text.match(re);
      if (match && found[field] === undefined) {
        found[field] = match[1].trim().replace(/\.$/, "");
      }
    }
  }
  return found;
}

/**
 * Converts raw extracted strings into the typed shape the schema expects.
 * Returns { result, warnings } -- warnings note any field that was present in
 * the recap but could not be confidently parsed (e.g. yes/no field with a
 * different word), which is left out of `result` rather than guessed.
 */
function coerceRecapFields(rawFields) {
  const result = {};
  const warnings = [];

  if (rawFields.assistive_tech !== undefined) {
    result.assistive_tech = rawFields.assistive_tech.toLowerCase();
  }
  if (rawFields.task_attempted !== undefined) {
    result.task_attempted = rawFields.task_attempted;
  }
  if (rawFields.barrier_category !== undefined) {
    result.barrier_category = rawFields.barrier_category.toLowerCase();
  }
  if (rawFields.severity !== undefined) {
    result.severity = rawFields.severity.toLowerCase();
  }
  if (rawFields.consent_followup !== undefined) {
    const parsed = normalizeYesNo(rawFields.consent_followup);
    if (parsed === undefined) {
      warnings.push(`"Consent to follow-up" value "${rawFields.consent_followup}" is not "yes" or "no"; omitted.`);
    } else {
      result.consent_followup = parsed;
    }
  }
  if (rawFields.followup_contact_confirmed !== undefined) {
    const parsed = normalizeYesNo(rawFields.followup_contact_confirmed);
    if (parsed === undefined) {
      warnings.push(
        `"Follow-up contact confirmed" value "${rawFields.followup_contact_confirmed}" is not "yes" or "no"; omitted.`,
      );
    } else {
      result.followup_contact_confirmed = parsed;
    }
  }
  if (rawFields.followup_contact !== undefined) {
    const value = rawFields.followup_contact;
    if (value.toLowerCase() !== "none" && value !== "") {
      result.followup_contact = value;
    }
  }

  return { result, warnings };
}

// --- Minimal, schema-file-driven JSON Schema subset validator ---------------
//
// Only implements what references/intake-result.schema.json actually uses:
// required, properties[].type, properties[].enum, a single if/required +
// then/properties[].const, and additionalProperties: false. Reads the schema
// file itself rather than re-hardcoding enum lists, so this can't silently
// drift out of sync with the schema.

function validateAgainstSchema(obj, schema) {
  const errors = [];

  for (const field of schema.required || []) {
    if (obj[field] === undefined) {
      errors.push(`missing required field "${field}"`);
    }
  }

  for (const [field, propSchema] of Object.entries(schema.properties || {})) {
    if (obj[field] === undefined) continue;
    const value = obj[field];
    if (propSchema.type === "boolean" && typeof value !== "boolean") {
      errors.push(`field "${field}" must be a boolean, got ${JSON.stringify(value)}`);
    }
    if (propSchema.type === "string" && typeof value !== "string") {
      errors.push(`field "${field}" must be a string, got ${JSON.stringify(value)}`);
    }
    if (propSchema.enum && !propSchema.enum.includes(value)) {
      errors.push(
        `field "${field}" has invalid value ${JSON.stringify(value)}; must be one of: ${propSchema.enum.join(", ")}`,
      );
    }
  }

  if (schema.if && schema.then) {
    const ifRequired = schema.if.required || [];
    const conditionMet = ifRequired.every((field) => obj[field] !== undefined);
    if (conditionMet) {
      for (const [field, propSchema] of Object.entries(schema.then.properties || {})) {
        if (Object.prototype.hasOwnProperty.call(propSchema, "const") && obj[field] !== propSchema.const) {
          errors.push(
            `field "${field}" must equal ${JSON.stringify(propSchema.const)} when ${ifRequired.join(", ")} is present`,
          );
        }
      }
    }
  }

  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const key of Object.keys(obj)) {
      if (!allowed.has(key)) {
        errors.push(`field "${key}" is not allowed by the schema`);
      }
    }
  }

  return errors;
}

/**
 * Parses a raw transcript string into a schema-validated intake-result
 * object. Throws if the recap is missing required fields or fails schema
 * validation -- never returns a partially-guessed object.
 */
function parseRecap(transcript, { schema } = {}) {
  const resolvedSchema = schema || loadSchema();
  const rawFields = extractRecapFields(transcript);

  if (Object.keys(rawFields).length === 0) {
    throw new Error(
      "No labeled recap lines attributable to the bot's final speaking turn were found in the " +
        "transcript. Either the call ended before the recap (e.g. a crisis-safety override, a " +
        "dropped call, or a caller who hung up early), or the transcript lacks the speaker tags " +
        "needed to attribute the recap to the bot. Do not guess a result -- surface a redacted " +
        "excerpt of the transcript instead (see scripts/redact-transcript.js).",
    );
  }

  const { result, warnings } = coerceRecapFields(rawFields);
  const errors = validateAgainstSchema(result, resolvedSchema);

  if (errors.length > 0 || warnings.length > 0) {
    const allIssues = [...warnings, ...errors];
    throw new Error(`Parsed recap failed validation against intake-result.schema.json:\n- ${allIssues.join("\n- ")}`);
  }

  return result;
}

module.exports = {
  tagLines,
  getFinalBotSegment,
  extractRecapFields,
  coerceRecapFields,
  validateAgainstSchema,
  parseRecap,
  loadSchema,
};

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

  try {
    const result = parseRecap(transcript);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
