export type TradeRebateEstimateDraft = Readonly<{
  programCode: string;
  activityCode: string;
  activityTitle: string;
  quantity: string;
  unit: string;
  customerDiscountDollars: string;
  createdAt: string;
}>;

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_PREFIX = "tlink-rebate-estimate-v1";
const MAXIMUM_DRAFT_AGE_MS = 24 * 60 * 60 * 1_000;

function clean(value: unknown, maximum: number) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function storageKey(ownerUid: string) {
  const uid = clean(ownerUid, 180);
  return uid ? `${STORAGE_PREFIX}:${uid}` : "";
}

function discount(value: unknown) {
  const text = clean(value, 24);
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) return "";
  const number = Number(text);
  return Number.isFinite(number) && number > 0 && number <= 1_000_000
    ? number.toFixed(2)
    : "";
}

export function normaliseTradeRebateEstimateDraft(
  value: unknown,
): TradeRebateEstimateDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const programCode = clean(record.programCode, 80);
  const activityCode = clean(record.activityCode, 80);
  const activityTitle = clean(record.activityTitle, 180);
  const quantity = clean(record.quantity, 40);
  const unit = clean(record.unit, 20);
  const customerDiscountDollars = discount(record.customerDiscountDollars);
  const createdAt = clean(record.createdAt, 40);
  if (
    !programCode
    || !activityCode
    || !activityTitle
    || !quantity
    || !unit
    || !customerDiscountDollars
    || !/^\d{4}-\d{2}-\d{2}T/.test(createdAt)
  ) return null;
  return {
    programCode,
    activityCode,
    activityTitle,
    quantity,
    unit,
    customerDiscountDollars,
    createdAt,
  };
}

export function saveTradeRebateEstimateDraft(
  storage: SessionStore,
  ownerUid: string,
  input: Omit<TradeRebateEstimateDraft, "createdAt">,
) {
  const key = storageKey(ownerUid);
  if (!key) return null;
  const draft = normaliseTradeRebateEstimateDraft({
    ...input,
    createdAt: new Date().toISOString(),
  });
  if (!draft) return null;
  storage.setItem(key, JSON.stringify(draft));
  return draft;
}

export function loadTradeRebateEstimateDraft(
  storage: SessionStore,
  ownerUid: string,
) {
  const key = storageKey(ownerUid);
  if (!key) return null;
  try {
    const draft = normaliseTradeRebateEstimateDraft(
      JSON.parse(storage.getItem(key) || "null"),
    );
    const createdAt = draft ? Date.parse(draft.createdAt) : Number.NaN;
    if (
      !draft
      || !Number.isFinite(createdAt)
      || createdAt > Date.now() + 60_000
      || Date.now() - createdAt > MAXIMUM_DRAFT_AGE_MS
    ) {
      storage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function clearTradeRebateEstimateDraft(
  storage: SessionStore,
  ownerUid: string,
) {
  const key = storageKey(ownerUid);
  if (key) storage.removeItem(key);
}
