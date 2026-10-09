import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, generateText, tool, convertToModelMessages, stepCountIs } from 'ai';
import type { UIMessage } from 'ai';
import { z } from 'zod';
import { verifyGSTIN } from '@/lib/gstin';
import { type CalleCallParams, type CalleResult } from '@/lib/calle';
import { verifyCACCompany } from '@/lib/cac';
import { verifyUKCompany } from '@/lib/companieshouse';
import { verifyChinaCompany } from '@/lib/china';
import { verifyUSCompany } from '@/lib/us';

export const maxDuration = 120;

// ---------------------------------------------------------------------------
// LLM key rotation
// ---------------------------------------------------------------------------

function getRandomGoogleAI() {
  const keysString = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY;

  if (!keysString) {
    throw new Error(
      'GEMINI_API_KEY (or GEMINI_API_KEYS) is not set. Add it to .env.local at your project root ' +
      '(same folder as package.json), then fully restart `next dev` — Next only reads env ' +
      'files at boot. If this is running on a deployed environment (Vercel, etc.), add the ' +
      'same variable in that platform\'s project settings and redeploy. You can provide multiple keys separated by commas.'
    );
  }

  const apiKeys = keysString.split(',').map(key => key.trim()).filter(Boolean);
  const randomKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
  return createGoogleGenerativeAI({ apiKey: randomKey });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * E.164 phone number validation regex.
 * Requires a leading '+', a non-zero country code digit, then 6–14 digits total.
 */
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/** Returns true if `phone` is a well-formed E.164 number. */
function isValidE164(phone: string): boolean {
  return E164_REGEX.test(phone);
}

// ---------------------------------------------------------------------------
// Simulated (preview) call helper
// ---------------------------------------------------------------------------

/**
 * Shared simulated-call helper. Returns a synthetic CalleResult with an
 * AI-generated transcript. 
 *
 * IMPORTANT: Results produced by this function are SYNTHETIC / ADVISORY only.
 * They must never be presented to users as verified live evidence.
 */
async function simulateCall(
  params: CalleCallParams & { contactName?: string },
  countryContext: string,
  googleAI: ReturnType<typeof createGoogleGenerativeAI>
): Promise<CalleResult> {
  await new Promise(r => setTimeout(r, 1500)); // simulate call latency

  const { text: simulatedTranscript } = await generateText({
    model: googleAI('gemini-2.5-flash'),
    prompt:
      `Simulate a realistic phone call transcript between an AI verification agent (Agent) and a supplier (Supplier). ` +
      `The agent is calling on behalf of a buyer to verify the supplier's details. ` +
      `Country context: ${countryContext}\n` +
      `Company: ${params.companyName}\n` +
      `Contact Person: ${params.contactName || 'A representative'}\n` +
      `Product: ${params.productCategory}\n` +
      `Claimed terms: ${params.claimedTerms}\n` +
      `Language: ${params.language || 'English'}\n\n` +
      `Make the conversation sound natural, professional, and typical of a business verification call. ` +
      `The supplier should confirm the business name, product availability, and terms. ` +
      `Format as markdown with **Agent:** and **Supplier:** prefixes. Do not include any other text besides the transcript.`,
  });

  return {
    reached_business: 'yes',
    confirmed_business_name: params.companyName,
    product_match: 'matches',
    stated_price_or_terms: params.claimedTerms,
    advance_payment_requested: '30% upfront, 70% on dispatch',
    red_flags: ['[PREVIEW — not a real call. This is an AI-simulated result for demonstration only. Treat all data as synthetic and advisory.]'],
    verdict: 'verified_reachable',
    transcript: simulatedTranscript,
    confidence: 40,
    confidenceNote: 'advisory_estimate',
  };
}

// ---------------------------------------------------------------------------
// Reconciliation-blocked response helper
// ---------------------------------------------------------------------------

/**
 * Returns a structured error result indicating that a previous call produced
 * an ambiguous outcome and must be reconciled by the user before any further
 * call tools can run.
 */
function reconciliationBlockedResult(): CalleResult {
  return {
    reached_business: 'unclear',
    verdict: 'could_not_verify',
    confidence: 0,
    confidenceNote: 'advisory_estimate',
    requiresReconciliation: true,
    error: true,
    red_flags: [
      '[BLOCKED] A previous call returned an ambiguous outcome. ' +
      'Please review the result above and clarify your intent before attempting another call.',
    ],
  };
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const googleAI = getRandomGoogleAI();

  /**
   * Code-level reconciliation gate.
   */
  let pendingReconciliation = false;

  function checkReconciliation(result: CalleResult): CalleResult {
    if (result.reached_business === 'unclear' || result.requiresReconciliation) {
      pendingReconciliation = true;
    }
    return result;
  }

  const result = streamText({
    model: googleAI('gemini-2.5-flash'),
    system: `You are an AI Copilot for TradeCheck, an AI-powered trade partner verification tool.
Your job is to gather information about a trade deal and run the appropriate checks.

IMPORTANT — CALL TOOL BEHAVIOUR:
- All "call" tools run in PREVIEW (simulated) mode. Results labelled "[PREVIEW — not a real call]" are AI-generated simulations and are SYNTHETIC/ADVISORY — they are NOT live verified evidence and must be presented to the user as such.

IMPORTANT — AMBIGUOUS OUTCOMES (requiresReconciliation):
- If any call tool returns "requiresReconciliation: true" or "blocked: 'awaiting_reconciliation'", you MUST stop immediately, present the ambiguous outcome to the user, and ask them to clarify their intent BEFORE calling any call tool again. The system enforces this at the code level — attempting to redial will return a blocked error.

CONFIDENCE VALUES:
- Confidence scores in results are ADVISORY ESTIMATES only (confidenceNote: "advisory_estimate"). They are heuristic values derived from call outcome fields — they are not live-verified metrics and do not guarantee the legitimacy or financial health of a supplier.

REGISTRY DATA DISCLAIMER:
- Documentary checks (GSTIN, CAC, Companies House, USCC, SEC EDGAR) return publicly registered data. This confirms legal registration status at the time of the API query — it does not confirm current trading legitimacy or financial health.
- The CAC lookup uses public registry data via third-party aggregators; results should be treated as indicative.
- The China USCC lookup uses a third-party data aggregator (not a direct government API); treat results as indicative only.

WORKFLOW FOR INDIA SUPPLIER (full check):
1. Gather ALL of the following before starting any verification: business name, GSTIN, phone number (with +91 country code), product category, quoted deal terms, preferred call language (default: English/Hindi), and the name of the contact person (optional).
2. Call \`verifySupplier\` with the GSTIN for the documentary check.
3. After the documentary result comes back, call \`callSupplier\` with all details.
4. Summarise the outcome. If the call result is a PREVIEW (simulated), label it clearly as synthetic/advisory.

WORKFLOW FOR NIGERIA SUPPLIER (full check):
1. Gather ALL of the following before starting any verification: business name or RC number, phone number (with +234 country code), product category, quoted deal terms, preferred call language (default: English), and the name of the contact person (optional).
2. Call \`verifyNigeriaSupplier\` with the company name or RC number for the CAC documentary check.
3. After the CAC result comes back, call \`callNigeriaSupplier\` with all details.
4. Summarise the outcome. If the call result is a PREVIEW (simulated), label it clearly as synthetic/advisory.

WORKFLOW FOR UK SUPPLIER (full check):
1. Gather ALL of the following before starting any verification: company name or Companies House number, phone number (with +44 country code), product category, quoted deal terms, and the name of the contact person (optional).
2. Call \`verifyUKSupplier\` with the company name or number for the Companies House documentary check.
3. After the Companies House result comes back, call \`callUKSupplier\` with all details.
4. Summarise the outcome. If the call result is a PREVIEW (simulated), label it clearly as synthetic/advisory.

WORKFLOW FOR CHINA SUPPLIER (full check):
1. Gather ALL of the following before starting any verification: company name or USCC (Unified Social Credit Code), phone number (with +86 country code), product category, quoted deal terms, preferred call language (default: Mandarin/English), and the name of the contact person (optional).
2. Call \`verifyChinaSupplier\` with the company name or USCC for the documentary check.
3. After the documentary check result comes back, call \`callChinaSupplier\` with all details.
4. Summarise the outcome. If the call result is a PREVIEW (simulated), label it clearly as synthetic/advisory.

WORKFLOW FOR US SUPPLIER (full check):
1. Gather ALL of the following before starting any verification: company name or EIN (Employer Identification Number), phone number (with +1 country code), product category, quoted deal terms, and the name of the contact person (optional).
2. Call \`verifyUSSupplier\` with the company name or EIN for the documentary check.
3. After the documentary check result comes back, call \`callUSSupplier\` with all details.
4. Summarise the outcome. If the call result is a PREVIEW (simulated), label it clearly as synthetic/advisory.

Gather all necessary information upfront before calling any verification tools to aid user experience. Ask 1–2 questions at a time. Be concise, professional, and friendly. Determine which path to take based on what the user tells you.`,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    tools: {
      // ── India path ────────────────────────────────────────────────
      verifySupplier: tool({
        description: 'Perform a GSTIN documentary check for an Indian supplier. Run this first, before the call.',
        inputSchema: z.object({
          gstin: z.string().describe('The GSTIN number of the Indian supplier'),
        }),
        execute: async ({ gstin }) => {
          return await verifyGSTIN(gstin);
        },
      }),

      callSupplier: tool({
        description: 'Place a verification call to an Indian supplier. Only call this AFTER verifySupplier has returned a result. Runs as a PREVIEW simulation.',
        inputSchema: z.object({
          phoneNumber: z.string().describe('Supplier phone number in E.164 format, e.g. +919876543210'),
          companyName: z.string().describe('Name of the supplier company'),
          productCategory: z.string().describe('Product or service category being sourced'),
          claimedTerms: z.string().describe('The deal terms the listing claimed (price, MOQ, payment terms)'),
          language: z.string().optional().describe('Language to conduct the call in, e.g. English, Hindi'),
          contactName: z.string().optional().describe('Name of the person to contact, if provided'),
        }),
        execute: async (params) => {
          if (pendingReconciliation) return reconciliationBlockedResult();
          if (!isValidE164(params.phoneNumber)) {
            return { error: true, message: 'Phone number must be in E.164 format (e.g. +919876543210).' };
          }
          return checkReconciliation(await simulateCall({ ...params, region: 'IN' }, 'India', googleAI));
        },
      }),

      // ── Nigeria path ──────────────────────────────────────────────
      verifyNigeriaSupplier: tool({
        description: 'Perform a CAC documentary check for a Nigerian supplier by company name or RC number. Run this first, before the call.',
        inputSchema: z.object({
          query: z.string().describe('Company name or RC number of the Nigerian supplier'),
        }),
        execute: async ({ query }) => {
          return await verifyCACCompany(query);
        },
      }),

      callNigeriaSupplier: tool({
        description: 'Place a verification call to a Nigerian supplier. Only call this AFTER verifyNigeriaSupplier has returned a result. Runs as a PREVIEW simulation.',
        inputSchema: z.object({
          phoneNumber: z.string().describe('Supplier phone number in E.164 format, e.g. +2348012345678'),
          companyName: z.string().describe('Name of the Nigerian supplier company'),
          productCategory: z.string().describe('Product or service category being sourced'),
          claimedTerms: z.string().describe('The deal terms the listing claimed (price, MOQ, payment terms)'),
          language: z.string().optional().describe('Language to conduct the call in, e.g. English'),
          contactName: z.string().optional().describe('Name of the person to contact, if provided'),
        }),
        execute: async (params) => {
          if (pendingReconciliation) return reconciliationBlockedResult();
          if (!isValidE164(params.phoneNumber)) {
            return { error: true, message: 'Phone number must be in E.164 format (e.g. +2348012345678).' };
          }
          return checkReconciliation(await simulateCall({ ...params, region: 'INTERNATIONAL' }, 'Nigeria', googleAI));
        },
      }),

      // ── UK path ───────────────────────────────────────────────────
      verifyUKSupplier: tool({
        description: 'Perform a Companies House documentary check for a UK supplier by company name or Companies House number. Run this first, before the call.',
        inputSchema: z.object({
          query: z.string().describe('Company name or Companies House number of the UK supplier'),
        }),
        execute: async ({ query }) => {
          return await verifyUKCompany(query);
        },
      }),

      callUKSupplier: tool({
        description: 'Place a verification call to a UK supplier. Only call this AFTER verifyUKSupplier has returned a result. Runs as a PREVIEW simulation.',
        inputSchema: z.object({
          phoneNumber: z.string().describe('Supplier phone number in E.164 format, e.g. +442071234567'),
          companyName: z.string().describe('Name of the UK supplier company'),
          productCategory: z.string().describe('Product or service category being sourced'),
          claimedTerms: z.string().describe('The deal terms the listing claimed (price, MOQ, payment terms)'),
          language: z.string().optional().describe('Language to conduct the call in, default: English'),
          contactName: z.string().optional().describe('Name of the person to contact, if provided'),
        }),
        execute: async (params) => {
          if (pendingReconciliation) return reconciliationBlockedResult();
          if (!isValidE164(params.phoneNumber)) {
            return { error: true, message: 'Phone number must be in E.164 format (e.g. +442071234567).' };
          }
          return checkReconciliation(await simulateCall({ ...params, region: 'INTERNATIONAL' }, 'United Kingdom', googleAI));
        },
      }),

      // ── China path ────────────────────────────────────────────────
      verifyChinaSupplier: tool({
        description: 'Perform a documentary check for a Chinese supplier by company name or USCC. Run this first, before the call.',
        inputSchema: z.object({
          query: z.string().describe('Company name or USCC (Unified Social Credit Code) of the Chinese supplier'),
        }),
        execute: async ({ query }) => {
          return await verifyChinaCompany(query);
        },
      }),

      callChinaSupplier: tool({
        description: 'Place a verification call to a Chinese supplier. Only call this AFTER verifyChinaSupplier has returned a result. Runs as a PREVIEW simulation.',
        inputSchema: z.object({
          phoneNumber: z.string().describe('Supplier phone number in E.164 format, e.g. +861234567890'),
          companyName: z.string().describe('Name of the Chinese supplier company'),
          productCategory: z.string().describe('Product or service category being sourced'),
          claimedTerms: z.string().describe('The deal terms the listing claimed (price, MOQ, payment terms)'),
          language: z.string().optional().describe('Language to conduct the call in, default: Mandarin'),
          contactName: z.string().optional().describe('Name of the person to contact, if provided'),
        }),
        execute: async (params) => {
          if (pendingReconciliation) return reconciliationBlockedResult();
          if (!isValidE164(params.phoneNumber)) {
            return { error: true, message: 'Phone number must be in E.164 format (e.g. +861234567890).' };
          }
          return checkReconciliation(await simulateCall({ ...params, region: 'INTERNATIONAL' }, 'China', googleAI));
        },
      }),

      // ── US path ───────────────────────────────────────────────────
      verifyUSSupplier: tool({
        description: 'Perform a documentary check for a US supplier by company name or EIN. Run this first, before the call.',
        inputSchema: z.object({
          query: z.string().describe('Company name or EIN of the US supplier'),
        }),
        execute: async ({ query }) => {
          return await verifyUSCompany(query);
        },
      }),

      callUSSupplier: tool({
        description: 'Place a verification call to a US supplier. Only call this AFTER verifyUSSupplier has returned a result. Runs as a PREVIEW simulation.',
        inputSchema: z.object({
          phoneNumber: z.string().describe('Supplier phone number in E.164 format, e.g. +15551234567'),
          companyName: z.string().describe('Name of the US supplier company'),
          productCategory: z.string().describe('Product or service category being sourced'),
          claimedTerms: z.string().describe('The deal terms the listing claimed (price, MOQ, payment terms)'),
          language: z.string().optional().describe('Language to conduct the call in, default: English'),
          contactName: z.string().optional().describe('Name of the person to contact, if provided'),
        }),
        execute: async (params) => {
          if (pendingReconciliation) return reconciliationBlockedResult();
          if (!isValidE164(params.phoneNumber)) {
            return { error: true, message: 'Phone number must be in E.164 format (e.g. +15551234567).' };
          }
          return checkReconciliation(await simulateCall({ ...params, region: 'US' }, 'United States', googleAI));
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}