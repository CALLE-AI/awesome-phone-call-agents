import { useState } from "react";
import { Icon } from "../components/Icon";

export function Settings({ onNotice, onSafetyPolicy }: { onNotice: (message: string) => void; onSafetyPolicy: () => void }) {
  const [dailyDigest, setDailyDigest] = useState(true);
  const [weekendCalls, setWeekendCalls] = useState(true);

  return (
    <div className="page page--settings">
      <header className="page-intro page-intro--compact">
        <div>
          <p className="eyebrow">Care team configuration</p>
          <h1>Settings</h1>
          <p className="page-summary">Organisation defaults for safe, transparent care calling.</p>
        </div>
      </header>

      <div className="settings-layout">
        <nav className="surface settings-nav" aria-label="Settings sections">
          <a href="#organisation" className="settings-nav__active"><Icon name="home" size={18} /> Organisation <Icon name="chevron" size={16} /></a>
          <a href="#calling"><Icon name="phone" size={18} /> Calling preferences <Icon name="chevron" size={16} /></a>
          <a href="#privacy"><Icon name="shield" size={18} /> Privacy & safety <Icon name="chevron" size={16} /></a>
          <a href="#team"><Icon name="users" size={18} /> Care team <Icon name="chevron" size={16} /></a>
        </nav>

        <div className="settings-content">
          <section className="surface settings-section" id="organisation">
            <header><div className="settings-icon"><Icon name="home" size={19} /></div><div><h2>Organisation</h2><p>Identity and regional defaults shown to operators.</p></div></header>
            <div className="settings-row"><span><strong>Organisation name</strong><small>Appears in CareCall's operator workspace</small></span><button className="value-button" type="button">Queenstown Care Team <Icon name="chevron" size={16} /></button></div>
            <div className="settings-row"><span><strong>Timezone</strong><small>Used for every schedule and audit timestamp</small></span><span className="setting-value">Asia/Singapore (SGT)</span></div>
            <div className="settings-row"><span><strong>Operator language</strong><small>The MVP workspace remains in English</small></span><span className="setting-value">English</span></div>
          </section>

          <section className="surface settings-section" id="calling">
            <header><div className="settings-icon"><Icon name="phone" size={19} /></div><div><h2>Calling preferences</h2><p>Defaults can be narrowed for each senior.</p></div></header>
            <div className="settings-row"><span><strong>Default quiet hours</strong><small>No scheduled reminders during this window</small></span><button className="value-button" type="button">8:00 PM–8:00 AM <Icon name="chevron" size={16} /></button></div>
            <label className="settings-row settings-row--toggle"><span><strong>Weekend calls</strong><small>Demo preference only; no scheduler is connected</small></span><input checked={weekendCalls} onChange={(event) => { setWeekendCalls(event.target.checked); onNotice(`Weekend-call preference changed for this demo session only.`); }} type="checkbox" role="switch" /></label>
            <label className="settings-row settings-row--toggle"><span><strong>Exception-only daily digest</strong><small>Demo preference only; no digest is sent</small></span><input checked={dailyDigest} onChange={(event) => { setDailyDigest(event.target.checked); onNotice(`Daily-digest preference changed for this demo session only.`); }} type="checkbox" role="switch" /></label>
          </section>

          <section className="surface settings-section" id="privacy">
            <header><div className="settings-icon"><Icon name="shield" size={19} /></div><div><h2>Privacy & safety</h2><p>Care data stays purpose-limited and visible to authorized roles.</p></div></header>
            <div className="privacy-points">
              <div><Icon name="check" size={17} /><span><strong>Phone numbers masked by default</strong><small>Full numbers appear only where required to manage authorization.</small></span></div>
              <div><Icon name="check" size={17} /><span><strong>No hidden recurring schedules</strong><small>Every active routine is visible, pausable, and cancellable.</small></span></div>
              <div><Icon name="check" size={17} /><span><strong>Medical uncertainty goes to a human</strong><small>The agent never recommends a dose, repeat, skip, or medication change.</small></span></div>
            </div>
            <div className="settings-actions"><button className="secondary-button" type="button" onClick={onSafetyPolicy}><Icon name="shield" size={16} /> View safety policy</button><button className="secondary-button" type="button" onClick={() => onNotice("Privacy controls are documented in the CareCall SG implementation plan.")}>Review data policy</button></div>
          </section>

          <section className="surface settings-section" id="team">
            <header><div className="settings-icon"><Icon name="users" size={19} /></div><div><h2>Care team</h2><p>Only authorized roles can view seniors and prepare calls.</p></div></header>
            <div className="team-member-row"><span className="operator-avatar">MC</span><span><strong>Mei Chen</strong><small>Care coordinator · Full workspace access</small></span><span className="verified-label"><Icon name="shield" size={15} /> Active</span></div>
            <div className="team-member-row"><span className="operator-avatar operator-avatar--green">NA</span><span><strong>Nur Aisyah</strong><small>Care coordinator · Assigned seniors only</small></span><span className="verified-label"><Icon name="shield" size={15} /> Active</span></div>
            <button className="secondary-button" type="button" onClick={() => onNotice("Care-team invitations require administrator approval.")}><Icon name="plus" size={16} /> Invite team member</button>
          </section>
        </div>
      </div>
    </div>
  );
}
