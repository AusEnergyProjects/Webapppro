const DAY_MS = 86_400_000;

export type CalendarDay = {
  iso: string;
  day: number;
  inCurrentMonth: boolean;
  disabled: boolean;
};

export function parseIsoDate(value: string | undefined): Date | null {
  const datePart = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const [year, month, day] = datePart.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

export function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function addIsoDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  return date ? isoDate(new Date(date.getTime() + days * DAY_MS)) : value;
}

export function buildCalendarMonth(year: number, month: number, min?: string, max?: string): CalendarDay[] {
  const first = new Date(Date.UTC(year, month, 1));
  const gridStart = new Date(first.getTime() - first.getUTCDay() * DAY_MS);
  const minDate = parseIsoDate(min);
  const maxDate = parseIsoDate(max);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getTime() + index * DAY_MS);
    const iso = isoDate(date);
    return {
      iso,
      day: date.getUTCDate(),
      inCurrentMonth: date.getUTCMonth() === month,
      disabled: Boolean((minDate && date < minDate) || (maxDate && date > maxDate)),
    };
  });
}

export function formatDateForDisplay(value: string, includeTime = false): string {
  const date = parseIsoDate(value);
  if (!date) return "";
  const label = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  if (!includeTime) return label;
  const time = value.includes("T") ? value.split("T")[1]?.slice(0, 5) : "";
  if (!/^\d{2}:\d{2}$/.test(time)) return label;
  const [hour, minute] = time.split(":").map(Number);
  const timeLabel = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hour, minute));
  return `${label}, ${timeLabel}`;
}

export function monthHeading(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month, 1)));
}

export function fullDateLabel(value: string): string {
  const date = parseIsoDate(value);
  return date
    ? new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date)
    : value;
}

export function isIsoWithinRange(value: string, start: string, end: string): boolean {
  return Boolean(value && start && end && value >= start && value <= end);
}
