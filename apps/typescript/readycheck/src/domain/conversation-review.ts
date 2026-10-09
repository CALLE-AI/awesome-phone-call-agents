import type { Task, Turn } from './model';
import { explicitDollars } from './money';

/** Narrow post-call checks, not a voice controller or a general quality score. */
export function reviewConversation(task: Task, transcript: Turn[]): string[] {
  const warnings = new Set<string>();
  const budget = task.requirements.find((r) => r.id === 'budget' && r.importance === 'must');
  for (let i = 0; i < transcript.length; i++) {
    const turn = transcript[i];
    if (turn.speaker === 'caller') continue;
    const caller: string[] = [];
    for (let j = i + 1; j < transcript.length && transcript[j].speaker === 'caller'; j++)
      caller.push(transcript[j].text);
    const reply = caller.join(' ');
    const amount = explicitDollars(turn.text);
    if (
      budget &&
      typeof budget.value === 'number' &&
      amount !== null &&
      amount > budget.value &&
      !/firm|non[ -]?negotiable|no discount/i.test(turn.text) &&
      /(?:all[ -]in|including|includes?|final|total|fees)/i.test(reply) &&
      !/(?:flexib|lower|discount|better price|reduce)/i.test(reply)
    )
      warnings.add(
        'The assistant asked about the total or fees after an over-budget quote without an identifiable negotiation request. Review the price exchange.',
      );
  }
  if (task.requirements.some((r) => r.id === 'dropoff')) {
    const callerBlocks: string[] = [''];
    for (const turn of transcript) {
      if (turn.speaker === 'caller')
        callerBlocks[callerBlocks.length - 1] = (callerBlocks.at(-1) || '') + ' ' + turn.text;
      else callerBlocks.push('');
    }
    if (callerBlocks.some(reversedDropoffRole))
      warnings.add(
        'The assistant may have reversed the customer and shop roles in the drop-off question. A reply to that question does not establish whether the shop can receive the customer’s item.',
      );
  }
  return [...warnings];
}

export function reversedDropoffRole(text: string): boolean {
  return /\b(?:could|can|would|will) you (?:drop (?:it|the \w+|this) off|bring (?:it|the \w+|this))\b/i.test(
    text,
  );
}
