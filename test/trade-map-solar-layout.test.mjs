import test from "node:test";
import assert from "node:assert/strict";
import { createTradeMapSolarLayout, DEFAULT_SOLAR_PANEL_SIZE, DEFAULT_SOLAR_PANEL_TILT, sameSolarPanelGeometry, solarPanelCorners } from "../src/lib/trade-map-solar.ts";

function harness(t, options = {}) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  const originalCancelFrame = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback) => setImmediate(() => callback(0)) });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: clearImmediate });
  class Element {
    children = []; style = {}; dataset = {}; attributes = {}; listeners = new Map(); captured = new Set(); hidden = false;
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener, options) { const listeners = this.listeners.get(name) ?? []; listeners.push({ listener, signal: options?.signal }); this.listeners.set(name, listeners); }
    emit(name, data = {}) {
      const event = { button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, composedPath: () => [this], ...data };
      for (const { listener, signal } of this.listeners.get(name) ?? []) if (!signal?.aborted) listener(event);
    }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); this.emit("lostpointercapture", { pointerId: id }); }
    getBoundingClientRect() {
      const element = this.parent, width = Number.parseFloat(element?.style.width ?? 0), height = Number.parseFloat(element?.style.height ?? 0);
      const matrix = (this.style.transform?.match(/matrix\(([^)]+)\)/)?.[1] ?? "1,0,0,1").split(",").map(Number);
      const angle = Number(element?.style.transform?.match(/rotate\(([^d]+)deg\)/)?.[1] ?? 0) * Math.PI / 180;
      const cx = Number.parseFloat(element?.style.left ?? 0), cy = Number.parseFloat(element?.style.top ?? 0);
      const points = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx, sy]) => {
        const x = sx * width / 2 * matrix[0] + sy * height / 2 * matrix[2], y = sy * height / 2 * matrix[3];
        return { x: cx + x * Math.cos(angle) - y * Math.sin(angle), y: cy + x * Math.sin(angle) + y * Math.cos(angle) };
      });
      const left = Math.min(...points.map((p) => p.x)), right = Math.max(...points.map((p) => p.x));
      const top = Math.min(...points.map((p) => p.y)), bottom = Math.max(...points.map((p) => p.y));
      return { left, right, top, bottom, width: right - left, height: bottom - top };
    }
  }
  const pane = new Element();
  const mapElement = new Element(); mapElement.style.touchAction = "pan-y";
  mapElement.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => new Element() } });
  t.after(() => { if (original) Object.defineProperty(globalThis, "document", original); else delete globalThis.document; });
  t.after(() => {
    if (originalFrame) Object.defineProperty(globalThis, "requestAnimationFrame", originalFrame); else delete globalThis.requestAnimationFrame;
    if (originalCancelFrame) Object.defineProperty(globalThis, "cancelAnimationFrame", originalCancelFrame); else delete globalThis.cancelAnimationFrame;
  });
  class LatLng {
    constructor(value) { this.value = value instanceof LatLng ? value.toJSON() : { ...value }; }
    toJSON() { return { ...this.value }; }
  }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class LatLngBounds { points = []; extend(point) { this.points.push(point); return this; } }
  let scale = 1, shift = { x: 0, y: 0 };
  const projection = {
    fromLatLngToDivPixel: (point) => new Point(point.toJSON().lng * scale + shift.x, -point.toJSON().lat * scale + shift.y),
    fromLatLngToContainerPixel: (point) => new Point(point.toJSON().lng * scale + shift.x, -point.toJSON().lat * scale + shift.y),
    fromContainerPixelToLatLng: (point) => new LatLng({ lat: -(point.y - shift.y) / scale, lng: (point.x - shift.x) / scale }),
  };
  class Overlay {
    static preventMapHitsAndGesturesFrom() {}
    setMap(value) { if (value) { this.onAdd(); this.draw(); } else this.onRemove(); }
    getPanes() { return { overlayMouseTarget: pane }; }
    getProjection() { return projection; }
  }
  const mapListeners = new Map(), listenerGroups = new Map();
  let mapCenter = { lat: 0, lng: 0 }, mapZoom = 20, value;
  const mapOptions = { draggable: true, gestureHandling: "cooperative", scrollwheel: true, keyboardShortcuts: true,
    disableDoubleClickZoom: false, zoomControl: true, cameraControl: false, fullscreenControl: true };
  const fitCalls = [];
  const map = {
    getCenter: () => new LatLng(mapCenter), getDiv: () => mapElement,
    get: (key) => mapOptions[key], setOptions: (value) => Object.assign(mapOptions, value), getZoom: () => mapZoom,
    setCenter: (center) => { mapCenter = center instanceof LatLng ? center.toJSON() : { ...center }; }, setZoom: (value) => { mapZoom = value; },
    fitBounds(bounds, padding) {
      fitCalls.push({ points: bounds.points, padding });
      if (options.fitMoves !== false) {
        const xs = bounds.points.map((p) => p.lng), ys = bounds.points.map((p) => -p.lat);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        scale = Math.min((400 - padding * 2) / (maxX - minX), (300 - padding * 2) / (maxY - minY), 24);
        shift = { x: 200 - (minX + maxX) / 2 * scale, y: 150 - (minY + maxY) / 2 * scale };
        mapCenter = { lng: (minX + maxX) / 2, lat: -(minY + maxY) / 2 }; mapZoom = 19;
        mapListeners.get("center_changed")?.(); mapListeners.get("zoom_changed")?.();
      }
      if (options.fitIdle !== false) queueMicrotask(() => mapListeners.get("idle")?.());
    },
    addListener(name, listener) {
      const group = listenerGroups.get(name) ?? new Set(); group.add(listener); listenerGroups.set(name, group);
      mapListeners.set(name, () => { for (const callback of [...group]) callback(); });
      return { remove: () => { group.delete(listener); if (!group.size) { listenerGroups.delete(name); mapListeners.delete(name); } } };
    },
  };
  const api = { OverlayView: Overlay, LatLng, LatLngBounds, Point, geometry: { spherical: { computeOffset(from, metres, heading) {
    const point = from instanceof LatLng ? from.toJSON() : from, radians = heading * Math.PI / 180;
    return new LatLng({ lat: point.lat + metres * Math.cos(radians), lng: point.lng + metres * Math.sin(radians) });
  } } } };
  const styles = Object.fromEntries(["panel", "face", "controls", "ring", "rotate", "copy", "group", "move", "selectionBox"].map((name) => [name, name]));
  const controller = createTradeMapSolarLayout(api, map, styles, (next) => { value = next; });
  controller.setEditing(true);
  t.after(() => controller.dispose());
  const walk = (element) => [element, ...element.children.flatMap(walk)];
  const elements = () => walk(pane);
  const panel = (id) => elements().find((element) => element.dataset.solarPanelId === String(id));
  return {
    controller, value: () => value, pane, mapElement, mapListeners, map, mapOptions, fitCalls,
    selectionBox: () => mapElement.children.find((element) => element.className === "selectionBox"),
    face: (id) => panel(id).children[0],
    group: () => elements().find((element) => element.className === "group"),
    button: (label) => elements().find((element) => element.attributes["aria-label"] === label),
    copy: (id, direction) => panel(id).children[1].children.find((element) => element.dataset.direction === direction).emit("click"),
    add(x, y, heading = 0, tilt = DEFAULT_SOLAR_PANEL_TILT) {
      mapCenter = { lat: -y, lng: x };
      controller.add({ ...DEFAULT_SOLAR_PANEL_SIZE, ...tilt });
      controller.updateSelected({ ...DEFAULT_SOLAR_PANEL_SIZE, ...tilt, heading });
      return value.selectedId;
    },
  };
}

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const positions = (h) => h.value().panels.map((panel) => ({ x: panel.center.lng, y: -panel.center.lat, heading: panel.heading }));
const distance = (a, b) => Math.hypot(a.center.lat - b.center.lat, a.center.lng - b.center.lng);

test("saved panels reopen at the same coordinates with independent model snapshots and identities", (t) => {
  const h = harness(t);
  const equipment = { id: "own-panel", kind: "panel", name: "Own 440", manufacturer: "Test", model: "P440", quantity: 1, watts: 440, widthM: 1.134, lengthM: 1.762 };
  const panels = [{ id: 12, center: { lat: -37.8, lng: 145 }, heading: 37, lengthTilt: 22.5, widthTilt: 0, widthM: 1.134, lengthM: 1.762, equipment }];
  h.controller.restore(panels);
  assert.deepEqual(h.value().panels, panels);
  assert.equal(h.value().selectedId, null);
  h.face(12).emit("click"); h.copy(12, "right");
  assert.equal(h.value().selectedId, 13);
  assert.deepEqual(h.value().panels[1].equipment, equipment);
  panels[0].center.lat = 0; equipment.watts = 900;
  assert.equal(h.value().panels[0].center.lat, -37.8);
  assert.equal(h.value().panels[0].equipment.watts, 440);
});

test("changing equipment affects only chosen panels; custom dimensions remove the model claim", (t) => {
  const h = harness(t); h.add(0, 0); h.add(10, 0); h.add(20, 0);
  const equipment = { id: "p440", kind: "panel", name: "440", manufacturer: "Test", model: "P440", quantity: 1, watts: 440, widthM: 1.134, lengthM: 1.762 };
  h.controller.setSelectionMode("choose"); h.face(1).emit("click"); h.face(3).emit("click");
  h.controller.applyEquipment(equipment);
  assert.deepEqual(h.value().panels.map((p) => p.equipment?.watts), [440, undefined, 440]);
  h.controller.setSelectionMode("one"); h.face(1).emit("click");
  h.controller.updateSelected({ widthM: 1.2, lengthM: 1.8, lengthTilt: 0, widthTilt: 0, heading: 0 });
  assert.equal(h.value().panels[0].equipment, undefined);
  assert.equal(h.value().panels[2].equipment.watts, 440);
});

test("invalid restored geometry is rejected without losing the current layout", (t) => {
  const h = harness(t); h.add(0, 0);
  const before = structuredClone(h.value());
  assert.throws(() => h.controller.restore([{ ...before.panels[0], center: { lat: NaN, lng: 0 } }]));
  assert.deepEqual(h.value(), before);
});

for (const mode of ["one", "all", "choose", "selection"]) test(`capture hides every editing overlay in ${mode} mode and restores the selection`, (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0);
  if (mode === "choose" || mode === "selection") { h.controller.setSelectionMode("choose"); h.face(1).emit("click"); }
  h.controller.setSelectionMode(mode);
  const original = structuredClone(h.value());
  const visible = (element) => element && !element.hidden && (!element.parent || visible(element.parent));
  const walk = (element) => [element, ...element.children.flatMap(walk)];
  h.controller.setCapturing(true);
  for (const element of walk(h.pane).filter((element) => ["controls", "ring", "rotate", "copy", "group", "move"].includes(element.className))) {
    assert.equal(visible(element), false, `${element.className} must not appear in the image`);
  }
  assert.equal(h.selectionBox().hidden, true);
  for (const id of [1, 2]) {
    assert.equal(visible(h.face(id)), true, "the panels themselves remain visible");
    assert.equal(h.face(id).parent.dataset.selected, "false");
    assert.equal(h.face(id).parent.dataset.capturing, "true", "capture styling also suppresses focus outlines");
  }
  h.controller.setCapturing(false);
  assert.deepEqual(h.value(), original);
  assert.equal(h.face(1).parent.dataset.capturing, "false");
  assert.equal(visible(h.group()), mode === "all" || mode === "selection");
  assert.equal(visible(h.face(2).parent.children[1]), mode === "one");
});

test("dragging any face moves all panels from the gesture start without accumulating deltas", (t) => {
  const h = harness(t); h.add(-4, 0, 350); h.add(4, 0, 15, { lengthTilt: 0, widthTilt: 30 });
  const original = structuredClone(h.value().panels);
  h.controller.setSelectionMode("all");
  const face = h.face(1);
  face.emit("pointerdown", { clientX: -3, clientY: 1 });
  face.emit("pointermove", { clientX: 7, clientY: 6 });
  face.emit("pointermove", { clientX: 17, clientY: 11 });
  face.emit("pointerup");
  assert.equal(h.value().selectionMode, "all");
  assert.equal(h.value().selectedId, 1);
  assert.deepEqual(positions(h), [{ x: 16, y: 10, heading: 350 }, { x: 24, y: 10, heading: 15 }]);
  h.value().panels.forEach((panel, index) => assert.deepEqual({ ...panel, center: original[index].center }, original[index]));
  close(distance(...h.value().panels), distance(...original));
});

test("group rotation preserves the fixed centre, spacing, mixed headings and tilt", (t) => {
  const h = harness(t); h.add(-4, 0, 350); h.add(4, 0, 15, { lengthTilt: 45, widthTilt: 30 });
  const original = structuredClone(h.value().panels);
  h.controller.setSelectionMode("all");
  const rotate = h.button("Rotate all solar panels");
  rotate.emit("pointerdown", { clientX: 10, clientY: 0 });
  rotate.emit("pointermove", { clientX: 10, clientY: 10 });
  rotate.emit("pointermove", { clientX: 0, clientY: 10 });
  rotate.emit("pointerup");
  const result = positions(h);
  close(result[0].x, 0); close(result[0].y, -4); close(result[1].x, 0); close(result[1].y, 4);
  close(result[0].heading, 80); close(result[1].heading, 105);
  close(distance(...h.value().panels), distance(...original));
  h.value().panels.forEach((panel, index) => assert.deepEqual({ ...panel, center: original[index].center, heading: original[index].heading }, original[index]));
  close(Number.parseFloat(h.group().style.left), 0); close(Number.parseFloat(h.group().style.top), 0);
});

test("one-panel mode remains isolated and switching scope preserves the layout", (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0);
  const original = structuredClone(h.value().panels);
  h.controller.setSelectionMode("all"); h.controller.setSelectionMode("one");
  assert.deepEqual(h.value().panels, original);
  const face = h.face(1);
  face.emit("pointerdown", { clientX: -4, clientY: 0 });
  face.emit("pointermove", { clientX: -2, clientY: 3 }); face.emit("pointerup");
  assert.deepEqual(h.value().panels[1], original[1]);
  assert.deepEqual(positions(h)[0], { x: -2, y: 3, heading: 0 });
  assert.equal(h.group().hidden, true);
});

test("centre handle, keyboard nudges and fine rotation respect all-panel scope", (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0); h.controller.setSelectionMode("all");
  const move = h.button("Move all solar panels");
  move.emit("pointerdown", { clientX: 0, clientY: 0 });
  move.emit("pointermove", { clientX: 10, clientY: 10 }); move.emit("pointerup");
  move.emit("keydown", { key: "ArrowRight" });
  h.face(1).emit("keydown", { key: "ArrowDown", shiftKey: true });
  for (const [index, point] of positions(h).entries()) { close(point.x, index ? 14.1 : 6.1); close(point.y, 11); }
  h.button("Rotate all solar panels").emit("keydown", { key: "ArrowRight" });
  h.controller.rotateSelection(-1);
  for (const [index, point] of positions(h).entries()) { close(point.x, index ? 14.1 : 6.1); close(point.y, 11); close(point.heading, 0); }
  h.controller.setSelectionMode("one");
  h.face(1).emit("keydown", { key: "ArrowLeft" });
  close(positions(h)[0].x, 6); close(positions(h)[1].x, 14.1);
});

for (const reason of ["pointercancel", "capture", "close", "scope", "zoom", "pan"]) test(`${reason} stops a group gesture without later pointer mutation`, (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0); h.controller.setSelectionMode("all");
  const face = h.face(1);
  face.emit("pointerdown", { clientX: -4, clientY: 0 });
  face.emit("pointermove", { clientX: 1, clientY: 5 });
  const before = structuredClone(h.value().panels);
  if (reason === "pointercancel") face.emit("pointercancel");
  if (reason === "capture") { h.controller.setCapturing(true); assert.equal(h.group().hidden, true); }
  if (reason === "close") { h.controller.setEditing(false); assert.equal(h.group().hidden, true); }
  if (reason === "scope") h.controller.setSelectionMode("one");
  if (reason === "zoom") h.mapListeners.get("zoom_changed")();
  if (reason === "pan") h.mapListeners.get("center_changed")();
  face.emit("pointermove", { clientX: 40, clientY: 50 });
  assert.deepEqual(h.value().panels, before);
  assert.equal(face.hasPointerCapture(1), false);
});

test("all-panel mode hides copy controls, protects individual edits and cleans up", (t) => {
  const h = harness(t); h.add(-4, 0); h.copy(1, "right"); h.controller.setSelectionMode("all");
  const before = structuredClone(h.value().panels);
  h.controller.updateSelected({ ...DEFAULT_SOLAR_PANEL_SIZE, ...DEFAULT_SOLAR_PANEL_TILT, heading: 90 });
  assert.deepEqual(h.value().panels, before);
  assert.equal(h.face(1).parent.children[1].hidden, true);
  assert.equal(h.face(1).parent.dataset.selected, "true");
  assert.equal(h.face(2).parent.dataset.selected, "true");
  const move = h.button("Move all solar panels");
  h.controller.clear();
  assert.equal(h.group().hidden, true); assert.equal(h.value().selectionMode, "one"); assert.equal(h.value().panels.length, 0);
  h.controller.dispose();
  move.emit("keydown", { key: "ArrowRight" });
  assert.equal(h.pane.children.length, 0); assert.equal(h.mapListeners.size, 0);
});

for (const pointerType of ["mouse", "touch"]) test(`${pointerType} drag box selects only enclosed panel centres and permits tap adjustment`, (t) => {
  const h = harness(t); h.add(-4, -2); h.add(4, 2); h.add(20, 20);
  const before = structuredClone(h.value().panels);
  h.controller.setSelectionMode("choose");
  assert.equal(h.mapElement.style.touchAction, "none");
  h.mapElement.emit("pointerdown", { pointerType, clientX: 5, clientY: 3 });
  h.mapElement.emit("pointermove", { pointerType, clientX: -5, clientY: -3 });
  assert.equal(h.selectionBox().hidden, false);
  assert.deepEqual(h.value().selectedIds, [1, 2]);
  h.mapElement.emit("pointerup", { pointerType, clientX: -5, clientY: -3 });
  assert.equal(h.selectionBox().hidden, true);
  assert.equal(h.mapElement.hasPointerCapture(1), false);
  h.face(2).emit("click"); h.face(3).emit("click");
  assert.deepEqual(h.value().selectedIds, [1, 3]);
  assert.equal(h.face(1).parent.dataset.selected, "true");
  assert.equal(h.face(2).parent.dataset.selected, "false");
  assert.deepEqual(h.value().panels, before);
  h.controller.setSelectionMode("selection");
  assert.equal(h.mapElement.style.touchAction, "pan-y");
  assert.equal(h.group().hidden, false);
});

test("chosen panels move and rotate around their own centre while other panels stay unchanged", (t) => {
  const h = harness(t); h.add(-4, 0, 350); h.add(4, 0, 15, { lengthTilt: 0, widthTilt: 30 }); h.add(40, 30, 60);
  const original = structuredClone(h.value().panels);
  h.controller.setSelectionMode("choose"); h.face(1).emit("click"); h.face(2).emit("click"); h.controller.setSelectionMode("selection");
  const rotate = h.button("Rotate selected solar panels");
  rotate.emit("pointerdown", { clientX: 10, clientY: 0 });
  rotate.emit("pointermove", { clientX: 10, clientY: 10 });
  rotate.emit("pointermove", { clientX: 0, clientY: 10 }); rotate.emit("pointerup");
  const rotated = positions(h);
  close(rotated[0].x, 0); close(rotated[0].y, -4); close(rotated[1].x, 0); close(rotated[1].y, 4);
  close(rotated[0].heading, 80); close(rotated[1].heading, 105);
  close(distance(...h.value().panels.slice(0, 2)), distance(...original.slice(0, 2)));
  assert.deepEqual(h.value().panels[2], original[2]);
  const move = h.button("Move selected solar panels");
  move.emit("pointerdown", { clientX: 0, clientY: 0 });
  move.emit("pointermove", { clientX: 5, clientY: 5 });
  move.emit("pointermove", { clientX: 10, clientY: 10 }); move.emit("pointerup");
  const moved = positions(h);
  close(moved[0].x, 10); close(moved[0].y, 6); close(moved[1].x, 10); close(moved[1].y, 14);
  assert.deepEqual(h.value().panels[2], original[2]);
  const beforeUnselectedDrag = structuredClone(h.value().panels);
  h.face(3).emit("pointerdown", { clientX: 40, clientY: 30 }); h.face(3).emit("pointermove", { clientX: 60, clientY: 50 }); h.face(3).emit("pointerup");
  assert.deepEqual(h.value().panels, beforeUnselectedDrag);
});

test("keyboard button activation toggles a chosen panel without moving or deleting it", (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0);
  const original = structuredClone(h.value().panels);
  h.controller.setSelectionMode("choose");
  const face = h.face(1);
  assert.equal(face.type, "button"); assert.equal(face.tabIndex, 0);
  // Native Enter/Space activation dispatches a click with detail 0.
  face.emit("click", { detail: 0 }); assert.equal(face.attributes["aria-pressed"], "true");
  face.emit("keydown", { key: "ArrowRight" }); face.emit("keydown", { key: "Delete" });
  face.emit("pointerdown", { clientX: -4, clientY: 0 }); face.emit("pointermove", { clientX: 5, clientY: 10 }); face.emit("pointerup");
  assert.deepEqual(h.value().panels, original);
  assert.deepEqual(h.value().selectedIds, [1]);
  assert.equal(face.hasPointerCapture(1), false);
  face.emit("click", { detail: 0 }); assert.equal(face.attributes["aria-pressed"], "false");
  h.controller.setSelectionMode("selection"); assert.equal(h.value().selectionMode, "choose");
  face.emit("click", { detail: 0 }); h.controller.setSelectionMode("selection");
  h.button("Move selected solar panels").emit("keydown", { key: "ArrowRight" });
  close(positions(h)[0].x, -3.9); assert.deepEqual(h.value().panels[1], original[1]);
  h.button("Rotate selected solar panels").emit("keydown", { key: "ArrowRight" });
  close(positions(h)[0].heading, 1);
});

for (const reason of ["pointercancel", "capture", "close", "scope", "zoom", "pan", "dispose"]) test(`${reason} cancels a drag selection and restores the prior selection`, (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0); h.controller.setSelectionMode("choose"); h.face(1).emit("click");
  const box = h.selectionBox();
  h.mapElement.emit("pointerdown", { clientX: -5, clientY: -2 });
  h.mapElement.emit("pointermove", { clientX: 5, clientY: 2 });
  assert.deepEqual(h.value().selectedIds, [1, 2]);
  if (reason === "pointercancel") h.mapElement.emit("pointercancel");
  if (reason === "capture") h.controller.setCapturing(true);
  if (reason === "close") h.controller.setEditing(false);
  if (reason === "scope") h.controller.setSelectionMode("one");
  if (reason === "zoom") h.mapListeners.get("zoom_changed")();
  if (reason === "pan") h.mapListeners.get("center_changed")();
  if (reason === "dispose") h.controller.dispose();
  assert.equal(box.hidden, true); assert.equal(h.mapElement.hasPointerCapture(1), false);
  h.mapElement.emit("pointermove", { clientX: 40, clientY: 50 });
  assert.deepEqual(h.value().selectedIds, reason === "scope" ? [] : [1]);
  if (["capture", "close", "scope", "dispose"].includes(reason)) assert.equal(h.mapElement.style.touchAction, "pan-y");
});

test("selection edits cannot alter dimensions or copy panels, and add/remove/clear cannot retain stale group members", (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0); h.controller.setSelectionMode("choose"); h.face(1).emit("click"); h.controller.setSelectionMode("selection");
  const original = structuredClone(h.value().panels);
  h.controller.updateSelected({ ...DEFAULT_SOLAR_PANEL_SIZE, ...DEFAULT_SOLAR_PANEL_TILT, heading: 90 }); h.copy(1, "right");
  assert.deepEqual(h.value().panels, original);
  assert.equal(h.face(1).parent.children[1].hidden, true);
  h.controller.setCapturing(true);
  assert.equal(h.group().hidden, true); assert.equal(h.face(1).parent.dataset.selected, "false"); assert.equal(h.face(1).tabIndex, -1);
  h.controller.setCapturing(false);
  h.add(40, 40); assert.equal(h.value().selectionMode, "one"); assert.deepEqual(h.value().selectedIds, []);
  h.controller.removeSelected(); assert.equal(h.value().panels.length, 2);
  h.controller.setSelectionMode("all"); assert.deepEqual(h.value().selectedIds, [1, 2]);
  h.controller.clear(); assert.deepEqual(h.value().selectedIds, []); assert.equal(h.value().panels.length, 0); assert.equal(h.group().hidden, true);
});

test("removing one selected panel preserves every other panel and publishes the new layout", (t) => {
  const h = harness(t); h.add(-4, 0, 15); h.add(4, 0, 37); h.add(20, 20, 90);
  const original = structuredClone(h.value().panels);
  h.face(2).emit("click"); h.controller.removeSelected();
  assert.deepEqual(h.value(), { panels: [original[0], original[2]], selectedId: null, selectedIds: [], selectionMode: "one" });
  assert.equal(h.pane.children[0].children.some((element) => element.dataset.solarPanelId === "2"), false);
});

for (const mode of ["choose", "selection"]) test(`removing ${mode} panels deletes only the chosen subset and clears stale selection`, (t) => {
  const h = harness(t); h.add(-4, 0, 15); h.add(4, 0, 37); h.add(20, 20, 90);
  const original = structuredClone(h.value().panels);
  h.controller.setSelectionMode("choose"); h.face(1).emit("click"); h.face(3).emit("click");
  h.controller.setSelectionMode(mode); h.controller.removeSelected();
  assert.deepEqual(h.value(), { panels: [original[1]], selectedId: null, selectedIds: [], selectionMode: "one" });
  assert.equal(h.group().hidden, true);
  h.controller.setSelectionMode("all"); assert.deepEqual(h.value().selectedIds, [2]);
});

test("removing all panels or the final panel yields an empty layout that can be restored and extended", (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0); h.controller.setSelectionMode("all");
  h.controller.removeSelected();
  const empty = { panels: [], selectedId: null, selectedIds: [], selectionMode: "one" };
  assert.deepEqual(h.value(), empty); assert.equal(h.group().hidden, true);
  h.controller.restore(h.value().panels); assert.deepEqual(h.value(), empty);
  const next = h.add(20, 20); h.controller.removeSelected(); assert.deepEqual(h.value(), empty);
  assert.equal(next, 1);
  assert.equal(h.add(40, 40), 2, "deletion does not reuse an identity in the current layout");
});

test("removing with no panel selected does not delete the last touched panel or change the layout", (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0); h.controller.setSelectionMode("choose");
  const before = structuredClone(h.value());
  h.controller.removeSelected(); assert.deepEqual(h.value(), before);
  h.controller.restore(before.panels);
  const restored = structuredClone(h.value());
  h.controller.removeSelected(); assert.deepEqual(h.value(), restored);
});

for (const mode of ["one", "all", "choose", "selection"]) test(`removal respects capture and editing locks in ${mode} mode`, (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0);
  if (mode === "choose" || mode === "selection") { h.controller.setSelectionMode("choose"); h.face(1).emit("click"); }
  h.controller.setSelectionMode(mode);
  const before = structuredClone(h.value());
  h.controller.setCapturing(true); h.controller.removeSelected(); assert.deepEqual(h.value(), before);
  h.controller.setCapturing(false); h.controller.setEditing(false); h.controller.removeSelected(); assert.deepEqual(h.value(), before);
  h.controller.setEditing(true); h.controller.removeSelected();
  assert.equal(h.value().panels.length, mode === "all" ? 0 : 1);
});

test("removing selected panels stops an active group drag so later pointer events cannot move survivors", (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0); h.add(20, 20);
  h.controller.setSelectionMode("choose"); h.face(1).emit("click"); h.face(2).emit("click"); h.controller.setSelectionMode("selection");
  const move = h.button("Move selected solar panels");
  move.emit("pointerdown", { clientX: 0, clientY: 0 }); move.emit("pointermove", { clientX: 5, clientY: 5 });
  const survivor = structuredClone(h.value().panels[2]);
  h.controller.removeSelected();
  assert.equal(move.hasPointerCapture(1), false);
  move.emit("pointermove", { clientX: 100, clientY: 100 }); move.emit("pointerup");
  assert.deepEqual(h.value().panels, [survivor]);
});

test("removing during drag selection uses the currently highlighted panels and cancels the selection box", (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0); h.add(20, 20);
  const survivor = structuredClone(h.value().panels[2]);
  h.controller.setSelectionMode("choose"); h.face(3).emit("click");
  h.mapElement.emit("pointerdown", { clientX: -5, clientY: -2 }); h.mapElement.emit("pointermove", { clientX: 5, clientY: 2 });
  assert.deepEqual(h.value().selectedIds, [1, 2]);
  h.controller.removeSelected();
  assert.deepEqual(h.value(), { panels: [survivor], selectedId: null, selectedIds: [], selectionMode: "one" });
  assert.equal(h.selectionBox().hidden, true); assert.equal(h.mapElement.hasPointerCapture(1), false);
  h.mapElement.emit("pointermove", { clientX: 40, clientY: 50 }); h.mapElement.emit("pointerup");
  assert.deepEqual(h.value().panels, [survivor]); assert.deepEqual(h.value().selectedIds, []);
});

test("capture fits every rotated and tilted face before attaching a layout that was off-screen", async (t) => {
  const h = harness(t); h.add(-50, -30, 37); h.add(450, 330, 120, { lengthTilt: 35, widthTilt: 20 });
  const original = structuredClone(h.value()), options = { ...h.mapOptions }, listeners = h.mapListeners.size;
  const abort = new AbortController(); let invalidations = 0;
  const capture = h.controller.beginCapture(abort.signal, () => { invalidations++; abort.abort(); });
  assert.equal(h.mapOptions.gestureHandling, "none"); assert.equal(h.mapOptions.zoomControl, false);
  assert.equal(h.face(1).parent.children[1].hidden, true);
  await capture.ensureVisible();
  assert.equal(invalidations, 0, "camera movement while fitting is allowed");
  assert.equal(h.fitCalls.length, 1); assert.equal(h.fitCalls[0].padding, 48);
  const expected = original.panels.flatMap((panel) => solarPanelCorners(panel, (from, metres, heading) => ({
    lat: from.lat + metres * Math.cos(heading * Math.PI / 180), lng: from.lng + metres * Math.sin(heading * Math.PI / 180),
  })));
  assert.deepEqual(h.fitCalls[0].points, expected, "the bounds include all actual face corners");
  capture.assertVisible();
  h.controller.clear(); h.controller.removeSelected(); h.controller.add({ ...DEFAULT_SOLAR_PANEL_SIZE, ...DEFAULT_SOLAR_PANEL_TILT });
  assert.deepEqual(h.value(), original, "capture freezes the geometry against editing");
  capture.restore(); capture.restore();
  assert.deepEqual(h.mapOptions, options); assert.equal(h.mapListeners.size, listeners);
  assert.deepEqual(h.value(), original);
});

test("capture preserves a view where all panels are already visible", async (t) => {
  const h = harness(t); h.add(100, 100); h.add(200, 200);
  const capture = h.controller.beginCapture(new AbortController().signal, () => assert.fail("camera should not change"));
  await capture.ensureVisible(); capture.assertVisible(); capture.restore();
  assert.equal(h.fitCalls.length, 0);
});

test("failed fitting refuses capture rather than claiming invisible panels are included", async (t) => {
  const h = harness(t, { fitMoves: false }); h.add(-50, -30);
  const capture = h.controller.beginCapture(new AbortController().signal, () => assert.fail("no camera change"));
  await assert.rejects(capture.ensureVisible(), /full solar layout is not visible/);
  capture.restore(); assert.equal(h.mapOptions.gestureHandling, "cooperative");
});

for (const event of ["center_changed", "zoom_changed", "heading_changed", "tilt_changed", "maptypeid_changed"]) {
  test(`${event} after fitting invalidates capture and restores camera controls`, async (t) => {
    const h = harness(t); h.add(100, 100);
    const before = structuredClone(h.value()), options = { ...h.mapOptions }, listeners = h.mapListeners.size;
    const abort = new AbortController(); let invalidations = 0;
    const capture = h.controller.beginCapture(abort.signal, () => { invalidations++; abort.abort(); });
    await capture.ensureVisible(); h.mapListeners.get(event)();
    assert.equal(invalidations, 1); assert.equal(abort.signal.aborted, true);
    assert.throws(() => capture.assertVisible(), /Capture cancelled/);
    assert.deepEqual(h.mapOptions, options); assert.deepEqual(h.value(), before);
    assert.equal(h.mapListeners.size, listeners, "only capture listeners are removed");
  });
}

test("cancelling while fitting restores the prior camera and removes the pending idle listener", async (t) => {
  const h = harness(t, { fitIdle: false }); h.add(-50, -30);
  const center = h.map.getCenter().toJSON(), zoom = h.map.getZoom(), options = { ...h.mapOptions }, listeners = h.mapListeners.size;
  const abort = new AbortController();
  const capture = h.controller.beginCapture(abort.signal, () => abort.abort());
  const fitting = capture.ensureVisible(); abort.abort();
  await assert.rejects(fitting, /Capture cancelled/);
  assert.deepEqual(h.map.getCenter().toJSON(), center); assert.equal(h.map.getZoom(), zoom);
  assert.deepEqual(h.mapOptions, options); assert.equal(h.mapListeners.size, listeners);
});

test("saved geometry equality is independent of ordering and rejects every changed face attribute", () => {
  const first = { id: 1, center: { lat: -37.8, lng: 144.96 }, ...DEFAULT_SOLAR_PANEL_SIZE, ...DEFAULT_SOLAR_PANEL_TILT, heading: 15 };
  const second = { ...first, id: 2, center: { lat: -37.9, lng: 144.97 } };
  assert.equal(sameSolarPanelGeometry([first, second], [structuredClone(second), structuredClone(first)]), true);
  assert.equal(sameSolarPanelGeometry([first, second], [first]), false);
  assert.equal(sameSolarPanelGeometry([first, second], [first, first]), false);
  for (const key of ["id", "widthM", "lengthM", "lengthTilt", "widthTilt", "heading"]) {
    assert.equal(sameSolarPanelGeometry([first], [{ ...first, [key]: first[key] + 1 }]), false, key);
  }
  for (const key of ["lat", "lng"]) assert.equal(sameSolarPanelGeometry([first], [{ ...first, center: { ...first.center, [key]: first.center[key] + 0.01 } }]), false, key);
});
