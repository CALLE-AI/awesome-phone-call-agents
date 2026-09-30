import { Link, Stack } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

export default function NotFoundScreen() {
  const colors = useColors();

  return (
    <>
      <Stack.Screen options={{ title: "Not found", headerShown: true }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>This screen does not exist.</Text>
        <Link href="/" asChild>
          <Pressable accessibilityRole="link">
            <Text style={[styles.link, { color: colors.primary }]}>Go to home</Text>
          </Pressable>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 12 },
  title: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  link: { fontSize: 16, fontWeight: "700" },
});
