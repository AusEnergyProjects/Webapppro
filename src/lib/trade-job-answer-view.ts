export type AnswerSignature = {
  id: string; name: string; signedAt: string;
  strokes: readonly { points: readonly { x: number; y: number }[] }[];
};
export type JobAnswerRow = {
  key: string; question: string; answer: string; note?: string;
  signatures?: AnswerSignature[];
};
export type JobAnswerSection = { key: string; title: string; rows: JobAnswerRow[]; emptyMessage?: string };
export type JobAnswerForm = {
  key: string; title: string; source: string; status: string; version?: number;
  recordedAt?: string; sections: JobAnswerSection[]; emptyMessage?: string;
};

export function jobAnswerValue(value: unknown, labels: Readonly<Record<string, string>> = {}, unit = ''): string {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return 'Not answered';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? `${value}${unit ? ` ${unit}` : ''}` : 'Not answered';
  if (typeof value === 'string') return value.trim() ? labels[value] || value : 'Not answered';
  if (Array.isArray(value)) return value.map(item => jobAnswerValue(item, labels, unit)).join('\n');
  return 'Saved answer could not be displayed.';
}
