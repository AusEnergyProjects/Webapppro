export const CUSTOMER_REGISTER_FILTER_VERSION = 1;

const datePartsInSydney = (value: Date) => {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value || 0);
  return { year: part("year"), month: part("month"), day: part("day") };
};

const calendarDate = (year: number, month: number, day: number) => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
};

export function defaultCustomerCreatedRange(now = new Date()) {
  const { year, month, day } = datePartsInSydney(now);
  return {
    from: calendarDate(year - 1, month, day),
    to: calendarDate(year, month, day),
  };
}
