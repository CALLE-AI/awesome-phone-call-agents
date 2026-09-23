import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useCalleCall } from "@/hooks/useCalleCall";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { cardElevation } from "@/lib/ui-elevation";
import { isE164Phone } from "@/shared/calleClient";

const SCENARIOS = [
  { id: "family_check_in", title: "Family Check In", task: "Call the recipient and complete the family check in task." },
  { id: "appointment_confirmation", title: "Appointment Confirmation", task: "Call the recipient and complete the appointment confirmation task." },
  { id: "reminder_confirmation", title: "Reminder Confirmation", task: "Call the recipient and complete the reminder confirmation task." },
  { id: "callback_request", title: "Callback Request", task: "Call the recipient and complete the callback request task." },
] as const;

type Props = {
  apiBaseUrl: string;
};

export function CalleCallComposer({ apiBaseUrl }: Props) {
  const colors = useColors();
  const tints = useUiTints();
  const [phone, setPhone] = useState("");
  const [goal, setGoal] = useState("Call the recipient and confirm the family check-in. Do not ask for passwords, PINs, or payment details.");
  const [scenarioId, setScenarioId] = useState<(typeof SCENARIOS)[number]["id"]>("family_check_in");
  const { state, start } = useCalleCall(apiBaseUrl);

  const statusLabel = useMemo(() => {
    switch (state.status) {
      case "creating":
        return "Creating CALL-E task…";
      case "queued":
        return "Queued at CALL-E";
      case "in_progress":
      case "polling":
        return "CALL-E is working…";
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      default:
        return "Ready";
    }
  }, [state.status]);

  const busy = state.status === "creating" || state.status === "polling" || state.status === "in_progress" || state.status === "queued";
  const result = state.data?.structured_result as Record<string, unknown> | undefined;

  const submit = async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      Alert.alert("Phone required", "Enter a consenting recipient in E.164 format, for example +15551234567.");
      return;
    }
    if (!isE164Phone(trimmedPhone)) {
      Alert.alert("Invalid phone", "Use international format, for example +15551234567.");
      return;
    }
    if (!goal.trim()) {
      Alert.alert("Task required", "Describe what CALL-E should confirm on the call.");
      return;
    }
    if (!apiBaseUrl) {
      Alert.alert("CALL-E unavailable", "The app does not have an API server URL right now.");
      return;
    }
    try {
      await start({
        task: goal.trim(),
        recipients: [{ phone: trimmedPhone, region: "CA", locale: "en-CA" }],
        metadata: { product: "call-aunty", scenario: scenarioId },
      });
    } catch (error) {
      Alert.alert("CALL-E request failed", error instanceof Error ? error.message : "Try again or use the dialer.");
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.kicker, { color: colors.coral }]}>CALL-E GATEWAY</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Phone agent</Text>
      <Text style={[styles.body, { color: colors.muted }]}>
        The app talks to `/api/calle/*` on the Express server. The provider key never leaves the server.
      </Text>

      <View style={styles.scenarioRow}>
        {SCENARIOS.map((scenario) => {
          const selected = scenario.id === scenarioId;
          return (
            <Pressable
              key={scenario.id}
              onPress={() => {
                setScenarioId(scenario.id);
                setGoal(scenario.task);
              }}
              style={[
                styles.chip,
                { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? tints.lavenderSoft : colors.surface },
              ]}
            >
              <Text style={[styles.chipLabel, { color: colors.foreground }]}>{scenario.title}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="+15551234567"
        placeholderTextColor={colors.muted}
        keyboardType="phone-pad"
        autoCapitalize="none"
        style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
      />
      <TextInput
        value={goal}
        onChangeText={setGoal}
        multiline
        style={[styles.area, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
      />
      <Pressable
        onPress={() => void submit()}
        disabled={busy}
        style={[styles.button, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}
      >
        <Text style={styles.buttonLabel}>{busy ? "CALL-E is working…" : "Start CALL-E call"}</Text>
      </Pressable>

      <View style={[styles.card, cardElevation, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{statusLabel}</Text>
        {state.data?.id ? (
          <Text style={[styles.meta, { color: colors.muted }]}>Call ID {state.data.id}</Text>
        ) : null}
        {state.data?.status ? (
          <Text style={[styles.meta, { color: colors.muted }]}>Provider status: {state.data.status}</Text>
        ) : null}
        {state.error ? <Text style={[styles.error, { color: colors.coral }]}>{state.error}</Text> : null}
        {state.data?.summary ? <Text style={[styles.body, { color: colors.foreground }]}>{state.data.summary}</Text> : null}
        {result ? (
          <Text style={[styles.meta, { color: colors.muted }]}>
            Result: {JSON.stringify(result)}
          </Text>
        ) : null}
        {(state.data?.evidence ?? []).map((item) => (
          <Text key={item} style={[styles.evidence, { color: colors.foreground }]}>
            • {item}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 1.4 },
  title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  body: { fontSize: 14, lineHeight: 20 },
  scenarioRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipLabel: { fontSize: 12, fontWeight: "800" },
  input: { borderWidth: 1, borderRadius: 14, padding: 14, fontSize: 16 },
  area: { minHeight: 110, borderWidth: 1, borderRadius: 14, padding: 14, fontSize: 15, textAlignVertical: "top" },
  button: { padding: 16, borderRadius: 14 },
  buttonLabel: { textAlign: "center", color: "#fff", fontWeight: "800", fontSize: 16 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 18 },
  error: { fontSize: 13, fontWeight: "700" },
  evidence: { fontSize: 13, lineHeight: 18 },
});
