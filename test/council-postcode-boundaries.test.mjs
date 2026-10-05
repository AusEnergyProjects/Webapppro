import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  parseCouncilPostcodeBoundaries,
  loadCouncilPostcodeBoundaries,
  councilPostcodeBoundaryPath,
  councilPostcodeBoundaryContains,
  councilPostcodeBoundaryLabelPosition,
  COUNCIL_POSTCODE_BOUNDARY_SOURCE,
} from "../src/lib/council-postcode-boundaries.ts";

const square = (west, south, east, north) => [[west,south],[east,south],[east,north],[west,north],[west,south]];
const collection = (...features) => ({ type: "FeatureCollection", features });
const feature = (postcode = "3000", coordinates = [square(140,-40,150,-30)], type = "Polygon") => ({ type: "Feature", properties: { postcode }, geometry: { type, coordinates } });

test("validates coordinate structure, closed rings, finite WGS84 positions and unique postcode identity", () => {
  const [boundary] = parseCouncilPostcodeBoundaries(collection(feature()));
  assert.deepEqual(boundary.bbox, [140,-40,150,-30]);
  for (const invalid of [
    collection(feature("300")), collection(feature("3000", [])),
    collection(feature("3000", [[[140,-40],[150,-40],[150,-30],[140,-30]]])),
    collection(feature("3000", [square(140,-40,181,-30)])),
    collection(feature("3000", [square(140,-40,Infinity,-30)])),
    collection(feature("3000", [square(140,-40,"150",-30)])),
    collection(feature(), feature()),
    collection(feature("3000", [140,-40], "Point")),
  ]) assert.throws(() => parseCouncilPostcodeBoundaries(invalid));
});

test("hit testing respects exterior boundaries, polygon holes, disconnected parts and invalid positions", () => {
  const [boundary] = parseCouncilPostcodeBoundaries(collection(feature("3000", [[square(140,-40,150,-30),square(144,-36,146,-34)], [square(151,-32,152,-31)]], "MultiPolygon")));
  assert.equal(councilPostcodeBoundaryContains(boundary, {lng:141,lat:-35}), true);
  assert.equal(councilPostcodeBoundaryContains(boundary, {lng:140,lat:-35}), true);
  assert.equal(councilPostcodeBoundaryContains(boundary, {lng:145,lat:-35}), false);
  assert.equal(councilPostcodeBoundaryContains(boundary, {lng:144,lat:-35}), false);
  assert.equal(councilPostcodeBoundaryContains(boundary, {lng:150.5,lat:-31.5}), false);
  assert.equal(councilPostcodeBoundaryContains(boundary, {lng:151.5,lat:-31.5}), true);
  assert.equal(councilPostcodeBoundaryContains(boundary, {lng:139,lat:-35}), false);
  assert.equal(councilPostcodeBoundaryContains(boundary, {lng:NaN,lat:-35}), false);
});

test("SVG paths project longitude and latitude and preserve all polygon and hole rings", () => {
  const [boundary] = parseCouncilPostcodeBoundaries(collection(feature("3000", [[square(140,-40,150,-30),square(144,-36,146,-34)], [square(151,-32,152,-31)]], "MultiPolygon")));
  const path = councilPostcodeBoundaryPath(boundary, ({lat,lng}) => ({x:lng-140,y:lat+40}));
  assert.ok(path.startsWith("M0.00,0.00L10.00,0.00"));
  assert.equal(path.match(/M/g).length, 3);
  assert.equal(path.match(/Z/g).length, 3);
  assert.ok(path.includes("M4.00,4.00"));
});

test("label anchors use a valid existing centroid or an interior part of a concave area with a hole", () => {
  const [boundary] = parseCouncilPostcodeBoundaries(collection(feature("3000", [[square(140,-40,150,-30),square(144,-36,146,-34)], [square(151,-32,152,-31)]], "MultiPolygon")));
  const preferred = {lng:141,lat:-35};
  assert.deepEqual(councilPostcodeBoundaryLabelPosition(boundary, preferred), preferred);
  for (const candidate of [undefined,{lng:145,lat:-35},{lng:139,lat:-35}]) {
    assert.equal(councilPostcodeBoundaryContains(boundary, councilPostcodeBoundaryLabelPosition(boundary, candidate)), true);
  }
  const [concave] = parseCouncilPostcodeBoundaries(collection(feature("3001", [[[140,-40],[150,-40],[150,-30],[146,-30],[146,-38],[144,-38],[144,-30],[140,-30],[140,-40]]])));
  assert.equal(councilPostcodeBoundaryContains(concave, councilPostcodeBoundaryLabelPosition(concave)), true);
});

test("loader fetches only requested prefixes, passes cancellation, filters scope and reports missing areas", async (context) => {
  const calls = [];
  const signal = new AbortController().signal;
  context.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({url,options});
    if (url.endsWith("-31.json")) return Response.json(collection(feature("3100"), feature("3101")));
    if (url.endsWith("-30.json")) return Response.json(collection(feature("3000")));
    return new Response(null, {status:404});
  });
  const result = await loadCouncilPostcodeBoundaries(["3100","3000","3001","1000","3100"], signal);
  assert.deepEqual(calls.map(call => call.url), ["/data/council-postcode-boundaries/abs-2021-10.json","/data/council-postcode-boundaries/abs-2021-30.json","/data/council-postcode-boundaries/abs-2021-31.json"]);
  assert.ok(calls.every(call => call.options.signal === signal));
  assert.deepEqual(result.features.map(row => row.properties.postcode), ["3000","3100"]);
  assert.deepEqual(result.missingPostcodes, ["1000","3001"]);
  assert.deepEqual(await loadCouncilPostcodeBoundaries([]), {features:[],missingPostcodes:[]});
  await assert.rejects(loadCouncilPostcodeBoundaries(["../x"]), /Invalid postcode/);
});

test("loader rejects service and data errors rather than claiming nonexistent geometry", async (context) => {
  const mock = context.mock.method(globalThis, "fetch", async () => new Response(null, {status:503}));
  await assert.rejects(loadCouncilPostcodeBoundaries(["3000"]), /could not be loaded/);
  mock.mock.mockImplementation(async () => Response.json(collection(feature("2000"))));
  await assert.rejects(loadCouncilPostcodeBoundaries(["3000"]), /Unexpected postal area prefix/);
  mock.mock.mockImplementation(async () => Response.json({type:"FeatureCollection",features:[{}]}));
  await assert.rejects(loadCouncilPostcodeBoundaries(["3000"]), /Invalid postal area feature/);
});

test("bundled ABS capture covers Australia with verified provenance and all 72 current council postcodes", async () => {
  const root = new URL("../public/data/council-postcode-boundaries/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.spatialFeatures, 2641);
  assert.equal(manifest.serviceUrl, COUNCIL_POSTCODE_BOUNDARY_SOURCE.serviceUrl);
  assert.equal(manifest.licence, "https://creativecommons.org/licenses/by/4.0/");
  assert.ok(!Number.isNaN(Date.parse(manifest.retrievedAt)));
  const found = new Set();
  for (const file of manifest.files) {
    const data = await readFile(new URL(file.file, root));
    assert.equal(createHash("sha256").update(data).digest("hex"), file.sha256, file.file);
    assert.equal(data.length, file.bytes, file.file);
    const boundaries = parseCouncilPostcodeBoundaries(JSON.parse(data));
    assert.equal(boundaries.length, file.features);
    for (const boundary of boundaries) {
      const postcode = boundary.properties.postcode;
      assert.equal(found.has(postcode), false, postcode);
      assert.equal(file.file, `abs-2021-${postcode.slice(0,2)}.json`);
      assert.equal(councilPostcodeBoundaryContains(boundary, councilPostcodeBoundaryLabelPosition(boundary)), true, `Interior label for ${postcode}`);
      found.add(postcode);
    }
  }
  assert.equal(found.size, manifest.spatialFeatures);
  const scope = "3169,3172,3182,3183,3184,3186,3187,3188,3189,3190,3191,3192,3193,3194,3195,3196,3197,3202,3205,3206,3207,3804,3805,3806,3807,3808,3809,3810,3812,3813,3814,3815,3910,3911,3912,3913,3915,3916,3918,3919,3922,3925,3926,3927,3928,3929,3930,3931,3933,3934,3936,3939,3940,3941,3942,3943,3944,3953,3956,3959,3975,3976,3977,3978,3979,3980,3981,3984,3991,3992,3995,3996".split(",");
  assert.equal(scope.length,72);
  assert.deepEqual(scope.filter(postcode => !found.has(postcode)), []);
  for (const postcode of ["0800","2000","2600","3000","4000","5000","6000","7000","6798","6799","2899"]) assert.ok(found.has(postcode),postcode);
});
