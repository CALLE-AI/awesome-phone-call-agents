/**
 * Turn a CALL-E API error code into human, actionable guidance. The codes are
 * the stable ones in `CalleErrorCode` (see calle/types.ts). Several of them mean
 * the account isn't ready for live outbound yet (identity verification / a
 * purchased number / balance) — for those we point the user at the dashboard so
 * the live path is reachable instead of a dead end.
 */

const DASHBOARD = 'https://dashboard.heycall-e.com'
const REGIONS_DOC = 'https://github.com/CALLE-AI/call-e-integrations#-supported-regions-and-languages'

export interface ErrorGuidance {
  hint: string
  action?: { label: string; href: string }
}

export function guidanceForError(code?: string | null): ErrorGuidance | null {
  switch (code) {
    case 'unauthorized':
      return {
        hint: 'Your CALL-E API key is missing or invalid. Add a valid key in Settings (or configure one on the server).',
        action: { label: 'Get an API key', href: `${DASHBOARD}/account/api-keys` },
      }
    case 'app_secret_required':
      return {
        hint: 'This deployment’s shared CALL-E key is access-controlled. Enter the access secret in Settings, or use your own key (BYOK).',
      }
    case 'forbidden':
    case 'policy_violation':
      return {
        hint: 'Your CALL-E account may need identity (KYC) verification before it can place outbound calls. Complete verification in the dashboard, then try again.',
        action: { label: 'Open CALL-E dashboard', href: DASHBOARD },
      }
    case 'insufficient_balance':
      return {
        hint: 'Your CALL-E balance is too low for this call. Top up, or check your remaining free-call allowance.',
        action: { label: 'Open CALL-E dashboard', href: DASHBOARD },
      }
    case 'unsupported_region':
      return {
        hint: 'CALL-E can’t place outbound calls to this region yet. Choose a recipient in a supported region.',
        action: { label: 'Supported regions', href: REGIONS_DOC },
      }
    case 'unsupported_language':
      return {
        hint: 'That language/locale isn’t supported for this region.',
        action: { label: 'Supported languages', href: REGIONS_DOC },
      }
    case 'invalid_phone':
    case 'invalid_recipient':
      return { hint: 'The phone number isn’t valid. Use full international (E.164) format, e.g. +1 415 555 0123.' }
    case 'recipient_blocked':
      return { hint: 'This number is blocked or not permitted for outbound calls.' }
    case 'no_recipients':
      return { hint: 'No valid recipient was provided for this call.' }
    case 'rate_limit_exceeded':
      return { hint: 'Too many calls in a short time. Wait a moment and try again.' }
    case 'provider_unavailable':
      return { hint: 'CALL-E’s calling provider is briefly unavailable. Try again shortly.' }
    case 'result_schema_invalid':
    case 'recipient_result_schema_invalid':
      return { hint: 'CALL-E rejected the structured-result schema. This is a Ringer bug — please report it.' }
    default:
      return null
  }
}
