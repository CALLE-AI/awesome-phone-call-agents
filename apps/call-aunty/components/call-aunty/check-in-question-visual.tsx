import { StyleSheet, View } from "react-native";

import { IconSymbol, type IconSymbolName } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import type { CheckInQuestionId } from "../../lib/check-in-questionnaire";
import { getCheckInVisual, type CheckInVisualTone } from "../../lib/check-in-visuals";

type CheckInQuestionVisualProps = {
  questionId: CheckInQuestionId;
  accessibilityLabel: string;
};

export function CheckInQuestionVisual({ questionId, accessibilityLabel }: CheckInQuestionVisualProps) {
  const colors = useColors();
  const tints = useUiTints();
  const visual = getCheckInVisual(questionId);
  const palette = tonePalette(visual.tone, colors, tints);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.frame, { backgroundColor: palette.wash, borderColor: palette.border }]}
    >
      <View style={[styles.blob, styles.blobBack, { backgroundColor: palette.blob }]} />
      <View style={[styles.blob, styles.blobFront, { backgroundColor: palette.blobSoft }]} />
      <View style={[styles.iconStage, { backgroundColor: colors.surface }]}>
        <IconSymbol name={visual.icon as IconSymbolName} size={36} color={palette.ink} />
      </View>
      <View style={[styles.badge, { backgroundColor: palette.ink }]}>
        <IconSymbol name={visual.secondaryIcon as IconSymbolName} size={16} color="#FFFFFF" />
      </View>
    </View>
  );
}

function tonePalette(
  tone: CheckInVisualTone,
  colors: ReturnType<typeof useColors>,
  tints: ReturnType<typeof useUiTints>,
) {
  switch (tone) {
    case "coral":
      return { wash: tints.coralSoft, border: tints.coralBorder, blob: tints.coralMid, blobSoft: tints.coralSoft, ink: colors.coral };
    case "mint":
      return { wash: tints.mintSoft, border: colors.border, blob: colors.surface, blobSoft: tints.mintSoft, ink: colors.success };
    case "amber":
      return { wash: tints.amberSoft, border: colors.border, blob: colors.surface, blobSoft: tints.amberSoft, ink: colors.warning };
    default:
      return { wash: tints.lavenderSoft, border: tints.lavenderBorder, blob: colors.surface, blobSoft: tints.lavenderSoft, ink: colors.primary };
  }
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    height: 132,
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  blob: {
    position: "absolute",
    borderRadius: 999,
  },
  blobBack: {
    width: 168,
    height: 168,
    right: -48,
    top: -62,
    opacity: 0.7,
  },
  blobFront: {
    width: 110,
    height: 110,
    left: -36,
    bottom: -48,
    opacity: 0.9,
  },
  iconStage: {
    width: 72,
    height: 72,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    right: 18,
    bottom: 16,
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
