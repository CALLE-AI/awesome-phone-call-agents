import { version as platformVersion } from 'zapier-platform-core';
import { createRequire } from 'node:module';

import authentication from './authentication.js';
import { addBearerHeader, checkForErrors } from './lib/client.js';
import startCall from './creates/start-call.js';
import placeCallAndWait from './creates/place-call-and-wait.js';
import findCallResult from './searches/find-call-result.js';

const { version } = createRequire(import.meta.url)('./package.json');

export default {
  version,
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
