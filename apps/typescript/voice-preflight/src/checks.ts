/**
 * Checks over a script and its rendered audio.
 *
 * Every finding here is a fact, either about the characters in the script or
 * about the audio that came back. None of them predicts how a provider will
 * pronounce anything, because nothing in this process can know that. The audio
 * is the ground truth and a person listening to it is the real check. These
 * findings exist to stop the cases where listening would not help, such as a
 * line that is no longer in the script at all.
 */

import type { Finding, ProviderDescriptor, Render, Script } from "./types.js";

/** Shortest run of digits that gets reported. Six is a one-time code. */
export const DIGIT_RUN_FLOOR = 4;

/** The language subtag of a BCP-47 tag, lowercased. `en-IN` becomes `en`. */
export function primaryLanguage(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

/**
 * A locked line has to appear in the task exactly.
 *
 * Substring rather than fuzzy on purpose. The point of declaring a line is that
 * it survives unchanged, so a near match is a failure, not a pass.
 */
export function checkLockedLines(script: Script): Finding[] {
  const findings: Finding[] = [];
  for (const locked of script.locked) {
    if (!script.task.includes(locked.text)) {
      findings.push({
        code: "locked_line_missing",
        message: `A locked line is not in the task, so it cannot be spoken. It was locked because ${locked.reason}.`,
        evidence: locked.text,
      });
    }
  }
  return findings;
}

/**
 * Report runs of digits carrying no separator.
 *
 * This is a structural observation and it is deliberately not a claim about
 * speech. A provider may read `999833` digit by digit or as a quantity. The
 * only way to find out is to listen to the audio this tool just rendered. The
 * finding says where to listen.
 */
export function checkDigitRuns(script: Script): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const match of script.task.matchAll(/\d{4,}/g)) {
    const run = match[0];
    if (seen.has(run)) continue;
    seen.add(run);
    findings.push({
      code: "digit_run_unseparated",
      message: `A run of ${run.length} digits has no separator. Listen to how the rendered audio reads it before this call goes out. This tool reports the run and does not predict the reading.`,
      evidence: run,
    });
  }
  return findings;
}

/** The voice has to be able to speak the recipient's language. */
export function checkVoiceLanguage(script: Script, descriptor: ProviderDescriptor): Finding[] {
  const want = primaryLanguage(script.locale);
  if (want.length === 0) return [];
  const can = descriptor.languages.map(primaryLanguage);
  if (can.includes(want)) return [];
  return [
    {
      code: "voice_language_mismatch",
      message: `The recipient locale is ${script.locale} and ${descriptor.name} declares this voice speaks ${descriptor.languages.join(", ")}. A call in the wrong language wastes the callee's time.`,
      evidence: `${script.locale} against ${descriptor.languages.join(" ")}`,
    },
  ];
}

/**
 * Compare the measured spoken length against the script's own budget.
 *
 * Skipped rather than guessed when the duration could not be measured. An
 * estimate from character count would be a number nobody checked.
 */
export function checkSpokenLength(script: Script, render: Render | null): Finding[] {
  if (render === null || render.seconds === null) return [];
  if (render.seconds <= script.maxSpokenSeconds) return [];
  return [
    {
      code: "spoken_too_long",
      message: `The rendered audio runs ${render.seconds.toFixed(1)}s against a budget of ${script.maxSpokenSeconds}s.`,
      evidence: `${render.seconds.toFixed(3)}s measured from ${render.path}`,
    },
  ];
}

/** Every offline check, in a stable order so output diffs cleanly. */
export function checkAll(
  script: Script,
  descriptor: ProviderDescriptor,
  render: Render | null,
): Finding[] {
  const findings = [
    ...checkLockedLines(script),
    ...checkVoiceLanguage(script, descriptor),
    ...checkDigitRuns(script),
    ...checkSpokenLength(script, render),
  ];
  if (script.task.length > descriptor.maxChars) {
    findings.unshift({
      code: "text_over_provider_limit",
      message: `The task is ${script.task.length} characters and ${descriptor.name} accepts ${descriptor.maxChars} in one request.`,
      evidence: `${script.task.length} > ${descriptor.maxChars}`,
    });
  }
  return findings;
}

/**
 * Which findings stop a call.
 *
 * A missing locked line, a language mismatch and an over-limit script are
 * refusals: each one means the call cannot do what the script says. A digit run
 * is reported and never blocks, because it is an observation rather than a
 * defect. A measured overrun blocks because the budget was the operator's
 * own number.
 */
export const BLOCKING: ReadonlySet<Finding["code"]> = new Set([
  "locked_line_missing",
  "voice_language_mismatch",
  "text_over_provider_limit",
  "spoken_too_long",
]);

export function blocks(findings: readonly Finding[]): boolean {
  return findings.some((f) => BLOCKING.has(f.code));
}
