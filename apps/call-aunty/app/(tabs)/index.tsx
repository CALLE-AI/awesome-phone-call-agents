import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import * as Network from "expo-network";
import { FeedbackToast } from "@/components/call-aunty/feedback-toast";
import { InfoSheet } from "@/components/call-aunty/info-sheet";
import { CheckInChoiceButton } from "@/components/call-aunty/check-in-choice-button";
import { CheckInQuestionVisual } from "@/components/call-aunty/check-in-question-visual";
import { ConnectionChip } from "@/components/call-aunty/connection-chip";
import { MetricTiles } from "@/components/call-aunty/metric-tiles";
import { PasscodeModal } from "@/components/call-aunty/passcode-modal";
import { QueuePersonCard } from "@/components/call-aunty/queue-person-card";
import { ShortcutGrid } from "@/components/call-aunty/shortcut-grid";
import { StatusBanner } from "@/components/call-aunty/status-banner";
import { AppErrorBoundary } from "@/components/call-aunty/app-error-boundary";
import { VoiceAnswerControl } from "@/components/call-aunty/voice-answer-control";
import { VoicePromptCard } from "@/components/call-aunty/voice-prompt-card";
import { router } from "expo-router";
import { cardElevation, heroElevation, TAB_SCROLL_BOTTOM } from "@/lib/ui-elevation";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAppRole } from "@/contexts/app-role";
import { useLanguage } from "@/contexts/language-context";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { openPhoneHandoff } from "@/lib/contact-handoff";
import { DEMO_QUEUE } from "@/lib/demo-queue";
import { awaitingCallbackCount, getFieldActivityCopy } from "@/lib/mock-households";
import { clearCheckInState, loadCheckInState, saveCheckInState, type SavedCheckIn } from "@/lib/local-store";
import { DEFAULT_APP_LOCK_TIMEOUT_MS, shouldLockAfterBackground } from "@/lib/app-lock";
import { formatAppLockTimeout, loadAppLockTimeout, type AppLockTimeoutMs } from "@/lib/app-lock-preferences";
import { loadCompletedFollowUps } from "@/lib/follow-up-store";
import { loadPrivacyLock, savePrivacyLock, unlockPrivacyLock } from "@/lib/privacy-lock";
import { recordSecurityEvent } from "@/lib/security-audit";
import { getPasscodeAttemptState, hasPasscode, verifyPasscode } from "@/lib/passcode";
import { getCooldownProgress, getCooldownSeconds, isCooldownActive } from "@/lib/passcode-utils";
import { getSecurityCopy } from "@/lib/security-copy";
import { applyCheckInAnswer, getConcerningFindings, previousCheckInQuestion } from "@/lib/check-in-stepper";
import { getAppCopy, getSettingsCopy, getWomanDashboardAccessibilityCopy, getChwDashboardAccessibilityCopy, getChwSyncAccessibilityCopy } from "@/lib/app-copy";
import { formatLastSync, getPendingSyncCount, getQueueSummary, loadLastSyncAt, loadSyncQueue, markQueueRetry, markQueueSynced, saveLastSyncAt, saveSyncQueue, type SyncQueueItem } from "@/lib/sync-queue";
import { trpc } from "@/lib/trpc";
import { getNextAutomaticItem } from "@/lib/sync-recovery";
import { summarizeSyncQueue } from "@/lib/sync-observability";
import { formatSyncDiagnostic, normalizeReachability } from "@/lib/sync-diagnostic";
import { mergeQueueWithServer } from "@/lib/sync-reconciliation";
import { classifySyncConflicts, resolveSyncConflict, type SyncConflictDecision } from "@/lib/sync-conflicts";
import { formatReconciliationFeedback } from "@/lib/reconciliation-feedback";
import { loadReconciliationHistory, recordReconciliationHistory, type ReconciliationHistoryEntry } from "@/lib/reconciliation-history";
import { formatReconciliationHistory } from "@/lib/reconciliation-history-copy";
import { getOfflineCopy, getOfflineStateMessage } from "@/lib/offline-readiness-copy";
import { getOfflineReadinessSummary } from "@/lib/offline-readiness";
import { DEFAULT_LOW_DATA_MODE, loadLowDataMode, shouldUseServerRefresh, type LowDataMode } from "@/lib/low-data-preferences";
import { getLowDataCopy } from "@/lib/low-data-copy";
import { getSyncTransferCopy } from "@/lib/sync-transfer-copy";
import { advanceTransferProgress, clearTransferProgress, createTransferProgress, loadTransferProgress, pauseTransferProgress, resumeTransferProgress, saveTransferProgress, type SyncTransferProgress } from "@/lib/sync-transfer";
import { getTransferControlCopy } from "@/lib/transfer-control-copy";
import { clearOfflineCheckInProgress, createOfflineCheckInProgress, loadOfflineCheckInProgress, offlineCheckInDisplayQuestion, saveOfflineCheckInProgress, type OfflineCheckInProgress } from "@/lib/offline-checkin";
import { getOfflineHomeCopy } from "@/lib/offline-home-copy";
import { offlineClinicGuidance } from "@/lib/offline-clinic-guidance";
import {
  CHECK_IN_QUESTION_COUNT,
  CHECK_IN_QUESTIONS,
  EMPTY_CHECK_IN_ANSWERS,
  getAnswerLabels,
  getCheckInQuestionnaireCopy,
} from "@/lib/check-in-questionnaire";
import type { CheckInAnswers } from "@/lib/triage";

type CheckInState = "idle" | "started" | "safe" | "attention" | "escalated";

const queue = DEMO_QUEUE;

export default function HomeScreen() {
  const colors = useColors();
  const tints = useUiTints();
  const { role } = useAppRole();
  const { language } = useLanguage();
  const syncFollowUp = trpc.sync.followUp.useMutation();
  const [checkIn, setCheckIn] = useState<CheckInState>("idle");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"neutral" | "success" | "warning" | "error">("neutral");
  const [question, setQuestion] = useState(0);
  const [checkInAnswers, setCheckInAnswers] = useState<CheckInAnswers>(EMPTY_CHECK_IN_ANSWERS);
  const [hasDraft, setHasDraft] = useState(false);
  const [completedFollowUps, setCompletedFollowUps] = useState<string[]>([]);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [queueItems, setQueueItems] = useState<SyncQueueItem[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [, setReconciliationFeedback] = useState<string | null>(null);
  const [reconciliationHistory, setReconciliationHistory] = useState<ReconciliationHistoryEntry[]>([]);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "kept_local" | "accepted_server">("all");
  const [acceptServerModalOpen, setAcceptServerModalOpen] = useState(false);
  const [localConflictCount, setLocalConflictCount] = useState(0);
  const [privacyLocked, setPrivacyLocked] = useState(false);
  const [lockTimeoutMs, setLockTimeoutMs] = useState<AppLockTimeoutMs>(DEFAULT_APP_LOCK_TIMEOUT_MS);
  const [passcodeConfigured, setPasscodeConfigured] = useState(false);
  const [passcodeModalOpen, setPasscodeModalOpen] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | undefined>();
  const [passcodeCooldownUntil, setPasscodeCooldownUntil] = useState<number | null>(null);
  const [cooldownNow, setCooldownNow] = useState(Date.now());
  const [internetReachable, setInternetReachable] = useState<boolean | null>(null);
  const [lowDataMode, setLowDataMode] = useState<LowDataMode>(DEFAULT_LOW_DATA_MODE);
  const [transferProgress, setTransferProgress] = useState<SyncTransferProgress | null>(null);
  const [offlineCheckInProgress, setOfflineCheckInProgress] = useState<OfflineCheckInProgress | null>(null);
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [guidanceSheetOpen, setGuidanceSheetOpen] = useState(false);
  const [callSheetTitle, setCallSheetTitle] = useState("");
  const backgroundAt = useRef<number | null>(null);
  const automaticRetryInFlight = useRef(false);
  const answeringInFlight = useRef(false);
  const appLockTimeoutMs = useRef(DEFAULT_APP_LOCK_TIMEOUT_MS);
  const serverFollowUpsQuery = trpc.sync.followUps.useQuery(undefined, {
    enabled: role === "chw" && !privacyLocked,
    retry: false,
    staleTime: 15_000,
  });

  useEffect(() => {
    let mounted = true;
    void Promise.all([loadCheckInState(), loadOfflineCheckInProgress()])
      .then(([saved, progress]) => {
        if (!mounted) return;
        const savedDraft = saved?.status === "started" ? saved : null;
        let nextProgress = progress;
        let nextQuestion = 0;
        let nextAnswers = EMPTY_CHECK_IN_ANSWERS;
        let draft = false;

        if (savedDraft && progress) {
          const preferOffline = Date.parse(progress.savedAt) >= Date.parse(savedDraft.savedAt);
          if (preferOffline) {
            nextQuestion = Math.min(progress.completedQuestion, CHECK_IN_QUESTION_COUNT - 1);
            nextAnswers = progress.answers;
          } else {
            nextQuestion = Math.min(savedDraft.question, CHECK_IN_QUESTION_COUNT - 1);
            nextAnswers = savedDraft.answers;
            nextProgress = { ...createOfflineCheckInProgress(nextQuestion, nextAnswers), savedAt: savedDraft.savedAt };
            void saveOfflineCheckInProgress(nextProgress).catch(() => undefined);
          }
          draft = true;
        } else if (progress) {
          nextQuestion = Math.min(progress.completedQuestion, CHECK_IN_QUESTION_COUNT - 1);
          nextAnswers = progress.answers;
          draft = true;
        } else if (savedDraft) {
          nextQuestion = Math.min(savedDraft.question, CHECK_IN_QUESTION_COUNT - 1);
          nextAnswers = savedDraft.answers;
          nextProgress = { ...createOfflineCheckInProgress(nextQuestion, nextAnswers), savedAt: savedDraft.savedAt };
          draft = true;
          void saveOfflineCheckInProgress(nextProgress).catch(() => undefined);
        }

        setOfflineCheckInProgress(nextProgress);
        if (draft) {
          setQuestion(nextQuestion);
          setCheckInAnswers(nextAnswers);
          setHasDraft(true);
        }
      })
      .catch(() => {
        if (mounted) setOfflineCheckInProgress(null);
      });
    void loadCompletedFollowUps().then((items) => {
      if (mounted) setCompletedFollowUps(items.map((item) => item.womanId));
    }).catch(() => undefined);
    void loadLastSyncAt().then((timestamp) => {
      if (mounted) setLastSyncAt(timestamp);
    }).catch(() => undefined);
    void loadPrivacyLock().then((locked) => {
      if (mounted) setPrivacyLocked(locked);
    }).catch(() => {
      if (mounted) setPrivacyLocked(false);
    });
    void loadLowDataMode().then(setLowDataMode).catch(() => setLowDataMode(DEFAULT_LOW_DATA_MODE));
    void loadTransferProgress().then(setTransferProgress).catch(() => setTransferProgress(null));
    void loadReconciliationHistory().then(setReconciliationHistory).catch(() => {
      if (mounted) setReconciliationHistory([]);
    });
    void loadAppLockTimeout().then((value) => {
      appLockTimeoutMs.current = value;
      setLockTimeoutMs(value);
    }).catch(() => {
      appLockTimeoutMs.current = DEFAULT_APP_LOCK_TIMEOUT_MS;
      setLockTimeoutMs(DEFAULT_APP_LOCK_TIMEOUT_MS);
    });
    void hasPasscode().then(setPasscodeConfigured).catch(() => setPasscodeConfigured(false));
    void loadSyncQueue().then((items) => {
      if (mounted) {
        setQueueItems(items);
        setPendingSyncCount(getPendingSyncCount(items));
      }
    }).catch(() => {
      if (mounted) {
        setQueueItems([]);
        setPendingSyncCount(0);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!passcodeModalOpen) return;
    const timer = setInterval(() => setCooldownNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [passcodeModalOpen]);

  useEffect(() => {
    if (passcodeCooldownUntil !== null && cooldownNow >= passcodeCooldownUntil) {
      setPasscodeCooldownUntil(null);
      setPasscodeError(getSecurityCopy(language).cooldown(0));
    }
  }, [cooldownNow, language, passcodeCooldownUntil]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        backgroundAt.current = Date.now();
        return;
      }
      if (nextState === "active" && shouldLockAfterBackground(backgroundAt.current, Date.now(), appLockTimeoutMs.current)) {
        backgroundAt.current = null;
        setPrivacyLocked(true);
        void savePrivacyLock(true).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let mounted = true;
    void Network.getNetworkStateAsync().then((state) => { if (mounted) setInternetReachable(state.isInternetReachable ?? null); }).catch(() => { if (mounted) setInternetReachable(null); });
    const subscription = Network.addNetworkStateListener((state) => setInternetReachable(state.isInternetReachable ?? null));
    return () => { mounted = false; subscription.remove(); };
  }, []);

  const copy = useMemo(() => getAppCopy(language), [language]);
  const fieldActivity = useMemo(() => getFieldActivityCopy(language), [language]);
  const mockCallbacks = awaitingCallbackCount();
  const settingsCopy = useMemo(() => getSettingsCopy(language), [language]);
  const womanA11y = useMemo(() => getWomanDashboardAccessibilityCopy(language), [language]);
  const chwA11y = useMemo(() => getChwDashboardAccessibilityCopy(language), [language]);
  const chwSyncA11y = useMemo(() => getChwSyncAccessibilityCopy(language), [language]);
  const questionnaireCopy = useMemo(() => getCheckInQuestionnaireCopy(language), [language]);
  const progress = useMemo(() => questionnaireCopy.progress(question + 1, CHECK_IN_QUESTION_COUNT), [question, questionnaireCopy]);
  const syncSummary = useMemo(() => summarizeSyncQueue(queueItems), [queueItems]);
  const offlineSummary = useMemo(() => getOfflineReadinessSummary(internetReachable, queueItems, syncSummary), [internetReachable, queueItems, syncSummary]);
  const offlineCopy = useMemo(() => getOfflineCopy(language), [language]);
  const transferCopy = useMemo(() => getTransferControlCopy(language), [language]);
  const offlineHomeCopy = useMemo(() => getOfflineHomeCopy(language), [language]);
  const activeQuestion = CHECK_IN_QUESTIONS[question] ?? CHECK_IN_QUESTIONS[0];
  const answerLabels = useMemo(() => getAnswerLabels(activeQuestion, questionnaireCopy), [activeQuestion, questionnaireCopy]);
  const filteredReconciliationHistory = useMemo(() => historyFilter === "all" ? reconciliationHistory : reconciliationHistory.filter((entry) => entry.decision === historyFilter), [historyFilter, reconciliationHistory]);

  async function runSyncDiagnostic() {
    if (privacyLocked) {
      showToast(copy.privacySyncBody, "warning");
      return;
    }
    try {
      const networkState = await Network.getNetworkStateAsync();
      const items = await loadSyncQueue();
      const diagnostic = formatSyncDiagnostic(normalizeReachability(networkState.isInternetReachable), summarizeSyncQueue(items), {
        online: copy.syncOnline,
        offline: copy.syncOffline,
        unknown: copy.syncUnknown,
        queued: copy.syncDiagnosticQueued,
        retrying: copy.syncDiagnosticRetrying,
        synced: copy.syncDiagnosticSynced,
        exhausted: copy.syncDiagnosticExhausted,
      });
      showToast(diagnostic, "neutral");
    } catch {
      showToast(copy.syncUnknown, "warning");
    }
  }

  async function changeTransferState(action: "pause" | "resume" | "cancel") {
    if (!transferProgress) return;
    try {
      if (action === "cancel") {
        const cleared = await clearTransferProgress();
        if (!cleared) {
          Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
          return;
        }
        setTransferProgress(null);
        return;
      }
      const next = action === "pause" ? pauseTransferProgress(transferProgress) : resumeTransferProgress(transferProgress);
      const saved = await saveTransferProgress(next);
      if (!saved) {
        Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
        return;
      }
      setTransferProgress(next);
    } catch {
      Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
    }
  }

  function confirmSyncTransfer(body: string): Promise<boolean> {
    const transferCopy = getSyncTransferCopy(language);
    return new Promise((resolve) => Alert.alert(transferCopy.confirmTitle, body, [{ text: transferCopy.cancel, style: "cancel", onPress: () => resolve(false) }, { text: transferCopy.continue, onPress: () => resolve(true) }], { cancelable: false }));
  }

  async function refreshQueue() {
    if (privacyLocked) {
      Alert.alert(copy.privacyLockTitle, copy.privacySyncBody);
      return;
    }
    try {
      const localItems = await loadSyncQueue();
      let items = localItems;
      let serverAvailable = false;
      const networkState = await Network.getNetworkStateAsync().catch(() => ({ isInternetReachable: null, type: null }));
      const canUseServer = shouldUseServerRefresh(lowDataMode, networkState.isInternetReachable, networkState.type);
      if (!canUseServer) {
        setReconciliationFeedback(`${chwSyncA11y.resultLabel}: ${getLowDataCopy(language).detail}`);
      } else try {
        const transferCopy = getSyncTransferCopy(language);
        const body = networkState.type?.toString().toLowerCase() === "wifi" ? transferCopy.wifiBody : networkState.type ? transferCopy.cellularBody : transferCopy.unknownBody;
        const pendingCount = getPendingSyncCount(localItems);
        if (pendingCount > 0 && !(await confirmSyncTransfer(body))) {
          setReconciliationFeedback(`${chwSyncA11y.resultLabel}: ${transferCopy.saved}`);
          return;
        }
        const nextTransferProgress = createTransferProgress(pendingCount);
        await saveTransferProgress(nextTransferProgress);
        setTransferProgress(nextTransferProgress);
        const serverResult = await serverFollowUpsQuery.refetch();
        if (serverResult.data) {
          serverAvailable = true;
          const conflicts = classifySyncConflicts(localItems, serverResult.data);
          setLocalConflictCount(conflicts.localNewer);
          items = mergeQueueWithServer(localItems, serverResult.data);
          await saveTransferProgress(advanceTransferProgress(nextTransferProgress, nextTransferProgress.totalItems));
          await clearTransferProgress();
          setTransferProgress(null);
        }
      } catch {
        setLocalConflictCount(0);
        items = localItems;
      }
      const nextSummary = getQueueSummary(items);
      const localSummary = getQueueSummary(localItems);
      const syncedCount = Math.max(0, nextSummary.synced - localSummary.synced);
      const preservedCount = nextSummary.queued + nextSummary.retrying;
      const reconciliationCopy = { synced: copy.reconciliationSynced, preserved: `${copy.reconciliationPreserved} · ${chwSyncA11y.preservedResult}`, fallback: chwSyncA11y.fallbackResult };
      const reconciliationMessage = formatReconciliationFeedback({ syncedCount, preservedCount, serverAvailable, copy: reconciliationCopy });
      setReconciliationFeedback(`${chwSyncA11y.resultLabel}: ${reconciliationMessage}`);
      const history = await recordReconciliationHistory({ timestamp: new Date().toISOString(), serverAvailable, syncedCount, preservedCount });
      setReconciliationHistory(history);
      showToast(reconciliationMessage, serverAvailable ? "success" : "warning");
      await saveSyncQueue(items);
      setQueueItems(items);
      setPendingSyncCount(preservedCount);
      setLastSyncAt(new Date().toISOString());
    } catch {
      const fallbackItems = await loadSyncQueue().catch(() => [] as SyncQueueItem[]);
      setQueueItems(fallbackItems);
      setPendingSyncCount(getPendingSyncCount(fallbackItems));
      setReconciliationFeedback(`${chwSyncA11y.resultLabel}: ${chwSyncA11y.fallbackResult}`);
      Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
    }
  }

  async function resolveConflict(decision: SyncConflictDecision) {
    if (privacyLocked) {
      Alert.alert(copy.privacyLockTitle, copy.privacySyncBody);
      return;
    }
    try {
      const serverItems = serverFollowUpsQuery.data ?? [];
      if (serverItems.length === 0 || localConflictCount === 0) return;
      const localItems = await loadSyncQueue();
      const resolved = resolveSyncConflict(localItems, serverItems, decision);
      await saveSyncQueue(resolved);
      setQueueItems(resolved);
      setPendingSyncCount(getPendingSyncCount(resolved));
      setLocalConflictCount(0);
      await recordSecurityEvent(decision === "keep_local" ? "conflict_kept_local" : "conflict_accepted_server");
      setReconciliationFeedback(`${chwSyncA11y.resultLabel}: ${decision === "keep_local" ? `${copy.reconciliationKeptLocal} · ${chwSyncA11y.conflictResult}` : copy.reconciliationAcceptedServer}`);
      const history = await recordReconciliationHistory({ timestamp: new Date().toISOString(), serverAvailable: true, syncedCount: decision === "accept_server" ? localConflictCount : 0, preservedCount: decision === "keep_local" ? localConflictCount : 0, decision: decision === "keep_local" ? "kept_local" : "accepted_server" });
      setReconciliationHistory(history);
    } catch {
      setReconciliationFeedback(`${chwSyncA11y.resultLabel}: ${chwSyncA11y.fallbackResult}`);
      Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
    }
  }

  const retryQueueItem = useCallback(async (item: SyncQueueItem) => {
    if (privacyLocked) {
      Alert.alert(copy.privacyLockTitle, copy.privacySyncBody);
      return;
    }
    try {
      const updated = await markQueueRetry(item.id);
      setQueueItems(updated);
      setPendingSyncCount(getPendingSyncCount(updated));
      await syncFollowUp.mutateAsync({
        dedupeKey: item.id,
        womanId: item.payload.womanId,
        contactMethod: item.payload.contactMethod,
        outcome: item.payload.outcome,
        note: item.payload.note,
        nextAction: item.payload.nextAction,
        status: "completed",
        clientUpdatedAt: item.updatedAt,
      });
      const synced = await markQueueSynced(item.id);
      setQueueItems(synced);
      setPendingSyncCount(getPendingSyncCount(synced));
      const syncedAt = new Date().toISOString();
      await saveLastSyncAt(syncedAt);
      setLastSyncAt(syncedAt);
    } catch {
      const fallbackItems = await loadSyncQueue().catch(() => [] as SyncQueueItem[]);
      setQueueItems(fallbackItems);
      setPendingSyncCount(getPendingSyncCount(fallbackItems));
      setReconciliationFeedback(copy.syncUnavailableBody);
      Alert.alert(copy.syncUnavailableTitle, copy.syncUnavailableBody);
    }
  }, [copy, privacyLocked, syncFollowUp]);

  useEffect(() => {
    if (role !== "chw" || privacyLocked) return;
    const subscription = Network.addNetworkStateListener((state) => {
      if (state.isInternetReachable === false || automaticRetryInFlight.current) return;
      const nextItem = getNextAutomaticItem(queueItems);
      if (!nextItem) return;
      automaticRetryInFlight.current = true;
      void retryQueueItem(nextItem).finally(() => {
        automaticRetryInFlight.current = false;
      });
    });
    return () => subscription.remove();
  }, [privacyLocked, queueItems, retryQueueItem, role]);

  async function completePasscodeUnlock() {
    if (isCooldownActive(passcodeCooldownUntil, cooldownNow)) return;
    let valid = false;
    try {
      valid = await verifyPasscode(passcodeInput);
    } catch {
      setPasscodeError(copy.unexpectedErrorBody);
      Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
      return;
    }
    if (!valid) {
      try {
        const attemptState = await getPasscodeAttemptState();
        setPasscodeCooldownUntil(attemptState.cooldownUntil);
        setPasscodeError(attemptState.cooldownUntil ? getSecurityCopy(language).cooldown(getCooldownSeconds(attemptState.cooldownUntil, Date.now())) : passcodeConfigured ? settingsCopy.passcodeMismatch : settingsCopy.passcodeMissing);
      } catch {
        setPasscodeError(passcodeConfigured ? settingsCopy.passcodeMismatch : settingsCopy.passcodeMissing);
      }
      return;
    }
    try {
      await savePrivacyLock(false);
      setPrivacyLocked(false);
      setPasscodeModalOpen(false);
      setPasscodeInput("");
      setPasscodeError(undefined);
      setPasscodeCooldownUntil(null);
    } catch {
      setPasscodeError(copy.unexpectedErrorBody);
      Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
    }
  }

  async function togglePrivacyLock() {
    try {
      if (privacyLocked) {
        const result = await unlockPrivacyLock();
        if (!result.unlocked) {
          setPasscodeError(passcodeConfigured ? undefined : settingsCopy.passcodeMissing);
          setPasscodeModalOpen(true);
          return;
        }
        await savePrivacyLock(false);
        setPrivacyLocked(false);
        return;
      }
      await savePrivacyLock(true);
      setPrivacyLocked(true);
    } catch {
      Alert.alert(copy.unexpectedErrorTitle, copy.privacyActionError);
    }
  }

  async function persistCheckInState(state: SavedCheckIn): Promise<boolean> {
    try {
      const saved = await saveCheckInState(state);
      if (!saved) {
        Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
        return false;
      }
      return true;
    } catch {
      Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
      return false;
    }
  }

  async function persistOfflineProgress(progressState: OfflineCheckInProgress | null): Promise<boolean> {
    try {
      if (progressState) {
        const saved = await saveOfflineCheckInProgress(progressState);
        if (!saved) {
          Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
          return false;
        }
        return true;
      }
      const cleared = await clearOfflineCheckInProgress();
      if (!cleared) {
        Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
        return false;
      }
      return true;
    } catch {
      Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
      return false;
    }
  }

  function leaveCheckInFlow() {
    if (checkIn === "started") {
      const offlineProgress = createOfflineCheckInProgress(question, checkInAnswers);
      setOfflineCheckInProgress(offlineProgress);
      setHasDraft(true);
      void persistOfflineProgress(offlineProgress);
      void persistCheckInState({
        status: "started",
        question,
        answers: checkInAnswers,
        savedAt: new Date().toISOString(),
      });
    } else {
      setHasDraft(Boolean(offlineCheckInProgress));
    }
    setCheckIn("idle");
    showToast(questionnaireCopy.pauseToast, "success");
  }

  async function goToPreviousQuestion() {
    if (question <= 0) return;
    const nextQuestion = previousCheckInQuestion(question);
    const offlineProgress = createOfflineCheckInProgress(nextQuestion, checkInAnswers);
    const savedOffline = await persistOfflineProgress(offlineProgress);
    const savedState = await persistCheckInState({
      status: "started",
      question: nextQuestion,
      answers: checkInAnswers,
      savedAt: new Date().toISOString(),
    });
    setQuestion(nextQuestion);
    setOfflineCheckInProgress(offlineProgress);
    setHasDraft(true);
    if (!savedOffline || !savedState) showToast(copy.unexpectedErrorBody, "warning");
  }

  function requestFreshCheckIn() {
    if (hasDraft || offlineCheckInProgress) {
      Alert.alert(questionnaireCopy.restartTitle, questionnaireCopy.restartBody, [
        { text: copy.resume, onPress: () => startCheckIn(true) },
        { text: questionnaireCopy.startNew, style: "destructive", onPress: () => startCheckIn(false) },
      ]);
      return;
    }
    startCheckIn(false);
  }

  async function returnHomeFromOutcome() {
    const clearedOffline = await persistOfflineProgress(null);
    const clearedState = await clearCheckInState().catch(() => false);
    if (!clearedOffline || !clearedState) {
      showToast(copy.unexpectedErrorBody, "warning");
    } else {
      setOfflineCheckInProgress(null);
      setHasDraft(false);
    }
    setCheckIn("idle");
  }

  function startCheckIn(resume = false) {
    setCheckIn("started");
    answeringInFlight.current = false;
    if (!resume) {
      setQuestion(0);
      setCheckInAnswers(EMPTY_CHECK_IN_ANSWERS);
      const offlineProgress = createOfflineCheckInProgress(0, EMPTY_CHECK_IN_ANSWERS);
      setOfflineCheckInProgress(offlineProgress);
      setHasDraft(true);
      void persistOfflineProgress(offlineProgress);
      void persistCheckInState({
        status: "started",
        question: 0,
        answers: EMPTY_CHECK_IN_ANSWERS,
        savedAt: new Date().toISOString(),
      });
    } else if (offlineCheckInProgress) {
      setQuestion(Math.min(offlineCheckInProgress.completedQuestion, CHECK_IN_QUESTION_COUNT - 1));
      setCheckInAnswers(offlineCheckInProgress.answers);
      setHasDraft(true);
    } else {
      setQuestion(Math.min(question, CHECK_IN_QUESTION_COUNT - 1));
      setHasDraft(true);
    }
  }

  async function answer(choseYes: boolean) {
    if (answeringInFlight.current) return;
    answeringInFlight.current = true;
    try {
      const step = applyCheckInAnswer(question, checkInAnswers, choseYes);
      if (!step.applied) {
        showToast(copy.unexpectedErrorBody, "warning");
        setQuestion(step.question);
        return;
      }

      try {
        if (step.status === "escalated") {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } else if (step.status === "safe") {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      } catch {
        // Haptics are optional on web and unsupported devices.
      }

      if (step.status === "started") {
        const offlineProgress = createOfflineCheckInProgress(step.question, step.answers);
        const savedOffline = await persistOfflineProgress(offlineProgress);
        const savedState = await persistCheckInState({
          status: "started",
          question: step.question,
          answers: step.answers,
          savedAt: new Date().toISOString(),
        });
        if (!savedOffline || !savedState) {
          showToast(copy.unexpectedErrorBody, "error");
        }
        setCheckInAnswers(step.answers);
        setQuestion(step.question);
        setCheckIn(step.status);
        setOfflineCheckInProgress(offlineProgress);
        setHasDraft(true);
        return;
      }

      const savedState = await persistCheckInState({
        status: step.status,
        question: step.question,
        answers: step.answers,
        savedAt: new Date().toISOString(),
      });
      const clearedOffline = await persistOfflineProgress(null);
      setCheckInAnswers(step.answers);
      setQuestion(step.question);
      setCheckIn(step.status);
      if (clearedOffline) {
        setOfflineCheckInProgress(null);
        setHasDraft(false);
      } else {
        showToast(copy.unexpectedErrorBody, "warning");
      }
      if (!savedState) showToast(copy.unexpectedErrorBody, "error");
    } catch {
      Alert.alert(copy.unexpectedErrorTitle, copy.unexpectedErrorBody);
    } finally {
      answeringInFlight.current = false;
    }
  }

  function openCallSheet(title = copy.callHandoffTitle) {
    setCallSheetTitle(title);
    setCallSheetOpen(true);
  }

  async function confirmCallHandoff() {
    setCallSheetOpen(false);
    const opened = await openPhoneHandoff();
    if (!opened) {
      setToastTone("warning");
      setToastMessage(copy.callHandoffFailed);
    }
  }

  function showToast(message: string, tone: "neutral" | "success" | "warning" | "error" = "neutral") {
    setToastTone(tone);
    setToastMessage(message);
  }

  const guidanceBody = useMemo(
    () => `${offlineHomeCopy.guidanceBody}\n\n${offlineClinicGuidance.map((topic) => `• ${topic.title}: ${topic.body}`).join("\n")}`,
    [offlineHomeCopy.guidanceBody],
  );

  const hasUnfinishedCheckIn = Boolean(offlineCheckInProgress) || hasDraft;
  const yesIsConcerning = activeQuestion.concerningWhen === "yes";
  const concerningFindings = useMemo(
    () => getConcerningFindings(checkInAnswers).map((id) => questionnaireCopy.findings[id]),
    [checkInAnswers, questionnaireCopy],
  );
  const callSheet = (
    <InfoSheet
      visible={callSheetOpen}
      title={callSheetTitle || copy.callHandoffTitle}
      body={copy.callHandoffBody}
      primaryLabel={copy.call}
      secondaryLabel={copy.callHandoffClose}
      primaryTone="coral"
      onPrimary={() => void confirmCallHandoff()}
      onClose={() => setCallSheetOpen(false)}
    />
  );
  const guidanceSheet = (
    <InfoSheet
      visible={guidanceSheetOpen}
      title={offlineHomeCopy.guidanceTitle}
      body={guidanceBody}
      primaryLabel={copy.guidanceClose}
      secondaryLabel={copy.callHandoffClose}
      onPrimary={() => setGuidanceSheetOpen(false)}
      onClose={() => setGuidanceSheetOpen(false)}
    />
  );

  if (checkIn === "started") {
    return (
      <ScreenContainer className="px-5" containerClassName="bg-background">
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={copy.leaveCheckIn} onPress={leaveCheckInFlow} style={({ pressed }) => [styles.backButton, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}>
              <IconSymbol name="chevron.left" size={20} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.eyebrow, { color: colors.muted }]}>{copy.checkIn} · {progress}</Text>
            <View style={[styles.savedChip, { backgroundColor: tints.mintSoft }]}>
              <Text style={[styles.savedChipText, { color: colors.success }]}>{questionnaireCopy.savedOnDevice}</Text>
            </View>
          </View>
          <View style={styles.stepRow} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: CHECK_IN_QUESTION_COUNT, now: question + 1 }}>
            {CHECK_IN_QUESTIONS.map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.stepDot,
                  {
                    backgroundColor: index < question ? colors.success : index === question ? colors.coral : colors.border,
                    flex: 1,
                  },
                ]}
              />
            ))}
          </View>
          <Text style={[styles.listeningStrip, { color: colors.muted }]}>{copy.listeningTitle} · {copy.pauseHint}</Text>
          <View style={[styles.questionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.questionLabel, { color: colors.coral }]}>{offlineHomeCopy.questionLabel} {question + 1}</Text>
            <CheckInQuestionVisual
              questionId={activeQuestion.id}
              accessibilityLabel={questionnaireCopy.imageAlt[activeQuestion.id]}
            />
            <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.question, { color: colors.foreground }]}>{questionnaireCopy.questions[activeQuestion.id]}</Text>
            <Text style={[styles.questionHint, { color: colors.muted }]}>{questionnaireCopy.hints[activeQuestion.id]}</Text>
            <AppErrorBoundary title={copy.micPermissionBody} body={copy.voiceOfflineBody} retryLabel={copy.retry}>
              <VoiceAnswerControl
                holdLabel={copy.holdToSpeak}
                releaseLabel={copy.releaseToSend}
                processingLabel={copy.voiceProcessing}
                unclearLabel={copy.voiceUnclear}
                permissionLabel={copy.micPermissionBody}
                offlineLabel={copy.voiceOfflineBody}
                accessibilityLabel={copy.speakAnswerLabel}
                languageHint={language}
                online={internetReachable === true}
                onAnswer={(choseYes) => void answer(choseYes)}
              />
            </AppErrorBoundary>
            <View style={styles.answerStack}>
              <CheckInChoiceButton label={answerLabels.yesLabel} concerning={yesIsConcerning} onPress={() => void answer(true)} />
              <CheckInChoiceButton label={answerLabels.noLabel} concerning={!yesIsConcerning} onPress={() => void answer(false)} />
            </View>
          </View>
          {question > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel={questionnaireCopy.previousQuestion} onPress={() => void goToPreviousQuestion()} style={({ pressed }) => [styles.previousLink, pressed && styles.pressed]}>
              <IconSymbol name="chevron.left" size={16} color={colors.primary} />
              <Text style={[styles.voiceLinkText, { color: colors.primary }]}>{questionnaireCopy.previousQuestion}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={womanA11y.callAunty} accessibilityHint={womanA11y.callAuntyHint} onPress={() => openCallSheet()} style={({ pressed }) => [styles.voiceLink, pressed && styles.pressed]}>
            <IconSymbol name="phone.fill" size={18} color={colors.primary} />
            <Text style={[styles.voiceLinkText, { color: colors.primary }]}>{copy.preferSpeak}</Text>
          </Pressable>
        </ScrollView>
        {callSheet}
        {guidanceSheet}
      </ScreenContainer>
    );
  }

  if (checkIn === "escalated") {
    return (
      <ScreenContainer className="px-5" containerClassName="bg-background">
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.alertCard, { backgroundColor: tints.coralSoft, borderColor: colors.error }]}>
            <View style={[styles.iconCircle, { backgroundColor: tints.coralMid }]}>
              <IconSymbol name="exclamationmark.triangle.fill" size={28} color={colors.error} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>{copy.helpNow}</Text>
            <Text style={[styles.body, { color: colors.foreground }]}>{copy.emergencyBody}</Text>
            {concerningFindings.length > 0 ? (
              <View accessibilityRole="summary" style={styles.findingsBlock}>
                <Text style={[styles.findingsTitle, { color: colors.muted }]}>{questionnaireCopy.findingsTitle}</Text>
                {concerningFindings.map((finding) => (
                  <Text key={finding} style={[styles.findingItem, { color: colors.foreground }]}>• {finding}</Text>
                ))}
              </View>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel={copy.callHealthWorker} onPress={() => openCallSheet(copy.callHealthWorker)} style={({ pressed }) => [styles.answerButton, { backgroundColor: colors.error, width: "100%" }, pressed && styles.pressed]}>
              <IconSymbol name="phone.fill" size={18} color="#FFFFFF" />
              <Text style={styles.answerText}>{copy.callHealthWorker}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={copy.returnHome} onPress={() => void returnHomeFromOutcome()} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border }, pressed && styles.pressed]}>
              <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>{copy.returnHome}</Text>
            </Pressable>
          </View>
        </ScrollView>
        {callSheet}
      </ScreenContainer>
    );
  }

  if (checkIn === "attention") {
    return (
      <ScreenContainer className="px-5" containerClassName="bg-background">
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.alertCard, { backgroundColor: tints.amberSoft, borderColor: colors.warning }]}>
            <View style={[styles.iconCircle, { backgroundColor: colors.surface }]}>
              <IconSymbol name="exclamationmark.triangle.fill" size={28} color={colors.warning} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>{questionnaireCopy.attentionTitle}</Text>
            <Text style={[styles.body, { color: colors.foreground }]}>{questionnaireCopy.attentionBody}</Text>
            {concerningFindings.length > 0 ? (
              <View accessibilityRole="summary" style={styles.findingsBlock}>
                <Text style={[styles.findingsTitle, { color: colors.muted }]}>{questionnaireCopy.findingsTitle}</Text>
                {concerningFindings.map((finding) => (
                  <Text key={finding} style={[styles.findingItem, { color: colors.foreground }]}>• {finding}</Text>
                ))}
              </View>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel={questionnaireCopy.contactChwToday} onPress={() => openCallSheet(questionnaireCopy.contactChwToday)} style={({ pressed }) => [styles.answerButton, { backgroundColor: colors.warning, width: "100%" }, pressed && styles.pressed]}>
              <IconSymbol name="phone.fill" size={18} color="#FFFFFF" />
              <Text style={styles.answerText}>{questionnaireCopy.contactChwToday}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={copy.returnHome} onPress={() => void returnHomeFromOutcome()} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border }, pressed && styles.pressed]}>
              <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>{copy.returnHome}</Text>
            </Pressable>
          </View>
        </ScrollView>
        {callSheet}
      </ScreenContainer>
    );
  }

  if (checkIn === "safe") {
    return (
      <ScreenContainer className="px-5" containerClassName="bg-background">
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.successCard, { backgroundColor: tints.mintSoft }]}>
            <View style={[styles.iconCircle, { backgroundColor: colors.surface }]}>
              <IconSymbol name="checkmark.circle.fill" size={30} color={colors.success} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>{copy.thankYou}</Text>
            <Text style={[styles.body, { color: colors.foreground }]}>{copy.savedCheckInBody}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={questionnaireCopy.seeCarePlan} onPress={() => { void returnHomeFromOutcome(); router.push("/care"); }} style={({ pressed }) => [styles.answerButton, { backgroundColor: colors.primary, width: "100%" }, pressed && styles.pressed]}>
              <Text style={styles.answerText}>{questionnaireCopy.seeCarePlan}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={copy.returnHome} onPress={() => void returnHomeFromOutcome()} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border }, pressed && styles.pressed]}>
              <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>{copy.backHome}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="px-5" containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.eyebrow, { color: colors.coral }]}>{copy.callAunty}</Text>
            <Text style={[styles.greeting, { color: colors.foreground }]}>{role === "woman" ? copy.greetingWoman : copy.greetingChw}</Text>
            <ConnectionChip
              reachable={internetReachable}
              onlineLabel={copy.syncOnline}
              offlineLabel={copy.syncOffline}
              unknownLabel={copy.syncUnknown}
            />
          </View>
          {role === "woman" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={womanA11y.callAunty}
              accessibilityHint={womanA11y.callAuntyHint}
              onPress={() => openCallSheet()}
              style={({ pressed }) => [styles.headerCall, { backgroundColor: colors.coral }, pressed && styles.pressed]}
            >
              <IconSymbol name="phone.fill" size={16} color="#FFFFFF" />
              <Text style={styles.headerCallText}>{copy.headerCall}</Text>
            </Pressable>
          ) : (
            <View style={[styles.avatarRing, { borderColor: tints.lavenderBorder }]}>
              <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                <Text style={styles.avatarText}>S</Text>
              </View>
            </View>
          )}
        </View>

        {hasDraft && !offlineCheckInProgress && role === "woman" && (
          <View style={[styles.draftBanner, { backgroundColor: tints.coralSoft, borderColor: tints.coralBorder }]} accessibilityRole="alert">
            <View style={[styles.bannerAccent, { backgroundColor: colors.coral }]} />
            <View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{copy.unfinishedTitle}</Text><Text style={[styles.cardMeta, { color: colors.muted }]}>{copy.unfinishedBody}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel={copy.resumeLabel} onPress={() => startCheckIn(true)} style={({ pressed }) => [styles.resumeButton, pressed && styles.pressed]}><Text style={[styles.link, { color: colors.coral }]}>{copy.resume}</Text></Pressable>
          </View>
        )}

        {offlineCheckInProgress && role === "woman" && <View style={[styles.draftBanner, { backgroundColor: tints.lavenderSoft, borderColor: tints.lavenderBorder }]} accessibilityRole="summary" accessibilityLiveRegion="polite"><View style={[styles.bannerAccent, { backgroundColor: colors.primary }]} /><View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{offlineHomeCopy.resumeTitle}</Text><Text style={[styles.cardMeta, { color: colors.muted }]}>{offlineHomeCopy.resumeBody(offlineCheckInDisplayQuestion(offlineCheckInProgress), offlineCheckInProgress.questionCount)}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={offlineHomeCopy.resumeAction} onPress={() => startCheckIn(true)} style={({ pressed }) => [styles.resumeButton, pressed && styles.pressed]}><Text style={[styles.link, { color: colors.primary }]}>{offlineHomeCopy.resumeAction}</Text></Pressable></View>}

        {role === "woman" ? (
          <>
            <View style={[styles.heroCard, heroElevation, { backgroundColor: colors.primary }]}>
              <View style={styles.heroGlow} />
              <View style={styles.heroGlowSecondary} />
              <View style={styles.heroCopy}>
                <Text style={[styles.heroOverline, { color: tints.heroOverline }]}>{copy.nextStep}</Text>
                <Text style={styles.heroTitle}>{copy.heroTitle}</Text>
                <Text style={[styles.heroBody, { color: tints.heroBody }]}>{copy.heroBody}</Text>
              </View>
              <View style={[styles.heroBadge, { backgroundColor: colors.coral }]}><IconSymbol name="heart.fill" size={26} color="#FFFFFF" /></View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={hasUnfinishedCheckIn ? copy.resumeLabel : womanA11y.startCheckIn} onPress={() => (hasUnfinishedCheckIn ? startCheckIn(true) : startCheckIn(false))} style={({ pressed }) => [styles.primaryAction, heroElevation, { backgroundColor: colors.coral }, pressed && styles.pressed]}>
              <View>
                <Text style={styles.actionTitle}>{hasUnfinishedCheckIn ? copy.resumeLabel : copy.startCheckIn}</Text>
                <Text style={[styles.actionSub, { color: tints.actionSub }]}>{hasUnfinishedCheckIn ? questionnaireCopy.savedOnDevice : copy.pauseHint}</Text>
              </View>
              <IconSymbol name="chevron.right" size={22} color="#FFFFFF" />
            </Pressable>
            {hasUnfinishedCheckIn ? (
              <Pressable accessibilityRole="button" accessibilityLabel={questionnaireCopy.startNew} onPress={requestFreshCheckIn} style={({ pressed }) => [styles.startNewLink, pressed && styles.pressed]}>
                <Text style={[styles.voiceLinkText, { color: colors.muted }]}>{questionnaireCopy.startNew}</Text>
              </Pressable>
            ) : null}
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{copy.todayFocus}</Text>
            <ShortcutGrid
              items={[
                {
                  icon: "calendar",
                  label: copy.tabCare,
                  accessibilityLabel: womanA11y.carePlanOpen,
                  tone: "mint",
                  onPress: () => router.push("/care"),
                },
                {
                  icon: "book.fill",
                  label: offlineHomeCopy.guidanceAction,
                  accessibilityLabel: offlineHomeCopy.guidanceTitle,
                  tone: "lavender",
                  onPress: () => setGuidanceSheetOpen(true),
                },
                {
                  icon: "phone.fill",
                  label: copy.call,
                  accessibilityLabel: womanA11y.callAunty,
                  accessibilityHint: womanA11y.callAuntyHint,
                  tone: "coral",
                  onPress: () => openCallSheet(),
                },
              ]}
            />
            <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>{copy.carePlan}</Text><Pressable accessibilityRole="button" accessibilityLabel={womanA11y.carePlanOpen} onPress={() => router.push("/care")}><Text style={[styles.link, { color: colors.primary }]}>{copy.seeAll}</Text></Pressable></View>
            <Pressable accessibilityRole="button" accessibilityLabel={womanA11y.carePlanCard} onPress={() => router.push("/care")} style={({ pressed }) => [styles.careCard, cardElevation, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}>
              <View style={[styles.careIcon, { backgroundColor: tints.mintSoft }]}><IconSymbol name="calendar" size={21} color={colors.success} /></View>
              <View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{copy.careVisit}</Text><Text style={[styles.cardMeta, { color: colors.muted }]}>{copy.careVisitMeta}</Text></View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.statusChipRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={privacyLocked ? chwA11y.lockOn : chwA11y.lockOff}
                onPress={() => void togglePrivacyLock()}
                style={[styles.statusChip, { backgroundColor: privacyLocked ? tints.coralSoft : tints.mintSoft }]}
              >
                <IconSymbol name={privacyLocked ? "lock.fill" : "checkmark.circle.fill"} size={14} color={privacyLocked ? colors.error : colors.success} />
                <Text style={[styles.statusChipText, { color: privacyLocked ? colors.error : colors.success }]}>{privacyLocked ? copy.unlock : copy.lock}</Text>
              </Pressable>
              {pendingSyncCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.chwRetryQueued}
                  accessibilityHint={chwSyncA11y.retryHint}
                  onPress={() => queueItems[0] && void retryQueueItem(queueItems[0])}
                  style={[styles.statusChip, { backgroundColor: tints.amberSoft }]}
                >
                  <IconSymbol name="arrow.clockwise" size={14} color={colors.warning} />
                  <Text style={[styles.statusChipText, { color: colors.warning }]}>{copy.chwSyncItems(pendingSyncCount)} · {copy.retry}</Text>
                </Pressable>
              ) : (
                <View style={[styles.statusChip, { backgroundColor: tints.lavenderSoft }]}>
                  <IconSymbol name="checkmark.circle.fill" size={14} color={colors.primary} />
                  <Text style={[styles.statusChipText, { color: colors.primary }]}>{copy.savedSyncReady}</Text>
                </View>
              )}
            </View>
            <MetricTiles
              tiles={[
                {
                  value: String(queue.filter((item) => item.tone === "urgent").length),
                  label: copy.filterUrgent,
                  tone: "urgent",
                },
                {
                  value: String(pendingSyncCount),
                  label: copy.syncDiagnosticQueued,
                  tone: pendingSyncCount > 0 ? "warning" : "info",
                },
                {
                  value: String(completedFollowUps.length),
                  label: copy.syncDiagnosticSynced,
                  tone: "success",
                },
              ]}
            />
            {privacyLocked ? (
              <StatusBanner
                tone="error"
                icon="lock.fill"
                message={`${chwA11y.lockOn} · ${formatAppLockTimeout(lockTimeoutMs)}`}
                accessibilityLabel={chwA11y.lockOn}
                action={{ label: copy.unlock, onPress: () => void togglePrivacyLock() }}
              />
            ) : null}
            {transferProgress ? (
              <StatusBanner
                tone={transferProgress.status === "paused" ? "warning" : "info"}
                icon="arrow.clockwise"
                message={`${transferProgress.status === "paused" ? transferCopy.paused : transferCopy.active} · ${transferCopy.progress(transferProgress.completedItems, transferProgress.totalItems)}`}
                action={{
                  label: transferProgress.status === "paused" ? transferCopy.resume : transferCopy.pause,
                  onPress: () => void changeTransferState(transferProgress.status === "paused" ? "resume" : "pause"),
                }}
                extraAction={{ label: transferCopy.cancel, onPress: () => void changeTransferState("cancel") }}
              />
            ) : null}
            {localConflictCount > 0 ? (
              <StatusBanner
                tone="warning"
                icon="exclamationmark.triangle.fill"
                message={`${localConflictCount} · ${copy.reconciliationConflict}`}
                accessibilityRole="alert"
              >
                <View style={styles.conflictActions}>
                  <Pressable accessibilityRole="button" accessibilityLabel={copy.reconciliationKeepLocal} onPress={() => void resolveConflict("keep_local")}>
                    <Text style={[styles.link, { color: colors.warning }]}>{copy.reconciliationKeepLocal}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={copy.reconciliationAcceptServer} onPress={() => setAcceptServerModalOpen(true)}>
                    <Text style={[styles.link, { color: colors.warning }]}>{copy.reconciliationAcceptServer}</Text>
                  </Pressable>
                </View>
              </StatusBanner>
            ) : null}
            {offlineSummary.state !== "ready" ? (
              <StatusBanner
                tone={offlineSummary.pending > 0 ? "warning" : "info"}
                icon="waveform"
                message={`${offlineCopy.title}: ${getOfflineStateMessage(language, offlineSummary.state)}${offlineSummary.pending > 0 ? ` · ${offlineCopy.pending(offlineSummary.pending)}` : ""}`}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={chwA11y.hero}
              accessibilityHint={copy.openQueueBody}
              onPress={() => router.push("/queue")}
              style={({ pressed }) => [styles.chwHero, cardElevation, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}
            >
              <View>
                <Text style={[styles.heroOverline, { color: colors.coral }]}>{copy.fieldQueue}</Text>
                <Text style={[styles.chwNumber, { color: colors.foreground }]}>{queue.length} {copy.actions}</Text>
                <Text style={[styles.cardMeta, { color: colors.muted }]}>{copy.urgentCase}</Text>
              </View>
              <View style={[styles.iconCircle, { backgroundColor: tints.coralSoft }]}>
                <IconSymbol name="person.2.fill" size={25} color={colors.coral} />
              </View>
            </Pressable>
            <StatusBanner
              tone="warning"
              icon="phone.fill"
              message={fieldActivity.awaiting(mockCallbacks)}
              action={{ label: copy.fieldActivity, onPress: () => router.push("/chw/activity") }}
            />
            {queue[0] && copy.chwQueue[0] ? (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{copy.todayFocus}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={copy.openQueue} onPress={() => router.push("/queue")}>
                    <Text style={[styles.link, { color: colors.primary }]}>{copy.seeAll} · {copy.chwOpenCount(queue.length)}</Text>
                  </Pressable>
                </View>
                {queue.slice(0, 3).map((item, index) => {
                  const record = copy.chwQueue[index];
                  if (!record) return null;
                  return (
                    <QueuePersonCard
                      key={item.id}
                      name={record.name}
                      urgency={record.urgency}
                      meta={`${record.meta} · ${record.nextAction}`}
                      tone={item.tone}
                      accessibilityLabel={`${record.name}. ${record.urgency}. ${record.meta}. ${record.nextAction}`}
                      accessibilityHint={chwA11y.openQueueRecord}
                      onPress={() => router.push({ pathname: "/chw/[id]", params: { id: item.id } })}
                    />
                  );
                })}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.fieldActivity}
                  onPress={() => router.push("/chw/activity")}
                  style={({ pressed }) => [styles.careCard, cardElevation, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}
                >
                  <View style={[styles.careIcon, { backgroundColor: tints.lavenderSoft }]}>
                    <IconSymbol name="list.bullet.rectangle" size={20} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>{copy.fieldActivity}</Text>
                    <Text style={[styles.cardMeta, { color: colors.muted }]}>{copy.fieldActivityBody}</Text>
                  </View>
                  <IconSymbol name="chevron.right" size={18} color={colors.muted} />
                </Pressable>
              </>
            ) : (
              <View style={[styles.emptyQueue, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <IconSymbol name="checkmark.circle.fill" size={24} color={colors.success} />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{copy.queueClear}</Text>
                <Text style={[styles.cardMeta, { color: colors.muted }]}>{copy.queueClearBody}</Text>
              </View>
            )}
            <Pressable accessibilityRole="button" accessibilityLabel={copy.chwNewFollowUp} accessibilityHint={chwA11y.newFollowUp} onPress={() => router.push("/chw/follow-up")} style={({ pressed }) => [styles.primaryAction, heroElevation, { backgroundColor: colors.primary }, pressed && styles.pressed]}><View><Text style={styles.actionTitle}>{copy.captureFollowUp}</Text><Text style={styles.actionSub}>{copy.captureFollowUpBody}</Text></View><IconSymbol name="chevron.right" size={22} color="#FFFFFF" /></Pressable>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{copy.syncTools}</Text>
            <View style={styles.queueActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={copy.refreshQueue} accessibilityHint={chwA11y.refreshQueue} onPress={() => void refreshQueue()} style={({ pressed }) => [styles.refreshChip, { borderColor: colors.border, backgroundColor: colors.surface }, pressed && styles.pressed]}>
                <IconSymbol name="arrow.clockwise" size={14} color={colors.primary} />
                <Text style={[styles.link, { color: colors.primary }]}>{copy.refreshQueue}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={copy.syncDiagnosticTitle} accessibilityHint={chwA11y.syncDiagnostic} onPress={() => void runSyncDiagnostic()} style={({ pressed }) => [styles.refreshChip, { borderColor: colors.border, backgroundColor: colors.surface }, pressed && styles.pressed]}>
                <IconSymbol name="checkmark.circle.fill" size={14} color={colors.primary} />
                <Text style={[styles.link, { color: colors.primary }]}>{copy.syncDiagnosticTitle}</Text>
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`${copy.reconciliationLatestCardTitle}. ${reconciliationHistory[0] ? formatReconciliationHistory(reconciliationHistory[0], language, { label: "", server: copy.reconciliationHistoryServer, fallback: copy.reconciliationHistoryFallback, decisionKept: copy.reconciliationDecisionKept, decisionAccepted: copy.reconciliationDecisionAccepted })?.replace(/^: /, "") : copy.reconciliationLatestCardEmpty}`} onPress={() => setHistoryModalOpen(true)} style={({ pressed }) => [styles.latestDecisionCard, cardElevation, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}><View style={[styles.latestDecisionIcon, { backgroundColor: tints.lavenderSoft }]}><IconSymbol name="checkmark.circle.fill" size={19} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{copy.reconciliationLatestCardTitle}</Text><Text style={[styles.cardMeta, { color: colors.muted }]}>{reconciliationHistory[0] ? (formatReconciliationHistory(reconciliationHistory[0], language, { label: "", server: copy.reconciliationHistoryServer, fallback: copy.reconciliationHistoryFallback, decisionKept: copy.reconciliationDecisionKept, decisionAccepted: copy.reconciliationDecisionAccepted }) ?? "").replace(/^: /, "") : copy.reconciliationLatestCardEmpty}</Text></View><Text style={[styles.link, { color: colors.primary }]}>{copy.reconciliationLatestCardOpen}</Text></Pressable>
            {completedFollowUps.length > 0 ? (
              <Text style={[styles.syncMeta, { color: colors.muted }]}>{copy.chwCompletedCount(completedFollowUps.length)} · {formatLastSync(lastSyncAt)}</Text>
            ) : (
              <Text style={[styles.syncMeta, { color: colors.muted }]}>{formatLastSync(lastSyncAt)} · {copy.chwQueued(syncSummary.queued)} · {copy.chwRetrying(syncSummary.retrying)}{syncSummary.exhausted > 0 ? ` · ${syncSummary.exhausted} ${copy.syncExhausted}` : ""}</Text>
            )}
          </>
        )}
      </ScrollView>
      <Modal transparent visible={historyModalOpen} animationType="slide" onRequestClose={() => setHistoryModalOpen(false)}><View style={styles.sheetScrim}><View style={[styles.historySheet, { backgroundColor: colors.surface }]}><View style={[styles.sheetHandle, { backgroundColor: colors.border }]} /><View style={styles.historyHeader}><Text style={[styles.sheetTitle, { color: colors.foreground }]}>{copy.reconciliationHistoryTitle}</Text><Pressable accessibilityRole="button" accessibilityLabel={copy.reconciliationHistoryClose} onPress={() => setHistoryModalOpen(false)}><Text style={[styles.link, { color: colors.primary }]}>{copy.reconciliationHistoryClose}</Text></Pressable></View><View accessibilityRole="summary" accessibilityLiveRegion="polite" style={[styles.latestSummary, { backgroundColor: colors.background, borderColor: colors.border }]}><Text style={[styles.latestSummaryLabel, { color: colors.muted }]}>{copy.reconciliationLatestDecision}</Text><Text style={[styles.latestSummaryText, { color: colors.foreground }]}>{reconciliationHistory[0] ? (formatReconciliationHistory(reconciliationHistory[0], language, { label: "", server: copy.reconciliationHistoryServer, fallback: copy.reconciliationHistoryFallback, decisionKept: copy.reconciliationDecisionKept, decisionAccepted: copy.reconciliationDecisionAccepted }) ?? "").replace(/^: /, "") : copy.reconciliationLatestDecisionEmpty}</Text></View><View accessibilityRole="tablist" style={styles.filterRow}><Pressable accessibilityRole="tab" accessibilityState={{ selected: historyFilter === "all" }} accessibilityLabel={copy.reconciliationFilterAll} onPress={() => setHistoryFilter("all")} style={[styles.filterChip, historyFilter === "all" && { backgroundColor: colors.primary }]}><Text style={[styles.filterText, { color: historyFilter === "all" ? "#FFFFFF" : colors.muted }]}>{copy.reconciliationFilterAll}</Text></Pressable><Pressable accessibilityRole="tab" accessibilityState={{ selected: historyFilter === "kept_local" }} accessibilityLabel={copy.reconciliationFilterKept} onPress={() => setHistoryFilter("kept_local")} style={[styles.filterChip, historyFilter === "kept_local" && { backgroundColor: colors.primary }]}><Text style={[styles.filterText, { color: historyFilter === "kept_local" ? "#FFFFFF" : colors.muted }]}>{copy.reconciliationFilterKept}</Text></Pressable><Pressable accessibilityRole="tab" accessibilityState={{ selected: historyFilter === "accepted_server" }} accessibilityLabel={copy.reconciliationFilterAccepted} onPress={() => setHistoryFilter("accepted_server")} style={[styles.filterChip, historyFilter === "accepted_server" && { backgroundColor: colors.primary }]}><Text style={[styles.filterText, { color: historyFilter === "accepted_server" ? "#FFFFFF" : colors.muted }]}>{copy.reconciliationFilterAccepted}</Text></Pressable></View>{filteredReconciliationHistory.length === 0 ? <Text accessibilityLiveRegion="polite" style={[styles.rowDetail, { color: colors.muted }]}>{reconciliationHistory.length === 0 ? copy.reconciliationHistoryEmpty : copy.reconciliationFilterEmpty}</Text> : filteredReconciliationHistory.map((entry) => <Text key={entry.timestamp} accessibilityRole="text" style={[styles.historyEntry, { color: colors.muted }]}>{formatReconciliationHistory(entry, language, { label: copy.reconciliationHistory, server: copy.reconciliationHistoryServer, fallback: copy.reconciliationHistoryFallback, decisionKept: copy.reconciliationDecisionKept, decisionAccepted: copy.reconciliationDecisionAccepted })}</Text>)}</View></View></Modal>
      <Modal transparent visible={acceptServerModalOpen} animationType="slide" onRequestClose={() => setAcceptServerModalOpen(false)}><View style={styles.sheetScrim}><View style={[styles.confirmSheet, { backgroundColor: colors.surface }]}><Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.foreground }]}>{copy.reconciliationAcceptTitle}</Text><Text accessibilityLiveRegion="polite" style={[styles.rowDetail, { color: colors.muted }]}>{copy.reconciliationAcceptSummary(localConflictCount)} {copy.reconciliationAcceptBody}</Text><View style={styles.confirmActions}><Pressable accessibilityRole="button" accessibilityLabel={copy.reconciliationCancel} accessibilityHint={copy.reconciliationCancel} onPress={() => setAcceptServerModalOpen(false)} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border }, pressed && styles.pressed]}><Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>{copy.reconciliationCancel}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={copy.reconciliationConfirm} accessibilityHint={copy.reconciliationConfirmHint} onPress={() => { setAcceptServerModalOpen(false); void resolveConflict("accept_server"); }} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.warning }, pressed && styles.pressed]}><Text style={styles.primaryButtonText}>{copy.reconciliationConfirm}</Text></Pressable></View></View></View></Modal>
      <PasscodeModal visible={passcodeModalOpen} progress={passcodeCooldownUntil ? getCooldownProgress(passcodeCooldownUntil, cooldownNow) : undefined} title={getSecurityCopy(language).lockTitle} subtitle={getSecurityCopy(language).lockSubtitle} value={passcodeInput} error={passcodeError ?? (isCooldownActive(passcodeCooldownUntil, cooldownNow) ? getSecurityCopy(language).cooldown(getCooldownSeconds(passcodeCooldownUntil, cooldownNow)) : undefined)} disabled={isCooldownActive(passcodeCooldownUntil, cooldownNow)} submitLabel={getSecurityCopy(language).unlock} onChange={(value) => { setPasscodeInput(value); setPasscodeError(undefined); }} onCancel={() => { setPasscodeModalOpen(false); setPasscodeInput(""); setPasscodeError(undefined); }} onSubmit={() => void completePasscodeUnlock()} />
      {callSheet}
      {guidanceSheet}
      <FeedbackToast visible={Boolean(toastMessage)} message={toastMessage ?? ""} tone={toastTone} onHide={() => setToastMessage(null)} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingTop: 8, paddingBottom: TAB_SCROLL_BOTTOM, gap: 16 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  greeting: { fontSize: 26, fontWeight: "800", marginTop: 6, letterSpacing: -0.6 },
  connectionRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  connectionText: { fontSize: 12, fontWeight: "700" },
  headerCall: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 10, marginLeft: 8 },
  headerCallText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  avatarRing: { padding: 3, borderRadius: 28, borderWidth: 2 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  heroCard: { borderRadius: 28, padding: 24, minHeight: 176, flexDirection: "row", overflow: "hidden", position: "relative" },
  heroGlow: { position: "absolute", right: -40, top: -40, width: 140, height: 140, borderRadius: 70, backgroundColor: "rgba(255,255,255,0.08)" },
  heroGlowSecondary: { position: "absolute", left: -28, bottom: -48, width: 110, height: 110, borderRadius: 55, backgroundColor: "rgba(255,255,255,0.06)" },
  heroCopy: { flex: 1, gap: 10, zIndex: 1 },
  heroOverline: { fontSize: 11, fontWeight: "800", letterSpacing: 1.3, color: "#FFFFFF", textTransform: "uppercase" },
  heroTitle: { color: "#FFFFFF", fontSize: 26, lineHeight: 32, fontWeight: "800", maxWidth: 250, letterSpacing: -0.4 },
  heroBody: { color: "#E7E6FF", fontSize: 14, lineHeight: 21, maxWidth: 240 },
  heroBadge: { width: 54, height: 54, borderRadius: 20, alignItems: "center", justifyContent: "center", marginTop: 4, zIndex: 1 },
  primaryAction: { borderRadius: 20, paddingHorizontal: 18, paddingVertical: 17, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  actionTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  actionSub: { color: "#FBE7E1", fontSize: 12, marginTop: 4 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  sectionTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },
  link: { fontSize: 13, fontWeight: "800" },
  careCard: { borderRadius: 20, borderWidth: 1, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  careIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontWeight: "800" },
  cardMeta: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  infoCard: { borderRadius: 20, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, overflow: "hidden" },
  draftBanner: { borderRadius: 18, borderWidth: 1, paddingVertical: 14, paddingRight: 14, paddingLeft: 12, flexDirection: "row", alignItems: "center", gap: 12, overflow: "hidden" },
  bannerAccent: { width: 4, alignSelf: "stretch", borderRadius: 4, marginVertical: -4, marginLeft: -4 },
  offlineCheckInCard: { borderRadius: 16, borderWidth: 1, padding: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  resumeButton: { paddingHorizontal: 8, paddingVertical: 8 },
  chwHero: { borderRadius: 24, borderWidth: 1, padding: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chwNumber: { fontSize: 32, fontWeight: "800", marginTop: 4, letterSpacing: -0.8 },
  queueCard: { borderRadius: 18, borderWidth: 1, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  queueDot: { width: 10, height: 10, borderRadius: 5 },
  syncBanner: { borderRadius: 14, paddingVertical: 11, paddingRight: 13, paddingLeft: 10, flexDirection: "row", alignItems: "center", gap: 8, overflow: "hidden" },
  syncText: { fontSize: 12, fontWeight: "700", lineHeight: 16 },
  completedBanner: { borderRadius: 14, paddingVertical: 11, paddingRight: 13, paddingLeft: 10, flexDirection: "row", alignItems: "center", gap: 8, overflow: "hidden" },
  refreshChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  queueActions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  statusChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, maxWidth: "100%" },
  statusChipText: { fontSize: 12, fontWeight: "800", flexShrink: 1 },
  queueMeta: { fontSize: 12, marginTop: -8, lineHeight: 17 },
  syncMeta: { fontSize: 12, lineHeight: 17 },
  historyLink: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 4 },
  latestDecisionCard: { borderRadius: 18, borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "center", gap: 11 },
  latestDecisionIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  conflictActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetScrim: { flex: 1, backgroundColor: "rgba(25, 22, 38, 0.48)", justifyContent: "flex-end" },
  historySheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 12, paddingTop: 12 },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  confirmSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 14 },
  confirmActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  primaryButton: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  sheetTitle: { fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  rowDetail: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  historyHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filterChip: { borderRadius: 999, borderWidth: 1, borderColor: "#E9E1D8", paddingHorizontal: 10, paddingVertical: 7 },
  filterText: { fontSize: 12, fontWeight: "800" },
  latestSummary: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 4 },
  latestSummaryLabel: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  latestSummaryText: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
  historyEntry: { fontSize: 13, lineHeight: 20, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#E9E1D8" },
  emptyQueue: { borderRadius: 18, borderWidth: 1, padding: 18, alignItems: "center", gap: 5 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  stepRow: { flexDirection: "row", gap: 6 },
  stepDot: { height: 6, borderRadius: 999 },
  listeningStrip: { fontSize: 13, lineHeight: 18, textAlign: "center", fontWeight: "700" },
  savedChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 140 },
  savedChipText: { fontSize: 10, fontWeight: "800", textAlign: "center" },
  previousLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8 },
  startNewLink: { alignItems: "center", paddingVertical: 4, marginTop: -8 },
  progressTrack: { height: 8, borderRadius: 5, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 5 },
  checkInHero: { alignItems: "center", gap: 10, paddingVertical: 20 },
  iconCircle: { width: 60, height: 60, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, fontWeight: "800", textAlign: "center", letterSpacing: -0.5 },
  body: { fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 320 },
  questionCard: { borderRadius: 26, borderWidth: 1, padding: 22, gap: 16 },
  questionLabel: { fontSize: 11, letterSpacing: 1.3, fontWeight: "800", textTransform: "uppercase" },
  question: { fontSize: 22, lineHeight: 30, fontWeight: "800", letterSpacing: -0.3 },
  questionHint: { fontSize: 13, lineHeight: 19, marginTop: -6 },
  findingsBlock: { width: "100%", gap: 6, alignItems: "flex-start" },
  findingsTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  findingItem: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  answerStack: { gap: 10, marginTop: 8 },
  answerButton: { borderRadius: 16, paddingVertical: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  answerText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  voiceLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12 },
  voiceLinkText: { fontWeight: "800", fontSize: 14 },
  alertCard: { borderRadius: 26, borderWidth: 1, padding: 24, gap: 16, alignItems: "center", marginTop: 20 },
  successCard: { borderRadius: 26, padding: 24, gap: 16, alignItems: "center", marginTop: 20 },
  secondaryButton: { borderRadius: 16, borderWidth: 1, paddingVertical: 15, alignItems: "center", width: "100%" },
  secondaryButtonText: { fontSize: 15, fontWeight: "800" },
});
