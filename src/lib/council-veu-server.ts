import { fetchVeuPublicRegistryEvidence } from "./creditex-veu-product-sources.ts";
import { CREDITEX_VEU_MODEL_ID, validateCreditexVeuPowerBiModel } from "./creditex-veu-product-parser.ts";
import { councilVeuPeriod, councilVeuPostcodes, councilVeuQuery, isCouncilVeuSnapshot, parseCouncilVeuResponse } from "./council-veu.ts";
import type { CouncilVeuPeriodKey, CouncilVeuReport, CouncilVeuSnapshot } from "./council-veu.ts";

type SourceFetch = (url: string, init?: RequestInit) => Promise<Response>;
type EvidenceLoader = typeof fetchVeuPublicRegistryEvidence;
type VeuCache = Pick<Cache, "match" | "put">;
type SavedVeu = { snapshot: CouncilVeuSnapshot; checkedAt: string; refreshFailed: boolean };
export type LoadedCouncilVeu = SavedVeu & { dataOrigin: CouncilVeuReport["source"]["dataOrigin"] };
const RETAIN_SECONDS = 90 * 86400;
const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("VEU source controls changed");
  return Object.fromEntries(Object.entries(value));
};
const array = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw new Error("VEU source controls changed"); return value; };

/** Check the source report's actual approved-activity contract, separately from products. */
export function validateCouncilVeuControls(modelText: string, schemaText: string, requireSectors=false) {
  validateCreditexVeuPowerBiModel(modelText);
  const model = object(JSON.parse(modelText));
  const exploration = object(object(model.exploration).explorationContent);
  if (typeof exploration.explorationDocument !== "string") throw new Error("VEU report definition unavailable");
  const definition = object(JSON.parse(exploration.explorationDocument));
  const pages = array(object(definition.pages).pages).map(object);
  const page = pages.find(item => object(item.content).name === "bd06cbfb601714686762" && object(item.content).displayName === "Activities");
  if (!page) throw new Error("VEU Activities report changed");
  const filters = array(object(object(page.content).filterConfig).filters).map(object);
  const approved = filters.find(item => {
    const field = object(object(item.field).Column);
    return field.Property === "Activity_Status__c" && object(object(field.Expression).SourceRef).Entity === "Fact_Activity";
  });
  const filter = approved ? object(approved.filter) : null;
  const expected = councilVeuQuery(["3805"], councilVeuPeriod("all"));
  const statusCondition = array(object(expected.Query).Where)[0];
  if (!approved || approved.isHiddenInViewMode !== true || approved.isLockedInViewMode !== true || !filter
    || JSON.stringify(filter.From) !== JSON.stringify([{ Name: "f", Entity: "Fact_Activity", Type: 0 }])
    || JSON.stringify(filter.Where) !== JSON.stringify([statusCondition])) throw new Error("VEU approved activity filter changed");
  const tables = array(page.visualContainers).map(item => object(object(item).content)).flatMap(item => {
    const visual = object(item.visual);
    if (!visual.query) return [];
    const state = object(object(visual.query).queryState);
    return state.Values ? [array(object(state.Values).projections).map(object)] : [];
  });
  const expectedRefs = ["Fact_Activity.Activity_Type__c", "Ref_Address.Postcode__c", "Sum(Fact_Activity.VEECs__c)", "CountNonNull(Fact_Activity.Activity_Type__c)"];
  if (!tables.some(projections => JSON.stringify(projections.slice(0, 4).map(item => item.queryRef)) === JSON.stringify(expectedRefs))) throw new Error("VEU activity report measures changed");
  const schemas = array(object(JSON.parse(schemaText)).schemas);
  if (schemas.length !== 1) throw new Error("VEU schema identity changed");
  const result = object(schemas[0]);
  if (result.modelId !== CREDITEX_VEU_MODEL_ID || result.error !== null) throw new Error("VEU schema identity changed");
  const entities = array(object(result.schema).Entities).map(object);
  for (const [entityName, expectedFields] of Object.entries({ Fact_Activity: { Activity_Status__c: 1, Activity_Type__c: 1, Activity_Date__c: 7, VEECs__c: 3, ...(requireSectors ? {Sector__c:1} : {}) }, Ref_Address: { Postcode__c: 1 } })) {
    const entity = entities.find(item => item.Name === entityName);
    if (!entity) throw new Error("VEU activity schema changed");
    const fields = array(entity.Properties).map(object);
    for (const [name, type] of Object.entries(expectedFields)) if (fields.filter(field => field.Name === name && field.DataType === type).length !== 1) throw new Error("VEU activity field changed");
  }
}

export async function fetchCouncilVeuSnapshot(postcodes: string[], key: CouncilVeuPeriodKey, options: { now?: number; fetchImpl?: SourceFetch; loadEvidence?: EvidenceLoader } = {}): Promise<CouncilVeuSnapshot> {
  const now = options.now ?? Date.now(), area = councilVeuPostcodes(postcodes), period = councilVeuPeriod(key, new Date(now));
  const query = councilVeuQuery(area, period);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const sourceFetch: SourceFetch = (url, init) => (options.fetchImpl ?? fetch)(url, { ...init, signal: init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal });
    const evidence = await (options.loadEvidence ?? fetchVeuPublicRegistryEvidence)(sourceFetch, [query]);
    validateCouncilVeuControls(evidence.model, evidence.schema);
    if (evidence.responses.length !== 1) throw new Error("VEU source query count changed");
    const response = evidence.responses[0];
    const values = parseCouncilVeuResponse(response, area);
    if (values.sectorBasis) validateCouncilVeuControls(evidence.model,evidence.schema,true);
    const snapshot: CouncilVeuSnapshot = {
      version: 1, postcodes: area, period, ...values, fetchedAt: new Date(now).toISOString(), sourceRefreshedAt: evidence.sourceRefreshedAt.utc,
      provenance: { responseSha256: await sha256(response), querySha256: await sha256(JSON.stringify(query)), modelSha256: await sha256(evidence.model), schemaSha256: await sha256(evidence.schema) },
    };
    if (!isCouncilVeuSnapshot(snapshot)) throw new Error("Invalid VEU community snapshot");
    return snapshot;
  } finally { clearTimeout(timeout); }
}

export async function runtimeCouncilVeuCache(): Promise<VeuCache | undefined> {
  try { return typeof caches === "undefined" ? undefined : await caches.open("aea-council-veu-v1"); }
  catch { console.warn("Council VEU cache unavailable"); return undefined; }
}

export async function councilVeuBaseline(): Promise<CouncilVeuSnapshot[]> {
  const [legacy,sectors]=await Promise.all([import("./council-veu-baseline.ts"),import("./council-veu-sector-baseline.ts")]);
  return mergeCouncilVeuBaselines([legacy.default,sectors.default]);
}

export function mergeCouncilVeuBaselines(groups: unknown[]): CouncilVeuSnapshot[] {
  const snapshots: CouncilVeuSnapshot[]=[],seen=new Map<string,string>();
  for (const group of groups) {
    if (!Array.isArray(group) || !group.every(isCouncilVeuSnapshot)) throw new Error("Invalid retained VEU baseline");
    for (const snapshot of group) {
      const identity=JSON.stringify([snapshot.postcodes,snapshot.period.key,snapshot.period.startDate,snapshot.period.endDate,snapshot.fetchedAt]);
      const payload=JSON.stringify(snapshot),prior=seen.get(identity);
      if (prior!==undefined && prior!==payload) throw new Error("Conflicting retained VEU snapshot identity");
      if (prior===undefined) {seen.set(identity,payload);snapshots.push(snapshot);}
    }
  }
  return snapshots;
}

export async function loadCouncilVeuSnapshot(postcodes: string[], key: CouncilVeuPeriodKey, options: { now?: number; cache?: VeuCache; baseline?: CouncilVeuSnapshot[]; fetchImpl?: SourceFetch; loadEvidence?: EvidenceLoader } = {}): Promise<LoadedCouncilVeu> {
  const now = options.now ?? Date.now(), area = councilVeuPostcodes(postcodes), period = councilVeuPeriod(key, new Date(now));
  const matches = (snapshot: CouncilVeuSnapshot) => snapshot.period.key === key && snapshot.period.startDate === period.startDate
    && (snapshot.period.endDate === null || (period.endDate !== null && snapshot.period.endDate <= period.endDate))
    && JSON.stringify(snapshot.postcodes) === JSON.stringify(area) && Date.parse(snapshot.fetchedAt) <= now;
  const baseline = (options.baseline ?? await councilVeuBaseline()).filter(isCouncilVeuSnapshot).filter(matches).sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0];
  let saved: SavedVeu | undefined = baseline ? { snapshot: baseline, checkedAt: baseline.fetchedAt, refreshFailed: false } : undefined;
  let dataOrigin: LoadedCouncilVeu["dataOrigin"] = "baseline";
  const keyHash = await sha256(JSON.stringify({ area, key, start: period.startDate }));
  const cacheKey = new Request(`https://council-veu.internal/snapshot-v2-sectors/${keyHash}`);
  if (options.cache) {
    try {
      const response = await options.cache.match(cacheKey);
      const candidate = response ? object(await response.json()) : null;
      if (candidate && isCouncilVeuSnapshot(candidate.snapshot) && matches(candidate.snapshot) && typeof candidate.checkedAt === "string"
        && Number.isFinite(Date.parse(candidate.checkedAt)) && Date.parse(candidate.checkedAt) <= now && Date.parse(candidate.checkedAt) >= Date.parse(candidate.snapshot.fetchedAt)
        && now - Date.parse(candidate.checkedAt) < RETAIN_SECONDS * 1000 && typeof candidate.refreshFailed === "boolean"
        && (!saved || candidate.snapshot.sourceRefreshedAt >= saved.snapshot.sourceRefreshedAt)) {
        saved = { snapshot: candidate.snapshot, checkedAt: candidate.checkedAt, refreshFailed: candidate.refreshFailed }; dataOrigin = "cache";
      }
    } catch { console.warn("Council VEU cache read unavailable"); }
  }
  if (saved && now - Date.parse(saved.checkedAt) < (saved.refreshFailed ? 3600_000 : 86400_000)) return { ...saved, dataOrigin };
  let next: SavedVeu;
  try {
    const snapshot = await fetchCouncilVeuSnapshot(area, key, options);
    if (saved && snapshot.sourceRefreshedAt < saved.snapshot.sourceRefreshedAt) throw new Error("VEU source refresh moved backwards");
    next = { snapshot, checkedAt: new Date(now).toISOString(), refreshFailed: false }; dataOrigin = "live";
  } catch (error) {
    if (!saved) throw error;
    next = { snapshot: saved.snapshot, checkedAt: new Date(now).toISOString(), refreshFailed: true };
  }
  if (options.cache) {
    try { await options.cache.put(cacheKey, Response.json(next, { headers: { "Cache-Control": `public, max-age=${RETAIN_SECONDS}` } })); }
    catch { console.warn("Council VEU cache write unavailable"); }
  }
  return { ...next, dataOrigin };
}
