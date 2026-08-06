import { useEffect, useMemo, useRef, useState } from "react";
import { routines } from "../carecall/fixtures";
import { useSeniorDirectory } from "../carecall/senior-directory-context";
import { routineIsSchedulable, seniorIsCallable, withdrawalImpact } from "../carecall/senior-directory";
import type { AttentionCase, CareRoutine, SeniorEdit } from "../carecall/types";
import { Icon } from "../components/Icon";
import { RoutineIcon, SectionHeading, SeniorAvatar } from "../components/CarePrimitives";
import { SeniorEditSheet } from "../components/SeniorEditSheet";
import { SeniorWithdrawSheet } from "../components/SeniorWithdrawSheet";

interface SeniorsProps {
  selectedId: string;
  attentionCases: AttentionCase[];
  resolvedIds: Set<string>;
  onSelect: (seniorId: string) => void;
  onPreview: (routine: CareRoutine) => void;
  onNotice: (message: string) => void;
}

const withdrawalDate = () => new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium" }).format(new Date());

export function Seniors({ selectedId, attentionCases, resolvedIds, onSelect, onPreview, onNotice }: SeniorsProps) {
  const { seniors, editSenior, withdrawSeniorFromCare, restoreSeniorToCare } = useSeniorDirectory();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const selected = seniors.find((senior) => senior.id === selectedId) ?? seniors[0];
  const selectedRoutines = routines.filter((routine) => routine.seniorId === selected.id);
  const callable = seniorIsCallable(selected);

  const visibleSeniors = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return seniors;
    return seniors.filter((senior) => `${senior.name} ${senior.preferredName} ${senior.caregiver}`.toLowerCase().includes(term));
  }, [query, seniors]);

  const openCaseCount = attentionCases.filter((item) => item.seniorId === selected.id && !resolvedIds.has(item.id)).length;
  const impact = withdrawalImpact(selected.id, selectedRoutines, openCaseCount);

  useEffect(() => { setMenuOpen(false); }, [selected.id]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node) || menuButtonRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  /**
   * Focus the menu button before the sheet mounts. The dialog restores whatever
   * was focused when it opened, and the menu item that opened it is gone by
   * then, so without this the invoking control cannot be restored on close.
   */
  function openSheet(next: () => void) {
    menuButtonRef.current?.focus();
    setMenuOpen(false);
    next();
  }

  function saveEdit(edit: SeniorEdit) {
    editSenior(selected.id, edit);
    setEditing(false);
    onNotice(`${edit.preferredName}'s record was updated for this demo session.`);
  }

  function withdraw() {
    withdrawSeniorFromCare(selected.id, withdrawalDate());
    setWithdrawing(false);
    onNotice(`${selected.preferredName} was withdrawn from care calls. Routines stopped; history was kept.`);
  }

  function restore() {
    restoreSeniorToCare(selected.id);
    setMenuOpen(false);
    onNotice(`${selected.preferredName} was restored to active care. Routines still need to be resumed individually.`);
  }

  return (
    <div className="page page--seniors">
      <header className="page-intro page-intro--compact">
        <div>
          <p className="eyebrow">Care directory</p>
          <h1>Seniors</h1>
          <p className="page-summary">People enrolled in caregiver-authorized care calls.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => onNotice("Senior enrolment requires caregiver authority and is part of the next implementation pass.")}>
          <Icon name="plus" size={18} />
          Add senior
        </button>
      </header>

      <div className="master-detail">
        <section className="surface master-list" aria-label="Enrolled seniors">
          <div className="master-list__head">
            <label className="search-field">
              <span className="sr-only">Search seniors</span>
              <Icon name="search" size={18} />
              <input onChange={(event) => setQuery(event.target.value)} placeholder="Search seniors" type="search" value={query} />
            </label>
            <span>{visibleSeniors.filter((senior) => senior.status === "active").length} in care</span>
          </div>
          <div className="senior-list">
            {visibleSeniors.map((senior) => (
              <button
                aria-current={senior.id === selected.id ? "true" : undefined}
                className="senior-row"
                data-selected={senior.id === selected.id}
                data-withdrawn={senior.status === "withdrawn"}
                key={senior.id}
                onClick={() => onSelect(senior.id)}
                type="button"
              >
                <SeniorAvatar initials={senior.initials} tone={senior.avatar} />
                <span className="senior-row__copy">
                  <strong>{senior.preferredName}</strong>
                  <span>
                    {senior.status === "withdrawn"
                      ? `Withdrawn ${senior.withdrawnOn ?? ""}`.trim()
                      : `${senior.nextReminderLabel} · ${senior.nextReminder.replace("Today, ", "")}`}
                  </span>
                </span>
                {senior.status === "withdrawn" && <span className="withdrawn-badge">Withdrawn</span>}
                {senior.attentionCount > 0 && <span className="count-badge" aria-label={`${senior.attentionCount} item needs attention`}>{senior.attentionCount}</span>}
                <Icon name="chevron" size={17} />
              </button>
            ))}
            {visibleSeniors.length === 0 && <p className="master-list__empty">No senior matches “{query.trim()}”.</p>}
          </div>
        </section>

        <section className="surface senior-detail" aria-labelledby="senior-detail-name">
          <header className="senior-profile-head">
            <SeniorAvatar initials={selected.initials} tone={selected.avatar} size="large" />
            <div>
              <p className="eyebrow">Senior profile</p>
              <h2 id="senior-detail-name">{selected.name}</h2>
              <p>Prefers “{selected.preferredName}” · {selected.language}</p>
            </div>
            <div className="senior-actions">
              <button
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label={`More options for ${selected.preferredName}`}
                className="icon-button"
                onClick={() => setMenuOpen((open) => !open)}
                ref={menuButtonRef}
                type="button"
              >
                <Icon name="more" />
              </button>
              {menuOpen && (
                <div className="action-menu" ref={menuRef} role="menu">
                  <button onClick={() => openSheet(() => setEditing(true))} role="menuitem" type="button">
                    <Icon name="routine" size={17} /> Edit information
                  </button>
                  {callable
                    ? (
                      <button className="action-menu__danger" onClick={() => openSheet(() => setWithdrawing(true))} role="menuitem" type="button">
                        <Icon name="attention" size={17} /> Withdraw from care
                      </button>
                    )
                    : (
                      <button onClick={restore} role="menuitem" type="button">
                        <Icon name="check" size={17} /> Restore to active care
                      </button>
                    )}
                </div>
              )}
            </div>
          </header>

          {!callable && (
            <section className="withdrawn-notice" role="status">
              <Icon name="attention" size={19} />
              <div>
                <strong>Withdrawn from care calls{selected.withdrawnOn ? ` on ${selected.withdrawnOn}` : ""}.</strong>
                <p>No routine is scheduled and no new call can be authorized. Call history and open care cases are kept.</p>
              </div>
            </section>
          )}

          <dl className="profile-facts">
            <div>
              <dt>Permitted call window</dt>
              <dd><Icon name="clock" size={17} /> {selected.callWindow}</dd>
            </div>
            <div>
              <dt>Primary caregiver</dt>
              <dd><Icon name="users" size={17} /> {selected.caregiver} · {selected.caregiverRelationship}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd><Icon name="phone" size={17} /> {selected.phoneMasked}</dd>
            </div>
            <div>
              <dt>Last contact</dt>
              <dd><Icon name="check" size={17} /> {selected.lastContact}</dd>
            </div>
          </dl>

          <div className="profile-section">
            <SectionHeading
              title="Care routines"
              action={<button className="text-button" type="button" onClick={() => onNotice("The routine builder is ready for the next implementation pass.")}><Icon name="plus" size={16} /> Add routine</button>}
            />
            <div className="profile-routines">
              {selectedRoutines.map((routine) => (
                <article className="profile-routine" data-unavailable={!routineIsSchedulable(selected, routine)} key={routine.id}>
                  <RoutineIcon kind={routine.kind} />
                  <div>
                    <h3>{routine.title}</h3>
                    <p>{routine.schedule}</p>
                    <span>{callable ? `Next: ${routine.nextRun}` : "Stopped · senior withdrawn"}</span>
                  </div>
                  <button className="secondary-button" disabled={!callable} type="button" onClick={() => onPreview(routine)}>Preview</button>
                </article>
              ))}
            </div>
          </div>

          <div className="profile-section care-circle">
            <SectionHeading title="Care Circle" />
            <div className="care-circle__row">
              <span className="contact-avatar" aria-hidden="true">{selected.caregiver.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
              <div>
                <strong>{selected.caregiver}</strong>
                <span>{selected.caregiverRelationship} · Primary escalation</span>
              </div>
              <span className="verified-label"><Icon name="shield" size={15} /> Authorized</span>
            </div>
          </div>
        </section>
      </div>

      {editing && (
        <SeniorEditSheet
          senior={selected}
          onClose={() => setEditing(false)}
          onSave={saveEdit}
        />
      )}
      {withdrawing && (
        <SeniorWithdrawSheet
          impact={impact}
          senior={selected}
          onClose={() => setWithdrawing(false)}
          onWithdraw={withdraw}
        />
      )}
    </div>
  );
}
