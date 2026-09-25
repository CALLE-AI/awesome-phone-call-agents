import { describe, expect, it } from "vitest";
import { isSafeCallContent } from "../server/calle/content-guard";
import {
  applySurveyAnswer,
  CALL_AUNTY_QUESTION_IDS,
  CALL_AUNTY_SCENARIOS,
  CALL_AUNTY_SURVEY,
  CALL_SCRIPT_LOCALES,
  canonicalizeOption,
  classifySensitiveText,
  consentBlocksLaterQuestions,
  getCallAuntyQuestion,
  getCallAuntyScenario,
  getCallScriptPack,
  localizeScenario,
  matchesSkipRule,
  nextAskableQuestion,
  redactPii,
  replayTranscriptAnswers,
  SAFETY_CONCERN_CODE,
  shouldAskQuestion,
} from "../lib/mock-calls";

describe("Call Aunty survey fixture", () => {
  it("ships a consent gate plus 20 reusable questions with stable ids", () => {
    expect(CALL_AUNTY_SURVEY).toHaveLength(21);
    expect(CALL_AUNTY_QUESTION_IDS).toEqual([
      "consent",
      "q01",
      "q02",
      "q03",
      "q04",
      "q05",
      "q06",
      "q07",
      "q08",
      "q09",
      "q10",
      "q11",
      "q12",
      "q13",
      "q14",
      "q15",
      "q16",
      "q17",
      "q18",
      "q19",
      "q20",
    ]);
    expect(getCallAuntyQuestion("q19").skipRule).toBe("q18 != true");
  });

  it("covers the original six outcomes plus Bangla and sensitive-branch scenarios", () => {
    const ids = CALL_AUNTY_SCENARIOS.map((scenario) => scenario.id);
    expect(ids).toEqual(expect.arrayContaining([
      "aunty-complete-positive",
      "aunty-declines",
      "aunty-reschedule",
      "aunty-skip-question",
      "aunty-voicemail",
      "aunty-technical-failure",
      "aunty-complete-positive-bn",
      "aunty-sensitive-distress",
    ]));
    expect(getCallAuntyScenario("aunty-voicemail").outcome).toBe("voicemail");
  });
});

describe("Call Aunty consent and skip branching", () => {
  it("does not persist later answers when consent is refused", () => {
    const scenario = getCallAuntyScenario("aunty-declines");
    expect(consentBlocksLaterQuestions(scenario.transcript)).toBe(true);
    const replay = replayTranscriptAnswers(scenario.transcript);
    expect(replay.answers).toEqual({ consent: false });
    expect(replay.askedQuestionIds.filter((id) => id !== "consent")).toEqual([]);
    expect(nextAskableQuestion(CALL_AUNTY_SURVEY, replay.answers, replay.flags)?.id ?? null).toBeNull();
  });

  it("does not treat a callback request as consent", () => {
    const scenario = getCallAuntyScenario("aunty-reschedule");
    expect(scenario.extractedAnswers.consent).toBeNull();
    expect(scenario.transcript.some((turn) => turn.questionId && turn.questionId !== "consent")).toBe(false);
  });

  it("skips contact method after a no-follow-up answer", () => {
    const afterConsent = applySurveyAnswer({ questionId: "consent", answer: true });
    expect(afterConsent.nextQuestionId).toBe("q01");

    const afterOptOut = applySurveyAnswer({
      questionId: "q18",
      answer: false,
      answers: { consent: true },
      flags: afterConsent.flags,
    });
    expect(afterOptOut.flags.contactOptOut).toBe(true);
    expect(afterOptOut.agentScriptKeys).toContain("skip_no_followup");
    expect(afterOptOut.nextQuestionId).toBe("q20");
    expect(shouldAskQuestion(getCallAuntyQuestion("q19"), { consent: true, q18: false }, afterOptOut.flags)).toBe(false);
    expect(matchesSkipRule("q18 != true", { q18: false })).toBe(true);

    const scenario = getCallAuntyScenario("aunty-skip-question");
    const replay = replayTranscriptAnswers(scenario.transcript);
    expect(replay.askedQuestionIds).not.toContain("q19");
    expect(JSON.stringify(scenario.transcript)).not.toMatch(/@|phone number|\+\d{6,}/i);
    expect(replay.answers).toEqual(scenario.extractedAnswers);
  });

  it("does not fabricate answers from voicemail", () => {
    const scenario = getCallAuntyScenario("aunty-voicemail");
    const replay = replayTranscriptAnswers(scenario.transcript);
    expect(replay.answers).toEqual({});
    expect(replay.askedQuestionIds).toEqual([]);
  });

  it("resumes after a transport failure without repeating consent", () => {
    const scenario = getCallAuntyScenario("aunty-technical-failure");
    const replay = replayTranscriptAnswers(scenario.transcript);
    expect(replay.answers).toEqual(scenario.extractedAnswers);
    expect(replay.askedQuestionIds.filter((id) => id === "consent")).toHaveLength(1);
    expect(nextAskableQuestion(CALL_AUNTY_SURVEY, replay.answers, replay.flags)?.id).toBe("q02");
  });
});

describe("Call Aunty sensitive-answer branching", () => {
  it("skips recommend/benefit prompts after a very negative experience", () => {
    const decision = applySurveyAnswer({
      questionId: "q01",
      answer: "Very negative",
      answers: { consent: true },
      flags: applySurveyAnswer({ questionId: "consent", answer: true }).flags,
    });
    expect(decision.flags.veryNegativeExperience).toBe(true);
    expect(decision.agentScriptKeys).toEqual(expect.arrayContaining(["acknowledge_negative", "q06_careful"]));
    expect(decision.skippedQuestionIds).toEqual(expect.arrayContaining(["q05", "q09", "q10", "q15"]));
    expect(shouldAskQuestion(getCallAuntyQuestion("q09"), { consent: true, q01: "Very negative" }, decision.flags)).toBe(false);
    expect(shouldAskQuestion(getCallAuntyQuestion("q05"), { consent: true, q01: "Very negative" }, decision.flags)).toBe(false);
  });

  it("stops probing and persists a safety code when distress is reported", () => {
    const spoken = "I had severe pain and it was hard to breathe. Please do not ask me more about that.";
    expect(classifySensitiveText(spoken)).toBe("distress");

    const decision = applySurveyAnswer({
      questionId: "q06",
      answer: spoken,
      spoken,
      answers: { consent: true, q01: "Very negative" },
      flags: applySurveyAnswer({
        questionId: "q01",
        answer: "Very negative",
        answers: { consent: true },
        flags: applySurveyAnswer({ questionId: "consent", answer: true }).flags,
      }).flags,
    });

    expect(decision.persistAnswer).toBe(SAFETY_CONCERN_CODE);
    expect(decision.escalation).toBe("safety_script");
    expect(decision.agentScriptKeys).toContain("safety_stop_probing");
    expect(decision.nextQuestionId).toBeNull();
    expect(
      shouldAskQuestion(getCallAuntyQuestion("q18"), { consent: true, q01: "Very negative", q06: SAFETY_CONCERN_CODE }, decision.flags),
    ).toBe(false);

    const scenario = getCallAuntyScenario("aunty-sensitive-distress");
    const replay = replayTranscriptAnswers(scenario.transcript);
    expect(replay.escalation).toBe("safety_script");
    expect(replay.answers).toEqual(scenario.extractedAnswers);
    expect(replay.askedQuestionIds).toEqual(["consent", "q01", "q06"]);
    expect(replay.askedQuestionIds).not.toEqual(expect.arrayContaining(["q05", "q09", "q10", "q15", "q18", "q19", "q20"]));
    expect(JSON.stringify(replay.answers)).not.toMatch(/pain|breathe/i);
    expect(scenario.transcript.some((turn) => turn.scriptKey === "safety_stop_probing")).toBe(true);
  });

  it("redacts contact details that leak into free text", () => {
    expect(redactPii("Email me at pat@example.com or +1 (555) 010-0199")).toContain("[redacted-email]");
    expect(redactPii("Email me at pat@example.com or +1 (555) 010-0199")).toContain("[redacted-number]");
  });
});

describe("Call Aunty multilingual call scripts", () => {
  it("has a complete question pack for every app language", () => {
    expect(CALL_SCRIPT_LOCALES).toEqual(["en", "bn", "hi", "ur", "ta", "te"]);
    for (const locale of CALL_SCRIPT_LOCALES) {
      const pack = getCallScriptPack(locale);
      expect(pack.direction).toBe(locale === "ur" ? "rtl" : "ltr");
      for (const question of CALL_AUNTY_SURVEY) {
        const copy = pack.questions[question.id];
        expect(copy?.prompt.length).toBeGreaterThan(8);
        if (question.options) {
          expect(copy.options).toHaveLength(question.options.length);
        }
        expect(isSafeCallContent(copy.prompt)).toBe(true);
      }
      for (const frame of Object.values(pack.frames)) {
        expect(isSafeCallContent(frame)).toBe(true);
      }
    }
  });

  it("maps localized options back to canonical English answers", () => {
    const question = getCallAuntyQuestion("q01");
    expect(canonicalizeOption(question, "খুব ইতিবাচক", "bn")).toBe("Very positive");
    expect(canonicalizeOption(question, "बहुत नकारात्मक", "hi")).toBe("Very negative");
    expect(canonicalizeOption(question, "Very positive", "ta")).toBe("Very positive");
  });

  it("localizes agent turns without changing structured answers", () => {
    const english = getCallAuntyScenario("aunty-complete-positive");
    const bangla = localizeScenario(english, "bn");
    expect(bangla.locale).toBe("bn");
    expect(bangla.extractedAnswers).toEqual(english.extractedAnswers);
    const greeting = bangla.transcript.find((turn) => turn.scriptKey === "greeting_named");
    expect(greeting?.text).toContain("কল আন্টি");
    expect(greeting?.text).toContain("Pat");
    const consent = bangla.transcript.find((turn) => turn.questionId === "consent" && turn.speaker === "agent");
    expect(consent?.text).toMatch(/জরিপ/);

    const hindi = localizeScenario(getCallAuntyScenario("aunty-declines"), "hi");
    expect(hindi.transcript.find((turn) => turn.scriptKey === "decline_close")?.text).toMatch(/सर्वे/);

    const urdu = localizeScenario(getCallAuntyScenario("aunty-voicemail"), "ur");
    expect(getCallScriptPack("ur").direction).toBe("rtl");
    expect(urdu.transcript.find((turn) => turn.scriptKey === "voicemail")?.text).toMatch(/سروے/);

    const bnScenario = getCallAuntyScenario("aunty-complete-positive-bn");
    expect(replayTranscriptAnswers(bnScenario.transcript).answers).toEqual(english.extractedAnswers);
  });
});
