'use client';

import type { UserSettings } from '@dial/schemas';
import { useSettingsDraft, SaveBar, Choice, AUTOMATION, DISCLOSURE } from './settings-kit';

/**
 * What Dial may do on your behalf, and what it may repeat about you.
 *
 * Every choice here is enforced on the server against the stored row; this
 * form only edits that row. A client that lies about its own policy gains
 * nothing.
 */
export function PermissionsSettings({ initial }: { initial: UserSettings }) {
  const { settings, setPolicy, save, status, error } = useSettingsDraft(initial);

  return (
    <>
      <section className="card">
        <div className="card-label">What Dial may do</div>

        <Choice
          label="Gathering information"
          hint="Looking things up and asking businesses questions."
          value={settings.policy.informationGathering}
          options={AUTOMATION}
          onChange={(v) => setPolicy('informationGathering', v as never)}
        />
        <Choice
          label="Making phone calls"
          hint="Dial cannot do anything useful without this."
          value={settings.policy.phoneInquiries}
          options={AUTOMATION}
          onChange={(v) => setPolicy('phoneInquiries', v as never)}
        />
        <Choice
          label="Reservations that need no payment"
          hint="Booking a table, for example."
          value={settings.policy.reservationsWithoutPayment}
          options={AUTOMATION}
          onChange={(v) => setPolicy('reservationsWithoutPayment', v as never)}
        />
        <Choice
          label="Appointments"
          value={settings.policy.appointments}
          options={AUTOMATION}
          onChange={(v) => setPolicy('appointments', v as never)}
        />
        <Choice
          label="Purchases and anything you would have to pay for"
          hint="Dial always asks before this — it cannot be set to automatic."
          value={settings.policy.purchases}
          options={[
            { value: 'ask', label: 'Ask me first' },
            { value: 'never', label: 'Never' },
          ]}
          onChange={(v) => setPolicy('purchases', v as never)}
        />

        <div className="field">
          <label htmlFor="spend">
            Most Dial may commit you to without asking again ({settings.policy.spendCurrency})
          </label>
          <input
            id="spend"
            type="number"
            min={0}
            step="1"
            value={settings.policy.maxAuthorizedSpend}
            onChange={(event) =>
              setPolicy('maxAuthorizedSpend', Number(event.target.value) as never)
            }
          />
        </div>
      </section>

      <section className="card">
        <div className="card-label">What Dial may say about you</div>
        <Choice
          label="Your phone number"
          value={settings.policy.sharePhoneNumber}
          options={DISCLOSURE}
          onChange={(v) => setPolicy('sharePhoneNumber', v as never)}
        />
        <Choice
          label="Your address"
          value={settings.policy.shareAddress}
          options={DISCLOSURE}
          onChange={(v) => setPolicy('shareAddress', v as never)}
        />
        <Choice
          label="Medical information"
          hint="Dial asks every time, whatever this is set to."
          value={settings.policy.shareMedicalInformation}
          options={[
            { value: 'ask', label: 'Ask me each time' },
            { value: 'never', label: 'Never' },
          ]}
          onChange={(v) => setPolicy('shareMedicalInformation', v as never)}
        />
      </section>

      <SaveBar
        status={status}
        error={error}
        onSave={() =>
          void save({
            policy: {
              informationGathering: settings.policy.informationGathering,
              phoneInquiries: settings.policy.phoneInquiries,
              reservationsWithoutPayment: settings.policy.reservationsWithoutPayment,
              appointments: settings.policy.appointments,
              purchases: settings.policy.purchases,
              maxAuthorizedSpend: settings.policy.maxAuthorizedSpend,
              sharePhoneNumber: settings.policy.sharePhoneNumber,
              shareAddress: settings.policy.shareAddress,
              shareMedicalInformation: settings.policy.shareMedicalInformation,
            } as UserSettings['policy'],
          })
        }
      />
    </>
  );
}
