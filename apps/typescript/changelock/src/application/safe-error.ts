const FALLBACK = "The action failed safely.";

const SAFE_PATTERNS: RegExp[] = [
  /^typed phrase must be exactly "VERIFY CL-[0-9A-F]{6}"$/,
  /^preview missing or expired/,
  /^preview is stale/,
  /^authorization expired/,
  /^an intent is already active/,
  /^case not found$/,
  /^intent not found$/,
  /^cannot preview in state [a-z_]+$/,
  /^cannot authorize in state [a-z_]+$/,
  /^case is [a-z_]+; cannot dispatch$/,
  /^cannot record outcome in state [a-z_]+$/,
  /^intent is (dispatched|expired); refusing to dispatch again$/,
  /^intent has no bound call to refresh$/,
  /^no trusted contact on vendor record$/,
  /^unknown replay scenario$/,
  /^live dispatch refused: server is not in live mode$/,
  /^live mode is not enabled on this server$/,
  /^live policy: [a-z. ]+$/,
  /^cannot reconcile in state [a-z_]+$/,
  /^intent is not awaiting reconciliation$/,
  /^cannot escalate in state [a-z_]+$/,
  /^cannot reset in state [a-z_]+$/,
  /^only seeded synthetic cases can be reset$/,
  /^synthetic case reset is not available in live mode$/,
  /^intent does not belong to this case$/,
  /^Unexpected form fields were rejected\.$/,
  /^(intent id|call id|typed phrase) is required$/,
  /^consenting-contact attestation is required$/,
  /^unknown or inactive vendor code$/,
];

export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error && SAFE_PATTERNS.some((p) => p.test(err.message))) {
    return err.message;
  }
  return FALLBACK;
}
