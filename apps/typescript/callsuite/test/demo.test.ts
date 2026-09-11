import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { runJudgeDemo } from "../src/demo.js";

describe("one-command judge demo", () => {
  it("verifies the expected matrix and writes safe comparison artifacts", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "callsuite-demo-"));
    const result = await runJudgeDemo(resolve("."), outputDirectory);

    assert.equal(result.summary.allExpectedOutcomesVerified, true);
    assert.deepEqual(
      result.summary.cases.map(({ id, exitCode, verdict, attribution }) => ({ id, exitCode, verdict, attribution })),
      [
        { id: "broken", exitCode: 1, verdict: "fail", attribution: "target" },
        { id: "fixed", exitCode: 0, verdict: "pass", attribution: "none" },
        { id: "platform", exitCode: 3, verdict: "error", attribution: "none" },
      ],
    );
    assert.deepEqual(result.summary.privacy, {
      credentialsLoaded: false,
      callsPlaced: 0,
      fixturesManuallySanitized: true,
    });

    const [html, json] = await Promise.all([readFile(result.htmlPath, "utf8"), readFile(result.jsonPath, "utf8")]);
    assert.match(html, /Would you ship this caller\?/);
    assert.match(html, /id="run-test">Run safety check/);
    assert.match(html, /data-task="broken">Broken version/);
    assert.match(html, /data-task="fixed">Fixed version/);
    assert.match(html, /"id":"broken"[^<]+"exitCode":1/);
    assert.match(html, /"id":"fixed"[^<]+"exitCode":0/);
    assert.match(html, /"id":"platform"[^<]+"exitCode":3/);
    assert.match(html, /One change\. Three clear decisions\./);
    assert.match(html, /cancellations within 24 hours incur a \$25 cancellation fee/);
    assert.doesNotMatch(html, /\+\d{8,15}/);
    assert.deepEqual(JSON.parse(json), result.summary);
  });
});
