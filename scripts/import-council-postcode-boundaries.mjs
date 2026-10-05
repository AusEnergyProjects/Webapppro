/** Run: node --experimental-strip-types scripts/import-council-postcode-boundaries.mjs
 * Imports the official ABS 2021 POA layer, already generalised by its ArcGIS service.
 * No postcode geometry is inferred from centroids or from another postcode.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { COUNCIL_POSTCODE_BOUNDARY_SOURCE, parseCouncilPostcodeBoundaries } from "../src/lib/council-postcode-boundaries.ts";

const destination = new URL("../public/data/council-postcode-boundaries/", import.meta.url);
const service = `${COUNCIL_POSTCODE_BOUNDARY_SOURCE.serviceUrl}/query`;
const groups = new Map();
const responses = [];
const omittedNonSpatialCodes = [];
await mkdir(destination, { recursive: true });

for (let digit = 0; digit <= 9; digit++) {
  const where = `poa_code_2021 LIKE '${digit}%'`;
  const countUrl = new URL(service);
  countUrl.search = new URLSearchParams({ where, returnCountOnly: "true", f: "json" });
  const countResponse = await fetch(countUrl);
  const count = await countResponse.json();
  if (!countResponse.ok || !Number.isInteger(count.count) || count.count > 2000) throw new Error(`Invalid ABS source count for ${digit}`);
  const url = new URL(service);
  url.search = new URLSearchParams({ where, outFields: "poa_code_2021", returnGeometry: "true", outSR: "4326", maxAllowableOffset: String(COUNCIL_POSTCODE_BOUNDARY_SOURCE.simplificationDegrees), geometryPrecision: "5", f: "geojson" });
  const response = await fetch(url);
  const text = await response.text();
  const body = JSON.parse(text);
  if (!response.ok || body.type !== "FeatureCollection" || !Array.isArray(body.features) || body.exceededTransferLimit || body.properties?.exceededTransferLimit || body.features.length !== count.count) throw new Error(`Incomplete ABS source for ${digit}`);
  const rawFeatures = body.features.filter(feature => {
    if (feature.geometry !== null) return true;
    omittedNonSpatialCodes.push(feature.properties.poa_code_2021);
    return false;
  }).map(feature => ({ ...feature, properties: { postcode: feature.properties.poa_code_2021 } }));
  const features = parseCouncilPostcodeBoundaries({ type: "FeatureCollection", features: rawFeatures });
  for (const feature of features) {
    const prefix = feature.properties.postcode.slice(0, 2);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(feature);
  }
  responses.push({ prefix: String(digit), url: url.href, sourceFeatures: count.count, spatialFeatures: features.length, sha256: createHash("sha256").update(text).digest("hex") });
  console.log(`ABS prefix ${digit}: ${features.length} spatial areas`);
}

const files = [];
for (const [prefix, features] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  features.sort((a, b) => a.properties.postcode.localeCompare(b.properties.postcode));
  const file = `abs-2021-${prefix}.json`;
  const data = JSON.stringify({ type: "FeatureCollection", features });
  await writeFile(new URL(file, destination), data + "\n");
  files.push({ file, features: features.length, bytes: Buffer.byteLength(data + "\n"), sha256: createHash("sha256").update(data + "\n").digest("hex") });
}
const manifest = {
  ...COUNCIL_POSTCODE_BOUNDARY_SOURCE,
  retrievedAt: new Date().toISOString(),
  coordinateReferenceSystem: "WGS84 longitude, latitude (EPSG:4326)",
  transformation: "ABS ArcGIS maxAllowableOffset 0.00025 degrees (at most about 28 metres at the equator), rounded to 5 decimal places. Rings and polygon holes retained. Partitioned by first two postcode digits.",
  spatialFeatures: files.reduce((total, file) => total + file.features, 0),
  omittedNonSpatialCodes,
  responses,
  files,
};
await writeFile(new URL("manifest.json", destination), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ files: files.length, areas: manifest.spatialFeatures, bytes: files.reduce((total, file) => total + file.bytes, 0) }));
