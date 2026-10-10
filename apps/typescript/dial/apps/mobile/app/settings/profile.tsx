import { useEffect, useState } from 'react';
import { ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import type { UserSettings } from '@dial/schemas';
import { api, API_URL } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { spacing } from '../../lib/theme';
import {
  Card,
  SectionLabel,
  Notice,
  Field,
  ToggleRow,
  FactRow,
  Button,
  Loading,
} from '../../components/ui';

/** You, your data, and the two ways out of the product. */
export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .getSettings()
      .then(setSettings)
      .catch(() => setError('Could not load your settings.'));
  }, []);

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
        <SectionLabel>You</SectionLabel>
        <FactRow label="Name" value={user?.name ?? '—'} />
        <FactRow label="Email" value={user?.email ?? '—'} />
        {user?.createdAt ? (
          <FactRow label="Member since" value={new Date(user.createdAt).toLocaleDateString()} />
        ) : null}
        <FactRow label="Connected to" value={API_URL} />
      </Card>

      <Card>
        <SectionLabel>Your data</SectionLabel>
        <Field
          label="Keep call transcripts for (days)"
          value={String(settings.transcriptRetentionDays)}
          keyboardType="number-pad"
          onChangeText={(value) =>
            setSettings({
              ...settings,
              transcriptRetentionDays: Number(value.replace(/[^0-9]/g, '')) || 0,
            })
          }
          onBlur={() => void patch({ transcriptRetentionDays: settings.transcriptRetentionDays })}
          hint="Set this to 0 and Dial stores no transcript at all. You still get the summary and the result, but not what was said."
        />
        <ToggleRow
          label="Tell me when a task finishes"
          value={settings.notificationsEnabled}
          disabled={saving}
          onValueChange={(value) => void patch({ notificationsEnabled: value })}
        />
      </Card>

      <Card>
        <SectionLabel>Session</SectionLabel>
        <Button
          label="Sign out"
          onPress={() => {
            void signOut().then(() => router.replace('/sign-in'));
          }}
        />
      </Card>

      <Card>
        <SectionLabel>Delete account</SectionLabel>
        <Notice tone="danger">
          Removes your account, every task, every call record and every transcript. This cannot be
          undone.
        </Notice>
        <Button
          label="Delete my account"
          variant="danger"
          onPress={() =>
            Alert.alert('Delete your account?', 'Everything will be permanently removed.', [
              { text: 'Keep it', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  void api
                    .deleteAccount()
                    .then(() => signOut())
                    .then(() => router.replace('/sign-in'));
                },
              },
            ])
          }
        />
      </Card>
    </ScrollView>
  );
}
