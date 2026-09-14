/**
 * The wording a person reads, kept apart from the code a developer reads.
 *
 * Both layers are worth having and they are not the same text. `llm_not_configured`
 * is exactly right in a log and in a support conversation; it is useless to
 * somebody who wanted a plumber. The API sends both -- a stable machine code
 * and a human sentence -- and nothing in between leaks.
 *
 * Two things used to escape:
 *
 *   "Body is not valid JSON but content-type is set to 'application/json'"
 *   "request: Expected object, received string"
 *
 * The first is Fastify's, the second Zod's. Neither tells a user what to do,
 * and the second does not even name a field they could fix.
 */

/**
 * A field path Zod produced, said the way the form says it.
 *
 * Zod reports `policy.maxAuthorizedSpend`; a person filled in a box labelled
 * "Most Dial may commit you to". A perfect mapping is not the goal -- naming
 * the last segment in plain words gets someone to the right box.
 */
function fieldName(path: (string | number)[]): string | null {
  const last = path.filter((p) => typeof p === 'string').pop();
  if (!last || last === 'request' || last === 'body') return null;
  return String(last)
    // camelCase and snake_case both become spaced words.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

/**
 * Turns a validation failure into something worth showing.
 *
 * Falls back to a sentence that names no field rather than repeating a
 * library's internal phrasing, because "Expected object, received string"
 * describes the request body, which the user never typed.
 */
export function describeValidationIssue(error: {
  issues: Array<{ path: (string | number)[]; message: string; code?: string }>;
}): string {
  const issue = error.issues[0];
  if (!issue) return 'Some of those details were not valid. Please check them and try again.';

  const field = fieldName(issue.path);
  if (!field) return 'Some of those details were not valid. Please check them and try again.';

  const raw = issue.message.toLowerCase();

  if (raw.includes('required') || raw.includes('expected') || raw.includes('received undefined')) {
    return `Please fill in the ${field}.`;
  }
  if (raw.includes('at least')) return `The ${field} is too short.`;
  if (raw.includes('at most') || raw.includes('too big') || raw.includes('less than')) {
    return `The ${field} is too long.`;
  }
  if (raw.includes('email')) return 'That email address does not look right.';
  if (raw.includes('url')) return `The ${field} does not look like a valid address.`;
  if (raw.includes('datetime') || raw.includes('date')) {
    return `The ${field} is not a date Dial can read.`;
  }

  return `The ${field} is not valid.`;
}

/**
 * The sentence for a failure that reached the error handler rather than a
 * route -- a malformed body, an unsupported content type, a bug.
 *
 * These never carry the framework's own words. What the framework said is
 * logged; what the user reads is what they can act on.
 */
export function describeRequestFailure(status: number): string {
  if (status === 413) return 'That was too large for Dial to accept.';
  if (status === 415) return 'Dial could not read that request.';
  if (status === 429) return 'That is a lot of requests at once. Please wait a moment and try again.';
  if (status >= 500) return 'Something went wrong on Dial’s side.';
  return 'Dial could not read that request. Please try again.';
}
