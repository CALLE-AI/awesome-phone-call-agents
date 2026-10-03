const STATUS_SEQUENCE = ['dialing', 'connected', 'wrapping_up', 'done'];

// Shared interface: both FakeCallProvider and CallEProvider implement placeCall()
// and resolve to exactly { outcome, summary, next_action } so invoke.js never needs
// to know which provider it is talking to.
class CallProvider {
  // Whether aborting placeCall()'s signal is guaranteed to have stopped the call on the
  // provider's side too, not just this process's wait. True by default (the fake
  // provider's abort genuinely ends its deterministic sequence). A provider whose
  // network API offers no cancel operation overrides this to false, so invoke.js can
  // record "cancel requested, outcome unknown" instead of a "cancelled" it can't back up.
  get cancelIsAuthoritative() {
    return true;
  }

  async placeCall(_task, _options) {
    throw new Error('CallProvider.placeCall not implemented');
  }
}

module.exports = { CallProvider, STATUS_SEQUENCE };
