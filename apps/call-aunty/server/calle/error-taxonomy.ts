export type ErrorCategory =
  | "configuration"
  | "authorization"
  | "provider"
  | "ai"
  | "schema"
  | "network"
  | "data"
  | "user_cancelled"
  | "policy";

export type UserFacingError = {
  category: ErrorCategory;
  code: string;
  userMessage: string;
  developerCode: string;
};

const MAP: Record<string, UserFacingError> = {
  unauthorized: {
    category: "authorization",
    code: "unauthorized",
    userMessage: "You are not allowed to access this call workflow.",
    developerCode: "unauthorized",
  },
  missing_consent: {
    category: "policy",
    code: "missing_consent",
    userMessage: "Call consent must be recorded before placing a call.",
    developerCode: "missing_consent",
  },
  urgent_state_conflict: {
    category: "policy",
    code: "urgent_state_conflict",
    userMessage: "Urgent care is indicated — keep human escalation primary.",
    developerCode: "urgent_state_conflict",
  },
  provider_unavailable: {
    category: "provider",
    code: "provider_unavailable",
    userMessage: "Phone provider is temporarily unavailable. Try again or use the dialer.",
    developerCode: "provider_unavailable",
  },
  calls_disabled: {
    category: "configuration",
    code: "calls_disabled",
    userMessage: "Outbound calling is disabled on the server.",
    developerCode: "calls_disabled",
  },
  cancelled: {
    category: "user_cancelled",
    code: "cancelled",
    userMessage: "This call was cancelled.",
    developerCode: "cancelled",
  },
  call_e_disabled: {
    category: "configuration",
    code: "call_e_disabled",
    userMessage: "Phone workflows are disabled on the server.",
    developerCode: "call_e_disabled",
  },
  insufficient_call_credits: {
    category: "policy",
    code: "insufficient_call_credits",
    userMessage: "No call credits remaining. Upgrade or add credits.",
    developerCode: "insufficient_call_credits",
  },
  upgrade_required: {
    category: "policy",
    code: "upgrade_required",
    userMessage: "Live calls require a paid plan.",
    developerCode: "upgrade_required",
  },
  monthly_call_limit: {
    category: "policy",
    code: "monthly_call_limit",
    userMessage: "Monthly live call allowance reached.",
    developerCode: "monthly_call_limit",
  },
  duplicate_in_flight: {
    category: "data",
    code: "duplicate_in_flight",
    userMessage: "A call is already in progress for this workflow.",
    developerCode: "duplicate_in_flight",
  },
  hero_demo_failed: {
    category: "data",
    code: "hero_demo_failed",
    userMessage: "Hero demo could not run. Try again.",
    developerCode: "hero_demo_failed",
  },
  demo_scenario_failed: {
    category: "data",
    code: "demo_scenario_failed",
    userMessage: "Demo scenario could not run.",
    developerCode: "demo_scenario_failed",
  },
  timeout: {
    category: "network",
    code: "timeout",
    userMessage: "The phone provider timed out. Try again or use the dialer.",
    developerCode: "timeout",
  },
  CALLE_TIMEOUT: {
    category: "network",
    code: "CALLE_TIMEOUT",
    userMessage: "The phone provider timed out. Try again or use the dialer.",
    developerCode: "CALLE_TIMEOUT",
  },
  CALLE_AUTH: {
    category: "provider",
    code: "CALLE_AUTH",
    userMessage: "Phone provider authentication failed. Use the dialer or try again later.",
    developerCode: "CALLE_AUTH",
  },
  CALLE_RATE_LIMIT: {
    category: "provider",
    code: "CALLE_RATE_LIMIT",
    userMessage: "The phone provider is busy. Wait a moment and try again.",
    developerCode: "CALLE_RATE_LIMIT",
  },
  CALLE_NETWORK: {
    category: "network",
    code: "CALLE_NETWORK",
    userMessage: "Could not reach the phone provider. Check the connection and try again.",
    developerCode: "CALLE_NETWORK",
  },
  CALLE_VALIDATION: {
    category: "schema",
    code: "CALLE_VALIDATION",
    userMessage: "This call request is not valid. Check the number and try again.",
    developerCode: "CALLE_VALIDATION",
  },
  retry_exhausted: {
    category: "provider",
    code: "retry_exhausted",
    userMessage: "The phone provider could not complete this call. Try again later or use the dialer.",
    developerCode: "retry_exhausted",
  },
  result_invalid: {
    category: "schema",
    code: "result_invalid",
    userMessage: "The call result could not be read. Try again or use the dialer.",
    developerCode: "result_invalid",
  },
  invalid_recipient: {
    category: "schema",
    code: "invalid_recipient",
    userMessage: "Enter a valid phone number in international format, for example +15551234567.",
    developerCode: "invalid_recipient",
  },
  call_failed: {
    category: "provider",
    code: "call_failed",
    userMessage: "The call could not be completed. Try again or use the dialer.",
    developerCode: "call_failed",
  },
  no_answer: {
    category: "data",
    code: "no_answer",
    userMessage: "No one answered. You can try again later.",
    developerCode: "no_answer",
  },
  internal_error: {
    category: "data",
    code: "internal_error",
    userMessage: "Something went wrong with the phone workflow. Please try again.",
    developerCode: "internal_error",
  },
};

export function mapErrorToUserMessage(code: string): UserFacingError {
  return (
    MAP[code] ?? {
      category: "data",
      code,
      userMessage: "Something went wrong with the phone workflow. Please try again.",
      developerCode: code,
    }
  );
}
