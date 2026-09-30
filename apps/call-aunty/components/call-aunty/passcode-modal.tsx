import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";

export function PasscodeModal({
  visible,
  title,
  subtitle,
  value,
  error,
  strengthLabel,
  disabled = false,
  progress,
  submitLabel,
  cancelLabel = "Cancel",
  waitLabel = "Wait",
  onChange,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  value: string;
  error?: string;
  strengthLabel?: string;
  disabled?: boolean;
  progress?: number;
  submitLabel: string;
  cancelLabel?: string;
  waitLabel?: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const colors = useColors();
  const tints = useUiTints();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.scrim, { backgroundColor: tints.scrim }]}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={[styles.lockBadge, { backgroundColor: tints.lavenderSoft }]}>
            <IconSymbol name="lock.fill" size={20} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text>
          <TextInput
            accessibilityLabel="Passcode"
            autoFocus
            keyboardType="number-pad"
            secureTextEntry
            editable={!disabled}
            value={value}
            onChangeText={(next) => onChange(next.replace(/\D/g, "").slice(0, 6))}
            placeholder="4 to 6 digits"
            placeholderTextColor={colors.muted}
            style={[styles.input, { color: colors.foreground, borderColor: error ? colors.error : colors.border, backgroundColor: colors.background }]}
          />
          <Text accessibilityLiveRegion="polite" style={[styles.error, { color: error ? colors.error : colors.muted }]}>
            {error ?? strengthLabel ?? "Your passcode stays protected on this device."}
          </Text>
          {typeof progress === "number" && (
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 1, now: progress }}
              style={[styles.progressTrack, { backgroundColor: colors.border }]}
            >
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.primary }]} />
            </View>
          )}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.cancel}>
              <Text style={[styles.cancelText, { color: colors.muted }]}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              accessibilityState={{ disabled }}
              onPress={onSubmit}
              style={[styles.submit, { backgroundColor: colors.primary }, disabled && styles.disabled]}
            >
              <Text style={styles.submitText}>{disabled ? waitLabel : submitLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 22 },
  card: { width: "100%", maxWidth: 420, borderRadius: 26, padding: 24, gap: 12 },
  lockBadge: { width: 44, height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  input: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14, fontSize: 22, letterSpacing: 6, textAlign: "center" },
  error: { fontSize: 12, minHeight: 18, lineHeight: 17 },
  actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 4 },
  cancel: { paddingHorizontal: 12, paddingVertical: 11 },
  cancelText: { fontWeight: "800" },
  submit: { borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12 },
  submitText: { color: "#FFFFFF", fontWeight: "800" },
  disabled: { opacity: 0.5 },
  progressTrack: { height: 6, borderRadius: 6, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 6 },
});
