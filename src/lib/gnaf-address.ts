/** Exact Australian address matching. No fuzzy match or paid-provider fallback. */
const WORDS: Readonly<Record<string, string>> = {
  RD: "ROAD", ST: "STREET", AV: "AVENUE", AVE: "AVENUE", CT: "COURT", CRES: "CRESCENT",
  DR: "DRIVE", PL: "PLACE", GR: "GROVE", PDE: "PARADE", TCE: "TERRACE", HWY: "HIGHWAY",
  CCT: "CIRCUIT", CIR: "CIRCLE", CL: "CLOSE", BLVD: "BOULEVARD", BVD: "BOULEVARD",
  LN: "LANE", ESP: "ESPLANADE", SQ: "SQUARE", WAY: "WAY", PKWY: "PARKWAY",
  APT: "UNIT", APARTMENT: "UNIT", FLAT: "UNIT", U: "UNIT", VILLA: "UNIT", TOWNHOUSE: "UNIT",
};
const STATES: Readonly<Record<string, string>> = { "NEW SOUTH WALES": "NSW", VICTORIA: "VIC", QUEENSLAND: "QLD", "SOUTH AUSTRALIA": "SA", "WESTERN AUSTRALIA": "WA", TASMANIA: "TAS", "NORTHERN TERRITORY": "NT", "AUSTRALIAN CAPITAL TERRITORY": "ACT" };

export function gnafAddressKey(address: string): string | null {
  if (typeof address !== "string" || address.length > 1000 || /[<>@\u0000-\u001f]/.test(address)) return null;
  let value = address.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim().replace(/\bAUSTRALIA\s*$/, "").trim();
  // CRM line 2 may contain an explicit unit after the street. Reorder that
  // comma-delimited component without ever discarding a unit or building name.
  value = value.replace(/^([^,]+),\s*((?:UNIT|FLAT|APARTMENT|APT|U|VILLA|TOWNHOUSE)\s+[A-Z]?\d+[A-Z]?)\s*,\s*(.+)$/, "$2 $1, $3")
    .replace(/[.,'’]/g, " ").replace(/\s+/g, " ").trim();
  value = value.replace(/\b(NEW SOUTH WALES|VICTORIA|QUEENSLAND|SOUTH AUSTRALIA|WESTERN AUSTRALIA|TASMANIA|NORTHERN TERRITORY|AUSTRALIAN CAPITAL TERRITORY) (\d{3,4})$/, (_, state: string, postcode: string) => `${STATES[state]} ${postcode}`)
    .replace(/\bNT (\d{3})$/, "NT 0$1");
  if (/\b(?:WITHHELD|REDACTED|PO BOX|P O BOX|LOCKED BAG)\b/.test(value)) return null;
  value = value.replace(/^(?:UNIT\s*)?([A-Z]?\d+[A-Z]?)\s*\/\s*(\d)/, "UNIT $1 $2")
    .replace(/\s*-\s*/g, "-").replace(/\b[A-Z]+\b/g, word => WORDS[word] || word)
    .replace(/\s+/g, " ").trim();
  if (!/\b(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT|OT) \d{4}$/.test(value) || !/\d/.test(value)) return null;
  return value;
}

/** Stable across the offline builder and Worker; postcode shards bound memory. */
export function gnafShardForKey(key: string): string {
  const postcode = key.match(/ (\d{4})$/)?.[1];
  if (!postcode) throw new Error("G-NAF key is missing a postcode.");
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
  return `${postcode}/${(hash & 3).toString(16)}.json.gz`;
}

export type GnafEntry = [lat: number, lng: number, sourceId: string, geocodeType: string] | null;
export type GnafShard = { schema: 1; version: string; postcode: string; bucket: string; entries: Record<string, GnafEntry> };
export type GnafShardMetadata = { sha256: string; bytes: number; decodedBytes: number; entries: number };
export type GnafManifest = {
  schema: 1; version: string; sourceUrl: string; sourceSha256: string; attribution: string; datum: string;
  createdAt: string; recordCount: number; shards: Record<string, GnafShardMetadata>;
};
export const GNAF_ATTRIBUTION = "Incorporates adapted G-NAF © Geoscape Australia, licensed by the Commonwealth of Australia under the Open G-NAF End User Licence Agreement. Address matching and display adapted by TLink. Provided without warranty.";
export const GNAF_LICENCE_URL = "https://data.gov.au/data/dataset/19432f89-dc3a-4ef3-b943-5326ef1dbecc/resource/09f74802-08b1-4214-a6ea-3591b2753d30/download/20160226-eula-open-g-naf.pdf";
