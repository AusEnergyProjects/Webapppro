import test from "node:test";
import assert from "node:assert/strict";
import { createTradeMapSolarLayout, DEFAULT_SOLAR_PANEL_SIZE, DEFAULT_SOLAR_PANEL_TILT } from "../src/lib/trade-map-solar.ts";

function harness(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  class Element {
    children = []; style = {}; dataset = {}; attributes = {}; listeners = new Map(); captured = new Set(); hidden = false;
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener, options) { const listeners = this.listeners.get(name) ?? []; listeners.push({ listener, signal: options?.signal }); this.listeners.set(name, listeners); }
    emit(name, data = {}) {
      const event = { button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {}, ...data };
      for (const { listener, signal } of this.listeners.get(name) ?? []) if (!signal?.aborted) listener(event);
    }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); this.emit("lostpointercapture", { pointerId: id }); }
  }
  const pane = new Element();
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => new Element() } });
  t.after(() => { if (original) Object.defineProperty(globalThis, "document", original); else delete globalThis.document; });
  class LatLng {
    constructor(value) { this.value = value instanceof LatLng ? value.toJSON() : { ...value }; }
    toJSON() { return { ...this.value }; }
  }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  const projection = {
    fromLatLngToDivPixel: (point) => new Point(point.toJSON().lng, -point.toJSON().lat),
    fromLatLngToContainerPixel: (point) => new Point(point.toJSON().lng, -point.toJSON().lat),
    fromContainerPixelToLatLng: (point) => new LatLng({ lat: -point.y, lng: point.x }),
  };
  class Overlay {
    static preventMapHitsAndGesturesFrom() {}
    setMap(value) { if (value) { this.onAdd(); this.draw(); } else this.onRemove(); }
    getPanes() { return { overlayMouseTarget: pane }; }
    getProjection() { return projection; }
  }
  const mapListeners = new Map();
  let mapCenter = { lat: 0, lng: 0 }, value;
  const map = {
    getCenter: () => new LatLng(mapCenter), getDiv: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }),
    addListener(name, listener) { mapListeners.set(name, listener); return { remove: () => mapListeners.delete(name) }; },
  };
  const api = { OverlayView: Overlay, LatLng, Point, geometry: { spherical: { computeOffset(from, metres, heading) {
    const point = from instanceof LatLng ? from.toJSON() : from, radians = heading * Math.PI / 180;
    return new LatLng({ lat: point.lat + metres * Math.cos(radians), lng: point.lng + metres * Math.sin(radians) });
  } } } };
  const styles = Object.fromEntries(["panel", "face", "controls", "ring", "rotate", "copy", "group", "move"].map((name) => [name, name]));
  const controller = createTradeMapSolarLayout(api, map, styles, (next) => { value = next; });
  controller.setEditing(true);
  t.after(() => controller.dispose());
  const walk = (element) => [element, ...element.children.flatMap(walk)];
  const elements = () => walk(pane);
  const panel = (id) => elements().find((element) => element.dataset.solarPanelId === String(id));
  return {
    controller, value: () => value, pane, mapListeners,
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

test("dragging any face moves all panels from the gesture start without accumulating deltas", (t) => {
  const h = harness(t); h.add(-4, 0, 350); h.add(4, 0, 15, { lengthTilt: 0, widthTilt: 30 });
  const original = structuredClone(h.value().panels);
  h.controller.setAllPanels(true);
  const face = h.face(1);
  face.emit("pointerdown", { clientX: -3, clientY: 1 });
  face.emit("pointermove", { clientX: 7, clientY: 6 });
  face.emit("pointermove", { clientX: 17, clientY: 11 });
  face.emit("pointerup");
  assert.equal(h.value().allPanels, true);
  assert.equal(h.value().selectedId, 1);
  assert.deepEqual(positions(h), [{ x: 16, y: 10, heading: 350 }, { x: 24, y: 10, heading: 15 }]);
  h.value().panels.forEach((panel, index) => assert.deepEqual({ ...panel, center: original[index].center }, original[index]));
  close(distance(...h.value().panels), distance(...original));
});

test("group rotation preserves the fixed centre, spacing, mixed headings and tilt", (t) => {
  const h = harness(t); h.add(-4, 0, 350); h.add(4, 0, 15, { lengthTilt: 45, widthTilt: 30 });
  const original = structuredClone(h.value().panels);
  h.controller.setAllPanels(true);
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
  h.controller.setAllPanels(true); h.controller.setAllPanels(false);
  assert.deepEqual(h.value().panels, original);
  const face = h.face(1);
  face.emit("pointerdown", { clientX: -4, clientY: 0 });
  face.emit("pointermove", { clientX: -2, clientY: 3 }); face.emit("pointerup");
  assert.deepEqual(h.value().panels[1], original[1]);
  assert.deepEqual(positions(h)[0], { x: -2, y: 3, heading: 0 });
  assert.equal(h.group().hidden, true);
});

test("centre handle, keyboard nudges and fine rotation respect all-panel scope", (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0); h.controller.setAllPanels(true);
  const move = h.button("Move all solar panels");
  move.emit("pointerdown", { clientX: 0, clientY: 0 });
  move.emit("pointermove", { clientX: 10, clientY: 10 }); move.emit("pointerup");
  move.emit("keydown", { key: "ArrowRight" });
  h.face(1).emit("keydown", { key: "ArrowDown", shiftKey: true });
  for (const [index, point] of positions(h).entries()) { close(point.x, index ? 14.1 : 6.1); close(point.y, 11); }
  h.button("Rotate all solar panels").emit("keydown", { key: "ArrowRight" });
  h.controller.rotateAll(-1);
  for (const [index, point] of positions(h).entries()) { close(point.x, index ? 14.1 : 6.1); close(point.y, 11); close(point.heading, 0); }
  h.controller.setAllPanels(false);
  h.face(1).emit("keydown", { key: "ArrowLeft" });
  close(positions(h)[0].x, 6); close(positions(h)[1].x, 14.1);
});

for (const reason of ["pointercancel", "capture", "close", "scope", "zoom", "pan"]) test(`${reason} stops a group gesture without later pointer mutation`, (t) => {
  const h = harness(t); h.add(-4, 0); h.add(4, 0); h.controller.setAllPanels(true);
  const face = h.face(1);
  face.emit("pointerdown", { clientX: -4, clientY: 0 });
  face.emit("pointermove", { clientX: 1, clientY: 5 });
  const before = structuredClone(h.value().panels);
  if (reason === "pointercancel") face.emit("pointercancel");
  if (reason === "capture") { h.controller.setCapturing(true); assert.equal(h.group().hidden, true); }
  if (reason === "close") { h.controller.setEditing(false); assert.equal(h.group().hidden, true); }
  if (reason === "scope") h.controller.setAllPanels(false);
  if (reason === "zoom") h.mapListeners.get("zoom_changed")();
  if (reason === "pan") h.mapListeners.get("center_changed")();
  face.emit("pointermove", { clientX: 40, clientY: 50 });
  assert.deepEqual(h.value().panels, before);
  assert.equal(face.hasPointerCapture(1), false);
});

test("all-panel mode hides copy controls, protects individual edits and cleans up", (t) => {
  const h = harness(t); h.add(-4, 0); h.copy(1, "right"); h.controller.setAllPanels(true);
  const before = structuredClone(h.value().panels);
  h.controller.removeSelected();
  h.controller.updateSelected({ ...DEFAULT_SOLAR_PANEL_SIZE, ...DEFAULT_SOLAR_PANEL_TILT, heading: 90 });
  assert.deepEqual(h.value().panels, before);
  assert.equal(h.face(1).parent.children[1].hidden, true);
  assert.equal(h.face(1).parent.dataset.selected, "true");
  assert.equal(h.face(2).parent.dataset.selected, "true");
  const move = h.button("Move all solar panels");
  h.controller.clear();
  assert.equal(h.group().hidden, true); assert.equal(h.value().allPanels, false); assert.equal(h.value().panels.length, 0);
  h.controller.dispose();
  move.emit("keydown", { key: "ArrowRight" });
  assert.equal(h.pane.children.length, 0); assert.equal(h.mapListeners.size, 0);
});
