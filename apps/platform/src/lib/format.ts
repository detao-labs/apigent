// ═══════════════════════════════════════════════════════════════════
// Platform Format Helpers — relative time etc.
// ═══════════════════════════════════════════════════════════════════

const DIVISIONS: { amount: number; name: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, name: "seconds" },
  { amount: 60, name: "minutes" },
  { amount: 24, name: "hours" },
  { amount: 7, name: "days" },
  { amount: 4.34524, name: "weeks" },
  { amount: 12, name: "months" },
  { amount: Number.POSITIVE_INFINITY, name: "years" },
];

export function formatRelativeTime(
  date: Date | string,
  locale: string,
): string {
  const value = typeof date === "string" ? new Date(date) : date;
  const rtf = new Intl.RelativeTimeFormat(
    locale === "en" ? "en" : "zh-CN",
    { numeric: "auto" },
  );

  let seconds = (value.getTime() - Date.now()) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(seconds) < division.amount) {
      return rtf.format(Math.round(seconds), division.name);
    }
    seconds /= division.amount;
  }
  return rtf.format(Math.round(seconds), "years");
}
