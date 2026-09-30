const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';

export interface SummaryParams {
  loadOrigin: string;
  loadDestination: string;
  equipmentType: string;
  weight: number;
  pickupDate: string;
  winnerName: string;
  winnerRate: number;
  runnerUpName: string;
  runnerUpRate: number;
  savingsVsOriginal: number;
  savingsVsNextBest: number;
  wasNegotiated: boolean;
}

/**
 * Build a deterministic recommendation summary from real data.
 * Used as a mock fallback when Kimi API is unavailable, and as the
 * offline path so recommendation text always matches the stat boxes.
 */
function buildLocalSummary(params: SummaryParams): string {
  const {
    winnerName,
    winnerRate,
    runnerUpName,
    runnerUpRate,
    savingsVsOriginal,
    savingsVsNextBest,
    wasNegotiated,
  } = params;

  const action = wasNegotiated ? 'negotiated down to' : 'quoted';
  const savingsPct =
    params.winnerRate + savingsVsOriginal > 0
      ? Math.round(
          (savingsVsOriginal / (params.winnerRate + savingsVsOriginal)) * 100
        )
      : 0;

  return [
    `${winnerName} is recommended at $${winnerRate.toLocaleString()} after successfully ${action} from their original quote.`,
    savingsVsOriginal > 0
      ? `This saves $${savingsVsOriginal.toLocaleString()} (${savingsPct}%) vs their original quote`
      : null,
    savingsVsNextBest > 0
      ? `and $${savingsVsNextBest.toLocaleString()} vs ${runnerUpName}'s $${runnerUpRate.toLocaleString()}.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
}

export async function generateSummary(prompt: string, params?: SummaryParams): Promise<string> {
  const apiKey = process.env.KIMI_API_KEY;

  // Build a real summary from data whenever possible (offline / no API key / API failure)
  const fallback = params
    ? buildLocalSummary(params)
    : 'No summary generated.';

  // Mock fallback for build verification without real API key
  if (!apiKey || apiKey === 'your_kimi_api_key_here') {
    return fallback;
  }

  try {
    const response = await fetch(KIMI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'kimi-k3',
        messages: [
          {
            role: 'system',
            content: 'You are a professional freight broker assistant. Write concise, professional recommendation summaries with specific numbers. Max 2-3 sentences.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 1,
        // kimi-k3 is a reasoning model: give it room to finish thinking
        // and still emit the actual summary (reasoning alone can exceed 200 tokens)
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Kimi API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim();
    if (!content) {
      // Reasoning models can return empty content if max_tokens is consumed by thinking
      console.error('Kimi API returned no content, using local fallback');
      return fallback;
    }
    return content;
  } catch (error) {
    console.error('Kimi API call failed, using local fallback:', error);
    // Graceful fallback to data-driven summary on any API error
    return fallback;
  }
}
