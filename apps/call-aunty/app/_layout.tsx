import "react-native-gesture-handler";
import "react-native-reanimated";
import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Platform } from "react-native";
import "@/lib/_core/nativewind-pressable";
import { AppRoleProvider } from "@/contexts/app-role";
import { LanguageProvider } from "@/contexts/language-context";
import { ThemeProvider } from "@/lib/theme-provider";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { AppErrorBoundary } from "@/components/call-aunty/app-error-boundary";
import { trpc, createTRPCClient } from "@/lib/trpc";
import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";
import { registerBackgroundSync } from "@/lib/background-sync";
import { getAppCopy } from "@/lib/app-copy";
import { useLanguage } from "@/contexts/language-context";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const unstable_settings = {
  anchor: "(tabs)",
};

function LocalizedErrorBoundary({ children }: { children: ReactNode }) {
  const { language } = useLanguage();
  const copy = getAppCopy(language);
  return (
    <AppErrorBoundary title={copy.unexpectedErrorTitle} body={copy.unexpectedErrorBody} retryLabel={copy.retry}>
      {children}
    </AppErrorBoundary>
  );
}

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  // Initialize Manus runtime for cookie injection from parent container
  useEffect(() => {
    initManusRuntime();
    void registerBackgroundSync();
  }, []);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 15_000,
            gcTime: 5 * 60_000,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());

  // Ensure minimum 8px padding for top and bottom on mobile
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <LocalizedErrorBoundary>
            {/* Default to hiding native headers so raw route segments don't appear (e.g. "(tabs)", "products/[id]"). */}
            {/* If a screen needs the native header, explicitly enable it and set a human title via Stack.Screen options. */}
            {/* in order for ios apps tab switching to work properly, use presentation: "fullScreenModal" for login page, whenever you decide to use presentation: "modal*/}
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="oauth/callback" />
            </Stack>
            <StatusBar style="auto" />
          </LocalizedErrorBoundary>
        </QueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
  );

  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <AppErrorBoundary>
        <ThemeProvider>
          <AppRoleProvider>
            <LanguageProvider>
              <SafeAreaProvider initialMetrics={providerInitialMetrics}>
                <SafeAreaFrameContext.Provider value={frame}>
                  <SafeAreaInsetsContext.Provider value={insets}>
                    {content}
                  </SafeAreaInsetsContext.Provider>
                </SafeAreaFrameContext.Provider>
              </SafeAreaProvider>
            </LanguageProvider>
          </AppRoleProvider>
        </ThemeProvider>
      </AppErrorBoundary>
    );
  }

  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <AppRoleProvider>
          <LanguageProvider>
            <SafeAreaProvider initialMetrics={providerInitialMetrics}>{content}</SafeAreaProvider>
          </LanguageProvider>
        </AppRoleProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
