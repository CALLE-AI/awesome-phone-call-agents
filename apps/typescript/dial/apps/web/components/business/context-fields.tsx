'use client';

import {
  describeAppointment,
  splitAppointmentValue,
  composeAppointmentValue,
  isCompleteAppointment,
} from '@dial/schemas';

/**
 * The details a workflow needs before it can call anyone.
 *
 * Shared by the run page and the quick-run panel on Contacts, which had
 * drifted into two different things. The panel showed a single free-text box
 * labelled "Context (appointment time, service…)" and posted whatever was
 * typed into `contextFields[0]` -- whichever field the template happened to
 * list first. On an appointment reminder that is the appointment time, so it
 * looked right. On a customer callback the first field is `service`, so a date
 * typed there made Dial say "They contacted you about 2026-08-25 10:30 AM",
 * and on a custom job there is no context field at all, so the text was
 * silently dropped. Rendering the template's own fields removes the guess.
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
  idPrefix,
}: {
  fields: ContextField[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  idPrefix: string;
}) {
  return (
    <>
      {fields.map((field) =>
        field.type === 'datetime' ? (
          <DateTimeField
            key={field.id}
            field={field}
            idPrefix={idPrefix}
            value={values[field.id] ?? ''}
            onChange={(next) => onChange(field.id, next)}
          />
        ) : (
          <div className="field" key={field.id}>
            <label htmlFor={`${idPrefix}-${field.id}`}>
              {field.label}
              {field.required ? '' : ' (optional)'}
            </label>
            <input
              id={`${idPrefix}-${field.id}`}
              value={values[field.id] ?? ''}
              onChange={(e) => onChange(field.id, e.target.value)}
              placeholder={field.hint}
            />
            {field.hint ? <p className="field-hint">{field.hint}</p> : null}
          </div>
        ),
      )}
    </>
  );
}

/**
 * A date and a time, as two controls over one stored value.
 *
 * One combined box asked the user to copy "2026-08-25 10:30 AM" from a
 * placeholder and hope the server agreed: a free-text field where a typo
 * becomes a wrong appointment read out on a real phone call. Native date and
 * time inputs give a picker, the platform's own keyboard on a phone, and the
 * user's own display format, while the value handed to the server stays the
 * unambiguous `YYYY-MM-DDTHH:mm`.
 *
 * There is no local state here on purpose. An earlier version derived both
 * boxes from a value that could not represent a half-filled answer, so the
 * first thing you entered composed to '' and the controlled input reset
 * itself -- neither box could keep what was typed. The stored value now holds
 * partials (`2026-08-25T`), which keeps one source of truth and lets the
 * inputs stay fully controlled.
 */
export function DateTimeField({
  field,
  value,
  onChange,
  idPrefix,
}: {
  field: ContextField;
  value: string;
  onChange: (next: string) => void;
  idPrefix: string;
}) {
  const [date, time] = splitAppointmentValue(value);
  const complete = isCompleteAppointment(value);

  return (
    <fieldset className="field-group">
      <legend>
        {field.label}
        {field.required ? '' : ' (optional)'}
      </legend>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-${field.id}-date`}>Date</label>
          <input
            id={`${idPrefix}-${field.id}-date`}
            type="date"
            value={date}
            onChange={(e) => onChange(composeAppointmentValue(e.target.value, time))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-${field.id}-time`}>Time</label>
          <input
            id={`${idPrefix}-${field.id}-time`}
            type="time"
            value={time}
            onChange={(e) => onChange(composeAppointmentValue(date, e.target.value))}
          />
        </div>
      </div>
      {complete ? (
        <p className="field-hint">Dial will say: {describeAppointment(value)}</p>
      ) : (
        <p className="field-hint">
          {date && !time
            ? 'Now pick a time.'
            : time && !date
              ? 'Now pick a date.'
              : (field.hint ?? 'Pick both a date and a time.')}
        </p>
      )}
    </fieldset>
  );
}

/**
 * Required fields that are not answered yet.
 *
 * A half-filled date counts as unanswered: the stored value can hold
 * `2026-08-25T`, and submitting that would reach the server as an invalid
 * date rather than as the missing answer it really is.
 */
export function missingRequired(fields: ContextField[], values: Record<string, string>): ContextField[] {
  return fields.filter((field) => {
    if (!field.required) return false;
    const value = (values[field.id] ?? '').trim();
    if (!value) return true;
    return field.type === 'datetime' ? !isCompleteAppointment(value) : false;
  });
}
