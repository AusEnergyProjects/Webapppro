/** A complete installed price, entered in dollars with at most two decimal places. */
export function parseInstalledQuote(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  const cents = amount * 100;
  if (!Number.isSafeInteger(Math.round(cents)) || amount < 0.01 || Math.abs(cents - Math.round(cents)) > 0.000001) return null;
  return Math.round(cents) / 100;
}
