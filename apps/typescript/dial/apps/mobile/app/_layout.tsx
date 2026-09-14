import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../lib/auth';
import { PushTapRouter } from '../components/push-tap';
import { colors } from '../lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PushTapRouter />
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTitleStyle: { color: colors.textPrimary, fontSize: 17 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="task/[id]" options={{ title: 'Task' }} />

          {/* Settings is four screens now, drilled into from the tab. */}
          <Stack.Screen name="settings/calling" options={{ title: 'Calling' }} />
          <Stack.Screen name="settings/usage" options={{ title: 'Usage' }} />
          <Stack.Screen name="settings/permissions" options={{ title: 'Permissions' }} />
          <Stack.Screen name="settings/profile" options={{ title: 'Profile' }} />

          {/* Business: the second orchestration mode, on the phone. */}
          <Stack.Screen name="business/new" options={{ title: 'Add a business' }} />
          <Stack.Screen name="business/[businessId]/index" options={{ title: 'Business' }} />
          <Stack.Screen name="business/[businessId]/workflows/index" options={{ title: 'Workflows' }} />
          <Stack.Screen name="business/[businessId]/workflows/new" options={{ title: 'New workflow' }} />
          <Stack.Screen name="business/[businessId]/contacts" options={{ title: 'Contacts' }} />
          <Stack.Screen name="business/[businessId]/runs" options={{ title: 'Calls' }} />
          <Stack.Screen name="business/[businessId]/settings" options={{ title: 'Business settings' }} />
          <Stack.Screen name="business/[businessId]/run/[workflowId]" options={{ title: 'Run workflow' }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
