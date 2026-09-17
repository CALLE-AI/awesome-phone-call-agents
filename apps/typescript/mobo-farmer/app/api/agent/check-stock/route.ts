import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { calleClient, hasCalleKey } from '@/lib/calle';
import { inputStockSchema, marketPriceSchema, waterAllocationSchema } from '@/lib/agentSchemas';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { taskType, userIntent, phone, mockMode } = body;

    // Use mock mode if explicitly requested or if no API key is available
    if (!hasCalleKey || mockMode) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay
      return NextResponse.json({
        query: { taskType, userIntent },
        summary: `Mock summary: Called about ${userIntent}. Supplier confirmed availability.`,
        status: "completed",
        transcript: "Mock transcript: Yes we have it in stock, R875 per bag...",
        structured: { item_available: true, price_per_bag: 875, stock_quantity: 60 }
      });
    }

    // Live mode using CALL-E SDK
    let basePrompt = '';
    let resultSchema: any = null;

    switch (taskType) {
      case 'Find Buyer':
        basePrompt = `You are MoboFarmer assistant calling a market or buyer on behalf of a farmer in South Africa.
Farmer's request: "${userIntent}"
Ask what produce grades they accept, their price per kg, if they do farm pickups, and their payment terms (how many days to pay).`;
        resultSchema = marketPriceSchema;
        break;
      case 'Check Water Allocation':
      case 'Schedule Service': // Using same schema for simplicity if needed
        basePrompt = `You are MoboFarmer assistant calling the Water Association, Municipality, or a service provider on behalf of a farmer in South Africa.
Farmer's request: "${userIntent}"
Ask about their water allocation (in liters), ration days schedule, or confirm the requested service time and cost.`;
        resultSchema = waterAllocationSchema;
        break;
      case 'Check Input Stock':
      default:
        basePrompt = `You are MoboFarmer assistant calling a supplier on behalf of a farmer in South Africa.
Farmer's request: "${userIntent}"
Ask follow-ups based on supplier answers. If item not available, ask for alternatives, price, delivery date, when to call back. Pronounce L33 as "L thirty-three".`;
        resultSchema = inputStockSchema;
        break;
    }

    const fullPrompt = `${basePrompt}

Task Type: ${taskType}

Have a natural conversation, not a single fixed question.
If put on hold, note wait time.

At END, give verbal summary for confirmation: "Just to summarize: I called about [X], you said [Y], next step is [Z]. Is that correct?" Wait for yes/no.

Keep under 90s. Language: English. Region: US, Locale: en-US (ZA disabled per Sep 14 coverage update).`;

    const call = await calleClient.calls.create({
      task: fullPrompt,
      resultSchema: resultSchema,
      recipients: [{ phones: [phone], region: "US", locale: "en-US" }],
      metadata: { taskType, userIntent }
    });

    return NextResponse.json({
      callId: call.id
    });
    
  } catch (error: any) {
    console.error("Agent Call Error:", error);
    
    // Handle the case where the user's intent is too vague for the AI to make a call
    if (error?.code === 'call_not_ready' && error?.details?.questions?.length > 0) {
      return NextResponse.json(
        { 
          status: "failed", 
          message: "The AI needs more info before calling.", 
          error: "The AI needs more info: " + error.details.questions[0]
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { status: "no_answer", message: "Supplier didn't answer, will retry", error: error?.message || "Unknown error" },
      { status: 200 } // Keep 200 to prevent crash, just handle soft failure in UI
    );
  }
}
