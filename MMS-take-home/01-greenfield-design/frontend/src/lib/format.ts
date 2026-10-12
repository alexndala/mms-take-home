/** Human-readable time formatting. The contract returns RFC 3339 UTC timestamps. */

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  month: 'short',
  day: 'numeric',
})

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** Short form for timeline cards. */
export function formatTimelineTime(iso: string): string {
  return timeFormatter.format(new Date(iso))
}

/** Full form for revision history. */
export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso))
}
