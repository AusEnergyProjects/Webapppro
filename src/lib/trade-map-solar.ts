/// <reference types="google.maps" />

export type SolarPanelSize = { widthM: number; lengthM: number };
export type SolarPanelTilt = { lengthTilt: number; widthTilt: number };
export type SolarPanelSettings = SolarPanelSize & SolarPanelTilt;
export type SolarPanel = SolarPanelSettings & { id: number; center: google.maps.LatLngLiteral; heading: number };
export type SolarLayout = { panels: SolarPanel[]; selectedId: number | null };
export type SolarCopyDirection = "above" | "right" | "below" | "left";
export const DEFAULT_SOLAR_PANEL_SIZE: SolarPanelSize = { widthM: 1.13, lengthM: 1.72 };
// An editable roof-pitch assumption, not a measurement of the roof below the map.
export const DEFAULT_SOLAR_PANEL_TILT: SolarPanelTilt = { lengthTilt: 22.5, widthTilt: 0 };
export const SOLAR_PANEL_GAP_M = 0.02;
export const validSolarPanelSize = (size: SolarPanelSize) => [size.widthM, size.lengthM].every((value) => Number.isFinite(value) && value >= 0.2 && value <= 4);
export const validSolarPanelTilt = (tilt: SolarPanelTilt) => [tilt.lengthTilt, tilt.widthTilt].every((value) => Number.isFinite(value) && value >= 0 && value <= 85);
export const solarHeading = (value: number) => ((value % 360) + 360) % 360;

/** Orthographic projection: pitch along the length, then roll along the width.
 * Both rotations preserve the physical rectangle. Combined tilts produce a
 * parallelogram overhead; rendering and copy spacing share these same axes.
 * Coordinates are east/north before the panel's heading is applied.
 */
export function solarPanelAxes(tilt: SolarPanelTilt) {
  const length = tilt.lengthTilt * Math.PI / 180, width = tilt.widthTilt * Math.PI / 180;
  return { width: { x: Math.cos(width), y: 0 }, length: { x: Math.sin(length) * Math.sin(width), y: Math.cos(length) } };
}

export function adjacentSolarPanel(panel: SolarPanel, direction: SolarCopyDirection,
  offset: (from: google.maps.LatLngLiteral, distance: number, heading: number) => google.maps.LatLngLiteral): Omit<SolarPanel, "id"> {
  const alongLength = direction === "above" || direction === "below";
  const axes = solarPanelAxes(panel), axis = alongLength ? axes.length : axes.width;
  const distance = ((alongLength ? panel.lengthM : panel.widthM) + SOLAR_PANEL_GAP_M) * Math.hypot(axis.x, axis.y);
  const bearing = Math.atan2(axis.x, axis.y) * 180 / Math.PI + (direction === "below" || direction === "left" ? 180 : 0);
  return { widthM: panel.widthM, lengthM: panel.lengthM, lengthTilt: panel.lengthTilt, widthTilt: panel.widthTilt, heading: panel.heading,
    center: offset(panel.center, distance, solarHeading(panel.heading + bearing)) };
}

type SolarStyles = { panel: string; face: string; controls: string; ring: string; rotate: string; copy: string };
type Entry = { panel: SolarPanel; element: HTMLDivElement; face: HTMLButtonElement; controls: HTMLDivElement };

/** A temporary, metre-scaled roof concept. Nothing is stored or sent to a server. */
export function createTradeMapSolarLayout(api: typeof google.maps, map: google.maps.Map, styles: SolarStyles, onChange: (layout: SolarLayout) => void) {
  const entries = new Map<number, Entry>();
  const host = document.createElement("div");
  const events = new AbortController();
  const overlay = new api.OverlayView();
  let nextId = 1;
  let selectedId: number | null = null;
  let editing = false;
  let capturing = false;
  let ready = false;
  const state = (): SolarLayout => ({ panels: [...entries.values()].map(({ panel }) => ({ ...panel, center: { ...panel.center } })), selectedId });
  const publish = () => { if (ready) overlay.draw(); onChange(state()); };
  const select = (id: number) => { selectedId = id; publish(); };

  overlay.onAdd = () => {
    const panes = overlay.getPanes();
    if (panes) { panes.overlayMouseTarget.append(host); ready = true; }
  };
  overlay.onRemove = () => { ready = false; host.remove(); };
  overlay.draw = () => {
    const projection = overlay.getProjection();
    for (const entry of entries.values()) {
      const { panel, element, face, controls } = entry;
      const center = projection.fromLatLngToDivPixel(new api.LatLng(panel.center));
      const east = projection.fromLatLngToDivPixel(api.geometry.spherical.computeOffset(panel.center, panel.widthM / 2, 90));
      const north = projection.fromLatLngToDivPixel(api.geometry.spherical.computeOffset(panel.center, panel.lengthM / 2, 0));
      if (!center || !east || !north) { element.hidden = true; continue; }
      element.hidden = false;
      const width = Math.abs(east.x - center.x) * 2, height = Math.abs(north.y - center.y) * 2;
      element.style.left = `${center.x}px`;
      element.style.top = `${center.y}px`;
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
      element.style.transform = `translate(-50%, -50%) rotate(${panel.heading}deg)`;
      const axes = solarPanelAxes(panel);
      face.style.transform = `matrix(${axes.width.x}, 0, ${-axes.length.x}, ${axes.length.y}, 0, 0)`;
      element.style.zIndex = panel.id === selectedId ? "2" : "1";
      element.style.pointerEvents = editing && !capturing ? "auto" : "none";
      element.dataset.selected = String(panel.id === selectedId && editing && !capturing);
      face.tabIndex = editing && !capturing ? 0 : -1;
      face.setAttribute("aria-pressed", String(panel.id === selectedId));
      controls.hidden = panel.id !== selectedId || !editing || capturing;
      const ringSize = Math.max(100, Math.hypot(width * axes.width.x + height * axes.length.x, height * axes.length.y) + 52);
      controls.style.width = controls.style.height = `${ringSize}px`;
    }
  };
  overlay.setMap(map);

  function drag(button: HTMLButtonElement, entry: Entry, rotate: boolean) {
    let pointerId: number | null = null;
    let offset = { x: 0, y: 0 };
    let headingOffset = 0;
    button.addEventListener("pointerdown", (event) => {
      if (!editing || capturing || event.button !== 0 || !ready) return;
      event.preventDefault(); event.stopPropagation();
      select(entry.panel.id);
      const center = overlay.getProjection().fromLatLngToContainerPixel(new api.LatLng(entry.panel.center));
      if (!center) return;
      const bounds = map.getDiv().getBoundingClientRect();
      offset = { x: event.clientX - bounds.left - center.x, y: event.clientY - bounds.top - center.y };
      headingOffset = Math.atan2(offset.x, -offset.y) * 180 / Math.PI - entry.panel.heading;
      pointerId = event.pointerId;
      button.setPointerCapture(event.pointerId);
    }, { signal: events.signal });
    button.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId || !editing || capturing) return;
      const bounds = map.getDiv().getBoundingClientRect();
      const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
      const projection = overlay.getProjection();
      if (rotate) {
        const center = projection.fromLatLngToContainerPixel(new api.LatLng(entry.panel.center));
        if (!center) return;
        entry.panel.heading = solarHeading(Math.atan2(x - center.x, center.y - y) * 180 / Math.PI - headingOffset);
      } else {
        const position = projection.fromContainerPixelToLatLng(new api.Point(x - offset.x, y - offset.y));
        if (position) entry.panel.center = position.toJSON();
      }
      publish();
    }, { signal: events.signal });
    const stop = () => { pointerId = null; };
    button.addEventListener("pointerup", stop, { signal: events.signal });
    button.addEventListener("pointercancel", stop, { signal: events.signal });
    button.addEventListener("lostpointercapture", stop, { signal: events.signal });
  }

  function addPanel(data: Omit<SolarPanel, "id">) {
    if (!validSolarPanelSize(data) || !validSolarPanelTilt(data) || !Number.isFinite(data.heading)) return;
    const panel: SolarPanel = { ...data, center: { ...data.center }, id: nextId++ };
    const element = document.createElement("div");
    element.className = styles.panel;
    element.dataset.solarPanelId = String(panel.id);
    const face = document.createElement("button");
    face.type = "button"; face.className = styles.face; face.setAttribute("aria-label", `Solar panel ${panel.id}. Drag to move`);
    const controls = document.createElement("div");
    controls.className = styles.controls;
    const ring = document.createElement("div"); ring.className = styles.ring; ring.setAttribute("aria-hidden", "true");
    controls.append(ring);
    const rotate = document.createElement("button");
    rotate.type = "button"; rotate.className = styles.rotate; rotate.textContent = "↻";
    rotate.setAttribute("aria-label", "Rotate selected solar panel"); rotate.title = "Drag around the circle to rotate. Use arrow keys for 1° steps.";
    controls.append(rotate);
    const entry = { panel, element, face, controls };
    face.addEventListener("click", () => select(panel.id), { signal: events.signal });
    face.addEventListener("keydown", (event) => {
      const directions: Record<string, number> = { ArrowUp: 0, ArrowRight: 90, ArrowDown: 180, ArrowLeft: 270 };
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); select(panel.id); removeSelected(); return; }
      if (!(event.key in directions)) return;
      event.preventDefault();
      panel.center = api.geometry.spherical.computeOffset(panel.center, event.shiftKey ? 1 : 0.1, directions[event.key]).toJSON();
      select(panel.id);
    }, { signal: events.signal });
    rotate.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); panel.heading = solarHeading(panel.heading + (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1)); publish();
    }, { signal: events.signal });
    const directions: [SolarCopyDirection, string][] = [["above", "↑"], ["right", "→"], ["below", "↓"], ["left", "←"]];
    for (const [direction, arrow] of directions) {
      const button = document.createElement("button");
      button.type = "button"; button.className = styles.copy; button.dataset.direction = direction; button.textContent = arrow;
      button.setAttribute("aria-label", `Copy panel ${direction}`); button.title = `Copy panel ${direction}`;
      button.addEventListener("click", () => copy(panel.id, direction), { signal: events.signal });
      controls.append(button);
    }
    element.append(face, controls); host.append(element); entries.set(panel.id, entry);
    api.OverlayView.preventMapHitsAndGesturesFrom(element);
    drag(face, entry, false); drag(rotate, entry, true);
    selectedId = panel.id; publish();
  }
  function copy(id: number, direction: SolarCopyDirection) {
    const source = entries.get(id)?.panel;
    if (source) addPanel(adjacentSolarPanel(source, direction, (from, distance, heading) => api.geometry.spherical.computeOffset(from, distance, heading).toJSON()));
  }
  function removeSelected() {
    if (selectedId === null) return;
    entries.get(selectedId)?.element.remove(); entries.delete(selectedId); selectedId = null; publish();
  }
  return {
    add: (settings: SolarPanelSettings) => { const center = map.getCenter(); if (center) addPanel({ ...settings, center: center.toJSON(), heading: 0 }); },
    updateSelected: (values: SolarPanelSettings & { heading: number }) => {
      const selected = selectedId === null ? null : entries.get(selectedId);
      if (selected && validSolarPanelSize(values) && validSolarPanelTilt(values) && Number.isFinite(values.heading)) { Object.assign(selected.panel, values, { heading: solarHeading(values.heading) }); publish(); }
    },
    removeSelected,
    clear: () => { entries.forEach(({ element }) => element.remove()); entries.clear(); selectedId = null; publish(); },
    setEditing: (value: boolean) => { editing = value; publish(); },
    setCapturing: (value: boolean) => { capturing = value; if (ready) overlay.draw(); },
    dispose: () => { events.abort(); entries.clear(); overlay.setMap(null); },
  };
}
