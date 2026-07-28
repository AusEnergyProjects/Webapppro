const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19] as const;

export function normalizeAbn(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

export function isValidAbn(value: unknown) {
  const abn = normalizeAbn(value);
  if (!/^\d{11}$/.test(abn)) return false;
  const total = abn.split("").reduce(
    (sum, digit, index) =>
      sum + (Number(digit) - (index === 0 ? 1 : 0)) * ABN_WEIGHTS[index],
    0,
  );
  return total % 89 === 0;
}

export function officialAbnLookupUrl(value: unknown) {
  const abn = normalizeAbn(value);
  if (!isValidAbn(abn)) return "";
  return `https://abr.business.gov.au/ABN/View?abn=${encodeURIComponent(abn)}`;
}
