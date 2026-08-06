import { routines } from "../carecall/fixtures";
import { useSeniorDirectory } from "../carecall/senior-directory-context";
import type { AttentionCase, CareRoutine } from "../carecall/types";
import { Icon } from "../components/Icon";
import { RoutineIcon, SeniorAvatar } from "../components/CarePrimitives";

export function NeedsAttention({ cases, onPreview, onNotice, resolvedIds, onResolve }: { cases: AttentionCase[]; onPreview: (routine: CareRoutine) => void; onNotice: (message: string) => void; resolvedIds: Set<string>; onResolve: (caseId: string) => void }) {
  const { seniors } = useSeniorDirectory();
  return (
    <div className="page">
      <header className="page-intro page-intro--compact">
        <div>
          <p className="eyebrow">Exception-only workspace</p>
          <h1>Needs Attention</h1>
          <p className="page-summary">Only cases where a human decision or follow-up is useful.</p>
        </div>
        <div className="attention-summary"><strong>{cases.filter((item) => !resolvedIds.has(item.id)).length}</strong><span>Open cases</span></div>
      </header>

      <div className="attention-layout">
        <section className="attention-list" aria-label="Open care cases">
          {cases.map((item) => {
            const senior = seniors.find((candidate) => candidate.id === item.seniorId)!;
            const routine = routines.find((candidate) => candidate.id === item.routineId)!;
            const isAcknowledged = resolvedIds.has(item.id);
            return (
              <article className="surface case-card" data-priority={item.priority} data-resolved={isAcknowledged} key={item.id}>
                <header>
                  <span className="case-priority"><span aria-hidden="true" />{isAcknowledged ? "Follow-up recorded" : item.priorityLabel}</span>
                  <time>{item.createdAt}</time>
                </header>
                <div className="case-card__body">
                  <SeniorAvatar initials={senior.initials} tone={senior.avatar} />
                  <div className="case-card__copy">
                    <p>{senior.preferredName} · {routine.title}</p>
                    <h2>{item.title}</h2>
                    <p>{item.context}</p>
                    <div className="next-action"><Icon name="sparkle" size={17} /><span><strong>Suggested next action</strong>{item.nextAction}</span></div>
                  </div>
                </div>
                <footer>
                  <button
                    className="primary-button"
                    disabled={isAcknowledged}
                    type="button"
                    onClick={() => {
                      onResolve(item.id);
                      onNotice(`Follow-up marked in this demo session for ${senior.preferredName}. No external care record was changed.`);
                    }}
                  >
                    <Icon name="check" size={17} />
                    {isAcknowledged ? "Follow-up recorded" : "Record follow-up"}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => onPreview(routine)}>Review call plan</button>
                  <button className="quiet-button" type="button" onClick={() => onNotice(`${senior.caregiver} is the authorized primary escalation contact.`)}>View Care Circle</button>
                </footer>
              </article>
            );
          })}
        </section>

        <aside className="surface triage-guide">
          <div className="triage-guide__icon"><Icon name="heart" size={20} /></div>
          <h2>Human judgment stays in the loop.</h2>
          <p>CareCall identifies exceptions; your care team decides what happens next.</p>
          <ul>
            <li><span data-tone="urgent" /> Contact now</li>
            <li><span data-tone="today" /> Follow up today</li>
            <li><span data-tone="review" /> Review when available</li>
          </ul>
          <div className="triage-guide__boundary">
            <Icon name="info" size={18} />
            <p>CareCall does not dispatch emergency services. For an immediate emergency in Singapore, contact 995.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
