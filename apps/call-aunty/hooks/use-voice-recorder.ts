import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";

export type VoiceRecorderStatus = "idle" | "requesting" | "recording" | "stopping" | "error";

async function uriToBase64(uri: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const mimeType = blob.type || "audio/m4a";
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const bytesToBase64 =
    typeof globalThis.btoa === "function"
      ? (value: string) => globalThis.btoa(value)
      : (value: string) => {
          const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
          let output = "";
          for (let i = 0; i < value.length; i += 3) {
            const a = value.charCodeAt(i);
            const b = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
            const c = i + 2 < value.length ? value.charCodeAt(i + 2) : 0;
            const triplet = (a << 16) | (b << 8) | c;
            output += chars[(triplet >> 18) & 63] + chars[(triplet >> 12) & 63];
            output += i + 1 < value.length ? chars[(triplet >> 6) & 63] : "=";
            output += i + 2 < value.length ? chars[triplet & 63] : "=";
          }
          return output;
        };
  return { base64: bytesToBase64(binary), mimeType };
}

async function enableRecordingMode() {
  if (Platform.OS === "web") return;
  try {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: "mixWithOthers",
      interruptionModeAndroid: "duckOthers",
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    // Audio session setup is best-effort; start() reports recording failures.
  }
}

export function useVoiceRecorder() {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const recorderState = useAudioRecorderState(recorder, 120);
  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void enableRecordingMode().catch(() => undefined);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus("requesting");
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setStatus("error");
        setError("permission");
        return false;
      }
      await enableRecordingMode();
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStatus("recording");
      return true;
    } catch {
      setStatus("error");
      setError("start");
      return false;
    }
  }, [recorder]);

  const stop = useCallback(async () => {
    if (status !== "recording" && !recorderState.isRecording) {
      return null;
    }
    setStatus("stopping");
    try {
      await recorder.stop();
      const uri = recorder.uri;
      setStatus("idle");
      if (!uri) return null;
      return await uriToBase64(uri);
    } catch {
      setStatus("error");
      setError("stop");
      return null;
    }
  }, [recorder, recorderState.isRecording, status]);

  return {
    status,
    error,
    isRecording: status === "recording" || recorderState.isRecording,
    metering: recorderState.metering ?? -160,
    durationMillis: recorderState.durationMillis ?? 0,
    start,
    stop,
  };
}
