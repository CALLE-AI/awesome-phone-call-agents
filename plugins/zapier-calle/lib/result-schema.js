const SUPPORTED_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'enum',
  'items',
  'description',
  'additionalProperties',
]);

const MAX_DEPTH = 20;

const walk = (node, path, errors, depth) => {
  if (depth > MAX_DEPTH) {
    errors.push(`Result schema exceeds the maximum nesting depth of ${MAX_DEPTH} (at ${path}).`);
    return;
  }
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    errors.push(`Result schema node must be a JSON object (at ${path}).`);
    return;
  }

  for (const key of Object.keys(node)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      errors.push(`CALL-E does not support "${key}" in result schemas (at ${path}).`);
    }
  }

  if ('properties' in node) {
    if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
      errors.push(`Result schema "properties" must be an object (at ${path}).`);
    } else {
      for (const [fieldName, fieldSchema] of Object.entries(node.properties)) {
        walk(fieldSchema, `${path}.properties.${fieldName}`, errors, depth + 1);
      }
    }
  }

  if ('items' in node) {
    walk(node.items, `${path}.items`, errors, depth + 1);
  }

  if ('required' in node) {
    const req = node.required;
    if (!Array.isArray(req) || !req.every((entry) => typeof entry === 'string')) {
      errors.push(`Result schema "required" must be an array of strings (at ${path}).`);
    }
  }

  if ('enum' in node) {
    if (!Array.isArray(node.enum)) {
      errors.push(`Result schema "enum" must be an array (at ${path}).`);
    }
  }

  if ('description' in node) {
    if (typeof node.description !== 'string') {
      errors.push(`Result schema "description" must be a string (at ${path}).`);
    }
  }

  if ('additionalProperties' in node) {
    if (node.additionalProperties !== false) {
      errors.push(`CALL-E requires "additionalProperties: false" in result schemas (at ${path}).`);
    }
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
  walk(candidate, 'schema', errors, 0);

  return { schema: errors.length ? null : candidate, errors };
}
