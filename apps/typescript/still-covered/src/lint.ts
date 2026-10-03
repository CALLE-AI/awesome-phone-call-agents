// A linter for CALL-E call tasks.
//
// Every rule here was paid for by a real phone call. Four live screening calls produced six defects,
// and each one traced back to something the task text either failed to forbid or forbade too loosely.
// Those lessons are not specific to Medicaid, so this module takes *any* CALL-E task string and
// reports which boundaries it leaves undefended.
//
// It is deliberately a linter and not a judge: it reads the instructions, not a transcript. A task
// that passes every rule can still be ignored by a model on the day - that is what the conformance
// probes are for. Passing here means the instruction exists to be followed.

export type Severity = "error" | "warning";

export interface LintRule {
  id: string;
  severity: Severity;
  /** What the task must do. */
  requirement: string;
  /** The real call that produced this rule. */
  learnedFrom: string;
  /** True when the task satisfies the rule. */
  satisfied: (task: string) => boolean;
  /** Shown when it does not. */
  fix: string;
}

export interface LintFinding {
  id: string;
  severity: Severity;
  requirement: string;
  learnedFrom: string;
  fix: string;
}

export interface LintReport {
  errors: number;
  warnings: number;
  passed: string[];
  findings: LintFinding[];
}

const has = (task: string, ...patterns: RegExp[]): boolean => patterns.some((p) => p.test(task));

/** Sensitive things a benefits or healthcare call must never request. */
const SENSITIVE_ASK = /social security number|\bssn\b|bank account|routing number|credit card|immigration status|green card|date of birth in full|mother's maiden/i;

export const RULES: LintRule[] = [
  {
    id: "identity-before-disclosure",
    severity: "error",
    requirement: "Confirm who is on the line before naming the programme, the rule, or anything else about their situation.",
    learnedFrom: "A household member answered one call. Nothing had been disclosed, because the task forbade it - but only because it said so explicitly.",
    satisfied: (t) => has(t, /before .{0,40}(confirm|verif)/i, /do not mention .{0,60}until/i, /until .{0,40}(confirmed|verified|matches)/i),
    fix: "Add an explicit line: do not mention the programme or the rule until the person has confirmed who they are.",
  },
  {
    id: "never-offer-the-verifier",
    severity: "error",
    requirement: "Never speak the verifying fact yourself; ask for it and wait.",
    learnedFrom: "Across four calls the agent asked for a birth year up to four times in 59 seconds and never once offered it to move things along - because the task forbade that in one sentence.",
    satisfied: (t) => has(t, /never say the (year|date|value|answer) yourself/i, /do not (say|offer|read out) the (year|date|value)/i, /ask them to confirm .{0,60}never/i),
    fix: "Add: never say the verifying value yourself, even to speed things up. Ask, and wait for them to say it.",
  },
  {
    id: "never-determines",
    severity: "error",
    requirement: "Forbid the agent from stating an outcome, approval, or guarantee.",
    learnedFrom: "Pushed three times to say a caller was exempt, the agent said \"I cannot approve or guarantee your coverage\" - then \"you likely qualify\", which was stronger than authorised.",
    satisfied: (t) => has(t, /never say they are (exempt|approved|eligible|covered)/i, /cannot (approve|decide|guarantee|determine)/i, /you are not a (caseworker|decision|adjudicator)/i),
    fix: "State plainly what the agent may never say, and give the exact permitted alternative wording.",
  },
  {
    id: "bounded-closings",
    severity: "error",
    requirement: "Enumerate the permitted closing messages rather than leaving the summary to the model.",
    learnedFrom: "Given latitude, the agent closed with \"you likely qualify\" and sent the caller to a website - dropping the human-review caveat and the navigator offer entirely.",
    satisfied: (t) => has(t, /only one of these|using only one of|one of these three|never anything stronger/i),
    fix: "List the closings verbatim and say only these may be used, and nothing stronger.",
  },
  {
    id: "no-sensitive-asks",
    severity: "error",
    requirement: "Forbid asking for identifiers a scammer would want.",
    learnedFrom: "Benefits outreach is a known fraud cover. An agent that asks for an SSN trains people to give one to the next caller who asks.",
    satisfied: (t) => has(t, /do not ask for .{0,80}(social security|bank|immigration|diagnos)/i, /never ask for .{0,80}(social security|bank|immigration|diagnos)/i),
    fix: "Add: never ask for a Social Security number, bank details, immigration status or a diagnosis.",
  },
  {
    id: "one-question-at-a-time",
    severity: "error",
    requirement: "Require exactly one question per turn, and forbid combining eligibility questions.",
    learnedFrom: "A live call asked \"are you under 18, pregnant, or a caregiver for a child, an elderly person, or a person with a disability?\" and took one \"no\" for all four. That answer is unattributable.",
    satisfied: (t) => has(t, /one (short )?(question|thing) at a time/i, /never combine|do not combine|ask exactly one/i),
    fix: "Add: ask exactly one thing at a time, and never combine two eligibility questions - a single answer to a combined question cannot be attributed to either part.",
  },
  {
    id: "no-invented-policy",
    severity: "error",
    requirement: "Forbid inventing eligibility criteria, thresholds or rules not supplied in the task.",
    learnedFrom: "The same call invented three criteria that appeared nowhere in the rules file, including certifying that an employer could not supply enough hours.",
    satisfied: (t) => has(t, /never invent|do not invent|only the questions (written|listed)/i),
    fix: "Add: ask only the questions written here, and never invent a criterion, threshold or rule that is not written down.",
  },
  {
    id: "no-answer-coaching",
    severity: "error",
    requirement: "Forbid previewing which answers qualify before asking.",
    learnedFrom: "One call announced which situations counted as exemptions, then asked whether the caller was in one. Coaching the answer invites a false yes that a human then has to disprove.",
    satisfied: (t) => has(t, /never say which .{0,40}(count|qualify)/i, /do not preview|do not hint|without telling them which answer/i),
    fix: "Add: never say which answers qualify before asking, and do not hint at which answer helps.",
  },
  {
    id: "interruption-handling",
    severity: "error",
    requirement: "Re-ask an interrupted question in full, and never record a half-asked question as answered.",
    learnedFrom: "From 99 seconds into one call every question arrived clipped - \"Are you currently caring\", \"About\", \"How\" - because a murmur was enough to stop the agent speaking. The caller was answering half-questions.",
    satisfied: (t) => has(t, /interrupted/i, /ask .{0,40}again from the beginning/i, /did not finish asking/i),
    fix: "Add: if interrupted or asked to repeat, ask the question again in full, and mark it unknown rather than answered if you did not finish asking it.",
  },
  {
    id: "language-lock",
    severity: "warning",
    requirement: "Pin the language to the person's record; do not let one unclear reply switch it.",
    learnedFrom: "Our own task said \"switch if they answer in another language\". One mis-heard utterance is enough to act on that, and it moves the call away from the language on the person's own record.",
    satisfied: (t) => !has(t, /switch if they (answer|speak|reply)/i) || has(t, /stay in .{0,30} for the whole call/i, /more than once/i),
    fix: "Pin the language: change only if the person clearly speaks another one more than once, and apologise in their language rather than falling back.",
  },
  {
    id: "voicemail-names-no-programme",
    severity: "warning",
    requirement: "If a voicemail message is included, it must not name the programme.",
    learnedFrom: "Answering machines are shared with housemates, family and employers. A voicemail may ask for a callback; it must not disclose what the person is enrolled in.",
    satisfied: (t) => {
      // Every voicemail line, not just the first: a task can hold one safe script and one leaky one,
      // and checking only the first would pass the task on the strength of the safe one.
      const lines = t.split("\n").filter((l) => /voicemail|answering machine|machine answers/i.test(l));
      return lines.every((l) => !/medicaid|medicare|snap|tanf|benefit programme|benefit program/i.test(l));
    },
    fix: "Rewrite the voicemail to name no programme: \"an important message about your health coverage\" discloses nothing.",
  },
  {
    id: "does-not-ask-for-sensitive",
    severity: "error",
    requirement: "The task's own spoken lines must not request sensitive identifiers.",
    learnedFrom: "A rule that forbids asking for an SSN is undermined by a script that asks for one.",
    satisfied: (t) => {
      // Only inspect lines that look like things the agent says, not the prohibitions themselves.
      const spoken = t.split("\n").filter((l) => /"/.test(l) && !/do not|never|forbid/i.test(l));
      return !spoken.some((l) => SENSITIVE_ASK.test(l));
    },
    fix: "Remove the request for a sensitive identifier from the spoken lines.",
  },
  {
    id: "states-it-is-automated",
    severity: "warning",
    requirement: "Disclose that the call is automated.",
    learnedFrom: "An AI voice is an \"artificial\" voice under the TCPA (FCC 24-17). Disclosure is also the difference between a call people trust and one they report.",
    satisfied: (t) => has(t, /automated (call|assistant|message)/i, /this is an automated/i),
    fix: "Say in the opening line that this is an automated call, and identify who it is from.",
  },
  {
    id: "offers-a-human",
    severity: "warning",
    requirement: "Offer a route to a person.",
    learnedFrom: "Any call that can reach somebody in difficulty needs an exit to a human who can actually help.",
    satisfied: (t) => has(t, /if they ask for a (person|human)/i, /navigator|speak to (a|an) (person|human|adviser|advisor|agent)/i, /call ?back (number|line)/i),
    fix: "Add a line giving a human callback number, and what to say if the person asks to speak to someone.",
  },
];

export function lintCallTask(task: string): LintReport {
  const findings: LintFinding[] = [];
  const passed: string[] = [];
  for (const rule of RULES) {
    if (rule.satisfied(task)) {
      passed.push(rule.id);
    } else {
      findings.push({ id: rule.id, severity: rule.severity, requirement: rule.requirement, learnedFrom: rule.learnedFrom, fix: rule.fix });
    }
  }
  return {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    passed,
    findings,
  };
}

export function formatLintReport(report: LintReport): string {
  const lines: string[] = [];
  lines.push(`${report.passed.length} of ${RULES.length} boundaries defended - ${report.errors} error(s), ${report.warnings} warning(s).`);
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("Every rule is satisfied. The instructions exist; whether the agent follows them on the day is");
    lines.push("what the conformance probes are for.");
    return `${lines.join("\n")}\n`;
  }
  for (const f of report.findings) {
    lines.push(`${f.severity.toUpperCase()}  ${f.id}`);
    lines.push(`  Requirement: ${f.requirement}`);
    lines.push(`  Learned from: ${f.learnedFrom}`);
    lines.push(`  Fix: ${f.fix}`);
    lines.push("");
  }
  lines.push(`Passing: ${report.passed.join(", ") || "none"}`);
  return `${lines.join("\n")}\n`;
}
