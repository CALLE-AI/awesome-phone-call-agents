/**
 * THE DETERMINISTIC SIMULATED FACILITY.
 *
 * Produces a realistic, IMPERFECT transcript from a facility's ground-truth
 * state. It deliberately does not produce clean labelled data: staff hedge,
 * misremember, hand the phone to someone else, answer a different question, or
 * simply do not know. Some calls never reach a human at all.
 *
 * Nothing here is a real phone call. See transport.js for the disabled real
 * adapter and the exact request shape it would send.
 */

import { streamFor } from './rng.js';

const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

export const DISCLOSURE =
  'Hi, this is an automated verification call from the Maricopa County Heat Relief Network directory team. ' +
  'This call is recorded and I am an AI assistant. I have a few short questions to keep your public listing accurate. Is now an okay time?';

/** How each persona behaves under questioning. */
const PERSONA = {
  knowledgeable_manager: { direct: 0.82, hedge: 0.12, ambiguous: 0.05, misinformed: 0.012, greeting: 'Front desk, this is Dana speaking.' },
  front_desk_unsure:     { direct: 0.5,  hedge: 0.26, ambiguous: 0.14, misinformed: 0.03,  greeting: 'Hello, cooling center.' },
  new_volunteer:         { direct: 0.42, hedge: 0.26, ambiguous: 0.16, misinformed: 0.06,  greeting: 'Uh, hi, hello? This is the front desk I think.' },
  terse_maintenance:     { direct: 0.48, hedge: 0.08, ambiguous: 0.22, misinformed: 0.03,  greeting: 'Yeah.' },
  bilingual_handoff:     { direct: 0.58, hedge: 0.18, ambiguous: 0.11, misinformed: 0.025, greeting: 'Buenas, un momento — let me get someone. Hold on.' },
};

const QUESTION_TEXT = {
  open_now: 'First, is the cooling center open and accepting people right now?',
  hours: 'What hours are you open today?',
  pet_policy: 'Are pets allowed inside, or is it service animals only?',
  accessibility: 'Is the entrance wheelchair accessible?',
  intake_requirements: 'Does someone need to show a photo ID or a referral to come in?',
  capacity_status: 'Do you have space available right now, or are you close to full?',
};

/* --------------------------------------------------------- answer text --- */

function hoursPhrase(canonical, s) {
  const [o, c] = canonical.split('-');
  const oh = parseInt(o, 10);
  const ch = parseInt(c, 10);
  const c12 = ch > 12 ? ch - 12 : ch;
  return s.pick([
    `We're open ${oh} to ${c12} today.`,
    `${oh}:00 in the morning until ${c12}:00 in the evening.`,
    `We open at ${NUM_WORDS[oh] ?? oh} and we close at ${NUM_WORDS[c12] ?? c12}.`,
    `Today it's ${oh} a.m. to ${c12} p.m., same as usual.`,
    `Doors open ${oh}am, last entry is ${c12}pm.`,
  ]);
}

const DIRECT = {
  open_now: (v, s) =>
    v
      ? s.pick(["Yes, we're open right now, come on in.", "Yep, open and taking people.", "We are open, yes."])
      : s.pick(["No, we're closed today.", "We're not open right now, no.", "Not today — we're closed."]),
  hours: (v, s) => hoursPhrase(v, s),
  pet_policy: (v, s) =>
    ({
      pets_allowed: s.pick(['Pets are allowed inside, yes.', 'Yeah, pets are welcome.']),
      service_animals_only: s.pick(['Service animals only, I\'m afraid.', 'It\'s service animals only here.']),
      crated_pets_only: s.pick(['Crated pets only — they have to be in a carrier.', 'Pets have to be crated.']),
      no_pets: s.pick(['No pets, sorry.', 'We don\'t allow any animals inside.']),
    })[v],
  accessibility: (v, s) =>
    ({
      fully_accessible: s.pick(['Yes, the entrance is wheelchair accessible.', 'We\'re fully accessible, yes.']),
      ramp_only: s.pick(['There\'s a ramp at the side entrance, but the main door has a step.', 'Ramp access only, around the side.']),
      not_accessible: s.pick(['No, it\'s not wheelchair accessible unfortunately.', 'Not accessible, there\'s stairs.']),
    })[v],
  intake_requirements: (v, s) =>
    ({
      no_id_required: s.pick(['No ID required, anyone can come in.', 'You don\'t need any ID.']),
      id_requested_not_required: s.pick(['We ask for ID but it\'s not required.', 'We request ID, but nobody is turned away without one.']),
      photo_id_required: s.pick(['Photo ID is required, yes.', 'You need a photo ID to come in.']),
      referral_required: s.pick(['You need a referral from a caseworker.', 'It\'s referral only through the county.']),
    })[v],
  capacity_status: (v, s) =>
    ({
      space_available: s.pick(['We have space available right now.', 'Plenty of room, yes.']),
      near_capacity: s.pick(['We\'re close to full, honestly.', 'Near capacity right now.']),
      at_capacity: s.pick(['We\'re at capacity, we can\'t take more right now.', 'We\'re full at the moment.']),
    })[v],
};

const HEDGE_PREFIX = [
  'I think ', 'Pretty sure ', 'As far as I know ', 'It should be — ', 'Last I heard ',
];
const HEDGE_SUFFIX = [
  " but you'd want to double-check with the day manager.",
  " though don't quote me on that.",
  ' I think.',
  " but that changed recently so I'm not certain.",
];

const AMBIGUOUS = {
  open_now: ['We\'re around today, sort of — depends what you need.', 'Somebody\'s here, I couldn\'t tell you about the cooling side.'],
  hours: ['We\'re open regular hours today.', 'Later than usual today because of the heat.', 'Depends on staffing, it varies.'],
  pet_policy: ['Depends on the animal, really.', 'That\'s kind of case by case.'],
  accessibility: ['There\'s a couple ways in, depends which door you use.', 'The building\'s old, so, you know.'],
  intake_requirements: ['We usually just sign people in.', 'It depends who\'s working intake.'],
  capacity_status: ['It comes and goes all day.', 'Busy, but I couldn\'t give you a number.'],
};

const UNKNOWN = [
  "I honestly don't know, I'd have to ask the site manager.",
  "That's not something I'd have in front of me, sorry.",
  "You'd have to call back and speak with the coordinator on that one.",
  "No idea, I just cover the desk on Tuesdays.",
];

/** Wrong-but-confident answers: the residual error the grounding rule cannot fix. */
function misinform(field, truthValue, s) {
  const alt = {
    open_now: [!truthValue],
    hours: ['08:00-17:00', '09:00-18:00', '07:00-19:00'].filter((h) => h !== truthValue),
    pet_policy: ['pets_allowed', 'service_animals_only', 'crated_pets_only', 'no_pets'].filter((v) => v !== truthValue),
    accessibility: ['fully_accessible', 'ramp_only', 'not_accessible'].filter((v) => v !== truthValue),
    intake_requirements: ['no_id_required', 'id_requested_not_required', 'photo_id_required', 'referral_required'].filter((v) => v !== truthValue),
    capacity_status: ['space_available', 'near_capacity', 'at_capacity'].filter((v) => v !== truthValue),
  }[field];
  return alt[Math.floor(s.next() * alt.length)];
}

/* ------------------------------------------------------------ outcomes --- */

/**
 * Decide the call outcome for a given attempt. Deterministic in
 * (seed, facilityId, attempt).
 */
export function decideOutcome(gt, attempt, seed) {
  const s = streamFor(seed, gt.id, 'outcome', attempt);
  if (gt.line_type === 'none') return 'no_number';
  if (gt.line_type === 'disconnected') return 'disconnected';

  // Later attempts are more likely to connect (different time of day) -- but a
  // facility that is structurally unreachable today stays unreachable, which is
  // why the retry policy has a cap instead of a loop.
  const reach = gt.reachability ?? 'normal';
  if (reach === 'unreachable_today') {
    return s.next() < 0.45 ? 'voicemail' : 'no_answer';
  }
  const bump = attempt * (reach === 'hard' ? 0.05 : 0.14);
  // A 'hard' facility compresses the draw toward the failure thresholds.
  const r = s.next() * (reach === 'hard' ? 0.7 : 1);
  if (gt.line_type === 'ivr') {
    if (r < 0.2 - bump * 0.4) return 'ivr_dead_end';
    if (r < 0.34 - bump * 0.4) return 'voicemail';
    if (r < 0.44 - bump * 0.5) return 'no_answer';
    return 'connected_via_ivr';
  }
  if (gt.line_type === 'mobile') {
    if (r < 0.24 - bump) return 'no_answer';
    if (r < 0.4 - bump) return 'voicemail';
    return 'connected';
  }
  if (r < 0.14 - bump) return 'no_answer';
  if (r < 0.26 - bump) return 'voicemail';
  if (r < 0.29 - bump) return 'busy';
  return 'connected';
}

/* ---------------------------------------------------------- transcript --- */

function T(speaker, text) {
  return { speaker, text };
}

/**
 * Build the full turn list for one attempt.
 * `questions` is the ordered list of field names the plan approved for this call.
 */
export function buildTranscript(gt, facility, questions, attempt, seed, outcome) {
  const s = streamFor(seed, gt.id, 'dialogue', attempt);
  const turns = [];
  const phone = facility.phone ?? 'no number on file';
  turns.push(T('system', `[SIMULATED] Dialing ${phone} — attempt ${attempt + 1}. No real call is placed.`));

  if (outcome === 'no_number') {
    turns.push(T('system', 'No phone number published for this facility. Call cannot be attempted.'));
    return turns;
  }
  if (outcome === 'disconnected') {
    turns.push(T('system', 'Special information tone. "The number you have dialed is not in service. Please check the number and dial again."'));
    return turns;
  }
  if (outcome === 'busy') {
    turns.push(T('system', 'Busy signal. Line engaged.'));
    return turns;
  }
  if (outcome === 'no_answer') {
    turns.push(T('system', `Ringing… no answer after ${s.int(6, 9)} rings. Disconnected by caller.`));
    return turns;
  }
  if (outcome === 'ivr_dead_end') {
    turns.push(T('system', 'Automated menu answered.'));
    turns.push(T('staff', 'Thank you for calling. For hours and locations press 1. For program eligibility press 2. To speak with staff press 0.'));
    turns.push(T('agent', '[DTMF 0]'));
    turns.push(T('staff', 'All representatives are assisting other callers. Please try your call again later.'));
    turns.push(T('system', 'Menu returned to top level twice. No path to a human. Call ended.'));
    return turns;
  }
  if (outcome === 'voicemail') {
    // A voicemail greeting sometimes states hours or an activation status. That is
    // real, citable evidence — at lower confidence, because a greeting can be old.
    const greetingHasHours = s.chance(0.45);
    const greetingHasClosure = s.chance(0.18);
    let msg = `You've reached ${facility.name}. `;
    if (greetingHasClosure) {
      msg += 'We are currently closed for the season. Please call the county line for the nearest open site. ';
    } else if (greetingHasHours) {
      msg += hoursPhrase(gt.truth.hours, s).replace(/^We're /, 'We are ') + ' ';
    }
    msg += 'Please leave a message after the tone.';
    turns.push(T('system', 'Call answered by voicemail.'));
    turns.push(T('staff', msg));
    turns.push(T('agent', 'This is an automated listing-verification call from the county heat relief directory. No message left. Thank you.'));
    return turns;
  }

  /* ---- a human is on the line ---- */
  const persona = PERSONA[gt.persona] ?? PERSONA.front_desk_unsure;

  if (outcome === 'connected_via_ivr') {
    turns.push(T('system', 'Automated menu answered.'));
    turns.push(T('staff', 'Thank you for calling. For hours press 1, for staff press 0.'));
    turns.push(T('agent', '[DTMF 0]'));
    turns.push(T('system', `Held ${s.int(40, 190)} seconds. Transferred to staff.`));
  }

  turns.push(T('staff', persona.greeting));
  turns.push(T('agent', DISCLOSURE));
  turns.push(
    T(
      'staff',
      s.pick(['Sure, go ahead.', 'Okay, quickly — it\'s busy in here.', 'Uh, okay. Yeah.', 'That\'s fine.']),
    ),
  );

  if (gt.persona === 'bilingual_handoff') {
    turns.push(T('system', `Hold ${s.int(20, 70)} seconds — phone handed to another staff member.`));
    turns.push(T('staff', 'Hi, sorry, I\'m the one who handles the cooling program. What did you need?'));
  }

  let hangUp = false;
  const asked = [];
  for (let qi = 0; qi < questions.length; qi++) {
    const field = questions[qi];
    if (hangUp) break;

    turns.push(T('agent', QUESTION_TEXT[field]));
    asked.push(field);

    const knows = gt.knows[field];
    const r = s.next();
    // fatigue: the further into the script, the more likely a shrug
    const fatigue = qi * 0.038;

    if (!knows || r < 0.1 + fatigue) {
      turns.push(T('staff', s.pick(UNKNOWN)));
    } else if (r < 0.1 + fatigue + persona.ambiguous) {
      turns.push(T('staff', s.pick(AMBIGUOUS[field])));
    } else if (r < 0.1 + fatigue + persona.ambiguous + persona.misinformed) {
      const wrong = misinform(field, gt.truth[field], s);
      turns.push(T('staff', DIRECT[field](wrong, s)));
    } else if (r < 0.1 + fatigue + persona.ambiguous + persona.misinformed + persona.hedge) {
      // Drop the statement's own full stop before appending the hedge, so the
      // line reads as one spoken sentence ("...only here but you'd want to
      // double-check") rather than two glued together ("...only here. but").
      const stem = DIRECT[field](gt.truth[field], s).replace(/\.\s*$/, '');
      turns.push(T('staff', s.pick(HEDGE_PREFIX) + stem.charAt(0).toLowerCase() + stem.slice(1) + s.pick(HEDGE_SUFFIX)));
    } else {
      turns.push(T('staff', DIRECT[field](gt.truth[field], s)));
    }

    // occasional early hang-up on long scripts
    if (qi >= 3 && s.chance(0.12)) {
      turns.push(T('staff', s.pick(['I\'ve got a line of people, I have to go.', 'Sorry, I need to go.'])));
      turns.push(T('system', 'Caller hung up. Remaining questions not asked.'));
      hangUp = true;
    }
  }

  if (!hangUp) {
    turns.push(T('agent', 'That\'s everything. Thank you for your time.'));
    turns.push(T('staff', s.pick(['No problem.', 'Alright, bye.', 'Sure thing.'])));
  }
  turns.push(T('system', `Call ended. ${asked.length} of ${questions.length} planned questions asked.`));
  return turns;
}

/** Join turns into one addressable string and attach absolute offsets. */
export function materialize(turns) {
  let cursor = 0;
  const out = [];
  const parts = [];
  turns.forEach((t, i) => {
    const prefix = t.speaker === 'agent' ? 'AGENT: ' : t.speaker === 'staff' ? 'STAFF: ' : 'SYSTEM: ';
    const line = prefix + t.text;
    out.push({
      index: i,
      speaker: t.speaker,
      text: t.text,
      prefix,
      lineStart: cursor,
      textStart: cursor + prefix.length,
      textEnd: cursor + line.length,
    });
    parts.push(line);
    cursor += line.length + 1; // +1 for the newline
  });
  return { turns: out, text: parts.join('\n') };
}

export { QUESTION_TEXT };
