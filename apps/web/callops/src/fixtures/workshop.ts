import type { CreateSupportCaseInput, MockScenario } from '../domain/models';
import type { WorkshopContext } from '../domain/workshop-outcome';

export const WORKSHOP_CASE: CreateSupportCaseInput = Object.freeze({
  organization: 'Fieldwork Repairs Demo',
  syntheticReference: 'DEMO-REPAIR-0042',
  category: 'Espresso machine repair',
  context: 'Fictional espresso machine awaiting a replacement pump from Northstar Parts Demo. The workshop previously expected the device to return to its customer on 2026-09-11.',
  desiredOutcome: 'Confirm part arrival, repair completion, device return and the next supplier update separately.',
  authorizedInformation: ['Fictional workshop name', 'Synthetic repair reference', 'Demo espresso machine', 'Replacement pump request'],
  forbiddenInformation: ['Payment details', 'Personal contact details', 'Delivery address', 'Account credentials'],
});
export const WORKSHOP_CONTEXT: WorkshopContext = Object.freeze({
  customerExpectedReturn: '2026-09-11',
  observation: { observedAt: '2026-09-08T10:00:00.000Z', timeZone: 'Europe/Paris' },
});
export const WORKSHOP_SCENARIOS: readonly { id: MockScenario; label: string; description: string }[] = [
  { id: 'AMBIGUOUS', label: 'Part expected · return unknown', description: 'The Friday part arrival does not confirm the device’s return.' },
  { id: 'NOMINAL', label: 'Repair ready · return confirmed', description: 'The supplier confirms the device’s return on Friday.' },
  { id: 'CONFLICTING', label: 'Conflicting supplier dates', description: 'Two incompatible return dates need clarification.' },
  { id: 'FAILED', label: 'Supplier unreachable', description: 'No new information and no automatic retry.' },
];
export const WORKSHOP_TRANSCRIPTS: Readonly<Record<MockScenario, readonly string[]>> = Object.freeze({
  AMBIGUOUS: [
    'Agent: This is a fictional repair follow-up for DEMO-REPAIR-0042. I am an automated demo assistant.',
    'Supplier: Part arrival is estimated for 2026-09-11.',
    'Supplier: Repair completion is not confirmed.',
    'Supplier: Device return is not confirmed.',
    'Supplier: Next supplier update is estimated for 2026-09-10.',
  ],
  NOMINAL: [
    'Agent: This is a fictional repair follow-up for DEMO-REPAIR-0042. I am an automated demo assistant.',
    'Supplier: Part arrival is confirmed for 2026-09-08.',
    'Supplier: The repair is complete.',
    'Supplier: Repair completion is confirmed for 2026-09-08.',
    'Supplier: Device return is confirmed for 2026-09-11.',
  ],
  CONFLICTING: [
    'Agent: This is a fictional repair follow-up for DEMO-REPAIR-0042. I am an automated demo assistant.',
    'Supplier: Part arrival is confirmed for 2026-09-08.',
    'Supplier: Device return is confirmed for 2026-09-11.',
    'Supplier: Device return is confirmed for 2026-09-14.',
    'Agent: The return dates conflict. No date will be treated as settled.',
  ],
  FAILED: [
    'Simulation: The supplier could not be reached.',
    'Simulation: No information was obtained. No retry is scheduled.',
  ],
});
