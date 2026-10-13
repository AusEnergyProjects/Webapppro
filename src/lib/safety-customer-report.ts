export type SafetyCustomerReport = {
  kind: 'piesa' | 'electrical' | 'gas'; recordNumber: string; title: string;
  propertyAddress: string; inspectionDate: string; completedAt: string; inspectorName: string;
  business: { name: string; email: string; phone: string; logoUrl?: string };
  outcome?: { label: string; attention: 'normal' | 'follow_up' | 'urgent' };
  sections: { title: string; items: { label: string; value: string }[] }[];
  signatures: { name: string; title: string; signedAt: string }[];
  evidence: { id: string; label: string; fileName: string; contentType: string; url: string }[];
  pdfUrl: string;
};
export type SafetyCustomerReportResponse = { ok: true; report: SafetyCustomerReport } | { ok: false; error: string };

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 10_000;

/** Private images stay on the capability endpoint and bypass shared image/CDN
 * optimisers. A changed token or external URL must not be rendered by this page.
 */
function privateUrl(value: unknown, token: string, view: string, evidenceId?: string) {
  if (!text(value) || !value.startsWith('/api/trade-safety-check-report?')) return false;
  try {
    const url = new URL(value, 'https://tlink.example');
    return url.origin === 'https://tlink.example' && url.pathname === '/api/trade-safety-check-report'
      && url.searchParams.get('token') === token && url.searchParams.get('view') === view
      && (evidenceId === undefined || url.searchParams.get('evidenceId') === evidenceId);
  } catch { return false; }
}

export function isSafetyCustomerReport(value: unknown, token: string): value is SafetyCustomerReport {
  if (!object(value) || !['piesa', 'electrical', 'gas'].includes(String(value.kind))
    || !['recordNumber', 'title', 'propertyAddress', 'inspectionDate', 'completedAt', 'inspectorName'].every(key => text(value[key]))
    || !privateUrl(value.pdfUrl, token, 'pdf')) return false;
  const business = value.business;
  if (!object(business) || !['name', 'email', 'phone'].every(key => text(business[key]))
    || business.logoUrl !== undefined && !privateUrl(business.logoUrl, token, 'brand-logo')) return false;
  if (value.outcome !== undefined && (!object(value.outcome) || !text(value.outcome.label)
    || !['normal', 'follow_up', 'urgent'].includes(String(value.outcome.attention)))) return false;
  if (!Array.isArray(value.sections) || value.sections.length > 200 || !value.sections.every(section => object(section) && text(section.title)
    && Array.isArray(section.items) && section.items.length <= 400 && section.items.every(item => object(item) && text(item.label) && text(item.value)))) return false;
  if (!Array.isArray(value.signatures) || value.signatures.length > 32 || !value.signatures.every(signature => object(signature)
    && ['name', 'title', 'signedAt'].every(key => text(signature[key])))) return false;
  return Array.isArray(value.evidence) && value.evidence.length <= 64 && value.evidence.every(item => object(item)
    && ['id', 'label', 'fileName', 'contentType'].every(key => text(item[key]))
    && ['image/png', 'image/jpeg', 'application/pdf'].includes(String(item.contentType))
    && privateUrl(item.url, token, 'evidence', String(item.id)));
}

export function safetyReportDate(value: string) {
  if (!value) return '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value), date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium', timeZone: dateOnly ? 'UTC' : 'Australia/Melbourne',
  }).format(date) : value;
}

/** Highlights repeat the inspector's recorded answers without deriving a pass
 * or replacing the detailed findings and conditions in the official record.
 */
export function safetyReportHighlights(report: SafetyCustomerReport) {
  return report.sections.flatMap(section => section.items.filter(item => item.value.trim()
    && /observations|recommendations|identified faults|remedial action|limitations|next .*(?:check|inspection).*due/i.test(item.label)));
}
