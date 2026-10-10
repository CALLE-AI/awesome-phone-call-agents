import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import type { UserSettings } from '@dial/schemas';
import { api } from '../../lib/api';
import { spacing } from '../../lib/theme';
import { Card, SectionLabel, Notice, Field, ChoiceRow, ToggleRow, Loading } from '../../components/ui';

/**
 * How Dial behaves once someone picks up.
 *
 * Voicemail sits here rather than with the disclosure settings, matching the
 * web: it is a decision about what happens on a call, not about which of your
 * details Dial may repeat.
 */

const VOICEMAIL = [
  { value: 'allow', label: 'Leave one' },
  { value: 'ask', label: 'Ask first' },
  { value: 'never', label: 'Never' },
];

export default function CallingSettingsScreen() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .getSettings()
      .then(setSettings)
      .catch(() => setError('Could not load your settings.'));
  }, []);

  // Each change is saved as it is made: a phone screen has no room for a save
  // button that has to be scrolled back to, and a half-applied policy is
  // worse than a slow one.
  async function patch(next: Partial<UserSettings>) {
    if (!settings) return;
    setSaving(true);
    setSettings({ ...settings, ...next } as UserSettings);
    try {
      setSettings(await api.updateSettings(next));
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
        <SectionLabel>On the call</SectionLabel>
        <Field
          label="Language Dial should speak"
          value={settings.callingLanguage}
          onChangeText={(value) => setSettings({ ...settings, callingLanguage: value })}
          maxLength={20}
          autoCapitalize="none"
          onBlur={() => void patch({ callingLanguage: settings.callingLanguage })}
          hint="Used when Dial cannot tell what the business speaks from where it is. Saved when you leave the field."
        />
        <ChoiceRow
          label="Leaving a voicemail"
          hint="When nobody picks up and the machine answers."
          value={settings.policy.leaveVoicemail}
          options={VOICEMAIL}
          disabled={saving}
          onChange={(value) =>
            void patch({
              policy: { ...settings.policy, leaveVoicemail: value } as UserSettings['policy'],
            })
          }
        />
      </Card>

      <Card>
        <SectionLabel>Before Dial starts</SectionLabel>
        <ToggleRow
          label="Ask me a few questions first"
          hint="The answers measurably improve who gets called and what they get asked."
          value={settings.askClarifyingQuestions}
          disabled={saving}
          onValueChange={(value) => void patch({ askClarifyingQuestions: value })}
        />
      </Card>
    </ScrollView>
  );
}
