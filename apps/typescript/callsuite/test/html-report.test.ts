import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderHtmlReport } from "../src/html-report.js";
import type { ReplayOutput } from "../src/replay.js";

describe("HTML replay report", () => {
  it("renders a standalone, escaped report with automation state", () => {
    const output: ReplayOutput = {
      mode: "replay",
      fixture: { id: "safe-<id>", path: "fixture.json", summary: "A <safe> summary." },
      result: {
        schemaVersion: 1,
        verdict: "needs-review",
        exitCode: 2,
        callStatus: "completed",
        structuredVerdict: "inconclusive",
        confidence: 0.72,
        automation: { blocked: true, attribution: "none" },
        reason: "Manual review is required.",
      },
    };

    const html = renderHtmlReport(output);

    assert.match(html, /^<!doctype html>/);
    assert.match(html, /NEEDS-REVIEW/);
    assert.match(html, /Blocked/);
    assert.match(html, /No workflow blame/);
    assert.match(html, /safe-&lt;id&gt;/);
    assert.doesNotMatch(html, /A <safe> summary/);
    assert.doesNotMatch(html, /Test case:/);
  });

  it("renders the same per-assertion results the JSON output carries", () => {
    const output: ReplayOutput = {
      mode: "replay",
      fixture: { id: "broken-omission", path: "fixture.json", summary: "Omission example." },
      testCase: {
        id: "cancellation-fee-disclosure",
        title: "Required business disclosure: state the cancellation fee",
        evaluatorVerdict: "pass",
        assertions: [
          { id: "states-cancellation-fee", path: "mentions", contains: "cancellation fee", outcome: "unmet" },
          { id: "confirms-attendance", path: "mentions", contains: "attendance confirmed", outcome: "met" },
        ],
        satisfied: false,
        structuredVerdict: "fail",
        totals: { met: 1, unmet: 1, unknown: 0 },
      },
      result: {
        schemaVersion: 1,
        verdict: "fail",
        exitCode: 1,
        callStatus: "completed",
        structuredVerdict: "fail",
        confidence: 0.95,
        automation: { blocked: true, attribution: "target" },
        reason: "Completed call contains a confident workflow regression.",
      },
    };

    const html = renderHtmlReport(output);

    assert.match(html, /FAIL/);
    assert.match(html, /Test case: Required business disclosure: state the cancellation fee/);
    assert.match(html, /1 met, 1 unmet, 0 unknown/);
    assert.match(html, /<td>states-cancellation-fee<\/td><td>mentions<\/td><td>cancellation fee<\/td><td>unmet<\/td>/);
    assert.match(html, /<td>confirms-attendance<\/td><td>mentions<\/td><td>attendance confirmed<\/td><td>met<\/td>/);
    assert.match(html, /pass \(reference only; assertions decide\)/);
  });

  it("escapes test-case and assertion fields in the report", () => {
    const output: ReplayOutput = {
      mode: "replay",
      fixture: { id: "safe", path: "fixture.json", summary: "summary" },
      testCase: {
        id: "tc-<x>",
        title: "Title <script>",
        evaluatorVerdict: "pass",
        assertions: [{ id: "a<b>", path: "mentions", contains: "fee <amount>", outcome: "met" }],
        satisfied: true,
        structuredVerdict: "pass",
        totals: { met: 1, unmet: 0, unknown: 0 },
      },
      result: {
        schemaVersion: 1,
        verdict: "pass",
        exitCode: 0,
        callStatus: "completed",
        structuredVerdict: "pass",
        confidence: 0.9,
        automation: { blocked: false, attribution: "none" },
        reason: "Workflow behavior passed.",
      },
    };

    const html = renderHtmlReport(output);

    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /tc-&lt;x&gt;/);
    assert.match(html, /a&lt;b&gt;/);
    assert.match(html, /fee &lt;amount&gt;/);
  });
});
