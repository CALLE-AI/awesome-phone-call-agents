import assert from "node:assert/strict";
import test from "node:test";

import { csvCell, safeSpreadsheetValue } from "../lib/campaigns/csv";

test("campaign CSV escapes delimiters, quotes, and spreadsheet formulas", () => {
  assert.equal(csvCell('Marta, "VIP"'), '"Marta, ""VIP"""');
  assert.equal(safeSpreadsheetValue("=HYPERLINK(\"https://example.com\")"), "'=HYPERLINK(\"https://example.com\")");
  assert.equal(safeSpreadsheetValue("+14155550100"), "'+14155550100");
  assert.equal(csvCell({ qualified: true }), '"{""qualified"":true}"');
});
