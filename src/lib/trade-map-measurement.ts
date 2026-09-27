/// <reference types="google.maps" />

export type TradeMapMeasureMode = "area" | "distance";
export type TradeMapMeasurement = { points: number; areaM2: number; lengthM: number; previewLengthM: number | null; crossed: boolean; finished: boolean };
export const EMPTY_MAP_MEASUREMENT: TradeMapMeasurement = { points: 0, areaM2: 0, lengthM: 0, previewLengthM: null, crossed: false, finished: false };
const distanceNumber = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatMapDistance = (metres: number) => `${distanceNumber.format(metres)} m`;

/** Roof outlines must not cross themselves, otherwise their area is ambiguous. */
export function measurementEdgesCross(points: readonly google.maps.LatLngLiteral[]): boolean {
  const cross = (a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral, c: google.maps.LatLngLiteral) =>
    (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  const between = (a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral, p: google.maps.LatLngLiteral) =>
    p.lat >= Math.min(a.lat, b.lat) && p.lat <= Math.max(a.lat, b.lat)
    && p.lng >= Math.min(a.lng, b.lng) && p.lng <= Math.max(a.lng, b.lng);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
      if ((abC * abD < 0 && cdA * cdB < 0)
        || (abC === 0 && between(a, b, c)) || (abD === 0 && between(a, b, d))
        || (cdA === 0 && between(c, d, a)) || (cdB === 0 && between(c, d, b))) return true;
    }
  }
  return false;
}

/** One map-local drawing. No shapes or coordinates are saved or sent to a server. */
export function createTradeMapMeasurement(api: typeof google.maps, map: google.maps.Map, mode: TradeMapMeasureMode,
  onChange: (measurement: TradeMapMeasurement) => void, previewLabel?: HTMLDivElement) {
  let finished = false;
  let cursor: google.maps.LatLng | null = null;
  let dragging = false;
  let overlayReady = false;
  const options = { map, editable: true, clickable: false, draggable: false, strokeColor: "#fbcf42", strokeWeight: 3, strokeOpacity: 1, geodesic: true };
  const shape = mode === "area"
    ? new api.Polygon({ ...options, fillColor: "#fbcf42", fillOpacity: 0.22 })
    : new api.Polyline(options);
  const path = shape.getPath();
  const previewLine = mode === "distance" ? new api.Polyline({
    ...options, editable: false, strokeOpacity: 0,
    icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 2 }, offset: "0", repeat: "12px" }],
  }) : null;
  const previewOverlay = mode === "distance" && previewLabel ? new api.OverlayView() : null;
  if (previewOverlay && previewLabel) {
    previewLabel.hidden = true;
    previewOverlay.onAdd = () => {
      const panes = previewOverlay.getPanes();
      if (panes) { panes.overlayLayer.append(previewLabel); overlayReady = true; }
    };
    previewOverlay.draw = () => {
      if (!cursor || !path.getLength() || finished) { previewLabel.hidden = true; return; }
      const projection = previewOverlay.getProjection();
      const pixel = projection.fromLatLngToDivPixel(cursor);
      const containerPixel = projection.fromLatLngToContainerPixel(cursor);
      if (!pixel || !containerPixel) { previewLabel.hidden = true; return; }
      previewLabel.hidden = false;
      const xOffset = containerPixel.x + previewLabel.offsetWidth + 16 > map.getDiv().clientWidth ? -previewLabel.offsetWidth - 16 : 16;
      const yOffset = containerPixel.y < previewLabel.offsetHeight + 16 ? 16 : -previewLabel.offsetHeight - 16;
      previewLabel.style.left = `${pixel.x + xOffset}px`;
      previewLabel.style.top = `${pixel.y + yOffset}px`;
    };
    previewOverlay.onRemove = () => { overlayReady = false; previewLabel.remove(); };
    previewOverlay.setMap(map);
  }
  const previous = { draggableCursor: map.get("draggableCursor"), disableDoubleClickZoom: map.get("disableDoubleClickZoom"), fullscreenControl: map.get("fullscreenControl") };
  map.setOptions({ draggableCursor: "crosshair", disableDoubleClickZoom: true, fullscreenControl: false });
  function snapshot(): TradeMapMeasurement {
    const vertices = path.getArray();
    const crossed = mode === "area" && measurementEdgesCross(vertices.map((point) => point.toJSON()));
    return {
      points: vertices.length, crossed, finished,
      areaM2: mode === "area" && vertices.length >= 3 && !crossed ? api.geometry.spherical.computeArea(path) : 0,
      lengthM: vertices.length < 2 ? 0 : api.geometry.spherical.computeLength(mode === "area" && vertices.length >= 3 ? [...vertices, vertices[0]] : vertices),
      previewLengthM: mode === "distance" && cursor && vertices.length && !finished ? api.geometry.spherical.computeLength([...vertices, cursor]) : null,
    };
  }
  const update = () => {
    const value = snapshot();
    previewLine?.setPath(cursor && path.getLength() && !finished ? [path.getAt(path.getLength() - 1), cursor] : []);
    if (previewLabel && value.previewLengthM !== null) previewLabel.textContent = formatMapDistance(value.previewLengthM);
    if (previewOverlay && overlayReady) previewOverlay.draw();
    onChange(value);
  };
  const clearPreview = () => { if (cursor) { cursor = null; update(); } };
  const changePath = () => { cursor = null; update(); };
  function add(point: google.maps.LatLng | null) {
    if (finished || !point) return;
    const last = path.getAt(path.getLength() - 1);
    if (last?.equals(point)) return;
    path.push(point);
  }
  const listeners = [
    map.addListener("click", (event: google.maps.MapMouseEvent) => add(event.latLng)),
    path.addListener("insert_at", changePath), path.addListener("set_at", changePath), path.addListener("remove_at", changePath),
  ];
  if (mode === "distance") listeners.push(
    map.addListener("mousemove", (event: google.maps.MapMouseEvent) => {
      if (finished || dragging || !path.getLength()) return;
      cursor = event.latLng;
      update();
    }),
    map.addListener("mouseout", clearPreview),
    map.addListener("dragstart", () => { dragging = true; clearPreview(); }),
    map.addListener("idle", () => { dragging = false; }),
    map.addListener("center_changed", clearPreview), map.addListener("zoom_changed", clearPreview),
  );
  update();
  return {
    setCapturing: (value: boolean) => { shape.setOptions({ editable: !value }); },
    addCentre: () => add(map.getCenter() ?? null),
    undo: () => { if (!finished && path.getLength()) path.pop(); },
    finish: () => {
      const value = snapshot();
      if (value.points < (mode === "area" ? 3 : 2) || value.crossed || (mode === "area" && value.areaM2 <= 0)) return;
      finished = true;
      cursor = null;
      shape.setOptions({ clickable: true });
      map.setOptions({ draggableCursor: previous.draggableCursor, disableDoubleClickZoom: previous.disableDoubleClickZoom });
      update();
    },
    dispose: () => { listeners.forEach((listener) => listener.remove()); previewOverlay?.setMap(null); previewLine?.setMap(null); shape.setMap(null); map.setOptions(previous); },
  };
}
