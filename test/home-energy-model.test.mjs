import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Vector3 } from "three";
import { createHomeEnergyModel } from "../src/lib/home-energy-model.ts";

test("the home is dimensioned 3D geometry and its roof opens independently", () => {
  const model = createHomeEnergyModel();
  const bounds = new Box3().setFromObject(model.group);
  const size = bounds.getSize(new Vector3());
  assert.ok(size.x > 8 && size.x < 12 && size.z > 6 && size.z < 10);
  assert.ok(size.y > 4 && size.y < 8);
  model.roof.position.y = 1.6;
  const opened = new Box3().setFromObject(model.group);
  assert.ok(Math.abs(opened.max.y - bounds.max.y - 1.6) < .01);
  assert.equal(opened.min.y, bounds.min.y);
  let batches = 0;
  model.group.traverse((object) => { if (object.isInstancedMesh) batches++; });
  assert.ok(batches > 0 && batches < 60, "geometry should reuse material batches");
  model.dispose();
  model.dispose();
});
