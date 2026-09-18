import { google, createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, generateText, tool, convertToModelMessages, stepCountIs } from 'ai';
import type { UIMessage } from 'ai';
import { z } from 'zod';
import { verifyGSTIN } from '@/lib/gstin';
import { placeVerificationCall } from '@/lib/calle';
import { verifyCACCompany } from '@/lib/cac';
import { verifyUKCompany } from '@/lib/companieshouse';
import { verifyChinaCompany } from '@/lib/china';
import { verifyUSCompany } from '@/lib/us';

export const maxDuration = 120; // CALL-E calls can take up to 60s

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

function getRandomGoogleAI() {
  const randomKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
  return createGoogleGenerativeAI({
    apiKey: randomKey,
  });
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const googleAI = getRandomGoogleAI();

  const result = streamText({
    model: googleAI('gemini-3.6-flash'),
    system: `You are an AI Copilot for TradeCheck, an AI-powered trade partner verification tool.
Your job is to gather information about a trade deal and run the appropriate checks.

WORKFLOW FOR INDIA SUPPLIER (full check):
1. Gather ALL of the following before starting any verification: business name, GSTIN, phone number (with +91 country code), product category, quoted deal terms, preferred call language (default: English/Hindi), and the name of the contact person (optional).
2. Call \`verifySupplier\` with the GSTIN for the documentary check.
3. After the documentary result comes back, call \`callSupplier\` with all details.
4. Summarise the outcome.

WORKFLOW FOR NIGERIA SUPPLIER (full check):
1. Gather ALL of the following before starting any verification: business name or RC number, phone number (with +234 country code), product category, quoted deal terms, preferred call language (default: English), and the name of the contact person (optional).
2. Call \`verifyNigeriaSupplier\` with the company name or RC number for the CAC documentary check.
3. After the CAC result comes back, call \`callNigeriaSupplier\` with all details.
4. Summarise the outcome.

WORKFLOW FOR UK SUPPLIER (full check):
1. Gather ALL of the following before starting any verification: company name or Companies House number, phone number (with +44 country code), product category, quoted deal terms, and the name of the contact person (optional).
2. Call \`verifyUKSupplier\` with the company name or number for the Companies House documentary check.
3. After the Companies House result comes back, call \`callUKSupplier\` with all details.
4. Summarise the outcome.

WORKFLOW FOR CHINA SUPPLIER (full check):
1. Gather ALL of the following before starting any verification: company name or USCC (Unified Social Credit Code), phone number (with +86 country code), product category, quoted deal terms, preferred call language (default: Mandarin/English), and the name of the contact person (optional).
2. Call \`verifyChinaSupplier\` with the company name or USCC for the documentary check.
3. After the documentary check result comes back, call \`callChinaSupplier\` with all details.
4. Summarise the outcome.

WORKFLOW FOR US SUPPLIER (full check):
1. Gather ALL of the following before starting any verification: company name or EIN (Employer Identification Number), phone number (with +1 country code), product category, quoted deal terms, and the name of the contact person (optional).
2. Call \`verifyUSSupplier\` with the company name or EIN for the documentary check.
3. After the documentary check result comes back, call \`callUSSupplier\` with all details.
4. Summarise the outcome.

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
        description: 'Place a live CALL-E verification call to an Indian supplier. Only call this AFTER verifySupplier has returned a result.',
        inputSchema: z.object({
          phoneNumber: z.string().describe('Supplier phone number with country code, e.g. +919876543210'),
          companyName: z.string().describe('Name of the supplier company'),
          productCategory: z.string().describe('Product or service category being sourced'),
          claimedTerms: z.string().describe('The deal terms the listing claimed (price, MOQ, payment terms)'),
          language: z.string().optional().describe('Language to conduct the call in, e.g. English, Hindi'),
          contactName: z.string().optional().describe('Name of the person to contact, if provided'),
        }),
        execute: async (params) => {
          return await placeVerificationCall({ ...params, region: 'IN' });
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
        description: 'Place a CALL-E verification call to a Nigerian supplier. Only call this AFTER verifyNigeriaSupplier has returned a result.',
        inputSchema: z.object({
          phoneNumber: z.string().describe('Supplier phone number with country code, e.g. +2348012345678'),
          companyName: z.string().describe('Name of the Nigerian supplier company'),
          productCategory: z.string().describe('Product or service category being sourced'),
          claimedTerms: z.string().describe('The deal terms the listing claimed (price, MOQ, payment terms)'),
          language: z.string().optional().describe('Language to conduct the call in, e.g. English'),
          contactName: z.string().optional().describe('Name of the person to contact, if provided'),
        }),
        execute: async (params) => {
          // AI-simulated call for regions where live calling is unavailable
          if (process.env.DEMO_MODE === 'true') {
            await new Promise(r => setTimeout(r, 2000)); // simulate call latency
            
            const { text: simulatedTranscript } = await generateText({
              model: googleAI('gemini-3.6-flash'),
              prompt: `Simulate a realistic phone call transcript between an AI verification agent (Agent) and a Nigerian supplier (Supplier).
              The agent is calling on behalf of a buyer to verify the supplier's details.
              Company: ${params.companyName}
              Contact Person: ${params.contactName || 'A representative'}
              Product: ${params.productCategory}
              Claimed terms: ${params.claimedTerms}
              Language: ${params.language || 'English'}

              Make the conversation sound natural, professional, and typical of a business verification call in Nigeria. The supplier should confirm the business name, product availability, and terms.
              Format as markdown with **Agent:** and **Supplier:** prefixes. Do not include any other text besides the transcript.`
            });

            return {
              reached_business: 'yes',
              confirmed_business_name: params.companyName,
              product_match: 'matches',
              stated_price_or_terms: params.claimedTerms,
              advance_payment_requested: '30% upfront, 70% on dispatch',
              red_flags: [],
              verdict: 'verified_reachable',
              transcript: simulatedTranscript,
              confidence: 88,
            };
          }
          return await placeVerificationCall({ ...params, region: 'INTERNATIONAL' });
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
        description: 'Place a CALL-E verification call to a UK supplier. Only call this AFTER verifyUKSupplier has returned a result.',
        inputSchema: z.object({
          phoneNumber: z.string().describe('Supplier phone number with country code, e.g. +442071234567'),
          companyName: z.string().describe('Name of the UK supplier company'),
          productCategory: z.string().describe('Product or service category being sourced'),
          claimedTerms: z.string().describe('The deal terms the listing claimed (price, MOQ, payment terms)'),
          language: z.string().optional().describe('Language to conduct the call in, default: English'),
          contactName: z.string().optional().describe('Name of the person to contact, if provided'),
        }),
        execute: async (params) => {
          return await placeVerificationCall({ ...params, region: 'INTERNATIONAL' });
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
        description: 'Place a CALL-E verification call to a Chinese supplier. Only call this AFTER verifyChinaSupplier has returned a result.',
        inputSchema: z.object({
          phoneNumber: z.string().describe('Supplier phone number with country code, e.g. +861234567890'),
          companyName: z.string().describe('Name of the Chinese supplier company'),
          productCategory: z.string().describe('Product or service category being sourced'),
          claimedTerms: z.string().describe('The deal terms the listing claimed (price, MOQ, payment terms)'),
          language: z.string().optional().describe('Language to conduct the call in, default: Mandarin'),
          contactName: z.string().optional().describe('Name of the person to contact, if provided'),
        }),
        execute: async (params) => {
          // Attempt LIVE call first
          const liveResult = await placeVerificationCall({ ...params, region: 'INTERNATIONAL' });
          
          // Fallback to simulation ONLY if live call failed and we are in demo mode
          if (liveResult.error && process.env.DEMO_MODE === 'true') {
            await new Promise(r => setTimeout(r, 2000)); // simulate call latency
            
            const { text: simulatedTranscript } = await generateText({
              model: googleAI('gemini-3.6-flash'),
              prompt: `Simulate a realistic phone call transcript between an AI verification agent (Agent) and a Chinese supplier (Supplier).
              The agent is calling on behalf of a buyer to verify the supplier's details.
              Company: ${params.companyName}
              Contact Person: ${params.contactName || 'A representative'}
              Product: ${params.productCategory}
              Claimed terms: ${params.claimedTerms}
              Language: ${params.language || 'Mandarin (translated to English for display)'}

              Make the conversation sound natural, professional, and typical of a business verification call in China. The supplier should confirm the business name, product availability, and terms.
              Format as markdown with **Agent:** and **Supplier:** prefixes. Do not include any other text besides the transcript.`
            });

            return {
              reached_business: 'yes',
              confirmed_business_name: params.companyName,
              product_match: 'matches',
              stated_price_or_terms: params.claimedTerms,
              advance_payment_requested: '30% upfront, 70% on dispatch',
              red_flags: ['[DEMO] Live call failed, showing simulated result instead'],
              verdict: 'verified_reachable',
              transcript: simulatedTranscript,
              confidence: 88,
            };
          }
          
          return liveResult;
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
        description: 'Place a CALL-E verification call to a US supplier. Only call this AFTER verifyUSSupplier has returned a result.',
        inputSchema: z.object({
          phoneNumber: z.string().describe('Supplier phone number with country code, e.g. +15551234567'),
          companyName: z.string().describe('Name of the US supplier company'),
          productCategory: z.string().describe('Product or service category being sourced'),
          claimedTerms: z.string().describe('The deal terms the listing claimed (price, MOQ, payment terms)'),
          language: z.string().optional().describe('Language to conduct the call in, default: English'),
          contactName: z.string().optional().describe('Name of the person to contact, if provided'),
        }),
        execute: async (params) => {
          return await placeVerificationCall({ ...params, region: 'US' });
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}