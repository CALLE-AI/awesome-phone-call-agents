import type { TaskMission } from '@dial/schemas';

/**
 * What Dial is trying to achieve on this task, and how close it is.
 *
 * Dial has always decided when to stop by goal rather than by count: it keeps
 * ringing businesses until it has enough comparable answers, then stops because
 * more calls would cost money and ring real people for nothing. None of that
 * reasoning was visible. The user saw calls appear one by one and then a
 * result, with no way to tell whether Dial had finished or given up -- and a
 * task that stopped two answers short looked identical to one that succeeded.
 *
 * Every number here is counted from rows that exist. Nothing is projected, and
 * there is no "estimated time remaining": Dial cannot know whether the next
 * business picks up.
 */
export function MissionPanel({ mission }: { mission: TaskMission }) {
  const { evidenceTarget, evidenceSoFar, callsPlaced, callBudget, candidatesFound, callableFound } =
    mission;

  // Capped at the target so an over-delivering task cannot render a bar that
  // overflows its own track.
  const evidencePct = Math.min(100, Math.round((evidenceSoFar / evidenceTarget) * 100));
  const done = evidenceSoFar >= evidenceTarget;
  // A stop reason is only set once the task is terminal, so it doubles as the
  // tense: a finished task must not be described as still calling.
  const stopped = Boolean(mission.stopReason);

  return (
    <section className="card mission">
      <div className="card-label">What Dial is doing</div>

      <p className="mission-goal">
        {done
          ? `Dial has the ${evidenceTarget} comparable ${evidenceTarget === 1 ? 'answer' : 'answers'} it needed.`
          : stopped
            ? `Dial was looking for ${evidenceTarget} comparable ${evidenceTarget === 1 ? 'answer' : 'answers'}.`
            : `Dial is calling until ${evidenceTarget} ${evidenceTarget === 1 ? 'business gives' : 'businesses give'} a comparable answer.`}
      </p>

      {/*
        The goal as a bar, because "3 of 5" is a fraction the reader has to do
        arithmetic on and a bar is the same fact already done.
      */}
      <div className="mission-track" role="presentation">
        {Array.from({ length: evidenceTarget }, (_, i) => (
          <span key={i} className="mission-pip" data-filled={i < evidenceSoFar ? 'true' : 'false'} />
        ))}
      </div>
      <p className="mission-count">
        <strong>{evidenceSoFar}</strong> of {evidenceTarget} answers
        <span className="mission-sep">·</span>
        {evidencePct}%
      </p>

      <dl className="mission-stats">
        <div>
          <dt>Businesses called</dt>
          {/* Against the ceiling, so "why did it stop" is answerable at a glance. */}
          <dd>
            {callsPlaced} <span className="mission-of">of {callBudget} max</span>
          </dd>
        </div>
        <div>
          {/*
            Found and callable, together, because the gap between them is what
            decides how far a task gets. Eighteen of twenty shops being shut
            explains a two-call task; "20 found" on its own makes the same task
            look like Dial gave up early.
          */}
          <dt>Businesses found</dt>
          <dd>
            {candidatesFound}
            {candidatesFound > callableFound ? (
              <span className="mission-of"> · {callableFound} reachable</span>
            ) : null}
          </dd>
        </div>
      </dl>

      {mission.stopReason ? (
        <p className="mission-stop">{mission.stopReason}</p>
      ) : (
        <p className="mission-stop" data-live="true">
          Dial stops as soon as it has enough to compare — it will not make calls it does not
          need.
        </p>
      )}
    </section>
  );
}
