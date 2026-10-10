import { VendorProfile, BankModificationRequest, AirgapGateResult, CalleTaskDefinition } from './types';

/**
 * Compiles a structured task definition for CALL-E.
 * Follows strict prompt engineering guidelines for enterprise telephone agents.
 */
export function compileCalleTask(
  vendor: VendorProfile,
  request: BankModificationRequest,
  gateResult: AirgapGateResult
): CalleTaskDefinition {
  const newAccountLast4 = request.newAccountNumber.slice(-4);
  const invoiceListStr = request.associatedInvoiceNumbers.join(', ');
  const exposureStr = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(request.totalExposureAmountUsd);

  const taskPrompt = `You are an automated security agent calling on behalf of Enterprise Accounts Payable & Treasury.
You are placing an out-of-band security verification phone call to ${vendor.name} to verify a high-value bank wire account change.

Objective:
1. Ask politely to speak with ${vendor.authorizedOfficer.name}, ${vendor.authorizedOfficer.title} (or the designated Treasury Officer).
2. State the Security Verification Reference: "${gateResult.challengeToken}".
3. Security challenge: Ask the officer to state the last 4 digits of ${vendor.name}'s Federal Tax ID (EIN). (The correct last 4 digits are: ${vendor.taxEinLast4}).
4. Transaction query: State that a request was received to update wire details to ${request.newBankName}, account ending in ****${newAccountLast4}, affecting invoices ${invoiceListStr} for ${exposureStr}.
5. Ask directly: "Did your treasury department authorize this banking change, or is this unauthorized?"
6. Carefully listen to their verbal answer.
   - If they confirm it is authentic and valid: record CONFIRMED_VALID.
   - If they say they did NOT authorize it, or suspect fraud/phishing: record FRAUD_REJECTED.
   - If they do not know or cannot verify: record UNKNOWN_NO_RECORD.
   - If you reached a receptionist/voicemail or an IVR tree: record CALL_BACK_REQUESTED.
7. Thank them and close the call professionally. Never argue or disclose unnecessary internal system details.`;

  const resultSchema = {
    type: 'object',
    properties: {
      spoke_with_authorized_officer: {
        type: 'boolean',
        description: 'True if the callee confirmed they are the authorized financial/treasury officer.',
      },
      officer_name_stated: {
        type: 'string',
        description: 'Name of the person who answered or confirmed identity.',
      },
      officer_title_stated: {
        type: 'string',
        description: 'Title of the officer spoken with (e.g. CFO, Controller, VP Finance).',
      },
      ein_last4_matched: {
        type: 'boolean',
        description: `True only if the callee explicitly stated the correct Tax ID last 4 digits (${vendor.taxEinLast4}).`,
      },
      verbal_bank_change_status: {
        type: 'string',
        enum: ['CONFIRMED_VALID', 'FRAUD_REJECTED', 'UNKNOWN_NO_RECORD', 'CALL_BACK_REQUESTED'],
        description: 'The explicit status confirmed verbally by the treasury officer.',
      },
      challenge_token_acknowledged: {
        type: 'boolean',
        description: `True if the officer acknowledged reference token ${gateResult.challengeToken}.`,
      },
      direct_quote_reason: {
        type: 'string',
        description: 'Verbatim quote from the callee stating their confirmation, denial, or reason.',
      },
      confidence_score: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confidence in extraction accuracy (0.0 to 1.0).',
      },
    },
    required: [
      'spoke_with_authorized_officer',
      'ein_last4_matched',
      'verbal_bank_change_status',
      'direct_quote_reason',
      'confidence_score',
    ],
  };

  return {
    toPhoneNumber: gateResult.targetDialNumber,
    taskPrompt,
    challengeToken: gateResult.challengeToken,
    expectedEinLast4: vendor.taxEinLast4,
    invoiceNumbers: request.associatedInvoiceNumbers,
    exposureAmount: exposureStr,
    resultSchema,
  };
}
