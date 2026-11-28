const formatters = new Map<string, Intl.NumberFormat>()

/** Cents as money, e.g. -$1,234.56. */
export const formatMoney = (cents: number | null | undefined, currency = "USD") => {
  if (cents === null || cents === undefined) return "—"
  let found = formatters.get(currency)
  if (!found) {
    found = new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
    formatters.set(currency, found)
  }
  return found.format(cents / 100)
}

const dayYearFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })

// Database timestamps read "2026-11-26 04:15:13.788", in UTC.
const utc = (timestamp: string) => new Date(timestamp.includes("T") ? timestamp : `${timestamp.replace(" ", "T")}Z`)

/** A timestamp as "Nov 26, 2026". */
export const formatDayYear = (timestamp: string) => dayYearFormat.format(utc(timestamp))

/** A timestamp as "3h ago", or its date after a week. */
export const formatAgo = (timestamp: string | null) => {
  if (!timestamp) return "Never"
  const at = utc(timestamp).getTime()
  const seconds = Math.round((Date.now() - at) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`
  return dayYearFormat.format(at)
}

/** An account's name with its last four, unless the name already carries them, as Plaid's often do. */
export const accountName = (account: { name: string; nickname: string | null }) => account.nickname ?? account.name
export const accountMask = (account: { name: string; nickname: string | null; mask: string | null }) =>
  account.mask && !accountName(account).includes(account.mask) ? account.mask : null
export const accountLabel = (account: { name: string; nickname: string | null; mask: string | null }) => {
  const mask = accountMask(account)
  return mask ? `${accountName(account)} ••${mask}` : accountName(account)
}
