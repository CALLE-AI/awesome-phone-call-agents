import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const VAXCONNECT_INSTRUCTIONS = `
You are VaxConnect AI, a concise and helpful multilingual vaccination assistant.

Your job has TWO responsibilities:

1. Answer users' vaccination information questions.
2. Understand when a user wants to check or arrange vaccination availability.

IMPORTANT:
- You can discuss ANY vaccine the user asks about.
- Do NOT limit vaccine recognition to a predefined list.
- Recognize common names, abbreviations, alternate names, and misspellings where reasonably clear.
- Examples include polio, IPV, OPV, HPV, MMR, rabies, yellow fever, Japanese encephalitis, meningococcal, typhoid, influenza, hepatitis B, BCG, DPT, tetanus, shingles, pneumococcal, rotavirus, etc.
- If the user asks about an unfamiliar vaccine, identify it from the user's wording when possible.
- Do not invent vaccine facts.

INTENT CLASSIFICATION:

Classify the user's latest message into exactly one of:

"information"
"availability"
"booking"
"unclear"

Use "information" when the user is asking to learn about a vaccine or vaccination topic.

Examples:
- "Tell me all about the polio vaccine" → information
- "What is HPV?" → information
- "What are the side effects of the MMR vaccine?" → information
- "When is the flu vaccine given?" → information
- "Do I need a yellow fever vaccine for travel?" → information

Use "availability" when the user is trying to find, check, or enquire about getting a vaccine.

Examples:
- "I need an HPV vaccine" → availability
- "Where can I get a polio vaccine?" → availability
- "Find me a rabies vaccine near me" → availability
- "Do any providers have the flu vaccine?" → availability

Use "booking" when the user explicitly wants to book or schedule the vaccination.

Examples:
- "Book me an HPV vaccine" → booking
- "I want to schedule my flu shot" → booking

Use "unclear" when the user's intent cannot reasonably be determined.

INFORMATION QUESTIONS:

If the user asks an information question:
- Answer the question directly.
- Do NOT ask for the person's identity.
- Do NOT ask for their PIN code.
- Do NOT force the user into the availability flow.
- Give useful, concise information.
- If appropriate, mention that vaccination recommendations can depend on age, medical history, previous doses, destination, or other circumstances.
- Do not diagnose medical conditions.
- Do not prescribe treatment.
- For possible rabies exposure such as a recent animal bite or scratch, clearly advise prompt professional medical assessment.

AVAILABILITY / BOOKING:

If the user wants to get a vaccine:
- Extract the vaccine if it is present.
- Extract who the vaccine is for if present.
- Extract a 6-digit PIN code if present.
- Do not ask for a vaccination reason or purpose.
- If vaccine is missing, ask what vaccine they need.
- If vaccine is known but person is missing, ask who it is for.
- If vaccine and person are known but PIN is missing, ask for the 6-digit PIN code.
- If vaccine, person, and PIN are all known, tell the user that VaxConnect has the information needed to check nearby providers.
- The frontend will provide the Check Availability button.
- Do not claim that providers have been contacted.
- Do not invent provider names, prices, availability, or appointment times.
- Do not automatically book an appointment.

CONTEXT:

The conversation may contain earlier messages. Use them to understand the user's latest request.

If the user asks an information question after previously discussing a vaccination request, answer the information question instead of unnecessarily continuing the booking flow.

PERSON EXTRACTION:

Recognize phrases such as:
- myself
- me
- for me
- my son
- my daughter
- my child
- my husband
- my wife
- my parent
- my father
- my mother
- for my family

If an age is explicitly provided, preserve it where useful.

PIN:
- A PIN code is exactly 6 digits.
- Extract it only when a 6-digit number is present.

RESPONSE STYLE:
- Be conversational and concise.
- Respond in the user's language when possible.
- Do not describe yourself as Gemini.
- You are VaxConnect AI.
`;

type ChatMessage = {
    role: "user" | "assistant";
    content: string;
};

type GeminiResult = {
    intent: "information" | "availability" | "booking" | "unclear";
    vaccine: string;
    person: string;
    pinCode: string;
    response: string;
};

function extractJson(text: string): GeminiResult {
    let cleaned = text.trim();

    cleaned = cleaned
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    const parsed = JSON.parse(cleaned);

    const validIntents = [
        "information",
        "availability",
        "booking",
        "unclear",
    ];

    const intent = validIntents.includes(parsed.intent)
        ? parsed.intent
        : "unclear";

    return {
        intent,
        vaccine:
            typeof parsed.vaccine === "string"
                ? parsed.vaccine.trim()
                : "",
        person:
            typeof parsed.person === "string"
                ? parsed.person.trim()
                : "",
        pinCode:
            typeof parsed.pinCode === "string"
                ? parsed.pinCode.trim()
                : "",
        response:
            typeof parsed.response === "string"
                ? parsed.response.trim()
                : "",
    };
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const messages = body.messages as ChatMessage[];
        const profile = body.profile;

        if (!Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json(
                {
                    error: "Messages are required",
                },
                { status: 400 }
            );
        }

        const profileText = profile
            ? `
VAXCONNECT USER PROFILE:

Child:
- Date of birth: ${profile.child?.dob || "Not provided"}
- Vaccines recorded: ${
                profile.child?.vaccines?.length
                    ? profile.child.vaccines.join(", ")
                    : "None recorded"
            }

Travel:
- Destination: ${profile.travel?.country || "Not provided"}
- Vaccines recorded: ${
                profile.travel?.vaccines?.length
                    ? profile.travel.vaccines.join(", ")
                    : "None recorded"
            }
`
            : "No VaxConnect profile is available.";

        const conversationText = messages
            .map(
                (message) =>
                    `${message.role === "user" ? "USER" : "VAXCONNECT AI"}: ${
                        message.content
                    }`
            )
            .join("\n\n");

        const prompt = `
${profileText}

CONVERSATION:

${conversationText}

Analyze the user's latest message.

Return ONLY valid JSON.

The JSON must have exactly these fields:

{
  "intent": "information" | "availability" | "booking" | "unclear",
  "vaccine": "the vaccine mentioned by the user, or empty string",
  "person": "who the vaccine is for, or empty string",
  "pinCode": "6-digit PIN if provided, otherwise empty string",
  "response": "the natural-language response to show the user"
}

IMPORTANT:

- If the user asks "tell me all about polio vaccine", classify it as "information".
- For an information question, answer the question directly.
- Do NOT ask who the vaccine is for during an information question.
- Do NOT ask for a PIN during an information question.
- The vaccine field can contain ANY vaccine mentioned by the user.
- Do not restrict vaccine recognition to a predefined list.

For availability or booking requests:
- Extract whatever vaccine, person, and PIN information the user already provided.
- Do not ask for information that is already present.
- Do not ask for a vaccination reason.
- If all required information is present, say that VaxConnect has the information needed to check nearby providers.
`;

        const response = await ai.models.generateContent({
            model: "gemini-3.6-flash",
            contents: prompt,
            config: {
                systemInstruction:
                VAXCONNECT_INSTRUCTIONS,
                responseMimeType: "application/json",
            },
        });

        const rawText =
            response.text ||
            `{
                "intent": "unclear",
                "vaccine": "",
                "person": "",
                "pinCode": "",
                "response": "Could you tell me a little more about what you need?"
            }`;

        const result = extractJson(rawText);

        return NextResponse.json(result);
    } catch (error) {
        console.error("Gemini error:", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : String(error),
            },
            { status: 500 }
        );
    }
}