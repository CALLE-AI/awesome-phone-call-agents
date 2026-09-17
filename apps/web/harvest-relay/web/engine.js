const knownNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value) => knownNumber(value) && value >= 0;
const knownRange = (min, max) => knownNumber(min) && knownNumber(max) && min <= max;

function moneyCents(value) {
  if (!nonnegative(value)) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) < 0.0000001 ? cents : null;
}

export function formatTime(minutes) {
  if (!nonnegative(minutes)) return '—';
  const whole = Math.floor(minutes);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function checkProvider(provider, kind, lot, now, reasons) {
  const name = provider.name || `Unknown ${kind}`;
  if (typeof provider.id !== 'string' || !provider.id.trim()) {
    reasons.push(`${name}: provider reference is missing or invalid.`);
  }
  if (provider.status !== 'confirmed') reasons.push(`${name}: quote is not confirmed.`);
  if (!nonnegative(provider.valid_until_min)) {
    reasons.push(`${name}: quote expiry is missing or invalid.`);
  } else if (nonnegative(now) && provider.valid_until_min <= now) {
    reasons.push(`${name}: quote expired at ${formatTime(provider.valid_until_min)}.`);
  }
  if (Object.hasOwn(provider, 'valid_from_min')) {
    if (!nonnegative(provider.valid_from_min)) {
      reasons.push(`${name}: quote start time is invalid.`);
    } else if (nonnegative(now) && provider.valid_from_min > now) {
      reasons.push(`${name}: quote is not yet valid; it starts at ${formatTime(provider.valid_from_min)}.`);
    }
    if (nonnegative(provider.valid_from_min) && nonnegative(provider.valid_until_min)
      && provider.valid_from_min >= provider.valid_until_min) {
      reasons.push(`${name}: quote validity window is invalid.`);
    }
  }
  if (!nonnegative(provider.capacity_kg)) {
    reasons.push(`${name}: full-load capacity is missing or invalid.`);
  } else if (knownNumber(lot.quantity_kg) && lot.quantity_kg > provider.capacity_kg) {
    reasons.push(`${name}: capacity is ${provider.capacity_kg} kg; the full lot requires ${lot.quantity_kg} kg.`);
  }
  if (!knownRange(provider.min_temp_c, provider.max_temp_c)) {
    reasons.push(`${name}: temperature range is missing or invalid.`);
  } else if (knownRange(lot.min_temp_c, lot.max_temp_c)
    && (provider.min_temp_c < lot.min_temp_c || provider.max_temp_c > lot.max_temp_c)) {
    reasons.push(`${name}: temperature range ${provider.min_temp_c}–${provider.max_temp_c}°C is outside the requested ${lot.min_temp_c}–${lot.max_temp_c}°C.`);
  }
  if (moneyCents(provider.cost_usd) === null) reasons.push(`${name}: quoted price is missing or invalid.`);
}

function comparePairs(a, b) {
  return a.cost_usd - b.cost_usd || a.handoff_min - b.handoff_min
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Compose full-lot operational handoffs from the supplied facts.
 * Feasibility is a proposal for review, not a booking or food-safety finding.
 * Minutes share the scenario's local time origin; no date or timezone conversion occurs.
 */
export function evaluatePairs(scenario, overrides = {}) {
  const input = scenario && typeof scenario === 'object' ? scenario : {};
  const changes = overrides && typeof overrides === 'object' ? overrides : {};
  const lot = { ...input.lot };
  for (const field of ['quantity_kg', 'latest_arrival_min', 'budget_usd']) {
    if (Object.hasOwn(changes, field)) lot[field] = changes[field];
  }
  const now = input.now_min;
  const lotReasons = [];
  if (!nonnegative(now)) lotReasons.push('Evaluation time is missing or invalid; quote freshness is unknown.');
  if (!knownNumber(lot.quantity_kg) || lot.quantity_kg <= 0) {
    lotReasons.push('Lot quantity must be a known, positive number of kilograms.');
  }
  if (!knownRange(lot.min_temp_c, lot.max_temp_c)) lotReasons.push('Requested temperature range is missing or invalid.');
  if (!nonnegative(lot.latest_arrival_min)) lotReasons.push('Lot deadline is missing or invalid.');
  const budgetCents = moneyCents(lot.budget_usd);
  if (budgetCents === null) lotReasons.push('Lot budget is missing or invalid.');
  const unavailable = changes.unavailable_storage_ids ?? [];
  if (!Array.isArray(unavailable) || unavailable.some((id) => typeof id !== 'string')) {
    lotReasons.push('Unavailable storage selection is invalid.');
  }
  const unavailableIds = new Set(Array.isArray(unavailable) ? unavailable : []);
  const storages = Array.isArray(input.storages) ? input.storages : [];
  const carriers = Array.isArray(input.carriers) ? input.carriers : [];
  const pairs = [];

  for (const storageEntry of storages) {
    const storage = storageEntry || {};
    for (const carrierEntry of carriers) {
      const carrier = carrierEntry || {};
      const reasons = [...lotReasons];
      checkProvider(storage, 'storage', lot, now, reasons);
      checkProvider(carrier, 'carrier', lot, now, reasons);
      if (unavailableIds.has(storage.id)) reasons.push(`${storage.name || 'Storage'} is unavailable in this scenario.`);

      const receivingKnown = nonnegative(storage.receive_from_min) && nonnegative(storage.receive_until_min)
        && storage.receive_from_min <= storage.receive_until_min;
      if (!receivingKnown) reasons.push(`${storage.name || 'Storage'}: receiving window is missing or invalid.`);
      const pickupKnown = nonnegative(carrier.pickup_min);
      if (!pickupKnown) reasons.push(`${carrier.name || 'Carrier'}: pickup time is missing or invalid.`);
      else if (nonnegative(now) && carrier.pickup_min < now) {
        reasons.push(`${carrier.name || 'Carrier'}: pickup at ${formatTime(carrier.pickup_min)} is in the past.`);
      }
      const travel = carrier.travel_min?.[storage.id];
      const travelKnown = nonnegative(travel);
      if (!travelKnown) reasons.push(`Travel time from ${carrier.name || 'carrier'} to ${storage.name || 'storage'} is missing or invalid.`);

      let arrival = null;
      if (pickupKnown && travelKnown) {
        const computed = carrier.pickup_min + travel;
        if (knownNumber(computed)) arrival = computed;
        else reasons.push('Computed arrival time is outside the supported numeric range.');
      }
      const handoff = arrival !== null && receivingKnown ? Math.max(arrival, storage.receive_from_min) : null;
      if (handoff !== null && handoff > storage.receive_until_min) {
        reasons.push(`Handoff at ${formatTime(handoff)} misses ${storage.name || 'storage'} receiving cutoff at ${formatTime(storage.receive_until_min)}.`);
      }
      const slack = handoff !== null && nonnegative(lot.latest_arrival_min) ? lot.latest_arrival_min - handoff : null;
      if (slack !== null && slack < 0) {
        reasons.push(`Handoff at ${formatTime(handoff)} misses the lot deadline at ${formatTime(lot.latest_arrival_min)}${arrival < handoff ? ' after waiting for receiving to open' : ''}.`);
      }

      const storageCents = moneyCents(storage.cost_usd);
      const carrierCents = moneyCents(carrier.cost_usd);
      let cost = null;
      if (storageCents !== null && carrierCents !== null) {
        const sum = storageCents + carrierCents;
        if (!Number.isSafeInteger(sum)) reasons.push('Combined quote price is outside the supported numeric range.');
        else {
          cost = sum / 100;
          if (budgetCents !== null && sum > budgetCents) {
            reasons.push(`Combined quote $${cost.toFixed(2)} exceeds the $${lot.budget_usd.toFixed(2)} budget.`);
          }
        }
      }

      pairs.push({
        id: `${storage.id ?? 'unknown-storage'}--${carrier.id ?? 'unknown-carrier'}`,
        storage_id: storage.id ?? null,
        carrier_id: carrier.id ?? null,
        storage_name: storage.name || 'Unknown storage',
        carrier_name: carrier.name || 'Unknown carrier',
        cost_usd: cost,
        arrival_min: arrival,
        handoff_min: handoff,
        slack_min: slack,
        feasible: reasons.length === 0,
        reasons,
      });
    }
  }

  const feasible = pairs.filter((candidate) => candidate.feasible).sort(comparePairs);
  return { pairs, feasible, best: feasible[0] ?? null, lot };
}
