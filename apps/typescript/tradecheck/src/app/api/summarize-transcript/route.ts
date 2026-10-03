import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { transcript, verdict, companyName } = await req.json();

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript is required' }, { status: 400 });
    }

    const { text } = await generateText({
      model: google('gemini-2.5-flash'),
      prompt: `You are summarising a trade verification call for a user of TradeCheck.

Company verified: ${companyName || 'Unknown'}
Call verdict: ${verdict || 'Unknown'}

FULL CALL TRANSCRIPT:
${transcript}

Write a concise summary (3–5 sentences) of the call for the user. Focus on:
- Whether the business was reached and confirmed
- Whether the stated terms matched what was claimed
- Any red flags or concerns raised
- The overall recommendation

Write in plain English, second-person ("The call confirmed…", "The agent found…"). Do not repeat the full transcript.`,
    });

    return NextResponse.json({ summary: text });
  } catch (error) {
    console.error('Summarisation error:', error);
    return NextResponse.json({ error: 'Failed to summarise transcript' }, { status: 500 });
  }
}
