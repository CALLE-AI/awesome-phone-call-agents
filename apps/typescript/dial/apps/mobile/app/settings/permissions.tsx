import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import type { UserSettings } from '@dial/schemas';
import { api } from '../../lib/api';
import { spacing } from '../../lib/theme';
import { Card, SectionLabel, Notice, Field, ChoiceRow, Loading } from '../../components/ui';

/**
 * What Dial may do on your behalf, and what it may repeat about you.
 *
 * Every choice is enforced on the server against the stored row; this screen
 * only edits that row, so a phone that lied about its own policy would gain
 * nothing.
 */

const AUTOMATION = [
  { value: 'automatic', label: 'Automatically' },
  { value: 'ask', label: 'Ask first' },
  { value: 'never', label: 'Never' },
];

const DISCLOSURE = [
  { value: 'allow', label: 'Share it' },
  { value: 'ask', label: 'Ask first' },
  { value: 'never', label: 'Never' },
];

const ASK_OR_NEVER = [
  { value: 'ask', label: 'Ask first' },
  { value: 'never', label: 'Never' },
];

export default function PermissionsScreen() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .getSettings()
      .then(setSettings)
      .catch(() => setError('Could not load your settings.'));
  }, []);

  async function setPolicy(key: keyof UserSettings['policy'], value: unknown) {
    if (!settings) return;
    const policy = { ...settings.policy, [key]: value } as UserSettings['policy'];
    setSaving(true);
    setSettings({ ...settings, policy });
    try {
      setSettings(await api.updateSettings({ policy }));
      setError(null);
    } catch {
      setError('Could not save that change.');
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return error ? (
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Notice tone="danger">{error}</Notice>
      </ScrollView>
    ) : (
      <Loading />
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card>
        <SectionLabel>What Dial may do</SectionLabel>
        <ChoiceRow
          label="Gathering information"
          hint="Looking things up and asking businesses questions."
          value={settings.policy.informationGathering}
          options={AUTOMATION}
          disabled={saving}
          onChange={(v) => void setPolicy('informationGathering', v)}
        />
        <ChoiceRow
          label="Making phone calls"
          hint="Dial cannot do anything useful without this."
          value={settings.policy.phoneInquiries}
          options={AUTOMATION}
          disabled={saving}
          onChange={(v) => void setPolicy('phoneInquiries', v)}
        />
        <ChoiceRow
          label="Reservations that need no payment"
          hint="Booking a table, for example."
          value={settings.policy.reservationsWithoutPayment}
          options={AUTOMATION}
          disabled={saving}
          onChange={(v) => void setPolicy('reservationsWithoutPayment', v)}
        />
        <ChoiceRow
          label="Appointments"
          value={settings.policy.appointments}
          options={AUTOMATION}
          disabled={saving}
          onChange={(v) => void setPolicy('appointments', v)}
        />
        <ChoiceRow
          label="Purchases and anything you would pay for"
          hint="Dial always asks before this. It cannot be set to automatic."
          value={settings.policy.purchases}
          options={ASK_OR_NEVER}
          disabled={saving}
          onChange={(v) => void setPolicy('purchases', v)}
        />
        <Field
          label={`Most Dial may commit you to without asking again (${settings.policy.spendCurrency})`}
          value={String(settings.policy.maxAuthorizedSpend)}
          keyboardType="number-pad"
          onChangeText={(value) =>
            setSettings({
              ...settings,
              policy: {
                ...settings.policy,
                maxAuthorizedSpend: Number(value.replace(/[^0-9]/g, '')) || 0,
              } as UserSettings['policy'],
            })
          }
          onBlur={() => void setPolicy('maxAuthorizedSpend', settings.policy.maxAuthorizedSpend)}
        />
      </Card>

      <Card>
        <SectionLabel>What Dial may say about you</SectionLabel>
        <ChoiceRow
          label="Your phone number"
          value={settings.policy.sharePhoneNumber}
          options={DISCLOSURE}
          disabled={saving}
          onChange={(v) => void setPolicy('sharePhoneNumber', v)}
        />
        <ChoiceRow
          label="Your address"
          value={settings.policy.shareAddress}
          options={DISCLOSURE}
          disabled={saving}
          onChange={(v) => void setPolicy('shareAddress', v)}
        />
        <ChoiceRow
          label="Medical information"
          hint="Dial asks every time, whatever this is set to."
          value={settings.policy.shareMedicalInformation}
          options={ASK_OR_NEVER}
          disabled={saving}
          onChange={(v) => void setPolicy('shareMedicalInformation', v)}
        />
      </Card>
    </ScrollView>
  );
}
