import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { colors, spacing, text } from '../../lib/theme';
import { Card, NavRow, SectionLabel } from '../../components/ui';
import { PhoneCallIcon, CardIcon, KeyIcon, UserIcon } from '../../components/icons';

/**
 * Settings, as four places rather than one long scroll.
 *
 * The whole policy used to live on this screen, which meant scrolling past
 * the authorization model to reach "sign out". The web splits the same
 * settings into Calling, Usage, Permissions and Account; this is that split,
 * laid out the way a phone does it -- a list you drill into, so each section
 * gets a full screen and its own back button.
 */

const SECTIONS = [
  {
    href: '/settings/calling',
    label: 'Calling',
    description: 'How Dial sounds and behaves on the phone.',
    Icon: PhoneCallIcon,
  },
  {
    href: '/settings/usage',
    label: 'Usage',
    description: 'Calls and tasks used, against your daily limit.',
    Icon: CardIcon,
  },
  {
    href: '/settings/permissions',
    label: 'Permissions',
    description: 'What Dial may do, and what it may say about you.',
    Icon: KeyIcon,
  },
  {
    href: '/settings/profile',
    label: 'Profile',
    description: 'Your details, your data, and signing out.',
    Icon: UserIcon,
  },
] as const;

export default function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      {user ? (
        <Card>
          <Text style={{ color: colors.textPrimary, fontSize: text.lg, fontWeight: '700' }}>
            {user.name}
          </Text>
          <Text style={{ color: colors.textSecondary, marginTop: 2 }}>{user.email}</Text>
        </Card>
      ) : null}

      <View>
        <SectionLabel>Settings</SectionLabel>
        <Card>
          {SECTIONS.map((section, index) => (
            <NavRow
              key={section.href}
              label={section.label}
              description={section.description}
              icon={<section.Icon size={20} color={colors.textMuted} />}
              last={index === SECTIONS.length - 1}
              onPress={() => router.push(section.href)}
            />
          ))}
        </Card>
      </View>
    </ScrollView>
  );
}
