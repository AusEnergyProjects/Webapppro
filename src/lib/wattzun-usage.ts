import { isWattzunPortal, WattzunInputError, type WattzunPortal } from './wattzun-portal';

export type WattzunUsageKind = 'text' | 'voice';
export type WattzunUsage = {
  portal: WattzunPortal; scopeId: string; month: string; monthBasis: 'UTC'; audience: 'personal';
  textMessages: number; voiceExchanges: number;
};
export function parseWattzunUsageScope(url: URL): { portal: WattzunPortal; scopeId: string } {
  const portal = url.searchParams.get('portal'), scopeId = url.searchParams.get('scopeId');
  if (!isWattzunPortal(portal) || typeof scopeId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(scopeId)
    || url.searchParams.getAll('portal').length !== 1 || url.searchParams.getAll('scopeId').length !== 1
    || [...url.searchParams.keys()].some(key => key !== 'portal' && key !== 'scopeId')) {
    throw new WattzunInputError('Choose your workspace to view your Wattzun usage.');
  }
  return { portal, scopeId };
}
export function wattzunUsagePeriod(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error('WATTZUN_USAGE_DATE');
  const start = new Date(now); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  return { month: start.toISOString().slice(0, 7), startsAt: start.toISOString(), endsAt: end.toISOString() };
}
