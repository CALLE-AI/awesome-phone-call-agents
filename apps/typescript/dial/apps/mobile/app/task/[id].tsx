import { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  Linking,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  callProgressLabel,
  elapsedWorkingMs,
  formatDuration,
  type TaskDetail,
} from '@dial/schemas';
import { api, ApiError } from '../../lib/api';
import { colors, spacing, text, toneFor, LIVE_STATES } from '../../lib/theme';
import { Card, Pill, Button, SectionLabel, Notice } from '../../components/ui';
import { MissionCard } from '../../components/mission';
import { ClockIcon } from '../../components/icons';

/**
 * The task detail screen, deep-linkable as dial://task/<id> so a completion
 * notification can open straight to the result.
 *
 * Progress is polled rather than streamed: a phone suspends sockets when it
 * locks, and adaptive polling is both simpler and more reliable there. The
 * interval backs off once the task is no longer moving.
 */
/** How many of the businesses found are shown before "Show more" -- matches the web. */
const CANDIDATE_PREVIEW = 5;

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [intake, setIntake] = useState<Record<string, string>>({});
  const [callingCandidate, setCallingCandidate] = useState<string | null>(null);
  const [openTranscripts, setOpenTranscripts] = useState<Set<string>>(new Set());
  // A search can turn up ninety businesses; the web caps the list the same way.
  const [showAllCandidates, setShowAllCandidates] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setTask(await api.getTask(id));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load this task.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!task || !LIVE_STATES.has(task.state)) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [task, load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function callCandidate(candidateId: string) {
    setCallingCandidate(candidateId);
    await act(() => api.callCandidate(task!.id, candidateId));
    setCallingCandidate(null);
  }

  function toggleTranscript(callId: string) {
    setOpenTranscripts((prev) => {
      const next = new Set(prev);
      if (next.has(callId)) next.delete(callId);
      else next.add(callId);
      return next;
    });
  }

  if (!task) {
    return (
      <View style={styles.centre}>
        {error ? <Notice tone="danger">{error}</Notice> : <ActivityIndicator />}
      </View>
    );
  }

  const tone = toneFor(task.state);
  const live = LIVE_STATES.has(task.state);
  const best = task.result?.best ?? null;
  const calledCandidateIds = new Set(task.calls.map((c) => c.candidateId));
  const manualCallsAllowed = task.state !== 'canceled';
  const paused = Boolean(task.pausedAt);
  // Dispatched and still waiting: the ones pausing cannot stop.
  const outstandingCalls = task.calls.filter(
    (call) => call.disposition === 'pending' && call.providerCallId,
  ).length;
  const visibleCandidates = showAllCandidates
    ? task.candidates
    : task.candidates.slice(0, CANDIDATE_PREVIEW);
  const hiddenCandidates = task.candidates.length - visibleCandidates.length;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      {/*
        The state and how long it has taken share a line: both answer "where is
        this up to", and splitting them makes the reader look twice.
      */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
        <Pill
          label={paused ? `Paused - ${task.stateLabel}` : task.stateLabel}
          bg={paused ? colors.surfaceMuted : tone.bg}
          fg={paused ? colors.textSecondary : tone.fg}
        />
        <TaskTimer activeMs={task.activeMs} activeSince={task.activeSince} />
      </View>

      {/*
        Honest about the limit: pausing stops the next call, not one already
        ringing. CALL-E has no cancellation, so saying "paused" alone would
        imply everything stopped.
      */}
      {paused ? (
        <Notice tone="warning">
          Paused. Dial will not call anyone else until you resume.
          {outstandingCalls > 0
            ? ` ${outstandingCalls} call${outstandingCalls === 1 ? '' : 's'} already in progress cannot be pulled back - the answer will still be recorded.`
            : ''}
        </Notice>
      ) : null}
      {/*
        Sized to how much was typed. A short request is a title; a five-sentence
        brief is a paragraph, and setting the second one at title size buries
        everything below it.
      */}
      <Text style={[styles.instruction, instructionStyle(task.instruction)]}>
        {task.instruction}
      </Text>
      {task.headline ? <Text style={styles.headline}>{task.headline}</Text> : null}

      {task.clarifyingQuestions.length > 0 ? (
        <Card>
          <SectionLabel>A few quick questions</SectionLabel>
          <Text style={{ color: colors.textSecondary, marginBottom: spacing.md }}>
            These let Dial call the right places and ask the right things.
          </Text>

          {task.clarifyingQuestions.map((question) => (
            <View key={question.id} style={{ marginBottom: spacing.md }}>
              <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                {question.question}
              </Text>
              {question.why ? (
                <Text style={{ color: colors.textMuted, fontSize: text.sm, marginBottom: 6 }}>
                  {question.why}
                </Text>
              ) : null}

              {question.options.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: 6 }}>
                  {question.options.map((option) => {
                    const selected = intake[question.id] === option;
                    return (
                      <Pressable
                        key={option}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() =>
                          setIntake((prev) => ({
                            ...prev,
                            [question.id]: selected ? '' : option,
                          }))
                        }
                        style={{
                          paddingHorizontal: spacing.md,
                          minHeight: 44,
                          justifyContent: 'center',
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.primary : colors.surface,
                        }}
                      >
                        <Text style={{ color: selected ? colors.primaryText : colors.textPrimary }}>
                          {option}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <TextInput
                value={intake[question.id] ?? ''}
                onChangeText={(value) => setIntake((prev) => ({ ...prev, [question.id]: value }))}
                placeholder={question.options.length ? 'Or type your own' : 'Your answer'}
                placeholderTextColor={colors.textPlaceholder}
                maxLength={500}
                accessibilityLabel={question.question}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 10,
                  paddingHorizontal: spacing.md,
                  minHeight: 46,
                  color: colors.textPrimary,
                }}
              />
            </View>
          ))}

          <View style={{ gap: spacing.sm }}>
            <Button
              label="Start calling"
              variant="primary"
              loading={busy}
              onPress={() =>
                void act(() =>
                  api.answerQuestions(
                    task.id,
                    Object.entries(intake).map(([id, answer]) => ({ id, answer })),
                  ),
                )
              }
            />
            <Button
              label="Skip and go"
              loading={busy}
              onPress={() => void act(() => api.answerQuestions(task.id, [], true))}
            />
          </View>
        </Card>
      ) : null}

      {task.state === 'needs_user_input' && task.clarificationQuestion ? (
        <Notice tone="warning">{task.clarificationQuestion}</Notice>
      ) : null}

      {/*
        Shown once Dial has actually rung somebody, or once it has stopped.
        Before that there is no progress to report and the card would be a row
        of empty pips claiming a goal Dial has not started on.
      */}
      {task.mission.callsPlaced > 0 || task.mission.stopReason ? (
        <MissionCard mission={task.mission} />
      ) : null}

      {task.pendingAuthorization ? (
        <Card>
          <SectionLabel>Needs your approval</SectionLabel>
          <Text style={{ color: colors.textPrimary, marginBottom: spacing.sm }}>
            {task.pendingAuthorization.prompt}
          </Text>
          <Text style={{ color: colors.textSecondary, marginBottom: spacing.md, fontSize: text.sm }}>
            Dial has not called anyone yet and will not until you approve.
          </Text>
          <View style={{ gap: spacing.sm }}>
            <Button
              label="Approve"
              variant="primary"
              loading={busy}
              onPress={() => void act(() => api.decideAuthorization(task.id, true))}
            />
            <Button
              label="Not now"
              loading={busy}
              onPress={() => void act(() => api.decideAuthorization(task.id, false))}
            />
          </View>
        </Card>
      ) : null}

      {best ? (
        <Card>
          <SectionLabel>Best verified option</SectionLabel>
          <Text style={styles.resultName}>{best.candidate.name}</Text>
          {best.normalizedPrice !== null ? (
            <Text style={styles.resultPrice}>
              {best.normalizedCurrency ?? ''} {best.normalizedPrice.toFixed(2)}
            </Text>
          ) : null}
          {best.rankReasons.map((reason) => (
            <Text key={reason} style={styles.reason}>
              ✓ {reason}
            </Text>
          ))}
          {task.result ? (
            <Text style={styles.tally}>
              {task.result.tally.discovered} found · {task.result.tally.contacted} contacted ·{' '}
              {task.result.tally.answered} answered · {task.result.tally.comparable} comparable
            </Text>
          ) : null}
          {best.candidate.phoneE164 ? (
            <View style={{ marginTop: spacing.md }}>
              <Button
                label="Call them myself"
                onPress={() => void Linking.openURL(`tel:${best.candidate.phoneE164}`)}
              />
            </View>
          ) : null}
        </Card>
      ) : null}

      {task.result && task.result.caveats.length > 0 ? (
        <Notice tone="warning">{task.result.caveats.join('\n')}</Notice>
      ) : null}

      {task.events.length > 0 ? (
        <Card>
          <SectionLabel>Progress</SectionLabel>
          {task.events.map((event, index) => {
            const isLast = index === task.events.length - 1;
            return (
              <Text
                key={event.id}
                style={[styles.event, isLast && live ? styles.eventLive : null]}
              >
                {isLast && live ? '● ' : '✓ '}
                {event.message}
              </Text>
            );
          })}
        </Card>
      ) : null}

      {task.calls.length > 0 ? (
        <Card>
          <SectionLabel>Calls Dial made</SectionLabel>
          {task.calls.map((call) => {
            const open = openTranscripts.has(call.id);
            return (
              <View key={call.id} style={styles.callRow}>
                <View style={styles.callHeader}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '600', flex: 1 }}>
                    {call.businessName}
                    {call.simulated ? (
                      <Text style={{ color: colors.textMuted, fontWeight: '400' }}> · simulated</Text>
                    ) : null}
                  </Text>
                  {call.transcript.length > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      hitSlop={8}
                      onPress={() => toggleTranscript(call.id)}
                    >
                      <Text style={{ color: colors.primary, fontSize: text.sm }}>
                        {open ? 'Hide transcript' : `Transcript (${call.transcript.length})`}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={{ color: colors.textSecondary, fontSize: text.sm }}>
                  {call.phoneMasked} · {callProgressLabel(call.disposition, call.providerStatus)}
                </Text>
                {call.summary ? (
                  <Text style={{ color: colors.textSecondary, marginTop: 4 }}>{call.summary}</Text>
                ) : null}
                {call.structuredResult?.['evidence_summary'] ? (
                  <Text style={{ color: colors.textSecondary, marginTop: 4 }}>
                    {String(call.structuredResult['evidence_summary'])}
                  </Text>
                ) : !call.summary && call.failureMessage ? (
                  <Text style={{ color: colors.textMuted, marginTop: 4 }}>{call.failureMessage}</Text>
                ) : null}
                {open ? (
                  <View style={styles.transcript}>
                    {call.transcript.map((turn, index) => (
                      <View
                        key={`${call.id}-${index}`}
                        style={[
                          styles.turn,
                          turn.speaker === 'bot' ? styles.turnBot : null,
                          turn.speaker === 'user' ? styles.turnUser : null,
                        ]}
                      >
                        <Text style={styles.turnSpeaker}>
                          {turn.speaker === 'bot'
                            ? 'Dial'
                            : turn.speaker === 'user'
                              ? 'Them'
                              : '—'}{' '}
                          {formatOffset(turn.offsetSeconds)}
                        </Text>
                        <Text style={styles.turnText}>{turn.text}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
      ) : null}

      {task.candidates.length > 0 ? (
        <Card>
          <SectionLabel>Businesses found ({task.candidates.length})</SectionLabel>
          {visibleCandidates.map((entry) => {
            const c = entry.candidate;
            const called = calledCandidateIds.has(c.id);
            return (
              <View key={c.id} style={styles.candidateRow}>
                <Text
                  style={[
                    styles.candidateName,
                    entry.excludedReason ? { color: colors.textMuted } : null,
                  ]}
                >
                  {c.name}
                </Text>
                <Text style={styles.candidateMeta}>
                  {[
                    c.distanceMeters !== null
                      ? `${(c.distanceMeters / 1000).toFixed(1)} km`
                      : null,
                    c.rating !== null
                      ? `★ ${c.rating.toFixed(1)}${c.reviewCount ? ` (${c.reviewCount})` : ''}`
                      : null,
                    c.phoneE164 ? c.phoneE164.replace(/(\+?\d{3})\d+(?=\d{2})/, '$1•••••') : 'no number',
                    entry.excludedReason ? `✕ ${entry.excludedReason}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {entry.reasons.slice(0, 2).map((reason) => (
                  <Text key={reason} style={styles.candidateReason}>
                    ✓ {reason}
                  </Text>
                ))}
                {manualCallsAllowed && !entry.excludedReason && c.phoneE164 ? (
                  called ? (
                    <Text style={styles.calledTag}>Called</Text>
                  ) : (
                    <View style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
                      <Button
                        label="Call this one"
                        loading={callingCandidate === c.id && busy}
                        onPress={() => void callCandidate(c.id)}
                      />
                    </View>
                  )
                ) : null}
              </View>
            );
          })}

          {/*
            Counted rather than vague: "Show 93 more" tells the reader how much
            is behind the button, which "Show more" does not.
          */}
          {hiddenCandidates > 0 ? (
            <View style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}>
              <Button
                label={`Show ${hiddenCandidates} more`}
                onPress={() => setShowAllCandidates(true)}
              />
            </View>
          ) : null}
          {showAllCandidates && task.candidates.length > CANDIDATE_PREVIEW ? (
            <View style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}>
              <Button label="Show fewer" onPress={() => setShowAllCandidates(false)} />
            </View>
          ) : null}
        </Card>
      ) : null}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        {live ? (
          <Button
            label={paused ? 'Resume' : 'Pause'}
            variant="primary"
            loading={busy}
            onPress={() =>
              void act(() => (paused ? api.resumeTask(task.id) : api.pauseTask(task.id)))
            }
          />
        ) : null}
        {live ? (
          <Button
            label="Stop this task"
            variant="danger"
            loading={busy}
            onPress={() => void act(() => api.cancelTask(task.id))}
          />
        ) : null}
        <Button
          label="Delete"
          loading={busy}
          onPress={() =>
            void act(async () => {
              await api.deleteTask(task.id);
              router.replace('/(tabs)/history');
            })
          }
        />
      </View>
    </ScrollView>
  );
}

/** 75 seconds -> "1:15", matching how a call length reads on a phone. */
function formatOffset(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The request's type size, following its length.
 *
 * Matches the web app's thresholds exactly so the same task does not look like
 * two different things on the two platforms. Counted in characters rather than
 * lines, because the line count depends on the screen.
 */
function instructionStyle(instruction: string) {
  const length = instruction.trim().length;
  if (length <= 70) return null;
  if (length <= 160) return { fontSize: text.lg, lineHeight: 25 };
  return { fontSize: text.md, fontWeight: '500' as const, lineHeight: 23 };
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  instruction: { fontSize: text.xl, fontWeight: '600', color: colors.textPrimary, lineHeight: 28 },
  headline: { fontSize: text.base, color: colors.textSecondary },
  resultName: { fontSize: text.xl, fontWeight: '600', color: colors.textPrimary },
  resultPrice: { fontSize: text.xxl, fontWeight: '600', color: colors.textPrimary },
  reason: { color: colors.textSecondary, marginTop: 4 },
  tally: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    color: colors.textSecondary,
    fontSize: text.sm,
  },
  event: { color: colors.textSecondary, paddingVertical: 3 },
  eventLive: { color: colors.textPrimary, fontWeight: '600' },
  callRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  candidateRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  candidateName: { color: colors.textPrimary, fontWeight: '600' },
  candidateMeta: { color: colors.textMuted, fontSize: text.sm, marginTop: 2 },
  candidateReason: { color: colors.textSecondary, fontSize: text.sm, marginTop: 2 },
  calledTag: { color: colors.textMuted, marginTop: spacing.sm, fontSize: text.sm },
  callHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  transcript: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    gap: spacing.sm,
  },
  turn: {
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
    maxWidth: '90%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  turnBot: { alignSelf: 'flex-start' },
  turnUser: { alignSelf: 'flex-end', backgroundColor: colors.background },
  turnSpeaker: { color: colors.textMuted, fontSize: text.xs, marginBottom: 2 },
  turnText: { color: colors.textPrimary },
});


/**
 * How long Dial has worked on this task.
 *
 * Not "time since created": a task can wait an hour for the user to answer,
 * and none of that is Dial working. The server banks each period of work, so
 * this only ticks the one still open -- and a task asked to do more resumes
 * from the banked total rather than starting again.
 */
function TaskTimer({ activeMs, activeSince }: { activeMs: number; activeSince: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!activeSince) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeSince]);

  const elapsed = elapsedWorkingMs({ activeMs, activeSince }, now);
  // A "0:00" that never moves reads as broken; show nothing until work starts.
  if (elapsed <= 0 && !activeSince) return null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <ClockIcon size={14} color={activeSince ? colors.textSecondary : colors.textMuted} />
      <Text
        accessibilityLabel={`${activeSince ? 'Elapsed' : 'Total'} working time`}
        style={{
          color: activeSince ? colors.textSecondary : colors.textMuted,
          fontSize: text.sm,
          fontWeight: activeSince ? '500' : '400',
          // Fixed width so the row does not jitter as the seconds tick.
          minWidth: 40,
          fontVariant: ['tabular-nums'],
        }}
      >
        {formatDuration(elapsed)}
      </Text>
    </View>
  );
}
