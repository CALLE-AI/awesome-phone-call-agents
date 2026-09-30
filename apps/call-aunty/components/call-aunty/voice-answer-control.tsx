import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { WaveMeter } from "@/components/call-aunty/wave-meter";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { classifyVoiceAnswer, type VoiceAnswerIntent } from "@/lib/voice-intent";
import { trpc } from "@/lib/trpc";

type VoiceAnswerControlProps = {
  holdLabel: string;
  releaseLabel: string;
  processingLabel: string;
  unclearLabel: string;
  permissionLabel: string;
  offlineLabel: string;
  accessibilityLabel: string;
  languageHint?: string;
  online?: boolean;
  onAnswer: (choseYes: boolean) => void;
  onUnclear?: () => void;
};

export function VoiceAnswerControl({
  holdLabel,
  releaseLabel,
  processingLabel,
  unclearLabel,
  permissionLabel,
  offlineLabel,
  accessibilityLabel,
  languageHint,
  online = true,
  onAnswer,
  onUnclear,
}: VoiceAnswerControlProps) {
  const colors = useColors();
  const tints = useUiTints();
  const recorder = useVoiceRecorder();
  const transcribe = trpc.voice.transcribe.useMutation();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const meteringLevel = useMemo(() => {
    const db = recorder.metering;
    return Math.max(0.18, Math.min(1, (db + 50) / 50));
  }, [recorder.metering]);

  const applyIntent = useCallback(
    (intent: VoiceAnswerIntent) => {
      if (intent === "yes") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        onAnswer(true);
        return;
      }
      if (intent === "no") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        onAnswer(false);
        return;
      }
      setFeedback(unclearLabel);
      onUnclear?.();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    },
    [onAnswer, onUnclear, unclearLabel],
  );

  const begin = useCallback(async () => {
    setFeedback(null);
    if (!online) {
      setFeedback(offlineLabel);
      return;
    }
    const started = await recorder.start();
    if (!started) {
      setFeedback(permissionLabel);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  }, [offlineLabel, online, permissionLabel, recorder]);

  const finish = useCallback(async () => {
    if (!recorder.isRecording && recorder.status !== "recording") return;
    setBusy(true);
    try {
      const payload = await recorder.stop();
      if (!payload) {
        setFeedback(unclearLabel);
        return;
      }
      if (!online) {
        setFeedback(offlineLabel);
        return;
      }
      const result = await transcribe.mutateAsync({
        audioBase64: payload.base64,
        mimeType: payload.mimeType,
        language: languageHint,
        prompt: "Transcribe a short yes or no answer about maternal health symptoms.",
      });
      applyIntent(classifyVoiceAnswer(result.text));
    } catch {
      setFeedback(unclearLabel);
      onUnclear?.();
    } finally {
      setBusy(false);
    }
  }, [applyIntent, languageHint, offlineLabel, online, onUnclear, recorder, transcribe, unclearLabel]);

  const recording = recorder.isRecording;
  const label = busy ? processingLabel : recording ? releaseLabel : holdLabel;

  return (
    <View style={[styles.wrap, { backgroundColor: tints.lavenderSoft, borderColor: tints.lavenderBorder }]}>
      <WaveMeter active={recording || busy} level={meteringLevel} color={colors.primary} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ busy: busy || recording, disabled: busy }}
        disabled={busy}
        onPressIn={() => void begin()}
        onPressOut={() => void finish()}
        style={({ pressed }) => [
          styles.micButton,
          {
            backgroundColor: recording ? colors.coral : colors.primary,
            borderColor: recording ? colors.coral : colors.primary,
          },
          pressed && styles.pressed,
        ]}
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <IconSymbol name="mic.fill" size={26} color="#FFFFFF" />}
      </Pressable>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      {feedback ? (
        <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: colors.muted }]}>
          {feedback}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 10,
  },
  micButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 13, fontWeight: "800", textAlign: "center" },
  feedback: { fontSize: 12, lineHeight: 17, textAlign: "center" },
  pressed: { opacity: 0.86, transform: [{ scale: 0.97 }] },
});
