import { useMemo, useState } from "react";
import { routines } from "../carecall/fixtures";
import { useSeniorDirectory } from "../carecall/senior-directory-context";
import { seniorIsCallable } from "../carecall/senior-directory";
import type { CareRoutine, RoutineKind } from "../carecall/types";
import { Icon } from "../components/Icon";
import { RoutineIcon, SeniorAvatar } from "../components/CarePrimitives";

type Filter = "all" | RoutineKind;

export function CareRoutines({ onPreview, onNotice, sessionToken }: { onPreview: (routine: CareRoutine) => void; onNotice: (message: string) => void; sessionToken: string }) {
  const { seniors } = useSeniorDirectory();
  const [filter, setFilter] = useState<Filter>("all");
  const [pausedIds, setPausedIds] = useState<Set<string>>(new Set());
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());
  const visibleRoutines = useMemo(
    () => routines.filter((routine) => filter === "all" || routine.kind === filter),
    [filter],
  );

  async function setScheduleState(routine: CareRoutine, status: "active" | "paused" | "cancelled") {
    if (status === "cancelled" && !window.confirm(`Cancel ${routine.title}? The stored phone number will be removed and a new authorization will be required to schedule it again.`)) return;
    const willResume = pausedIds.has(routine.id);
    if (sessionToken) {
      const response = await fetch("/api/carecall/schedules", { method: "PATCH", headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" }, body: JSON.stringify({ schedule_id: `schedule-${routine.id}`, status }) });
      if (!response.ok) { onNotice("The durable schedule could not be changed. No scheduler state was assumed."); return; }
    }
    if (status === "cancelled") {
      setPausedIds((current) => new Set(current).add(routine.id));
      setCancelledIds((current) => new Set(current).add(routine.id));
      onNotice(`${routine.title} schedule cancelled. Its stored phone ciphertext was removed; new authorization is required to schedule it again.`);
      return;
    }
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
      ? `${routine.title} resumed${sessionToken ? " in the durable scheduler" : " for this demo session"}.`
      : `${routine.title} paused${sessionToken ? " in the durable scheduler" : " for this demo session"}.`);
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
        <p>{visibleRoutines.filter((routine) => !pausedIds.has(routine.id) && !cancelledIds.has(routine.id) && seniorIsCallable(seniors.find((candidate) => candidate.id === routine.seniorId))).length} active in this demo session</p>
      </div>

      <section className="routine-grid" aria-label="Care routines">
        {visibleRoutines.map((routine) => {
          const senior = seniors.find((candidate) => candidate.id === routine.seniorId)!;
          const withdrawn = !seniorIsCallable(senior);
          const paused = pausedIds.has(routine.id) || withdrawn;
          const cancelled = cancelledIds.has(routine.id);
          return (
            <article className="surface routine-card" data-paused={paused} key={routine.id}>
              <header>
                <RoutineIcon kind={routine.kind} />
                <span className="routine-type">{routine.kind === "medication" ? "Medication reminder" : "Meal check-in"}</span>
                <span className="schedule-state" data-state={cancelled ? "cancelled" : paused ? "paused" : "active"}>
                  <span aria-hidden="true" /> {cancelled ? "Cancelled" : withdrawn ? "Senior withdrawn" : paused ? "Paused" : "Active"}
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
                  <dd>{cancelled ? "Authorization removed" : withdrawn ? "Stopped · senior withdrawn from care" : paused ? "Not scheduled while paused" : routine.nextRun}</dd>
                </div>
              </dl>
              <footer>
                <button className="secondary-button" type="button" onClick={() => onPreview(routine)}>Preview call</button>
                {!cancelled && !withdrawn && <button className="quiet-button" type="button" onClick={() => void setScheduleState(routine, paused ? "active" : "paused")}>{paused ? "Resume" : "Pause"}</button>}
                {sessionToken && !cancelled && !withdrawn && <button className="quiet-button" type="button" onClick={() => void setScheduleState(routine, "cancelled")}>Cancel</button>}
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
