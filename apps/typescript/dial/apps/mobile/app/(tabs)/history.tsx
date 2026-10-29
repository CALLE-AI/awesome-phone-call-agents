import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { TaskSummary } from '@dial/schemas';
import { api } from '../../lib/api';
import { colors, radius, spacing, text, toneFor } from '../../lib/theme';
import { Pill } from '../../components/ui';

/**
 * The same task list the web app shows, from the same rows. A task started in
 * the browser appears here, and vice versa -- there is no separate mobile store.
 */
export default function HistoryScreen() {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await api.listTasks();
      setTasks(result.tasks);
      setError(null);
    } catch {
      setError('Could not load your tasks. Pull down to try again.');
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, []);

  // Reloads whenever the tab regains focus, so a task finished on another
  // device is visible the moment the user looks.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <FlatList
      data={tasks}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
      ListEmptyComponent={
        loaded ? (
          <View style={{ padding: spacing.xxl, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
              {error ?? 'No tasks yet. Start one from the New tab.'}
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const tone = toneFor(item.state);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.instruction}. ${item.stateLabel}`}
            onPress={() => router.push(`/task/${item.id}`)}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.instruction}>{item.instruction}</Text>
            <View style={{ marginTop: spacing.sm }}>
              <Pill label={item.stateLabel} bg={tone.bg} fg={tone.fg} />
            </View>
            {item.headline ? <Text style={styles.headline}>{item.headline}</Text> : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  instruction: { fontSize: text.md, fontWeight: '600', color: colors.textPrimary },
  headline: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: text.base },
});
