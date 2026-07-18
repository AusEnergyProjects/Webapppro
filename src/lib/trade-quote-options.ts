export type QuoteChoiceKind = "package" | "addon" | "choose_one";

export type QuoteChoiceInput = {
  clientKey: string;
  kind: QuoteChoiceKind;
  groupKey: string;
  name: string;
  summary: string;
  recommended: boolean;
  lines: unknown[];
};

export type QuoteChoiceTotals = {
  id: string;
  kind: QuoteChoiceKind;
  groupKey: string;
  name: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

const KINDS = new Set<QuoteChoiceKind>(["package", "addon", "choose_one"]);
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_TOTAL_CENTS = 100_000_000;

export function normaliseQuoteChoices(raw: unknown, clean: (value: unknown, maxLength?: number) => string): QuoteChoiceInput[] {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 20) throw new Error("INVALID_QUOTE_CHOICES");
  const seenKeys = new Set<string>();
  const choices = raw.map((value) => {
    if (!value || typeof value !== "object") throw new Error("INVALID_QUOTE_CHOICES");
    const row = value as Record<string, unknown>;
    const clientKey = clean(row.clientKey, 64).toLowerCase();
    const kind = clean(row.kind, 20) as QuoteChoiceKind;
    const fallbackGroup = kind === "addon" ? clientKey : `${kind}-1`;
    const groupKey = clean(row.groupKey, 64).toLowerCase() || fallbackGroup;
    const name = clean(row.name, 120);
    const summary = clean(row.summary, 500);
    const lines = Array.isArray(row.lines) ? row.lines : [];
    if (!KEY_PATTERN.test(clientKey) || !KEY_PATTERN.test(groupKey) || seenKeys.has(clientKey) || !KINDS.has(kind) || !name || lines.length < 1 || lines.length > 100) {
      throw new Error("INVALID_QUOTE_CHOICES");
    }
    seenKeys.add(clientKey);
    return { clientKey, kind, groupKey, name, summary, recommended: row.recommended === true, lines };
  });
  const grouped = new Map<string, QuoteChoiceInput[]>();
  for (const choice of choices.filter((item) => item.kind !== "addon")) {
    const key = `${choice.kind}:${choice.groupKey}`;
    grouped.set(key, [...(grouped.get(key) || []), choice]);
  }
  for (const [key, group] of grouped) {
    const packageGroup = key.startsWith("package:");
    if (group.length < 2 || (packageGroup && group.length > 3) || group.filter((item) => item.recommended).length > 1) {
      throw new Error("INVALID_QUOTE_CHOICES");
    }
  }
  return choices;
}

export function calculateQuoteSelection(
  base: { subtotalCents: number; taxCents: number; totalCents: number },
  choices: QuoteChoiceTotals[],
  rawSelectedIds: unknown,
) {
  if (!Array.isArray(rawSelectedIds)) throw new Error("INVALID_QUOTE_SELECTION");
  const selectedIds = rawSelectedIds.map(String);
  if (new Set(selectedIds).size !== selectedIds.length) throw new Error("INVALID_QUOTE_SELECTION");
  const byId = new Map(choices.map((choice) => [choice.id, choice]));
  const selected = selectedIds.map((id) => byId.get(id));
  if (selected.some((choice) => !choice)) throw new Error("INVALID_QUOTE_SELECTION");
  const requiredGroups = new Map<string, QuoteChoiceTotals[]>();
  for (const choice of choices.filter((item) => item.kind !== "addon")) {
    const key = `${choice.kind}:${choice.groupKey}`;
    requiredGroups.set(key, [...(requiredGroups.get(key) || []), choice]);
  }
  for (const group of requiredGroups.values()) {
    if (group.filter((choice) => selectedIds.includes(choice.id)).length !== 1) throw new Error("INVALID_QUOTE_SELECTION");
  }
  const selectedChoices = selected as QuoteChoiceTotals[];
  const subtotalCents = base.subtotalCents + selectedChoices.reduce((sum, item) => sum + item.subtotalCents, 0);
  const taxCents = base.taxCents + selectedChoices.reduce((sum, item) => sum + item.taxCents, 0);
  const totalCents = base.totalCents + selectedChoices.reduce((sum, item) => sum + item.totalCents, 0);
  if (![subtotalCents, taxCents, totalCents].every(Number.isSafeInteger) || totalCents <= 0 || totalCents > MAX_TOTAL_CENTS) {
    throw new Error("INVALID_QUOTE_SELECTION");
  }
  return { selectedIds, selectedChoices, subtotalCents, taxCents, totalCents, selectionSummary: selectedChoices.map((item) => item.name).join(" | ") };
}
