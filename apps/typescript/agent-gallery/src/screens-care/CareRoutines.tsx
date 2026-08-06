import { useMemo, useState } from "react";
import { useRoutineDirectory } from "../carecall/routine-directory-context";
import { routineKindOrder, routineKindProfile } from "../carecall/routine-kinds";
import { useSeniorDirectory } from "../carecall/senior-directory-context";
import { seniorIsCallable } from "../carecall/senior-directory";
import type { CareRoutine, RoutineKind } from "../carecall/types";
import { Icon } from "../components/Icon";
import { RoutineIcon, SeniorAvatar } from "../components/CarePrimitives";

type Filter = "all" | RoutineKind;

export function CareRoutines({ onPreview, onNotice, onNewRoutine, sessionToken }: { onPreview: (routine: CareRoutine) => void; onNotice: (message: string) => void; onNewRoutine: () => void; sessionToken: string }) {
  const { seniors } = useSeniorDirectory();
  const { routines } = useRoutineDirectory();
  const [filter, setFilter] = useState<Filter>("all");
  // Overrides rather than a paused set, so a routine that was created paused
  // reads as paused until someone resumes it. A set alone would show every new
  // routine as active while its own next-call line says it is not scheduled.
  const [pauseOverrides, setPauseOverrides] = useState<Record<string, boolean>>({});
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());
  const visibleRoutines = useMemo(
    () => routines.filter((routine) => filter === "all" || routine.kind === filter),
    [filter, routines],
  );

  const isPaused = (routine: CareRoutine) => pauseOverrides[routine.id] ?? routine.status === "paused";

  async function setScheduleState(routine: CareRoutine, status: "active" | "paused" | "cancelled") {
    if (status === "cancelled" && !window.confirm(`Cancel ${routine.title}? The stored phone number will be removed and a new authorization will be required to schedule it again.`)) return;
    const willResume = isPaused(routine);
    if (sessionToken) {
      const response = await fetch("/api/carecall/schedules", { method: "PATCH", headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" }, body: JSON.stringify({ schedule_id: `schedule-${routine.id}`, status }) });
      if (!response.ok) { onNotice("The durable schedule could not be changed. No scheduler state was assumed."); return; }
    }
    if (status === "cancelled") {
      setPauseOverrides((current) => ({ ...current, [routine.id]: true }));
      setCancelledIds((current) => new Set(current).add(routine.id));
      onNotice(`${routine.title} schedule cancelled. Its stored phone ciphertext was removed; new authorization is required to schedule it again.`);
      return;
    }
    setPauseOverrides((current) => ({ ...current, [routine.id]: !willResume }));
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
        <button className="primary-button" type="button" onClick={onNewRoutine}>
          <Icon name="plus" size={18} />
          New routine
        </button>
      </header>

      <div className="routine-toolbar">
        <div className="segmented-control" aria-label="Filter routines">
          {(["all", ...routineKindOrder] as const).map((value) => (
            <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value)} type="button">
              {value === "all" ? "All" : routineKindProfile(value).label}
            </button>
          ))}
        </div>
        <p>{visibleRoutines.filter((routine) => !isPaused(routine) && !cancelledIds.has(routine.id) && seniorIsCallable(seniors.find((candidate) => candidate.id === routine.seniorId))).length} active in this demo session</p>
      </div>

      <section className="routine-grid" aria-label="Care routines">
        {visibleRoutines.map((routine) => {
          const senior = seniors.find((candidate) => candidate.id === routine.seniorId)!;
          const withdrawn = !seniorIsCallable(senior);
          const paused = isPaused(routine) || withdrawn;
          const cancelled = cancelledIds.has(routine.id);
          return (
            <article className="surface routine-card" data-paused={paused} key={routine.id}>
              <header>
                <RoutineIcon kind={routine.kind} />
                <span className="routine-type">{routineKindProfile(routine.kind).callLabel}</span>
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
