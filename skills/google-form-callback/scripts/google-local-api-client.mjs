#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  getAccessToken,
  readToken,
  redactTokenForStatus,
  refreshAccessToken,
  resolveCredentialsPath,
  resolveTokenPath,
} from "./google-oauth-lib.mjs";

const HELP = `Usage:
  node skills/google-form-callback/scripts/google-local-api-client.mjs [options]

Options:
  --action <name>           Action: health, list-forms, export, or writeback. Defaults to health.
  --form-id <id>            Google Form ID for export. Repeat for multiple forms.
  --discover-forms          Discover accessible Google Forms through Drive API for export.
  --form-name-contains <s>  Limit discovered forms to names containing this text.
  --max-forms <n>           Maximum discovered forms to process.
  --submitted-after <time>  Include responses submitted at or after this RFC3339 UTC time.
  --submitted-before <time> Include responses submitted before this RFC3339 UTC time.
  --writeback <file>        Writeback JSON file for the writeback action.
  --output <file>           Output JSON file. Defaults to stdout.
  --credentials <file>      Google OAuth desktop client JSON.
  --token <file>            Local token cache path.
  --print-envelope          Print action metadata for export instead of only data.
  --help                    Show this help.

Examples:
  node skills/google-form-callback/scripts/google-auth.mjs login \\
    --credentials ~/.config/google-form-callback/oauth-client.json

  node skills/google-form-callback/scripts/google-local-api-client.mjs \\
    --action export \\
    --discover-forms \\
    --submitted-after "2026-05-26T00:00:00Z" \\
    --submitted-before "2026-05-27T00:00:00Z" \\
    --output account-form-export.json

  node skills/google-form-callback/scripts/google-local-api-client.mjs \\
    --action list-forms \\
    --form-name-contains "Quote"

  node skills/google-form-callback/scripts/google-local-api-client.mjs \\
    --action export \\
    --form-id "FORM_ID" \\
    --output form-export.json

  node skills/google-form-callback/scripts/google-local-api-client.mjs \\
    --action writeback \\
    --writeback callback-writeback.json
`;

const LEGACY_CALL_RESULTS_SHEET_TITLE = "Call Results";
const GOOGLE_FORM_MIME_TYPE = "application/vnd.google-apps.form";
const RESPONSE_ID_COLUMN = "response_id";

function parseArgs(argv) {
  const result = {
    action: "health",
    formIds: [],
    printEnvelope: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--print-envelope") {
      result.printEnvelope = true;
      continue;
    }
    if (arg === "--discover-forms") {
      result.discoverForms = true;
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
      case "action":
        result.action = next;
        break;
      case "form-id":
        result.formIds.push(next);
        break;
      case "form-name-contains":
        result.formNameContains = next;
        break;
      case "max-forms":
        result.maxForms = Number.parseInt(next, 10);
        if (!Number.isInteger(result.maxForms) || result.maxForms < 1) {
          throw new Error("--max-forms must be a positive integer");
        }
        break;
      case "submitted-after":
        result.submittedAfter = next;
        break;
      case "submitted-before":
        result.submittedBefore = next;
        break;
      case "writeback":
        result.writeback = next;
        break;
      case "output":
        result.output = next;
        break;
      case "credentials":
        result.credentials = next;
        break;
      case "token":
        result.token = next;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return result;
}

function readJson(pathName) {
  return JSON.parse(fs.readFileSync(pathName, "utf8"));
}

function writeJson(pathName, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (!pathName || pathName === "-") {
    process.stdout.write(text);
    return;
  }
  const dir = path.dirname(path.resolve(pathName));
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(pathName)}.${process.pid}.tmp`);
  fs.writeFileSync(tmpPath, text);
  fs.renameSync(tmpPath, pathName);
}

function escapeSheetTitle(title) {
  return String(title).replace(/'/g, "''");
}

function sheetRange(sheetTitle, range) {
  return `'${escapeSheetTitle(sheetTitle)}'!${range}`;
}

function rangePath(range) {
  return encodeURIComponent(range);
}

function columnName(index) {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function parseRfc3339Utc(value, optionName) {
  if (!value) {
    return null;
  }
  const text = String(value).trim();
  if (!/[zZ]$/.test(text)) {
    throw new Error(`${optionName} must be an RFC3339 UTC timestamp ending in Z`);
  }
  const millis = Date.parse(text);
  if (Number.isNaN(millis)) {
    throw new Error(`${optionName} must be a valid RFC3339 UTC timestamp`);
  }
  return {
    text: text.replace(/z$/, "Z"),
    millis,
  };
}

function parseResponseTimeWindow(args) {
  const submittedAfter = parseRfc3339Utc(args.submittedAfter, "--submitted-after");
  const submittedBefore = parseRfc3339Utc(args.submittedBefore, "--submitted-before");
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

function filterResponsesByTimeWindow(responsesPayload, timeWindow) {
  if (!hasResponseTimeWindow(timeWindow)) {
    return responsesPayload;
  }
  return {
    responses: (responsesPayload.responses || []).filter((response) =>
      responseMatchesTimeWindow(response, timeWindow)
    ),
  };
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

function escapeDriveQueryLiteral(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function formQuestionTitles(form) {
  return (form.items || [])
    .filter((item) => item.questionItem?.question)
    .map((item) => String(item.title || "").trim())
    .filter(Boolean);
}

async function googleRequest(accessToken, url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data.error?.message || text || response.statusText;
    throw new Error(`Google API request failed with HTTP ${response.status}: ${message}`);
  }
  return data;
}

async function optionalGoogleRequest(accessToken, url) {
  try {
    return await googleRequest(accessToken, url);
  } catch (error) {
    if (String(error.message).includes("HTTP 400") || String(error.message).includes("HTTP 404")) {
      return null;
    }
    throw error;
  }
}

async function getForm(accessToken, formId) {
  return googleRequest(accessToken, `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}`);
}

async function listDriveForms(accessToken, options = {}) {
  const forms = [];
  let pageToken = "";
  const queryParts = [
    `mimeType='${GOOGLE_FORM_MIME_TYPE}'`,
    "trashed=false",
  ];
  if (options.formNameContains) {
    queryParts.push(`name contains '${escapeDriveQueryLiteral(options.formNameContains)}'`);
  }

  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", queryParts.join(" and "));
    url.searchParams.set("spaces", "drive");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("orderBy", "modifiedTime desc");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set(
      "fields",
      "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,webViewLink,owners(displayName,emailAddress))"
    );
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const page = await googleRequest(accessToken, url.toString());
    for (const file of page.files || []) {
      forms.push({
        formId: file.id,
        name: file.name || file.id,
        mimeType: file.mimeType,
        createdTime: file.createdTime || "",
        modifiedTime: file.modifiedTime || "",
        webViewLink: file.webViewLink || "",
        owners: (file.owners || []).map((owner) => ({
          displayName: owner.displayName || "",
          emailAddress: owner.emailAddress || "",
        })),
      });
      if (options.maxForms && forms.length >= options.maxForms) {
        return forms;
      }
    }
    pageToken = page.nextPageToken || "";
  } while (pageToken);

  return forms;
}

async function listResponses(accessToken, formId, timeWindow = {}) {
  const responses = [];
  let pageToken = "";
  do {
    const url = new URL(`https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}/responses`);
    url.searchParams.set("pageSize", "5000");
    if (timeWindow.submittedAfter) {
      url.searchParams.set("filter", `timestamp >= ${timeWindow.submittedAfter.text}`);
    }
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }
    const page = await googleRequest(accessToken, url.toString());
    responses.push(...(page.responses || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return filterResponsesByTimeWindow({ responses }, timeWindow);
}

async function getSpreadsheetMetadata(accessToken, spreadsheetId) {
  return googleRequest(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`
  );
}

async function readValues(accessToken, spreadsheetId, range) {
  const result = await optionalGoogleRequest(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${rangePath(range)}`
  );
  return result?.values || [];
}

async function findResponseSheet(accessToken, spreadsheetId, form) {
  const metadata = await getSpreadsheetMetadata(accessToken, spreadsheetId);
  const titles = formQuestionTitles(form);
  let best = null;

  for (const sheet of metadata.sheets || []) {
    const title = sheet.properties?.title;
    if (!title || title === LEGACY_CALL_RESULTS_SHEET_TITLE) {
      continue;
    }
    const values = await readValues(accessToken, spreadsheetId, sheetRange(title, "1:1"));
    const headers = (values[0] || []).map((header) => String(header).trim());
    const headerSet = new Set(headers);
    const score = titles.filter((questionTitle) => headerSet.has(questionTitle)).length;
    const timestampBonus = headerSet.has("Timestamp") ? 1 : 0;
    const candidate = {
      title,
      headers,
      score: score + timestampBonus,
      matchedQuestionCount: score,
    };
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  if (!best || best.matchedQuestionCount === 0) {
    throw new Error(
      `Could not identify the linked Form Responses sheet in spreadsheet ${spreadsheetId}.`
    );
  }

  return best;
}

function rowsToObjects(values) {
  if (values.length < 2) {
    return [];
  }
  const headers = values[0].map((header) => String(header));
  return values.slice(1).map((row) => {
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = row[index] === undefined ? "" : String(row[index]);
    });
    return entry;
  });
}

function normalizeCell(value) {
  return String(value || "").trim().replace(/\s+/gu, " ");
}

function normalizeComparable(value) {
  return normalizeCell(value).toLowerCase();
}

function questionTitleById(form) {
  const output = new Map();
  for (const item of form.items || []) {
    const questionId = item.questionItem?.question?.questionId;
    const title = normalizeCell(item.title);
    if (questionId && title) {
      output.set(String(questionId), title);
    }
  }
  return output;
}

function responseAnswersByTitle(form, response) {
  const titles = questionTitleById(form);
  const output = new Map();
  for (const [questionId, answer] of Object.entries(response.answers || {})) {
    const title = titles.get(String(questionId));
    if (!title) {
      continue;
    }
    const values = (answer.textAnswers?.answers || [])
      .map((entry) => normalizeCell(entry.value))
      .filter(Boolean);
    if (values.length > 0) {
      output.set(title, values);
    }
  }
  return output;
}

function valuesMatchCell(values, cell) {
  const normalizedCell = normalizeComparable(cell);
  if (!normalizedCell) {
    return false;
  }
  const normalizedValues = values.map(normalizeComparable).filter(Boolean);
  if (normalizedValues.length === 0) {
    return false;
  }
  if (normalizedValues.length === 1) {
    return normalizedCell === normalizedValues[0];
  }
  const joinedComma = normalizedValues.join(", ");
  const joinedPipe = normalizedValues.join(" | ");
  return normalizedCell === joinedComma || normalizedCell === joinedPipe;
}

function responseRowMatch(form, response, headers, row) {
  const answers = responseAnswersByTitle(form, response);
  let comparableCount = 0;
  let matchedCount = 0;

  for (const [title, values] of answers.entries()) {
    const columnIndex = headers.indexOf(title);
    if (columnIndex < 0) {
      continue;
    }
    comparableCount += 1;
    if (valuesMatchCell(values, row[columnIndex])) {
      matchedCount += 1;
    }
  }

  return {
    comparableCount,
    matchedCount,
    matches: comparableCount > 0 && comparableCount === matchedCount,
  };
}

function rowCompatibleWithResponse(form, response, headers, row) {
  const match = responseRowMatch(form, response, headers, row);
  return match.comparableCount === 0 || match.matches;
}

function findBestResponseForRow(form, responses, headers, row, usedResponseIds) {
  let best = null;
  let tied = false;

  for (const response of responses) {
    const responseId = String(response.responseId || "");
    if (!responseId || usedResponseIds.has(responseId)) {
      continue;
    }

    const match = responseRowMatch(form, response, headers, row);
    if (!match.matches) {
      continue;
    }

    if (!best || match.matchedCount > best.matchedCount) {
      best = {
        response,
        responseId,
        matchedCount: match.matchedCount,
      };
      tied = false;
    } else if (match.matchedCount === best.matchedCount) {
      tied = true;
    }
  }

  return best && !tied ? best : null;
}

async function exportFormBundle(accessToken, formId, timeWindow, driveFile = null) {
  const form = await getForm(accessToken, formId);
  const responses = await listResponses(accessToken, formId, timeWindow);
  let callResults = [];
  if (form.linkedSheetId) {
    try {
      const responseSheet = await findResponseSheet(accessToken, form.linkedSheetId, form);
      const values = await readValues(
        accessToken,
        form.linkedSheetId,
        sheetRange(responseSheet.title, "A:ZZ")
      );
      callResults = rowsToObjects(values).filter((row) => row[RESPONSE_ID_COLUMN]);
    } catch {
      callResults = [];
    }
  }
  return {
    form,
    responses,
    callResults,
    ...(driveFile ? { driveFile } : {}),
  };
}

async function exportForms(accessToken, formEntries, timeWindow, options = {}) {
  const exports = [];
  const formErrors = [];
  for (const entry of formEntries) {
    const formId = typeof entry === "string" ? entry : entry.formId;
    const driveFile = typeof entry === "string" ? null : entry;
    try {
      exports.push(await exportFormBundle(accessToken, formId, timeWindow, driveFile));
    } catch (error) {
      if (!options.ignoreFormErrors) {
        throw error;
      }
      formErrors.push({
        formId,
        name: driveFile?.name || "",
        error: error.message,
      });
    }
  }
  const timeWindowSummary = responseTimeWindowSummary(timeWindow);
  const output = {
    ...(exports.length === 1 && !options.forceFormsArray ? exports[0] : { forms: exports }),
    ...(timeWindowSummary ? { timeWindow: timeWindowSummary } : {}),
    ...(options.discoveredForms ? { discoveredForms: options.discoveredForms } : {}),
    ...(formErrors.length > 0 ? { formErrors } : {}),
  };
  return {
    ok: true,
    formCount: exports.length,
    requestedFormCount: formEntries.length,
    failedFormCount: formErrors.length,
    responseCount: exports.reduce((sum, entry) => sum + entry.responses.responses.length, 0),
    timeWindow: timeWindowSummary,
    formErrors,
    data: output,
  };
}

async function updateValues(accessToken, spreadsheetId, range, values) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${rangePath(range)}`
  );
  url.searchParams.set("valueInputOption", "RAW");
  return googleRequest(accessToken, url.toString(), {
    method: "PUT",
    body: {
      range,
      majorDimension: "ROWS",
      values,
    },
  });
}

async function appendValues(accessToken, spreadsheetId, range, values) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${rangePath(range)}:append`
  );
  url.searchParams.set("valueInputOption", "RAW");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");
  return googleRequest(accessToken, url.toString(), {
    method: "POST",
    body: {
      range,
      majorDimension: "ROWS",
      values,
    },
  });
}

async function batchUpdateValues(accessToken, spreadsheetId, data) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`
  );
  return googleRequest(accessToken, url.toString(), {
    method: "POST",
    body: {
      valueInputOption: "RAW",
      data,
    },
  });
}

async function ensureResponseSheetColumns(accessToken, spreadsheetId, sheetTitle, columnNames) {
  const values = await readValues(accessToken, spreadsheetId, sheetRange(sheetTitle, "A:ZZ"));
  const headers = [...((values[0] || []).map((header) => String(header)))];
  let changed = false;

  for (const columnNameValue of columnNames) {
    if (!headers.includes(columnNameValue)) {
      headers.push(columnNameValue);
      changed = true;
    }
  }

  if (changed) {
    const endColumn = columnName(headers.length - 1);
    await updateValues(accessToken, spreadsheetId, sheetRange(sheetTitle, `A1:${endColumn}1`), [
      headers,
    ]);
  }

  return {
    headers,
    values: changed
      ? await readValues(accessToken, spreadsheetId, sheetRange(sheetTitle, "A:ZZ"))
      : values,
  };
}

async function backfillResponseIds(accessToken, spreadsheetId, sheetTitle, values, headers, form, responses) {
  const responseIdColumnIndex = headers.indexOf(RESPONSE_ID_COLUMN);
  if (responseIdColumnIndex < 0 || responses.length === 0) {
    return values;
  }

  const responseIdColumnLetter = columnName(responseIdColumnIndex);
  const responseById = new Map(
    responses
      .map((response) => [String(response.responseId || ""), response])
      .filter(([responseId]) => responseId)
  );
  const usedResponseIds = new Set();
  const rows = [];
  let changed = false;

  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] || [];
    const existing = String(row[responseIdColumnIndex] || "");
    const existingResponse = responseById.get(existing);
    if (
      existingResponse &&
      rowCompatibleWithResponse(form, existingResponse, headers, row) &&
      !usedResponseIds.has(existing)
    ) {
      usedResponseIds.add(existing);
      rows.push([existing]);
      continue;
    }

    const best = findBestResponseForRow(form, responses, headers, row, usedResponseIds);
    if (best) {
      usedResponseIds.add(best.responseId);
      rows.push([best.responseId]);
      if (best.responseId !== existing) {
        changed = true;
      }
      continue;
    }

    rows.push([existing]);
  }

  if (rows.length === 0) {
    return values;
  }
  if (!changed) {
    return values;
  }

  await updateValues(
    accessToken,
    spreadsheetId,
    sheetRange(sheetTitle, `${responseIdColumnLetter}2:${responseIdColumnLetter}${rows.length + 1}`),
    rows
  );

  return readValues(accessToken, spreadsheetId, sheetRange(sheetTitle, "A:ZZ"));
}

function timestampsMatch(left, right) {
  if (!left || !right) {
    return false;
  }
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return String(left) === String(right);
  }
  return Math.abs(leftTime - rightTime) < 1000;
}

function findResponseById(responses, responseId) {
  return responses.find((response) => String(response.responseId || "") === responseId) || null;
}

function resolveResponseRow(form, values, entry, responses) {
  const responseId = String(entry.responseId || "");
  const headers = (values[0] || []).map((header) => String(header));
  const responseIdColumnIndex = headers.indexOf(RESPONSE_ID_COLUMN);
  const targetResponse = findResponseById(responses, responseId);

  if (responseIdColumnIndex >= 0 && targetResponse) {
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i] || [];
      if (
        String(row[responseIdColumnIndex] || "") === responseId &&
        rowCompatibleWithResponse(form, targetResponse, headers, row)
      ) {
        return {
          rowNumber: i + 1,
          canonicalResponseId: responseId,
          matchMode: "response_id_column",
        };
      }
    }
  }

  if (targetResponse) {
    let best = null;
    let tied = false;
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i] || [];
      const match = responseRowMatch(form, targetResponse, headers, row);
      if (!match.matches) {
        continue;
      }
      if (!best || match.matchedCount > best.matchedCount) {
        best = { rowNumber: i + 1, matchedCount: match.matchedCount };
        tied = false;
      } else if (match.matchedCount === best.matchedCount) {
        tied = true;
      }
    }
    if (best && !tied) {
      return {
        rowNumber: best.rowNumber,
        canonicalResponseId: responseId,
        matchMode: "response_answer_values",
      };
    }
  }

  const responseRows = Math.max(values.length - 1, 0);
  if (responses.length === 1 && responseRows <= 1) {
    return {
      rowNumber: 2,
      canonicalResponseId: String(responses[0].responseId || responseId),
      matchMode: "single_response_fallback",
    };
  }

  throw new Error(`Could not find response ${responseId} in Forms API response list.`);
}

async function writebackOne(accessToken, entry) {
  const formId = entry.formId;
  if (!formId) {
    throw new Error("writeback entry is missing formId");
  }
  if (!entry.responseId) {
    throw new Error("writeback entry is missing responseId");
  }

  const resultField = entry.resultField || "call_result";
  const summaryField = entry.summaryField || "call_summary";
  const form = await getForm(accessToken, formId);
  if (!form.linkedSheetId) {
    throw new Error(
      `Form ${formId} has no linkedSheetId. Link a response spreadsheet in Google Forms before using local OAuth writeback.`
    );
  }

  const responses = (await listResponses(accessToken, formId)).responses || [];
  const responseSheet = await findResponseSheet(accessToken, form.linkedSheetId, form);
  let { headers, values } = await ensureResponseSheetColumns(
    accessToken,
    form.linkedSheetId,
    responseSheet.title,
    [RESPONSE_ID_COLUMN, resultField, summaryField]
  );
  values = await backfillResponseIds(
    accessToken,
    form.linkedSheetId,
    responseSheet.title,
    values,
    headers,
    form,
    responses
  );
  headers = (values[0] || []).map((header) => String(header));

  const resolved = resolveResponseRow(form, values, entry, responses);
  const rowNumber = resolved.rowNumber;
  const resultColumnIndex = headers.indexOf(resultField);
  const summaryColumnIndex = headers.indexOf(summaryField);
  const responseIdColumnIndex = headers.indexOf(RESPONSE_ID_COLUMN);

  await batchUpdateValues(
    accessToken,
    form.linkedSheetId,
    [
      {
        range: sheetRange(responseSheet.title, `${columnName(responseIdColumnIndex)}${rowNumber}`),
        values: [[resolved.canonicalResponseId]],
      },
      {
        range: sheetRange(responseSheet.title, `${columnName(resultColumnIndex)}${rowNumber}`),
        values: [[String(entry[resultField] || "")]],
      },
      {
        range: sheetRange(responseSheet.title, `${columnName(summaryColumnIndex)}${rowNumber}`),
        values: [[String(entry[summaryField] || "")]],
      },
    ]
  );

  return {
    formId,
    responseId: resolved.canonicalResponseId,
    inputResponseId: entry.responseId,
    updated: true,
    sheetTitle: responseSheet.title,
    rowNumber,
    matchMode: resolved.matchMode,
    mode: "response-sheet",
  };
}

async function writeback(accessToken, writebackPath) {
  const payload = readJson(writebackPath);
  if (!Array.isArray(payload.results)) {
    throw new Error("--writeback file must contain a results array");
  }
  const results = [];
  for (const entry of payload.results) {
    results.push(await writebackOne(accessToken, entry));
  }
  return {
    ok: true,
    results,
  };
}

async function main() {
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

  if (!["health", "list-forms", "export", "writeback"].includes(args.action)) {
    console.error(`Unsupported action: ${args.action}`);
    console.error(HELP);
    process.exit(2);
  }

  const credentialsPath = resolveCredentialsPath(args.credentials);
  const tokenPath = resolveTokenPath(args.token);
  const timeWindow = parseResponseTimeWindow(args);

  if (args.action === "health") {
    const current = readToken(tokenPath);
    const refreshed = current
      ? await refreshAccessToken({ credentialsPath, tokenPath })
      : null;
    writeJson(args.output, {
      ok: true,
      credentialsPath,
      tokenPath,
      ...redactTokenForStatus(refreshed),
    });
    return;
  }

  const accessToken = await getAccessToken({ credentialsPath, tokenPath });
  if (args.action === "list-forms") {
    const forms = await listDriveForms(accessToken, {
      formNameContains: args.formNameContains,
      maxForms: args.maxForms,
    });
    writeJson(args.output, {
      ok: true,
      formCount: forms.length,
      forms,
    });
    return;
  }

  if (args.action === "export") {
    let discoveredForms = [];
    if (args.discoverForms) {
      discoveredForms = await listDriveForms(accessToken, {
        formNameContains: args.formNameContains,
        maxForms: args.maxForms,
      });
    }
    const formEntries = [
      ...args.formIds.map((formId) => ({ formId })),
      ...discoveredForms,
    ];
    const seen = new Set();
    const uniqueFormEntries = formEntries.filter((entry) => {
      const formId = String(entry.formId || "");
      if (!formId || seen.has(formId)) {
        return false;
      }
      seen.add(formId);
      return true;
    });
    if (uniqueFormEntries.length === 0) {
      throw new Error("--form-id or --discover-forms is required with --action export");
    }
    const response = await exportForms(accessToken, uniqueFormEntries, timeWindow, {
      forceFormsArray: args.discoverForms || uniqueFormEntries.length > 1,
      ignoreFormErrors: args.discoverForms,
      discoveredForms: args.discoverForms ? discoveredForms : null,
    });
    writeJson(args.output, args.printEnvelope ? response : response.data);
    return;
  }

  if (args.action === "writeback") {
    if (!args.writeback) {
      throw new Error("--writeback is required with --action writeback");
    }
    writeJson(args.output, await writeback(accessToken, args.writeback));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
