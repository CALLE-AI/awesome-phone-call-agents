/**
 * format-to-vpat.js
 *
 * Takes a validated intake-result JSON object (see ../references/intake-result.schema.json)
 * and inserts it as a row into a copy of the existing Design Lady VPAT 2.4 docx template.
 *
 * KNOWN CONSTRAINT (do not violate):
 * When building docx table rows with the `docx` npm package, never construct children
 * with `children: [array.map(...)]`. That pattern nests the array one level too deep and
 * corrupts the resulting .docx file. Build each cell explicitly instead, e.g.:
 *
 *   const cells = [
 *     new TableCell({ children: [new Paragraph(row.criterion)] }),
 *     new TableCell({ children: [new Paragraph(row.conformanceLevel)] }),
 *     new TableCell({ children: [new Paragraph(row.remarks)] }),
 *   ];
 *   const tableRow = new TableRow({ children: cells });
 *
 * Field mapping (intake-result -> VPAT 2.4 fields):
 *   barrier_category -> Conformance Level column (map to the matching WCAG success
 *     criteria group: perceivable / operable / understandable / robust; 'unclear'
 *     should be flagged for manual review, not auto-mapped)
 *   barrier_description -> Remarks and Explanations
 *   severity -> Remediation priority note
 *     (blocked_entirely -> High, workaround_needed -> Medium, minor_annoyance -> Low)
 *   assistive_tech -> Test environment / AT used note
 *   task_attempted -> Context line under the relevant criterion
 *
 * TODO (Claude Code / Codex): implement using the `docx` package.
 * 1. Load the existing VPAT 2.4 template docx as the base (copy, do not mutate original).
 * 2. Locate the correct conformance table.
 * 3. Insert a new row using explicit per-cell construction (see constraint above).
 * 4. Save output as vpat-intake-{{call_id}}.docx
 *
 * Usage:
 *   node format-to-vpat.js --input ../references/example-output.json --call-id demo001 \
 *     --template ../assets/vpat-2.4-template-generic.docx --out ./vpat-intake-demo001.docx
 *
 * --template defaults to ../assets/vpat-2.4-template-generic.docx (relative to this
 * script) if omitted.
 */

const fs = require("fs");

function severityToPriority(severity) {
  const map = {
    blocked_entirely: "High",
    workaround_needed: "Medium",
    minor_annoyance: "Low",
  };
  return map[severity] || "Unknown";
}

function categoryToConformanceNote(barrierCategory) {
  const map = {
    perceivable: "Perceivable (WCAG 1.x)",
    operable: "Operable (WCAG 2.x)",
    understandable: "Understandable (WCAG 3.x)",
    robust: "Robust (WCAG 4.x)",
    unclear: "FLAG FOR MANUAL REVIEW",
  };
  return map[barrierCategory] || "FLAG FOR MANUAL REVIEW";
}

function loadIntakeResult(path) {
  const raw = fs.readFileSync(path, "utf8");
  return JSON.parse(raw);
}

module.exports = {
  severityToPriority,
  categoryToConformanceNote,
  loadIntakeResult,
};

// ---------------------------------------------------------------------------
// Implementation notes:
//
// The `docx` package (dolanmiu/docx) can only *build* new documents with its
// high-level Table/TableRow/TableCell API -- it has no way to load an existing
// .docx's tables back into that object model for editing. Its own template
// -patching feature (`patchDocument`) replaces EVERY occurrence of a given
// placeholder tag across the whole file, which is wrong here: the same
// placeholder text ("[Supports / Partially Supports / Does Not Support / Not
// Applicable]") appears in dozens of rows across multiple tables, and we need
// to touch exactly one row in one table.
//
// So this script drops to the same OOXML layer `docx` itself uses internally
// (its own dependencies `jszip` for the .docx zip container and `xml-js` for
// XML <-> JS conversion) to find the target table/row and rewrite just that
// row's cells. The "never nest a mapped array one level too deep" constraint
// documented above still applies here in spirit: every place a cell's
// `elements` array is rebuilt, it is a flat spread of paragraph elements
// (`elements: [...tcPr, ...paragraphs]`), never `elements: [paragraphs]`.
// ---------------------------------------------------------------------------

const path = require("path");
const JSZip = require("jszip");
const convert = require("xml-js");
const { patchDetector } = require("docx");

const PLACEHOLDER_CONFORMANCE_PREFIX = "[Supports";
const DOCUMENT_XML_PATH = "word/document.xml";

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

function assistiveTechLabel(intake) {
  if (intake.assistive_tech === "other" && intake.assistive_tech_other) {
    return intake.assistive_tech_other;
  }
  return intake.assistive_tech;
}

function validateIntakeResult(intake) {
  const required = [
    "assistive_tech",
    "barrier_category",
    "severity",
    "task_attempted",
    "consent_followup",
    "followup_contact_confirmed",
  ];
  const missing = required.filter((key) => intake[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`intake-result is missing required field(s): ${missing.join(", ")}`);
  }
  const enums = {
    assistive_tech: ["screen_reader", "switch_access", "voice_control", "screen_magnification", "none", "other"],
    barrier_category: ["perceivable", "operable", "understandable", "robust", "unclear"],
    severity: ["blocked_entirely", "workaround_needed", "minor_annoyance"],
  };
  for (const [field, allowed] of Object.entries(enums)) {
    if (!allowed.includes(intake[field])) {
      throw new Error(`intake-result field "${field}" has invalid value "${intake[field]}"`);
    }
  }
  if (typeof intake.followup_contact_confirmed !== "boolean") {
    throw new Error('intake-result field "followup_contact_confirmed" must be a boolean');
  }
  // Mirrors the schema's if/then constraint: a followup_contact is only valid
  // once the caller has explicitly confirmed it (spelled back and agreed to).
  if (intake.followup_contact !== undefined && intake.followup_contact_confirmed !== true) {
    throw new Error(
      'intake-result has "followup_contact" set but "followup_contact_confirmed" is not true; ' +
        "an unconfirmed contact must not be treated as valid",
    );
  }
}

// --- Minimal OOXML (xml-js "compact: false") helpers -----------------------

function children(el, name) {
  return (el.elements || []).filter((e) => e.name === name);
}

function getCellParagraphTexts(tc) {
  return children(tc, "w:p").map((p) =>
    children(p, "w:r")
      .map((r) => children(r, "w:t").map((t) => (t.elements || []).map((x) => x.text || "").join("")).join(""))
      .join(""),
  );
}

function getCellText(tc) {
  return getCellParagraphTexts(tc).join("\n");
}

function buildParagraphElement(text) {
  return {
    type: "element",
    name: "w:p",
    elements: [
      {
        type: "element",
        name: "w:r",
        elements: [
          {
            type: "element",
            name: "w:t",
            attributes: { "xml:space": "preserve" },
            elements: [{ type: "text", text: String(text) }],
          },
        ],
      },
    ],
  };
}

// Rebuilds a <w:tc>'s content with new paragraph text, preserving any
// non-paragraph children (e.g. <w:tcPr>) that appear before the paragraphs.
function setCellText(tc, paragraphTexts) {
  const preserved = (tc.elements || []).filter((e) => e.name !== "w:p");
  const paragraphs = paragraphTexts.map(buildParagraphElement);
  tc.elements = [...preserved, ...paragraphs];
}

function isUnfilledConformancePlaceholder(tc) {
  const text = getCellText(tc).trim();
  return text.startsWith(PLACEHOLDER_CONFORMANCE_PREFIX);
}

// The Conformance Level column in a VPAT may only ever hold one of these four
// values. It is derived from severity (how badly the barrier blocks the
// task), never from barrier_category (which describes the kind of barrier).
function severityToConformanceLevel(severity) {
  const map = {
    blocked_entirely: "Does Not Support",
    workaround_needed: "Partially Supports",
    minor_annoyance: "Supports",
  };
  return map[severity] || "Does Not Support";
}

// Maps a WCAG success criterion number's leading principle digit (e.g. the
// "2" in "2.4.3 Focus Order (Level A)") to the POUR category used by
// barrier_category, so a row can only be selected if its criterion actually
// belongs to the reported principle.
const PRINCIPLE_NUMBER_TO_CATEGORY = {
  1: "perceivable",
  2: "operable",
  3: "understandable",
  4: "robust",
};

function getCriterionCategory(criteriaText) {
  const match = criteriaText.trim().match(/^(\d+)\./);
  if (!match) return null;
  return PRINCIPLE_NUMBER_TO_CATEGORY[match[1]] || null;
}

function getTables(bodyElement) {
  return children(bodyElement, "w:tbl");
}

function getBody(documentJson) {
  const documentEl = documentJson.elements.find((e) => e.name === "w:document");
  if (!documentEl) throw new Error("word/document.xml has no <w:document> root element");
  const body = children(documentEl, "w:body")[0];
  if (!body) throw new Error("word/document.xml has no <w:body> element");
  return body;
}

// --- Row content builders ---------------------------------------------------

function buildRemarksParagraphs(intake, { autoMatched = false } = {}) {
  const lines = [];
  if (intake.barrier_description) lines.push(intake.barrier_description);
  lines.push(`Remediation Priority: ${severityToPriority(intake.severity)} (severity: ${intake.severity})`);
  lines.push(`Assistive Technology Used: ${assistiveTechLabel(intake)}`);
  lines.push(`Task Attempted: ${intake.task_attempted}`);
  if (intake.consent_followup) {
    // Never write an unconfirmed contact into the audit output as if it were
    // a real delivery address -- a misheard/unconfirmed email means the
    // caller who reported the barrier never gets helped.
    if (intake.followup_contact_confirmed && intake.followup_contact) {
      lines.push(`Follow-up Contact: ${intake.followup_contact}`);
    } else {
      lines.push("Follow-up Contact: Contact unconfirmed, verify manually.");
    }
  }
  if (autoMatched) {
    // The row was selected by matching barrier_category to a WCAG *principle*
    // (Perceivable/Operable/Understandable/Robust), not the specific success
    // criterion -- this must never be mistaken for a final, human-reviewed
    // placement in an audit deliverable.
    lines.push("AUTO-MATCHED AT PRINCIPLE LEVEL, HUMAN REVIEW REQUIRED BEFORE AUDIT USE");
  }
  return lines;
}

// --- Core patch operations ---------------------------------------------------

function applyMappedRow(table, intake) {
  const rows = children(table, "w:tr");
  // Row 0 is the header ("Criteria" / "Conformance Level" / "Remarks and Explanations").
  for (let i = 1; i < rows.length; i++) {
    const cells = children(rows[i], "w:tc");
    if (cells.length < 3) continue;
    const criteriaText = getCellText(cells[0]);
    if (getCriterionCategory(criteriaText) !== intake.barrier_category) continue;
    if (!isUnfilledConformancePlaceholder(cells[1])) continue;
    setCellText(cells[1], [severityToConformanceLevel(intake.severity)]);
    setCellText(cells[2], buildRemarksParagraphs(intake, { autoMatched: true }));
    return { rowIndex: i, criteria: criteriaText };
  }
  return null;
}

function appendFlaggedRow(table, intake) {
  const rows = children(table, "w:tr");
  const lastRow = rows[rows.length - 1];
  // Clone the last row's XML structure (deep copy) so the new row inherits the
  // same borders/widths/run styling, then overwrite its three cells' text.
  const newRow = JSON.parse(JSON.stringify(lastRow));
  const cells = children(newRow, "w:tc");
  if (cells.length < 3) {
    throw new Error("Cannot append flagged row: last row does not have 3 cells");
  }
  setCellText(cells[0], ["Unmapped barrier - criterion not determined (see remarks)"]);
  setCellText(cells[1], [categoryToConformanceNote("unclear")]);
  setCellText(cells[2], buildRemarksParagraphs(intake));

  table.elements.push(newRow);
  return { rowIndex: rows.length, criteria: getCellText(cells[0]) };
}

async function buildVpatDocx({ templatePath, intake, tableIndex }) {
  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Template file not found: ${templatePath}\n` +
        "Pass --template with a valid path, e.g. skills/accesscall/assets/vpat-2.4-template-generic.docx",
    );
  }
  const templateBuffer = fs.readFileSync(templatePath);
  const zip = await JSZip.loadAsync(templateBuffer);

  const documentXmlFile = zip.file(DOCUMENT_XML_PATH);
  if (!documentXmlFile) {
    throw new Error(`${templatePath} does not contain ${DOCUMENT_XML_PATH} - not a valid .docx`);
  }
  const documentXmlText = await documentXmlFile.async("text");
  const documentJson = convert.xml2js(documentXmlText, {
    compact: false,
    captureSpacesBetweenElements: true,
  });

  const body = getBody(documentJson);
  const tables = getTables(body);

  let result;
  let mapped = null;
  if (intake.barrier_category !== "unclear") {
    const table = tables[tableIndex];
    if (!table) throw new Error(`Template does not have a table at index ${tableIndex}`);
    mapped = applyMappedRow(table, intake);
  }

  if (mapped) {
    result = { ...mapped, tableIndex, mode: "mapped" };
  } else {
    // Per spec: never guess a row placement -- this covers both an "unclear"
    // barrier_category and the case where barrier_category is known but no
    // unfilled placeholder row for that WCAG principle exists in the target
    // table. Always flag it on Table 3 (WCAG 2.x Level A) instead.
    const flagTableIndex = 3;
    const flagTable = tables[flagTableIndex];
    if (!flagTable) throw new Error(`Template does not have a table at index ${flagTableIndex}`);
    result = { ...appendFlaggedRow(flagTable, intake), tableIndex: flagTableIndex, mode: "flagged" };
  }

  const newDocumentXml = convert.js2xml(documentJson, {
    compact: false,
    attributeValueFn: (str) =>
      String(str)
        .replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;"),
  });
  zip.file(DOCUMENT_XML_PATH, newDocumentXml);

  const outputBuffer = await zip.generateAsync({
    type: "nodebuffer",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });

  return { outputBuffer, result };
}

// Re-opens the produced buffer with the `docx` package itself (patchDetector
// has to fully unzip and parse every XML part to scan for placeholder tags)
// plus a direct JSZip integrity check, so a corrupted output never passes
// silently.
async function verifyOutputDocx(buffer) {
  await JSZip.loadAsync(buffer); // throws if the zip container itself is broken
  await patchDetector({ data: buffer }); // throws if `docx` can't parse the XML parts
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input || !args["call-id"]) {
    console.error("Usage: node format-to-vpat.js --input <intake-result.json> --call-id <id> " +
      "[--template skills/accesscall/assets/vpat-2.4-template-generic.docx] " +
      "[--out vpat-intake-<call-id>.docx] [--table-index 3]");
    process.exitCode = 1;
    return;
  }

  const callId = args["call-id"];
  const templatePath = path.resolve(
    args.template || path.join(__dirname, "..", "assets", "vpat-2.4-template-generic.docx"),
  );
  const outPath = path.resolve(args.out || path.join(__dirname, `vpat-intake-${callId}.docx`));
  const tableIndex = args["table-index"] !== undefined ? parseInt(args["table-index"], 10) : 3;

  if (outPath === templatePath) {
    throw new Error("Refusing to write output to the same path as the template");
  }

  const intake = loadIntakeResult(path.resolve(args.input));
  validateIntakeResult(intake);

  console.log(`Loading template: ${templatePath}`);
  const { outputBuffer, result } = await buildVpatDocx({ templatePath, intake, tableIndex });

  fs.writeFileSync(outPath, outputBuffer);
  console.log(`Wrote: ${outPath}`);

  try {
    await verifyOutputDocx(outputBuffer);
  } catch (err) {
    console.error(`FAILED: output .docx is invalid or corrupted (${err.message})`);
    process.exitCode = 1;
    return;
  }

  if (result.mode === "flagged") {
    console.log(
      `SUCCESS: appended manual-review row (row ${result.rowIndex}) to table index ${result.tableIndex} ` +
        `for call ${callId}. Verified output is a valid .docx.`,
    );
  } else {
    console.log(
      `SUCCESS: updated row ${result.rowIndex} ("${result.criteria}") in table index ${result.tableIndex} ` +
        `for call ${callId}. Verified output is a valid .docx.`,
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`FAILED: ${err.message}`);
    process.exitCode = 1;
  });
}
