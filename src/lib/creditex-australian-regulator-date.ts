const AUSTRALIAN_REGULATOR_TIME_ZONE = "Australia/Sydney";

const regulatorDateFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: AUSTRALIAN_REGULATOR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const regulatorClockFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: AUSTRALIAN_REGULATOR_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function regulatorInstant(value: Date | string | number) {
  return value instanceof Date ? value : new Date(value);
}

export function australianRegulatorDate(value: Date | string) {
  const date = regulatorInstant(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Australian regulator date requires a valid instant.");
  }
  const parts = new Map(
    regulatorDateFormatter.formatToParts(date).map((part) => [
      part.type,
      part.value,
    ]),
  );
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  if (!year || !month || !day) {
    throw new Error("Australian regulator date could not be resolved.");
  }
  return `${year}-${month}-${day}`;
}

export function matchesAustralianRegulatorClock(
  value: Date | string | number,
  hour: number,
  minute: number,
) {
  if (
    !Number.isInteger(hour)
    || hour < 0
    || hour > 23
    || !Number.isInteger(minute)
    || minute < 0
    || minute > 59
  ) {
    return false;
  }
  const date = regulatorInstant(value);
  if (Number.isNaN(date.getTime())) return false;
  const parts = new Map(
    regulatorClockFormatter.formatToParts(date).map((part) => [
      part.type,
      part.value,
    ]),
  );
  return Number(parts.get("hour")) === hour
    && Number(parts.get("minute")) === minute;
}
