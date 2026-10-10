import { Tabs, Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';
import {
  PlusIcon,
  ClockIcon,
  ContactsIcon,
  BriefcaseIcon,
  SettingsIcon,
} from '../../components/icons';

/**
 * Native tab navigation — not a WebView, and not a re-skinned browser shell.
 * The auth gate runs before any tab renders.
 */
export default function TabsLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!user) return <Redirect href="/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        // Indigo for the selected tab, matching the web sidebar rather than
        // the near-black the app used before.
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60,
          paddingTop: 6,
          paddingBottom: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { fontWeight: '700', color: colors.textPrimary },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {/*
        Every tab now carries an icon. They were declared without `tabBarIcon`,
        so the bar showed four labels floating over empty space.
      */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dial',
          tabBarLabel: 'New',
          tabBarIcon: ({ color, size }) => <PlusIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Your tasks',
          tabBarLabel: 'Tasks',
          tabBarIcon: ({ color, size }) => <ClockIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarLabel: 'Contacts',
          tabBarIcon: ({ color, size }) => <ContactsIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="business"
        options={{
          title: 'Business',
          tabBarLabel: 'Business',
          tabBarIcon: ({ color, size }) => <BriefcaseIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) => <SettingsIcon size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
