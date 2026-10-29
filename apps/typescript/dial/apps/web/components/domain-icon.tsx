import {
  PhoneCallIcon,
  BriefcaseIcon,
  CardIcon,
  CalendarIcon,
  TargetIcon,
  MessageIcon,
  RefreshIcon,
  SearchIcon,
} from './icons';

/**
 * A mark for the kind of business a task was about.
 *
 * SVG, not emoji. The obvious version of this is a wrench and a hospital and a
 * car, but emoji render as somebody else's artwork at somebody else's colour
 * and change shape between platforms -- and there is no emoji for "upholstery
 * repair", so the fallback would look like a bug rather than a default.
 *
 * `domain` is free-form by design, so this matches on what the string
 * contains rather than switching on a closed set: an unfamiliar domain gets
 * the neutral search mark, which is honest about not recognising it.
 */
const RULES: Array<{ match: RegExp; Icon: typeof PhoneCallIcon }> = [
  { match: /repair|mechanic|garage|plumb|electric|fix|maintenance|locksmith/i, Icon: RefreshIcon },
  { match: /health|medical|dental|dentist|doctor|clinic|pharmac|vet/i, Icon: TargetIcon },
  { match: /restaurant|food|cafe|coffee|bakery|catering|grocer|butcher/i, Icon: MessageIcon },
  { match: /hotel|travel|flight|taxi|transport|rental|car/i, Icon: BriefcaseIcon },
  { match: /appointment|booking|salon|barber|spa|beauty/i, Icon: CalendarIcon },
  { match: /shop|store|retail|supplier|price|quote/i, Icon: CardIcon },
  { match: /call|phone|contact/i, Icon: PhoneCallIcon },
];

export function DomainIcon({ domain, size = 18 }: { domain: string | null; size?: number }) {
  const rule = domain ? RULES.find((r) => r.match.test(domain)) : undefined;
  const Icon = rule?.Icon ?? SearchIcon;
  return <Icon size={size} />;
}
