export type MapPosition = { lat: number; lng: number };
export type CouncilMapView = MapPosition & { zoom: number };
export const MAP_MIN_ZOOM = 3;
export const MAP_MAX_ZOOM = 16;

export function mapWorldPoint(position: MapPosition, zoom: number) {
  const size = 256 * 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, position.lat));
  const sine = Math.sin(latitude * Math.PI / 180);
  return { x: (position.lng + 180) / 360 * size, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size };
}

export function mapWorldPosition(point: { x: number; y: number }, zoom: number): MapPosition {
  const size = 256 * 2 ** zoom;
  return { lng: point.x / size * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * point.y / size))) * 180 / Math.PI };
}

export function fitCouncilMap(positions: MapPosition[], width: number, height: number): CouncilMapView {
  if (!positions.length) return { lat: -25.5, lng: 134, zoom: 4 };
  const points = positions.map(position => mapWorldPoint(position, 0));
  const west = Math.min(...points.map(point => point.x)), east = Math.max(...points.map(point => point.x));
  const north = Math.min(...points.map(point => point.y)), south = Math.max(...points.map(point => point.y));
  const centre = mapWorldPosition({ x: (west + east) / 2, y: (north + south) / 2 }, 0);
  const fit = Math.floor(Math.log2(Math.min(Math.max(width - 130, 100) / Math.max(east - west, 0.01), Math.max(height - 150, 100) / Math.max(south - north, 0.01))));
  return { ...centre, zoom: Math.max(MAP_MIN_ZOOM, Math.min(13, fit)) };
}

export function councilMapPoint(position: MapPosition, view: CouncilMapView, width: number, height: number) {
  const point = mapWorldPoint(position, view.zoom), centre = mapWorldPoint(view, view.zoom);
  return { x: point.x - centre.x + width / 2, y: point.y - centre.y + height / 2 };
}

// Only tiles intersecting the visible preview are requested. Browser HTTP caching
// applies; there is no tile prefetch, proxy, background download or offline cache.
export function councilPreviewTiles(view: CouncilMapView, width: number, height: number) {
  const centre = mapWorldPoint(view, view.zoom), left = centre.x - width / 2, top = centre.y - height / 2;
  const count = 2 ** view.zoom;
  const tiles: Array<{ key: string; x: number; y: number; url: string }> = [];
  for (let y = Math.floor(top / 256); y <= Math.floor((top + height - 1) / 256); y++) {
    for (let x = Math.floor(left / 256); x <= Math.floor((left + width - 1) / 256); x++) {
      if (y < 0 || y >= count) continue;
      const wrapped = ((x % count) + count) % count;
      tiles.push({ key: `${view.zoom}/${wrapped}/${y}`, x: x * 256 - left, y: y * 256 - top, url: `https://tile.openstreetmap.org/${view.zoom}/${wrapped}/${y}.png` });
    }
  }
  return tiles;
}

export function moveCouncilMap(view: CouncilMapView, dx: number, dy: number): CouncilMapView {
  const centre = mapWorldPoint(view, view.zoom);
  const next = mapWorldPosition({ x: centre.x - dx, y: centre.y - dy }, view.zoom);
  return { lat: Math.max(-80, Math.min(80, next.lat)), lng: ((next.lng + 540) % 360) - 180, zoom: view.zoom };
}

/** Keep every marker at its geographic anchor; omit labels that would obscure the map. */
export function layoutCouncilMapMarkers(areas: Array<{key:string;position:MapPosition}>, view: CouncilMapView, width: number, height: number, selectedKey?: string) {
  const anchors = areas.map(area => ({key:area.key,...councilMapPoint(area.position,view,width,height)}))
    .filter(point => point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height);
  const visible: Array<{key:string;x:number;y:number}> = [];
  const ranked = [...anchors].sort((a,b) => Number(b.key === selectedKey) - Number(a.key === selectedKey) || a.key.localeCompare(b.key));
  for (const point of ranked) {
    // Labels are fixed 84 x 36 px directly below their anchor, never repositioned.
    if (point.x < 50 || point.x > width - 50 || point.y < 60 || point.y + 54 > height - 82) continue;
    if (visible.some(other => Math.abs(other.x-point.x) < 94 && Math.abs(other.y-point.y) < 46)) continue;
    if (anchors.some(other => other.key !== point.key && Math.abs(other.x-point.x) < 54 && other.y > point.y+3 && other.y < point.y+66)) continue;
    visible.push(point);
  }
  return { anchors, visible, hidden: anchors.length - visible.length };
}

/** Prefer usable public VEU data while preserving real zero values and council scope. */
export function preferredCouncilMapLayer(layers: Array<{id:string;postcodes:Array<{postcode:string;value:number|null}>}>, postcodes: string[]) {
  const scope = new Set(postcodes);
  const available = layers.filter(layer => layer.postcodes.some(row => scope.has(row.postcode) && row.value !== null && Number.isFinite(row.value) && row.value >= 0));
  return available.find(layer => layer.id === "public-upgrades")?.id ?? available[0]?.id ?? "";
}
