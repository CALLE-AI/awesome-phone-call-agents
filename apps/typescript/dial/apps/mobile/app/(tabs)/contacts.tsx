import { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
} from 'react-native';
import * as Contacts from 'expo-contacts';
import type { Contact } from '@dial/schemas';
import { api } from '../../lib/api';
import { colors, radius, spacing, text } from '../../lib/theme';
import { Card, Button, SectionLabel, Notice } from '../../components/ui';

/**
 * The address book Dial may be asked to ring, plus one-tap import from the
 * phone's own contacts. Import sends raw entries; the server normalizes and
 * validates each number, so the app never has to agree with the server about
 * what a diallable number looks like.
 */

const IMPORT_LIMIT = 200;

export default function ContactsScreen() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api
      .listContacts()
      .then((r) => setContacts(r.contacts))
      .catch(() => setError('Could not load your contacts.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function importFromPhone() {
    setImporting(true);
    setError(null);
    try {
      // Permission is asked here, at the point of use -- never on launch.
      const permission = await Contacts.requestPermissionsAsync();
      if (!permission.granted) {
        setError('Dial needs access to your contacts to import them.');
        return;
      }

      const book = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        pageSize: IMPORT_LIMIT,
      });
      const entries: Array<{ name: string; phone: string }> = [];
      for (const person of book.data) {
        const number = person.phoneNumbers?.[0]?.digits ?? person.phoneNumbers?.[0]?.number;
        if (person.name && number) {
          entries.push({ name: person.name.slice(0, 80), phone: number.slice(0, 30) });
        }
        if (entries.length >= IMPORT_LIMIT) break;
      }
      if (entries.length === 0) {
        setError('No contact with a phone number was found on this device.');
        return;
      }

      const result = await api.importContacts(entries);
      const saved = result.imported + result.renamed;
      Alert.alert(
        'Import finished',
        `${saved} ${saved === 1 ? 'contact' : 'contacts'} saved` +
          (result.skipped.length > 0 ? `, ${result.skipped.length} skipped (no valid number).` : '.'),
      );
      load();
    } catch {
      setError('Could not import from this device.');
    } finally {
      setImporting(false);
    }
  }

  async function addManually() {
    if (!name.trim() || !phone.trim()) return;
    try {
      await api.saveContact({ name: name.trim(), phone: phone.trim() });
      setName('');
      setPhone('');
      load();
    } catch {
      setError('That number was not accepted.');
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteContact(id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setError('Could not remove that contact.');
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card>
        <SectionLabel>From this phone</SectionLabel>
        <Button
          label={importing ? 'Importing…' : 'Import contacts'}
          variant="primary"
          loading={importing}
          onPress={() => void importFromPhone()}
        />
        <Text style={{ color: colors.textMuted, fontSize: text.xs, marginTop: spacing.md }}>
          Numbers that are not valid or cannot be dialled are skipped automatically.
        </Text>
      </Card>

      <Card>
        <SectionLabel>Add a number by hand</SectionLabel>
        <TextInput
          style={styles.input}
          placeholder="Name"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
          maxLength={80}
        />
        <TextInput
          style={styles.input}
          placeholder="+971 55 550 1234"
          placeholderTextColor={colors.textMuted}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={30}
        />
        <Button
          label="Save"
          disabled={!name.trim() || !phone.trim()}
          onPress={() => void addManually()}
        />
      </Card>

      <Card>
        <SectionLabel>Saved ({contacts.length})</SectionLabel>
        {loading ? (
          <Text style={{ color: colors.textSecondary }}>Loading…</Text>
        ) : contacts.length === 0 ? (
          <Text style={{ color: colors.textSecondary }}>
            Nobody saved yet. Imported names work straight away: “call Malik”.
          </Text>
        ) : (
          contacts.map((contact) => (
            <View key={contact.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.textPrimary, fontSize: text.base }}>
                  {contact.name}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: text.sm }}>
                  {contact.phoneE164}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${contact.name}`}
                hitSlop={12}
                onPress={() => void remove(contact.id)}
              >
                <Text style={{ color: colors.danger }}>Remove</Text>
              </Pressable>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
    fontSize: text.base,
    minHeight: 46,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
