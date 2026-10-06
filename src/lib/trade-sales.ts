export type SalesStatus = 'open' | 'won' | 'lost';
export type SalesStage = { id: string; name: string };
export type SalesSettings = { revision: number; stages: SalesStage[] };
export type SalesPermissions = { canManage: boolean; canViewValues: boolean; canEditValues: boolean; canConfigure: boolean };
export type SalesOwner = { id: string; name: string };
export type SalesItem = {
  id: string; workNumber: string; title: string; customerName: string; customerProtected: boolean; serviceCategory: string;
  stageId: string; stageName: string; status: SalesStatus; ownerMemberId: string; ownerName: string;
  estimatedValueCents: number | null; expectedCloseOn: string; lastContactOn: string; nextAction: string; nextActionOn: string;
  revision: number; jobRevision: number; canEdit: boolean; canEditValue: boolean;
};
export type SalesConfig = { settings: SalesSettings; owners: SalesOwner[]; permissions: SalesPermissions };
export type SalesList = { items: SalesItem[]; stages: Array<SalesStage & { count: number }>; total: number; pageSize: number; hasNext: boolean; nextCursor: string };
export type SalesUpdate = {
  action: 'update'; workOrderId: string; expectedRevision: number; expectedJobRevision: number;
  stageId?: string; ownerMemberId?: string; estimatedValueCents?: number; expectedCloseOn?: string;
  lastContactOn?: string; nextAction?: string; nextActionOn?: string;
};
export type SalesStageUpdate = { action: 'save_stages'; expectedRevision: number; stages: SalesStage[] };
export const DEFAULT_SALES_STAGES: readonly SalesStage[] = [
  { id: 'enquiry', name: 'New' }, { id: 'qualifying', name: 'Checking' }, { id: 'quoting', name: 'Quoting' },
];
export const SALES_STAGE_LIMIT = 12;
export class SalesError extends Error {
  readonly status: number; readonly code: string;
  constructor(message: string, status = 400, code = 'SALES_INPUT_INVALID') { super(message); this.status = status; this.code = code; }
}
export function salesText(value: unknown, maximum: number, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new SalesError('Check the sales details.');
  const text = value.trim();
  if (required && !text) throw new SalesError('Add the required sales details.');
  return text;
}
export function salesDay(value: unknown): string {
  const day = salesText(value, 10);
  if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)) throw new SalesError('Choose a valid calendar date.');
  return day;
}
export function salesContactDay(value: unknown, today: string): string {
  const day = salesDay(value);
  if (day > today) throw new SalesError('Recorded contact cannot be in the future.');
  return day;
}
export function salesStages(value: unknown): SalesStage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > SALES_STAGE_LIMIT) throw new SalesError(`Keep between 1 and ${SALES_STAGE_LIMIT} open sales stages.`);
  const ids = new Set<string>(); const names = new Set<string>();
  return value.map((input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !('id' in input) || !('name' in input)) throw new SalesError('Check the sales stages.');
    const id = salesText(input.id, 80, true), name = salesText(input.name, 60, true);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ['won', 'lost'].includes(id) || ['won', 'lost'].includes(name.toLowerCase()) || ids.has(id) || names.has(name.toLowerCase())) throw new SalesError('Sales stages need unique names and identifiers. Won and Lost are recorded outcomes.');
    ids.add(id); names.add(name.toLowerCase()); return { id, name };
  });
}
export function salesRevision(value: unknown, allowZero = true): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new SalesError('Refresh the sales record before saving.', 409, 'REVISION_CONFLICT');
  return value;
}
