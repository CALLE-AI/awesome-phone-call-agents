import type { ChainState } from '@/core/chain';
import type { Turn } from '@/core/types';

/**
 * What the browser is allowed to know about an errand.
 *
 * Deliberately not `ErrandFile`. Handing the real thing to a client component
 * would serialise `person.phone` into the RSC payload and put the number in
 * page source — masked on screen and fully readable in view-source. The number
 * never crosses this boundary; only its masked form does.
 */
export interface ClientErrand {
  errand_id: string;
  person: { name: string; phone_masked: string };
  callee: { name: string };
  reason: string;
  may_say: string[];
  acceptable_windows: { start: string; end: string }[];
}

export interface Scenario {
  id: string;
  label: string;
  blurb: string;
  legs: string[];
}

/**
 * The scenarios are named for what the *callee* does, not for what the app
 * returns. The app's behaviour is the thing under test; the world is the input.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'happy',
    label: 'They offer to call back',
    blurb:
      'The ordinary case. The receptionist offers to ring back, the agent declines and takes a window instead, and leg two closes the errand.',
    legs: ['window-agreed', 'errand-complete'],
  },
  {
    id: 'demanded',
    label: 'They insist on a number',
    blurb:
      'The receptionist will not proceed without a number to call. The agent has none to give, so the errand stalls rather than leaks.',
    legs: ['number-demanded'],
  },
  {
    id: 'leaked',
    label: 'A number gets out',
    blurb:
      'The failure this app exists to prevent, staged deliberately. It outranks a successful booking and stops the chain.',
    legs: ['number-leaked'],
  },
  {
    id: 'refused',
    label: 'They cannot name a time',
    blurb: 'No window can be agreed. Nothing is invented; a person picks it up.',
    legs: ['schedule-refused'],
  },
  {
    id: 'vague',
    label: 'They are vague',
    blurb:
      '"Sure, that\'s fine" confirms nothing. A window needs a callee turn that names a time.',
    legs: ['window-unconfirmed'],
  },
  {
    id: 'noanswer',
    label: 'Nobody answers',
    blurb: 'A disposition, not a finding. No verdict is drawn.',
    legs: ['no-answer'],
  },
];

export interface LegTranscript {
  leg: number;
  turns: Turn[];
}

export interface RunResult {
  state: ChainState;
  transcripts: LegTranscript[];
  scenario: Scenario;
  placedRealCalls: boolean;
}
