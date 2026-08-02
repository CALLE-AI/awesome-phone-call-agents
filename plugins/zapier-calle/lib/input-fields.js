export const INPUT_FIELDS = [
  {
    key: 'task',
    label: 'Call Task',
    type: 'text',
    required: true,
    helpText:
      'What CALL-E should accomplish on the call, including any details the agent needs and exactly what information to collect.',
  },
  {
    key: 'phone',
    label: 'Recipient Phone Number',
    type: 'string',
    required: true,
    helpText: 'Must be E.164 format, for example +15550123456. Only call numbers you are authorized to call.',
  },
  {
    key: 'region',
    label: 'Region',
    type: 'string',
    required: false,
    helpText: 'Optional ISO country code such as US. Leave blank if unknown; it is never inferred.',
  },
  {
    key: 'locale',
    label: 'Locale',
    type: 'string',
    required: false,
    helpText: 'Optional locale such as en-US. Leave blank if unknown; it is never inferred.',
  },
  {
    key: 'calling_window_timezone',
    label: 'Recipient Timezone (IANA)',
    type: 'string',
    required: false,
    helpText:
      'Supplying this enables calling-window enforcement: the call is refused outside the configured local hours. Must be an IANA name such as America/New_York or Asia/Ho_Chi_Minh. It is never inferred from the phone number. Leave blank to disable enforcement.',
  },
  {
    key: 'calling_window_earliest_hour',
    label: 'Earliest Local Hour',
    type: 'integer',
    required: false,
    default: '8',
    helpText: 'Earliest local hour (0-23) the call is allowed to start. Only applies when Recipient Timezone is set.',
  },
  {
    key: 'calling_window_latest_hour',
    label: 'Latest Local Hour',
    type: 'integer',
    required: false,
    default: '21',
    helpText:
      'Latest local hour (0-23) the call is allowed to start; calls are blocked at and after this hour. The US federal TCPA window is 8 to 21 local (47 CFR 64.1200). Florida and Oklahoma require 20. Only applies when Recipient Timezone is set.',
  },
  {
    key: 'calling_window_block_sunday',
    label: 'Block Sunday Calls',
    type: 'boolean',
    required: false,
    default: 'false',
    helpText:
      'When true, refuses to call on Sunday in the recipient local timezone. Florida prohibits Sunday solicitation calls. Only applies when Recipient Timezone is set.',
  },
  {
    key: 'suppression_list',
    label: 'Do Not Call List',
    type: 'text',
    required: false,
    helpText:
      'Paste or map a list of numbers that must never be dialled, separated by commas or newlines. Matching ignores formatting and compares digits only. Leave blank to disable. Used for this call only - not stored.',
  },
  {
    key: 'result_schema',
    label: 'Result Schema (JSON)',
    type: 'text',
    required: false,
    helpText:
      'Optional JSON Schema describing the structured result to extract. Supported: type, properties, required, enum, nested objects, array items, description, additionalProperties false. Not supported: $ref, oneOf, anyOf, allOf.',
  },
  {
    key: 'correlation_id',
    label: 'Correlation ID',
    type: 'string',
    required: false,
    helpText: 'Your own record ID. Echoed back on the result so you can write the outcome to the right row.',
  },
  {
    key: 'dry_run',
    label: 'Dry Run',
    type: 'boolean',
    required: false,
    default: 'false',
    helpText:
      'When true, returns a masked preview and places no call. Any unrecognized value is also treated as a dry run so no unintended call is placed.',
  },
];
