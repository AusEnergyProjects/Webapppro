/// <reference types="google.maps" />

export type SolarPanelSize = { widthM: number; lengthM: number };
export type SolarPanelTilt = { lengthTilt: number; widthTilt: number };
export type SolarPanelSettings = SolarPanelSize & SolarPanelTilt;
export type SolarPanel = SolarPanelSettings & { id: number; center: google.maps.LatLngLiteral; heading: number };
export type SolarSelectionMode = "one" | "all" | "choose" | "selection";
export type SolarLayout = { panels: SolarPanel[]; selectedId: number | null; selectionMode: SolarSelectionMode; selectedIds: number[] };
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

type SolarStyles = { panel: string; face: string; controls: string; ring: string; rotate: string; copy: string; group: string; move: string; selectionBox: string };
type Entry = { panel: SolarPanel; element: HTMLDivElement; face: HTMLButtonElement; controls: HTMLDivElement };
type ProjectedPanel = { panel: SolarPanel; x: number; y: number };
const layoutCentre = (panels: ProjectedPanel[]) => ({
  x: panels.reduce((sum, panel) => sum + panel.x, 0) / panels.length,
  y: panels.reduce((sum, panel) => sum + panel.y, 0) / panels.length,
});

/** A temporary, metre-scaled roof concept. Nothing is stored or sent to a server. */
export function createTradeMapSolarLayout(api: typeof google.maps, map: google.maps.Map, styles: SolarStyles, onChange: (layout: SolarLayout) => void) {
  const entries = new Map<number, Entry>();
  const host = document.createElement("div");
  const events = new AbortController();
  const overlay = new api.OverlayView();
  const mapElement = map.getDiv();
  const previousTouchAction = mapElement.style.touchAction;
  const selectionBox = document.createElement("div"); selectionBox.className = styles.selectionBox; selectionBox.hidden = true;
  selectionBox.setAttribute("aria-hidden", "true");
  let nextId = 1;
  let selectedId: number | null = null;
  let selectionMode: SolarSelectionMode = "one";
  const selectedIds = new Set<number>();
  let editing = false;
  let capturing = false;
  let ready = false;
  let gesture: { button: HTMLButtonElement; pointerId: number; panels: ProjectedPanel[]; pivot: { x: number; y: number }; start: { x: number; y: number }; rotate: boolean } | null = null;
  let selectionGesture: { pointerId: number; start: { x: number; y: number }; previousIds: number[]; moved: boolean } | null = null;
  const state = (): SolarLayout => ({ panels: [...entries.values()].map(({ panel }) => ({ ...panel, center: { ...panel.center } })), selectedId, selectionMode, selectedIds: [...selectedIds] });
  const publish = () => { if (ready) overlay.draw(); onChange(state()); };
  const select = (id: number) => { selectedId = id; publish(); };
  const canTransform = (entry?: Entry) => editing && !capturing && selectionMode !== "choose"
    && (!entry || selectionMode === "one" || selectedIds.has(entry.panel.id));
  const group = document.createElement("div"); group.className = styles.group;
  const groupControls = document.createElement("div"); groupControls.className = styles.controls;
  const groupRing = document.createElement("div"); groupRing.className = styles.ring; groupRing.setAttribute("aria-hidden", "true");
  const groupRotate = document.createElement("button"); groupRotate.type = "button"; groupRotate.className = styles.rotate; groupRotate.textContent = "↻";
  groupRotate.setAttribute("aria-label", "Rotate all solar panels"); groupRotate.title = "Drag around the circle to rotate all panels. Arrow keys turn by 1°.";
  const groupMove = document.createElement("button"); groupMove.type = "button"; groupMove.className = styles.move; groupMove.textContent = "✥";
  groupMove.setAttribute("aria-label", "Move all solar panels"); groupMove.title = "Drag to move all panels. Arrow keys move by 10 cm; Shift moves by 1 m.";
  groupControls.append(groupRing, groupRotate, groupMove); group.append(groupControls); host.append(group);
  api.OverlayView.preventMapHitsAndGesturesFrom(group);

  overlay.onAdd = () => {
    const panes = overlay.getPanes();
    if (panes) { panes.overlayMouseTarget.append(host); mapElement.append(selectionBox); ready = true; }
  };
  overlay.onRemove = () => { ready = false; host.remove(); selectionBox.remove(); mapElement.style.touchAction = previousTouchAction; };
  overlay.draw = () => {
    mapElement.style.touchAction = editing && !capturing && selectionMode === "choose" ? "none" : previousTouchAction;
    const projection = overlay.getProjection();
    const groupPoints: ProjectedPanel[] = [];
    const radii = new Map<number, number>();
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
      const selected = selectionMode === "one" ? panel.id === selectedId : selectedIds.has(panel.id);
      element.style.zIndex = selected ? "2" : "1";
      element.style.pointerEvents = editing && !capturing ? "auto" : "none";
      element.dataset.selected = String(selected && editing && !capturing);
      element.dataset.choosing = String(selectionMode === "choose");
      element.dataset.movable = String(canTransform(entry));
      face.tabIndex = editing && !capturing ? 0 : -1;
      face.setAttribute("aria-pressed", String(selected));
      face.setAttribute("aria-label", `Solar panel ${panel.id}. ${selectionMode === "choose" ? `${selected ? "Remove from" : "Add to"} selection`
        : selectionMode === "one" ? "Drag to move" : selected ? `Drag to move ${selectionMode === "all" ? "all" : "selected"} panels` : "Not selected"}`);
      controls.hidden = selectionMode !== "one" || panel.id !== selectedId || !editing || capturing;
      const ringSize = Math.max(100, Math.hypot(width * axes.width.x + height * axes.length.x, height * axes.length.y) + 52);
      controls.style.width = controls.style.height = `${ringSize}px`;
      if (selectedIds.has(panel.id)) groupPoints.push({ panel, x: center.x, y: center.y });
      radii.set(panel.id, (ringSize - 52) / 2);
    }
    group.hidden = (selectionMode !== "all" && selectionMode !== "selection") || !editing || capturing || !groupPoints.length;
    if (!group.hidden) {
      const scope = selectionMode === "all" ? "all" : "selected";
      groupRotate.setAttribute("aria-label", `Rotate ${scope} solar panels`);
      groupRotate.title = `Drag around the circle to rotate ${scope} panels. Arrow keys turn by 1°.`;
      groupMove.setAttribute("aria-label", `Move ${scope} solar panels`);
      groupMove.title = `Drag to move ${scope} panels. Arrow keys move by 10 cm; Shift moves by 1 m.`;
      const pivot = layoutCentre(groupPoints);
      const radius = Math.max(...groupPoints.map((point) => Math.hypot(point.x - pivot.x, point.y - pivot.y) + (radii.get(point.panel.id) ?? 0)));
      group.style.left = `${pivot.x}px`; group.style.top = `${pivot.y}px`;
      groupControls.style.width = groupControls.style.height = `${Math.max(100, radius * 2 + 52)}px`;
      groupControls.style.transform = `translate(-50%, -50%) rotate(${groupPoints[0].panel.heading}deg)`;
    }
  };
  overlay.setMap(map);

  function stopGesture() {
    stopSelection();
    const previous = gesture; gesture = null;
    if (previous?.button.hasPointerCapture(previous.pointerId)) previous.button.releasePointerCapture(previous.pointerId);
  }
  function stopSelection(cancel = true) {
    const previous = selectionGesture; selectionGesture = null; selectionBox.hidden = true;
    if (!previous) return;
    if (mapElement.hasPointerCapture(previous.pointerId)) mapElement.releasePointerCapture(previous.pointerId);
    if (cancel && previous.moved) { selectedIds.clear(); previous.previousIds.forEach((id) => { if (entries.has(id)) selectedIds.add(id); }); publish(); }
  }
  function chooseWithin(x: number, y: number) {
    if (!selectionGesture) return;
    const { start } = selectionGesture;
    if (!selectionGesture.moved && Math.hypot(x - start.x, y - start.y) < 4) return;
    selectionGesture.moved = true;
    const left = Math.min(start.x, x), right = Math.max(start.x, x), top = Math.min(start.y, y), bottom = Math.max(start.y, y);
    selectionBox.hidden = false;
    selectionBox.style.left = `${left}px`; selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${right - left}px`; selectionBox.style.height = `${bottom - top}px`;
    selectedIds.clear();
    const projection = overlay.getProjection();
    for (const { panel } of entries.values()) {
      const point = projection.fromLatLngToContainerPixel(new api.LatLng(panel.center));
      if (point && point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) selectedIds.add(panel.id);
    }
    publish();
  }
  mapElement.addEventListener("pointerdown", (event) => {
    if (!editing || capturing || !ready || selectionMode !== "choose" || event.button !== 0 || selectionGesture) return;
    // Faces keep their native click/keyboard activation for individual toggles.
    if ([...entries.values()].some(({ element }) => event.composedPath().includes(element))) return;
    if (event.composedPath().some((target) => ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(Reflect.get(target, "tagName")))) return;
    event.preventDefault(); event.stopImmediatePropagation(); stopGesture();
    const bounds = mapElement.getBoundingClientRect();
    selectionGesture = { pointerId: event.pointerId, start: { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, previousIds: [...selectedIds], moved: false };
    mapElement.setPointerCapture(event.pointerId);
  }, { signal: events.signal, capture: true });
  mapElement.addEventListener("pointermove", (event) => {
    if (selectionGesture?.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const bounds = mapElement.getBoundingClientRect(); chooseWithin(event.clientX - bounds.left, event.clientY - bounds.top);
  }, { signal: events.signal, capture: true });
  mapElement.addEventListener("pointerup", (event) => {
    if (selectionGesture?.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const bounds = mapElement.getBoundingClientRect(); chooseWithin(event.clientX - bounds.left, event.clientY - bounds.top); stopSelection(false);
  }, { signal: events.signal, capture: true });
  const cancelSelection = (event: PointerEvent) => { if (selectionGesture?.pointerId === event.pointerId) stopSelection(); };
  mapElement.addEventListener("pointercancel", cancelSelection, { signal: events.signal });
  mapElement.addEventListener("lostpointercapture", cancelSelection, { signal: events.signal });
  function snapshot(entry?: Entry): ProjectedPanel[] {
    if (!ready) return [];
    const targets = selectionMode === "one" ? entry ? [entry] : []
      : [...entries.values()].filter(({ panel }) => selectedIds.has(panel.id));
    const projection = overlay.getProjection();
    return targets.flatMap(({ panel }) => {
      const point = projection.fromLatLngToContainerPixel(new api.LatLng(panel.center));
      return point ? [{ panel: { ...panel, center: { ...panel.center } }, x: point.x, y: point.y }] : [];
    });
  }
  function transform(panels: ProjectedPanel[], pivot: { x: number; y: number }, dx: number, dy: number, rotation: number) {
    const radians = rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
    const projection = overlay.getProjection();
    for (const point of panels) {
      const entry = entries.get(point.panel.id);
      const x = point.x - pivot.x, y = point.y - pivot.y;
      const position = projection.fromContainerPixelToLatLng(new api.Point(pivot.x + cos * x - sin * y + dx, pivot.y + sin * x + cos * y + dy));
      if (entry && position) {
        entry.panel.center = position.toJSON();
        entry.panel.heading = solarHeading(point.panel.heading + rotation);
      }
    }
    publish();
  }
  function rotateBy(degrees: number, entry?: Entry) {
    if (!canTransform(entry) || !Number.isFinite(degrees)) return;
    stopGesture();
    const panels = snapshot(entry);
    if (panels.length) transform(panels, layoutCentre(panels), 0, 0, degrees);
  }
  function nudge(event: KeyboardEvent, entry?: Entry) {
    const directions: Record<string, number> = { ArrowUp: 0, ArrowRight: 90, ArrowDown: 180, ArrowLeft: 270 };
    if (!canTransform(entry) || !(event.key in directions)) return;
    event.preventDefault(); stopGesture();
    if (entry) select(entry.panel.id);
    const panels = snapshot(entry);
    if (!panels.length) return;
    const pivot = layoutCentre(panels), projection = overlay.getProjection();
    const origin = projection.fromContainerPixelToLatLng(new api.Point(pivot.x, pivot.y));
    if (!origin) return;
    const target = projection.fromLatLngToContainerPixel(api.geometry.spherical.computeOffset(origin, event.shiftKey ? 1 : 0.1, directions[event.key]));
    if (target) transform(panels, pivot, target.x - pivot.x, target.y - pivot.y, 0);
  }
  function rotationKey(event: KeyboardEvent, entry?: Entry) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); rotateBy(["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1, entry);
  }
  function drag(button: HTMLButtonElement, entry: Entry | undefined, rotate: boolean) {
    button.addEventListener("pointerdown", (event) => {
      if (!canTransform(entry) || event.button !== 0 || !ready) return;
      event.preventDefault(); event.stopPropagation();
      stopGesture();
      if (entry) select(entry.panel.id);
      const panels = snapshot(entry);
      if (!panels.length) return;
      const bounds = map.getDiv().getBoundingClientRect();
      gesture = { button, pointerId: event.pointerId, panels, pivot: layoutCentre(panels), start: { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, rotate };
      button.setPointerCapture(event.pointerId);
    }, { signal: events.signal });
    button.addEventListener("pointermove", (event) => {
      const current = gesture;
      if (!current || current.button !== button || current.pointerId !== event.pointerId || !editing || capturing) return;
      const bounds = map.getDiv().getBoundingClientRect();
      const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
      if (current.rotate) {
        const { pivot, start } = current;
        if (Math.hypot(x - pivot.x, y - pivot.y) < 4) return;
        const degrees = (Math.atan2(y - pivot.y, x - pivot.x) - Math.atan2(start.y - pivot.y, start.x - pivot.x)) * 180 / Math.PI;
        transform(current.panels, pivot, 0, 0, degrees);
      } else {
        transform(current.panels, current.pivot, x - current.start.x, y - current.start.y, 0);
      }
    }, { signal: events.signal });
    const stop = (event: PointerEvent) => { if (gesture?.button === button && gesture.pointerId === event.pointerId) stopGesture(); };
    button.addEventListener("pointerup", stop, { signal: events.signal });
    button.addEventListener("pointercancel", stop, { signal: events.signal });
    button.addEventListener("lostpointercapture", stop, { signal: events.signal });
  }
  drag(groupMove, undefined, false); drag(groupRotate, undefined, true);
  groupMove.addEventListener("keydown", (event) => nudge(event), { signal: events.signal });
  groupRotate.addEventListener("keydown", (event) => rotationKey(event), { signal: events.signal });
  const mapListeners = [map.addListener("zoom_changed", stopGesture), map.addListener("center_changed", stopGesture)];

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
    face.addEventListener("click", () => {
      if (!editing || capturing) return;
      if (selectionMode === "choose") {
        stopGesture();
        if (selectedIds.has(panel.id)) selectedIds.delete(panel.id); else selectedIds.add(panel.id);
        publish();
      } else if (selectionMode === "one") select(panel.id);
    }, { signal: events.signal });
    face.addEventListener("keydown", (event) => {
      if (!editing || capturing || selectionMode !== "one") { nudge(event, entry); return; }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); select(panel.id); removeSelected(); return; }
      nudge(event, entry);
    }, { signal: events.signal });
    rotate.addEventListener("keydown", (event) => rotationKey(event, entry), { signal: events.signal });
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
    if (!editing || capturing || selectionMode !== "one") return;
    const source = entries.get(id)?.panel;
    if (source) addPanel(adjacentSolarPanel(source, direction, (from, distance, heading) => api.geometry.spherical.computeOffset(from, distance, heading).toJSON()));
  }
  function removeSelected() {
    if (selectionMode !== "one" || selectedId === null || capturing) return;
    stopGesture();
    entries.get(selectedId)?.element.remove(); entries.delete(selectedId); selectedIds.delete(selectedId); selectedId = null; publish();
  }
  return {
    add: (settings: SolarPanelSettings) => { const center = map.getCenter(); if (center && !capturing) { stopGesture(); selectionMode = "one"; selectedIds.clear(); addPanel({ ...settings, center: center.toJSON(), heading: 0 }); } },
    updateSelected: (values: SolarPanelSettings & { heading: number }) => {
      if (selectionMode !== "one" || capturing) return;
      stopGesture();
      const selected = selectedId === null ? null : entries.get(selectedId);
      if (selected && validSolarPanelSize(values) && validSolarPanelTilt(values) && Number.isFinite(values.heading)) { Object.assign(selected.panel, values, { heading: solarHeading(values.heading) }); publish(); }
    },
    removeSelected,
    setSelectionMode: (value: SolarSelectionMode) => {
      if (capturing) return;
      stopGesture();
      if (value === "selection" && !selectedIds.size) return;
      if (value === "one" || value === "all" || (value === "choose" && selectionMode !== "choose" && selectionMode !== "selection")) selectedIds.clear();
      if (value === "all") entries.forEach(({ panel }) => selectedIds.add(panel.id));
      selectionMode = value; publish();
    },
    rotateSelection: (degrees: number) => { if (selectionMode === "all" || selectionMode === "selection") rotateBy(degrees); },
    clear: () => { stopGesture(); entries.forEach(({ element }) => element.remove()); entries.clear(); selectedId = null; selectedIds.clear(); selectionMode = "one"; publish(); },
    setEditing: (value: boolean) => { stopGesture(); editing = value; publish(); },
    setCapturing: (value: boolean) => { stopGesture(); capturing = value; if (ready) overlay.draw(); },
    dispose: () => { stopGesture(); mapListeners.forEach((listener) => listener.remove()); events.abort(); entries.clear(); overlay.setMap(null); },
  };
}
