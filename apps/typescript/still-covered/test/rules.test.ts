import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { planWaves, scoreEnrollee } from "../src/priority.js";
import { loadEnrollees } from "../src/registry.js";
import { checklistFor, clearedByData, loadRules, loadState, questionsFor, validateRules, validateState, type Rules } from "../src/rules.js";
import { assertSupportedSchema, SCREENING_RESULT_SCHEMA } from "../src/schemas.js";
import { renderScreeningTask } from "../src/tasks.js";
import { ASKABLE_CODES, type Enrollee } from "../src/types.js";

const rules = loadRules();
const state = loadState("example-state");
const { people } = loadEnrollees(join(process.cwd(), "data", "enrollees.sample.csv"));
const byId = (id: string): Enrollee => {
  const p = people.find((x) => x.id === id);
  assert.ok(p, `sample person ${id} exists`);
  return p;
};

test("the rules file covers every exemption exactly once and validates", () => {
  assert.equal(rules.exemptions.length, 9);
  assert.equal(rules.requirement.hours_per_month, 80);
  assert.equal(rules.requirement.income_per_month_usd, 580);
});

test("tribal status can never become a phone question, and frailty always has its daily-activity follow-up", () => {
  const tampered: Rules = JSON.parse(JSON.stringify(rules)) as Rules;
  const tribal = tampered.exemptions.find((e) => e.code === "tribal");
  assert.ok(tribal);
  tribal.question = "Are you American Indian?";
  assert.throws(() => validateRules(tampered), /never be asked/);
  const noFollowUp: Rules = JSON.parse(JSON.stringify(rules)) as Rules;
  const frail = noFollowUp.exemptions.find((e) => e.code === "medically_frail");
  assert.ok(frail);
  delete frail.follow_up;
  assert.throws(() => validateRules(noFollowUp), /daily activities/);
});

test("a state voicemail that names Medicaid is rejected", () => {
  assert.throws(() => validateState({ ...state, voicemail: "This is about your Medicaid." }), /must not mention Medicaid/);
});

test("ex parte first: state data clears people before anyone is called", () => {
  assert.equal(clearedByData(byId("e009"), rules).kind, "exempt");
  assert.equal(clearedByData(byId("e010"), rules).kind, "meets");
  assert.equal(clearedByData(byId("e001"), rules).cleared, false);
});

test("only unanswered, age-appropriate questions are asked, in order", () => {
  const maria = questionsFor(rules, byId("e001"), "2026-09-14").map((q) => q.code);
  assert.equal(maria[0], "caregiver_child");
  assert.ok(!maria.includes("snap_tanf"), "the state's data already says no SNAP for Maria");
  assert.ok(!maria.includes("former_foster_youth"), "Maria is 40; the foster-youth exemption stops at 26");
  const young: Enrollee = { ...byId("e002"), birthYear: 2003 };
  assert.ok(questionsFor(rules, young, "2026-09-14").some((q) => q.code === "former_foster_youth"));
});

test("checklists are merged without duplicates", () => {
  const list = checklistFor(rules, ["caregiver_child", "caregiver_child", "pregnant_postpartum"]);
  assert.equal(list.length, new Set(list).size);
  assert.ok(list.length >= 3);
});

test("the call task puts privacy first and never lets the agent say anyone is exempt", () => {
  const task = renderScreeningTask(rules, state, byId("e001"), "2026-09-14");
  assert.ok(task.includes("Am I speaking with Maria?"));
  assert.ok(task.includes("Never say the year yourself"));
  assert.ok(task.includes("Do not mention Medicaid, coverage details or any rule until"));
  assert.ok(task.includes(state.voicemail));
  assert.ok(task.includes("Speak in Spanish"));
  assert.ok(task.includes("Never say they are exempt"));
  assert.ok(task.includes("never read the instructions themselves aloud") || task.includes("Never read the instructions themselves aloud"));
  assert.ok(!task.includes("Do you get SNAP"), "questions the state already answered are not asked");
  assert.ok(task.includes("January 2027"), "the person hears when their coverage will be checked");
  assert.ok(!/\+1415\d{7}/.test(task), "the task never contains a phone number");
  assert.ok(task.includes("Do not ask for Social Security numbers"));
  assert.ok(task.includes("not_asked"));
});

test("without a birth year the agent is told not to discuss coverage at all", () => {
  const task = renderScreeningTask(rules, state, { ...byId("e002"), birthYear: null }, "2026-09-14");
  assert.ok(task.includes("identity cannot be confirmed"));
});

test("the screening schema uses only CALL-E supported keywords and never asks about tribal status", () => {
  assert.doesNotThrow(() => assertSupportedSchema(SCREENING_RESULT_SCHEMA));
  const answers = (SCREENING_RESULT_SCHEMA["properties"] as Record<string, { required?: string[]; properties?: Record<string, unknown> }>)["answers"];
  assert.deepEqual(answers?.required, [...ASKABLE_CODES]);
  assert.ok(!("tribal" in (answers?.properties ?? {})));
  assert.throws(() => assertSupportedSchema({ type: "object", properties: { a: { anyOf: [] } } }));
});

test("the soonest coverage checks and the highest paperwork risk go first", () => {
  const callable = people.filter((p) => !clearedByData(p, rules).cleared);
  const waves = planWaves(callable, "2026-09-14", 4);
  assert.deepEqual(waves[0]?.personIds, ["e001", "e005", "e003", "e007"]);
  assert.equal(waves[0]?.priority, 1);
  const last = waves[waves.length - 1];
  assert.deepEqual(last?.personIds, ["e008"]);
  const maria = scoreEnrollee(byId("e001"), "2026-09-14");
  assert.equal(maria.daysToCheck, 139);
  assert.ok(maria.factors.includes("prefers a language other than English"));
  assert.ok(maria.factors.includes("lost coverage over paperwork before"));
});
