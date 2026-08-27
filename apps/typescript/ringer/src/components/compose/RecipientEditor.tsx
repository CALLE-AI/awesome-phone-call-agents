import { Check, Phone, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Field, Input, Select } from '@/components/ui/fields'
import { Button } from '@/components/ui/Button'
import { REGIONS, getRegion } from '@/lib/regions'
import { normalizePhone } from '@/lib/phone'
import type { DirectoryEntry } from '@/lib/directory'
import { BusinessSearch } from './BusinessSearch'
import { cn } from '@/lib/cn'

export interface UiRecipient {
  id: string
  businessName: string
  phoneRaw: string
  region: string
  locale: string
}

export function newRecipient(): UiRecipient {
  return { id: Math.random().toString(36).slice(2), businessName: '', phoneRaw: '', region: 'US', locale: 'en-US' }
}

function PhoneStatus({ raw, region }: { raw: string; region: string }) {
  if (!raw.trim()) return null
  const res = normalizePhone(raw, region)
  if (!res.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
        <TriangleAlert className="size-3.5" /> {res.message}
      </span>
    )
  }
  if (res.assumedCountry) {
    // The country code was inferred — surface it so it isn't applied silently.
    return (
      <span className="inline-flex flex-wrap items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        <TriangleAlert className="size-3.5" /> {res.normalized}
        <span className="font-normal text-muted">· assuming {res.assumedRegion} — type + and the country code to override</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
      <Check className="size-3.5" /> {res.normalized}
    </span>
  )
}

function RegionLangRow({
  recipient,
  onChange,
}: {
  recipient: UiRecipient
  onChange: (patch: Partial<UiRecipient>) => void
}) {
  const region = getRegion(recipient.region)
  return (
    <div className="grid grid-cols-2 gap-2">
      <Select
        aria-label="Region"
        value={recipient.region}
        onChange={(e) => {
          const r = getRegion(e.target.value)
          onChange({ region: e.target.value, locale: r.defaultLocale })
        }}
      >
        {REGIONS.map((r) => (
          <option key={r.code} value={r.code}>
            {r.flag} {r.name} ({r.dial})
          </option>
        ))}
      </Select>
      <Select
        aria-label="Language"
        value={recipient.locale}
        onChange={(e) => onChange({ locale: e.target.value })}
      >
        {region.locales.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </Select>
    </div>
  )
}

export function RecipientEditor({
  batch,
  showNameField,
  namePlaceholder,
  recipients,
  onChange,
  onPickName,
}: {
  batch: boolean
  showNameField: boolean
  namePlaceholder?: string
  recipients: UiRecipient[]
  onChange: (next: UiRecipient[]) => void
  /** Single mode: propagate a directory pick's name into the task form. */
  onPickName?: (name: string) => void
}) {
  const patch = (id: string, p: Partial<UiRecipient>) =>
    onChange(recipients.map((r) => (r.id === id ? { ...r, ...p } : r)))
  const remove = (id: string) => onChange(recipients.filter((r) => r.id !== id))
  const add = () => onChange([...recipients, newRecipient()])

  if (!batch) {
    const r = recipients[0]
    const pickSingle = (entry: DirectoryEntry) => {
      patch(r.id, {
        businessName: entry.name,
        phoneRaw: entry.phone,
        region: entry.region,
        locale: entry.locale,
      })
      onPickName?.(entry.name)
    }
    return (
      <div className="flex flex-col gap-4">
        <BusinessSearch onSelect={pickSingle} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone number" htmlFor="rc-phone" required error={undefined}>
            <Input
              id="rc-phone"
              type="tel"
              placeholder="+1 415 555 0100"
              value={r.phoneRaw}
              onChange={(e) => patch(r.id, { phoneRaw: e.target.value })}
            />
            <div className="mt-1 min-h-4">
              <PhoneStatus raw={r.phoneRaw} region={r.region} />
            </div>
          </Field>
          <Field label="Region & language" htmlFor="rc-region">
            <RegionLangRow recipient={r} onChange={(p) => patch(r.id, p)} />
          </Field>
        </div>
      </div>
    )
  }

  const pickBatch = (entry: DirectoryEntry) => {
    // Fill the first empty row, or append a new one.
    const empty = recipients.find((r) => !r.phoneRaw.trim() && !r.businessName.trim())
    const filled = {
      businessName: entry.name,
      phoneRaw: entry.phone,
      region: entry.region,
      locale: entry.locale,
    }
    if (empty) {
      onChange(recipients.map((r) => (r.id === empty.id ? { ...r, ...filled } : r)))
    } else {
      onChange([...recipients, { ...newRecipient(), ...filled }])
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <BusinessSearch
        onSelect={pickBatch}
        placeholder="Search and pick businesses — “dentist”, “auto repair”…"
      />
      {recipients.map((r, i) => (
        <div key={r.id} className="card-2 relative p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
              <span className="grid size-5 place-items-center rounded-md bg-primary-soft text-[0.7rem] font-extrabold text-primary-strong dark:text-primary">
                {i + 1}
              </span>
              Business {i + 1}
            </span>
            {recipients.length > 1 && (
              <button
                type="button"
                onClick={() => remove(r.id)}
                className="cursor-pointer rounded-lg p-1.5 text-faint hover:bg-danger/10 hover:text-danger"
                aria-label={`Remove business ${i + 1}`}
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {showNameField && (
              <Input
                aria-label={`Business ${i + 1} name`}
                placeholder={namePlaceholder ?? 'Business name'}
                value={r.businessName}
                onChange={(e) => patch(r.id, { businessName: e.target.value })}
              />
            )}
            <div className={cn(!showNameField && 'sm:col-span-2')}>
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <Input
                  type="tel"
                  className="pl-9"
                  placeholder="+1 415 555 0100"
                  value={r.phoneRaw}
                  onChange={(e) => patch(r.id, { phoneRaw: e.target.value })}
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <RegionLangRow recipient={r} onChange={(p) => patch(r.id, p)} />
            </div>
          </div>
          <div className="mt-1.5 min-h-4">
            <PhoneStatus raw={r.phoneRaw} region={r.region} />
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" iconLeft={<Plus className="size-4" />} onClick={add} className="self-start">
        Add another business
      </Button>
    </div>
  )
}
