const { getPerson } = require('./organization');

function getContactedPeople(task) {
  return new Set(
    (task?.history || [])
      .filter((item) => item.type === 'call_attempt' || item.type === 'call_result' || item.type === 'call_plan' || item.type === 'call_started')
      .map((item) => item.personId)
      .filter(Boolean)
  );
}

function scorePerson(task, person) {
  if (!person) {
    return -999;
  }

  const contacted = getContactedPeople(task);
  if (contacted.has(person.id)) {
    return -1000;
  }

  const currentNeed = (task.currentNeed || task.goal || '').toLowerCase();
  const text = `${task.goal || ''} ${person.role || ''} ${person.responsibilities?.join(' ') || ''} ${person.canDecide?.join(' ') || ''}`.toLowerCase();

  let score = 0;

  // Delivery exception scenario canonical progression
  const isDelivery = (task.type === 'delivery_exception') ||
    (task.goal || '').toLowerCase().includes('delivery') ||
    (task.goal || '').toLowerCase().includes('shipment');

  if (isDelivery) {
    const hasArjun = contacted.has('arjun');
    const hasAmit = contacted.has('amit');
    const hasPriya = contacted.has('priya');

    if (!hasArjun && person.role === 'Driver') {
      score += 100;
    } else if (hasArjun && !hasAmit && person.role === 'Warehouse Manager') {
      score += 90;
    } else if (hasAmit && !hasPriya && person.role === 'Operations Head') {
      score += 80;
    } else if (hasPriya && person.role === 'Customer') {
      score += 70;
    }
  }

  if (currentNeed && text.includes(currentNeed.replace(/[^a-z0-9 ]/g, ' '))) {
    score += 25;
  }

  if (person.responsibilities?.some((responsibility) => text.includes(responsibility.toLowerCase()))) {
    score += 25;
  }

  if (person.role === 'Driver' && currentNeed.includes('vehicle')) score += 18;
  if (person.role === 'Warehouse Manager' && currentNeed.includes('replacement')) score += 24;
  if (person.role === 'Operations Head' && currentNeed.includes('approval')) score += 22;
  if (person.role === 'Customer' && currentNeed.includes('delivery')) score += 12;

  const roleFallback = {
    'Warehouse Manager': 18,
    Driver: 16,
    'Operations Head': 14,
    Customer: 10
  };

  if (person.role && roleFallback[person.role]) {
    score += roleFallback[person.role];
  }

  if ((currentNeed.includes('approval') || currentNeed.includes('cost')) && person.authority && person.authority.extraCostLimit) {
    score += 15;
  }

  if (task.participants && task.participants.some((participant) => participant.id === person.id)) {
    score += 10;
  }

  if (person.connections?.length) {
    score += 5;
  }

  return score;
}

function chooseNextPerson(task) {
  const contacted = getContactedPeople(task);
  const candidates = [];

  for (const participant of task.participants || []) {
    if (contacted.has(participant.id)) continue;

    const person = getPerson(participant.id) || participant;
    if (!person) continue;

    candidates.push({
      person,
      score: scorePerson(task, person)
    });
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].person;
}

function getPersonSelectionRationale(task, person) {
  if (!person) return 'No eligible person remaining in workflow.';

  if (person.role === 'Driver') {
    return `${person.name} (Driver) was identified as the initial point of contact to verify on-ground vehicle status, current coordinates, and exact failure condition.`;
  }

  if (person.role === 'Warehouse Manager') {
    return `${person.name} (Warehouse Manager) was selected because the delivery requires an immediate replacement vehicle and dispatch schedule verification.`;
  }

  if (person.role === 'Operations Head') {
    return `${person.name} (Operations Head) was selected because replacement vehicle costs require operational budget authorization up to ₹2,000.`;
  }

  if (person.role === 'Customer') {
    return `${person.name} (Customer) was selected to verify and confirm the revised 17:00 delivery window before final order handover.`;
  }

  return `${person.name} (${person.role}) has matching authority and responsibilities for: "${task.currentNeed || task.goal}".`;
}

function createCallPurpose(task, person) {
  const goalText = (task.goal || '').toLowerCase();

  if (person.role === 'Driver') {
    return 'Confirm the current delivery problem, vehicle condition, and estimated recovery time.';
  }

  if (person.role === 'Warehouse Manager') {
    return 'Confirm whether a replacement vehicle is available and how quickly it can be dispatched.';
  }

  if (person.role === 'Operations Head') {
    return 'Request approval if the proposed resolution requires spending beyond the configured limit.';
  }

  if (person.role === 'Customer' || goalText.includes('delivery')) {
    return 'Confirm the revised customer delivery plan and verify the latest acceptable arrival window.';
  }

  return 'Provide the information needed to resolve the current business task.';
}

function interpretCallResult(result) {
  const status = result?.status || result?.result?.status || 'COMPLETED';

  if ((status || '').toUpperCase() === 'FAILED') {
    const outcome = (result?.outcome || result?.result?.outcome || '').toLowerCase();

    if (outcome.includes('no_answer') || outcome.includes('no answer')) {
      return { state: 'PERSON_UNAVAILABLE', nextAction: 'TRY_NEXT_PERSON' };
    }

    return { state: 'CALL_FAILED', nextAction: 'RETRY_OR_ESCALATE' };
  }

  if ((status || '').toUpperCase() === 'NO_ANSWER' || (status || '').toUpperCase() === 'NO ANSWER') {
    return { state: 'PERSON_UNAVAILABLE', nextAction: 'TRY_NEXT_PERSON' };
  }

  const outcome = (result?.outcome || result?.result?.outcome || '').toLowerCase();

  if (outcome.includes('vehicle_problem') || outcome.includes('driver')) {
    return { state: 'DISPATCH_COORDINATION', nextAction: 'CONTACT_WAREHOUSE', nextNeed: 'replacement vehicle dispatch' };
  }

  if (outcome.includes('replacement_available') || outcome.includes('cost')) {
    return { state: 'WAITING_FOR_APPROVAL', nextAction: 'APPROVAL_REVIEW', nextNeed: 'operations budget approval' };
  }

  if (outcome.includes('approval_granted')) {
    return { state: 'CUSTOMER_CONFIRMATION', nextAction: 'NOTIFY_CUSTOMER', nextNeed: 'customer ETA acceptance' };
  }

  if (outcome.includes('delivery_confirmed') || outcome.includes('confirmed')) {
    return { state: 'RESOLVED', nextAction: 'TASK_RESOLVED', nextNeed: 'completed' };
  }

  return { state: 'PROCESSING_RESULT', nextAction: 'RESOLVE_OR_ESCALATE' };
}

module.exports = {
  getContactedPeople,
  scorePerson,
  chooseNextPerson,
  getPersonSelectionRationale,
  createCallPurpose,
  interpretCallResult
};