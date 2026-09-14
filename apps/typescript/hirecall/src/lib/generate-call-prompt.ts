import type { RecruiterDecision } from "@/lib/types";
import { DEFAULT_SCORE_CONFIG, scoreCriteriaLines, type ScoreConfig } from "@/lib/score-config";

export type PromptSource = "gemini" | "dry-run";

export const DEFAULT_CALL_PROMPT_SYSTEM = `You write a CALL-E voice-agent prompt for a live phone screening interview in India.
Output only the CALL-E prompt. No preamble, no markdown title, no notes for the recruiter.
Under 1500 words. Natural phone tone.

Read THIS resume. Write questions from what is actually on it: education, then projects, internships/work, or skills if they appear. Do not use a fixed question list. Do not copy the example names below. Invent branches from this candidate's resume.
Every main question must have branching: If they say X, ask Y. If they cannot explain, ask Z.

The CALL-E prompt MUST contain these labeled parts, in this order:
1. Identity
2. Hard rules
3. Start
4. Resume questions with branches
5. If they ask something else
6. Close

Copy Hard rules into the CALL-E prompt in short agent language (not as notes to yourself). CALL-E is the one that talks.

Hard rules the agent must follow on the call:
- Disclosure: this is an automated HireCall screening for the given role. It is not a job offer.
- Facts: use only this resume. If a detail is missing, ask. Never invent college, degree, employer, project, skill, stipend, location, or joining date.
- No hiring power: never say they are selected, rejected, or that an offer is coming. The recruiter follows up.
- No secrets: never ask for or accept OTP, PIN, password, bank/UPI, card, Aadhaar, PAN, or date of birth as ID. If they start to give one, stop them and end the call.
- Time: about 5 to 8 minutes. One question at a time. If they ramble, cut in and move on.
- Stop and hang up politely when: wrong person, they ask not to be called, they demand secrets, they are abusive, or the line stays bad after one retry.

If they ask something else (off-script), answer in one short sentence, then return to the next interview question. If you do not know, say the recruiter will follow up.
Cover at least: not a good time, wrong person, "who is this", they ask about the role/salary/result, they go off-topic, they cannot hear, they refuse a question, they ask to speak to a human, they start to give OTP/bank/ID.

EXAMPLE of the shape you must output (facts here are fake; replace them from the real resume):

Identity: You are HireCall calling Priya Sharma about a Software intern role in India. Speak English. One question at a time.

Hard rules:
This is an automated HireCall screening for the Software intern role. It is not a job offer.
Use only this resume. If a detail is missing, ask. Never invent college, degree, employer, project, skill, stipend, location, or joining date.
Never say they are selected, rejected, or that an offer is coming. The recruiter follows up.
Never ask for or accept OTP, PIN, password, bank/UPI, card, Aadhaar, PAN, or date of birth as ID. If they start to give one, stop them and end the call.
Keep the call to about 5 to 8 minutes. One question at a time. If they ramble, cut in and move on.
Hang up politely if: wrong person, they ask not to be called, they demand secrets, they are abusive, or the line stays bad after one retry.

Start: "Hi Priya, this is HireCall, an automated screening call for the Software intern role. This is not a job offer. Is now a good time?"
If they say no, ask when to call back and end politely.
If they say yes, continue.

Education: "Your resume shows a B.Tech in Computer Science at NIT Trichy. Can you walk me through that?"
If they confirm, ask: "Which subjects from that course do you still use?"
If they mention a subject on the resume (for example DBMS), ask how they used it in a project.
If they are unsure about college or branch, ask: "What did you study, and which year are you in?"

Projects: "You listed a campus attendance app. What was your part in it?"
If they say they built the backend, ask: "How did you store attendance, and why that choice?"
If they say they only designed UI, ask: "What was the hardest UI problem you solved?"
If they cannot explain the project, ask: "In one sentence, what did the app do, and what did you personally write?"

If they ask something else:
If they ask "who is this / is this a scam", say: "This is HireCall, an automated screening call for the Software intern role you applied for." Then continue.
If they ask what the job is, give one line: "It is a Software intern screening. I will ask a few questions from your resume." Then continue. Do not invent stipend, location, or joining date.
If they ask salary, stipend, offer, or "did I get the job", say: "I do not have that. The recruiter will follow up after this call." Then return to the next question.
If they are the wrong person or they did not apply, apologise, confirm the name, and end the call.
If they cannot hear or the line is bad, ask them to repeat once. If still bad, offer a callback and end.
If they refuse a question, skip it and go to the next one. Do not argue.
If they ramble or ask off-topic things, acknowledge in one sentence and steer back: "Got it. Next question is..."
If they ask to speak to a human, say the recruiter will call them, take a preferred time if they give one, and end politely.
If they start to give OTP, PIN, password, bank/UPI, card, Aadhaar, PAN, or date of birth, say: "Please do not share that. I do not need it." Then end the call.

Close: thank them and say the recruiter will follow up.`;

const RESUME_CHAR_LIMIT = 12_000;
const DEFAULT_ROLE = "internship / junior role";
const DEFAULT_MODEL = "gemini-3.6-flash";

function resumeExcerpt(resumeText: string) {
  const text = resumeText.trim();
  if (text.length <= RESUME_CHAR_LIMIT) return text;
  return `${text.slice(0, RESUME_CHAR_LIMIT)}\n[Resume truncated]`;
}

function roleLabel(jobRole: string) {
  return jobRole.trim() || DEFAULT_ROLE;
}

function geminiConfig() {
  const key = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  return { key, model };
}

type GeminiResponse = {
  error?: { message?: string };
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
};

function geminiText(body: GeminiResponse) {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => !part.thought && part.text)
    .map((part) => part.text?.trim() ?? "")
    .join("\n")
    .trim();
}

async function generateGeminiText(
  prompt: string,
  maxOutputTokens: number,
  systemInstruction?: string,
) {
  const { key, model } = geminiConfig();
  if (!key) {
    throw new Error("GEMINI_API_KEY is missing. Add it in .env next to package.json and restart npm run dev.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const payload: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens,
    },
  };
  const system = systemInstruction?.trim();
  if (system) {
    payload.systemInstruction = { parts: [{ text: system }] };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) {
    throw new Error(body.error?.message || "Gemini did not respond.");
  }
  const text = geminiText(body);
  if (!text) {
    throw new Error("Gemini returned an empty reply.");
  }
  return { text, model };
}

export function dryRunCallPrompt(name: string, resumeText: string, jobRole = ""): string {
  return [
    `You are HireCall, an outbound screening agent calling ${name} about a ${roleLabel(jobRole)} in India.`,
    "Use only facts in this resume. Do not invent employers, degrees, or skills.",
    "This text is the CALL-E agent prompt for this resume. It is not the spoken question list.",
    "",
    "RESUME:",
    resumeExcerpt(resumeText),
  ].join("\n");
}

export async function generateCallPrompt(
  name: string,
  resumeText: string,
  jobRole = "",
): Promise<{ prompt: string; source: PromptSource }> {
  const { key } = geminiConfig();
  if (!key) {
    return { prompt: dryRunCallPrompt(name, resumeText, jobRole), source: "dry-run" };
  }

  const { text } = await generateGeminiText(
    [`Candidate name: ${name}`, `Job role: ${roleLabel(jobRole)}`, "", "Resume:", resumeExcerpt(resumeText)].join(
      "\n",
    ),
    4096,
    DEFAULT_CALL_PROMPT_SYSTEM,
  );
  return { prompt: text, source: "gemini" };
}

export async function pingGemini(): Promise<{ reply: string; model: string }> {
  const { text, model } = await generateGeminiText("Reply with exactly: HireCall ok", 256);
  return { reply: text, model };
}

const SUMMARY_SYSTEM = `You score a completed HireCall phone screening in India.
Use only the screening result and the recruiter's scoring criteria. Do not invent colleges, employers, projects, or skills.
Score 0 to 10 as an integer against those criteria only.
If they did not take the call, score 0.
Output ONLY JSON, no markdown: {"score":7,"summary":"four to eight sentences"}
The summary must explain the score against the criteria. Do not decide next round yourself.`;

export const DEFAULT_PASS_SCORE = 7;

export function passScore() {
  const raw = Number(process.env.HIRECALL_PASS_SCORE ?? DEFAULT_PASS_SCORE);
  if (!Number.isFinite(raw)) return DEFAULT_PASS_SCORE;
  return Math.min(10, Math.max(1, Math.round(raw)));
}

export type ScreeningVerdict = {
  summary: string;
  score: number;
  decision: RecruiterDecision;
};

function parseScorePayload(text: string): { score: number; summary: string } {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
  const block = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  const parsed = JSON.parse(block) as { score?: unknown; summary?: unknown };
  const score = Math.round(Number(parsed.score));
  const summary = String(parsed.summary ?? "").trim();
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new Error("Gemini did not return a score from 0 to 10.");
  }
  return { score, summary: summary || "Screening scored." };
}

export async function summarizeScreeningCall(input: {
  name: string;
  jobRole: string;
  durationSeconds: number | null;
  scoreConfig?: ScoreConfig;
  result: {
    identity_confirmed: string;
    good_time: string;
    education: string;
    projects: string;
    work_or_internship: string;
    off_script: string;
    end_reason: string;
    recruiter_follow_up: string;
    callee_quote: string;
  };
}): Promise<ScreeningVerdict> {
  const config = input.scoreConfig ?? DEFAULT_SCORE_CONFIG;
  const pass = config.passScore || passScore();
  const criteria = scoreCriteriaLines(config);
  const { key } = geminiConfig();
  const facts = [
    `Candidate: ${input.name}`,
    `Job role: ${roleLabel(input.jobRole)}`,
    `Duration seconds: ${input.durationSeconds ?? "unknown"}`,
    `Identity confirmed: ${input.result.identity_confirmed}`,
    `Good time: ${input.result.good_time}`,
    `End reason: ${input.result.end_reason}`,
    `Education: ${input.result.education || "not discussed"}`,
    `Projects: ${input.result.projects || "not discussed"}`,
    `Work or internship: ${input.result.work_or_internship || "not discussed"}`,
    `Off script: ${input.result.off_script || "none"}`,
    `Recruiter follow-up note: ${input.result.recruiter_follow_up || "none"}`,
    `Callee quote: ${input.result.callee_quote || "none"}`,
    `Pass mark: ${pass} out of 10`,
    `Score only against these criteria:`,
    ...criteria.map((line, index) => `${index + 1}. ${line}`),
  ].join("\n");

  let score = 0;
  let summary = "";
  if (!key) {
    const filled = [input.result.education, input.result.projects, input.result.work_or_internship].filter(
      (part) => part.trim().length > 40,
    ).length;
    score = input.result.end_reason === "completed" ? Math.min(6, 2 + filled * 2) : 0;
    summary =
      [
        input.result.recruiter_follow_up,
        input.result.education,
        input.result.projects,
        input.result.work_or_internship,
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || "Screening finished. Add GEMINI_API_KEY to score this call.";
  } else {
    const { text } = await generateGeminiText(facts, 1024, SUMMARY_SYSTEM);
    const parsed = parseScorePayload(text);
    score = parsed.score;
    summary = parsed.summary;
  }

  return {
    summary,
    score,
    decision: "",
  };
}

const FOLLOW_UP_SYSTEM = `You rewrite a CALL-E voice-agent prompt for a follow-up screening call in India.
The first call already happened. Output only the CALL-E prompt. No preamble.
This is a follow-up because some answers were unclear or missing.
Ask only about what was unclear or not explained. Do not repeat questions they already answered clearly.
Keep Identity, Hard rules, Start, If they ask something else, and Close.
Start by saying this is HireCall calling again about the same role, and ask if now is a good time.
Use only resume facts. Do not invent colleges, degrees, employers, or projects.
One question at a time. Under 1500 words.`;

export async function generateFollowUpCallPrompt(input: {
  name: string;
  jobRole: string;
  resumeText: string;
  previousPrompt: string;
  result: {
    education?: string;
    projects?: string;
    work_or_internship?: string;
    off_script?: string;
    recruiter_follow_up?: string;
  } | null;
  summary: string;
}): Promise<string> {
  const { key } = geminiConfig();
  const unclear = [
    !input.result?.education?.trim() ? "Education was not explained clearly." : `Education they said: ${input.result.education}`,
    !input.result?.projects?.trim() ? "Projects were not explained clearly." : `Projects they said: ${input.result.projects}`,
    !input.result?.work_or_internship?.trim()
      ? "Work or internship was not explained clearly."
      : `Work they said: ${input.result.work_or_internship}`,
    input.result?.off_script ? `Off-script: ${input.result.off_script}` : "",
    input.summary ? `Gemini summary of first call: ${input.summary}` : "",
    input.result?.recruiter_follow_up ? `Follow-up note: ${input.result.recruiter_follow_up}` : "",
  ].filter(Boolean);

  if (!key) {
    return [
      input.previousPrompt,
      "",
      "FOLLOW-UP: This is a second call. Only ask what was still unclear:",
      ...unclear,
    ].join("\n");
  }

  const { text } = await generateGeminiText(
    [
      `Candidate name: ${input.name}`,
      `Job role: ${roleLabel(input.jobRole)}`,
      "",
      "Unclear or missing from the first call:",
      ...unclear,
      "",
      "Previous CALL-E prompt:",
      input.previousPrompt,
      "",
      "Resume:",
      resumeExcerpt(input.resumeText),
    ].join("\n"),
    4096,
    FOLLOW_UP_SYSTEM,
  );
  return text;
}
