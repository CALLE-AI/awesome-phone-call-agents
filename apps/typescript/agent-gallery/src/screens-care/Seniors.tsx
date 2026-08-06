import { routines, seniors } from "../carecall/fixtures";
import type { CareRoutine } from "../carecall/types";
import { Icon } from "../components/Icon";
import { RoutineIcon, SectionHeading, SeniorAvatar } from "../components/CarePrimitives";

interface SeniorsProps {
  selectedId: string;
  onSelect: (seniorId: string) => void;
  onPreview: (routine: CareRoutine) => void;
}

export function Seniors({ selectedId, onSelect, onPreview }: SeniorsProps) {
  const selected = seniors.find((senior) => senior.id === selectedId) ?? seniors[0];
  const selectedRoutines = routines.filter((routine) => routine.seniorId === selected.id);

  return (
    <div className="page page--seniors">
      <header className="page-intro page-intro--compact">
        <div>
          <p className="eyebrow">Care directory</p>
          <h1>Seniors</h1>
          <p className="page-summary">People enrolled in caregiver-authorized care calls.</p>
        </div>
        <button className="primary-button" type="button">
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
              <input type="search" placeholder="Search seniors" />
            </label>
            <span>{seniors.length} enrolled</span>
          </div>
          <div className="senior-list">
            {seniors.map((senior) => (
              <button
                aria-current={senior.id === selected.id ? "true" : undefined}
                className="senior-row"
                data-selected={senior.id === selected.id}
                key={senior.id}
                onClick={() => onSelect(senior.id)}
                type="button"
              >
                <SeniorAvatar initials={senior.initials} tone={senior.avatar} />
                <span className="senior-row__copy">
                  <strong>{senior.preferredName}</strong>
                  <span>{senior.nextReminderLabel} · {senior.nextReminder.replace("Today, ", "")}</span>
                </span>
                {senior.attentionCount > 0 && <span className="count-badge" aria-label={`${senior.attentionCount} item needs attention`}>{senior.attentionCount}</span>}
                <Icon name="chevron" size={17} />
              </button>
            ))}
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
            <button className="icon-button" aria-label={`More options for ${selected.preferredName}`} type="button">
              <Icon name="more" />
            </button>
          </header>

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
              action={<button className="text-button" type="button"><Icon name="plus" size={16} /> Add routine</button>}
            />
            <div className="profile-routines">
              {selectedRoutines.map((routine) => (
                <article className="profile-routine" key={routine.id}>
                  <RoutineIcon kind={routine.kind} />
                  <div>
                    <h3>{routine.title}</h3>
                    <p>{routine.schedule}</p>
                    <span>Next: {routine.nextRun}</span>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => onPreview(routine)}>Preview</button>
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
    </div>
  );
}
