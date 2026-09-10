import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Vector3 } from "three";
import { createHomeEnergyModel } from "../src/lib/home-energy-model.ts";

test("the home is dimensioned 3D geometry and its roof opens independently", () => {
  const model = createHomeEnergyModel();
  const bounds = new Box3().setFromObject(model.group);
  const size = bounds.getSize(new Vector3());
  assert.ok(size.x > 12 && size.x < 15 && size.z > 8 && size.z < 11);
  assert.ok(size.y > 3 && size.y < 6);
  const roofBefore = new Box3().setFromObject(model.roof);
  model.roof.position.y = 2.4;
  const opened = new Box3().setFromObject(model.group);
  const roofAfter = new Box3().setFromObject(model.roof);
  assert.ok(Math.abs(roofAfter.max.y - roofBefore.max.y - 2.4) < .01);
  assert.equal(opened.min.y, bounds.min.y);
  let batches = 0;
  model.group.traverse((object) => { if (object.isInstancedMesh) batches++; });
  assert.ok(batches > 0 && batches < 140, "detailed components should still reuse material batches");
  assert.deepEqual(Object.keys(model.features).sort(), ["airConditioning", "battery", "ev", "glazing", "hotWater", "insulation", "solar", "ventilation"]);
  for (const point of Object.values(model.features)) assert.ok(bounds.containsPoint(point), "component labels must point within the model");
  model.dispose();
  model.dispose();
});
