import { useMemo, useState } from "react";
import { routines, seniors } from "../carecall/fixtures";
import type { CareRoutine, RoutineKind } from "../carecall/types";
import { Icon } from "../components/Icon";
import { RoutineIcon, SeniorAvatar } from "../components/CarePrimitives";

type Filter = "all" | RoutineKind;

export function CareRoutines({ onPreview, onNotice }: { onPreview: (routine: CareRoutine) => void; onNotice: (message: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [pausedIds, setPausedIds] = useState<Set<string>>(new Set());
  const visibleRoutines = useMemo(
    () => routines.filter((routine) => filter === "all" || routine.kind === filter),
    [filter],
  );

  function togglePause(routine: CareRoutine) {
    const willResume = pausedIds.has(routine.id);
    setPausedIds((current) => {
      const next = new Set(current);
      if (next.has(routine.id)) {
        next.delete(routine.id);
      } else {
        next.add(routine.id);
      }
      return next;
    });
    onNotice(willResume
      ? `${routine.title} appears resumed for this demo session. No scheduler was changed.`
      : `${routine.title} appears paused for this demo session. No scheduler was changed.`);
  }

  return (
    <div className="page">
      <header className="page-intro page-intro--compact">
        <div>
          <p className="eyebrow">Care schedules</p>
          <h1>Care Routines</h1>
          <p className="page-summary">Caregiver-approved reminders, with every schedule visible and stoppable.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => onNotice("The routine builder is ready for the next implementation pass.")}>
          <Icon name="plus" size={18} />
          New routine
        </button>
      </header>

      <div className="routine-toolbar">
        <div className="segmented-control" aria-label="Filter routines">
          {(["all", "medication", "meal"] as const).map((value) => (
            <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value)} type="button">
              {value === "all" ? "All routines" : value === "medication" ? "Medication" : "Meals"}
            </button>
          ))}
        </div>
        <p>{visibleRoutines.filter((routine) => !pausedIds.has(routine.id)).length} active in this demo session</p>
      </div>

      <section className="routine-grid" aria-label="Care routines">
        {visibleRoutines.map((routine) => {
          const senior = seniors.find((candidate) => candidate.id === routine.seniorId)!;
          const paused = pausedIds.has(routine.id);
          return (
            <article className="surface routine-card" data-paused={paused} key={routine.id}>
              <header>
                <RoutineIcon kind={routine.kind} />
                <span className="routine-type">{routine.kind === "medication" ? "Medication reminder" : "Meal check-in"}</span>
                <span className="schedule-state" data-state={paused ? "paused" : "active"}>
                  <span aria-hidden="true" /> {paused ? "Paused" : "Active"}
                </span>
              </header>
              <h2>{routine.title}</h2>
              <div className="routine-card__senior">
                <SeniorAvatar initials={senior.initials} tone={senior.avatar} size="small" />
                <span>{senior.preferredName}</span>
              </div>
              <p className="routine-card__instruction">{routine.caregiverInstruction}</p>
              <dl className="routine-schedule">
                <div>
                  <dt><Icon name="calendar" size={16} /> Schedule</dt>
                  <dd>{routine.schedule}</dd>
                </div>
                <div>
                  <dt><Icon name="clock" size={16} /> Next call</dt>
                  <dd>{paused ? "Not scheduled while paused" : routine.nextRun}</dd>
                </div>
              </dl>
              <footer>
                <button className="secondary-button" type="button" onClick={() => onPreview(routine)}>Preview call</button>
                <button className="quiet-button" type="button" onClick={() => togglePause(routine)}>{paused ? "Resume" : "Pause"}</button>
              </footer>
            </article>
          );
        })}
      </section>

      <section className="safety-banner">
        <div><Icon name="shield" size={21} /></div>
        <div>
          <h2>CareCall repeats instructions. It does not make medical decisions.</h2>
          <p>Medication uncertainty is always routed to a human. Silence or ambiguity is never recorded as completion.</p>
        </div>
        <button className="text-button" type="button" onClick={() => onNotice("Safety policy: remind, record self-reports, and escalate uncertainty to a human.")}>View safety policy <Icon name="chevron" size={15} /></button>
      </section>
    </div>
  );
}
