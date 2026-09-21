const timeZone = "Australia/Sydney";
const dateFormatter = new Intl.DateTimeFormat("en-AU", { timeZone, day: "numeric", month: "short", year: "numeric" });
const clockFormatter = new Intl.DateTimeFormat("en-AU", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

export function jobCreationDate(value: string) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? dateFormatter.format(date) : "Not recorded";
}

/** Convert an Australian calendar-day boundary to UTC, including daylight saving. */
export function jobCreationDayStart(day: string, nextDay = false) {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== day) throw new Error("Choose a valid creation date.");
  const target = parsed + (nextDay ? 86_400_000 : 0);
  let instant = target;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = Object.fromEntries(clockFormatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant += target - local;
  }
  return new Date(instant).toISOString();
}
