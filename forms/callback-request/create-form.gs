/**
 * Creates the Google Form used by the google-form-callback lead quote workflow.
 *
 * Run createCallbackRequestForm() from Google Apps Script while signed in to
 * the Google account that should own the form. The script logs the form ID,
 * edit URL, and published URL after creation.
 *
 * After setting CALLBACK_API_TOKEN, this script can also be deployed as a
 * Web App for agent-operated health, export, and writeback actions.
 */
const EXISTING_CALLBACK_REQUEST_FORM_ID = "PASTE_FORM_ID_HERE";
const CALLBACK_API_TOKEN = "CHANGE_ME";
const CALLBACK_WRITEBACK_TOKEN = "CHANGE_ME";
const LEGACY_CALL_RESULTS_SHEET_TITLE = "Call Results";
const RESPONSE_ID_COLUMN = "response_id";

function createCallbackRequestForm() {
  const form = FormApp.create("Commercial Ice Machine Quote Request");
  configureCallbackRequestForm_(form);
  ensureResponseSpreadsheet_(form);

  const result = formResult_(form);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Replaces all questions in an existing form with the lead quote form.
 * Set EXISTING_CALLBACK_REQUEST_FORM_ID before running this function.
 */
function resetExistingCallbackRequestForm() {
  if (EXISTING_CALLBACK_REQUEST_FORM_ID === "PASTE_FORM_ID_HERE") {
    throw new Error("Set EXISTING_CALLBACK_REQUEST_FORM_ID before running this script.");
  }

  const form = FormApp.openById(EXISTING_CALLBACK_REQUEST_FORM_ID);
  for (let i = form.getItems().length - 1; i >= 0; i -= 1) {
    form.deleteItem(i);
  }

  configureCallbackRequestForm_(form);
  ensureResponseSpreadsheet_(form);

  const result = formResult_(form);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function configureCallbackRequestForm_(form) {
  form.setTitle("Commercial Ice Machine Quote Request");
  form.setDescription(
    "Submit this form to request a quote. We may call you about this quote request."
  );
  form.setConfirmationMessage("Thank you. Your quote request was submitted.");
  form.setAllowResponseEdits(false);

  const e164Validation = FormApp.createTextValidation()
    .requireTextMatchesPattern("^\\+[1-9]\\d{6,14}$")
    .setHelpText("Use E.164 format, for example +14045550176.")
    .build();

  form
    .addTextItem()
    .setTitle("Lead name")
    .setHelpText("field: lead_name")
    .setRequired(true);

  form
    .addTextItem()
    .setTitle("Phone")
    .setHelpText("field: phone; use E.164 format, for example +14045550176")
    .setValidation(e164Validation)
    .setRequired(true);

  form
    .addTextItem()
    .setTitle("Product interest")
    .setHelpText("field: product_interest")
    .setRequired(true);

  form
    .addParagraphTextItem()
    .setTitle("Known need")
    .setHelpText("field: known_need; optional")
    .setRequired(false);
}

function formResult_(form) {
  return {
    formId: form.getId(),
    editUrl: form.getEditUrl(),
    publishedUrl: form.getPublishedUrl(),
    responseSpreadsheetId: form.getDestinationId(),
  };
}

function configuredCallbackFormIds_() {
  if (EXISTING_CALLBACK_REQUEST_FORM_ID === "PASTE_FORM_ID_HERE") {
    return [];
  }
  return [EXISTING_CALLBACK_REQUEST_FORM_ID];
}

function exportCallbackRequestFormDataForIds(formIds) {
  return buildCallbackRequestExportForIds_(formIds).output;
}

function buildCallbackRequestExportForIds_(formIds) {
  const ids = assertFormIds_(formIds);
  const exports = ids.map((formId) => exportCallbackRequestFormDataForId_(formId));
  const output = exports.length === 1 ? exports[0] : { forms: exports };
  return {
    formCount: exports.length,
    responseCount: exports.reduce((sum, entry) => {
      return sum + entry.responses.responses.length;
    }, 0),
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

function exportCallbackRequestFormDataForId_(formId) {
  const form = FormApp.openById(formId);
  return {
    form: exportFormMetadata_(form),
    responses: exportFormResponses_(form),
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

function exportFormResponses_(form) {
  const responses = form.getResponses().map((response, index) => {
    const responseId =
      typeof response.getId === "function"
        ? response.getId()
        : "response-" + (index + 1) + "-" + response.getTimestamp().toISOString();
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

function ensureResponseSpreadsheet_(form) {
  let spreadsheetId = form.getDestinationId();
  if (!spreadsheetId) {
    const spreadsheet = SpreadsheetApp.create(`${form.getTitle()} Responses`);
    spreadsheetId = spreadsheet.getId();
    form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheetId);
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

/**
 * Upserts the call result for one response into the linked response spreadsheet.
 * This is the writeback surface because Google Forms does not support hidden
 * respondent fields for post-call result data.
 */
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
  sheet.getRange(rowNumber, headers.indexOf(RESPONSE_ID_COLUMN) + 1).setValue(String(responseId));
  sheet.getRange(rowNumber, headers.indexOf(resultColumn) + 1).setValue(String(callResult || ""));
  sheet.getRange(rowNumber, headers.indexOf(summaryColumn) + 1).setValue(String(callSummary || ""));
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
      configuredFormCount: configuredCallbackFormIds_().length,
    };
  }

  if (action === "export") {
    const bundle = buildCallbackRequestExportForIds_(
      payload.formIds || configuredCallbackFormIds_()
    );
    return {
      ok: true,
      formCount: bundle.formCount,
      responseCount: bundle.responseCount,
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
