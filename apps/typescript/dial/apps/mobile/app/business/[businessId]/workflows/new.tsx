import { useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, ApiError } from '../../../../lib/api';
import { colors, spacing, text } from '../../../../lib/theme';
import { Card, Button, Notice, SectionLabel, Field, ChoiceRow } from '../../../../components/ui';

/**
 * A new workflow from a template.
 *
 * The template decides the structured result Dial asks CALL-E for; nothing
 * here is industry-specific code.
 */

const TEMPLATES = [
  {
    id: 'appointment_reminder',
    label: 'Appointment reminders',
    description: 'Call customers before an appointment and confirm, cancel, or offer a reschedule.',
  },
  {
    id: 'lead_callback',
    label: 'Customer callbacks',
    description: 'Call a lead, gauge interest, and agree a time for you to call back or visit.',
  },
  {
    id: 'general_followup',
    label: 'Custom phone job',
    description: 'Describe the goal in your own words. Dial returns a structured outcome.',
  },
];

const HOURS = [8, 9, 10, 12, 17, 18, 19, 20];

export default function NewWorkflowScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const router = useRouter();
  const [template, setTemplate] = useState('appointment_reminder');
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(19);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const chosen = TEMPLATES.find((t) => t.id === template)!;
      const workflow = await api.createWorkflow(businessId, {
        name: name.trim() || chosen.label,
        template,
        goal: template === 'general_followup' ? goal.trim() : null,
        callingHours: { startHour, endHour },
      });
      router.replace(`/business/${businessId}/run/${workflow.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the workflow.');
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card>
        <SectionLabel>What should Dial do?</SectionLabel>
        {TEMPLATES.map((choice) => (
          <View key={choice.id} style={{ marginBottom: spacing.md }}>
            <Button
              label={choice.label}
              variant={template === choice.id ? 'primary' : 'secondary'}
              onPress={() => setTemplate(choice.id)}
            />
            <Text style={{ color: colors.textMuted, fontSize: text.sm, marginTop: 6 }}>
              {choice.description}
            </Text>
          </View>
        ))}
      </Card>

      <Card>
        <SectionLabel>Details</SectionLabel>
        <Field
          label="Workflow name"
          value={name}
          onChangeText={setName}
          placeholder={TEMPLATES.find((t) => t.id === template)?.label}
        />

        {template === 'general_followup' ? (
          <Field
            label="What should the call achieve?"
            value={goal}
            onChangeText={setGoal}
            multiline
            maxLength={1000}
            placeholder="e.g. Check the customer is happy with the repair."
          />
        ) : null}

        <ChoiceRow
          label="Start calling at"
          value={String(startHour)}
          options={HOURS.filter((h) => h < endHour).map((h) => ({
            value: String(h),
            label: `${h}:00`,
          }))}
          onChange={(v) => setStartHour(Number(v))}
        />
        <ChoiceRow
          label="Stop calling at"
          hint="In the business's own timezone. Dial parks a run outside these hours rather than dialling."
          value={String(endHour)}
          options={HOURS.filter((h) => h > startHour).map((h) => ({
            value: String(h),
            label: `${h}:00`,
          }))}
          onChange={(v) => setEndHour(Number(v))}
        />

        <Button
          label={busy ? 'Creating…' : 'Create workflow'}
          variant="primary"
          loading={busy}
          disabled={busy || (template === 'general_followup' && goal.trim().length < 3)}
          onPress={() => void create()}
        />
      </Card>
    </ScrollView>
  );
}
