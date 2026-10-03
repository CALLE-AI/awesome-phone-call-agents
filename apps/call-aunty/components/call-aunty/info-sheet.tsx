import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";

type InfoSheetProps = {
  visible: boolean;
  title: string;
  body: string;
  primaryLabel: string;
  secondaryLabel?: string;
  onPrimary: () => void;
  onClose: () => void;
  primaryTone?: "primary" | "coral" | "danger";
};

export function InfoSheet({
  visible,
  title,
  body,
  primaryLabel,
  secondaryLabel = "Close",
  onPrimary,
  onClose,
  primaryTone = "primary",
}: InfoSheetProps) {
  const colors = useColors();
  const tints = useUiTints();
  const insets = useSafeAreaInsets();
  const primaryBackground =
    primaryTone === "coral" ? colors.coral : primaryTone === "danger" ? colors.error : colors.primary;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.scrim, { backgroundColor: tints.scrim }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={secondaryLabel} style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 22) }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {title}
          </Text>
          <ScrollView style={styles.bodyScroll} showsVerticalScrollIndicator={false}>
            <Text style={[styles.body, { color: colors.muted }]}>{body}</Text>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={secondaryLabel}
              onPress={onClose}
              style={({ pressed }) => [styles.secondary, { borderColor: colors.border }, pressed && styles.pressed]}
            >
              <Text style={[styles.secondaryText, { color: colors.foreground }]}>{secondaryLabel}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={primaryLabel}
              onPress={onPrimary}
              style={({ pressed }) => [styles.primary, { backgroundColor: primaryBackground }, pressed && styles.pressed]}
            >
              <Text style={styles.primaryText}>{primaryLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 22,
    gap: 14,
    maxHeight: "78%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  bodyScroll: { flexGrow: 0 },
  body: { fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  secondary: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryText: { fontSize: 14, fontWeight: "800" },
  primary: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.78 },
});
