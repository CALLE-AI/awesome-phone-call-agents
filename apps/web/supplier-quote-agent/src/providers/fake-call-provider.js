const fs = require('fs');
const path = require('path');
const { CallProvider, STATUS_SEQUENCE } = require('./call-provider');

const DEFAULT_RESPONSES_PATH = path.join(__dirname, '../../fake-provider/canned-responses.json');

function loadCannedResponses(responsesPath = DEFAULT_RESPONSES_PATH) {
  return JSON.parse(fs.readFileSync(responsesPath, 'utf8'));
}

// Deterministic stand-in for CallEProvider: no network, no real timers. `clock` and
// `wait` are injectable so tests can control both the timestamps on each status
// transition and how the sequence is paced (default: resolves instantly).
class FakeCallProvider extends CallProvider {
  // cancelIsAuthoritative defaults to true (the base class's own default — a fake abort
  // genuinely ends the sequence) but is overridable so a test can simulate a provider
  // like CallEProvider's "cancel only stops local waiting" behaviour deterministically,
  // with no network and no real credentials anywhere near it.
  constructor({
    clock = () => new Date().toISOString(),
    wait = () => Promise.resolve(),
    outcomes,
    cancelIsAuthoritative = true
  } = {}) {
    super();
    this.clock = clock;
    this.wait = wait;
    this.outcomes = outcomes || loadCannedResponses();
    this._cancelIsAuthoritative = cancelIsAuthoritative;
  }

  get cancelIsAuthoritative() {
    return this._cancelIsAuthoritative;
  }

  async placeCall(_task, { onStatusChange, signal, scenario = 'default' } = {}) {
    const outcome = this.outcomes[scenario];
    if (!outcome) {
      throw new Error(`FakeCallProvider: no canned response for scenario "${scenario}"`);
    }

    const throwIfAborted = () => {
      if (signal && signal.aborted) {
        const abortError = new Error('Call aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }
    };

    for (const status of STATUS_SEQUENCE) {
      throwIfAborted();
      // Races the pacing delay against the abort signal itself (not just a check
      // between steps) so issue #6's cancel_call can interrupt a `wait` that never
      // resolves on its own — e.g. a test standing in for a call that is still ringing.
      await raceAgainstAbort(this.wait(), signal);
      throwIfAborted();
      if (onStatusChange) {
        onStatusChange(status, this.clock());
      }
    }

    return { ...outcome };
  }
}

function raceAgainstAbort(promise, signal) {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

module.exports = { FakeCallProvider, loadCannedResponses };
