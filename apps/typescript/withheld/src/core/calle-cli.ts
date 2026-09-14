/**
 * The CALL-E CLI as a call provider.
 *
 * Withheld's other live provider talks to the Developer API through
 * `@call-e/calle` and needs a `CALLE_API_KEY`. This one drives the `calle` CLI,
 * which authenticates through the brokered OAuth login (`calle auth login`).
 * They are different surfaces with different credentials, and most people
 * installing CALL-E from the published guide end up with the second one, so
 * requiring an API key would mean the app could not actually place a call.
 *
 * Three differences from the SDK matter, and all three are handled by failing
 * closed rather than by guessing:
 *
 *   1. The CLI returns the transcript as *one string*, not as speaker-attributed
 *      turns. Anything this parser cannot confidently attribute becomes an
 *      `unknown` turn, which the rest of the app already refuses to let confirm
 *      a window or bind an answer — but still scans for the number. A leak is
 *      caught whoever said it; a booking is never invented from a line we could
 *      not attribute.
 *
 *   2. There is no `recipientResultSchema` parameter, so there are no provider
 *      claims to record. That costs Withheld nothing: it never trusted them.
 *      Every answer was always re-derived from the transcript.
 *
 *   3. There is no idempotency key. Instead the CLI reports `call_started:
 *      "unknown"` with `retry_safe: false` when a submission may already be in
 *      flight. Withheld treats that as a hard stop rather than retrying, because
 *      the failure mode of guessing is phoning a real person twice.
 */

import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CallStatus, Turn } from './types';
import type { CallOutcome, CallProvider, CallRequest } from './calle';

const exec = promisify(execFile);

/**
 * Two different official CALL-E packages install a binary called `calle`:
 *
 *   @call-e/cli    the MCP CLI — has `auth`, `call`, `mcp`. This is the one
 *                  the installation guide sets up, and the one we need.
 *   @call-e/calle  the developer-API SDK — ships its own unrelated `calle`.
 *
 * If the SDK is a project dependency, `node_modules/.bin/calle` is the SDK's,
 * and anything that prepends it to PATH (npm scripts, npx, pnpm) silently
 * shadows the real CLI. The symptom is `Unknown command: auth`, which reads
 * like a broken install rather than a name collision.
 *
 * So resolve the binary ourselves and skip `node_modules/.bin` entirely. A
 * project-local shim is never the CLI we want.
 */
export function resolveCliBinary(
  env: Record<string, string | undefined> = process.env,
  isExecutable: (p: string) => boolean = defaultIsExecutable,
): string {
  const override = env.CALLE_CLI_BIN?.trim();
  if (override) return override;

  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of (env.PATH ?? '').split(sep)) {
    if (!dir) continue;
    if (dir.split(/[\\/]/).includes('node_modules')) continue;
    const candidate = path.join(dir, 'calle');
    if (isExecutable(candidate)) return candidate;
  }
  return 'calle';
}

function defaultIsExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Turn a spawn failure into something a person can act on. The two failures
 * worth naming are the package name collision and a missing CLI; everything
 * else is passed through rather than guessed at.
 */
export function explainCliFailure(error: unknown, binary: string): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/unknown command:\s*auth/i.test(message)) {
    return [
      `\`${binary}\` is not the CALL-E MCP CLI — it does not have an \`auth\` command.`,
      'Two CALL-E packages install a binary named `calle`: @call-e/cli (the one you want)',
      'and @call-e/calle (the SDK). A project-local install of the SDK shadows the CLI.',
      'Fix: `npm install -g @call-e/cli`, then point at it with CALLE_CLI_BIN=$(which calle).',
    ].join('\n  ');
  }

  if (/ENOENT/.test(message)) {
    return [
      `Could not find the CALL-E CLI (\`${binary}\`).`,
      'Install it with `npm install -g @call-e/cli` and run `calle auth login`.',
    ].join('\n  ');
  }

  return `Could not read CALL-E auth status: ${message}`;
}

/** Terminal run statuses, as documented by the CLI skill reference. */
export const TERMINAL_CLI_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'NO_ANSWER',
  'DECLINED',
  'CANCELED',
  'CANCELLED',
  'VOICEMAIL',
  'BUSY',
  'EXPIRED',
]);

export function isTerminalCliStatus(raw: unknown): boolean {
  return TERMINAL_CLI_STATUSES.has(String(raw ?? '').toUpperCase());
}

/**
 * Map a CLI run status onto Withheld's vocabulary.
 *
 * `DECLINED` becomes `no_answer`: the person was reachable and chose not to
 * speak to us, which for this app's purposes is the same shape of outcome as an
 * unanswered ring — no conversation happened, and a human should decide what
 * comes next. `EXPIRED` becomes `failed`, because it genuinely tells us nothing
 * about what the phone did.
 *
 * As with the SDK path, a `COMPLETED` run in which the callee never speaks is
 * reported as a no-answer rather than as a call where nothing was agreed. Those
 * are different facts, and conflating them quietly turns silence into "they
 * said no".
 */
export function mapCliStatus(raw: unknown, anyHumanSpeech: boolean): CallStatus {
  const status = String(raw ?? '').toUpperCase();

  switch (status) {
    case 'COMPLETED':
      return anyHumanSpeech ? 'completed' : 'no_answer';
    case 'NO_ANSWER':
    case 'VOICEMAIL':
    case 'DECLINED':
      return 'no_answer';
    case 'BUSY':
      return 'busy';
    case 'CANCELED':
    case 'CANCELLED':
      return 'canceled';
    case 'FAILED':
    case 'EXPIRED':
      return 'failed';
    case 'IN_PROGRESS':
    case 'RUNNING':
    case 'CALLING':
      return 'in_progress';
    default:
      return 'queued';
  }
}

const CALLER_LABELS = new Set([
  'bot',
  'agent',
  'ai',
  'assistant',
  'caller',
  'calle',
  'call-e',
  'system',
]);

const CALLEE_LABELS = new Set([
  'user',
  'callee',
  'customer',
  'human',
  'recipient',
  'person',
  'contact',
]);

/**
 * Turn the CLI's transcript string into turns.
 *
 * A line is attributed only when it carries an explicit speaker label this
 * parser recognises. Everything else — continuation lines, unlabelled prose, a
 * format nobody anticipated — becomes its own `unknown` turn.
 *
 * That is deliberate rather than lazy. Appending an unlabelled line to whoever
 * spoke last would be a guess, and the two ways of being wrong are not
 * symmetrical: wrongly crediting the callee could confirm an appointment nobody
 * offered, while `unknown` can confirm nothing and is still scanned for the
 * number. The cost of this choice is a report that says "unconfirmed" more
 * often. That is the correct direction to be wrong in.
 */
export function parseCliTranscript(text: unknown): Turn[] {
  if (typeof text !== 'string' || text.trim().length === 0) return [];

  const turns: Turn[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    // Strip a leading timestamp: "[00:03]", "(00:03)", "00:03:11", "12:04 -".
    const stamp = line.match(
      /^[[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?\s*[-–—]?\s*/,
    );
    let at: number | undefined;
    if (stamp) {
      at = toSeconds(stamp[1]);
      line = line.slice(stamp[0].length).trim();
      if (!line) continue;
    }

    const labelled = line.match(/^([A-Za-z][A-Za-z0-9 _-]{0,20})\s*[:：]\s*(.+)$/);
    if (labelled) {
      const label = labelled[1].trim().toLowerCase().replace(/\s+/g, '-');
      const said = labelled[2].trim();
      if (said && (CALLER_LABELS.has(label) || CALLEE_LABELS.has(label))) {
        const speaker: Turn['speaker'] = CALLER_LABELS.has(label)
          ? 'caller'
          : 'callee';
        turns.push(at === undefined ? { speaker, text: said } : { speaker, text: said, at });
        continue;
      }
    }

    turns.push(
      at === undefined
        ? { speaker: 'unknown', text: line }
        : { speaker: 'unknown', text: line, at },
    );
  }

  return turns;
}

function toSeconds(stamp: string): number | undefined {
  const parts = stamp.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return undefined;
}

/** Pull the run payload out of either command's JSON envelope. */
export function structuredContent(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, any>;
  return (
    p.result?.structuredContent ??
    p.status_result?.structuredContent ??
    p.structuredContent ??
    {}
  );
}

export interface CalleCliOptions {
  binary?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Injected in tests so no test can ever shell out to the real CLI. */
  runner?: (args: string[], timeoutMs: number) => Promise<unknown>;
}

export class CalleCliProvider implements CallProvider {
  readonly name = 'calle-cli';
  readonly placesRealCalls = true;

  private readonly binary: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly runner: (args: string[], timeoutMs: number) => Promise<unknown>;

  constructor(opts: CalleCliOptions = {}) {
    this.binary = opts.binary ?? resolveCliBinary();
    this.pollIntervalMs = opts.pollIntervalMs ?? 10_000;
    this.timeoutMs = opts.timeoutMs ?? 15 * 60_000;
    this.runner = opts.runner ?? ((args, t) => this.spawn(args, t));
  }

  /**
   * Arguments are passed as an array to `execFile`, never through a shell. The
   * goal text is assembled from an errand file, so a shell here would make a
   * stray backtick in a clinic's name into command execution.
   */
  private async spawn(args: string[], timeoutMs: number): Promise<unknown> {
    const { stdout } = await exec(this.binary, [...args, '--json'], {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        CALLE_SOURCE: 'withheld',
        CALLE_INTEGRATION: 'withheld-app',
        CALLE_INTEGRATION_VERSION: '0.1.0',
      },
    });
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(
        `The calle CLI returned output that is not JSON: ${stdout.slice(0, 200)}`,
      );
    }
  }

  /** Refuse to attempt a call with a login that is not usable. */
  async ensureAuthenticated(): Promise<void> {
    let status: Record<string, unknown> | undefined;
    try {
      status = (await this.runner(['auth', 'status'], 60_000)) as
        | Record<string, unknown>
        | undefined;
    } catch (error) {
      throw new Error(explainCliFailure(error, this.binary));
    }
    if (!status || status.usable !== true) {
      throw new Error(
        'CALL-E is not authenticated. Run `calle auth login` and complete the browser authorization first.',
      );
    }
  }

  async placeCall(request: CallRequest): Promise<CallOutcome> {
    await this.ensureAuthenticated();

    const args = ['call', 'start', '--to-phone', request.to, '--goal', request.goal];
    if (request.locale) args.push('--language', request.locale);
    if (request.region) args.push('--region', request.region);

    const started = (await this.runner(args, 5 * 60_000)) as Record<string, any>;

    // A submission that may already be in flight is never retried. Phoning a
    // real person twice is worse than stopping and asking for a human.
    if (
      String(started?.call_started ?? '').toLowerCase() === 'unknown' &&
      started?.retry_safe === false
    ) {
      throw new Error(
        'CALL-E could not confirm whether the call was submitted, and reported it is not safe to retry. ' +
          'Withheld will not resubmit. Recover the run manually with `calle call recover` before trying again.',
      );
    }

    const runId = String(started?.run_id ?? '');
    if (!runId) {
      throw new Error('CALL-E did not return a run_id for the call.');
    }

    let content = structuredContent(started);
    const deadline = Date.now() + this.timeoutMs;

    while (!isTerminalCliStatus(content.status)) {
      if (Date.now() >= deadline) {
        throw new Error(
          `CALL-E run ${runId} did not reach a terminal status within the timeout. ` +
            `Query it with \`calle call status --run-id ${runId}\`; do not resubmit.`,
        );
      }
      await sleep(this.pollIntervalMs);
      content = structuredContent(
        await this.runner(['call', 'status', '--run-id', runId], 120_000),
      );
    }

    const turns = parseCliTranscript(content.transcript);

    return {
      status: mapCliStatus(
        content.status,
        turns.some((t) => t.speaker === 'callee' && t.text.trim().length > 0),
      ),
      turns,
      // The CLI exposes no structured-result schema, so there is nothing for the
      // provider to claim. Withheld never read these anyway.
      providerClaims: [],
      ref: `calle-cli:${runId}`,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
