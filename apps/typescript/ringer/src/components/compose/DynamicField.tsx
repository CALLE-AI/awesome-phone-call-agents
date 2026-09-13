import { Field, Input, Textarea, Select, ChipsInput } from '@/components/ui/fields'
import type { TemplateField, TaskValues } from '@/lib/tasks/types'

export function DynamicField({
  field,
  values,
  onChange,
}: {
  field: TemplateField
  values: TaskValues
  onChange: (name: string, value: string | string[]) => void
}) {
  if (field.showWhen) {
    const current = values[field.showWhen.field]
    if (current !== field.showWhen.equals) return null
  }

  const id = `f-${field.name}`
  const strVal = typeof values[field.name] === 'string' ? (values[field.name] as string) : ''
  const arrVal = Array.isArray(values[field.name]) ? (values[field.name] as string[]) : []

  return (
    <Field label={field.label} htmlFor={id} help={field.help} required={field.required}>
      {field.type === 'textarea' ? (
        <Textarea
          id={id}
          value={strVal}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      ) : field.type === 'select' ? (
        <Select id={id} value={strVal} onChange={(e) => onChange(field.name, e.target.value)}>
          {!field.required && <option value="">Select…</option>}
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : field.type === 'chips' ? (
        <ChipsInput
          id={id}
          value={arrVal}
          placeholder={field.placeholder}
          onChange={(next) => onChange(field.name, next)}
        />
      ) : (
        <Input
          id={id}
          type={field.type === 'number' ? 'number' : field.type === 'tel' ? 'tel' : 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          min={field.min}
          prefix={field.prefix}
          value={strVal}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      )}
    </Field>
  )
}
