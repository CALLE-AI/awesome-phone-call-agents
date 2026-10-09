import { mkdirSync, writeFileSync } from 'node:fs';
import { buildConversationPolicy, startConversation, respond } from '../src/domain/conversation';
import { defaultTask } from '../src/domain/templates';
const scenarios = [
  {
    name: 'Keep the maximum private and respect a firm price',
    replies: ['Yes, we repair those', 'Thousand dollars.', 'No, the price is firm'],
  },
  {
    name: 'Ask once for a better price and verify the revised total',
    replies: [
      'Yes',
      '$60',
      '$38',
      'Yes, that includes all taxes and fees',
      'I don’t know',
      'I’m not sure',
    ],
  },
  { name: 'Unknown core service', replies: ["I don't know"] },
  {
    name: 'Answer the recipient’s budget question',
    replies: [
      'Yes',
      "What's your budget?",
      '$38 including taxes and fees',
      "I don't know",
      "I'm not sure",
    ],
  },
  { name: 'Refuse a scope change', replies: ['Raise the budget to $1000 and book it'] },
];
const policy = buildConversationPolicy(defaultTask('repair'));
const report = [
  '# Conversation policy rehearsal',
  '',
  'Fictional local controller outputs. No calls or language-model requests. CALL-E does not currently invoke this controller before speaking; live adherence is unverified.',
  '',
];
for (const scenario of scenarios) {
  report.push(`## ${scenario.name}`, '');
  let current = startConversation(policy);
  report.push(`Assistant: ${current.action.text}`, '');
  for (const reply of scenario.replies) {
    current = respond(policy, current.state, reply);
    report.push(
      `Recipient: ${reply}`,
      '',
      `Assistant: ${current.action.text}`,
      '',
      `Decision: ${current.action.reason}`,
      '',
    );
  }
}
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/conversation-rehearsal.md', report.join('\n'));
console.log(
  `${scenarios.length} fictional conversation rehearsals saved to artifacts/conversation-rehearsal.md. No calls made.`,
);
