/**
 * The errand chain.
 *
 * An errand is a sequence of legs. A leg that ends in an agreed window produces
 * a *scheduled intent* for the next leg — a description of a call to be placed
 * later, not a timer.
 *
 * Recurrence and scheduling belong to the host scheduler, not to this app, so
 * Withheld proposes the next leg and stops. It runs no daemon and holds no
 * cron. That separation is deliberate: an app that both decides to call and
 * decides when to call is an app that can call someone at 3am because of a
 * parsing bug.
 */

import { buildScript } from './script';
import { runLeg } from './leg';
import type { CallProvider } from './calle';
import type { ErrandFile, LegResult, TimeWindow } from './types';

export interface ScheduledIntent {
  errand_id: string;
  leg: number;
  /** Placed no earlier than this. */
  not_before: string;
  /** Abandoned rather than placed late if this passes. */
  not_after: string;
  to: string;
  reason: string;
  /** The turn that justifies this intent existing at all. */
  supporting_turn: string | null;
}

export interface ChainState {
  errand_id: string;
  legs: LegResult[];
  /**
   * Every intent the chain produced, including ones already acted on. Kept
   * separately from `next` so a finished errand can still show which turn
   * caused which call — the audit trail the person gets in writing.
   */
  scheduled: ScheduledIntent[];
  /** The one intent still owing a call, if any. */
  next: ScheduledIntent | null;
  /** Set when the chain stops and a person has to look at it. */
  halted_reason: string | null;
}

function withinAcceptable(
  start: string,
  windows: TimeWindow[],
): boolean {
  const t = new Date(start).getTime();
  return windows.some((w) => {
    const from = new Date(w.start).getTime();
    const to = new Date(w.end).getTime();
    return Number.isFinite(from) && Number.isFinite(to) && t >= from && t <= to;
  });
}

export interface RunChainOptions {
  errand: ErrandFile;
  provider: CallProvider;
  now: Date;
  /** Hard ceiling. A chain that will not converge is a chain for a human. */
  maxLegs?: number;
}

export async function runChain(opts: RunChainOptions): Promise<ChainState> {
  const { errand, provider, now } = opts;
  const maxLegs = opts.maxLegs ?? 3;

  const state: ChainState = {
    errand_id: errand.errand_id,
    legs: [],
    scheduled: [],
    next: null,
    halted_reason: null,
  };

  const script = buildScript(errand);
  if (!script.safeToDial) {
    state.halted_reason =
      'The generated script did not pass the number gate. No call was placed.';
    return state;
  }

  for (let leg = 1; leg <= maxLegs; leg += 1) {
    // Whatever intent got us here has now been acted on. `next` means pending,
    // never "what happened", or a finished errand would read as one still owing
    // a call.
    state.next = null;

    const outcome = await provider.placeCall({
      to: errand.callee.phone,
      goal: script.goal,
      idempotencyKey: `${errand.errand_id}:leg-${leg}`,
    });

    const result = runLeg({
      errand,
      leg,
      status: outcome.status,
      turns: outcome.turns,
      providerClaims: outcome.providerClaims,
      transcriptRef: outcome.ref,
      now,
    });

    state.legs.push(result);

    if (result.next_action === 'errand_complete') {
      state.halted_reason = null;
      return state;
    }

    if (result.next_action === 'needs_human') {
      state.halted_reason = haltReason(result);
      return state;
    }

    // schedule_next_leg
    const { start, end, supporting_turn } = result.agreed_window;
    if (!start || !end) {
      state.halted_reason =
        'A window was reported without a start or end. Nothing was scheduled.';
      return state;
    }

    const intent: ScheduledIntent = {
      errand_id: errand.errand_id,
      leg: leg + 1,
      not_before: start,
      not_after: end,
      to: errand.callee.phone,
      reason: 'The callee named this window when declining to be called back.',
      supporting_turn,
    };

    if (!withinAcceptable(start, errand.acceptable_windows)) {
      state.scheduled.push(intent);
      state.next = intent;
      state.halted_reason =
        'The callee named a window outside the times the person said they would accept. A human decides whether to widen them.';
      return state;
    }

    state.scheduled.push(intent);
    state.next = intent;

    if (leg === maxLegs) {
      state.halted_reason =
        'The chain reached its leg ceiling without finishing. A human takes it from here.';
      return state;
    }
  }

  return state;
}

function haltReason(result: LegResult): string {
  switch (result.status) {
    case 'number_demanded':
      return 'The callee would not proceed without a number. The caller did not give one, so the errand stalled here rather than leaking it.';
    case 'callback_refused_by_callee':
      return 'The callee could not name any time to be called back.';
    case 'window_unconfirmed':
      return 'No callee turn named a time. Nothing was treated as agreed.';
    case 'no_answer':
      return 'Nobody answered. A no-answer is a disposition, not a finding.';
    case 'not_terminal':
      return 'CALL-E has not finished with this call. No verdict was drawn.';
    case 'outcome_unknown':
      return result.number_disclosed
        ? 'The number was disclosed on this call. This outranks every other outcome and the chain stops immediately.'
        : 'The call could not be read. This is not the same as nothing being said.';
    default:
      return 'The chain stopped and a person should look at it.';
  }
}
