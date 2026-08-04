function cents(value) {
  const number = Math.round(Number(value) || 0);
  return Math.max(0, number);
}

export function tradeQuoteDocumentDisplayTotals(snapshot) {
  const choices = Array.isArray(snapshot?.choices) ? snapshot.choices : [];
  const selected = new Map();
  for (const choice of choices.filter((item) => item?.kind !== "addon")) {
    const key = `${String(choice.kind || "")}:${String(choice.groupKey || "")}`;
    const current = selected.get(key);
    if (!current || choice.recommended) selected.set(key, choice);
  }
  const requiredChoices = [...selected.values()];
  return {
    selectedChoiceIds: requiredChoices.map((choice) => String(choice.id || "")),
    subtotalCents:
      cents(snapshot?.subtotalCents)
      + requiredChoices.reduce(
        (sum, choice) => sum + cents(choice.subtotalCents),
        0,
      ),
    taxCents:
      cents(snapshot?.taxCents)
      + requiredChoices.reduce(
        (sum, choice) => sum + cents(choice.taxCents),
        0,
      ),
    totalCents:
      cents(snapshot?.totalCents)
      + requiredChoices.reduce(
        (sum, choice) => sum + cents(choice.totalCents),
        0,
      ),
    label:
      requiredChoices.length > 0
        ? "Included plus recommended choices"
        : choices.some((choice) => choice?.kind === "addon")
          ? "Included total before optional extras"
          : "Quote total",
    hasChoices: choices.length > 0,
    hasRequiredChoices: requiredChoices.length > 0,
  };
}
