import { View, Text, Platform } from 'react-native';
import {
  describeAppointment,
  splitAppointmentValue,
  composeAppointmentValue,
  isCompleteAppointment,
  maskAppointmentDate,
  maskAppointmentTime,
} from '@dial/schemas';
import { colors, spacing, text } from '../lib/theme';
import { Field, FieldHint } from './ui';

/**
 * The details a workflow needs before it can call anyone.
 *
 * The same shape as the web's version, sharing the same value helpers from
 * `@dial/schemas` so a run started on a phone and one started in a browser
 * store an identical string. The template's own fields are rendered rather
 * than one free-text box, which on the web silently posted whatever was typed
 * into whichever field happened to be listed first.
 */

export interface ContextField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  hint?: string;
}

export function ContextFields({
  fields,
  values,
  onChange,
}: {
  fields: ContextField[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
}) {
  return (
    <>
      {fields.map((field) =>
        field.type === 'datetime' ? (
          <DateTimeField
            key={field.id}
            field={field}
            value={values[field.id] ?? ''}
            onChange={(next) => onChange(field.id, next)}
          />
        ) : (
          <Field
            key={field.id}
            label={field.required ? field.label : `${field.label} (optional)`}
            value={values[field.id] ?? ''}
            onChangeText={(next) => onChange(field.id, next)}
            placeholder={field.hint}
          />
        ),
      )}
    </>
  );
}

/**
 * A date and a time, typed rather than picked.
 *
 * React Native has no `<input type="date">`, and a native picker module is a
 * dependency this app does not otherwise need. Two numeric fields with a
 * strict format and a live readback of what Dial will actually say does the
 * job: the readback is the check, because it shows the day of the week and a
 * wrong date is obvious there in a way `08/25` never is.
 *
 * The stored value can hold a half-filled answer (`2026-08-25T`), the same as
 * the web, so entering one half does not wipe the other.
 */
export function DateTimeField({
  field,
  value,
  onChange,
}: {
  field: ContextField;
  value: string;
  onChange: (next: string) => void;
}) {
  const [date, time] = splitAppointmentValue(value);
  const complete = isCompleteAppointment(value);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text
        style={{
          color: colors.textPrimary,
          fontSize: text.base,
          fontWeight: '600',
          marginBottom: spacing.sm,
        }}
      >
        {field.required ? field.label : `${field.label} (optional)`}
      </Text>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 3 }}>
          <Field
            label="Date"
            value={date}
            onChangeText={(next) => onChange(composeAppointmentValue(maskAppointmentDate(next), time))}
            placeholder="2026-08-25"
            keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
            maxLength={10}
          />
        </View>
        <View style={{ flex: 2 }}>
          <Field
            label="Time"
            value={time}
            onChangeText={(next) => onChange(composeAppointmentValue(date, maskAppointmentTime(next)))}
            placeholder="10:30"
            keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
            maxLength={5}
          />
        </View>
      </View>

      {complete ? (
        <FieldHint>Dial will say: {describeAppointment(value)}</FieldHint>
      ) : (
        <FieldHint>
          {date && !time
            ? 'Now add a time, as 24-hour HH:MM.'
            : time && !date
              ? 'Now add a date, as YYYY-MM-DD.'
              : (field.hint ?? 'Date as YYYY-MM-DD, time as 24-hour HH:MM.')}
        </FieldHint>
      )}
    </View>
  );
}

/**
 * Required fields that are not answered yet.
 *
 * A half-filled date counts as unanswered: submitting `2026-08-25T` would
 * reach the server as an invalid date rather than as the missing answer it is.
 */
export function missingRequired(
  fields: ContextField[],
  values: Record<string, string>,
): ContextField[] {
  return fields.filter((field) => {
    if (!field.required) return false;
    const value = (values[field.id] ?? '').trim();
    if (!value) return true;
    return field.type === 'datetime' ? !isCompleteAppointment(value) : false;
  });
}
