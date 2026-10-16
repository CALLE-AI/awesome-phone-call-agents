import { useCallback, useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from 'expo-router';
import type { BusinessDashboard, BusinessDto } from '@dial/schemas';
import { api } from '../../../lib/api';
import { colors, spacing, text } from '../../../lib/theme';
import { Card, Button, Notice, SectionLabel, NavRow, Pill, Loading } from '../../../components/ui';
import { CalendarIcon, ContactsIcon, PhoneCallIcon, SettingsIcon } from '../../../components/icons';

/**
 * The business overview: what is happening today, what is queued, and what
 * came back — then the four places to go from here.
 */
export default function BusinessOverviewScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const router = useRouter();
  const [business, setBusiness] = useState<BusinessDto | null>(null);
  const [data, setData] = useState<BusinessDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      Promise.all([api.getBusiness(businessId), api.businessDashboard(businessId)])
        .then(([b, d]) => {
          if (!alive) return;
          setBusiness(b);
          setData(d);
        })
        .catch(() => alive && setError('Could not load this business.'));
      return () => {
        alive = false;
      };
    }, [businessId]),
  );

  if (error) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Notice tone="danger">{error}</Notice>
      </ScrollView>
    );
  }
  if (!business || !data) return <Loading />;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Stack.Screen options={{ title: business.name }} />

      <Card>
        <Text style={{ color: colors.textPrimary, fontSize: text.xl, fontWeight: '700' }}>
          {business.name}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: text.sm, marginTop: 2 }}>
          {business.industryLabel} · {business.timezone}
        </Text>
        {business.status !== 'active' ? (
          <View style={{ marginTop: spacing.sm }}>
            <Pill label="Paused" bg={colors.warningSoft} fg={colors.warning} />
          </View>
        ) : null}
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Stat label="Calls today" value={data.callsToday} />
        <Stat label="Scheduled" value={data.scheduled} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Stat label="Completed today" value={data.completedToday} />
        <Stat
          label="Needs attention"
          value={data.needsAttention}
          tone={data.needsAttention > 0 ? colors.warning : undefined}
        />
      </View>

      <Card>
        <SectionLabel>Manage</SectionLabel>
        <NavRow
          label="Workflows"
          description="The phone jobs this business runs."
          icon={<PhoneCallIcon size={20} color={colors.textMuted} />}
          onPress={() => router.push(`/business/${businessId}/workflows`)}
        />
        <NavRow
          label="Contacts"
          description="The customers Dial may call."
          icon={<ContactsIcon size={20} color={colors.textMuted} />}
          onPress={() => router.push(`/business/${businessId}/contacts`)}
        />
        <NavRow
          label="Calls"
          description="Every run, and what each call returned."
          icon={<CalendarIcon size={20} color={colors.textMuted} />}
          onPress={() => router.push(`/business/${businessId}/runs`)}
        />
        <NavRow
          label="Settings"
          description="Details, pausing, and deleting."
          icon={<SettingsIcon size={20} color={colors.textMuted} />}
          last
          onPress={() => router.push(`/business/${businessId}/settings`)}
        />
      </Card>

      {data.upcoming.length > 0 ? (
        <Card>
          <SectionLabel>Upcoming calls</SectionLabel>
          {data.upcoming.map((item) => (
            <View key={item.recipientId} style={{ paddingVertical: spacing.sm }}>
              <Text style={{ color: colors.textPrimary, fontWeight: '500' }}>
                {item.recipientName}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: text.sm }}>
                {item.workflowName ?? 'workflow'} · {formatWhen(item.scheduledAt)}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <SectionLabel>Recent results</SectionLabel>
        {data.recent.length === 0 ? (
          <Text style={{ color: colors.textSecondary }}>No calls yet.</Text>
        ) : (
          data.recent.map((item) => (
            <View key={item.recipientId} style={{ paddingVertical: spacing.sm }}>
              <Text style={{ color: colors.textPrimary, fontWeight: '500' }}>{item.line}</Text>
              <Text style={{ color: colors.textMuted, fontSize: text.sm }}>
                {item.workflowName ?? 'workflow'}
                {item.completedAt ? ` · ${formatWhen(item.completedAt)}` : ''}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Button
        label="Run a workflow"
        variant="primary"
        onPress={() => router.push(`/business/${businessId}/workflows`)}
      />
    </ScrollView>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Card>
        <Text style={{ fontSize: 28, fontWeight: '700', color: tone ?? colors.textPrimary }}>
          {value}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: text.sm, marginTop: 2 }}>
          {label}
        </Text>
      </Card>
    </View>
  );
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
