import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { api, ApiError } from '../../lib/api';
import type { TaskSuggestion } from '@dial/schemas';
import { colors, elevation, radius, spacing, text } from '../../lib/theme';
import { Button, Notice } from '../../components/ui';
import { MapPinIcon, ClockIcon } from '../../components/icons';

/**
 * The mobile command screen. Same promise as the web composer, laid out for a
 * phone: a keyboard-safe composer, tappable suggestions, and location asked for
 * only at the moment it is actually needed.
 */

/** Shown to an account with no finished tasks to offer back yet. */
const STARTERS = [
  'Find the cheapest iPhone repair near me',
  'Get three quotes for a plumber',
  'Book a dentist appointment this week',
  'Check if my prescription is ready',
];

export default function HomeScreen() {
  const router = useRouter();
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [history, setHistory] = useState<TaskSuggestion[] | null>(null);

  /*
   * Refetched on focus, not just on mount: finishing a task and coming back
   * to this tab should show it. Failing quietly to the starters is right --
   * an error about suggestions would be noise above the actual composer.
   */
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api
        .getSuggestions(4)
        .then((response) => alive && setHistory(response.suggestions))
        .catch(() => alive && setHistory([]));
      return () => {
        alive = false;
      };
    }, []),
  );

  async function useMyLocation() {
    setError(null);
    // Permission is requested here, at the point of use, and never in advance.
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setError(
        'Dial does not have location access. You can still say where to look — for example "in Dublin 2".',
      );
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setCoords(next);
      try {
        const resolved = await api.resolveLocation(next);
        setLocationLabel(resolved.label);
      } catch {
        setLocationLabel('your current location');
      }
    } catch {
      setError('Dial could not read your location just now.');
    }
  }

  async function submit() {
    const value = instruction.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const task = await api.createTask({
        instruction: value,
        location: coords ? { ...coords, text: null } : null,
        idempotencyKey: `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      });
      setInstruction('');
      router.push(`/task/${task.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Text style={styles.hero}>Let Dial make the call for you</Text>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={instruction}
            onChangeText={setInstruction}
            placeholder="Tell Dial what you need done and where"
            placeholderTextColor={colors.textPlaceholder}
            multiline
            maxLength={2000}
            accessibilityLabel="What do you want Dial to handle?"
          />
          <View style={styles.composerActions}>
            <Pressable
              onPress={() => void useMyLocation()}
              accessibilityRole="button"
              accessibilityLabel="Use my current location"
              style={styles.locationButton}
            >
              {/*
                An SVG pin rather than the 📍 emoji this used to draw: the
                emoji renders in the system's own colour and shape, which is
                neither the web's icon nor the same on two phones.
              */}
              <MapPinIcon size={16} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, fontSize: text.sm }}>
                {locationLabel ?? 'Use my location'}
              </Text>
            </Pressable>
            <Button
              label="Start"
              variant="primary"
              onPress={() => void submit()}
              disabled={!instruction.trim()}
              loading={busy}
            />
          </View>
        </View>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        {/*
          Your own finished tasks, offered back -- not a guess about what you
          might want. One row per kind of thing you have actually asked for.
        */}
        {history && history.length > 0 ? (
          <>
            <Text style={styles.suggestionsLabel}>You have done this before</Text>
            {history.map((suggestion) => (
              <Pressable
                key={suggestion.domain}
                onPress={() => setInstruction(suggestion.instruction)}
                accessibilityRole="button"
                accessibilityLabel={`Run again: ${suggestion.instruction}`}
                style={({ pressed }) => [styles.suggestion, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.suggestionRow}>
                  <ClockIcon size={18} color={colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.textPrimary, fontSize: text.base }}>
                      {suggestion.instruction}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: text.sm, marginTop: 2 }}>
                      {describeUse(suggestion)}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </>
        ) : (
          <>
            <Text style={styles.suggestionsLabel}>Try</Text>
            {STARTERS.map((suggestion) => (
              <Pressable
                key={suggestion}
                onPress={() => setInstruction(suggestion)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.suggestion, pressed && { opacity: 0.7 }]}
              >
                <Text style={{ color: colors.textSecondary, fontSize: text.base }}>
                  {suggestion}
                </Text>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  hero: {
    fontSize: text.xxl,
    fontWeight: '500',
    color: colors.textPrimary,
    letterSpacing: -0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    lineHeight: 34,
  },
  composer: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...elevation.card,
  },
  input: {
    minHeight: 96,
    fontSize: text.md,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  composerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  locationButton: {
    flexShrink: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  suggestionsLabel: {
    fontSize: text.xs,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginTop: spacing.lg,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  suggestion: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 52,
    justifyContent: 'center',
  },
});

/**
 * "3 times \u00B7 last week \u00B7 in Dublin 2" -- enough to recognise which of
 * your own tasks this is, without a timestamp nobody reads.
 */
function describeUse(suggestion: TaskSuggestion): string {
  const parts: string[] = [];
  if (suggestion.timesUsed > 1) parts.push(`${suggestion.timesUsed} times`);
  parts.push(relativeDay(suggestion.lastUsedAt));
  if (suggestion.locationLabel) parts.push(`in ${suggestion.locationLabel}`);
  return parts.join(' \u00B7 ');
}

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return 'recently';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return 'over a year ago';
}
