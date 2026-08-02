import { maskPhone } from './redact.js';

export const DEFAULT_BASE_URL = 'https://api.heycall-e.com';

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

export function checkForErrors(response) {
  if (response.status < 400) return response;

  let detail = '';
  try {
    const parsed = JSON.parse(response.content);
    detail = (parsed && parsed.error && parsed.error.message) || '';
  } catch {
    detail = '';
  }
  const safeDetail = maskPhone(detail);

  if (response.status === 401 || response.status === 403) {
    throw new Error(`CALL-E rejected the API key. Check the connection's API key. ${safeDetail}`);
  }
  if (response.status === 429) {
    throw new Error(`CALL-E rate limit reached. Retry later. ${safeDetail}`);
  }
  throw new Error(`CALL-E request failed with status ${response.status}. ${safeDetail}`);
}
