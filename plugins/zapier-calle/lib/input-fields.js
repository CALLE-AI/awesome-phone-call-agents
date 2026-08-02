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
