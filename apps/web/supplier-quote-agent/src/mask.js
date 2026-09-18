// Masks phone numbers before any task/quote/activity-log data reaches an HTTP response.
// A supplier's real number is operational data the app needs to dial with — it is never
// something a browser tab or activity-log consumer needs to read back in full.

function maskPhone(phone) {
  if (typeof phone !== 'string') {
    return phone;
  }
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 4) {
    return '•'.repeat(phone.length);
  }
  const last = digits.slice(-2);
  const prefix = phone.startsWith('+') ? '+' : '';
  return `${prefix}•••••${last}`;
}

// Every string value under a "phone"/"phones" key, anywhere in the structure — the
// definite set of real numbers this specific payload actually carries.
function collectKnownPhones(value, into) {
  if (Array.isArray(value)) {
    value.forEach((v) => collectKnownPhones(v, into));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      if (key === 'phone' && typeof val === 'string') {
        into.add(val);
      } else if (key === 'phones' && Array.isArray(val)) {
        val.forEach((p) => typeof p === 'string' && into.add(p));
      } else {
        collectKnownPhones(val, into);
      }
    }
  }
}

// A real provider's free-text summary is AI-generated from call evidence — nothing
// guarantees it never recites the number it just dialed. Scrubbing every occurrence of a
// number this payload is already known to carry (not a generic phone-shaped regex, which
// would misfire on prices, SKUs, and timestamps) closes that without inventing false
// positives on unrelated numeric text.
function redactKnownPhones(text, knownPhones) {
  let out = text;
  for (const phone of knownPhones) {
    if (phone) {
      out = out.split(phone).join(maskPhone(phone));
    }
  }
  return out;
}

function maskWithKnownPhones(value, knownPhones) {
  if (Array.isArray(value)) {
    return value.map((v) => maskWithKnownPhones(v, knownPhones));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === 'phone' && typeof val === 'string') {
        out[key] = maskPhone(val);
      } else if (key === 'phones' && Array.isArray(val)) {
        out[key] = val.map((p) => (typeof p === 'string' ? maskPhone(p) : p));
      } else {
        out[key] = maskWithKnownPhones(val, knownPhones);
      }
    }
    return out;
  }
  if (typeof value === 'string') {
    return redactKnownPhones(value, knownPhones);
  }
  return value;
}

// Recursively masks every "phone"/"phones" field, and additionally scrubs any of those
// same numbers if they reappear verbatim in unrelated free text (e.g. a call summary) —
// tasks, quotes, and activity-log entries (whose args/result can embed any of this) all
// share this one pass rather than each route hand-rolling its own field list.
function maskDeep(value) {
  const knownPhones = new Set();
  collectKnownPhones(value, knownPhones);
  return maskWithKnownPhones(value, knownPhones);
}

module.exports = { maskPhone, maskDeep };
