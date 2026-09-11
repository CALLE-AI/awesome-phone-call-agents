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
 *
 * Security notes (see plugins/google-sheets-callguardian/README.md for the full writeup):
 *   - The API base must be an https:// origin. http:// and anything else is refused —
 *     credentials and call/recipient data never go out over plaintext.
 *   - Every recipient phone is validated as E.164 (`+` and 7-15 digits) before it is ever
 *     sent to the gate. A malformed number is refused for that row, never forwarded.
 *   - Provider text (CALL-E's summary/error) and any raw error body written into a cell is
 *     redacted first: phone-number-shaped digit runs are masked and the text is capped in
 *     length, so a provider response can't leak a full number or an unbounded blob into
 *     the sheet.
 *   - A row that already has a Call Outcome is never re-dispatched automatically. Placing
 *     a call again on the same row is a skip, not a silent retry with a fresh idempotency
 *     key — clear Call Outcome and Audit Hash yourself first if you mean to redial.
 */

const REQUIRED_COLUMNS = [
  "Name", "Phone", "Timezone", "Rule Pack", "Consent Given", "Consent Date",
  "Suppressed", "Status", "Reasons", "Call Outcome", "Audit Hash",
];

const E164_RE = /^\+[1-9]\d{6,14}$/;
const HTTPS_ORIGIN_RE = /^https:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*(?::\d+)?$/;

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
  const resp = ui.prompt("CallGuardian API base URL", "https:// origin only, e.g. https://callguardian.onrender.com", ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const value = resp.getResponseText().trim().replace(/\/$/, "");
  if (!value) return;
  if (!HTTPS_ORIGIN_RE.test(value)) {
    ui.alert(
      "Refused",
      "That doesn't look like a plain https:// origin (no path, no query string, no http://). " +
      "Credentials and recipient data only ever go to a secure origin you've explicitly set here.",
      ui.ButtonSet.OK,
    );
    return;
  }
  PropertiesService.getScriptProperties().setProperty("CALLGUARDIAN_API_BASE", value);
}

function apiBase_() {
  const base = PropertiesService.getScriptProperties().getProperty("CALLGUARDIAN_API_BASE");
  if (!base) throw new Error("Set the API base URL first: CallGuardian menu > Set API base URL…");
  // Re-validate on every use, not just at prompt time — a Script Property can be edited
  // directly in the Apps Script editor's Project Settings, bypassing promptForApiBase's check.
  if (!HTTPS_ORIGIN_RE.test(base)) {
    throw new Error("CALLGUARDIAN_API_BASE is not a valid https:// origin — reset it: CallGuardian menu > Set API base URL…");
  }
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
  if (!E164_RE.test(phone)) {
    throw new Error(`Invalid phone "${maskPhone_(phone)}" — must be E.164 (e.g. +15550101). Refusing to send an unvalidated recipient.`);
  }
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

// Shows only the first 2 and last 2 digits — enough to eyeball which row an error is about
// without ever writing a dialable number into a cell, a log, or an alert.
function maskPhone_(phone) {
  const digits = String(phone || "");
  if (digits.length <= 4) return "••••";
  return digits.slice(0, 2) + "•".repeat(Math.max(digits.length - 4, 1)) + digits.slice(-2);
}

// Provider text (CALL-E summaries/errors) is free-form and may echo back the number it
// just dialed or other call content — mask anything phone-shaped and cap the length before
// any of it is written into a cell that this spreadsheet's other viewers can read.
function redactText_(text, maxLen) {
  const s = String(text == null ? "" : text);
  const masked = s.replace(/\+?\d[\d\-\s()]{6,}\d/g, (m) => maskPhone_(m.replace(/\D/g, "")));
  const limit = maxLen || 160;
  return masked.length > limit ? masked.slice(0, limit) + "…" : masked;
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
  const statusCol = columnIndex_(header, "Status") + 1;
  const reasonsCol = columnIndex_(header, "Reasons") + 1;
  for (let r = startRow; r < startRow + numRows; r++) {
    const rowValues = sheet.getRange(r, 1, 1, sheet.getLastColumn()).getValues()[0];
    try {
      fn(sheet, header, r, rowValues);
    } catch (err) {
      // One row's bad recipient or a transient fetch failure shouldn't abort every other
      // selected row — report it on that row and keep going.
      sheet.getRange(r, statusCol).setValue("ERROR");
      sheet.getRange(r, reasonsCol).setValue(redactText_(err.message, 200));
    }
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
      sheet.getRange(r, reasonsCol).setValue(redactText_(JSON.stringify(body), 200));
      return;
    }
    sheet.getRange(r, statusCol).setValue(body.status);
    sheet.getRange(r, reasonsCol).setValue((body.reasons || []).map(x => x.code).join(", "));
  });
}

function placeCallsForSelectedRows() {
  forEachSelectedRow_((sheet, header, r, rowValues) => {
    const statusCol = columnIndex_(header, "Status") + 1;
    const reasonsCol = columnIndex_(header, "Reasons") + 1;
    const outcomeCol = columnIndex_(header, "Call Outcome") + 1;
    const hashCol = columnIndex_(header, "Audit Hash") + 1;
    const suppressedCol = columnIndex_(header, "Suppressed") + 1;

    // Never auto-redial a row that already has a recorded outcome. If the first dispatch
    // was ambiguous (timed out, came back unclear, or simply hasn't been reconciled by a
    // human yet), re-running this menu item must not silently fire a second call under a
    // fresh idempotency key — that's exactly how a duplicate call happens. Clearing the
    // cell is the explicit signal that a human has reconciled it and a retry is intended.
    const existingOutcome = String(rowValues[outcomeCol - 1] || "").trim();
    if (existingOutcome) {
      sheet.getRange(r, statusCol).setValue("SKIPPED");
      sheet.getRange(r, reasonsCol).setValue("already has a Call Outcome — clear it and Audit Hash first to redial");
      return;
    }

    const account = rowToAccount_(header, rowValues);
    const { ok, code, body } = callApi_("/api/gate/place-call-external", account);
    if (!ok) {
      // A 409 carries the same {status, reasons: [{code, message}, ...]} shape
      // checkSelectedRows already renders cleanly — reuse that instead of dumping raw
      // JSON into the row. Any other error code is genuinely unexpected, so that one
      // does fall back to the (redacted) raw body for debugging.
      const decision = body.detail;
      sheet.getRange(r, statusCol).setValue(code === 409 ? "BLOCKED" : "ERROR");
      if (code === 409 && decision && decision.reasons) {
        sheet.getRange(r, reasonsCol).setValue(decision.reasons.map(x => x.code).join(", "));
        sheet.getRange(r, outcomeCol).setValue("not called — blocked by the gate");
      } else {
        sheet.getRange(r, outcomeCol).setValue(redactText_(JSON.stringify(body), 200));
      }
      return;
    }
    sheet.getRange(r, statusCol).setValue("CLEARED");
    sheet.getRange(r, outcomeCol).setValue(redactText_(`${body.status} — ${body.summary || body.error || ""}`, 160));
    // The real hash from the shared, hash-chained audit log (api/audit.py) — not the
    // CALL-E call id. Shown truncated; CallGuardian > Verify audit log recomputes and
    // checks the full chain, this is just a visible fingerprint per row.
    sheet.getRange(r, hashCol).setValue(body.auditHash ? body.auditHash.slice(0, 16) + "…" : "");
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
    ui.alert("Audit log BROKEN", `Broke at entry ${body.brokenAt}: ${redactText_(body.reason, 200)}`, ui.ButtonSet.OK);
  }
}
