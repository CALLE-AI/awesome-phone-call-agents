import { useEffect, useState } from 'react';
import { ScrollView, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  BUSINESS_INDUSTRIES,
  BUSINESS_INDUSTRY_LABELS,
  type BusinessDto,
} from '@dial/schemas';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { Card, Button, Notice, SectionLabel, Field, ChoiceRow, Loading } from '../../../components/ui';
import { CountryPicker } from '../../../components/country-picker';

/** Business details, pausing, and deleting. */

const INDUSTRIES = BUSINESS_INDUSTRIES.map((value) => ({
  value,
  label: BUSINESS_INDUSTRY_LABELS[value],
}));

export default function BusinessSettingsScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const router = useRouter();
  const [business, setBusiness] = useState<BusinessDto | null>(null);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('other');
  const [customIndustry, setCustomIndustry] = useState('');
  const [country, setCountry] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('active');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getBusiness(businessId)
      .then((b) => {
        setBusiness(b);
        setName(b.name);
        setIndustry(b.industry);
        setCustomIndustry(b.customIndustry ?? '');
        setCountry(b.country ?? '');
        setPhone(b.businessPhone ?? '');
        setStatus(b.status);
      })
      .catch(() => setError('Could not load this business.'));
  }, [businessId]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.updateBusiness(businessId, {
        name: name.trim(),
        industry: industry as never,
        customIndustry: industry === 'other' ? customIndustry.trim() || null : null,
        country: country || null,
        businessPhone: phone.trim() || null,
      });
      setBusiness(updated);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    const next = status === 'active' ? 'paused' : 'active';
    try {
      await api.updateBusiness(businessId, { status: next });
      setStatus(next);
    } catch {
      setError('Could not change the business status.');
    }
  }

  function remove() {
    Alert.alert(
      `Delete ${business?.name ?? 'this business'}?`,
      'Its workflows, contacts and every call record go with it. This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void api
              .deleteBusiness(businessId)
              .then(() => router.replace('/business'))
              .catch(() => setError('Could not delete this business.'));
          },
        },
      ],
    );
  }

  if (!business) {
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
        <SectionLabel>Details</SectionLabel>
        <Field label="Business name" value={name} onChangeText={setName} maxLength={120} />
        <ChoiceRow label="Industry" value={industry} options={INDUSTRIES} onChange={setIndustry} />
        {industry === 'other' ? (
          <Field
            label="What kind of business is it?"
            value={customIndustry}
            onChangeText={setCustomIndustry}
            placeholder="e.g. Bakery, Driving school"
            maxLength={80}
          />
        ) : null}
        <CountryPicker value={country} onChange={setCountry} />
        <Field
          label="Business phone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="+971…"
        />
        <Button
          label={busy ? 'Saving…' : saved ? 'Saved' : 'Save settings'}
          variant="primary"
          loading={busy}
          onPress={() => void save()}
        />
      </Card>

      <Card>
        <SectionLabel>Pause</SectionLabel>
        <Notice>
          {status === 'active'
            ? 'Pausing stops new runs starting. Anything already dialling finishes.'
            : 'This business is paused. No new runs will start.'}
        </Notice>
        <Button
          label={status === 'active' ? 'Pause all workflows' : 'Resume workflows'}
          onPress={() => void togglePause()}
        />
      </Card>

      <Card>
        <SectionLabel>Delete</SectionLabel>
        <Notice tone="danger">
          Removes this business, its workflows, its contacts and every call record. This cannot be
          undone.
        </Notice>
        <Button label="Delete this business" variant="danger" onPress={remove} />
      </Card>
    </ScrollView>
  );
}
