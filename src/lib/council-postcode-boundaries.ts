/** ABS Postal Areas approximate postcode geography; they are not delivery boundaries. */
export const COUNCIL_POSTCODE_BOUNDARY_SOURCE = {
  name: "Australian Bureau of Statistics, Postal Areas 2021",
  url: "https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-3-july-2021-june-2026/non-abs-structures/postal-areas",
  serviceUrl: "https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/POA/MapServer/0",
  attribution: "Postal areas: Australian Bureau of Statistics, 2021, CC BY 4.0. Boundaries simplified for display.",
  licence: "https://creativecommons.org/licenses/by/4.0/",
  note: "ABS 2021 Postal Areas approximate postcodes for statistical purposes. They may differ from current Australia Post delivery areas.",
  simplificationDegrees: 0.00025,
} as const;

export type CouncilBoundaryPosition = { lat: number; lng: number };
export type CouncilBoundaryCoordinate = [number, number];
export type CouncilBoundaryPolygon = CouncilBoundaryCoordinate[][];
export type CouncilPostcodeBoundary = {
  type: "Feature";
  properties: { postcode: string };
  geometry: { type: "Polygon"; coordinates: CouncilBoundaryPolygon } | { type: "MultiPolygon"; coordinates: CouncilBoundaryPolygon[] };
  bbox: [number, number, number, number];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ring(value: unknown): CouncilBoundaryCoordinate[] {
  if (!Array.isArray(value) || value.length < 4) throw new Error("Invalid postal area ring");
  const points = value.map((point): CouncilBoundaryCoordinate => {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(coordinate => typeof coordinate === "number" && Number.isFinite(coordinate))
      || point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) throw new Error("Invalid postal area coordinate");
    return [point[0], point[1]];
  });
  if (points[0][0] !== points[points.length - 1][0] || points[0][1] !== points[points.length - 1][1]) throw new Error("Postal area ring is not closed");
  return points;
}

function polygon(value: unknown): CouncilBoundaryPolygon {
  if (!Array.isArray(value) || !value.length) throw new Error("Invalid postal area polygon");
  return value.map(ring);
}

/** Validate bundled GeoJSON before using coordinates in a map or hit test. */
export function parseCouncilPostcodeBoundaries(value: unknown): CouncilPostcodeBoundary[] {
  if (!record(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) throw new Error("Invalid postal area collection");
  const seen = new Set<string>();
  return value.features.map((feature): CouncilPostcodeBoundary => {
    if (!record(feature) || feature.type !== "Feature" || !record(feature.properties)
      || typeof feature.properties.postcode !== "string" || !/^\d{4}$/.test(feature.properties.postcode) || !record(feature.geometry)) throw new Error("Invalid postal area feature");
    const postcode = feature.properties.postcode;
    if (seen.has(postcode)) throw new Error("Duplicate postal area");
    seen.add(postcode);
    let geometry: CouncilPostcodeBoundary["geometry"];
    if (feature.geometry.type === "Polygon") geometry = { type: "Polygon", coordinates: polygon(feature.geometry.coordinates) };
    else if (feature.geometry.type === "MultiPolygon" && Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length) geometry = { type: "MultiPolygon", coordinates: feature.geometry.coordinates.map(polygon) };
    else throw new Error("Unsupported postal area geometry");
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const bbox: CouncilPostcodeBoundary["bbox"] = [180, 90, -180, -90];
    for (const rings of polygons) for (const points of rings) for (const [lng, lat] of points) {
      bbox[0] = Math.min(bbox[0], lng); bbox[1] = Math.min(bbox[1], lat);
      bbox[2] = Math.max(bbox[2], lng); bbox[3] = Math.max(bbox[3], lat);
    }
    return { type: "Feature", properties: { postcode }, geometry, bbox };
  });
}

/** Load only required postcode prefixes. Missing ABS areas remain explicit. */
export async function loadCouncilPostcodeBoundaries(postcodes: string[], signal?: AbortSignal): Promise<{ features: CouncilPostcodeBoundary[]; missingPostcodes: string[] }> {
  const requested = new Set(postcodes);
  if ([...requested].some(postcode => !/^\d{4}$/.test(postcode))) throw new Error("Invalid postcode scope");
  const prefixes = [...new Set([...requested].map(postcode => postcode.slice(0, 2)))].sort();
  const groups = await Promise.all(prefixes.map(async prefix => {
    const response = await fetch(`/data/council-postcode-boundaries/abs-2021-${prefix}.json`, { signal });
    // Prefixes containing only non-geographic postcodes have no ABS area file.
    if (response.status === 404) return [];
    if (!response.ok) throw new Error("Postal area boundaries could not be loaded");
    const boundaries = parseCouncilPostcodeBoundaries(await response.json());
    if (boundaries.some(feature => !feature.properties.postcode.startsWith(prefix))) throw new Error("Unexpected postal area prefix");
    return boundaries;
  }));
  const features = groups.flat().filter(feature => requested.has(feature.properties.postcode));
  const found = new Set(features.map(feature => feature.properties.postcode));
  return { features, missingPostcodes: [...requested].filter(postcode => !found.has(postcode)).sort() };
}

/** Render with SVG fillRule="evenodd" so holes remain transparent. */
export function councilPostcodeBoundaryPath(feature: CouncilPostcodeBoundary, project: (position: CouncilBoundaryPosition) => { x: number; y: number }): string {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return polygons.flatMap(rings => rings.map(points => points.map(([lng, lat], index) => {
    const point = project({ lat, lng });
    return `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join("") + "Z")).join("");
}

function pointInRing(points: CouncilBoundaryCoordinate[], position: CouncilBoundaryPosition): boolean {
  const { lng: x, lat: y } = position;
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [ax, ay] = points[previous], [bx, by] = points[index];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-10 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export function councilPostcodeBoundaryContains(feature: CouncilPostcodeBoundary, position: CouncilBoundaryPosition): boolean {
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return false;
  const [west, south, east, north] = feature.bbox;
  if (position.lng < west || position.lng > east || position.lat < south || position.lat > north) return false;
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return polygons.some(rings => pointInRing(rings[0], position) && !rings.slice(1).some(hole => pointInRing(hole, position)));
}

/** Keep a known locality anchor if it belongs to the area; otherwise use an interior point. */
export function councilPostcodeBoundaryLabelPosition(feature: CouncilPostcodeBoundary, preferredCentroid?: CouncilBoundaryPosition): CouncilBoundaryPosition {
  if (preferredCentroid && councilPostcodeBoundaryContains(feature, preferredCentroid)) return preferredCentroid;
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const area = (points: CouncilBoundaryCoordinate[]) => Math.abs(points.reduce((sum, [x, y], index) => {
    const next = points[(index + 1) % points.length];
    return sum + x * next[1] - next[0] * y;
  }, 0));
  const main = polygons.reduce((largest, candidate) => area(candidate[0]) > area(largest[0]) ? candidate : largest);
  const latitudes = main[0].map(point => point[1]);
  const latitude = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
  // Intersections of a horizontal scan line alternate between filled area and
  // empty space, including polygon holes. The widest filled span gives an
  // interior label anchor even for concave coastlines and disconnected islands.
  const intersections: number[] = [];
  for (const points of main) for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [ax, ay] = points[previous], [bx, by] = points[index];
    if ((ay > latitude) !== (by > latitude)) intersections.push(ax + (latitude - ay) * (bx - ax) / (by - ay));
  }
  intersections.sort((a, b) => a - b);
  let width = -1;
  let longitude = main[0][0][0];
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    const span = intersections[index + 1] - intersections[index];
    if (span > width) { width = span; longitude = (intersections[index] + intersections[index + 1]) / 2; }
  }
  return { lat: latitude, lng: longitude };
}
