import { useCallback, useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { BusinessListEntry } from '@dial/schemas';
import { api, ApiError } from '../../lib/api';
import { colors, spacing, text } from '../../lib/theme';
import { Card, Button, Notice, SectionLabel, Loading } from '../../components/ui';

/**
 * The businesses this account runs phone work for.
 *
 * With none, this is onboarding rather than an empty table: what CALL-E can
 * do for a business, and one button in. The same three templates the web
 * offers, and no fourth that cannot run.
 */

const WHAT_IT_DOES = [
  { title: 'Appointment reminders', body: 'Confirm appointments automatically.' },
  { title: 'Customer callbacks', body: 'Find a good time to speak with leads and customers.' },
  { title: 'Custom phone jobs', body: 'Describe another job in your own words.' },
];

export default function BusinessTab() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<BusinessListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch on focus: coming back from creating a business or finishing a run
  // should not show the list as it was before.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api
        .listBusinesses()
        .then((r) => alive && setBusinesses(r.businesses))
        .catch((caught) => {
          if (alive) {
            setError(caught instanceof ApiError ? caught.message : 'Could not load your businesses.');
          }
        });
      return () => {
        alive = false;
      };
    }, []),
  );

  if (error) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Notice tone="danger">{error}</Notice>
      </ScrollView>
    );
  }

  if (businesses === null) return <Loading />;

  if (businesses.length === 0) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Card>
          <Text style={{ color: colors.textPrimary, fontSize: text.xl, fontWeight: '700' }}>
            Let Dial do your phone work
          </Text>
          <Text style={{ color: colors.textSecondary, marginTop: spacing.sm }}>
            Add your business, pick a job, and Dial calls your customers — with every result
            recorded and explainable.
          </Text>
          <View style={{ marginTop: spacing.lg }}>
            <Button
              label="Add a business"
              variant="primary"
              onPress={() => router.push('/business/new')}
            />
          </View>
        </Card>

        {WHAT_IT_DOES.map((item) => (
          <Card key={item.title}>
            <Text style={{ color: colors.textPrimary, fontWeight: '600', fontSize: text.base }}>
              {item.title}
            </Text>
            <Text style={{ color: colors.textSecondary, marginTop: 4 }}>{item.body}</Text>
          </Card>
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <SectionLabel>Your businesses</SectionLabel>

      {businesses.map((entry) => (
        <Card key={entry.id}>
          <Text style={{ color: colors.textPrimary, fontSize: text.lg, fontWeight: '600' }}>
            {entry.name}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: text.sm, marginTop: 2 }}>
            {entry.industryLabel}
            {entry.status !== 'active' ? ' · Paused' : ''}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: text.sm, marginTop: spacing.sm }}>
            {entry.activeWorkflows} active workflow{entry.activeWorkflows === 1 ? '' : 's'} ·{' '}
            {entry.callsToday} call{entry.callsToday === 1 ? '' : 's'} today
          </Text>
          <View style={{ marginTop: spacing.md }}>
            <Button label="Open" onPress={() => router.push(`/business/${entry.id}`)} />
          </View>
        </Card>
      ))}

      <Button
        label="Add another business"
        onPress={() => router.push('/business/new')}
      />
    </ScrollView>
  );
}
