import type { BusinessCandidate, CallFamily, DialTask, UserPolicy } from '@dial/schemas';
import { sanitizeExternalText } from '@dial/domain';

/**
 * Section 12. Turns a normalised task into the brief CALL-E's agent works from.
 *
 * The brief states goals and boundaries, not a word-for-word script -- CALL-E
 * holds the conversation, and a rigid script would fall apart the moment the
 * person on the other end says something unexpected. What it does pin down is
 * everything with a real-world consequence: what may be agreed to, what may not,
 * what may be disclosed, and what to do when the answer is not available.
 */

export interface CallPlanInput {
  task: DialTask;
  family: CallFamily;
  candidate: BusinessCandidate;
  policy: UserPolicy;
  /** Whether this call is authorised to actually commit the user. */
  mayCommit: boolean;
  /** Facts the user has explicitly supplied for this task. */
  userFacts: Record<string, string>;
  userDisplayName: string | null;
  /**
   * Fields earlier calls on this task failed to establish, in plain words.
   *
   * This is what makes each call smarter than the last one. The first call
   * works from the family checklist alone; by the fourth, Dial knows that
   * nobody has pinned down the warranty and says so, so the call spends its
   * two attempts on the gap instead of re-confirming what three businesses
   * have already answered.
   *
   * Empty on the first call of a task, and empty whenever the previous calls
   * answered everything -- there is nothing to chase.
   */
  unresolved?: string[];
}

export function buildCallBrief(input: CallPlanInput): string {
  const { task, family, candidate, policy, mayCommit, userFacts, userDisplayName } = input;

  const lines: string[] = [];

  lines.push(
    `You are an AI assistant placing a phone call on behalf of a customer. Be brief, polite and natural.`,
  );

  // Section 18: disclosure. Stated first because it must happen first.
  lines.push(
    `Identify yourself as an AI assistant calling on behalf of a customer at the start of the call. Never claim to be a human, and never claim to be the customer.`,
  );

  lines.push(``, `WHO YOU ARE CALLING`);
  lines.push(`${sanitizeExternalText(candidate.name, 120)}${candidate.category ? `, a ${candidate.category.replace(/_/g, ' ')}` : ''}.`);

  lines.push(``, `WHY`);
  lines.push(sanitizeExternalText(task.objective, 400));
  // Stated in the user's own words for a call to somebody they named. The
  // objective is Dial's paraphrase; this is what they actually asked for, and
  // it is the only thing the agent has to go on when nothing was searched for.
  if (task.callPurpose) {
    lines.push(`The caller asked specifically: ${sanitizeExternalText(task.callPurpose, 300)}`);
  }

  // The default family's only question used to be the objective itself, which
  // the WHY section already states verbatim. A checklist item that repeats the
  // objective reads as a second, separate thing to ask about -- one real call
  // asked the same two questions four times in a row because the brief listed
  // them twice. Anything that duplicates the objective is dropped, and the
  // section disappears entirely when nothing distinct remains.
  const questions = questionsFor(family, task).filter(
    (question) => normalizeForDedupe(question) !== normalizeForDedupe(task.objective),
  );
  if (questions.length > 0) {
    lines.push(``, `WHAT YOU MUST FIND OUT`);
    for (const question of questions) lines.push(`- ${question}`);
  }

  /*
   * What earlier calls on this task could not establish.
   *
   * Placed directly under the checklist so it reads as a priority ordering of
   * the same list rather than a second list of new topics -- the failure mode
   * to avoid is the agent treating this as extra work and asking twice as many
   * questions. Capped at four, because a brief that flags everything as a
   * priority has flagged nothing.
   */
  const unresolved = (input.unresolved ?? []).slice(0, 4);
  if (unresolved.length > 0) {
    lines.push(``, `ASK THESE FIRST`);
    lines.push(
      `Other businesses have already been called about this. These are the only things still missing, so get them early in the call in case it ends abruptly:`,
    );
    for (const item of unresolved) lines.push(`- ${sanitizeExternalText(item, 120)}`);
  }

  lines.push(``, `HOW TO ASK`);
  lines.push(`- One question at a time. Wait for the answer before asking the next.`);
  lines.push(
    `- Never ask the same question twice, even in different words. If they have answered it, that answer stands -- move to the next thing.`,
  );
  lines.push(
    `- If a reply is unclear, garbled, or does not address the question, record it as "unknown" in the structured result. Do not rephrase and ask again.`,
  );
  lines.push(
    `- When you have everything you were asked to find out -- or they have declined to give it -- thank them and end the call. Do not invent follow-up questions.`,
  );
  /*
   * The one follow-up that is allowed, and it is deliberately narrow.
   *
   * "Do not invent follow-up questions" above was written after a call that
   * rephrased its way through fifteen exchanges against a recording, and that
   * rule stays. But it also stopped the agent pinning down a half-answer: a
   * business would say "somewhere around eighty, depends on the model" and the
   * call would end with a price of unknown, when one more sentence would have
   * had a number.
   *
   * So: a follow-up is permitted only when the reply was real but incomplete,
   * and only once. Chasing a partial answer is not the failure mode -- asking
   * an unwilling business the same thing a fourth time is.
   */
  lines.push(
    `- One exception: if they give a real but incomplete answer -- a range, "it depends", "usually" -- you may ask ONE short follow-up to pin it down ("is that closer to eighty or a hundred?"). If the second answer is still vague, record what they actually said and move on.`,
  );

  const known = knownFacts(task, userFacts, userDisplayName);
  if (known.length) {
    lines.push(``, `WHAT YOU ALREADY KNOW (state these if asked; do not ask the business for them)`);
    for (const fact of known) lines.push(`- ${fact}`);
  }

  const constraints = constraintLines(task);
  if (constraints.length) {
    lines.push(``, `THE CUSTOMER'S REQUIREMENTS`);
    for (const line of constraints) lines.push(`- ${line}`);
  }

  lines.push(``, `WHAT COUNTS AS SUCCESS`);
  lines.push(sanitizeExternalText(task.successCondition, 300));

  lines.push(``, `WHAT YOU MAY AGREE TO`);
  if (mayCommit && task.requestedSideEffect === 'reservation') {
    lines.push(
      `- You may make a reservation on the customer's behalf, but only matching the requirements above.`,
    );
    lines.push(`- Get a confirmation name or reference before ending the call.`);
  } else if (mayCommit && task.requestedSideEffect === 'appointment') {
    lines.push(`- You may book an appointment matching the requirements above.`);
    lines.push(`- Confirm the date, time and anything the customer must bring.`);
  } else {
    lines.push(`- Nothing. This call is to gather information only.`);
    lines.push(
      `- Do NOT book, reserve, order, hold, or agree to anything. If they offer to book you in, say you will confirm separately.`,
    );
  }

  lines.push(``, `WHAT YOU MUST NOT DO`);
  lines.push(`- Do not agree to any payment, deposit, or card details.`);
  lines.push(`- Do not accept a price above what the customer asked for without saying you must check first.`);
  lines.push(`- Do not give out any personal detail that is not listed above as known.`);
  lines.push(`- Do not invent an answer. If they will not say, record that they would not say.`);
  lines.push(`- Do not argue, pressure, or call back repeatedly.`);

  // Section 17: identity facts are never fabricated.
  lines.push(
    `- If they ask for a detail you were not given (date of birth, an account number, a reference), say you do not have it and that the customer will follow up directly. Never guess or make one up.`,
  );

  if (policy.leaveVoicemail === 'never') {
    lines.push(`- Do not leave a voicemail. If you reach an answering machine, end the call.`);
  } else if (policy.leaveVoicemail === 'allow') {
    lines.push(
      `- If you reach voicemail, you may leave a short message saying a customer is enquiring, and end the call.`,
    );
  } else {
    lines.push(`- If you reach voicemail, end the call without leaving a message.`);
  }

  /*
   * Written after a real call ran to fifteen exchanges against a recorded
   * message. The recording said, three ways, that the restaurant could not
   * help by telephone and to use the website. Dial rephrased the same question
   * each time, waited, said "I'll hold", and asked again -- for minutes, at
   * the customer's expense, against a machine.
   *
   * Nothing in the brief was wrong; there was simply nothing in it about when
   * to stop. "Do not argue or call back repeatedly" reads as advice about
   * manner, not as a stop condition, so the agent kept being polite and kept
   * going.
   */
  lines.push(``, `WHEN TO END THE CALL`);
  lines.push(
    `- Ask for what you need at most twice. Rephrasing the same question counts as asking again. If the second reply does not answer it, thank them and end the call.`,
  );
  lines.push(
    `- If they say they cannot help by phone, or send you to a website, an email address, a live chat or a form: thank them, end the call, and record that they would not answer by phone. Do not rephrase and try again.`,
  );
  lines.push(
    `- If two replies say substantially the same thing, you are talking to a recording or a script. Thank them and end the call. Asking a recording again cannot work.`,
  );
  lines.push(
    `- If they ask you to hold, wait once. Do not repeat your question while waiting, and do not wait a second time.`,
  );
  lines.push(
    `- Ending politely with no answer is a good outcome. A long call that annoys somebody is not, and it is worse than "unknown" because it costs the customer their reputation with that business.`,
  );

  lines.push(``, `IF THEY ASK SOMETHING UNEXPECTED`);
  lines.push(
    `Answer only from what you know above. If you cannot, say plainly that you will pass the question back to the customer. It is always better to return "unknown" than to guess.`,
  );

  lines.push(``, `RECORDING THE ANSWER`);
  lines.push(
    `Fill in the structured result honestly. Use "unknown" wherever the business did not clearly answer. Do not turn a vague or non-committal reply into a definite yes or a firm price.`,
  );
  lines.push(
    `If they refused, or could only direct you elsewhere, say so in the refusal or evidence field in their own words -- "only takes enquiries via the website". That is a real answer about this business and the customer can act on it. "Unknown" with no reason is not.`,
  );

  return lines.join('\n');
}

function questionsFor(family: CallFamily, task: DialTask): string[] {
  const extras = task.constraints.additional;
  const device = typeof extras['device'] === 'string' ? extras['device'] : null;
  const issue = typeof extras['issue'] === 'string' ? extras['issue'] : null;

  switch (family.id) {
    case 'repair_quote':
      return [
        `Whether they can repair ${device ?? 'the customer’s device'}${issue ? ` (${issue})` : ''}.`,
        'The total price, and whether that price includes tax.',
        'Whether the parts are original, original-equivalent, or aftermarket.',
        'How long the repair takes, and whether it can be done today.',
        'What warranty is offered.',
        'Whether an appointment is needed.',
      ];
    case 'service_quote':
      return [
        'Whether they can do this job.',
        'The estimated price for the work.',
        'Any separate callout or travel fee.',
        'Whether parts are included in that figure.',
        'The earliest they could attend.',
        'Whether the figure is a fixed price or an estimate.',
      ];
    case 'reservation':
      return [
        `Whether they have a table for ${task.constraints.partySize ?? 'the party'}${task.constraints.date ? ` on ${task.constraints.date}` : ''}${task.constraints.timeWindow?.earliest ? ` around ${task.constraints.timeWindow.earliest}` : ''}.`,
        'If not, what nearby times they do have.',
        'Any conditions (deposit, time limit on the table, dress code).',
      ];
    case 'appointment':
      return [
        'Whether they have an appointment available in the requested window.',
        'The earliest date and time available.',
        'The likely cost.',
        'Anything the customer needs to bring or do beforehand.',
      ];
    case 'availability_check':
      return [
        'Whether the thing the customer asked about is available.',
        'The price, if relevant.',
        'When it will be available if it is not right now.',
      ];
    case 'status_check':
      return [
        'The status of the item the customer asked about.',
        'If they will not say, why not, and what the customer should do instead.',
        'Whether it is ready to collect, and the collection hours.',
      ];
    default:
      // The objective already appears in WHY. Restating it here made the agent
      // treat it as a second topic and loop through both.
      return [];
  }
}

/** Case- and punctuation-insensitive comparison so near-identical lines dedupe. */
function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function constraintLines(task: DialTask): string[] {
  const out: string[] = [];
  const c = task.constraints;

  if (c.budget) {
    const word = c.budget.comparator === 'max' ? 'no more than' : c.budget.comparator === 'min' ? 'at least' : 'around';
    out.push(`Budget: ${word} ${c.budget.currency} ${c.budget.amount}.`);
  }
  if (c.date) out.push(`Date: ${c.date}.`);
  if (c.timeWindow?.earliest) {
    const flex = c.timeWindow.flexibilityMinutes;
    out.push(
      `Time: around ${c.timeWindow.earliest}${c.timeWindow.latest ? ` to ${c.timeWindow.latest}` : ''}` +
        (flex > 0
          ? `. You may accept up to ${flex} minutes either side, but nothing outside that.`
          : `. Do not accept a different time.`),
    );
  }
  if (c.partySize) out.push(`Party size: ${c.partySize}.`);
  for (const [key, value] of Object.entries(c.additional)) {
    if (typeof value === 'string' || typeof value === 'number') {
      out.push(`${key.replace(/_/g, ' ')}: ${sanitizeExternalText(String(value), 120)}.`);
    }
  }
  return out;
}

function knownFacts(
  task: DialTask,
  userFacts: Record<string, string>,
  userDisplayName: string | null,
): string[] {
  const out: string[] = [];
  if (userDisplayName) out.push(`The customer's name is ${sanitizeExternalText(userDisplayName, 80)}.`);
  for (const [key, value] of Object.entries(userFacts)) {
    out.push(`${key.replace(/_/g, ' ')}: ${sanitizeExternalText(value, 160)}.`);
  }
  if (task.constraints.additional['device']) {
    out.push(`Device: ${sanitizeExternalText(String(task.constraints.additional['device']), 80)}.`);
  }
  return out;
}

/* ------------------------------------------ what is still missing ------ */

/** Fields every family carries for bookkeeping; never worth chasing on a call. */
const NEVER_CHASE = new Set(['business_name', 'confidence', 'evidence_summary']);

/**
 * Reads a value as "the business actually told us this".
 *
 * The tri-state fields use the literal string "unknown", numbers use 0 for
 * "none given", and a refused text field comes back empty. All three mean the
 * same thing here: nobody has answered it yet.
 */
function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v !== '' && v !== 'unknown' && v !== 'n/a';
  }
  return true;
}

/**
 * Which of this family's fields no business has answered yet.
 *
 * This is what lets a task get smarter as it goes. Dial rings five garages
 * with the same checklist; if four of them gave a price but none would say
 * anything about a warranty, the fifth call should lead with the warranty
 * rather than collecting a fifth price nobody needed.
 *
 * Deliberately keyed on "has *any* call answered it", not "did the last call
 * answer it" -- one business's answer about its own warranty does not tell us
 * about another's, but it does mean the question is no longer the gap in what
 * Dial knows. Fields are returned in schema order, which puts the load-bearing
 * ones (can they do it, what does it cost) before the details.
 */
export function unresolvedFields(
  family: CallFamily,
  priorResults: Array<Record<string, unknown> | null>,
): string[] {
  // Nothing to learn from on the first call of a task: the checklist stands
  // on its own and flagging every field as "still missing" would be noise.
  const results = priorResults.filter((r): r is Record<string, unknown> => Boolean(r));
  if (results.length === 0) return [];

  const schema = family.resultSchema as { properties?: Record<string, { description?: string }> };
  const properties = schema.properties ?? {};

  const missing: string[] = [];
  for (const [field, spec] of Object.entries(properties)) {
    if (NEVER_CHASE.has(field)) continue;
    if (results.some((result) => isAnswered(result[field]))) continue;
    // The schema's own description is already a plain-English question about
    // the field; the bare field name is the fallback for the ones that have
    // none, and reads acceptably once the underscores are gone.
    missing.push(spec.description?.trim() || field.replace(/_/g, ' '));
  }
  return missing;
}
