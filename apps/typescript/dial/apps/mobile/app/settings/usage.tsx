import { useEffect, useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import type { UsageResponse } from '@dial/schemas';
import { api } from '../../lib/api';
import { colors, radius, spacing, text } from '../../lib/theme';
import { Card, SectionLabel, Notice, FactRow, Loading } from '../../components/ui';

/**
 * What this account has actually used.
 *
 * The figures come from `usage_counters` -- the same rows the call budget is
 * enforced against -- rather than a second tally counted somewhere else, so
 * the number here is the number that stopped the work. Nothing is estimated,
 * and there is no billing figure because Dial does not charge for calls.
 */
export default function UsageScreen() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getUsage(14)
      .then(setUsage)
      .catch(() => setError('Could not load your usage.'));
  }, []);

  if (error) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Notice tone="danger">{error}</Notice>
      </ScrollView>
    );
  }
  if (!usage) return <Loading />;

  const remaining = Math.max(0, usage.limits.callsPerDay - usage.today.callsPlaced);
  const used =
    usage.limits.callsPerDay > 0
      ? Math.min(1, usage.today.callsPlaced / usage.limits.callsPerDay)
      : 0;
  const busiest = Math.max(1, ...usage.history.map((d) => d.callsPlaced));
  const quiet = usage.totals.callsPlaced === 0 && usage.totals.tasksCreated === 0;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Card>
        <SectionLabel>Today</SectionLabel>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
          <Text
            style={{
              fontSize: 40,
              fontWeight: '700',
              color: colors.textPrimary,
              letterSpacing: -1,
            }}
          >
            {usage.today.callsPlaced}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: text.md }}>
            of {usage.limits.callsPerDay} calls
          </Text>
        </View>

        <View
          accessibilityRole="progressbar"
          accessibilityValue={{
            now: usage.today.callsPlaced,
            min: 0,
            max: usage.limits.callsPerDay,
          }}
          accessibilityLabel="Calls placed today"
          style={{
            height: 10,
            borderRadius: radius.pill,
            backgroundColor: colors.surfaceMuted,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: 'hidden',
            marginTop: spacing.md,
          }}
        >
          <View
            style={{
              height: '100%',
              width: `${used * 100}%`,
              // Spent, not merely high: the colour changes only at the limit.
              backgroundColor: used >= 1 ? colors.warning : colors.primary,
              borderRadius: radius.pill,
            }}
          />
        </View>

        <Text style={{ color: colors.textMuted, fontSize: text.sm, marginTop: spacing.sm }}>
          {remaining === 0
            ? 'You have used today’s calls. The limit resets at midnight UTC.'
            : `${remaining} call${remaining === 1 ? '' : 's'} left today. Resets at midnight UTC.`}
        </Text>

        <View style={{ marginTop: spacing.md }}>
          <FactRow label="Tasks started today" value={String(usage.today.tasksCreated)} />
          <FactRow label="Calls one task may place" value={String(usage.limits.callsPerTask)} />
        </View>
      </Card>

      <Card>
        <SectionLabel>Last 14 days</SectionLabel>
        {quiet ? (
          <Text style={{ color: colors.textSecondary }}>
            No calls yet. Once Dial rings someone for you, it shows up here.
          </Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 3 }}>
              {usage.history.map((day, index) => (
                <View key={day.day} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                  <View
                    accessibilityLabel={`${day.callsPlaced} calls on ${day.day}`}
                    style={{
                      width: '100%',
                      height: Math.max(3, (day.callsPlaced / busiest) * 90),
                      // A day with no calls still gets a mark, so a gap reads
                      // as zero rather than as missing.
                      backgroundColor: day.callsPlaced === 0 ? colors.borderStrong : colors.primary,
                      borderTopLeftRadius: radius.sm,
                      borderTopRightRadius: radius.sm,
                    }}
                  />
                  <Text style={{ color: colors.textMuted, fontSize: 9 }}>
                    {/* Fourteen labels do not fit across a phone; every other one does. */}
                    {index % 2 === 0 ? shortDay(day.day) : ' '}
                  </Text>
                </View>
              ))}
            </View>

            <View style={{ marginTop: spacing.md }}>
              <FactRow label="Calls placed" value={String(usage.totals.callsPlaced)} />
              <FactRow label="Tasks started" value={String(usage.totals.tasksCreated)} />
            </View>
          </>
        )}
      </Card>
    </ScrollView>
  );
}

/** "25/8" from "2026-08-25", without letting a timezone move the day. */
function shortDay(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(day)}/${Number(month)}`;
}
