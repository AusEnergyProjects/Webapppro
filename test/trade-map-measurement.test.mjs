import test from "node:test";
import assert from "node:assert/strict";
import { createTradeMapMeasurement, measurementEdgesCross } from "../src/lib/trade-map-measurement.ts";

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
function harness(mode) {
  const map = new Events();
  map.options = { fullscreenControl: true, disableDoubleClickZoom: false, draggableCursor: "grab" };
  map.get = (key) => map.options[key];
  map.setOptions = (options) => Object.assign(map.options, options);
  map.getCenter = () => new Point(10, 10);
  const shapes = [];
  class Shape {
    constructor(options) { this.options = options; this.path = new Path(); this.map = options.map; shapes.push(this); }
    getPath() { return this.path; }
    setOptions(options) { Object.assign(this.options, options); }
    setMap(value) { this.map = value; }
  }
  const geometryCalls = [];
  const api = { Polygon: Shape, Polyline: Shape, geometry: { spherical: {
    computeArea(path) { geometryCalls.push(["area", path.getArray()]); return 162.5; },
    computeLength(points) { geometryCalls.push(["length", points]); return points.length === 5 ? 51 : 12; },
  } } };
  let value;
  const controller = createTradeMapMeasurement(api, map, mode, (next) => { value = next; });
  const click = (lat, lng) => map.emit("click", { latLng: new Point(lat, lng) });
  return { map, shape: shapes[0], controller, click, geometryCalls, value: () => value };
}

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
