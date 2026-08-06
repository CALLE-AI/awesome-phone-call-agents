import { version as platformVersion } from 'zapier-platform-core';

import authentication from './authentication.js';
import { addBearerHeader, checkForErrors } from './lib/client.js';
import startCall from './creates/start-call.js';
import placeCallAndWait from './creates/place-call-and-wait.js';
import findCallResult from './searches/find-call-result.js';
import callCompleted from './triggers/call-completed.js';

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
  version: '1.3.0',
  platformVersion,
  authentication,
  beforeRequest: [addBearerHeader],
  afterResponse: [checkForErrors],
  // No polling trigger is possible: the CALL-E Developer API has no
  // endpoint that lists calls, so there is nothing for Zapier to poll.
  // `call_completed` is a static webhook trigger instead - it omits
  // performSubscribe/performUnsubscribe because CALL-E also has no webhook
  // subscription API, so the user pastes the Zapier-provided URL into
  // CALL-E's own project webhook settings by hand. See
  // triggers/call-completed.js for the details.
  triggers: {
    [callCompleted.key]: callCompleted,
  },
  searches: {
    [findCallResult.key]: findCallResult,
  },
  creates: {
    [startCall.key]: startCall,
    [placeCallAndWait.key]: placeCallAndWait,
  },
};
