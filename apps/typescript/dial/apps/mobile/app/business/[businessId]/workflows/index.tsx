import { useCallback, useState } from 'react';
import { ScrollView, View, Text, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import type { WorkflowDto } from '@dial/schemas';
import { api } from '../../../../lib/api';
import { colors, spacing, text } from '../../../../lib/theme';
import { Card, Button, Notice, Loading, EmptyState } from '../../../../components/ui';

/**
 * The reusable phone jobs. Pausing one stops future runs; deleting it takes
 * its run history with it, exactly as on the web.
 */
export default function WorkflowsScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .listWorkflows(businessId)
      .then((r) => setWorkflows(r.workflows))
      .catch(() => setError('Could not load workflows.'));
  }, [businessId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function toggle(workflow: WorkflowDto) {
    setBusy(true);
    try {
      await api.updateWorkflow(businessId, workflow.id, { enabled: !workflow.enabled });
      load();
    } catch {
      setError('Could not update that workflow.');
    } finally {
      setBusy(false);
    }
  }

  function remove(workflow: WorkflowDto) {
    Alert.alert(`Delete "${workflow.name}"?`, 'Its run history goes with it.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void api
            .deleteWorkflow(businessId, workflow.id)
            .then(load)
            .catch(() => setError('Could not delete that workflow.'));
        },
      },
    ]);
  }

  if (workflows === null) return error ? <ErrorView error={error} /> : <Loading />;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {workflows.length === 0 ? (
        <EmptyState
          title="No workflows yet"
          body="Create one to give Dial its first job for this business."
          action={{
            label: 'New workflow',
            onPress: () => router.push(`/business/${businessId}/workflows/new`),
          }}
        />
      ) : (
        workflows.map((workflow) => (
          <Card key={workflow.id}>
            <Text style={{ color: colors.textPrimary, fontSize: text.md, fontWeight: '600' }}>
              {workflow.name}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: text.sm, marginTop: 2 }}>
              {workflow.templateLabel}
              {workflow.enabled ? '' : ' · paused'} · calls {workflow.callingHours.startHour}:00–
              {workflow.callingHours.endHour}:00
            </Text>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                label="Run"
                variant="primary"
                disabled={!workflow.enabled}
                onPress={() => router.push(`/business/${businessId}/run/${workflow.id}`)}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={workflow.enabled ? 'Pause' : 'Enable'}
                    disabled={busy}
                    onPress={() => void toggle(workflow)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Delete" variant="danger" onPress={() => remove(workflow)} />
                </View>
              </View>
            </View>
          </Card>
        ))
      )}

      {workflows.length > 0 ? (
        <Button
          label="New workflow"
          onPress={() => router.push(`/business/${businessId}/workflows/new`)}
        />
      ) : null}
    </ScrollView>
  );
}

function ErrorView({ error }: { error: string }) {
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <Notice tone="danger">{error}</Notice>
    </ScrollView>
  );
}
