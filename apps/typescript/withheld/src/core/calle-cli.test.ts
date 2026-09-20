import { describe, expect, it } from 'vitest';
import {
  CalleCliProvider,
  callTranscript,
  explainCliFailure,
  isTerminalCliStatus,
  mapCliStatus,
  parseCliTranscript,
  resolveCliBinary,
  structuredContent,
} from './calle-cli';
import { containsNumber } from './budget';
import { normalizeClaims } from './calle';

const PERSON = '+447700900456';

/** A runner that fails the test if the provider ever tries to shell out. */
function scripted(steps: unknown[]) {
  let i = 0;
  const calls: string[][] = [];
  return {
    calls,
    runner: async (args: string[]) => {
      calls.push(args);
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      return step;
    },
  };
}

const AUTH_OK = { usable: true };

describe('status mapping', () => {
  it('treats a completed call with no callee speech as a no-answer', () => {
    expect(mapCliStatus('COMPLETED', false)).toBe('no_answer');
    expect(mapCliStatus('COMPLETED', true)).toBe('completed');
  });

  it('folds voicemail and declined into no_answer', () => {
    expect(mapCliStatus('VOICEMAIL', false)).toBe('no_answer');
    expect(mapCliStatus('DECLINED', false)).toBe('no_answer');
    expect(mapCliStatus('NO_ANSWER', false)).toBe('no_answer');
  });

  it('maps expired to failed, because it says nothing about the phone', () => {
    expect(mapCliStatus('EXPIRED', false)).toBe('failed');
    expect(mapCliStatus('FAILED', false)).toBe('failed');
  });

  it('accepts both spellings of cancelled', () => {
    expect(mapCliStatus('CANCELED', false)).toBe('canceled');
    expect(mapCliStatus('CANCELLED', false)).toBe('canceled');
  });

  it('is case insensitive and defaults to queued, never to completed', () => {
    expect(mapCliStatus('completed', true)).toBe('completed');
    expect(mapCliStatus('SOMETHING_NEW', true)).toBe('queued');
    expect(mapCliStatus(undefined, true)).toBe('queued');
  });

  it('recognises every documented terminal status', () => {
    for (const s of [
      'COMPLETED',
      'FAILED',
      'NO_ANSWER',
      'DECLINED',
      'CANCELED',
      'CANCELLED',
      'VOICEMAIL',
      'BUSY',
      'EXPIRED',
    ]) {
      expect(isTerminalCliStatus(s)).toBe(true);
    }
    expect(isTerminalCliStatus('IN_PROGRESS')).toBe(false);
    expect(isTerminalCliStatus(undefined)).toBe(false);
  });
});

describe('transcript parsing', () => {
  it('attributes labelled lines', () => {
    const turns = parseCliTranscript('Bot: Good morning.\nUser: Hello there.');
    expect(turns).toEqual([
      { speaker: 'caller', text: 'Good morning.' },
      { speaker: 'callee', text: 'Hello there.' },
    ]);
  });

  it('accepts the label variants the CLI might emit', () => {
    const turns = parseCliTranscript(
      'Agent: one\nAssistant: two\nCallee: three\nCustomer: four',
    );
    expect(turns.map((t) => t.speaker)).toEqual([
      'caller',
      'caller',
      'callee',
      'callee',
    ]);
  });

  it('reads leading timestamps into offsets and strips them from the text', () => {
    const turns = parseCliTranscript('[00:03] Bot: Hello.\n01:02:03 User: Hi.');
    expect(turns[0]).toEqual({ speaker: 'caller', text: 'Hello.', at: 3 });
    expect(turns[1]).toEqual({ speaker: 'callee', text: 'Hi.', at: 3723 });
  });

  it('leaves an unrecognised speaker unknown rather than guessing', () => {
    const turns = parseCliTranscript('Receptionist: we are closed');
    expect(turns).toEqual([
      { speaker: 'unknown', text: 'Receptionist: we are closed' },
    ]);
  });

  it('never appends an unlabelled line to the previous speaker', () => {
    const turns = parseCliTranscript(
      'User: Tuesday at nine works.\nand bring the letter',
    );
    expect(turns[0].speaker).toBe('callee');
    // The continuation must not inherit `callee`, or it could confirm a booking.
    expect(turns[1]).toEqual({ speaker: 'unknown', text: 'and bring the letter' });
  });

  it('keeps an unattributable leak visible to the scanner', () => {
    const turns = parseCliTranscript(
      'mumbled line, oh double seven oh oh nine oh oh four five six',
    );
    expect(turns[0].speaker).toBe('unknown');
    expect(containsNumber(turns[0].text, PERSON)).toBe(true);
  });

  it('returns nothing for empty or non-string transcripts', () => {
    expect(parseCliTranscript('')).toEqual([]);
    expect(parseCliTranscript('   \n  ')).toEqual([]);
    expect(parseCliTranscript(undefined)).toEqual([]);
    expect(parseCliTranscript(null)).toEqual([]);
    expect(parseCliTranscript({ turns: [] })).toEqual([]);
  });

  it('does not mistake a sentence with a colon for a speaker label', () => {
    const turns = parseCliTranscript('Note: the surgery closes at noon');
    expect(turns[0].speaker).toBe('unknown');
  });
});

describe('envelope handling', () => {
  it('reads either envelope shape', () => {
    expect(structuredContent({ result: { structuredContent: { status: 'A' } } })).toEqual({
      status: 'A',
    });
    expect(
      structuredContent({ status_result: { structuredContent: { status: 'B' } } }),
    ).toEqual({ status: 'B' });
    expect(structuredContent(null)).toEqual({});
    expect(structuredContent('nope')).toEqual({});
  });
});

describe('placing a call', () => {
  const base = {
    to: '+442079460321',
    goal: 'Book a follow-up appointment.',
    idempotencyKey: 'errand:leg-1',
  };

  it('refuses to dial when the login is unusable', async () => {
    const { runner, calls } = scripted([{ usable: false }]);
    const p = new CalleCliProvider({ runner, pollIntervalMs: 0 });
    await expect(p.placeCall(base)).rejects.toThrow(/not authenticated/i);
    // It must not have attempted `call start`.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['auth', 'status']);
  });

  it('passes the goal as an argument, never through a shell', async () => {
    const { runner, calls } = scripted([
      AUTH_OK,
      {
        run_id: 'r1',
        status_result: {
          structuredContent: { status: 'COMPLETED', transcript: 'User: yes' },
        },
      },
    ]);
    const p = new CalleCliProvider({ runner, pollIntervalMs: 0 });
    await p.placeCall({ ...base, goal: 'Ask about `rm -rf /` & "quotes"' });

    const start = calls[1];
    expect(start[0]).toBe('call');
    expect(start[1]).toBe('start');
    // The dangerous text is one discrete argv entry, not concatenated.
    expect(start).toContain('Ask about `rm -rf /` & "quotes"');
  });

  it('polls until the run reaches a terminal status', async () => {
    let i = 0;
    const runner = async (args: string[]) => {
      if (args[0] === 'auth') return AUTH_OK;
      if (args[1] === 'start') {
        return {
          run_id: 'r9',
          status_result: { structuredContent: { status: 'IN_PROGRESS' } },
        };
      }
      i += 1;
      return {
        result: {
          structuredContent:
            i < 2
              ? { status: 'IN_PROGRESS' }
              : { status: 'COMPLETED', transcript: 'Bot: hi\nUser: Tuesday works.' },
        },
      };
    };

    const p = new CalleCliProvider({ runner, pollIntervalMs: 0 });
    const out = await p.placeCall(base);

    expect(out.status).toBe('completed');
    expect(out.ref).toBe('calle-cli:r9');
    expect(out.turns).toHaveLength(2);
  });

  it('never resubmits when the CLI says a retry is unsafe', async () => {
    const { runner, calls } = scripted([
      AUTH_OK,
      { call_started: 'unknown', retry_safe: false, run_id: 'r2' },
    ]);
    const p = new CalleCliProvider({ runner, pollIntervalMs: 0 });
    await expect(p.placeCall(base)).rejects.toThrow(/will not resubmit/i);
    // auth + one start. No second start.
    expect(calls.filter((c) => c[1] === 'start')).toHaveLength(1);
  });

  it('fails loudly when no run_id comes back', async () => {
    const { runner } = scripted([AUTH_OK, { status_result: {} }]);
    const p = new CalleCliProvider({ runner, pollIntervalMs: 0 });
    await expect(p.placeCall(base)).rejects.toThrow(/run_id/);
  });

  it('times out without resubmitting, and names the run to query', async () => {
    const runner = async (args: string[]) => {
      if (args[0] === 'auth') return AUTH_OK;
      if (args[1] === 'start') {
        return {
          run_id: 'r7',
          status_result: { structuredContent: { status: 'IN_PROGRESS' } },
        };
      }
      return { result: { structuredContent: { status: 'IN_PROGRESS' } } };
    };
    const p = new CalleCliProvider({ runner, pollIntervalMs: 0, timeoutMs: 0 });
    await expect(p.placeCall(base)).rejects.toThrow(/do not resubmit/i);
  });

  it('reports a completed call where only the agent spoke as a no-answer', async () => {
    const { runner } = scripted([
      AUTH_OK,
      {
        run_id: 'r3',
        status_result: {
          structuredContent: {
            status: 'COMPLETED',
            transcript: 'Bot: Hello? Is anyone there?',
          },
        },
      },
    ]);
    const p = new CalleCliProvider({ runner, pollIntervalMs: 0 });
    const out = await p.placeCall(base);
    expect(out.status).toBe('no_answer');
  });

  it('claims nothing on the provider’s behalf', async () => {
    const { runner } = scripted([
      AUTH_OK,
      {
        run_id: 'r4',
        status_result: {
          structuredContent: {
            status: 'COMPLETED',
            transcript: 'User: booked',
            // Even if the CLI grew these, Withheld must not read them.
            taskCompleted: true,
            structuredResult: { errand_resolved: 'yes' },
          },
        },
      },
    ]);
    const p = new CalleCliProvider({ runner, pollIntervalMs: 0 });
    const out = await p.placeCall(base);
    // SDK-shaped keys the CLI does not actually use are ignored rather than
    // scavenged: `taskCompleted` and `structuredResult` are not where the live
    // schema puts these, so reading them would be inventing a claim.
    expect(out.providerClaims).toEqual([]);
    expect(out.providerSelfAssessment).toEqual({
      taskCompleted: null,
      confidence: null,
    });
  });

  it('declares that it places real calls', () => {
    expect(new CalleCliProvider().placesRealCalls).toBe(true);
    expect(new CalleCliProvider().name).toBe('calle-cli');
  });
});

/**
 * Both official CALL-E packages install a binary called `calle`, and the SDK's
 * is the one that wins inside a project. Picking the wrong one looks like a
 * broken install, so resolution is tested rather than assumed.
 */
describe('resolveCliBinary', () => {
  const yes = () => true;

  it('skips node_modules/.bin, where the SDK installs its own calle', () => {
    const found = resolveCliBinary(
      { PATH: '/repo/node_modules/.bin:/usr/local/bin' },
      yes,
    );
    expect(found).toBe('/usr/local/bin/calle');
  });

  it('skips a nested node_modules path too', () => {
    const found = resolveCliBinary(
      { PATH: '/a/node_modules/x/node_modules/.bin:/opt/bin' },
      yes,
    );
    expect(found).toBe('/opt/bin/calle');
  });

  it('honours an explicit override without touching the filesystem', () => {
    const found = resolveCliBinary(
      { CALLE_CLI_BIN: '/custom/calle', PATH: '/usr/bin' },
      () => {
        throw new Error('should not probe the filesystem when overridden');
      },
    );
    expect(found).toBe('/custom/calle');
  });

  it('takes the first executable match in PATH order', () => {
    const found = resolveCliBinary(
      { PATH: '/first:/second' },
      (p) => p === '/first/calle' || p === '/second/calle',
    );
    expect(found).toBe('/first/calle');
  });

  it('falls back to the bare name so the error comes from exec, not from us', () => {
    expect(
      resolveCliBinary({ PATH: '/nowhere' }, () => false),
    ).toBe('calle');
  });

  it('survives an unset PATH', () => {
    expect(resolveCliBinary({}, yes)).toBe('calle');
  });
});

describe('explainCliFailure', () => {
  it('names the package collision when the SDK binary answers instead', () => {
    const msg = explainCliFailure(
      new Error('Command failed: calle auth status --json\nUnknown command: auth'),
      '/repo/node_modules/.bin/calle',
    );
    expect(msg).toContain('@call-e/cli');
    expect(msg).toContain('@call-e/calle');
    expect(msg).toContain('CALLE_CLI_BIN');
  });

  it('tells you to install the CLI when it is absent', () => {
    const msg = explainCliFailure(new Error('spawn calle ENOENT'), 'calle');
    expect(msg).toContain('npm install -g @call-e/cli');
  });

  it('passes anything else through instead of guessing', () => {
    const msg = explainCliFailure(new Error('network is unreachable'), 'calle');
    expect(msg).toContain('network is unreachable');
  });
});

describe('CalleCliProvider.ensureAuthenticated', () => {
  it('refuses when the login is pending, and explains why', async () => {
    const provider = new CalleCliProvider({
      runner: async () => ({ usable: false, pending_status: 'PENDING' }),
    });
    await expect(provider.ensureAuthenticated()).rejects.toThrow(
      /not authenticated/i,
    );
  });

  it('translates the shadowed-binary failure instead of leaking it raw', async () => {
    const provider = new CalleCliProvider({
      runner: async () => {
        throw new Error('Command failed\nUnknown command: auth');
      },
    });
    await expect(provider.ensureAuthenticated()).rejects.toThrow(
      /does not have an `auth` command/,
    );
  });

  it('places no call when auth fails', async () => {
    const calls: string[][] = [];
    const provider = new CalleCliProvider({
      runner: async (args) => {
        calls.push(args);
        return { usable: false };
      },
    });
    await expect(provider.ensureAuthenticated()).rejects.toThrow();
    expect(calls).toEqual([['auth', 'status']]);
  });
});

/**
 * Checked against the live `get_call_run` output schema after authenticating.
 * Three things differed from the CLI reference doc, and all three fail silently
 * rather than loudly, which is why each one gets a test.
 */
describe('conformance with the live get_call_run schema', () => {
  it('treats "NO ANSWER" with a space as terminal', () => {
    // The schema documents statuses space-separated; the CLI reference uses
    // underscores. Miss this and the poll loop spins to timeout on every
    // unanswered call.
    expect(isTerminalCliStatus('NO ANSWER')).toBe(true);
    expect(isTerminalCliStatus('NO_ANSWER')).toBe(true);
    expect(isTerminalCliStatus('no answer')).toBe(true);
  });

  it('maps the spaced spelling to the same outcome as the underscored one', () => {
    expect(mapCliStatus('NO ANSWER', false)).toBe('no_answer');
    expect(mapCliStatus('NO_ANSWER', false)).toBe('no_answer');
  });

  it('keeps the pre-dial states non-terminal and verdict-free', () => {
    for (const s of ['PREPARING', 'SCHEDULED']) {
      expect(isTerminalCliStatus(s)).toBe(false);
      expect(mapCliStatus(s, false)).toBe('queued');
    }
  });

  it('reads the transcript from result.transcript, where the schema puts it', () => {
    expect(callTranscript({ result: { transcript: 'bot: hello' } })).toBe(
      'bot: hello',
    );
  });

  it('still reads a flat transcript, as the CLI reference shows it', () => {
    expect(callTranscript({ transcript: 'bot: hello' })).toBe('bot: hello');
  });

  it('prefers the nested transcript when both are present', () => {
    expect(
      callTranscript({ transcript: 'flat', result: { transcript: 'nested' } }),
    ).toBe('nested');
  });

  it('returns nothing rather than guessing when neither is present', () => {
    expect(callTranscript({})).toBeUndefined();
    expect(parseCliTranscript(callTranscript({}))).toEqual([]);
  });

  it('records the run outcome without letting it decide anything', () => {
    const content = {
      status: 'COMPLETED',
      result: {
        transcript: 'bot: are you open?\nuser: yes, until six.',
        outcome: {
          task_completed: true,
          completion_confidence: { score: 0.91, label: 'high' },
        },
        extracted: { errand_resolved: 'yes', note: '   ' },
      },
    };
    const turns = parseCliTranscript(callTranscript(content));
    expect(turns.filter((t) => t.speaker === 'callee')).toHaveLength(1);
    // Blank claims are dropped; real ones are recorded but never consulted.
    expect(normalizeClaims(content.result.extracted)).toEqual([
      { question_id: 'errand_resolved', answer: 'yes' },
    ]);
  });
});
