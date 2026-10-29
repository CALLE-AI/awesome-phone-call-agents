import {
  Text,
  View,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  Switch,
  type ViewStyle,
  type KeyboardTypeOptions,
} from 'react-native';
import { colors, elevation, radius, spacing, text } from '../lib/theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Pill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: text.sm, fontWeight: '500' }}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        isPrimary && { backgroundColor: colors.primary, borderColor: colors.primary },
        variant === 'danger' && { borderColor: colors.danger },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.primaryText : colors.textPrimary} />
      ) : (
        <Text
          style={{
            color: isPrimary
              ? colors.primaryText
              : variant === 'danger'
                ? colors.danger
                : colors.textPrimary,
            fontWeight: '600',
            fontSize: text.base,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Notice({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'warning' | 'danger';
}) {
  const palette =
    tone === 'danger'
      ? { bg: colors.dangerSoft, fg: colors.danger }
      : tone === 'warning'
        ? { bg: colors.warningSoft, fg: colors.warning }
        : { bg: colors.surfaceMuted, fg: colors.textSecondary };
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg }]}>
      <Text style={{ color: palette.fg }}>{children}</Text>
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

/* --------------------------------------------------------------- forms */

/** A labelled text input, with room for a hint under it. */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  keyboardType,
  maxLength,
  autoCapitalize,
  multiline,
  onBlur,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: string;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  /** Fired when the field loses focus, for screens that save as you go. */
  onBlur?: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline ? { minHeight: 88, textAlignVertical: 'top' } : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textPlaceholder}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        onBlur={onBlur}
        accessibilityLabel={label}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function FieldHint({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldHint}>{children}</Text>;
}

/**
 * A set of options, all visible.
 *
 * The phone had a single button that CYCLED through automatic -> ask -> never,
 * so the only way to learn the choices was to keep pressing it, and the only
 * way back was to go all the way round again. Every option is on screen here,
 * and the chosen one is marked by weight as well as colour.
 */
export function ChoiceRow({
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      <View style={styles.choiceRow}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: Boolean(disabled) }}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.choice,
                selected && { backgroundColor: colors.primary, borderColor: colors.primary },
                disabled && { opacity: 0.5 },
                pressed && !selected && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Text
                style={{
                  color: selected ? colors.primaryText : colors.textSecondary,
                  fontWeight: selected ? '700' : '500',
                  fontSize: text.sm,
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A switch with its label, the whole row tappable. */
export function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      onPress={() => !disabled && onValueChange(!value)}
      style={styles.toggleRow}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.textPrimary, fontSize: text.base, fontWeight: '500' }}>
          {label}
        </Text>
        {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: colors.primary, false: colors.borderStrong }}
      />
    </Pressable>
  );
}

/* ---------------------------------------------------------------- lists */

/** A tappable row that leads somewhere, with the usual chevron. */
export function NavRow({
  label,
  description,
  value,
  onPress,
  icon,
  last,
}: {
  label: string;
  description?: string;
  value?: string;
  onPress: () => void;
  icon?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.navRow,
        !last && styles.navRowDivided,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      {icon ? <View style={styles.navIcon}>{icon}</View> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.textPrimary, fontSize: text.base, fontWeight: '500' }}>
          {label}
        </Text>
        {description ? <Text style={styles.fieldHint}>{description}</Text> : null}
      </View>
      {value ? <Text style={{ color: colors.textMuted, fontSize: text.sm }}>{value}</Text> : null}
      <Text style={{ color: colors.textMuted, fontSize: text.lg }}>{CHEVRON}</Text>
    </Pressable>
  );
}

const CHEVRON = '\u203A';

/** A read-only label and value, for facts that are not editable. */
export function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <Text style={{ color: colors.textMuted, fontSize: text.sm }}>{label}</Text>
      <Text
        style={{ color: colors.textPrimary, fontSize: text.base, fontWeight: '500', flexShrink: 1 }}
      >
        {value}
      </Text>
    </View>
  );
}

/** Nothing here yet, said in a way that offers the way out. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <Card>
      <Text style={{ color: colors.textPrimary, fontSize: text.md, fontWeight: '600' }}>
        {title}
      </Text>
      <Text style={{ color: colors.textSecondary, marginTop: 6, marginBottom: action ? 16 : 0 }}>
        {body}
      </Text>
      {action ? <Button label={action.label} variant="primary" onPress={action.onPress} /> : null}
    </Card>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.md }}>
      <ActivityIndicator color={colors.primary} />
      <Text style={{ color: colors.textMuted }}>{label ?? 'Loading...'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    fontSize: text.sm,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  fieldHint: {
    fontSize: text.sm,
    color: colors.textMuted,
    marginTop: 6,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontSize: text.md,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 6,
  },
  choice: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 52,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  navRowDivided: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navIcon: {
    width: 28,
    alignItems: 'center',
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    // The web gives cards a soft lift off the canvas; a flat bordered box read
    // as a different product next to it.
    ...elevation.card,
  },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  button: {
    // 44pt minimum touch target (section 37).
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  notice: {
    padding: spacing.lg,
    borderRadius: radius.md,
  },
  sectionLabel: {
    fontSize: text.xs,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
});
