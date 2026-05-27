/**
 * Exports one or more Lead Quote Callback forms and responses into the JSON
 * shape used by skills/google-form-callback/scripts/extract-callback-candidates.mjs.
 *
 * Paste real form IDs into CALLBACK_REQUEST_FORM_IDS, then run
 * exportCallbackRequestFormData(). The script creates a JSON file in Google
 * Drive and logs its URL.
 *
 * For agent-operated runs, deploy this script as a Web App after setting
 * CALLBACK_API_TOKEN. The Web App accepts:
 * - { "token": "...", "action": "health" }
 * - { "token": "...", "action": "export", "formIds": ["..."] }
 * - { "token": "...", "action": "export", "formIds": ["..."],
 *     "submittedAfter": "2026-05-26T00:00:00Z",
 *     "submittedBefore": "2026-05-27T00:00:00Z" }
 * - { "token": "...", "action": "writeback", "results": [...] }
 */
const CALLBACK_REQUEST_FORM_IDS = ["PASTE_FORM_ID_HERE"];
const CALLBACK_API_TOKEN = "CHANGE_ME";
const CALLBACK_WRITEBACK_TOKEN = "CHANGE_ME";
const LEGACY_CALL_RESULTS_SHEET_TITLE = "Call Results";
const RESPONSE_ID_COLUMN = "response_id";

function exportCallbackRequestFormData() {
  if (
    CALLBACK_REQUEST_FORM_IDS.length === 0 ||
    CALLBACK_REQUEST_FORM_IDS[0] === "PASTE_FORM_ID_HERE"
  ) {
    throw new Error("Set CALLBACK_REQUEST_FORM_IDS before running this script.");
  }

  return exportCallbackRequestFormDataForIds(CALLBACK_REQUEST_FORM_IDS);
}

function exportCallbackRequestFormDataForIds(formIds, options) {
  const bundle = buildCallbackRequestExportForIds_(formIds, options);
  const json = JSON.stringify(bundle.output, null, 2);
  const timestamp = Utilities.formatDate(new Date(), "UTC", "yyyyMMdd-HHmmss");
  const file = DriveApp.createFile(
    `callback-request-form-export-${timestamp}.json`,
    json,
    MimeType.PLAIN_TEXT
  );

  const result = {
    formCount: bundle.formCount,
    responseCount: bundle.responseCount,
    timeWindow: bundle.timeWindow,
    exportFileUrl: file.getUrl(),
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function buildCallbackRequestExportForIds_(formIds, options) {
  const ids = assertFormIds_(formIds);
  const timeWindow = responseTimeWindowFromOptions_(options);
  const exports = ids.map((formId) => exportCallbackRequestFormDataForId_(formId, timeWindow));
  const timeWindowSummary = responseTimeWindowSummary_(timeWindow);
  const output = exports.length === 1 ? exports[0] : { forms: exports };
  if (timeWindowSummary) {
    output.timeWindow = timeWindowSummary;
  }
  return {
    formCount: exports.length,
    responseCount: exports.reduce((sum, entry) => {
      return sum + entry.responses.responses.length;
    }, 0),
    timeWindow: timeWindowSummary,
    output,
  };
}

function assertFormIds_(formIds) {
  const ids = (formIds || []).map((formId) => String(formId).trim()).filter(Boolean);
  if (ids.length === 0 || ids[0] === "PASTE_FORM_ID_HERE") {
    throw new Error("At least one form ID is required.");
  }
  return ids;
}

function exportCallbackRequestFormDataForId_(formId, timeWindow) {
  const form = FormApp.openById(formId);
  return {
    form: exportFormMetadata_(form),
    responses: exportFormResponses_(form, timeWindow),
    callResults: exportCallResults_(form),
  };
}

function exportFormMetadata_(form) {
  return {
    formId: form.getId(),
    info: {
      title: form.getTitle(),
      documentTitle: form.getTitle(),
    },
    items: form.getItems().map((item) => {
      const questionId = String(item.getId());
      return {
        itemId: questionId,
        title: item.getTitle(),
        description: item.getHelpText(),
        questionItem: {
          question: {
            questionId,
          },
        },
      };
    }),
  };
}

function exportFormResponses_(form, timeWindow) {
  const formResponses = formResponsesForTimeWindow_(form, timeWindow);
  const responses = formResponses.map((response, index) => {
    const responseId =
      typeof response.getId === "function"
        ? response.getId()
        : `response-${index + 1}-${response.getTimestamp().toISOString()}`;

    const answers = {};
    response.getItemResponses().forEach((itemResponse) => {
      const questionId = String(itemResponse.getItem().getId());
      const value = itemResponse.getResponse();
      const values = Array.isArray(value) ? value : [value];
      answers[questionId] = {
        questionId,
        textAnswers: {
          answers: values
            .filter((entry) => entry !== null && entry !== undefined && String(entry).trim() !== "")
            .map((entry) => ({ value: String(entry) })),
        },
      };
    });

    return {
      responseId: String(responseId),
      createTime: response.getTimestamp().toISOString(),
      lastSubmittedTime: response.getTimestamp().toISOString(),
      answers,
    };
  });

  return { responses };
}

function parseRfc3339Utc_(value, fieldName) {
  if (!value) {
    return null;
  }
  const text = String(value).trim();
  if (!/[zZ]$/.test(text)) {
    throw new Error(fieldName + " must be an RFC3339 UTC timestamp ending in Z.");
  }
  const date = new Date(text);
  const millis = date.getTime();
  if (isNaN(millis)) {
    throw new Error(fieldName + " must be a valid RFC3339 UTC timestamp.");
  }
  return {
    text: text.replace(/z$/, "Z"),
    date,
    millis,
  };
}

function responseTimeWindowFromOptions_(options) {
  const opts = options || {};
  const submittedAfter = parseRfc3339Utc_(opts.submittedAfter, "submittedAfter");
  const submittedBefore = parseRfc3339Utc_(opts.submittedBefore, "submittedBefore");
  if (submittedAfter && submittedBefore && submittedAfter.millis >= submittedBefore.millis) {
    throw new Error("submittedAfter must be earlier than submittedBefore.");
  }
  return {
    submittedAfter,
    submittedBefore,
  };
}

function hasResponseTimeWindow_(timeWindow) {
  return Boolean(timeWindow && (timeWindow.submittedAfter || timeWindow.submittedBefore));
}

function responseTimeWindowSummary_(timeWindow) {
  if (!hasResponseTimeWindow_(timeWindow)) {
    return null;
  }
  return {
    submittedAfter: timeWindow.submittedAfter ? timeWindow.submittedAfter.text : null,
    submittedBefore: timeWindow.submittedBefore ? timeWindow.submittedBefore.text : null,
    semantics: "submittedAfter is inclusive; submittedBefore is exclusive",
  };
}

function formResponsesForTimeWindow_(form, timeWindow) {
  let responses;
  if (timeWindow && timeWindow.submittedAfter) {
    const queryAfter = new Date(Math.max(timeWindow.submittedAfter.millis - 1, 0));
    responses = form.getResponses(queryAfter);
  } else {
    responses = form.getResponses();
  }
  if (!hasResponseTimeWindow_(timeWindow)) {
    return responses;
  }
  return responses.filter((response) => responseMatchesTimeWindow_(response, timeWindow));
}

function responseMatchesTimeWindow_(response, timeWindow) {
  const millis = response.getTimestamp().getTime();
  if (timeWindow.submittedAfter && millis < timeWindow.submittedAfter.millis) {
    return false;
  }
  if (timeWindow.submittedBefore && millis >= timeWindow.submittedBefore.millis) {
    return false;
  }
  return true;
}

function exportCallResults_(form) {
  const spreadsheetId = form.getDestinationId();
  if (!spreadsheetId) {
    return [];
  }

  const sheet = findResponseSheet_(form);
  if (!sheet) {
    return [];
  }
  const values = sheet.getDataRange().getValues();
  return rowsToObjects_(values).filter((row) => row[RESPONSE_ID_COLUMN]);
}

function rowsToObjects_(values) {
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

function questionTitles_(form) {
  return form
    .getItems()
    .map((item) => String(item.getTitle() || "").trim())
    .filter(Boolean);
}

function findResponseSheet_(form) {
  const spreadsheetId = form.getDestinationId();
  if (!spreadsheetId) {
    return null;
  }
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const titles = questionTitles_(form);
  let best = null;
  spreadsheet.getSheets().forEach((sheet) => {
    if (sheet.getName() === LEGACY_CALL_RESULTS_SHEET_TITLE) {
      return;
    }
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map((header) => String(header));
    const score = titles.filter((title) => headers.indexOf(title) >= 0).length;
    const timestampBonus = headers.indexOf("Timestamp") >= 0 ? 1 : 0;
    const candidate = {
      sheet,
      score: score + timestampBonus,
      matchedQuestionCount: score,
    };
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  });
  return best && best.matchedQuestionCount > 0 ? best.sheet : null;
}

function ensureResponseSheetColumns_(sheet, columnNames) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map((header) => String(header));
  let changed = false;
  columnNames.forEach((columnName) => {
    if (headers.indexOf(columnName) < 0) {
      headers.push(columnName);
      changed = true;
    }
  });
  if (changed) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return headers;
}

function backfillResponseIds_(sheet, headers, responses) {
  const responseIdColumnIndex = headers.indexOf(RESPONSE_ID_COLUMN);
  if (responseIdColumnIndex < 0 || responses.length === 0) {
    return;
  }
  const values = responses.map((response, index) => {
    const rowNumber = index + 2;
    const existing = sheet.getRange(rowNumber, responseIdColumnIndex + 1).getValue();
    return [existing ? String(existing) : String(response.responseId)];
  });
  sheet.getRange(2, responseIdColumnIndex + 1, values.length, 1).setValues(values);
}

function findResponseRow_(sheet, headers, responseId, responses) {
  const responseIdColumnIndex = headers.indexOf(RESPONSE_ID_COLUMN);
  if (responseIdColumnIndex >= 0 && sheet.getLastRow() >= 2) {
    const ids = sheet
      .getRange(2, responseIdColumnIndex + 1, sheet.getLastRow() - 1, 1)
      .getValues()
      .map((row) => String(row[0] || ""));
    const index = ids.indexOf(String(responseId));
    if (index >= 0) {
      return index + 2;
    }
  }
  const fallbackIndex = responses.findIndex((response) => String(response.responseId) === String(responseId));
  if (fallbackIndex < 0) {
    throw new Error("Could not find response " + responseId + " in Forms response list.");
  }
  return fallbackIndex + 2;
}

function writeCallbackCallResult(
  formId,
  responseId,
  callResult,
  callSummary,
  resultField,
  summaryField
) {
  const form = FormApp.openById(formId);
  const sheet = findResponseSheet_(form);
  if (!sheet) {
    throw new Error("Could not identify the linked Form Responses sheet for form " + formId + ".");
  }
  const resultColumn = resultField || "call_result";
  const summaryColumn = summaryField || "call_summary";
  const responses = exportFormResponses_(form).responses;
  const headers = ensureResponseSheetColumns_(sheet, [RESPONSE_ID_COLUMN, resultColumn, summaryColumn]);
  backfillResponseIds_(sheet, headers, responses);
  const rowNumber = findResponseRow_(sheet, headers, responseId, responses);
  const responseIdColumn = headers.indexOf(RESPONSE_ID_COLUMN) + 1;
  const resultColumnNumber = headers.indexOf(resultColumn) + 1;
  const summaryColumnNumber = headers.indexOf(summaryColumn) + 1;
  sheet.getRange(rowNumber, responseIdColumn).setValue(String(responseId));
  sheet.getRange(rowNumber, resultColumnNumber).setValue(String(callResult || ""));
  sheet.getRange(rowNumber, summaryColumnNumber).setValue(String(callSummary || ""));
  return {
    formId,
    responseId,
    updated: true,
    sheetTitle: sheet.getName(),
    rowNumber,
    mode: "response-sheet",
  };
}

function writeCallbackCallResultsFromJson(jsonText) {
  const payload = JSON.parse(jsonText);
  const results = payload.results || [];
  return results.map((entry) => {
    const resultField = entry.resultField || "call_result";
    const summaryField = entry.summaryField || "call_summary";
    return writeCallbackCallResult(
      entry.formId,
      entry.responseId,
      entry[resultField],
      entry[summaryField],
      resultField,
      summaryField
    );
  });
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    const apiToken = callbackApiToken_();
    if (!apiToken || payload.token !== apiToken) {
      return jsonResponse_({ ok: false, error: "unauthorized" });
    }

    return jsonResponse_(callbackApi_(payload));
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function callbackApiToken_() {
  if (CALLBACK_API_TOKEN !== "CHANGE_ME") {
    return CALLBACK_API_TOKEN;
  }
  if (CALLBACK_WRITEBACK_TOKEN !== "CHANGE_ME") {
    return CALLBACK_WRITEBACK_TOKEN;
  }
  return "";
}

function callbackApi_(payload) {
  const action = payload.action || (payload.results ? "writeback" : "health");

  if (action === "health") {
    return {
      ok: true,
      actions: ["health", "export", "writeback"],
      configuredFormCount: CALLBACK_REQUEST_FORM_IDS.filter((formId) => {
        return formId && formId !== "PASTE_FORM_ID_HERE";
      }).length,
    };
  }

  if (action === "export") {
    const bundle = buildCallbackRequestExportForIds_(
      payload.formIds || CALLBACK_REQUEST_FORM_IDS,
      payload
    );
    return {
      ok: true,
      formCount: bundle.formCount,
      responseCount: bundle.responseCount,
      timeWindow: bundle.timeWindow,
      data: bundle.output,
    };
  }

  if (action === "writeback") {
    const results = writeCallbackCallResultsFromJson(
      JSON.stringify({ results: payload.results || [] })
    );
    return { ok: true, results };
  }

  throw new Error("Unsupported action: " + action);
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function ensureResponseSpreadsheet_(form) {
  let spreadsheetId = form.getDestinationId();
  if (!spreadsheetId) {
    const spreadsheet = SpreadsheetApp.create(`${form.getTitle()} Responses`);
    spreadsheetId = spreadsheet.getId();
    form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheetId);
  }

  return SpreadsheetApp.openById(spreadsheetId);
}
