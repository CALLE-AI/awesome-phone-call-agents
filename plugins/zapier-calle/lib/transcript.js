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
