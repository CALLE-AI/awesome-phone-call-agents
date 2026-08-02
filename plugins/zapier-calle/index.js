import { version as platformVersion } from 'zapier-platform-core';

import authentication from './authentication.js';
import { addBearerHeader, checkForErrors } from './lib/client.js';
import startCall from './creates/start-call.js';
import placeCallAndWait from './creates/place-call-and-wait.js';
import findCallResult from './searches/find-call-result.js';

// Version is a literal, not read from package.json: import.meta is not
// available when this app is bundled for a CommonJS target, and reading it
// at runtime would throw. Keep this in sync with package.json's "version".
//
// package.json must declare BOTH "type": "module" and an "exports" map.
// Without "type": "module", Zapier's Lambda loads this ESM source as
// CommonJS and throws "Cannot use import statement outside a module" on
// the very first line above. Without "exports", Zapier's build wrapper
// cannot self-resolve `import('zapier-calle')` (a package self-reference,
// which Node only allows via the "exports" field) and "zapier push" fails.
// Both fields are required together; removing either one breaks production.
export default {
  version: '1.0.0',
  platformVersion,
  authentication,
  beforeRequest: [addBearerHeader],
  afterResponse: [checkForErrors],
  triggers: {},
  searches: {
    [findCallResult.key]: findCallResult,
  },
  creates: {
    [startCall.key]: startCall,
    [placeCallAndWait.key]: placeCallAndWait,
  },
};
