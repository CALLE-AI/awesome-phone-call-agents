/**
 * build_call_goal.js
 *
 * Turns a resident profile into a CALL-E call goal string.
 * Follows the pattern validated in hackathon testing:
 *  - warm, immediate opening naming the caller identity (no dead air)
 *  - one topic, one sample question
 *  - references family and one personal detail when they come up naturally
 *  - explicit distress handling: redirect, never correct or argue
 *  - explicit graceful ending after two stalled attempts or no answer
 *
 * Usage:
 *   node build_call_goal.js res_001
 *   (reads scripts/residents.json, prints the goal string for that resident id)
 */

const fs = require("fs");
const path = require("path");

function loadResidents() {
  const dataPath = path.join(__dirname, "residents.json");
  const raw = fs.readFileSync(dataPath, "utf8");
  return JSON.parse(raw).residents;
}

function pastCallSummary(resident) {
  if (!resident.callHistory || resident.callHistory.length === 0) {
    return null;
  }
  const last = resident.callHistory[resident.callHistory.length - 1];
  if (last && last.topicsCovered && last.topicsCovered.length > 0) {
    return `Last time you spoke about ${last.topicsCovered.join(", ")}.`;
  }
  return null;
}

function buildCallGoal(resident) {
  const language = resident.language || "English";
  const isNonEnglish = language !== "English";

  const topic = resident.topics[0];
  const topicLabel = isNonEnglish && topic.labelTranslated ? topic.labelTranslated : topic.label;
  const topicQuestion = isNonEnglish && topic.sampleQuestionTranslated ? topic.sampleQuestionTranslated : topic.sampleQuestion;

  const family = resident.familyReferences && resident.familyReferences[0];
  const other = resident.otherReferences && resident.otherReferences[0];

  const opener = isNonEnglish && resident.openerTranslated
    ? resident.openerTranslated
    : `Hi ${resident.name}, this is ${resident.callerIdentity}, I hope you are having a good day.`;

  const pronoun = resident.pronoun || "their";
  const followUpMention = [];
  if (family) {
    const relation = isNonEnglish && family.relationTranslated ? family.relationTranslated : family.relation;
    followUpMention.push(`${family.name}, ${pronoun} ${relation}`);
  }
  if (other) {
    const label = isNonEnglish && other.labelTranslated ? other.labelTranslated : other.label;
    followUpMention.push(label);
  }
  const mentionClause = followUpMention.length > 0
    ? `If ${resident.name} mentions ${followUpMention.join(" or ")}, gently bring that up too and ask a light follow-up about it.`
    : "";

  const recall = pastCallSummary(resident);
  const recallClause = recall ? ` ${recall} You can gently reference this if it fits naturally.` : "";

  // The opener and the topic question are what CALL-E is likely to speak
  // close to verbatim, so those are provided in the resident's own
  // language when available (via *Translated fields in residents.json).
  // The behavioral instructions below (distress handling, closing,
  // etc.) are guidance for the agent's judgment, not text to read
  // aloud, so they stay in English regardless of call language, the
  // `language` parameter passed to CALL-E separately controls what
  // language the actual conversation happens in.
  const languageNote = isNonEnglish
    ? `Conduct this entire call in ${language}. ${resident.name} speaks ${language} as a first language, and hearing it can make old memories easier to access. `
    : "";

  const goal = [
    languageNote + `You are calling ${resident.name} for a warm, brief reminiscence chat.`,
    `Introduce yourself immediately and clearly: "${opener}"`,
    `Do not pause silently, keep talking naturally from the first second.`,
    `Ask about ${topicLabel}, something like "${topicQuestion}"`,
    `Listen to the answer and ask one warm, specific follow-up question.`,
    mentionClause,
    `If ${resident.name} seems confused, repeats themselves anxiously, or seems distressed, do not correct them. Gently redirect to something calm and familiar. If distress continues, warmly end the call and let them know someone will check in with them soon.`,
    `If there is no clear answer, nobody answers, or the call seems to be going nowhere after two attempts, end the call warmly and briefly and report the outcome.`,
    recallClause,
  ].filter(Boolean).join(" ");

  return goal;
}

// CLI entry point
if (require.main === module) {
  const residentId = process.argv[2];
  if (!residentId) {
    console.error("Usage: node build_call_goal.js <resident_id>");
    process.exit(1);
  }
  const residents = loadResidents();
  const resident = residents.find((r) => r.id === residentId);
  if (!resident) {
    console.error(`No resident found with id ${residentId}`);
    process.exit(1);
  }
  console.log(buildCallGoal(resident));
}

module.exports = { buildCallGoal, pastCallSummary, loadResidents };
