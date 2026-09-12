import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { colors, radius, spacing, text } from '../lib/theme';
import { Button, Notice } from '../components/ui';

/**
 * The same account as the web app — one identity, one task history. Signing in
 * here shows tasks started in a browser, and vice versa.
 */
export default function SignInScreen() {
  const { user, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Redirect href="/(tabs)" />;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'sign-up') {
        await signUp(email.trim(), password, name.trim() || email.split('@')[0] || 'You');
      } else {
        await signIn(email.trim(), password);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>DIAL</Text>
        <Text style={styles.tagline}>Tell Dial what you need. It makes the calls.</Text>

        <View style={styles.card}>
          {mode === 'sign-up' ? (
            <View style={styles.field}>
              <Text style={styles.label}>Your name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                textContentType="name"
              />
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
            />
            {mode === 'sign-up' ? (
              <Text style={styles.hint}>At least 12 characters.</Text>
            ) : null}
          </View>

          {error ? <Notice tone="danger">{error}</Notice> : null}

          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            <Button
              label={mode === 'sign-in' ? 'Sign in' : 'Create account'}
              variant="primary"
              loading={busy}
              onPress={() => void submit()}
            />
            <Button
              label={mode === 'sign-in' ? 'Create an account instead' : 'I already have an account'}
              onPress={() => {
                setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
                setError(null);
              }}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingTop: spacing.xxl * 2, gap: spacing.md },
  brand: {
    fontSize: text.xxl,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  tagline: {
    textAlign: 'center',
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  field: { marginBottom: spacing.md },
  label: { color: colors.textSecondary, fontSize: text.sm, marginBottom: 6, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
    color: colors.textPrimary,
    fontSize: text.base,
  },
  hint: { color: colors.textMuted, fontSize: text.sm, marginTop: 4 },
});
