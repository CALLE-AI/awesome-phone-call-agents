const STRUCTURED_PAYLOAD_FIELDS = Object.freeze([
  'ready_to_run',
  'plan_id',
  'confirm_token',
  'clarifying_questions',
  'next_step',
]);

const STRUCTURED_PAYLOAD_FIELD_SET = new Set(STRUCTURED_PAYLOAD_FIELDS);
const MCP_TOOL_RESULT_FIELDS = Object.freeze(['structuredContent', 'structured_content', 'content']);
const SAFE_FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/u;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const URL = /(?:\bhttps?:\/\/|\bwww\.)\S+/iu;
const PHONE = /(?:^|\D)(\+?[1-9][0-9 .()-]{7,18}[0-9])(?=\D|$)/gu;
const LOCAL_PHONE = /\b0[1-9](?:[ .-]?\d{2}){4}\b/u;
const SECRET = /\b(?:bearer\s+\S+|(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S+)/iu;
const OPAQUE_IDENTIFIER =
  /\b(?:plan|run|session|token|code|mcp)[_-][A-Za-z0-9_-]{8,}\b|\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9_-]{40,}\b/u;
const OPAQUE_ASSIGNMENT =
  /\b(?:plan(?:_id)?|run(?:_id)?|session(?:_id)?|confirm(?:_token)?|token|code|mcp)\s*(?:=|:)\s*["']?[A-Za-z0-9_-]{4,}/iu;
const REMOTE_TOOL_DIRECTIVE =
  /\b(?:call|invoke|execute|run)\s+`?(?:plan_call|run_call|get_call_run|track_ui_events)`?\b/iu;
const SENSITIVE_FIELD_NAME =
  /(?:account|address|authorization|cookie|customer|email|identity|password|person|phone|secret|session|token)/iu;

function recordOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function hasOwn(record, key) {
  return record !== null && Object.hasOwn(record, key);
}

function jsonValueType(value) {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'object';
}

function fieldType(record, key) {
  return hasOwn(record, key) ? jsonValueType(record[key]) : 'absent';
}

function nonEmptyString(record, key) {
  return hasOwn(record, key) && typeof record[key] === 'string' && record[key].trim().length > 0;
}

function containsPhone(value) {
  for (const match of value.matchAll(PHONE)) {
    const candidate = match[1];
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) return true;
    const start = match.index + match[0].length - candidate.length;
    const before = value.slice(0, start);
    const after = value.slice(start + candidate.length);
    // Only an isolated calendar date is exempt. Never split a numeric contact
    // or identifier into an apparently harmless date plus another fragment.
    if (/[\p{L}\p{N}_+/-]$/u.test(before) || /^[\p{L}\p{N}_+/-]/u.test(after)
      || /\d\.$/u.test(before) || /^\.\d/u.test(after)
      || /\b(?:phone|telephone|tel|mobile|contact number)\s*(?:number\s*)?(?:is|[:=])?\s*$/iu.test(before)) return true;
    const date = new Date(`${candidate}T12:00:00.000Z`);
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== candidate) return true;
  }
  return false;
}

export function sanitizeCallePlanText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0 || normalized.length > 320) return null;
  if (
    EMAIL.test(normalized) ||
    URL.test(normalized) ||
    containsPhone(normalized) ||
    LOCAL_PHONE.test(normalized) ||
    SECRET.test(normalized) ||
    OPAQUE_IDENTIFIER.test(normalized) ||
    OPAQUE_ASSIGNMENT.test(normalized) ||
    REMOTE_TOOL_DIRECTIVE.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function textFieldObservation(payload, key, allowStringArray) {
  const present = hasOwn(payload, key);
  const type = fieldType(payload, key);
  if (!present) return { present: false, type: 'absent' };

  const value = payload[key];
  let sanitizedText = null;
  if (typeof value === 'string') {
    sanitizedText = sanitizeCallePlanText(value);
  } else if (allowStringArray && Array.isArray(value) && value.length > 0) {
    const allStrings = value.every((item) => typeof item === 'string');
    if (allStrings) {
      const sanitized = value.map((item) => sanitizeCallePlanText(item));
      if (sanitized.every((item) => item !== null)) sanitizedText = sanitized[0];
    }
  }

  return sanitizedText === null ? { present, type } : { present, type, sanitizedText };
}

function safeUnexpectedFieldName(name) {
  if (!SAFE_FIELD_NAME.test(name) || SENSITIVE_FIELD_NAME.test(name) || OPAQUE_IDENTIFIER.test(name)) {
    return '[redacted-field-name]';
  }
  return name;
}

function toolResultEnvelopePresent(root) {
  return MCP_TOOL_RESULT_FIELDS.some((field) => hasOwn(root, field));
}

function locateToolResult(response) {
  const root = recordOf(response);
  if (root === null) {
    return { toolResult: null, pathPrefix: null, reason: 'STRUCTURED_PAYLOAD_MISSING' };
  }

  const directPresent = toolResultEnvelopePresent(root);
  const wrapperPresent = hasOwn(root, 'result');
  if (directPresent && wrapperPresent) {
    return { toolResult: null, pathPrefix: null, reason: 'STRUCTURED_PAYLOAD_AMBIGUOUS' };
  }
  if (directPresent) return { toolResult: root, pathPrefix: 'result', reason: null };
  if (!wrapperPresent) {
    return { toolResult: null, pathPrefix: null, reason: 'STRUCTURED_PAYLOAD_MISSING' };
  }

  const toolResult = recordOf(root.result);
  if (toolResult === null || (hasOwn(root, 'ok') && root.ok !== true)) {
    return { toolResult: null, pathPrefix: null, reason: 'STRUCTURED_PAYLOAD_INVALID' };
  }
  return { toolResult, pathPrefix: 'cli.result', reason: null };
}

function contentFallbackPayload(toolResult, pathPrefix) {
  const content = toolResult.content;
  if (!Array.isArray(content) || content.length === 0) {
    return { payload: null, path: null, reason: 'STRUCTURED_PAYLOAD_INVALID' };
  }

  const candidates = [];
  for (const [index, item] of content.entries()) {
    const block = recordOf(item);
    if (block === null || block.type !== 'text' || typeof block.text !== 'string') continue;

    let parsed;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      continue;
    }
    const payload = recordOf(parsed);
    if (payload !== null) candidates.push({ payload, index });
  }

  if (candidates.length === 0) {
    return { payload: null, path: null, reason: 'STRUCTURED_PAYLOAD_INVALID' };
  }
  if (candidates.length !== 1) {
    return { payload: null, path: null, reason: 'STRUCTURED_PAYLOAD_AMBIGUOUS' };
  }
  const [candidate] = candidates;
  return {
    payload: candidate.payload,
    path: `${pathPrefix}.content[${candidate.index}].text`,
    reason: null,
  };
}

function locateStructuredPayload(response) {
  const located = locateToolResult(response);
  if (located.toolResult === null || located.pathPrefix === null) {
    return { payload: null, path: null, reason: located.reason };
  }

  const toolResult = located.toolResult;
  if (hasOwn(toolResult, 'isError') && toolResult.isError !== false) {
    return { payload: null, path: null, reason: 'STRUCTURED_PAYLOAD_INVALID' };
  }

  const camelPresent = hasOwn(toolResult, 'structuredContent');
  const snakePresent = hasOwn(toolResult, 'structured_content');
  if (camelPresent && snakePresent) {
    return { payload: null, path: null, reason: 'STRUCTURED_PAYLOAD_AMBIGUOUS' };
  }

  if (camelPresent || snakePresent) {
    const field = camelPresent ? 'structuredContent' : 'structured_content';
    const payload = recordOf(toolResult[field]);
    if (payload === null) {
      return { payload: null, path: null, reason: 'STRUCTURED_PAYLOAD_INVALID' };
    }
    return { payload, path: `${located.pathPrefix}.${field}`, reason: null };
  }

  if (!hasOwn(toolResult, 'content')) {
    return { payload: null, path: null, reason: 'STRUCTURED_PAYLOAD_MISSING' };
  }
  return contentFallbackPayload(toolResult, located.pathPrefix);
}

export function emptyCallePlanObservation() {
  return {
    structuredPayloadPath: null,
    readyToRun: { present: false, type: 'absent', value: null },
    planId: { present: false, type: 'absent', nonEmptyString: false },
    confirmToken: { present: false, type: 'absent', nonEmptyString: false },
    clarification: { present: false, type: 'absent' },
    nextStep: { present: false, type: 'absent' },
    missingInformationPresent: false,
    unexpectedFields: [],
  };
}

function observePayload(payload, path) {
  const readyType = fieldType(payload, 'ready_to_run');
  const readyValue = readyType === 'boolean' ? payload.ready_to_run : null;
  const clarification = textFieldObservation(payload, 'clarifying_questions', true);
  const nextStep = textFieldObservation(payload, 'next_step', false);
  const clarificationValue = payload.clarifying_questions;
  const missingInformationPresent =
    (typeof clarificationValue === 'string' && clarificationValue.trim().length > 0) ||
    (Array.isArray(clarificationValue) && clarificationValue.length > 0) ||
    (typeof payload.next_step === 'string' && payload.next_step.trim().length > 0);
  const unexpectedFields = [
    ...new Set(
      Object.keys(payload)
        .filter((field) => !STRUCTURED_PAYLOAD_FIELD_SET.has(field))
        .map((field) => safeUnexpectedFieldName(field)),
    ),
  ].sort();

  return {
    structuredPayloadPath: path,
    readyToRun: {
      present: hasOwn(payload, 'ready_to_run'),
      type: readyType,
      value: readyValue,
    },
    planId: {
      present: hasOwn(payload, 'plan_id'),
      type: fieldType(payload, 'plan_id'),
      nonEmptyString: nonEmptyString(payload, 'plan_id'),
    },
    confirmToken: {
      present: hasOwn(payload, 'confirm_token'),
      type: fieldType(payload, 'confirm_token'),
      nonEmptyString: nonEmptyString(payload, 'confirm_token'),
    },
    clarification,
    nextStep,
    missingInformationPresent,
    unexpectedFields,
  };
}

export function classifyCallePlanResponse(response) {
  const located = locateStructuredPayload(response);
  if (located.payload === null || located.path === null) {
    return {
      kind: 'INDETERMINATE',
      observation: emptyCallePlanObservation(),
      reason: located.reason,
    };
  }

  const observation = observePayload(located.payload, located.path);
  if (!observation.readyToRun.present) {
    return { kind: 'INDETERMINATE', observation, reason: 'READY_TO_RUN_ABSENT' };
  }
  if (observation.readyToRun.type !== 'boolean') {
    return { kind: 'INDETERMINATE', observation, reason: 'READY_TO_RUN_NOT_BOOLEAN' };
  }
  if (observation.readyToRun.value === false) {
    return {
      kind: 'NEEDS_DETAILS',
      observation,
      clarification: observation.clarification.sanitizedText ?? null,
    };
  }
  if (!observation.planId.nonEmptyString) {
    return { kind: 'SCHEMA_DRIFT', observation, reason: 'READY_PLAN_ID_NOT_NON_EMPTY_STRING' };
  }
  if (!observation.confirmToken.nonEmptyString) {
    return {
      kind: 'SCHEMA_DRIFT',
      observation,
      reason: 'READY_CONFIRM_TOKEN_NOT_NON_EMPTY_STRING',
    };
  }
  return { kind: 'READY_TO_RUN', observation, opaqueCapabilityHeldOnlyInMemory: true };
}

export function destroyCallePlanOpaqueValues(response) {
  const root = recordOf(response);
  if (root === null) return true;

  let cleared = true;
  const clearProperty = (record, key) => {
    try {
      if (Reflect.deleteProperty(record, key)) return true;
    } catch {
      // Fall through to replacing the value without coercing it.
    }
    try {
      return Reflect.set(record, key, null);
    } catch {
      return false;
    }
  };
  const clearToolResult = (record) => {
    for (const key of ['plan_id', 'confirm_token']) {
      if (!hasOwn(record, key)) continue;
      if (!clearProperty(record, key)) cleared = false;
    }
    for (const field of ['structuredContent', 'structured_content']) {
      if (!hasOwn(record, field)) continue;
      const payload = recordOf(record[field]);
      if (payload === null) {
        if (!clearProperty(record, field)) cleared = false;
      } else {
        for (const key of ['plan_id', 'confirm_token']) {
          if (hasOwn(payload, key) && !clearProperty(payload, key)) cleared = false;
        }
      }
    }
    if (hasOwn(record, 'content') && !clearProperty(record, 'content')) cleared = false;
  };

  clearToolResult(root);
  if (hasOwn(root, 'result')) {
    const wrapperResult = recordOf(root.result);
    if (wrapperResult === null) {
      if (!clearProperty(root, 'result')) cleared = false;
    } else {
      clearToolResult(wrapperResult);
    }
  }
  return cleared;
}
