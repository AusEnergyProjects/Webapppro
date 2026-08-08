const AUSTRALIAN_REGULATOR_TIME_ZONE = "Australia/Sydney";

const regulatorDateFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: AUSTRALIAN_REGULATOR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function australianRegulatorDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
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
