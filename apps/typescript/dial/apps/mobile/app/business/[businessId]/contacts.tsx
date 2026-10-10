import { useCallback, useState } from 'react';
import { ScrollView, View, Text, Alert } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { BusinessContactDto } from '@dial/schemas';
import { api, ApiError } from '../../../lib/api';
import { colors, spacing, text } from '../../../lib/theme';
import { Card, Button, Notice, SectionLabel, Field, Pill, Loading } from '../../../components/ui';

/**
 * The customers this business may call.
 *
 * A number is normalised to E.164 on the server using the business's own
 * country, so a local number typed the way people actually write it still
 * reaches the right phone. Opting someone out is honoured ahead of any run,
 * including one already scheduled.
 */
export default function BusinessContactsScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const [contacts, setContacts] = useState<BusinessContactDto[] | null>(null);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listBusinessContacts(businessId, query.trim() || undefined)
      .then((r) => setContacts(r.contacts))
      .catch(() => setError('Could not load contacts.'));
  }, [businessId, query]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.createBusinessContact(businessId, { name: name.trim(), phone: phone.trim() });
      setName('');
      setPhone('');
      load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add that contact.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleOptOut(contact: BusinessContactDto) {
    try {
      await api.updateBusinessContact(businessId, contact.id, { doNotCall: !contact.doNotCall });
      load();
    } catch {
      setError('Could not update that contact.');
    }
  }

  function remove(contact: BusinessContactDto) {
    Alert.alert(`Remove ${contact.name}?`, 'They will no longer appear when starting a run.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void api
            .deleteBusinessContact(businessId, contact.id)
            .then(load)
            .catch(() => setError('Could not remove that contact.'));
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card>
        <SectionLabel>Add a customer</SectionLabel>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Sarah Ahmed" />
        <Field
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          placeholder="055 123 4567"
          keyboardType="phone-pad"
          hint="Local numbers are fine — Dial reads them using the country on this business."
        />
        <Button
          label={busy ? 'Adding…' : 'Add contact'}
          variant="primary"
          loading={busy}
          disabled={!name.trim() || !phone.trim() || busy}
          onPress={() => void add()}
        />
      </Card>

      <Card>
        <SectionLabel>Contacts</SectionLabel>
        <Field
          label="Search"
          value={query}
          onChangeText={setQuery}
          placeholder="Name, phone, email…"
          autoCapitalize="none"
        />

        {contacts === null ? (
          <Loading />
        ) : contacts.length === 0 ? (
          <Text style={{ color: colors.textSecondary }}>
            {query.trim() ? 'Nobody matches that.' : 'Nobody here yet.'}
          </Text>
        ) : (
          contacts.map((contact) => {
            const optedOut = contact.doNotCall || Boolean(contact.optedOutAt);
            return (
              <View
                key={contact.id}
                style={{
                  paddingVertical: spacing.md,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '500', flex: 1 }}>
                    {contact.name}
                  </Text>
                  {optedOut ? (
                    <Pill label="opted out" bg={colors.warningSoft} fg={colors.warning} />
                  ) : null}
                </View>
                <Text style={{ color: colors.textMuted, fontSize: text.sm, marginTop: 2 }}>
                  {contact.phoneE164}
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={contact.doNotCall ? 'Allow calls' : 'Do not call'}
                      onPress={() => void toggleOptOut(contact)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Remove" variant="danger" onPress={() => remove(contact)} />
                  </View>
                </View>
              </View>
            );
          })
        )}
      </Card>
    </ScrollView>
  );
}
