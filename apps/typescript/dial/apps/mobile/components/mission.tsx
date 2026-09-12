import { View, Text, StyleSheet } from 'react-native';
import type { TaskMission } from '@dial/schemas';
import { Card, SectionLabel } from './ui';
import { colors, spacing, text } from '../lib/theme';

/**
 * What Dial is trying to achieve on this task, and how close it is.
 *
 * The same panel as the web app, in the same words. Dial decides when to stop
 * by goal rather than by count -- it rings businesses until it has enough
 * comparable answers -- and none of that was visible on either platform: a task
 * that stopped two answers short looked identical to one that succeeded.
 *
 * Every number is counted from rows that exist. Nothing is projected, and there
 * is no "time remaining": Dial cannot know whether the next business answers.
 */
export function MissionCard({ mission }: { mission: TaskMission }) {
  const { evidenceTarget, evidenceSoFar, callsPlaced, callBudget, candidatesFound, callableFound } =
    mission;
  const done = evidenceSoFar >= evidenceTarget;
  // A stop reason is only set once the task is terminal, so it doubles as the
  // tense: a finished task must not be described as still calling.
  const stopped = Boolean(mission.stopReason);

  return (
    <Card>
      <SectionLabel>What Dial is doing</SectionLabel>

      <Text style={styles.goal}>
        {done
          ? `Dial has the ${evidenceTarget} comparable ${evidenceTarget === 1 ? 'answer' : 'answers'} it needed.`
          : stopped
            ? `Dial was looking for ${evidenceTarget} comparable ${evidenceTarget === 1 ? 'answer' : 'answers'}.`
            : `Dial is calling until ${evidenceTarget} ${evidenceTarget === 1 ? 'business gives' : 'businesses give'} a comparable answer.`}
      </Text>

      {/*
        Pips rather than a continuous bar: the target is a small whole number of
        phone calls, so a smoothly-filling bar would imply a precision that
        "3 of 5 businesses answered" does not have.
      */}
      <View style={styles.track}>
        {Array.from({ length: evidenceTarget }, (_, i) => (
          <View
            key={i}
            style={[styles.pip, i < evidenceSoFar ? styles.pipFilled : null]}
          />
        ))}
      </View>

      <Text style={styles.count}>
        <Text style={styles.countStrong}>{evidenceSoFar}</Text> of {evidenceTarget} answers
      </Text>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Businesses called</Text>
          {/* Against the ceiling, so "why did it stop" is answerable at a glance. */}
          <Text style={styles.statValue}>
            {callsPlaced} <Text style={styles.statOf}>of {callBudget} max</Text>
          </Text>
        </View>
        <View style={styles.stat}>
          {/*
            Found and callable, together, because the gap between them is what
            decides how far a task gets. Eighteen of twenty shops being shut
            explains a two-call task; "20 found" alone makes the same task look
            like Dial gave up early.
          */}
          <Text style={styles.statLabel}>Businesses found</Text>
          <Text style={styles.statValue}>
            {candidatesFound}
            {candidatesFound > callableFound ? (
              <Text style={styles.statOf}> · {callableFound} reachable</Text>
            ) : null}
          </Text>
        </View>
      </View>

      <Text style={[styles.stop, mission.stopReason ? null : styles.stopLive]}>
        {mission.stopReason ??
          'Dial stops as soon as it has enough to compare — it will not make calls it does not need.'}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  goal: { color: colors.textPrimary, fontSize: text.md, lineHeight: 22, marginBottom: spacing.md },
  track: { flexDirection: 'row', gap: 6, marginBottom: spacing.sm },
  pip: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pipFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
  count: { color: colors.textSecondary, fontSize: text.sm, marginBottom: spacing.md },
  countStrong: { color: colors.textPrimary, fontWeight: '600', fontSize: text.md },
  stats: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: spacing.md,
    marginBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  stat: { flex: 1 },
  statLabel: { color: colors.textSecondary, fontSize: text.xs, marginBottom: 4 },
  statValue: { color: colors.textPrimary, fontSize: 18, fontWeight: '600' },
  statOf: { color: colors.textSecondary, fontSize: text.xs, fontWeight: '400' },
  stop: { color: colors.textSecondary, fontSize: text.sm, lineHeight: 20 },
  stopLive: { fontStyle: 'italic', opacity: 0.85 },
});
