import { it } from 'node:test';
import assert from 'node:assert/strict';
import { reviewConversation } from '../src/domain/conversation-review';
import { defaultTask } from '../src/domain/templates';
import type { Turn } from '../src/domain/model';
const turns = (...rows: [Turn['speaker'], string][]): Turn[] =>
  rows.map(([speaker, text], i) => ({ speaker, text, offsetSeconds: i }));
it('flags a fee question before negotiation, including split caller segments', () => {
  const task = defaultTask('repair');
  assert.equal(
    reviewConversation(
      task,
      turns(
        ['recipient', 'It will be $60.'],
        ['caller', 'Is that the final'],
        ['caller', 'all-in price including fees?'],
      ),
    ).length,
    1,
  );
  assert.equal(
    reviewConversation(
      task,
      turns(
        ['recipient', 'It will be $60.'],
        ['caller', 'Is there any flexibility on the price?'],
        ['recipient', '$38.'],
        ['caller', 'Does that include fees?'],
      ),
    ).length,
    0,
  );
  assert.equal(
    reviewConversation(
      task,
      turns(['recipient', '$60, non-negotiable.'], ['caller', 'Thanks. Goodbye.']),
    ).length,
    0,
  );
  assert.equal(
    reviewConversation(task, turns(['recipient', '$30.'], ['caller', 'Does that include fees?']))
      .length,
    0,
  );
});
it('flags reversed roles without flagging a customer drop-off question', () => {
  const task = defaultTask('repair');
  assert.equal(
    reviewConversation(
      task,
      turns(['caller', 'Could you drop it off'], ['caller', 'on Thursday?'], ['recipient', 'No.']),
    ).length,
    1,
  );
  assert.equal(
    reviewConversation(
      task,
      turns(
        ['caller', 'Could the customer bring the item to your shop on Thursday?'],
        ['recipient', 'No.'],
      ),
    ).length,
    0,
  );
});
