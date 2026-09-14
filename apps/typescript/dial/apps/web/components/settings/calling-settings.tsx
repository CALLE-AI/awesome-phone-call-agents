'use client';

import type { UserSettings } from '@dial/schemas';
import { useSettingsDraft, SaveBar, Choice, Toggle, DISCLOSURE } from './settings-kit';

/**
 * How Dial behaves once someone picks up.
 *
 * Voicemail lives here rather than with the disclosure settings: it is a
 * decision about what happens on the call, not about which of your details
 * Dial may repeat.
 */
export function CallingSettings({ initial }: { initial: UserSettings }) {
  const { settings, set, setPolicy, save, status, error } = useSettingsDraft(initial);

  return (
    <>
      <section className="card">
        <div className="card-label">On the call</div>

        <div className="field">
          <label htmlFor="calling-language">Language Dial should speak</label>
          <p className="field-hint">
            Used when Dial cannot tell what the business speaks from where it is.
          </p>
          <input
            id="calling-language"
            value={settings.callingLanguage}
            onChange={(event) => set('callingLanguage', event.target.value)}
            maxLength={20}
          />
        </div>

        <Choice
          label="Leaving a voicemail"
          hint="When nobody picks up and the machine answers."
          value={settings.policy.leaveVoicemail}
          options={DISCLOSURE.map((o) =>
            o.value === 'allow' ? { value: 'allow', label: 'Leave one' } : o,
          )}
          onChange={(v) => setPolicy('leaveVoicemail', v as never)}
        />
      </section>

      <section className="card">
        <div className="card-label">Before Dial starts</div>
        <Toggle
          label="Ask me a few questions first"
          hint="The answers measurably improve who gets called and what they get asked. Turn this off if you would rather Dial just went."
          checked={settings.askClarifyingQuestions}
          onChange={(next) => set('askClarifyingQuestions', next)}
        />
      </section>

      <SaveBar
        status={status}
        error={error}
        onSave={() =>
          void save({
            callingLanguage: settings.callingLanguage,
            askClarifyingQuestions: settings.askClarifyingQuestions,
            policy: { leaveVoicemail: settings.policy.leaveVoicemail } as UserSettings['policy'],
          })
        }
      />
    </>
  );
}
