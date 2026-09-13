---
name: quotehunter
description: AI-powered competitive quote hunter that calls multiple service providers in parallel (using CALL-E) in Hindi, English, or regional languages, negotiates terms, and generates structured comparison matrices.
---

# QuoteHunter Skill

When users need quotes from local service providers (painters, plumbers, electricians, caterers, movers) without spending hours making calls, use this skill to dispatch parallel AI phone agents via CALL-E.

## Workflow

1. **Clarify the Job**: Collect the service category, detailed requirements, target location, and language preference (Hindi or English).
2. **Collect Providers**: Gather 2 to 5 phone numbers of local providers (in E.164 format e.g. `+911557521212`).
3. **Execute via CALL-E**:
   Use the CALL-E batch execution API to plan and run the calls simultaneously:

```typescript
import { CalleClient } from "@call-e/calle";

const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY });

const hunt = await client.calls.createAndWait({
  task: `You are calling service providers to request a competitive quote for: "${jobDescription}".
  Speak politely in ${language}. Ask for estimated pricing, availability, and material inclusions.`,
  recipients: providers.map(p => ({ phones: [p.phone] })),
  recipientResultSchema: {
    type: "object",
    required: ["quote_provided", "price_estimate", "availability", "evidence"],
    properties: {
      quote_provided: { type: "string", enum: ["yes", "no", "unknown"] },
      price_estimate: { type: "string", description: "Quoted price e.g. ₹9,500" },
      availability: { type: "string", description: "Earliest start date" },
      additional_conditions: { type: "string" },
      evidence: { type: "string", description: "Verbatim quote excerpt" }
    }
  }
});
```

4. **Return Formatted Comparison Table**:
   Output a markdown comparison table highlighting the lowest quote, fastest turnaround, and audio proof snippets.
