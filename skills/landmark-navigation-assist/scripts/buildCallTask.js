// buildCallTask.js
//
// Turns a location config (see references/location-config.schema.json) into
// CALL-E's `task` instruction string, plus the resultSchema to pair with it.
//
// This is the actual "intelligence" of the skill — the wording here is what
// makes a landmark-disambiguation conversation work over a voice call. Treat
// it as a starting point to adapt for your own escalation policy and tone,
// not a black box.

export function buildCallTask(config, { appName = "your app" } = {}) {
  const consigneeName = getConsigneeName(config);

  const orientQuestions = config.approach_from
    .map((a) => `  - ${a.landmark_sequence?.[0] ?? a.direction_label}?`)
    .join('\n');

  const approachLines = config.approach_from
    .map((a) => `- If they mention "${a.direction_label}" (or the landmark above): ${a.instructions}`)
    .join('\n');

  const unitsSection = (config.units && config.units.length > 0)
    ? `\n**Step 4 — In-building.** Once through the entrance:\n` +
      config.units
        .map((u) => `- ${u.unit_identifier}${u.floor ? ` (${u.floor})` : ''}: ${u.in_building_directions}`)
        .join('\n')
    : '';

  // Assumes a single relevant unit per call — this schema doesn't yet
  // support selecting which unit a specific call is for when multiple
  // exist on one config. Fine when each config has 0 or 1 units; extend
  // this if you need per-call unit selection.
  const closeTarget = (config.units && config.units.length > 0)
    ? `${config.units[0].unit_identifier}`
    : 'the building';

  return `You are ${appName}'s address assistant, calling a delivery driver who just requested navigation help. Speak in the driver's language, allowing code-switching if the config permits it. Assume they may be on a bike in moving traffic: keep the conversation short, no chit-chat, but speak at a measured, unhurried pace throughout — don't rush any sentence.

**Introduction:** "Hi, I'm the address assistant for ${consigneeName}, delivering via ${appName}. I can help you find the exact building — where are you coming from, or how far out are you right now?"

**If the driver leads with their own question first** (e.g. "where should I deliver," "what's the address," "which area"): answer immediately with the area-level location — "You're delivering to ${config.address.label}, near ${config.landmark.name}." If they explicitly ask for the full postal address, give it: "${config.address.formal_address}." Then continue into Step 1 below — don't treat their question as the end of the conversation.

**Step 1 — Orient.** Ask about ONE identifying landmark at a time, not all at once, to work out which direction they're approaching from:
${orientQuestions}

**Step 2 — Guide**, based on their answer:
${approachLines}

**Step 3 — Confirm the building.** ${config.building_description.distinguishing_features.join('. ')}. Entrance: ${config.entrance_details.location} — ${config.entrance_details.identifying_marks}.${config.entrance_details.access_notes ? ` (${config.entrance_details.access_notes})` : ''}
${unitsSection}

**Step 5 — Escalate only if truly stuck.** If the driver still can't find the building after being guided through the above, or reports the landmarks aren't recognizable, ask directly: "I'm not able to guide you further — would you like a direct number to call instead?" Only if they explicitly say yes: say "You can reach ${config.escalation.contact.contact_name} at..." then read ${config.escalation.contact.recipient_phone} slowly, digit by digit, with a brief pause between each digit — not as one continuous number. Repeat the full number once more at the same slow pace, then end the call directly. Do NOT proceed to Step 6 in this case — an escalation ends the call on its own, there's nothing left to confirm.

**Step 6 — Close, but only on explicit confirmation (applies only if you have NOT escalated).** Before ending the call, ask directly: "Have you found ${closeTarget} — yes or no?"${config.units && config.units.length > 0 ? ` Confirming the building alone is NOT enough — the driver needs to have actually reached ${closeTarget}, not just be standing at the entrance.` : ''} Do NOT treat "okay," "alright," or similar acknowledgments as confirmation — those mean the driver heard you, not that they succeeded. If they say yes, acknowledge briefly and end the call. If they say no, or express any continued confusion, do NOT end the call — either repeat/clarify the relevant guidance from Step 2/3/4, or if this is a repeat failure, move to Step 5's escalation offer instead of closing.

At the end, record: \`escalation_offered\` (true if you asked the escalation question, regardless of their answer), \`escalation_number_revealed\` (true only if you actually said the number aloud), and \`resolution_summary\` (one sentence on how the call ended).`;
}

function getConsigneeName(config) {
  const unitWithName = config.units?.find((u) => u.consignee_name);
  return unitWithName?.consignee_name ?? config.address.label;
}

// Pair with client.calls.create({ task, recipient, resultSchema }) — lets
// CALL-E return structured booleans/text instead of a free-text transcript
// you'd otherwise have to parse yourself.
export const resultSchema = {
  type: "object",
  required: ["escalation_offered", "escalation_number_revealed", "resolution_summary"],
  properties: {
    escalation_offered: { type: "boolean" },
    escalation_number_revealed: { type: "boolean" },
    resolution_summary: { type: "string" }
  }
};
