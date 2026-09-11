/** Minimal iCalendar (.ics) builder for booked appointments. */

export interface IcsInput {
  title: string
  startIso: string
  durationMinutes?: number
  location?: string
  description?: string
}

function icsDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Returns null when startIso is not a parseable datetime. */
export function buildIcs(input: IcsInput): string | null {
  const start = new Date(input.startIso)
  if (Number.isNaN(start.getTime())) return null
  const end = new Date(start.getTime() + (input.durationMinutes ?? 60) * 60_000)
  const uid = `ringer-${Math.random().toString(36).slice(2)}@ringer.app`

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ringer//Phone Agent//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${esc(input.title)}`,
    ...(input.location ? [`LOCATION:${esc(input.location)}`] : []),
    ...(input.description ? [`DESCRIPTION:${esc(input.description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n')
}

export function downloadIcs(ics: string, filename = 'appointment.ics') {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
