const { FakeCallProvider } = require('./fake-call-provider');
const { CallEProvider } = require('./calle-provider');

// Read at CALL time (default param, not a module-level constant) so a test that never
// passes `provider` explicitly always gets whatever CALL_PROVIDER is at that moment —
// and so importing this module never has a side effect.
function getProvider(name = process.env.CALL_PROVIDER || 'fake', options = {}) {
  switch (name) {
    case 'fake':
      return new FakeCallProvider(options);
    case 'calle':
      return new CallEProvider(options);
    default:
      throw new Error(`Unknown call provider: ${name}`);
  }
}

module.exports = { getProvider };
