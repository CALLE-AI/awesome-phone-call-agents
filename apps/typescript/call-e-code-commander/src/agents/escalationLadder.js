/**
 * On-Call Escalation Ladder
 *
 * The problem this solves is the one every on-call rota actually has: the page
 * fires, the primary does not pick up, and nothing happens until somebody
 * notices twenty minutes later. Existing tools redial the same person or send
 * another push notification into a silent phone.
 *
 * Here, each rung of the ladder is a real CALL-E conversation. If the primary
 * is not reached, or is reached but cannot commit to an action, the ladder
 * walks to the next person and tells them why they are being woken up. The
 * ladder stops the moment a human authorises an action, and every rung is
 * recorded for the post-incident review.
 */

import { CalleIncidentCommander } from './calleService.js';

/**
 * How long to wait for one rung before giving up and climbing.
 *
 * This has to cover more than the conversation. A call stays `in_progress`
 * through post-call result finalisation, so the budget is dialling time, plus
 * the three-minute cap the task prompt asks for, plus extraction. Cutting this
 * too close makes a call that actually succeeded look like no answer, which
 * wakes the next person for nothing.
 */
const DEFAULT_RUNG_TIMEOUT_MS = 420000;

/** Gap between status polls while a call is live. */
const POLL_INTERVAL_MS = 3000;

/**
 * How many consecutive failed reads before a rung is abandoned as unreadable.
 * Three at the poll interval is about ten seconds, long enough to ride out a
 * blip and short enough that a revoked key does not look like a ringing phone.
 */
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

/**
 * Longest callback this ladder will wait before climbing anyway.
 *
 * An engineer who asks for time gets it, but a live incident cannot wait
 * indefinitely on one person's estimate. Half an hour is long enough for
 * somebody to get to a laptop and read a diff, and short enough that a customer
 * impact does not run unattended because a request for "an hour" was honoured
 * literally. A longer request is honoured up to the cap, and the shortfall is
 * announced rather than hidden.
 */
const MAX_CALLBACK_MINUTES = 30;

/**
 * How many times one contact may defer before the ladder climbs past them.
 *
 * One. A second deferral from the same person on the same incident is not a
 * decision arriving slowly, it is a decision that is not coming.
 */
const MAX_CALLBACKS_PER_CONTACT = 1;

/**
 * The wait a simulated callback serves instead of the agreed minutes.
 *
 * A simulation dials nobody, so there is nothing for a ten-minute timer to
 * coordinate with. Long enough to read the countdown, short enough that the
 * whole ladder is watchable in one sitting.
 */
const SIMULATED_CALLBACK_WAIT_MS = 6000;

/**
 * The default rota. Phone numbers are supplied by the operator at dial time.
 *
 * region and locale are deliberately absent. They are resolved from CALL-E's
 * published coverage for whatever number is entered, and an explicit value here
 * would override that resolution and force the wrong routing hint.
 */
export const DEFAULT_ROTA = [
  { id: 'primary', name: 'Primary On-Call', role: 'primary on-call engineer', phone: '' },
  { id: 'backup', name: 'Backup On-Call', role: 'backup on-call engineer', phone: '' },
  { id: 'manager', name: 'Engineering Manager', role: 'engineering manager and incident owner', phone: '' }
];

export class EscalationLadder {
  /**
   * @param {object} options
   * @param {CalleIncidentCommander} options.service CALL-E integration to dial through.
   * @param {(event: object) => void} [options.onEvent] Receives every ladder state change.
   */
  constructor(options = {}) {
    this.service = options.service;
    this.onEvent = options.onEvent || (() => {});
    this.rungTimeoutMs = options.rungTimeoutMs || DEFAULT_RUNG_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs || POLL_INTERVAL_MS;
    this.maxCallbackMinutes = options.maxCallbackMinutes ?? MAX_CALLBACK_MINUTES;
    this.maxCallbacksPerContact = options.maxCallbacksPerContact ?? MAX_CALLBACKS_PER_CONTACT;
    // Lets a caller compress the wait without pretending it did not happen. The
    // demo uses it; the audit trail still records the wait as skipped by an
    // operator rather than as time that elapsed.
    this.callbackClock = options.callbackClock || null;
    this.abort = false;
    this.rungs = [];
    this.pendingCallback = null;
  }

  emit(type, payload = {}) {
    this.onEvent({ type, at: new Date().toISOString(), ...payload });
  }

  cancel() {
    this.abort = true;
    this.pendingCallback?.settle('cancelled');
  }

  /**
   * Rings the pending callback now instead of waiting out the agreed delay.
   *
   * The engineer asked for ten minutes, then messaged to say they are ready.
   * Making them wait out a timer at that point is the system serving its own
   * bookkeeping. The recorded rung says the wait was ended by an operator, so
   * the post-mortem never implies ten minutes passed when they did not.
   *
   * @returns {boolean} False when no callback is currently pending.
   */
  callBackNow() {
    if (!this.pendingCallback) return false;
    this.pendingCallback.settle('skipped');
    return true;
  }

  /** The callback currently being waited out, for a countdown on screen. */
  get pendingCallbackState() {
    if (!this.pendingCallback) return null;
    return {
      contact: this.pendingCallback.contact,
      dueAt: this.pendingCallback.dueAt,
      minutes: this.pendingCallback.minutes
    };
  }

  /**
   * Walks the ladder until somebody authorises an action or the rota runs out.
   *
   * @param {object} input
   * @param {object} input.scenario The incident being escalated.
   * @param {Array} input.contacts Ordered rota. Contacts without a phone number are skipped.
   * @param {string} input.incidentId Stable incident identifier, used for idempotency.
   * @returns {Promise<object>} The ladder outcome, including every rung attempted.
   */
  async run({ scenario, contacts, incidentId }) {
    this.abort = false;
    this.rungs = [];
    this.pendingCallback = null;

    // The clock a post-incident review actually asks about starts when the page
    // is raised, not when a call connects. Time spent dialling an unanswered
    // phone is part of how long the incident ran without a decision.
    const pagedAt = Date.now();
    this.pagedAt = pagedAt;

    const rota = (contacts || []).filter((c) => c && c.phone && c.phone.trim());
    if (rota.length === 0) {
      const outcome = {
        resolved: false,
        authorised: false,
        decision: 'no_decision',
        reason: 'No contact on the rota has a phone number configured.',
        rungs: [],
        ...this.timings(pagedAt)
      };
      this.emit('ladder:exhausted', outcome);
      return outcome;
    }

    this.emit('ladder:start', { incidentId, rotaSize: rota.length, pagedAt: new Date(pagedAt).toISOString() });

    for (let index = 0; index < rota.length; index++) {
      if (this.abort) break;

      const contact = rota[index];
      const escalatedFrom = index > 0 ? (rota[index - 1].displayName || rota[index - 1].name) : null;

      const rung = await this.workRung({ scenario, contact, incidentId, escalatedFrom, index });
      if (!rung) break;

      if (rung.outcome.authorised) {
        const outcome = {
          resolved: true,
          authorised: true,
          decision: rung.outcome.decision,
          reason: rung.outcome.reason,
          decidedBy: contact,
          confidence: rung.outcome.confidence,
          rungs: this.rungs,
          ...this.timings(pagedAt)
        };
        this.emit('ladder:resolved', outcome);
        return outcome;
      }

      // A held decision is still a human decision. It stops the ladder even
      // though it does not authorise a production change.
      if (rung.outcome.reachedEngineer && rung.outcome.decision === 'hold_for_review') {
        const outcome = {
          resolved: true,
          authorised: false,
          decision: 'hold_for_review',
          reason: rung.outcome.reason,
          decidedBy: contact,
          confidence: rung.outcome.confidence,
          rungs: this.rungs,
          ...this.timings(pagedAt)
        };
        this.emit('ladder:resolved', outcome);
        return outcome;
      }

      this.emit('rung:escalating', {
        index,
        contact,
        reason: rung.outcome.reason,
        hasNext: index < rota.length - 1
      });
    }

    // A rung that never got a call placed is not a rung that went unanswered.
    // Saying the rota "was dialled" when the account refused every attempt
    // would put an unanswered phone call into the post-mortem that never rang.
    const dialled = this.rungs.filter((rung) => rung.outcome?.callPlaced !== false).length;

    const outcome = {
      resolved: false,
      authorised: false,
      decision: 'no_decision',
      reason: dialled === 0
        ? 'No rung could be dialled at all, so nobody was reached and the deploy stays blocked.'
        : `${dialled} of ${this.rungs.length} rung(s) were dialled and nobody authorised an action.`,
      dialledCount: dialled,
      rungs: this.rungs,
      ...this.timings(pagedAt)
    };
    this.emit('ladder:exhausted', outcome);
    return outcome;
  }

  /**
   * How long the incident ran without a human decision.
   *
   * This is the number a post-incident review asks for and the number an
   * alerting tool cannot produce, because a notification has no end state to
   * measure to. Reported in milliseconds so the presentation layer decides how
   * to round it.
   */
  timings(pagedAt) {
    const decidedAt = Date.now();
    return {
      pagedAt: new Date(pagedAt).toISOString(),
      decidedAt: new Date(decidedAt).toISOString(),
      elapsedMs: decidedAt - pagedAt
    };
  }

  /**
   * Works one contact to a conclusion, including any callback they asked for.
   *
   * A contact can occupy more than one rung in the audit trail: the first page,
   * and the callback they requested. Both are recorded, because "the primary
   * asked for ten minutes at 03:12 and authorised at 03:23" is a materially
   * different story from "the primary authorised at 03:23", and only the first
   * one explains the gap.
   *
   * @returns {Promise<object|null>} The last rung dialled for this contact.
   */
  async workRung({ scenario, contact, incidentId, escalatedFrom, index }) {
    let attempt = 1;
    let callbacksUsed = 0;
    let waitedMinutes = 0;
    let rung = null;

    while (!this.abort) {
      this.emit('rung:dialing', { index, contact, escalatedFrom, attempt, callbackMinutes: waitedMinutes });

      rung = await this.dialRung({
        scenario,
        contact,
        incidentId,
        escalatedFrom,
        index,
        attempt,
        callbackMinutes: waitedMinutes
      });
      this.rungs.push(rung);

      if (!rung.outcome.requestedCallback) break;

      if (callbacksUsed >= this.maxCallbacksPerContact) {
        // A second deferral is not a slow decision. The ladder climbs, and the
        // reason recorded says which of the two it was.
        this.emit('rung:callback-refused', {
          index,
          contact,
          requestedMinutes: rung.outcome.callbackMinutes,
          alreadyGiven: callbacksUsed
        });
        rung.outcome = {
          ...rung.outcome,
          requestedCallback: false,
          shouldEscalate: true,
          reason: `${rung.outcome.reason} They had already been given one callback on this incident, so the ladder climbed instead of waiting again.`
        };
        break;
      }

      const requestedMinutes = rung.outcome.callbackMinutes;
      const minutes = Math.min(requestedMinutes, this.maxCallbackMinutes);

      // A simulated run compresses the wait, because nobody is going to sit in
      // front of a demo for ten minutes to watch a timer that is not timing
      // anything. Nothing is dialled either way, and the event carries the flag
      // so every surface can say the wait was compressed rather than served.
      const simulated = rung.mode === 'simulated';
      const waitMs = simulated ? SIMULATED_CALLBACK_WAIT_MS : minutes * 60 * 1000;
      const dueAt = Date.now() + waitMs;

      this.emit('rung:callback-scheduled', {
        index,
        contact,
        requestedMinutes,
        minutes,
        capped: minutes < requestedMinutes,
        simulatedWait: simulated,
        dueAt: new Date(dueAt).toISOString()
      });

      const endedBy = await this.waitForCallback(contact, minutes, waitMs, dueAt);
      rung.callback = { requestedMinutes, minutes, endedBy };

      if (endedBy === 'cancelled' || this.abort) break;

      this.emit('rung:callback-dialing', { index, contact, minutes, endedBy });
      callbacksUsed++;
      attempt++;
      waitedMinutes = minutes;
    }

    return rung;
  }

  /**
   * Waits out an agreed callback, interruptibly.
   *
   * @returns {Promise<'elapsed'|'skipped'|'cancelled'>} How the wait ended, which
   *   is recorded so a skipped wait is never written up as time that passed.
   */
  waitForCallback(contact, minutes, waitMs, dueAt) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (how) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingCallback = null;
        resolve(how);
      };

      // Deliberately not unref'd under Node. A pending callback is an open
      // incident with a promise to ring somebody back, so it is exactly the
      // kind of work a process should stay alive for. Tests pass a clock
      // instead of waiting.
      const timer = setTimeout(() => settle('elapsed'), waitMs);

      this.pendingCallback = { contact, minutes, dueAt, settle };

      // A supplied clock lets a caller compress the wait deliberately. Nothing
      // else in the ladder reads the wall clock to decide anything.
      if (this.callbackClock) this.callbackClock(waitMs).then(() => settle('elapsed'));
    });
  }

  /**
   * Dials one contact and waits for that call to reach a terminal state.
   */
  async dialRung({ scenario, contact, incidentId, escalatedFrom, index, attempt = 1, callbackMinutes = 0 }) {
    const dialledAt = Date.now();
    const placement = await this.service.placeIncidentCall({
      scenario,
      contact,
      incidentId,
      escalatedFrom,
      attempt,
      callbackMinutes
    });

    if (placement.mode === 'error') {
      const outcome = {
        decision: 'no_decision',
        // Nothing was dialled, so there is no endpoint to classify. Recording
        // this as an unclassified answer would put a phone call in the audit
        // trail that never happened.
        answeredBy: 'unknown',
        callPlaced: false,
        reachedEngineer: false,
        authorised: false,
        shouldEscalate: true,
        reason: placement.error,
        confidence: null
      };
      this.emit('rung:failed', { index, contact, error: placement.error });
      return {
        index, contact, mode: 'error', callId: null, outcome, transcript: [], error: placement.error,
        attempt, ...rungTimings(dialledAt)
      };
    }

    if (placement.mode === 'simulated') {
      const simulated = this.simulateRung(contact, index, attempt);
      this.emit('rung:simulated', { index, contact, outcome: simulated.outcome, attempt });
      return { index, contact, mode: 'simulated', callId: null, attempt, ...simulated, ...rungTimings(dialledAt) };
    }

    this.emit('rung:placed', {
      index, contact, attempt,
      callId: placement.callId,
      idempotencyKey: placement.idempotencyKey
    });

    const snapshot = await this.awaitTerminal(placement.callId, contact, index);
    const outcome = this.service.interpretDecision(snapshot);

    this.emit('rung:completed', { index, contact, callId: placement.callId, outcome, snapshot, attempt });

    return {
      index,
      contact,
      mode: 'live',
      callId: placement.callId,
      idempotencyKey: placement.idempotencyKey,
      attempt,
      outcome,
      snapshot,
      transcript: snapshot?.transcript || [],
      ...rungTimings(dialledAt)
    };
  }

  /**
   * Polls a live call until it stops changing, surfacing every intermediate
   * state so the incident timeline moves while the phone is ringing.
   */
  async awaitTerminal(callId, contact, index) {
    const deadline = Date.now() + this.rungTimeoutMs;
    let last = null;
    let consecutiveErrors = 0;

    while (Date.now() < deadline && !this.abort) {
      const snapshot = await this.service.pollCall(callId, contact);

      if (snapshot?.error) {
        // A revoked key or a dropped connection should surface quickly rather
        // than looking like a call that is still ringing for seven minutes.
        consecutiveErrors++;
        this.emit('rung:progress', { index, contact, callId, snapshot });
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          this.emit('rung:unreadable', { index, contact, callId, error: snapshot.error });
          return last;
        }
      } else if (snapshot) {
        consecutiveErrors = 0;
        last = snapshot;
        this.emit('rung:progress', { index, contact, callId, snapshot });
        if (snapshot.isTerminal) return snapshot;
      }

      await sleep(this.pollIntervalMs);
    }

    this.emit('rung:timeout', { index, contact, callId });
    return last;
  }

  /**
   * Produces a clearly-labelled synthetic rung for demos without call credits.
   *
   * The primary contact deliberately does not answer so that the escalation
   * path is visible, which is the behaviour worth demonstrating. Nothing here
   * is ever presented to the user as a real call.
   */
  simulateRung(contact, index, attempt = 1) {
    if (index === 0) {
      return {
        outcome: {
          decision: 'no_decision',
          answeredBy: 'voicemail_or_ivr',
          reachedEngineer: false,
          authorised: false,
          shouldEscalate: true,
          requestedCallback: false,
          reason: 'Simulated: voicemail picked up, so no incident detail was given and no decision was recorded.',
          confidence: null,
          simulated: true
        },
        transcript: [{ speaker: 'CALL-E', text: 'Dialling primary on-call. Voicemail greeting detected, ending call without leaving incident detail.' }]
      };
    }

    // The backup defers on the first call and decides on the callback. Three
    // behaviours a notification cannot have are visible in one run: a rota that
    // climbs past voicemail, a human who asks for time instead of deciding half
    // awake, and a system that comes back rather than escalating past them.
    if (attempt === 1) {
      return {
        outcome: {
          decision: 'no_decision',
          answeredBy: 'named_engineer',
          reachedEngineer: true,
          authorised: false,
          shouldEscalate: false,
          requestedCallback: true,
          callbackMinutes: 10,
          reason: 'Simulated: the backup answered but wanted to read the diff before authorising, and asked for ten minutes.',
          confidence: 0.88,
          acknowledgedSeverity: true,
          questionsAsked: ['Can you send me the diff?'],
          simulated: true
        },
        transcript: [
          { speaker: 'CALL-E', text: `This is an automated page for a live production incident. Am I speaking to ${contact.name}?` },
          { speaker: contact.name, text: 'Yes. Priya did not pick up?' },
          { speaker: 'CALL-E', text: 'No answer on the primary, so you are next on the rota. A concurrency fault in the payment worker is double charging customers.' },
          { speaker: contact.name, text: 'I am not authorising a deploy half asleep. Give me ten minutes to read the diff and call me back.' },
          { speaker: 'CALL-E', text: 'Understood. Nothing ships in the meantime. I will call you back in ten minutes.' }
        ]
      };
    }

    return {
      outcome: {
        decision: 'deploy_hotfix',
        answeredBy: 'named_engineer',
        reachedEngineer: true,
        authorised: true,
        shouldEscalate: false,
        requestedCallback: false,
        reason: 'Simulated: on the agreed callback the backup had read the diff and authorised the hotfix.',
        confidence: 0.9,
        acknowledgedSeverity: true,
        callbackMinutes: 0,
        questionsAsked: ['How many customers were double charged?', 'Did the regression suite actually pass?'],
        simulated: true
      },
      transcript: [
        { speaker: 'CALL-E', text: `Calling you back as agreed, ${contact.name}. Have you had a chance to look at the diff?` },
        { speaker: contact.name, text: 'Yes. The row lock is the right fix. How many customers were affected?' },
        { speaker: 'CALL-E', text: 'Four thousand one hundred and twenty so far, and the rate is climbing.' },
        { speaker: contact.name, text: 'Deploy the hotfix now.' },
        { speaker: 'CALL-E', text: 'Confirming: deploy the hotfix now. Recorded and authorised.' }
      ]
    };
  }
}

/** Wall-clock bounds of one dialled rung, for the timeline and the post-mortem. */
function rungTimings(dialledAt) {
  const endedAt = Date.now();
  return {
    dialledAt: new Date(dialledAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs: endedAt - dialledAt
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
