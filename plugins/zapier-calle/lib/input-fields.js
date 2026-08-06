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
    key: 'previous_attempts',
    label: 'Previous Attempt Times',
    type: 'text',
    required: false,
    helpText:
      'Paste or map the ISO 8601 timestamps of earlier call attempts to this number, separated by commas or newlines (for example 2026-08-05T14:30:00Z). Supplying them enables retry-policy enforcement: the call is refused if it would exceed the limits below. This integration has no storage, so the history must come from your own record. Leave blank to disable.',
  },
  {
    key: 'retry_max_attempts_per_day',
    label: 'Max Attempts Per Day',
    type: 'integer',
    required: false,
    default: '2',
    helpText:
      'Refuses to dial once this many attempts have already been made in the previous 24 hours. Only applies when Previous Attempt Times is set.',
  },
  {
    key: 'retry_min_hours_between_attempts',
    label: 'Minimum Hours Between Attempts',
    type: 'integer',
    required: false,
    default: '4',
    helpText:
      'Refuses to dial if the most recent attempt was more recently than this. Only applies when Previous Attempt Times is set.',
  },
  {
    key: 'min_confidence_score',
    label: 'Minimum Confidence Score',
    type: 'string',
    required: false,
    default: '0.6',
    helpText:
      "CALL-E returns both a confidence label and a 0-1 score. A result is only marked confirmed when the score is at least this value, so a 'high' label carrying a low score is sent to review instead. Set to 0 to accept the label alone. Anything unparseable falls back to 0.6 rather than disabling the check.",
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
    default: 'true',
    helpText:
      'Starts on, so a newly built Zap previews instead of calling anyone. When on, returns a masked preview and places no call. Turn it off deliberately, once, when you are ready to dial for real - a blank or unrecognized value is treated as a dry run, so a call is only ever placed by an explicit choice.',
  },
];
