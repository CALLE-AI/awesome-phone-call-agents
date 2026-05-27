#!/usr/bin/env node

import fs from "node:fs";
import {
  DEFAULT_TEMPLATE_PATH,
  compileGoal,
  readTemplateOrContract,
  renderValue,
} from "./template-lib.mjs";

const HELP = `Usage:
  node skills/google-form-callback/scripts/extract-callback-candidates.mjs [options]

Options:
  --form <file>          Google Forms API form JSON.
  --responses <file>     Google Forms API responses JSON.
  --template <file>      Template markdown. Defaults to skills/google-form-callback/template.md.
  --contract <file>      Legacy form contract JSON.
  --state <file>         Optional JSON state with processedResponseIds or processedResponses.
  --submitted-after <time>  Include responses submitted at or after this RFC3339 UTC time.
  --submitted-before <time> Include responses submitted before this RFC3339 UTC time.
  --input <file>         Combined JSON input. Use "-" for stdin.
  --help                 Show this help.

Combined input shape:
  {
    "form": { ... },
    "responses": { "responses": [ ... ] },
    "template": { ... },
    "state": { "processedResponseIds": ["..."] }
  }

Multiple-form input shape:
  {
    "forms": [
      { "form": { ... }, "responses": { "responses": [ ... ] } }
    ],
    "template": { ... },
    "state": { "processedResponseIds": ["..."] }
  }
`;

const E164_RE = /^\+[1-9]\d{6,14}$/;
const FIELD_RE = /\bfield:\s*([a-z][a-z0-9_]*)\b/i;

function readJson(path) {
  const text = path === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path, "utf8");
  return JSON.parse(text);
}

function readOptionalJson(path) {
  if (!path || (path !== "-" && !fs.existsSync(path))) {
    return null;
  }
  return readJson(path);
}

function parseArgs(argv) {
  const result = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    i += 1;

    switch (key) {
      case "form":
      case "responses":
      case "template":
      case "contract":
      case "state":
      case "submitted-after":
      case "submitted-before":
      case "input":
        result[key] = next;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return result;
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [value];
}

function firstValue(value) {
  const values = asArray(value);
  return values.length > 0 ? String(values[0]) : "";
}

function parseRfc3339Utc(value, label) {
  if (!value) {
    return null;
  }
  const text = String(value).trim();
  if (!/[zZ]$/.test(text)) {
    throw new Error(`${label} must be an RFC3339 UTC timestamp ending in Z`);
  }
  const millis = Date.parse(text);
  if (Number.isNaN(millis)) {
    throw new Error(`${label} must be a valid RFC3339 UTC timestamp`);
  }
  return {
    text: text.replace(/z$/, "Z"),
    millis,
  };
}

function parseResponseTimeWindow({ args = {}, input = {} }) {
  const inputWindow = input.timeWindow || {};
  const submittedAfter = parseRfc3339Utc(
    args["submitted-after"] || args.submittedAfter || input.submittedAfter || inputWindow.submittedAfter,
    "--submitted-after"
  );
  const submittedBefore = parseRfc3339Utc(
    args["submitted-before"] || args.submittedBefore || input.submittedBefore || inputWindow.submittedBefore,
    "--submitted-before"
  );
  if (submittedAfter && submittedBefore && submittedAfter.millis >= submittedBefore.millis) {
    throw new Error("--submitted-after must be earlier than --submitted-before");
  }
  return {
    submittedAfter,
    submittedBefore,
  };
}

function hasResponseTimeWindow(timeWindow) {
  return Boolean(timeWindow?.submittedAfter || timeWindow?.submittedBefore);
}

function responseTimeWindowSummary(timeWindow) {
  if (!hasResponseTimeWindow(timeWindow)) {
    return null;
  }
  return {
    submittedAfter: timeWindow.submittedAfter?.text || null,
    submittedBefore: timeWindow.submittedBefore?.text || null,
    semantics: "submittedAfter is inclusive; submittedBefore is exclusive",
  };
}

function responseSubmittedMillis(response) {
  const timestamp = response.lastSubmittedTime || response.createTime || "";
  const millis = Date.parse(timestamp);
  return Number.isNaN(millis) ? null : millis;
}

function responseMatchesTimeWindow(response, timeWindow) {
  if (!hasResponseTimeWindow(timeWindow)) {
    return true;
  }
  const millis = responseSubmittedMillis(response);
  if (millis === null) {
    return false;
  }
  if (timeWindow.submittedAfter && millis < timeWindow.submittedAfter.millis) {
    return false;
  }
  if (timeWindow.submittedBefore && millis >= timeWindow.submittedBefore.millis) {
    return false;
  }
  return true;
}

function extractSlug(item) {
  const candidates = [
    item.description,
    item.helpText,
    item.questionItem?.question?.description,
    item.questionItem?.question?.helpText,
    item.title,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const match = candidate.match(FIELD_RE);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

function buildQuestionSlugMap(form) {
  const map = new Map();
  const ignoredItems = [];

  for (const item of form.items || []) {
    const questionId = item.questionItem?.question?.questionId;
    if (!questionId) {
      continue;
    }

    const slug = extractSlug(item);
    if (!slug) {
      ignoredItems.push({
        itemId: item.itemId,
        questionId,
        title: item.title || "",
        reason: "missing field slug",
      });
      continue;
    }

    map.set(questionId, {
      slug,
      title: item.title || slug,
    });
  }

  return { map, ignoredItems };
}

function extractAnswerValues(answer) {
  const textAnswers = answer?.textAnswers?.answers;
  if (Array.isArray(textAnswers)) {
    return textAnswers.map((entry) => entry.value).filter((value) => value !== undefined && value !== null);
  }

  const fileUploadAnswers = answer?.fileUploadAnswers?.answers;
  if (Array.isArray(fileUploadAnswers)) {
    return fileUploadAnswers
      .map((entry) => entry.fileId || entry.fileName || entry.mimeType)
      .filter((value) => value !== undefined && value !== null);
  }

  return [];
}

function normalizeResponses(responsesPayload, questionSlugMap) {
  const responses = Array.isArray(responsesPayload)
    ? responsesPayload
    : responsesPayload.responses || [];

  return responses.map((response, index) => {
    const fields = {};
    const unknownAnswers = [];

    for (const [questionId, answer] of Object.entries(response.answers || {})) {
      const mapping = questionSlugMap.get(questionId);
      if (!mapping) {
        unknownAnswers.push(questionId);
        continue;
      }

      const values = extractAnswerValues(answer);
      fields[mapping.slug] = values.length === 1 ? values[0] : values;
    }

    return {
      responseId: response.responseId || "",
      responseIndex: index,
      createTime: response.createTime || "",
      lastSubmittedTime: response.lastSubmittedTime || "",
      fields,
      unknownAnswers,
    };
  });
}

function processedResponseIdsFromState(state) {
  if (!state) {
    return new Set();
  }

  if (Array.isArray(state.processedResponseIds)) {
    return new Set(state.processedResponseIds.map(String));
  }

  if (state.processedResponses && typeof state.processedResponses === "object") {
    return new Set(Object.keys(state.processedResponses));
  }

  return new Set();
}

function maskPhoneNumber(phoneNumber) {
  const digits = phoneNumber.replace(/\D/g, "");
  const suffix = digits.slice(-4);
  const prefix = phoneNumber.startsWith("+") ? `+${digits.slice(0, 1)}` : "";
  return `${prefix}******${suffix}`;
}

function validateResponse(normalized, template, processedIds) {
  const fields = normalized.fields;
  const errors = [];

  if (!normalized.responseId) {
    errors.push("responseId is required");
  } else if (processedIds.has(normalized.responseId)) {
    errors.push("response was already processed");
  }

  for (const slug of template.requiredFields || []) {
    const value = fields[slug];
    if (asArray(value).length === 0 || firstValue(value).trim() === "") {
      errors.push(`${slug} is required`);
    }
  }

  const phoneNumber = firstValue(fields[template.phoneField]).trim();
  if (phoneNumber && !E164_RE.test(phoneNumber)) {
    errors.push(`${template.phoneField} must be E.164`);
  }

  return errors;
}

function consentBasisErrors(template, form) {
  const errors = [];
  if (template.submissionAuthorizesCallback !== true) {
    errors.push("template submissionAuthorizesCallback must be true");
  }
  const basisText = [form.info?.description, form.description, template.description]
    .map((value) => (value === undefined || value === null ? "" : String(value).trim()))
    .find(Boolean) || "";
  if (!basisText) {
    errors.push("form or template description must authorize phone follow-up");
  } else if (!/\b(call|callback|phone|telephone)\b/i.test(basisText)) {
    errors.push("form or template description must clearly mention phone or call follow-up");
  }
  return errors;
}

function buildCandidate(normalized, template, form) {
  const fields = normalized.fields;
  const phoneNumber = firstValue(fields[template.phoneField]).trim();
  const language = template.languageField
    ? firstValue(fields[template.languageField]).trim()
    : template.language;
  const goal = compileGoal(template.goalTemplate, fields);

  const providerRequest = {
    to_phones: [phoneNumber],
    goal,
  };

  if (language) {
    providerRequest.language = language;
  }

  return {
    formId: form.formId || form.info?.formId || "",
    formTitle: form.info?.title || form.title || template.title || "",
    responseId: normalized.responseId,
    responseIndex: normalized.responseIndex,
    createTime: normalized.createTime,
    lastSubmittedTime: normalized.lastSubmittedTime,
    status: "ready",
    templateName: template.name,
    maskedPhoneNumber: maskPhoneNumber(phoneNumber),
    recipientName: firstValue(fields[template.recipientNameField]).trim(),
    fields: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, renderValue(value)])
    ),
    writebackFields: {
      result: template.resultField,
      summary: template.summaryField,
    },
    providerRequest,
  };
}

export function extractCallbackCandidates({ form, responses, template, state, timeWindow }) {
  const { map, ignoredItems } = buildQuestionSlugMap(form);
  const normalizedResponses = normalizeResponses(responses, map);
  const inWindowResponses = normalizedResponses.filter((response) =>
    responseMatchesTimeWindow(response, timeWindow)
  );
  const outOfWindowCount = normalizedResponses.length - inWindowResponses.length;
  const processedIds = processedResponseIdsFromState(state);
  const globalErrors = consentBasisErrors(template, form);
  const candidates = [];
  const skipped = [];

  for (const normalized of inWindowResponses) {
    const errors = [
      ...globalErrors,
      ...validateResponse(normalized, template, processedIds),
    ];
    if (errors.length > 0) {
      skipped.push({
        formId: form.formId || form.info?.formId || "",
        responseId: normalized.responseId,
        maskedPhoneNumber: normalized.fields[template.phoneField]
          ? maskPhoneNumber(firstValue(normalized.fields[template.phoneField]).trim())
          : null,
        reasons: errors,
      });
      continue;
    }

    candidates.push(buildCandidate(normalized, template, form));
  }

  return {
    summary: {
      totalResponses: normalizedResponses.length,
      inWindowResponseCount: inWindowResponses.length,
      outOfWindowCount,
      candidateCount: candidates.length,
      readyCount: candidates.filter((candidate) => candidate.status === "ready").length,
      skippedCount: skipped.length,
      mappedQuestionCount: map.size,
      ignoredItemCount: ignoredItems.length,
      templateName: template.name,
      consentBasisOk: globalErrors.length === 0,
      timeWindow: responseTimeWindowSummary(timeWindow),
    },
    candidates,
    skipped,
    ignoredItems,
  };
}

function extractMultipleCallbackCandidates({ forms, template, state, timeWindow }) {
  const outputs = forms.map((entry) =>
    extractCallbackCandidates({
      form: entry.form,
      responses: entry.responses,
      template,
      state,
      timeWindow,
    })
  );

  return {
    summary: {
      formCount: forms.length,
      totalResponses: outputs.reduce((sum, output) => sum + output.summary.totalResponses, 0),
      inWindowResponseCount: outputs.reduce(
        (sum, output) => sum + output.summary.inWindowResponseCount,
        0
      ),
      outOfWindowCount: outputs.reduce((sum, output) => sum + output.summary.outOfWindowCount, 0),
      candidateCount: outputs.reduce((sum, output) => sum + output.summary.candidateCount, 0),
      readyCount: outputs.reduce((sum, output) => sum + output.summary.readyCount, 0),
      skippedCount: outputs.reduce((sum, output) => sum + output.summary.skippedCount, 0),
      ignoredItemCount: outputs.reduce((sum, output) => sum + output.summary.ignoredItemCount, 0),
      templateName: template.name,
      consentBasisOk: outputs.every((output) => output.summary.consentBasisOk),
      timeWindow: responseTimeWindowSummary(timeWindow),
    },
    candidates: outputs.flatMap((output) => output.candidates),
    skipped: outputs.flatMap((output) => output.skipped),
    ignoredItems: outputs.flatMap((output) => output.ignoredItems),
  };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(HELP);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  try {
    let input = {};
    if (args.input) {
      input = readJson(args.input);
    }

    const form = input.form || (args.form ? readJson(args.form) : null);
    const responses = input.responses || (args.responses ? readJson(args.responses) : null);
    const forms = input.forms || null;
    const template = readTemplateOrContract({
      templatePath: args.template || (!args.contract ? DEFAULT_TEMPLATE_PATH : null),
      contractPath: args.contract,
      inputTemplate: input.template,
      inputContract: input.contract,
    });
    const state = input.state || readOptionalJson(args.state);
    const timeWindow = parseResponseTimeWindow({ args, input });

    if (forms) {
      const output = extractMultipleCallbackCandidates({ forms, template, state, timeWindow });
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      return;
    }

    if (!form) {
      throw new Error("--form or input.form is required");
    }
    if (!responses) {
      throw new Error("--responses or input.responses is required");
    }

    const output = extractCallbackCandidates({ form, responses, template, state, timeWindow });
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
