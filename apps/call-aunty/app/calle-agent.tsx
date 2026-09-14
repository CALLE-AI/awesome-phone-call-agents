import { ScrollView, StyleSheet } from "react-native";
import { router } from "expo-router";

import { BackLink } from "@/components/call-aunty/back-link";
import { CalleCallComposer } from "@/components/CalleCallComposer";
import { ScreenContainer } from "@/components/screen-container";
import { getApiBaseUrl } from "@/constants/oauth";

export default function CalleAgentScreen() {
  return (
    <ScreenContainer className="px-5" containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackLink label="Back" onPress={() => router.back()} />
        <CalleCallComposer apiBaseUrl={getApiBaseUrl()} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingBottom: 36, gap: 12 },
});
