const UNSUPPORTED_KEYWORDS = ['$ref', 'oneOf', 'anyOf', 'allOf'];

const walk = (node, path, errors) => {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${path}[${index}]`, errors));
    return;
  }
  if (!node || typeof node !== 'object') return;

  for (const keyword of UNSUPPORTED_KEYWORDS) {
    if (Object.prototype.hasOwnProperty.call(node, keyword)) {
      errors.push(`CALL-E does not support "${keyword}" in result schemas (at ${path}).`);
    }
  }
  if (node.additionalProperties === true) {
    errors.push(`CALL-E does not support "additionalProperties: true" (at ${path}).`);
  }
  for (const [key, value] of Object.entries(node)) {
    walk(value, `${path}.${key}`, errors);
  }
};

export function parseResultSchema(raw) {
  if (raw === null || raw === undefined) return { schema: null, errors: [] };

  let candidate = raw;
  if (typeof raw === 'string') {
    if (raw.trim() === '') return { schema: null, errors: [] };
    try {
      candidate = JSON.parse(raw);
    } catch {
      return { schema: null, errors: ['Result schema must be valid JSON.'] };
    }
  }

  const errors = [];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    errors.push('Result schema root must be a JSON object.');
    return { schema: null, errors };
  }
  if (candidate.type !== 'object') {
    errors.push('Result schema root must declare "type": "object".');
  }
  walk(candidate, 'schema', errors);

  return { schema: errors.length ? null : candidate, errors };
}
