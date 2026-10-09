import type { Requirement, Task } from './model';
import { localToInstant, nextDate } from './time';

export const templateMeta = {
  repair: {
    title: 'Find a repair service',
    short: 'Repair',
    description: 'The right repair, at the right time.',
    example: 'A backpack zipper repair by Friday',
    icon: 'wrench',
  },
  rental: {
    title: 'Find an item or rental',
    short: 'Rental',
    description: 'The exact item. Every condition checked.',
    example: 'A projector for a weekend workshop',
    icon: 'package',
  },
  venue: {
    title: 'Check a venue or visit',
    short: 'Venue',
    description: 'A place that fits your whole plan.',
    example: 'A workshop space for 12 people',
    icon: 'building',
  },
} as const;
function req(
  id: string,
  label: string,
  kind: Requirement['kind'],
  value: Requirement['value'],
  question: string,
  unit: Requirement['unit'] = 'none',
  importance: Requirement['importance'] = 'must',
): Requirement {
  return { id, label, kind, value, importance, question, unit };
}
export function defaultTask(template: Task['template'], now = new Date()): Task {
  const timeZone = 'America/Chicago',
    date = nextDate(timeZone, now);
  const at = (time: string) => localToInstant(`${date}T${time}`, timeZone);
  const base = { template, locality: 'Chicago, IL', timeZone };
  if (template === 'repair')
    return {
      ...base,
      title: 'Backpack zipper repair',
      description:
        'I need a zipper repair for a backpack by Friday, up to $40 total, with drop-off after 5 p.m.',
      requirements: [
        req(
          'service',
          'Service',
          'exact',
          'Backpack zipper repair',
          'Can you repair the zipper on a backpack?',
        ),
        req(
          'budget',
          'Total budget',
          'max',
          4000,
          'What is the all-in total including any mandatory fees and taxes? Is this a firm price or an estimate?',
          'USD',
        ),
        req(
          'deadline',
          'Ready by',
          'deadline',
          at('18:00'),
          'Can this specific repair be completed by the required date and time?',
        ),
        req(
          'dropoff',
          'Drop-off window',
          'window',
          { start: at('17:00'), end: at('18:00'), minimumMinutes: 15 },
          'When can I drop off this backpack? Is there at least a 15-minute intake window?',
        ),
      ],
    };
  if (template === 'rental')
    return {
      ...base,
      title: 'Projector for a workshop',
      description:
        'I need an Epson EB-FH52 projector for a Friday evening workshop, with HDMI, up to $100 in rental fees and a $150 deposit limit.',
      requirements: [
        req(
          'item',
          'Exact model',
          'exact',
          'Epson EB-FH52',
          'Can you confirm the exact model is Epson EB-FH52?',
        ),
        req(
          'quantity',
          'Quantity available',
          'min',
          1,
          'How many units of the exact model are available for these dates?',
          'count',
        ),
        req(
          'period',
          'Rental period',
          'window',
          { start: at('16:00'), end: at('21:00'), minimumMinutes: 300 },
          'Is the exact item available for the entire requested rental period?',
        ),
        req(
          'budget',
          'Rental cost',
          'max',
          10000,
          'What is the total nonrefundable rental cost including taxes and fees?',
          'USD',
        ),
        req(
          'deposit',
          'Refundable deposit',
          'max',
          15000,
          'What is the refundable deposit, separate from rental cost?',
          'USD',
        ),
        req(
          'upfront',
          'Up-front cash limit',
          'max',
          25000,
          'The rental fee plus refundable deposit must fit the up-front cash limit.',
          'USD',
        ),
        req(
          'hdmi',
          'HDMI cable included',
          'boolean',
          true,
          'Is an HDMI cable included with this rental?',
        ),
      ],
    };
  return {
    ...base,
    title: 'Space for a team workshop',
    description:
      'A meeting room for 12 people on Friday from 5–7 p.m., under $200 total, with step-free entry and a whiteboard.',
    requirements: [
      req(
        'service',
        'Space type',
        'exact',
        'Private meeting room',
        'Is this a private meeting room?',
      ),
      req(
        'capacity',
        'Guest capacity',
        'min',
        12,
        'Can the room accommodate 12 seated people?',
        'count',
      ),
      req(
        'period',
        'Visit window',
        'window',
        { start: at('17:00'), end: at('19:00'), minimumMinutes: 120 },
        'Is this room available for the entire requested visit window?',
      ),
      req(
        'budget',
        'Total venue fee',
        'max',
        20000,
        'What is the all-in room fee including required charges and taxes?',
        'USD',
      ),
      req(
        'access',
        'Step-free entry',
        'boolean',
        true,
        'Is there a step-free route from the entrance to this room?',
      ),
      req(
        'whiteboard',
        'Whiteboard',
        'boolean',
        true,
        'Is a whiteboard available in the room?',
        'none',
        'preference',
      ),
    ],
  };
}

/** Switching the intended transaction deliberately changes the evidence scope. */
export function withAcquisition(task: Task, acquisition: 'rental' | 'purchase'): Task {
  if (task.template !== 'rental') return task;
  const defaults = defaultTask('rental');
  const requirements = task.requirements
    .filter((r) => acquisition === 'rental' || !['deposit', 'upfront'].includes(r.id))
    .map((r) => {
      if (r.id === 'budget')
        return {
          ...r,
          label: acquisition === 'purchase' ? 'Purchase total' : 'Rental cost',
          question:
            acquisition === 'purchase'
              ? 'What is the all-in purchase price, including taxes and mandatory fees? This is a purchase, not a rental.'
              : 'What is the total nonrefundable rental cost including taxes and fees?',
        };
      if (r.id === 'period' && typeof r.value === 'object')
        return {
          ...r,
          label: acquisition === 'purchase' ? 'Collection window' : 'Rental period',
          question:
            acquisition === 'purchase'
              ? 'Is this exact item available to buy and collect within the requested collection window?'
              : 'Is the exact item available for the entire requested rental period?',
          value: {
            ...r.value,
            minimumMinutes:
              acquisition === 'purchase'
                ? 15
                : Math.min(1440, (Date.parse(r.value.end) - Date.parse(r.value.start)) / 60000),
          },
        };
      if (r.id === 'hdmi')
        return { ...r, question: `Is an HDMI cable included with this ${acquisition}?` };
      return r;
    });
  if (acquisition === 'rental')
    for (const id of ['deposit', 'upfront']) {
      if (!requirements.some((r) => r.id === id))
        requirements.push(defaults.requirements.find((r) => r.id === id)!);
    }
  return { ...task, acquisition, requirements };
}

/** Bounded offline helper: suggests fields, never claims to understand every request. */
export function draftFromText(
  template: Task['template'],
  text: string,
): { task: Task; notes: string[] } {
  const task = defaultTask(template);
  task.description = text;
  task.title = text.length > 65 ? `${text.slice(0, 62)}…` : text || task.title;
  const notes = [
    'Starter fields are suggestions. Review the exact service, dates, and every condition before checking.',
  ];
  const budget = text.match(
    /(?:up to|under|budget(?: of)?|maximum|max)\s*\$\s*(\d+(?:\.\d{1,2})?)/i,
  );
  if (budget)
    task.requirements.find((r) => r.id === 'budget')!.value = Math.round(Number(budget[1]) * 100);
  if (
    !text
      .toLowerCase()
      .includes(
        template === 'repair' ? 'backpack' : template === 'rental' ? 'projector' : 'meeting',
      )
  )
    notes.push(
      'This request differs from the sample. Replace the starter item/service and select suitable recipients. Fictional responses describe only the sample scenario.',
    );
  return { task, notes };
}
