import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultBrainConfig,
  defaultBrainGoals,
  defaultBrainSuggestions,
  enabledGoals,
  normalizeBrainConfig,
  brainCallDirectives
} from "../lib/brain/config.ts";
import { applyCopilotHeuristics, applySuggestionToConfig } from "../lib/brain/copilot.ts";
import { goalFromSentence } from "../lib/brain/goals.ts";
import { HARBOR_COMPANY_ABOUT, HARBOR_QUALIFICATION_REPORT, harborCompanyCorpus } from "../lib/brain/harbor-corpus.ts";
import {
  applyIngestDraft,
  draftFromText,
  htmlToText,
  isHarborDemoUrl,
  mergeSource,
  normalizeIngestUrl,
  resolveIngestText
} from "../lib/brain/ingest.ts";
import { buildLiveCallTask } from "../lib/calle/live-binding.ts";
import type { WebSessionContext } from "../lib/types.ts";

function session(): WebSessionContext {
  return {
    id: "sess_brain_report",
    visitorId: "vis_brain_report",
    accountId: "harbor",
    landingUrl: "/demo/pricing",
    timeOnPageSec: 40
  };
}

test("brain report: Harbor defaults include scraped company context", () => {
  const config = defaultBrainConfig();
  assert.equal(config.productName, "Harbor CRM");
  assert.equal(config.companyAbout, HARBOR_COMPANY_ABOUT);
  assert.equal(config.qualificationReport, HARBOR_QUALIFICATION_REPORT);
  assert.equal(config.sources[0]?.url, "/demo");
  assert.match(config.companyAbout, /high-ticket/);
  assert.doesNotMatch(config.qualificationReport.toLowerCase(), /warm, welcoming/);
});

test("brain report: missing brief fields hydrate from Harbor defaults", () => {
  const config = normalizeBrainConfig({ accountId: "harbor", productName: "Harbor CRM" });
  assert.equal(config.companyAbout, HARBOR_COMPANY_ABOUT);
  assert.equal(config.qualificationReport, HARBOR_QUALIFICATION_REPORT);
  assert.equal(config.sources[0]?.kind, "url");
});

test("brain report: call directives inject the brief, not a tone editor", () => {
  const config = defaultBrainConfig();
  const directives = brainCallDirectives(config);
  assert.match(directives.playbookNotes || "", /Qualify inbound callers who asked for a callback from Harbor/);
  assert.match(directives.playbookNotes || "", /high-ticket/);
  const task = buildLiveCallTask("+15550192831", session(), "Alex", "alex@example.com", {
    ...directives,
    activeGoals: enabledGoals(config)
  });
  assert.match(task, /Qualify inbound callers/);
  assert.match(task, /automated assistant for Harbor Sales/);
});

test("brain ingest: Harbor demo URL never hits the network", async () => {
  assert.equal(isHarborDemoUrl("/demo"), true);
  assert.equal(isHarborDemoUrl("http://localhost:3000/demo/pricing"), true);
  assert.equal(normalizeIngestUrl("demo"), "/demo");
  assert.equal(normalizeIngestUrl("/demo"), "/demo");
  assert.throws(() => normalizeIngestUrl("javascript:alert(1)"), /http\(s\)/);
  assert.throws(() => normalizeIngestUrl("http://127.0.0.1/secret"), /Local URLs/);
  const { source, text } = await resolveIngestText("url", { url: "/demo" });
  assert.equal(source.kind, "url");
  assert.equal(source.url, "/demo");
  assert.equal(text, harborCompanyCorpus());
});

test("brain ingest: files and HTML become a drafted brief", async () => {
  assert.equal(htmlToText("<h1>Northwind</h1><script>x()</script><p>Freight CRM for carriers.</p>"), "Northwind Freight CRM for carriers.");
  const { source, text } = await resolveIngestText("file", {
    fileName: "about.md",
    text: "# Northwind Logistics\n\nWe run freight for regional carriers."
  });
  assert.equal(source.kind, "file");
  assert.equal(source.fileName, "about.md");
  assert.match(text, /Northwind Logistics/);
  const draft = draftFromText(defaultBrainConfig(), text);
  assert.equal(draft.productName, "Northwind Logistics");
  assert.match(draft.qualificationReport, /Northwind Logistics/);
  assert.doesNotMatch(draft.qualificationReport.toLowerCase(), /persona|tone of voice/);
});

test("brain ingest: merging a source redrafts company copy and keeps goals", () => {
  const current = defaultBrainConfig();
  const draft = draftFromText(current, harborCompanyCorpus());
  const next = applyIngestDraft(current, {
    id: "src_test",
    kind: "url",
    label: "Harbor demo site",
    url: "/demo",
    ingestedAt: "2026-09-07T00:00:00.000Z",
    excerpt: "Harbor CRM"
  }, draft);
  assert.equal(next.productName, "Harbor CRM");
  assert.equal(next.companyAbout, HARBOR_COMPANY_ABOUT);
  assert.equal(next.sources[0]?.id, "src_test");
  assert.equal(next.goals.length, defaultBrainGoals().length);
  assert.equal(mergeSource(next, next.sources[0]).length, 1);
});

test("brain config: seeds two copilot proposals when none are saved", () => {
  assert.equal(defaultBrainSuggestions().length, 2);
  const restored = normalizeBrainConfig({ accountId: "harbor", suggestions: [] }, "harbor");
  assert.equal(restored.suggestions.length, 2);
  assert.equal(restored.suggestions[0]?.id, "sugg_migration_scope");
  assert.equal(restored.suggestions[1]?.id, "sugg_prompt_team_size");
});

test("brain copilot: retry is locked; intents and suggestions still apply", () => {
  const base = defaultBrainConfig();
  const retry = applyCopilotHeuristics(base, "retry in 2 hours");
  assert.equal(retry?.config.retryDelayHours, base.retryDelayHours);
  assert.match(retry?.reply || "", /locked/i);
  assert.equal(retry?.config.tonePersona, base.tonePersona);
  assert.equal(retry?.config.agentIdentity, base.agentIdentity);

  const skip = applyCopilotHeuristics(base, "don't retry missed pickups");
  assert.equal(skip?.config.retryDelayHours, base.retryDelayHours);
  assert.match(skip?.reply || "", /locked/i);

  const added = applyCopilotHeuristics(base, "add a goal for budget range");
  assert.ok(added?.config.goals.some((goal) => /budget/i.test(goal.label)));

  const paused = applyCopilotHeuristics(base, "pause team size");
  assert.equal(paused?.config.goals.find((goal) => goal.id === "team_size")?.enabled, false);

  const applied = applySuggestionToConfig(base, base.suggestions[0]);
  assert.ok(applied.goals.some((goal) => goal.targetField === "migrationScope"));
  assert.equal(applied.suggestions.some((item) => item.id === "sugg_migration_scope"), false);

  const note = applySuggestionToConfig(base, base.suggestions[1]);
  assert.match(note.qualificationReport, /Do not ask team size in the first minute/);
});

test("brain copilot: unmatched prose is not treated as a voice or tone change", () => {
  const base = defaultBrainConfig();
  const result = applyCopilotHeuristics(base, "We only sell to teams with a named RevOps owner.");
  assert.equal(result, null);
  assert.equal(base.tonePersona, defaultBrainConfig().tonePersona);
  const goal = goalFromSentence("Security review");
  assert.equal(goal?.targetField, "securityReview");
  assert.equal(goal?.label, "Security review");
});
