export type SurgeCustomerOfficialCitation = {
  id: string;
  title: string;
  publisher: string;
  url: string;
};

const REVIEWED_PUBLIC_HOSTS = new Set([
  "abcb.gov.au",
  "accc.gov.au",
  "act.gov.au",
  "aer.gov.au",
  "aemo.com.au",
  "asbestossafety.gov.au",
  "cbos.tas.gov.au",
  "cbs.sa.gov.au",
  "cer.gov.au",
  "climatechoices.act.gov.au",
  "consumer.vic.gov.au",
  "consumerprotection.wa.gov.au",
  "cpd.abcb.gov.au",
  "csiro.au",
  "dcceew.gov.au",
  "economicregulator.tas.gov.au",
  "education.vic.gov.au",
  "energy.gov.au",
  "energy.nsw.gov.au",
  "energy.vic.gov.au",
  "energymadeeasy.gov.au",
  "energyrating.gov.au",
  "energysafe.vic.gov.au",
  "energysustainabilityschemes.nsw.gov.au",
  "erawa.com.au",
  "esc.vic.gov.au",
  "escosa.sa.gov.au",
  "fire.nsw.gov.au",
  "greenvehicleguide.gov.au",
  "healthdirect.gov.au",
  "homeenergyrating.gov.au",
  "ipart.nsw.gov.au",
  "moneysmart.gov.au",
  "ncc.abcb.gov.au",
  "nsw.gov.au",
  "nt.gov.au",
  "productsafety.gov.au",
  "qca.org.au",
  "qld.gov.au",
  "recfit.tas.gov.au",
  "reg.energyrating.gov.au",
  "rta.qld.gov.au",
  "sa.gov.au",
  "service.vic.gov.au",
  "solar.vic.gov.au",
  "standards.org.au",
  "tas.gov.au",
  "wa.gov.au",
  "www2.education.vic.gov.au",
  "yourhome.gov.au",
]);

const FORBIDDEN_URL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\\]/u;
const FORBIDDEN_TEXT_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isPublicOfficialHostname(hostname: string) {
  const reviewedHostname = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  return REVIEWED_PUBLIC_HOSTS.has(reviewedHostname);
}

export function sanitizeSurgeCustomerOfficialUrl(value: unknown) {
  if (
    typeof value !== "string"
    || !value
    || value.length > 1_000
    || FORBIDDEN_URL_CHARACTERS.test(value)
  ) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!isPublicOfficialHostname(hostname)) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(?:fbclid|gclid)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    if ([...url.searchParams.keys()].length) return null;
    url.hostname = hostname;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function sanitizeSurgeCustomerOfficialCitation(
  value: unknown,
  index = 0,
): SurgeCustomerOfficialCitation | null {
  const source = record(value);
  if (!source || source.stale === true) return null;
  if (source.sourceTier !== undefined && source.sourceTier !== "primary_official") return null;
  const url = sanitizeSurgeCustomerOfficialUrl(source.url);
  const title = typeof source.title === "string"
    ? source.title
      .replace(FORBIDDEN_TEXT_CHARACTERS, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 260)
    : "";
  if (!url || !title) return null;
  const hostname = new URL(url).hostname.toLowerCase();
  return {
    id: "official-source-" + (index + 1),
    title,
    publisher: hostname,
    url,
  };
}
