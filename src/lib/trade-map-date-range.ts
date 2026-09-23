const localDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

export function defaultTradeMapDateRange(now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  const lastDayNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0).getDate();
  const to = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(now.getDate(), lastDayNextMonth));
  return { from: localDate(from), to: localDate(to) };
}
