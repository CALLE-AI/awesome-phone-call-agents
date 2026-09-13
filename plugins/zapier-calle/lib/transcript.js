// Shared transcript access. CALL-E nests turns two levels deep
// (recipients[].attempts[].transcript_turns[]), and three call sites needed
// the same defensive walk, so it lives here once.

export function transcriptTurns(recipients) {
  return (Array.isArray(recipients) ? recipients : [])
    .flatMap((recipient) => (recipient && recipient.attempts) || [])
    .flatMap((attempt) => (attempt && attempt.transcript_turns) || [])
    .filter((turn) => turn && typeof turn === 'object');
}

export function transcriptText(recipients) {
  return transcriptTurns(recipients)
    .map((turn) => `${turn.speaker}: ${turn.text}`)
    .join('\n');
}

// The last thing the recipient actually said. When a call is routed to a
// human, this is almost always the line they need to read: the answer that
// was too vague, the hedge, the question the agent could not resolve. It is
// what makes a Slack approval message reviewable in one glance instead of
// requiring someone to open the full transcript.
export function lastUserTurn(recipients) {
  const turns = transcriptTurns(recipients).filter(
    (turn) => turn.speaker === 'user' && typeof turn.text === 'string' && turn.text.trim() !== '',
  );
  return turns.length > 0 ? turns[turns.length - 1] : null;
}

// Compares spoken text on letters, digits and single spaces, so punctuation,
// casing and spacing cannot defeat a match. Apostrophes are deleted rather
// than turned into a space, so "don't" collapses to "dont"; every other
// separator becomes a space, so "stop-calling" and "stop   calling" both
// normalize the same. Both straight and curly apostrophes count -
// speech-to-text output routinely contains the curly one.
//
// Shared by lib/opt-out.js and lib/grounding.js, which both have to decide
// whether one piece of text appears inside another piece of speech.
export function normalizeSpeech(text) {
  return String(text)
    .toLowerCase()
    .replace(/['‘’ʼ`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
