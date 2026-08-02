import { version as platformVersion } from 'zapier-platform-core';

import authentication from './authentication.js';
import { addBearerHeader, checkForErrors } from './lib/client.js';
import startCall from './creates/start-call.js';
import placeCallAndWait from './creates/place-call-and-wait.js';
import findCallResult from './searches/find-call-result.js';

// Version is a literal, not read from package.json: import.meta is not
// available when this app is bundled for a CommonJS target, and reading it
// at runtime would throw. Keep this in sync with package.json's "version".
// Do not add "type": "module" to package.json either - Zapier's build
// wrapper imports this app by package name, and that resolution breaks
// under explicit ESM (works today only via Node's module-syntax
// auto-detection, which "zapier push" - unlike "zapier validate" - proved
// necessary to keep the build passing).
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
