#!/usr/bin/env tsx
/**
 * Withheld CLI.
 *
 * Every command defaults to something that places no call. `--real` is the only
 * path to a phone ringing, and it refuses to run without a CALL-E credential —
 * either CALLE_API_KEY for the developer API, or a logged-in `calle` CLI.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadErrand } from '../src/core/errand';
import { buildScript, formatWindow } from '../src/core/script';
import { redactForDisplay } from '../src/core/budget';
import { runChain } from '../src/core/chain';
import { CalleProvider, FixtureProvider } from '../src/core/calle';
import { CalleCliProvider } from '../src/core/calle-cli';
import type { CallProvider } from '../src/core/calle';
import type { ChainState } from '../src/core/chain';
import type { LegResult } from '../src/core/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(root, 'fixtures/legs');

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function usage(): never {
  console.log(`
${c.bold('withheld')} — never accept a callback

  ${c.cyan('preview')} <errand.json>
      Show the generated script and every gate it passed. Places no call.

  ${c.cyan('replay')}  <errand.json> [--legs a,b,c]
      Run the errand chain against recorded transcripts. Places no call.
      Available fixtures: ${FixtureProvider.available(FIXTURES).join(', ')}

  ${c.cyan('run')}     <errand.json> --real [--via=sdk|cli]
      Place real calls through CALL-E.
      --via=sdk  developer API, needs CALLE_API_KEY
      --via=cli  the \`calle\` CLI you logged into, needs no key
      Default: sdk if CALLE_API_KEY is set, otherwise cli.

  ${c.cyan('fixtures')}
      List the recorded transcripts and what each one is for.
`);
  process.exit(1);
}

function readErrand(file: string) {
  const raw = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
  const loaded = loadErrand(raw);

  if (!loaded.ok) {
    console.error(c.red('\n  The errand file was refused.\n'));
    for (const e of loaded.errors) console.error(`    ${e}`);
    for (const f of loaded.findings) {
      console.error(`    ${c.red('refused')} ${f.kind}: ${f.masked} — ${f.note}`);
    }
    console.error('');
    process.exit(2);
  }

  return loaded.errand!;
}

function printLeg(result: LegResult, personPhone: string): void {
  // Answers and supporting turns are quoted out of the call, so everything
  // transcript-derived goes through the same redaction the findings use.
  const safe = (t: string) => redactForDisplay(t, personPhone);
  const ok = result.number_disclosed ? c.red : c.green;
  console.log(
    `\n  ${c.bold(`Leg ${result.leg}`)} ${c.dim(result.transcript_ref)}`,
  );
  console.log(`    status            ${c.bold(result.status)}`);
  console.log(`    next action       ${result.next_action}`);
  console.log(
    `    number disclosed  ${ok(String(result.number_disclosed))}` +
      (result.number_disclosed ? c.red('   ← the invariant broke') : ''),
  );

  if (result.number_requested_by_callee) {
    console.log(
      `    ${c.yellow('the callee asked for a number')}${
        result.number_disclosed ? '' : c.green(' — the caller held the line')
      }`,
    );
  }

  if (result.answers.length) {
    console.log(`\n    ${c.dim('answers (transcript-bound)')}`);
    for (const a of result.answers) {
      if (a.answer === null) {
        const note = a.provider_claimed_unsupported
          ? c.yellow('not answered — CALL-E claimed one, nothing supports it')
          : c.dim('not answered');
        console.log(`      ${a.question_id}: ${note}`);
      } else {
        console.log(`      ${a.question_id}: ${safe(a.answer)}`);
        console.log(`        ${c.dim(`↳ "${safe(a.supporting_turn ?? '')}"`)}`);
      }
    }
  }

  if (result.agreed_window.start && result.agreed_window.end) {
    console.log(`\n    ${c.dim('agreed window')}`);
    console.log(
      `      ${c.green(formatWindow(result.agreed_window.start, result.agreed_window.end))}`,
    );
    console.log(
      `        ${c.dim(`↳ "${safe(result.agreed_window.supporting_turn ?? '')}"`)}`,
    );
  }

  if (result.disclosed_about_person.length) {
    console.log(`\n    ${c.dim('disclosed about the person')}`);
    for (const d of result.disclosed_about_person) {
      console.log(`      - ${safe(d)}`);
    }
  }

  if (result.outside_may_say_findings.length) {
    console.log(`\n    ${c.red('budget violations')} ${c.dim('(masked)')}`);
    for (const v of result.outside_may_say_findings) {
      console.log(`      ${v.kind}: ${v.masked}`);
      console.log(`        ${c.dim(v.note)}`);
    }
  }
}

function printChain(state: ChainState, personPhone: string): void {
  for (const leg of state.legs) printLeg(leg, personPhone);

  if (state.next) {
    console.log(`\n  ${c.bold('Scheduled next leg')} ${c.dim('(intent only — this app runs no scheduler)')}`);
    console.log(
      `    leg ${state.next.leg}, not before ${formatWindow(
        state.next.not_before,
        state.next.not_after,
      )}`,
    );
    console.log(
      `    ${c.dim(`↳ "${redactForDisplay(state.next.supporting_turn ?? '', personPhone)}"`)}`,
    );
  }

  if (state.halted_reason) {
    console.log(`\n  ${c.yellow('Halted')}`);
    console.log(`    ${state.halted_reason}`);
  } else if (state.legs.at(-1)?.next_action === 'errand_complete') {
    console.log(`\n  ${c.green('Errand complete.')}`);
  }
  console.log('');
}

/**
 * Pick the live provider.
 *
 * CALL-E has two surfaces with two different credentials, and which one a
 * person holds depends on how they installed it. The published installation
 * guide ends at `calle auth login`, which authorises the CLI and produces no
 * API key — so defaulting to the SDK would leave most people unable to place a
 * call at all. Whichever credential is present wins; `--via` forces the choice.
 */
async function liveProvider(rest: string[]): Promise<CallProvider> {
  const viaArg = rest.find((a) => a.startsWith('--via='));
  const via = viaArg?.slice('--via='.length);
  const apiKey = process.env.CALLE_API_KEY ?? '';

  if (via && via !== 'sdk' && via !== 'cli') {
    console.error(`\n  Unknown --via=${via}. Use --via=sdk or --via=cli.\n`);
    process.exit(2);
  }

  if (via === 'sdk' || (!via && apiKey)) {
    if (!apiKey) {
      console.error(
        '\n  --via=sdk needs CALLE_API_KEY. Leave it unset to use the CLI login instead.\n',
      );
      process.exit(2);
    }
    return new CalleProvider({ apiKey });
  }

  const provider = new CalleCliProvider();
  try {
    await provider.ensureAuthenticated();
  } catch (error) {
    console.error(`\n  ${(error as Error).message}\n`);
    process.exit(2);
  }
  return provider;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) usage();

  if (command === 'fixtures') {
    console.log('');
    for (const name of FixtureProvider.available(FIXTURES)) {
      const f = new FixtureProvider(FIXTURES).load(name);
      console.log(`  ${c.bold(name.padEnd(22))} ${c.dim(f.status)}`);
      console.log(`  ${' '.repeat(22)} ${f.description}\n`);
    }
    return;
  }

  const file = rest.find((a) => !a.startsWith('--'));
  if (!file) usage();

  const errand = readErrand(file);
  const real = rest.includes('--real');

  if (command === 'preview') {
    const script = buildScript(errand);
    console.log(`\n${c.bold('  Generated script')} ${c.dim('(this is what CALL-E receives)')}\n`);
    console.log(
      script.goal
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
    );
    console.log(`\n  ${c.bold('Gates')}`);
    console.log(
      `    number gate       ${
        script.safeToDial ? c.green('passed') : c.red('REFUSED')
      }`,
    );
    console.log(
      `    reason field sent ${c.green('no')} ${c.dim("— why they can't use a phone stays local")}`,
    );
    if (script.advisories.length) {
      console.log(
        `    ${c.yellow('advisory')}          ${script.advisories.join(', ')} ${c.dim(
          '(a warning, not a gate)',
        )}`,
      );
    }
    console.log(`\n  ${c.dim('No call was placed.')}\n`);
    return;
  }

  if (command !== 'replay' && command !== 'run') usage();

  let provider: CallProvider;

  if (command === 'run' && real) {
    provider = await liveProvider(rest);
    console.log(
      `\n  ${c.red('REAL CALLS')} — dialing ${errand.callee.name} via ${c.bold(
        provider.name,
      )}. Ctrl-C now if that is not what you meant.`,
    );
    await new Promise((r) => setTimeout(r, 3000));
  } else {
    const legsArg = rest.find((a) => a.startsWith('--legs='));
    const sequence = legsArg
      ? legsArg.slice('--legs='.length).split(',')
      : ['window-agreed', 'errand-complete'];
    provider = new FixtureProvider(FIXTURES, sequence);
    console.log(
      `\n  ${c.dim(`replaying: ${sequence.join(' → ')} (no calls placed)`)}`,
    );
  }

  // `run --real` is happening now; a replay is anchored to when it was recorded.
  const now =
    (provider instanceof FixtureProvider ? provider.recordedAt() : null) ??
    new Date();

  const state = await runChain({ errand, provider, now });
  printChain(state, errand.person.phone);

  const leaked = state.legs.some((l) => l.number_disclosed);
  process.exit(leaked ? 3 : 0);
}

main().catch((err) => {
  // A thrown error can carry a provider payload or a transcript fragment, so
  // the crash path gets the same redaction as the success path. `personPhone`
  // is unknown here, so this only strips phone-shaped text — which is why the
  // printer above redacts against the actual number while it still can.
  const raw = err instanceof Error ? err.message : String(err);
  console.error(`\n  ${c.red('error')} ${redactForDisplay(raw, '')}\n`);
  process.exit(1);
});
