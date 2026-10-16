import { useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { BUSINESS_INDUSTRY_LABELS, BUSINESS_INDUSTRIES } from '@dial/schemas';
import { api, ApiError } from '../../lib/api';
import { colors, spacing, text } from '../../lib/theme';
import { Card, Button, Notice, SectionLabel, Field, ChoiceRow } from '../../components/ui';
import { CountryPicker } from '../../components/country-picker';

/**
 * Add a business, then give it its first job.
 *
 * Two steps, because asking for the details and the workflow at once is a very
 * long form on a phone.
 */

const INDUSTRIES = BUSINESS_INDUSTRIES.map((value) => ({
  value,
  label: BUSINESS_INDUSTRY_LABELS[value],
}));

const TIMEZONES = [
  'UTC',
  'Europe/Dublin',
  'Europe/London',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Riyadh',
  'America/New_York',
  'America/Los_Angeles',
];

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

export default function NewBusinessScreen() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('other');
  const [customIndustry, setCustomIndustry] = useState('');
  const [country, setCountry] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [phone, setPhone] = useState('');

  const [businessId, setBusinessId] = useState<string | null>(null);
  const [template, setTemplate] = useState('appointment_reminder');
  const [workflowName, setWorkflowName] = useState('');
  const [goal, setGoal] = useState('');

  async function createBusiness() {
    setBusy(true);
    setError(null);
    try {
      const business = await api.createBusiness({
        name: name.trim(),
        industry: industry as never,
        customIndustry: industry === 'other' ? customIndustry.trim() || null : null,
        timezone,
        country: country || null,
        locale: 'en',
        address: null,
        website: null,
        businessPhone: phone.trim() || null,
        hours: null,
      });
      setBusinessId(business.id);
      setStep(2);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the business.');
    } finally {
      setBusy(false);
    }
  }

  async function createWorkflow() {
    if (!businessId) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = TEMPLATES.find((t) => t.id === template)!;
      const workflow = await api.createWorkflow(businessId, {
        name: workflowName.trim() || chosen.label,
        template,
        goal: template === 'general_followup' ? goal.trim() : null,
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

      {step === 1 ? (
        <Card>
          <SectionLabel>About the business</SectionLabel>

          <Field
            label="Business name"
            value={name}
            onChangeText={setName}
            placeholder="Acme Dental"
            maxLength={120}
          />

          <ChoiceRow
            label="Industry"
            value={industry}
            options={INDUSTRIES}
            onChange={setIndustry}
          />

          {/*
            "Other" on its own records that the list did not fit and nothing
            about what the business actually is.
          */}
          {industry === 'other' ? (
            <Field
              label="What kind of business is it?"
              value={customIndustry}
              onChangeText={setCustomIndustry}
              placeholder="e.g. Bakery, Driving school"
              maxLength={80}
              hint="Shown wherever Dial names your industry. It does not change how calls are made."
            />
          ) : null}

          <CountryPicker value={country} onChange={setCountry} />

          <ChoiceRow
            label="Timezone"
            hint="Calling hours are kept in this zone."
            value={timezone}
            options={TIMEZONES.map((tz) => ({ value: tz, label: tz.split('/').pop() ?? tz }))}
            onChange={setTimezone}
          />

          <Field
            label="Business phone (optional)"
            value={phone}
            onChangeText={setPhone}
            placeholder="+971…"
            keyboardType="phone-pad"
          />

          <Button
            label={busy ? 'Creating…' : 'Continue'}
            variant="primary"
            disabled={!name.trim() || busy}
            loading={busy}
            onPress={() => void createBusiness()}
          />
        </Card>
      ) : (
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

          <View style={{ marginTop: spacing.md }}>
            <Field
              label="Workflow name"
              value={workflowName}
              onChangeText={setWorkflowName}
              placeholder={TEMPLATES.find((t) => t.id === template)?.label}
            />

            {template === 'general_followup' ? (
              <Field
                label="What should the call achieve?"
                value={goal}
                onChangeText={setGoal}
                multiline
                maxLength={1000}
                placeholder="e.g. Check the customer is happy with the repair and ask if anything else is needed."
              />
            ) : null}
          </View>

          <Button
            label={busy ? 'Creating…' : 'Create workflow'}
            variant="primary"
            loading={busy}
            disabled={busy || (template === 'general_followup' && goal.trim().length < 3)}
            onPress={() => void createWorkflow()}
          />
        </Card>
      )}
    </ScrollView>
  );
}
