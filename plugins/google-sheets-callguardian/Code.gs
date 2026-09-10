/**
 * CallGuardian for Google Sheets — a consent/call-window/do-not-call compliance gate in
 * front of CALL-E, delivered as a Sheets menu instead of a dashboard or a CLI.
 *
 * Expected header row (any order, matched by name): Name | Phone | Timezone | Rule Pack |
 * Consent Given | Consent Date | Suppressed | Status | Reasons | Call Outcome | Audit Hash
 *
 * Settings (File > Project properties > Script properties, or run `setApiBase`/`setApiKey`
 * once from the Apps Script editor):
 *   CALLGUARDIAN_API_BASE — the deployed CallGuardian origin, e.g. https://callguardian.onrender.com
 *   CALLGUARDIAN_API_KEY  — reserved for a future auth header; the reference deployment
 *                           does not require one for the /api/gate/*-external routes.
 */

const REQUIRED_COLUMNS = [
  "Name", "Phone", "Timezone", "Rule Pack", "Consent Given", "Consent Date",
  "Suppressed", "Status", "Reasons", "Call Outcome", "Audit Hash",
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("CallGuardian")
    .addItem("Check compliance (selected rows)", "checkSelectedRows")
    .addItem("Place call (selected rows, cleared only)", "placeCallsForSelectedRows")
    .addSeparator()
    .addItem("Verify audit log", "verifyAuditLog")
    .addItem("Insert header row", "insertHeaderRow")
    .addSeparator()
    .addItem("Set API base URL…", "promptForApiBase")
    .addToUi();
}

function insertHeaderRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  sheet.getRange(1, 1, 1, REQUIRED_COLUMNS.length).setValues([REQUIRED_COLUMNS]);
  sheet.setFrozenRows(1);
}

function promptForApiBase() {
  const ui = SpreadsheetApp.getUi();
  const current = PropertiesService.getScriptProperties().getProperty("CALLGUARDIAN_API_BASE") || "";
  const resp = ui.prompt("CallGuardian API base URL", "e.g. https://callguardian.onrender.com", ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const value = resp.getResponseText().trim().replace(/\/$/, "");
  if (value) PropertiesService.getScriptProperties().setProperty("CALLGUARDIAN_API_BASE", value);
}

function apiBase_() {
  const base = PropertiesService.getScriptProperties().getProperty("CALLGUARDIAN_API_BASE");
  if (!base) throw new Error("Set the API base URL first: CallGuardian menu > Set API base URL…");
  return base;
}

function columnIndex_(header, name) {
  const i = header.indexOf(name);
  if (i === -1) throw new Error(`Missing column "${name}" — run CallGuardian > Insert header row.`);
  return i;
}

function rowToAccount_(header, row) {
  const col = (name) => row[columnIndex_(header, name)];
  const phone = String(col("Phone") || "").trim();
  return {
    externalId: "sheet:" + phone,
    phone: phone,
    timezone: String(col("Timezone") || "").trim(),
    rulePack: String(col("Rule Pack") || "").trim(),
    consent: {
      given: String(col("Consent Given") || "").trim().toUpperCase() === "TRUE",
      givenAt: col("Consent Date") ? new Date(col("Consent Date")).toISOString() : null,
    },
    suppressed: String(col("Suppressed") || "").trim().toUpperCase() === "TRUE",
  };
}

function callApi_(path, payload, method) {
  const options = {
    method: method || "post",
    contentType: "application/json",
    muteHttpExceptions: true,
  };
  if (options.method === "post") options.payload = JSON.stringify(payload);
  const res = UrlFetchApp.fetch(apiBase_() + path, options);
  const code = res.getResponseCode();
  const body = JSON.parse(res.getContentText() || "{}");
  return { ok: code >= 200 && code < 300, code, body };
}

function forEachSelectedRow_(fn) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const range = sheet.getActiveRange();
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const startRow = Math.max(range.getRow(), 2); // never touch the header row
  const numRows = range.getRow() < 2 ? range.getNumRows() - 1 : range.getNumRows();
  for (let r = startRow; r < startRow + numRows; r++) {
    const rowValues = sheet.getRange(r, 1, 1, sheet.getLastColumn()).getValues()[0];
    fn(sheet, header, r, rowValues);
  }
}

function checkSelectedRows() {
  forEachSelectedRow_((sheet, header, r, rowValues) => {
    const account = rowToAccount_(header, rowValues);
    const { ok, body } = callApi_("/api/gate/check-external", account);
    const statusCol = columnIndex_(header, "Status") + 1;
    const reasonsCol = columnIndex_(header, "Reasons") + 1;
    if (!ok) {
      sheet.getRange(r, statusCol).setValue("ERROR");
      sheet.getRange(r, reasonsCol).setValue(JSON.stringify(body));
      return;
    }
    sheet.getRange(r, statusCol).setValue(body.status);
    sheet.getRange(r, reasonsCol).setValue((body.reasons || []).map(x => x.code).join(", "));
  });
}

function placeCallsForSelectedRows() {
  forEachSelectedRow_((sheet, header, r, rowValues) => {
    const account = rowToAccount_(header, rowValues);
    const statusCol = columnIndex_(header, "Status") + 1;
    const outcomeCol = columnIndex_(header, "Call Outcome") + 1;
    const hashCol = columnIndex_(header, "Audit Hash") + 1;
    const suppressedCol = columnIndex_(header, "Suppressed") + 1;

    const { ok, code, body } = callApi_("/api/gate/place-call-external", account);
    if (!ok) {
      sheet.getRange(r, statusCol).setValue(code === 409 ? "BLOCKED" : "ERROR");
      sheet.getRange(r, outcomeCol).setValue(JSON.stringify(body.detail || body));
      return;
    }
    sheet.getRange(r, statusCol).setValue("CLEARED");
    sheet.getRange(r, outcomeCol).setValue(`${body.status} — ${body.summary || body.error || ""}`);
    sheet.getRange(r, hashCol).setValue(body.callId || "");
    if (body.optOutDetected) {
      sheet.getRange(r, suppressedCol).setValue("TRUE");
    }
  });
}

function verifyAuditLog() {
  const { ok, body } = callApi_("/api/audit/verify", null, "get");
  const ui = SpreadsheetApp.getUi();
  if (ok && body.ok) {
    ui.alert("Audit log OK", `${body.checked} entries verified, chain intact.`, ui.ButtonSet.OK);
  } else {
    ui.alert("Audit log BROKEN", `Broke at entry ${body.brokenAt}: ${body.reason}`, ui.ButtonSet.OK);
  }
}
