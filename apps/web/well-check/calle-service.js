import { CalleClient } from "@call-e/calle";

// The full schema from the implementation plan, with call_status removed from resultSchema
export const checkInSchema = {
  type: "object",
  properties: {
    wellbeing_summary: {
      type: "string",
      description: "1-2 sentence natural language summary"
    },
    checks: {
      type: "object",
      properties: {
        medication_taken: { type: "string", enum: ["yes", "no", "unclear", "not_applicable"] },
        eaten_today: { type: "string", enum: ["yes", "no", "unclear"] },
        needs_anything: { type: "string", nullable: true }
      },
      required: ["medication_taken", "eaten_today"]
    },
    concern_level: {
      type: "string",
      enum: ["none", "low", "high"]
    },
    concern_reason: {
      type: "string", nullable: true
    }
  },
  required: ["wellbeing_summary"]
};

// Generates the literal task string to be sent to CALL-E
export function buildPrompt(phone) {
  return `Call ${phone} to do a daily WellCheck. You are a warm, unhurried, and patient assistant calling on behalf of the person's family.
Your tone must be gentle, clear, and reassuring. Speak slowly and clearly.

1. **Consent & Greeting**: Start the call by saying: "Hi there, this is your daily WellCheck calling on behalf of your family. Is it okay if we speak for a minute?" 
   - If they say no or sound confused, politely say goodbye and end the call.
2. **Wellbeing Check**: Ask, "How are you feeling today?" and listen to their response.
3. **Structured Checks**: 
   - Ask if they took their medication today.
   - Ask if they have eaten today.
   - Ask if they need anything like groceries or a visit.
4. **Open-ended**: Ask, "Is there anything else you'd like me to pass along to your family?"
5. **Warm Close**: Thank them for their time and wish them a wonderful day.

**CRITICAL GUARDRAILS AND SYMPTOM HANDLING (NEVER VIOLATE):**
- DO NOT offer medical advice, diagnosis, or instructions on medications.
- **Symptom Response**: If the person mentions feeling dizzy, sick, or unwell, DO NOT just offer generic sympathy and move on. You MUST stop and ask one brief clarifying question: "I'm so sorry to hear that. Is this happening right now, and are you safe where you are?"
- **Escalation & Concern Level**: If they report a concerning symptom (like dizziness, pain, or a fall), you must classify the \`concern_level\` in your JSON as "low" or "high" depending on severity, and clearly document it in \`concern_reason\`.
- **Emergencies**: If they mention a severe fall, severe pain, inability to breathe, or any immediate emergency: DO NOT attempt to resolve it yourself. Calmly advise them to hang up and call emergency services (like 911) immediately, then end the call so their line is free. Record the emergency in your summary so it is immediately escalated.`;
}

export async function createAndRunCall(phone) {
    // 1) TEST_MODE/ALLOWED_TEST_NUMBERS guard function
    const TEST_MODE = process.env.TEST_MODE !== 'false'; // defaults to true if undefined
    const ALLOWED_TEST_NUMBERS = (process.env.ALLOWED_TEST_NUMBERS || '+15550123456').split(',');

    if (TEST_MODE && !ALLOWED_TEST_NUMBERS.includes(phone)) {
        throw new Error(`TEST_MODE is enabled and phone ${phone} is not in the ALLOWED_TEST_NUMBERS list.`);
    }

    // 2) MOCK MODE vs REAL SDK
    if (!process.env.CALLE_API_KEY) {
        console.log(`[CALL-E MOCK] Initiating call to ${phone}... (No API key found)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const outcomes = [
            {
                status: "completed",
                structuredResult: {
                    wellbeing_summary: "Test Grandma is doing well and ate a good breakfast.",
                    checks: { medication_taken: "yes", eaten_today: "yes", needs_anything: null },
                    concern_level: "none",
                    concern_reason: null
                },
                completionConfidence: 0.95
            },
            {
                status: "completed",
                structuredResult: {
                    wellbeing_summary: "She forgot to take her medication today.",
                    checks: { medication_taken: "no", eaten_today: "yes", needs_anything: "A reminder for tomorrow" },
                    concern_level: "low",
                    concern_reason: "Missed medication today."
                },
                completionConfidence: 0.85
            },
            {
                status: "no_answer",
                structuredResult: null,
                completionConfidence: 1.0
            }
        ];
        return outcomes[Math.floor(Math.random() * outcomes.length)];
    }

    // 3) REAL SDK CALL
    console.log(`[CALL-E SDK] Initiating real call to ${phone}...`);
    console.log(`[GUARD VERIFICATION] About to dial: ${phone}. Is it in ALLOWED_TEST_NUMBERS? ${ALLOWED_TEST_NUMBERS.includes(phone)}`);
    const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY });
    
    const task = buildPrompt(phone);
    
    try {
        const call = await client.calls.createAndWait({
            task: task,
            recipient: { phone: phone },
            resultSchema: checkInSchema
        });
        
        console.log(`[CALL-E SDK] Call to ${phone} resulted in status: ${call.status}`);
        
        return {
            id: call.id,
            status: call.status,
            structuredResult: call.taskCompleted ? call.structuredResult : null,
            completionConfidence: call.completionConfidence,
            failureCode: call.failureCode,
            failureMessage: call.failureMessage
        };
    } catch (error) {
        console.error(`[CALL-E SDK] Error placing call to ${phone}:`, error.message);
        return {
            status: "failed",
            structuredResult: null,
            completionConfidence: null,
            failureCode: "sdk_error",
            failureMessage: error.message
        };
    }
}
