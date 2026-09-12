import { useCallback, useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { BusinessRunSummaryDto } from '@dial/schemas';
import { api } from '../../../lib/api';
import { colors, spacing, text } from '../../../lib/theme';
import { Card, Button, Notice, Pill, Loading, EmptyState } from '../../../components/ui';

/**
 * Every run this business has made, and what each call returned.
 *
 * A run that is still going is polled while the screen is open — the same
 * cadence the web dashboard uses — so a call finishing shows up without
 * having to leave and come back.
 */

const LIVE = new Set(['queued', 'running']);

/** The run states, said the way the rest of the product says them. */
const STATE_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Calling',
  completed: 'Completed',
  partially_completed: 'Partly completed',
  failed: 'Failed',
  canceled: 'Stopped',
};

export default function RunsScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const [runs, setRuns] = useState<BusinessRunSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listRuns(businessId)
      .then((r) => setRuns(r.runs))
      .catch(() => setError('Could not load calls.'));
  }, [businessId]);

  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, 10_000);
      return () => clearInterval(timer);
    }, [load]),
  );

  async function cancel(runId: string) {
    setBusy(runId);
    try {
      await api.cancelRun(businessId, runId);
      load();
    } catch {
      setError('Could not stop that run.');
    } finally {
      setBusy(null);
    }
  }

  if (runs === null) {
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

      {runs.length === 0 ? (
        <EmptyState
          title="No calls yet"
          body="Run a workflow and every call, and what it returned, shows up here."
        />
      ) : (
        runs.map((run) => {
          const live = LIVE.has(run.state);
          return (
            <Card key={run.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text style={{ color: colors.textPrimary, fontWeight: '600', flex: 1 }}>
                  {run.workflowName ?? 'Workflow'}
                </Text>
                <Pill
                  label={STATE_LABEL[run.state] ?? run.state}
                  bg={live ? colors.infoSoft : colors.surfaceMuted}
                  fg={live ? colors.info : colors.textSecondary}
                />
              </View>

              <Text style={{ color: colors.textMuted, fontSize: text.sm, marginTop: 4 }}>
                {formatWhen(run.scheduledAt)}
                {run.completedAt ? ` · finished ${formatWhen(run.completedAt)}` : ''}
              </Text>

              {Object.keys(run.stats ?? {}).length > 0 ? (
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: spacing.sm,
                    marginTop: spacing.md,
                  }}
                >
                  {Object.entries(run.stats).map(([outcome, count]) => (
                    <Pill
                      key={outcome}
                      label={`${outcome.replace(/_/g, ' ')} · ${count}`}
                      bg={colors.surfaceMuted}
                      fg={colors.textSecondary}
                    />
                  ))}
                </View>
              ) : null}

              {run.failureCode ? (
                <View style={{ marginTop: spacing.md }}>
                  <Notice tone="warning">{describeRunFailure(run.failureCode)}</Notice>
                </View>
              ) : null}

              {live ? (
                <View style={{ marginTop: spacing.md }}>
                  <Button
                    label="Stop this run"
                    variant="danger"
                    loading={busy === run.id}
                    onPress={() => void cancel(run.id)}
                  />
                </View>
              ) : null}
            </Card>
          );
        })
      )}
    </ScrollView>
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

/** A failure code, said in words rather than as an identifier. */
function describeRunFailure(code: string): string {
  if (code === 'workflow_disabled') return 'The workflow was turned off before this run started.';
  return code.replace(/_/g, ' ');
}
