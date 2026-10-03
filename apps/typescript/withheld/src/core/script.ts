/**
 * Script generation and the pre-call gate.
 *
 * The number is blocked *here*, before generation, and the generated text is
 * scanned again before anything is dialled. Instructing a model not to say
 * something is not a control; not putting it in reach is.
 */

import {
  advisoryFlags,
  refusesCall,
  scanForNumbers,
  scanForProhibited,
} from './budget';
import type { ErrandFile, Finding } from './types';

export interface GeneratedScript {
  /** The goal text handed to CALL-E. */
  goal: string;
  findings: Finding[];
  advisories: string[];
  /** False means nothing may be dialled. */
  safeToDial: boolean;
}

/**
 * Windows are spoken, not transmitted. An agent reading an ISO timestamp aloud
 * would sound like a machine reciting a serial number — and digit-dense text is
 * exactly what the number gate is built to refuse.
 */
export function formatWindow(start: string, end: string): string {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return `${start} to ${end}`;
  }

  const day = from.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const hour = (d: Date) =>
    d.toLocaleTimeString('en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    });

  return `${day}, ${hour(from)} to ${hour(to)}`;
}

export function buildScript(errand: ErrandFile): GeneratedScript {
  const budget = errand.may_say.map((b) => `  - ${b}`).join('\n');
  const questions = errand.questions
    .map((q, i) => `  ${i + 1}. ${q.ask}`)
    .join('\n');
  const windows = errand.acceptable_windows
    .map((w) => `  - ${formatWindow(w.start, w.end)}`)
    .join('\n');

  const goal = `You are an automated assistant calling on behalf of ${errand.person.name}, with their permission.

Say this in your first sentence. Do not claim to be ${errand.person.name}. Do not
claim to be a person. If asked directly whether you are a human, say no.

WHAT YOU ARE CALLING ABOUT
${errand.goal}

WHAT YOU MAY SAY ABOUT ${errand.person.name.toUpperCase()}
These are the only facts about them you are permitted to state. Do not add to
this list, do not speculate, and do not confirm a guess the other party makes.
${budget}

WHAT TO ASK
${questions}

ACCEPTABLE TIMES
You may agree to an arrangement only inside these windows:
${windows}

THE CALLBACK RULE — THIS IS THE MOST IMPORTANT INSTRUCTION
${errand.person.name} cannot take an incoming phone call. A promise to "call
them back" ends this errand rather than advancing it.

Therefore:
  - You must NOT give out any phone number for ${errand.person.name}. You do not
    have one. If pressed, repeat that you cannot give a number and move on.
  - You must NOT accept an offer to call back.
  - When the other party offers to call back, or says they need time, say:
    "I'm not able to take a call back — when would be a good time for me to
    call you instead?"
  - Get a specific time or time range. "Sometime next week" is not a time; ask
    once more for something specific.
  - If they genuinely cannot name a time, say you will follow up and end the
    call politely. Do not leave a number.

STOPPING
  - Do not give medical, legal or financial advice or opinions.
  - If asked for anything not in the permitted list above, say you do not have
    that information and offer to check with ${errand.person.name}.
  - Do not agree to anything outside the acceptable windows.`;

  const findings: Finding[] = [
    ...scanForNumbers({
      text: goal,
      personPhone: errand.person.phone,
      where: 'script',
    }),
    ...scanForProhibited(goal, 'script'),
  ];

  return {
    goal,
    findings,
    advisories: advisoryFlags(`${errand.goal}\n${errand.questions.map((q) => q.ask).join('\n')}`),
    safeToDial: !refusesCall(findings),
  };
}
