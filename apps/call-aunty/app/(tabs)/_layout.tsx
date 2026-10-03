import { Tabs } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol, type IconSymbolName } from "@/components/ui/icon-symbol";
import { useAppRole } from "@/contexts/app-role";
import { useLanguage } from "@/contexts/language-context";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { getAppCopy } from "@/lib/app-copy";
import { floatingBarElevation } from "@/lib/ui-elevation";

function TabIcon({ name, color, focused }: { name: IconSymbolName; color: string; focused: boolean }) {
  const tints = useUiTints();
  return (
    <View style={[styles.iconWrap, focused && { backgroundColor: tints.lavenderSoft }]}>
      <IconSymbol size={22} name={name} color={color} />
    </View>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { role } = useAppRole();
  const { language } = useLanguage();
  const copy = getAppCopy(language);
  const bottomOffset = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const isChw = role === "chw";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarButton: HapticTab,
        tabBarLabelStyle: styles.label,
        tabBarStyle: {
          position: "absolute",
          left: 16,
          right: 16,
          bottom: bottomOffset,
          height: 68,
          paddingTop: 8,
          paddingBottom: 10,
          borderRadius: 24,
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          ...floatingBarElevation,
        },
        tabBarItemStyle: styles.item,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: copy.tabHome,
          tabBarIcon: ({ color, focused }) => <TabIcon name="house.fill" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="care"
        options={{
          title: copy.tabCare,
          href: isChw ? null : "/care",
          tabBarIcon: ({ color, focused }) => <TabIcon name="calendar" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="queue"
        options={{
          title: copy.tabQueue,
          href: isChw ? "/queue" : null,
          tabBarIcon: ({ color, focused }) => <TabIcon name="person.2.fill" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: copy.tabSettings,
          tabBarIcon: ({ color, focused }) => <TabIcon name="gearshape.fill" color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: "700", marginTop: 4 },
  item: { paddingTop: 2 },
  iconWrap: {
    width: 52,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
});
