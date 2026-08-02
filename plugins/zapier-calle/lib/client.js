import { maskPhone } from './redact.js';

export const DEFAULT_BASE_URL = 'https://api.heycall-e.com';

// Test-only affordance: lets tests point requests at a local server. Must never be added to
// authentication.fields - exposing it would let a user redirect calls to an arbitrary host.
export function baseUrl(bundle) {
  const override = bundle && bundle.authData && bundle.authData.baseUrl;
  return override || DEFAULT_BASE_URL;
}

export function addBearerHeader(request, z, bundle) {
  const apiKey = bundle && bundle.authData && bundle.authData.apiKey;
  if (apiKey) {
    request.headers = request.headers || {};
    request.headers.Authorization = `Bearer ${apiKey}`;
  }
  return request;
}

// Cap on the combined clarification-question text assembled below, so a pathological upstream
// payload cannot grow the thrown error message unbounded.
const MAX_QUESTIONS_LENGTH = 500;

export function checkForErrors(response, z, bundle) {
  if (response.status < 400) return response;

  let parsed = null;
  let detail = '';
  try {
    parsed = JSON.parse(response.content);
    detail = (parsed && parsed.error && parsed.error.message) || '';
  } catch {
    detail = '';
  }

  const apiKey = bundle && bundle.authData && bundle.authData.apiKey;
  if (apiKey) {
    detail = detail.split(apiKey).join('[redacted]');
  }

  const safeDetail = maskPhone(detail);

  if (response.status === 422 && parsed && parsed.error && parsed.error.code === 'call_not_ready') {
    const questions = parsed.error.details && Array.isArray(parsed.error.details.questions)
      ? parsed.error.details.questions
      : null;
    let questionText = questions && questions.length > 0 ? questions.join(' ') : detail;
    if (apiKey) {
      questionText = questionText.split(apiKey).join('[redacted]');
    }
    questionText = maskPhone(questionText);
    if (questionText.length > MAX_QUESTIONS_LENGTH) {
      questionText = `${questionText.slice(0, MAX_QUESTIONS_LENGTH)}...`;
    }
    throw new Error(
      `CALL-E needs more information before it will place this call (clarification requested): ${questionText} ` +
      'Answer the question directly in the Call Task text, and set the Region and Locale input fields ' +
      'explicitly - this integration never infers them from the phone number.'
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(`CALL-E rejected the API key. Check the connection's API key. ${safeDetail}`);
  }
  if (response.status === 429) {
    throw new Error(`CALL-E rate limit reached. Retry later. ${safeDetail}`);
  }
  throw new Error(`CALL-E request failed with status ${response.status}. ${safeDetail}`);
}
