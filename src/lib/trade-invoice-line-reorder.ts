type IdentifiedInvoiceLine = { id: string };

export function moveInvoiceLine<T extends IdentifiedInvoiceLine>(
  lines: readonly T[],
  lineId: string,
  direction: -1 | 1,
): T[] {
  const fromIndex = lines.findIndex((line) => line.id === lineId);
  const toIndex = fromIndex + direction;
  if (fromIndex < 0 || toIndex < 0 || toIndex >= lines.length) {
    return [...lines];
  }

  const reordered = [...lines];
  const [line] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, line);
  return reordered;
}

export function moveInvoiceLineTo<T extends IdentifiedInvoiceLine>(
  lines: readonly T[],
  lineId: string,
  targetLineId: string,
): T[] {
  if (lineId === targetLineId) return [...lines];
  const fromIndex = lines.findIndex((line) => line.id === lineId);
  const targetIndex = lines.findIndex((line) => line.id === targetLineId);
  if (fromIndex < 0 || targetIndex < 0) {
    return [...lines];
  }

  const reordered = [...lines];
  const [line] = reordered.splice(fromIndex, 1);
  reordered.splice(targetIndex, 0, line);
  return reordered;
}
