import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { listCountries } from '@dial/schemas';
import { colors, radius, spacing, text } from '../lib/theme';
import { Field, FieldHint } from './ui';

/**
 * Pick a country by typing.
 *
 * There are 245 of them, so neither a row of buttons nor a long list works on
 * a phone: you search, and a handful of matches appear. Matching accepts the
 * country name, the ISO code, or the dialling code, because someone who knows
 * their country as "+971" should not have to know it is also "AE".
 *
 * What gets STORED is the ISO region code -- that is what parses a local
 * number into E.164. The dialling code is shown because that is what people
 * recognise.
 */

const COUNTRIES = listCountries();
const MAX_RESULTS = 6;

export function CountryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const [query, setQuery] = useState('');
  const selected = COUNTRIES.find((c) => c.code === value) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, '');
    if (!q) return [];
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase() === q ||
        c.dialCode.startsWith(q),
    ).slice(0, MAX_RESULTS);
  }, [query]);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Field
        label="Country"
        value={query}
        onChangeText={setQuery}
        placeholder={selected ? `${selected.name} (+${selected.dialCode})` : 'Search a country…'}
        autoCapitalize="none"
      />

      {matches.length > 0 ? (
        <View style={styles.results}>
          {matches.map((country, index) => (
            <Pressable
              key={country.code}
              accessibilityRole="button"
              accessibilityState={{ selected: country.code === value }}
              onPress={() => {
                onChange(country.code);
                setQuery('');
              }}
              style={({ pressed }) => [
                styles.result,
                index < matches.length - 1 && styles.resultDivided,
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Text style={{ color: colors.textPrimary, fontSize: text.base, flex: 1 }}>
                {country.name}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: text.sm }}>
                +{country.dialCode}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <FieldHint>
        {selected
          ? `${selected.name} (+${selected.dialCode}). Lets Dial read local numbers as full international ones.`
          : 'Lets Dial read local numbers like 055 123 4567 as full international numbers.'}
      </FieldHint>
    </View>
  );
}

const styles = StyleSheet.create({
  results: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  resultDivided: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
