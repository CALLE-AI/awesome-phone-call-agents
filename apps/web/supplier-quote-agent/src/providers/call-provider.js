const STATUS_SEQUENCE = ['dialing', 'connected', 'wrapping_up', 'done'];

// Shared interface: both FakeCallProvider and CallEProvider implement placeCall()
// and resolve to exactly { outcome, summary, next_action } so invoke.js never needs
// to know which provider it is talking to.
class CallProvider {
  async placeCall(_task, _options) {
    throw new Error('CallProvider.placeCall not implemented');
  }
}

module.exports = { CallProvider, STATUS_SEQUENCE };
