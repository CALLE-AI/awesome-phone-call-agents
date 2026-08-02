// Stateless do-not-call suppression guard, sibling of lib/calling-window.js.
// Zapier actions have no durable storage available to them, so the list is
// supplied fresh on every call rather than persisted - inventing storage
// would be worse than being honest that there isn't any. Supplying a list is
// the opt-in, exactly like calling_window_timezone: no list means no
// enforcement, and preserves prior behavior.

import { maskPhone } from './redact.js';

const MIN_SUFFIX_DIGITS = 7;

const notSupplied = () => ({
  enforced: false,
  suppressed: false,
  reason: 'No suppression list supplied; suppression not enforced.',
  matchedEntry: null,
});

// "Fail closed" for this control means refusing to dial, not allowing the
// call through - the opposite of what "fail closed" means for a check whose
// job is to permit calls. A list that cannot even be read as text is treated
// as if every number were on it.
const unreadable = () => ({
  enforced: true,
  suppressed: true,
  reason: 'Suppression list could not be read as text; failing closed and refusing to dial.',
  matchedEntry: null,
});

function parseEntries(suppressionList) {
  return suppressionList
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function onlyDigits(value) {
  return String(value).replace(/\D/g, '');
}

// Comparison is digits-only per the whole point of this feature: a list that
// misses a differently-formatted copy of the same number is worse than none.
// Suffix matching additionally catches a national-format entry against an
// E.164 target (or vice versa), but never below MIN_SUFFIX_DIGITS, or a short
// entry could suppress unrelated numbers.
function digitsMatch(targetDigits, entryDigits) {
  if (!targetDigits || !entryDigits) return false;
  if (targetDigits === entryDigits) return true;
  const shorter = targetDigits.length <= entryDigits.length ? targetDigits : entryDigits;
  const longer = targetDigits.length <= entryDigits.length ? entryDigits : targetDigits;
  if (shorter.length < MIN_SUFFIX_DIGITS) return false;
  return longer.endsWith(shorter);
}

// maskPhone only recognizes a leading "+" or an unambiguous bare 10-digit
// domestic run; a bare digit string of any other length (for example the
// 11-digit "15550123456" this feature's own docs give as a valid entry) is
// not international-looking or 10-digit-domestic-looking to it and would
// pass through unmasked. Normalizing a bare non-10-digit run to look
// international before masking keeps the "never leak raw digits" guarantee
// for every entry shape this feature accepts, not just the ones maskPhone's
// regex already anticipated.
function maskEntry(rawEntry) {
  const isBareDigits = /^\d+$/.test(rawEntry);
  const candidate = isBareDigits && rawEntry.length !== 10 ? `+${rawEntry}` : rawEntry;
  return maskPhone(candidate);
}

export function checkSuppression({ phone, suppressionList } = {}) {
  try {
    if (suppressionList === undefined || suppressionList === null) return notSupplied();
    if (typeof suppressionList !== 'string') return unreadable();
    if (!suppressionList.trim()) return notSupplied();

    const entries = parseEntries(suppressionList);
    if (entries.length === 0) return notSupplied();

    const targetDigits = onlyDigits(phone);
    const match = entries.find((entry) => digitsMatch(targetDigits, onlyDigits(entry)));

    if (match) {
      return {
        enforced: true,
        suppressed: true,
        reason: 'Recipient phone number matched an entry on the supplied do-not-call suppression list.',
        matchedEntry: maskEntry(match),
      };
    }

    return {
      enforced: true,
      suppressed: false,
      reason: 'Suppression list supplied; recipient phone number did not match any entry.',
      matchedEntry: null,
    };
  } catch {
    return unreadable();
  }
}
