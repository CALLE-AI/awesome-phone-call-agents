import { useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { isCompleteAppointment, type BusinessContactDto, type WorkflowDto } from '@dial/schemas';
import { api, ApiError } from '../../../../lib/api';
import { colors, radius, spacing, text } from '../../../../lib/theme';
import { Card, Button, Notice, SectionLabel, Loading, EmptyState, Pill } from '../../../../components/ui';
import {
  ContextFields,
  DateTimeField,
  missingRequired,
  type ContextField,
} from '../../../../components/context-fields';

/**
 * Run a workflow: who to call, what the call is about, and when to start.
 *
 * The two times on this screen mean different things, so neither is labelled
 * merely "when": one is the appointment Dial mentions, the other is when Dial
 * picks up the phone.
 */
export default function RunWorkflowScreen() {
  const { businessId, workflowId } = useLocalSearchParams<{
    businessId: string;
    workflowId: string;
  }>();
  const router = useRouter();

  const [workflow, setWorkflow] = useState<WorkflowDto | null>(null);
  const [fields, setFields] = useState<ContextField[]>([]);
  const [contacts, setContacts] = useState<BusinessContactDto[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [context, setContext] = useState<Record<string, string>>({});
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listWorkflows(businessId)
      .then((r) => {
        const found = r.workflows.find((w) => w.id === workflowId) ?? null;
        setWorkflow(found);
        setFields(r.templates.find((t) => t.id === found?.template)?.contextFields ?? []);
      })
      .catch(() => setError('Could not load that workflow.'));
    api
      .listBusinessContacts(businessId)
      .then((r) => setContacts(r.contacts))
      .catch(() => setError('Could not load contacts.'));
  }, [businessId, workflowId]);

  const blocking = missingRequired(fields, context);

  async function start(runNow: boolean) {
    if (!workflow || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.createRun(businessId, workflow.id, {
        contactIds: [...selected],
        // Local wall-clock in, instant out: the server stores a real point in
        // time, so the phone's own offset has to be applied rather than the
        // string being passed through.
        scheduledAt: runNow || !when ? null : new Date(when).toISOString(),
        context,
      });
      router.replace(`/business/${businessId}/runs`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not start the run.');
      setBusy(false);
    }
  }

  if (!workflow || contacts === null) {
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
        <Text style={{ color: colors.textPrimary, fontSize: text.lg, fontWeight: '700' }}>
          {workflow.name}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: text.sm, marginTop: 2 }}>
          {workflow.templateLabel} · speaks {workflow.defaultLocale} · calls{' '}
          {workflow.callingHours.startHour}:00–{workflow.callingHours.endHour}:00 local time
        </Text>
      </Card>

      {fields.length > 0 ? (
        <Card>
          <SectionLabel>What the call is about</SectionLabel>
          <Text style={{ color: colors.textMuted, fontSize: text.sm, marginBottom: spacing.lg }}>
            Details Dial mentions on the call — not when the call is placed.
          </Text>
          <ContextFields
            fields={fields}
            values={context}
            onChange={(id, value) => setContext((prev) => ({ ...prev, [id]: value }))}
          />
        </Card>
      ) : null}

      <Card>
        <SectionLabel>Who to call ({selected.size} selected)</SectionLabel>
        {contacts.length === 0 ? (
          <EmptyState
            title="No contacts yet"
            body="Add customers before running a workflow."
            action={{
              label: 'Add contacts',
              onPress: () => router.push(`/business/${businessId}/contacts`),
            }}
          />
        ) : (
          contacts.map((contact) => {
            const optedOut = contact.doNotCall || Boolean(contact.optedOutAt);
            const isSelected = selected.has(contact.id);
            return (
              <Pressable
                key={contact.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected, disabled: optedOut }}
                disabled={optedOut}
                onPress={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(contact.id)) next.delete(contact.id);
                    else next.add(contact.id);
                    return next;
                  })
                }
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingVertical: spacing.md,
                  minHeight: 52,
                  opacity: optedOut ? 0.5 : 1,
                }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: radius.sm,
                    borderWidth: 2,
                    borderColor: isSelected ? colors.primary : colors.borderStrong,
                    backgroundColor: isSelected ? colors.primary : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSelected ? (
                    <Text style={{ color: colors.primaryText, fontSize: 13, fontWeight: '700' }}>
                      ✓
                    </Text>
                  ) : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '500' }}>
                    {contact.name}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: text.sm }}>
                    {contact.phoneE164}
                  </Text>
                </View>
                {optedOut ? (
                  <Pill label="opted out" bg={colors.surfaceMuted} fg={colors.textSecondary} />
                ) : null}
              </Pressable>
            );
          })
        )}
      </Card>

      <Card>
        <SectionLabel>When should Dial call?</SectionLabel>
        <Text style={{ color: colors.textMuted, fontSize: text.sm, marginBottom: spacing.lg }}>
          Leave this empty to start calling straight away.
        </Text>
        <DateTimeField
          field={{
            id: 'scheduledAt',
            label: 'Start calling at',
            type: 'datetime',
            required: false,
            hint: 'Date as YYYY-MM-DD, time as 24-hour HH:MM.',
          }}
          value={when}
          onChange={setWhen}
        />
      </Card>

      {blocking.length > 0 ? (
        <Notice tone="warning">
          Fill in {blocking.map((f) => f.label.toLowerCase()).join(' and ')} first.
        </Notice>
      ) : null}

      <Button
        label={busy ? 'Starting…' : `Call now (${selected.size})`}
        variant="primary"
        loading={busy}
        disabled={busy || selected.size === 0 || blocking.length > 0}
        onPress={() => void start(true)}
      />
      <Button
        label="Schedule"
        loading={busy}
        disabled={
          busy || selected.size === 0 || blocking.length > 0 || !isCompleteAppointment(when)
        }
        onPress={() => void start(false)}
      />
    </ScrollView>
  );
}
