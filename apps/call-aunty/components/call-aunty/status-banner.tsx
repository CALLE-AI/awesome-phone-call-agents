import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { IconSymbol, type IconSymbolName } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";

type StatusTone = "success" | "warning" | "error" | "info";

type StatusAction = {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

type StatusBannerProps = {
  tone: StatusTone;
  icon: IconSymbolName;
  message: string;
  action?: StatusAction;
  extraAction?: StatusAction;
  children?: ReactNode;
  accessibilityRole?: "summary" | "alert" | "none";
  accessibilityLabel?: string;
  accessibilityLiveRegion?: "polite" | "assertive";
};

export function StatusBanner({
  tone,
  icon,
  message,
  action,
  extraAction,
  children,
  accessibilityRole = "summary",
  accessibilityLabel,
  accessibilityLiveRegion = "polite",
}: StatusBannerProps) {
  const colors = useColors();
  const tints = useUiTints();
  const palette = {
    success: { bg: tints.mintSoft, accent: colors.success, text: colors.success },
    warning: { bg: tints.amberSoft, accent: colors.warning, text: colors.warning },
    error: { bg: tints.coralSoft, accent: colors.error, text: colors.error },
    info: { bg: tints.lavenderSoft, accent: colors.primary, text: colors.primary },
  }[tone];

  return (
    <View
      accessibilityRole={accessibilityRole === "none" ? undefined : accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion={accessibilityLiveRegion}
      style={[styles.banner, { backgroundColor: palette.bg }]}
    >
      <View style={[styles.accent, { backgroundColor: palette.accent }]} />
      <View style={styles.body}>
        <View style={styles.row}>
          <IconSymbol name={icon} size={17} color={palette.accent} />
          <Text style={[styles.message, { color: palette.text }]}>{message}</Text>
          {action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel ?? action.label}
              accessibilityHint={action.accessibilityHint}
              onPress={action.onPress}
              hitSlop={8}
            >
              <Text style={[styles.action, { color: palette.text }]}>{action.label}</Text>
            </Pressable>
          ) : null}
          {extraAction ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={extraAction.accessibilityLabel ?? extraAction.label}
              accessibilityHint={extraAction.accessibilityHint}
              onPress={extraAction.onPress}
              hitSlop={8}
            >
              <Text style={[styles.action, { color: colors.muted }]}>{extraAction.label}</Text>
            </Pressable>
          ) : null}
        </View>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: 16,
    paddingVertical: 12,
    paddingRight: 13,
    paddingLeft: 10,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    overflow: "hidden",
  },
  accent: {
    width: 4,
    alignSelf: "stretch",
    borderRadius: 4,
    marginVertical: -4,
    marginLeft: -2,
  },
  body: { flex: 1, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  message: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  action: {
    fontSize: 13,
    fontWeight: "800",
  },
});
