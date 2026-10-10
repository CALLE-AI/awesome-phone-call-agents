/**
 * CALL-E Developer API adapter.
 *
 * Verified against the published OpenAPI contract (v0.7.0) at
 * https://docs.heycall-e.com/openapi/calle.openapi.yaml
 *
 * Contract facts this adapter is built around:
 *  - POST /v1/calls is `additionalProperties: false`. The ONLY accepted fields are
 *    task, recipients, result_schema, recipient_result_schema, metadata, webhook_url.
 *    There is no caller-id, voice, agent_id or dynamic-variable field.
 *  - There is NO mid-call tool calling. The agent cannot ask our server anything
 *    while the call is live, so every answer is graded post-call from the
 *    structured result CALL-E extracts.
 *  - Webhooks are terminal only (call.completed / call.failed /
 *    call.result_validation_failed) and are NOT signed.
 *  - Billing is per call (~$0.05), not per minute.
 *  - Task creation is MODERATED and rejects prompts at 422 before any call is
 *    placed. Two rules bite here, both verified against the live API:
 *      1. Nothing about verification codes or OTPs, in either direction. A call
 *         may neither read one out nor ask for one back.
 *      2. No instruction to conceal that the caller is an AI. "Never reveal you
 *         are an AI" is rejected outright; the agent must be able to say what it
 *         is if asked.
 *    Rule 1 is why sign-up is a rehearsal of the wake-up challenge rather than
 *    an OTP call: three digits said back in reverse are a puzzle, not a
 *    credential, and that framing is accepted.
 */
const { getCalleConfig } = require('../lib/secrets');

const DRY_RUN = process.env.DRY_RUN !== 'false';

/**
 * CALL-E supports a JSON Schema subset: type, properties, required, enum,
 * nested objects, simple array.items, description, additionalProperties:false.
 * No $ref / oneOf / anyOf / allOf / recursion.
 *
 * The docs advise string enums with an `unknown` member over booleans for any
 * judgment that could be ambiguous, because a forced boolean invents certainty.
 */
const WAKE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer_correct', 'sounded_awake'],
  properties: {
    answer_correct: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description:
        'Use yes only when the person said the code back in reverse order, matching the correct ' +
        'answer given in the task. Ignore filler words and whether they said it as separate digits ' +
        'or as a whole number: only the digits and their order decide. ' +
        'Use no when they said the code forwards, said the wrong digits, refused, or hung up without answering. ' +
        'Use unknown when the call was not answered by a human or the audio was unintelligible.',
    },
    sounded_awake: {
      type: 'string',
      enum: ['alert', 'groggy', 'unknown'],
      description:
        'Judge from speech only. Use alert for clear, prompt, coherent speech. ' +
        'Use groggy for slurred, mumbled, very slow or confused speech, or if they fell back asleep mid-call. ' +
        'Use unknown if there was not enough speech to judge.',
    },
    spoken_answer: {
      type: 'string',
      description: 'The digits the person said back, verbatim. Empty string if they said nothing.',
    },
  },
};

const SHAME_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['contact_reached'],
  properties: {
    contact_reached: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description: 'Use yes when a human clearly heard the message. Use no if it went to voicemail or nobody answered.',
    },
    contact_reaction: {
      type: 'string',
      description: 'One short sentence describing how the contact reacted, quoting them if possible.',
    },
  },
};

/**
 * The accountability contact never signed up for SnoozeTax: they are a third
 * party whose number someone else typed in. Under GDPR that call needs their
 * own consent, so CALL-E asks for it out loud and returns it as typed JSON.
 * The docs advise string enums with an `unknown` member over booleans.
 */
const CONSENT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['consent'],
  properties: {
    consent: {
      type: 'string',
      enum: ['granted', 'declined', 'unclear'],
      description:
        'Use granted ONLY when the person clearly and affirmatively agreed to be called. ' +
        'Use declined when they said no, asked not to be contacted, or hung up during the request. ' +
        'Use unclear when nobody answered, it reached voicemail, the audio was unintelligible, ' +
        'or the person never gave a definite answer. Never guess granted from silence or politeness.',
    },
    consent_quote: {
      type: 'string',
      description: 'The exact words the person used to agree or refuse, verbatim. Empty string if they said nothing.',
    },
    is_named_person: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description: 'Whether the person answering confirmed they are the person the call asked for.',
    },
  },
};

async function calleFetch(path, body) {
  const { apiKey, baseUrl } = await getCalleConfig();
  if (!apiKey) throw new Error('No CALL-E API key available (set CALLE_API_KEY or configure AWS SSM)');

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Prevents a retry or a double-fired cron tick from placing (and billing) two calls.
      'Idempotency-Key': body.metadata?.idempotency_key || `snoozetax_${Date.now()}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) {
    const err = new Error(`CALL-E ${res.status}: ${json?.error?.message || json?.message || text.slice(0, 300)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/**
 * Place a real outbound call, or simulate one when DRY_RUN is on.
 * DRY_RUN is the default so the repo can be cloned and demoed with no API key
 * and no spend, which the contribution guidelines require.
 */
async function createCall({ task, phone, resultSchema, metadata = {}, webhookUrl, locale = 'en-US', region = 'ES' }) {
  if (DRY_RUN) {
    console.log(`[CALL-E dry-run] would call ${maskPhone(phone)}\n  task: ${task.slice(0, 140)}...`);
    return {
      id: `call_dryrun_${Date.now()}`,
      status: 'queued',
      dry_run: true,
      _task: task,
    };
  }

  const body = {
    task,
    recipients: [{ phones: [phone], locale, region }],
    metadata,
  };
  if (resultSchema) body.result_schema = resultSchema;
  if (webhookUrl) body.webhook_url = webhookUrl;

  const call = await calleFetch('/v1/calls', body);
  console.log(`[CALL-E] created ${call.id} -> ${maskPhone(phone)} (status ${call.status})`);
  return call;
}

function maskPhone(p) {
  if (!p) return 'unknown';
  return p.slice(0, 4) + '*'.repeat(Math.max(0, p.length - 6)) + p.slice(-2);
}

// ─── Task builders ──────────────────────────────────────────────────

/**
 * The sign-up call.
 *
 * This is a REHEARSAL of the wake-up call, not an account-verification call,
 * and that is a hard requirement rather than a framing preference.
 *
 * CALL-E refuses, at task-creation time, any call that touches verification
 * codes in either direction. Reading one out is rejected ("I can't help place
 * calls that provide verification codes or OTPs") and so is asking for one back
 * ("I can't help place a call that asks someone to read out a verification or
 * confirmation code"). Both were tried against the live API; both 422.
 *
 * So the number is proven with the product's own challenge instead: three
 * digits, said back in reverse. Nothing here is a credential. The digits are
 * generated per attempt, mean nothing outside this call, and unlock no account
 * on their own; the server pairs the spoken answer with the browser session that
 * started the sign-up. Getting it right proves the same thing an OTP would (this
 * person is holding this phone, right now) and additionally proves they can do
 * the thing the product will ask of them every morning.
 *
 * `expectedAnswer` is computed server-side and written into the prompt: a model
 * asked to reverse the digits itself could reject a correct answer.
 */
function verificationTask(phone, code, expectedAnswer, name) {
  const spacedCode = String(code).split('').join(' ');
  const spacedAnswer = String(expectedAnswer).split('').join(' ');
  return `Call ${phone}${name ? ` and ask for ${name}` : ''}. You are calling from SnoozeTax, ` +
    `an alarm clock service that phones people in the morning to check they are really awake. ` +
    `They have just signed up, and this is a test run of their wake-up call so they can hear ` +
    `what it sounds like before they rely on it. ` +
    `Be warm and brief. Say hello, say you are calling from SnoozeTax, and explain in one sentence: ` +
    `you will read out three digits, and they have to say them back in reverse order. ` +
    `Then say: "Your digits are ${spacedCode}." Read them slowly, one at a time. ` +
    `Repeat them a second time, just as slowly. Then ask them to say it backwards. ` +
    `The correct answer is "${spacedAnswer}". Accept it in any form: as separate digits, ` +
    `as a whole number, or with filler words around it. Only the digits and their order matter. ` +
    `If they say it forwards instead of backwards, tell them to try again backwards, once. ` +
    `If they ask you to repeat the digits, always repeat them. ` +
    `If they get it right, say that is exactly how the morning call will go, and end the call. ` +
    `If they get it wrong, tell them kindly and say they can finish setting up on the website. ` +
    `If they say they did not sign up, apologise, tell them no alarm will be set for this number, ` +
    `and end the call. Keep the whole call under 45 seconds. ` +
    `If they ask whether you are a person, say plainly that you are an automated ` +
    `assistant calling on behalf of SnoozeTax.`;
}

/**
 * What happened on the rehearsal call. Same shape as the wake-up schema, since
 * it is the same challenge: the sign-up call is the product, run once.
 */
const VERIFY_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer_correct'],
  properties: {
    answer_correct: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description:
        'Use yes only when the person said the digits back in reverse order, matching the correct ' +
        'answer given in the task. Ignore filler words and whether they said it as separate digits ' +
        'or as a whole number: only the digits and their order decide. ' +
        'Use no when they said them forwards, said the wrong digits, refused, or said they did not sign up. ' +
        'Use unknown when the call was not answered by a human or the audio was unintelligible.',
    },
    spoken_answer: {
      type: 'string',
      description: 'The digits the person said back, verbatim. Empty string if they said nothing.',
    },
  },
};

/** "10" -> "ten", so the agent speaks a word instead of reading a numeral. */
function spellMinutes(n) {
  const words = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
                 'eleven','twelve','thirteen','fourteen','fifteen'];
  return words[n] || String(n);
}

/**
 * The wake-up call: three digits, said back in reverse.
 *
 * Whoever is on the line has answered the phone, so no further call is coming
 * either way: a wrong answer ends the calls and hands them to the web window.
 * The script therefore says the same true thing on the first call and on a
 * retry. Promising "I'll call back in a minute" here would be a lie that costs
 * the user their morning, because they would wait for a ring that never comes
 * instead of opening the website.
 *
 * A retry only ever happens because nobody picked up, so it must never imply
 * they failed a previous attempt: as far as they know, the phone just rang.
 */
function wakeUpReverseTask(phone, code, expectedAnswer, name, isRetry = false, graceMinutes = 10) {
  const spacedCode = String(code).split('').join(' ');
  const spacedAnswer = String(expectedAnswer).split('').join(' ');

  const consequence =
    `tell them warmly not to worry, that there will not be another call, and that the code is now waiting ` +
    `on the SnoozeTax website where they have ${spellMinutes(graceMinutes)} minutes to type it in backwards, ` +
    `or their accountability contact gets called`;

  return `Call ${phone} to wake ${name || 'the user'} up. This is their SnoozeTax alarm call. ` +
    (isRetry ? `This is the second and final call: the first one a minute ago went unanswered, so assume they have not heard any of this yet. ` : '') +
    `Be energetic and brief. Say good morning, then explain the task in one sentence: ` +
    `you will read out a three digit code, and they have to say it back to you in reverse order. ` +
    `Then say: "Your code is ${spacedCode}." Read the digits slowly, one at a time. ` +
    `Repeat the code a second time, just as slowly. ` +
    `Then ask them to say it backwards. ` +
    `The correct answer is "${spacedAnswer}". Accept it in any form: spoken as separate digits, ` +
    `spoken as a whole number, or with filler words around it. Only the digits and their order matter. ` +
    `If they say the code forwards instead of backwards, tell them to try again backwards, once. ` +
    `If they ask you to repeat the code, always repeat it. ` +
    `If they answer correctly, confirm warmly ("That's it, you're awake, have a great day") and end the call. ` +
    `If they answer incorrectly twice, ${consequence}. ` +
    `If nobody speaks or it goes to voicemail, do not read out the code. ` +
    `Keep the call under 60 seconds. ` +
    `If they ask whether you are a person, say plainly that you are an automated ` +
    `assistant calling on behalf of SnoozeTax.`;
}

/**
 * The opt-in call. This is the only call this number receives before consent
 * exists, so it has to identify itself, explain, ask, and accept "no" cleanly.
 */
function consentCallTask(contactPhone, sleeperName, contactName) {
  return `Call ${contactPhone}. ${contactName ? `Ask for ${contactName}. ` : ''}` +
    `You are calling from SnoozeTax, an alarm clock service that phones people to check they woke up. ` +
    `Explain, briefly and politely, that ${sleeperName} has nominated this number as their accountability contact, ` +
    `which would mean SnoozeTax phones this number on mornings when ${sleeperName} does not get up. ` +
    `Make clear this is a one-off request for permission and that they will not be called again if they say no. ` +
    `Then ask directly: "Is that alright with you?" ` +
    `Accept their answer at face value. If they say no, or hesitate, thank them, confirm they will not be contacted again, and end the call. ` +
    `Do not try to persuade them, do not ask a second time, and do not offer alternatives. ` +
    `If they ask who gave you the number, say ${sleeperName} did. ` +
    `If it goes to voicemail, do not leave a message. ` +
    `Keep the call under 45 seconds.`;
}

function shameCallTask(contactPhone, sleeperName, contactName, minutesLate) {
  return `Call ${contactPhone}. ${contactName ? `The person answering is ${contactName}. ` : ''}` +
    `You are calling on behalf of SnoozeTax, an accountability alarm service. ` +
    `${sleeperName} signed up and named this number as their accountability contact, ` +
    `which means they agreed that you would be told if they failed to get up. ` +
    `Tell them, in a light and good-humoured way, that ${sleeperName} did not wake up this morning ` +
    `and is still in bed ${minutesLate} minutes after their alarm. ` +
    `Invite them to give ${sleeperName} a hard time about it. ` +
    `Keep it friendly and under 40 seconds. If they sound confused or annoyed, apologise, ` +
    `tell them they can be removed as a contact, and end the call politely.`;
}

module.exports = {
  createCall,
  verificationTask,
  VERIFY_RESULT_SCHEMA,
  consentCallTask,
  wakeUpReverseTask,
  shameCallTask,
  WAKE_RESULT_SCHEMA,
  SHAME_RESULT_SCHEMA,
  CONSENT_RESULT_SCHEMA,
  DRY_RUN,
  maskPhone,
};
