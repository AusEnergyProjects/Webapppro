import test from "node:test";
import assert from "node:assert/strict";
import { createTradeMapMeasurement, formatMapDistance, measurementEdgesCross } from "../src/lib/trade-map-measurement.ts";

class Events {
  listeners = new Map();
  addListener(name, callback) {
    const group = this.listeners.get(name) || new Set();
    this.listeners.set(name, group); group.add(callback);
    return { remove: () => group.delete(callback) };
  }
  emit(name, ...args) { for (const callback of this.listeners.get(name) || []) callback(...args); }
}
class Point {
  constructor(lat, lng) { this.latValue = lat; this.lngValue = lng; }
  toJSON() { return { lat: this.latValue, lng: this.lngValue }; }
  equals(other) { return this.latValue === other.latValue && this.lngValue === other.lngValue; }
}
class Path extends Events {
  points = [];
  getArray() { return [...this.points]; }
  getLength() { return this.points.length; }
  getAt(index) { return this.points[index]; }
  push(point) { this.points.push(point); this.emit("insert_at"); }
  pop() { this.points.pop(); this.emit("remove_at"); }
  setAt(index, point) { this.points[index] = point; this.emit("set_at"); }
}
function harness(mode, computeLength = (points) => points.length === 5 ? 51 : 12) {
  const map = new Events();
  map.options = { fullscreenControl: true, disableDoubleClickZoom: false, draggableCursor: "grab" };
  map.get = (key) => map.options[key];
  map.setOptions = (options) => Object.assign(map.options, options);
  map.getCenter = () => new Point(10, 10);
  map.getDiv = () => ({ clientWidth: 300 });
  const shapes = [];
  class Shape {
    constructor(options) { this.options = options; this.path = new Path(); this.map = options.map; shapes.push(this); }
    getPath() { return this.path; }
    setPath(points) { this.path.points = [...points]; }
    setOptions(options) { Object.assign(this.options, options); }
    setMap(value) { this.map = value; }
  }
  const previewLabel = { hidden: false, textContent: "", style: {}, offsetWidth: 80, offsetHeight: 30, attached: false, remove() { this.attached = false; } };
  const overlays = [];
  class Overlay {
    constructor() { overlays.push(this); }
    setMap(value) { this.map = value; if (value) { this.onAdd(); this.draw(); } else this.onRemove(); }
    getMap() { return this.map; }
    getPanes() { return { overlayLayer: { append(label) { label.attached = true; } } }; }
    getProjection() { return { fromLatLngToDivPixel: (point) => ({ x: point.lngValue, y: point.latValue }), fromLatLngToContainerPixel: (point) => ({ x: point.lngValue, y: point.latValue }) }; }
  }
  const geometryCalls = [];
  const api = { Polygon: Shape, Polyline: Shape, OverlayView: Overlay, geometry: { spherical: {
    computeArea(path) { geometryCalls.push(["area", path.getArray()]); return 162.5; },
    computeLength(points) { geometryCalls.push(["length", points]); return computeLength(points); },
  } } };
  let value;
  const controller = createTradeMapMeasurement(api, map, mode, (next) => { value = next; }, previewLabel);
  const click = (lat, lng) => map.emit("click", { latLng: new Point(lat, lng) });
  const move = (lat, lng) => map.emit("mousemove", { latLng: new Point(lat, lng) });
  return { map, shape: shapes[0], previewLine: shapes[1], previewLabel, overlays, controller, click, move, geometryCalls, value: () => value };
}

const planarLength = (points) => points.slice(1).reduce((total, point, index) => total
  + Math.hypot(point.latValue - points[index].latValue, point.lngValue - points[index].lngValue), 0);

for (const mode of ["area", "distance"]) test(`${mode} capture hides vertex handles and restores editing without changing the measurement`, () => {
  const h = harness(mode);
  h.click(0, 0); h.click(0, 10); h.click(10, 10); h.controller.finish();
  const original = structuredClone(h.value());
  h.controller.setCapturing(true);
  assert.equal(h.shape.options.editable, false);
  assert.equal(h.shape.map, h.map, "the measured shape remains visible");
  assert.deepEqual(h.value(), original);
  h.controller.setCapturing(false);
  assert.equal(h.shape.options.editable, true);
  assert.deepEqual(h.value(), original);
  h.controller.dispose();
});

test("moving the pointer previews distance from the first point without committing it", () => {
  const h = harness("distance", planarLength);
  h.move(0, 10);
  assert.equal(h.value().previewLengthM, null, "a start point is required");
  h.click(0, 0);
  h.move(0, 1.72);
  assert.equal(h.value().previewLengthM, 1.72);
  assert.equal(h.previewLabel.textContent, "1.72 m");
  assert.equal(h.previewLabel.hidden, false);
  assert.equal(h.previewLine.getPath().getLength(), 2);
  assert.equal(h.previewLine.options.clickable, false);
  assert.equal(h.previewLine.options.editable, false);
  assert.equal(h.value().lengthM, 0);
  assert.equal(h.value().points, 1);
  h.controller.finish();
  assert.equal(h.value().finished, false, "the moving endpoint cannot satisfy Finish");
  h.move(0, 3);
  assert.equal(h.value().previewLengthM, 3);
  assert.equal(h.shape.getPath().getLength(), 1);
  h.click(0, 3);
  assert.equal(h.value().lengthM, 3);
  assert.equal(h.value().previewLengthM, null);
  assert.equal(h.previewLabel.hidden, true);
  assert.equal(h.previewLine.getPath().getLength(), 0);
  h.move(4, 3);
  assert.equal(h.value().previewLengthM, 7, "the live total follows the entire path from the first point");
  assert.deepEqual(h.previewLine.getPath().getArray().map((point) => point.toJSON()), [{ lat: 0, lng: 3 }, { lat: 4, lng: 3 }], "only the new segment is dashed");
  h.controller.finish();
  assert.equal(h.value().lengthM, 3, "Finish retains only clicked points");
  assert.equal(h.value().previewLengthM, null);
  h.move(10, 10);
  assert.equal(h.value().previewLengthM, null);
  h.controller.dispose();
});

test("leaving, moving or zooming the map clears the preview without changing clicked points", () => {
  const h = harness("distance", planarLength);
  h.click(0, 0); h.click(0, 3);
  for (const event of ["mouseout", "dragstart", "center_changed", "zoom_changed"]) {
    h.move(4, 3);
    h.map.emit(event);
    assert.equal(h.value().previewLengthM, null);
    assert.equal(h.previewLabel.hidden, true);
    assert.equal(h.value().points, 2);
    assert.equal(h.value().lengthM, 3);
    h.map.emit("idle");
  }
  h.map.emit("dragstart"); h.move(4, 3);
  assert.equal(h.value().previewLengthM, null, "panning does not create a moving endpoint");
  h.map.emit("idle");
  h.move(4, 3); h.controller.undo();
  assert.equal(h.value().previewLengthM, null);
  assert.equal(h.value().points, 1);
  h.move(4, 3);
  assert.equal(h.value().previewLengthM, 5, "Undo restores the previous starting point for the preview");
  h.controller.undo(); h.move(4, 3);
  assert.equal(h.value().previewLengthM, null);
  h.click(0, 0); h.move(4, 3);
  h.controller.dispose();
  assert.equal(h.previewLabel.attached, false);
  assert.equal(h.previewLine.map, null);
  assert.equal(h.overlays[0].map, null);
  assert.equal([...h.map.listeners.values()].every((group) => group.size === 0), true);
});

test("pointer preview is distance-only and displays metres to two decimal places", () => {
  const h = harness("area");
  h.click(0, 0); h.move(3, 4);
  assert.equal(h.value().previewLengthM, null);
  assert.equal(h.previewLine, undefined);
  assert.equal(h.overlays.length, 0);
  assert.equal(formatMapDistance(1.72), "1.72 m");
  assert.equal(formatMapDistance(1.726), "1.73 m");
  assert.equal(formatMapDistance(0), "0.00 m");
  h.controller.dispose();
});

test("area measurements use square metres and explicitly close the perimeter", () => {
  const h = harness("area");
  h.click(0, 0); h.click(0, 10); h.click(10, 10); h.click(10, 0);
  assert.equal(h.value().areaM2, 162.5);
  assert.equal(h.value().lengthM, 51);
  const perimeter = h.geometryCalls.at(-1)[1];
  assert.equal(perimeter.length, 5);
  assert.equal(perimeter[0], perimeter[4]);
  assert.equal(h.shape.options.clickable, false, "filled outlines must not swallow clicks while drawing");
  h.controller.finish();
  assert.equal(h.value().finished, true);
  assert.equal(h.shape.options.editable, true);
  h.click(20, 20);
  assert.equal(h.shape.path.getLength(), 4, "finished outlines stop accepting map clicks");
  h.shape.path.setAt(1, new Point(0, 11));
  assert.equal(h.geometryCalls.at(-1)[1][1].lngValue, 11, "dragging a corner recomputes the result");
  h.controller.dispose();
});

test("distance measurements stay open and never compute an area", () => {
  const h = harness("distance");
  h.click(0, 0); h.controller.finish();
  assert.equal(h.value().finished, false);
  h.click(0, 10); h.controller.finish();
  assert.equal(h.value().finished, true);
  assert.equal(h.value().areaM2, 0);
  assert.equal(h.value().lengthM, 12);
  assert.equal(h.geometryCalls.some(([kind]) => kind === "area"), false);
  assert.equal(h.geometryCalls.at(-1)[1].length, 2);
  h.controller.dispose();
});

test("crossed outlines withhold an area and cannot finish until corrected", () => {
  const h = harness("area");
  h.click(0, 0); h.click(10, 10); h.click(0, 10); h.click(10, 0);
  assert.equal(h.value().crossed, true);
  assert.equal(h.value().areaM2, 0);
  h.controller.finish();
  assert.equal(h.value().finished, false);
  h.controller.undo();
  assert.equal(h.value().crossed, false);
  h.controller.finish();
  assert.equal(h.value().finished, true);
  h.controller.dispose();
});

test("centre-point entry, undo and disposal preserve normal map controls", () => {
  const h = harness("distance");
  assert.equal(h.map.options.fullscreenControl, false);
  h.controller.addCentre(); h.controller.addCentre();
  assert.equal(h.value().points, 1, "repeat clicks must not create zero-length consecutive edges");
  h.controller.undo();
  assert.equal(h.value().points, 0);
  h.click(0, 0);
  h.controller.dispose();
  assert.equal(h.shape.map, null);
  assert.deepEqual(h.map.options, { fullscreenControl: true, disableDoubleClickZoom: false, draggableCursor: "grab" });
  h.click(1, 1);
  assert.equal(h.shape.path.getLength(), 1);
  assert.equal([...h.shape.path.listeners.values()].every((group) => group.size === 0), true);
});

test("concave roof outlines are valid while non-adjacent touching edges are rejected", () => {
  const points = (pairs) => pairs.map(([lat, lng]) => ({ lat, lng }));
  assert.equal(measurementEdgesCross(points([[0,0],[0,3],[1,3],[1,1],[3,1],[3,0]])), false);
  assert.equal(measurementEdgesCross(points([[0,0],[0,3],[2,3],[0,1],[2,0]])), true);
});
