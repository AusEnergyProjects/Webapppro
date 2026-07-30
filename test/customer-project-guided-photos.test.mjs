import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CUSTOMER_PROJECT_PHOTO_GUIDE_LIMIT,
  CUSTOMER_PROJECT_PHOTO_GUIDE_VERSION,
  customerProjectPhotoGuide,
} from "../src/lib/customer-project-photo-guide.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const component = read("../src/components/CustomerProjectPhotoCapture.tsx");

test("guided project photos are deterministic, bounded and round-robin project work", () => {
  const categories = ["hot-water", "glazing", "solar", "battery", "insulation"];
  const first = customerProjectPhotoGuide(categories);
  const second = customerProjectPhotoGuide(categories);
  assert.deepEqual(first, second);
  assert.ok(first.length <= CUSTOMER_PROJECT_PHOTO_GUIDE_LIMIT);
  assert.deepEqual(
    first.slice(0, 5).map((item) => item.serviceCategory),
    categories,
  );
  assert.equal(new Set(first.map((item) => item.id)).size, first.length);
  assert.equal(first.filter((item) => item.id === "shared:switchboard").length, 1);
  assert.match(CUSTOMER_PROJECT_PHOTO_GUIDE_VERSION, /^2026-07-30-/);
});

test("guided photos carry safe server-owned evidence presets", () => {
  const hotWater = customerProjectPhotoGuide(["hot-water"]);
  assert.ok(
    hotWater.every(
      (item) =>
        item.evidenceCategory === "existing-equipment"
        && item.factKeys[0] === "hot-water",
    ),
  );
  const insulation = customerProjectPhotoGuide(["insulation"]);
  assert.ok(
    insulation
      .filter((item) => item.id !== "insulation:insulation-area-context")
      .every((item) => item.factKeys[0] === "ceiling-insulation"),
  );
  assert.deepEqual(
    insulation.find(
      (item) => item.id === "insulation:insulation-area-context",
    )?.factKeys,
    [],
  );
  assert.match(insulation[0].guidance, /Do not enter a roof space/);
  const glazing = customerProjectPhotoGuide(["glazing"]);
  assert.ok(glazing.every((item) => item.factKeys[0] === "glazing"));
});

test("customer meter-box guidance keeps the enclosure closed", () => {
  const meterBox = customerProjectPhotoGuide(["solar"]).find(
    (item) => item.id === "solar:meter-box",
  );
  assert.ok(meterBox);
  assert.equal(meterBox.label, "Closed meter box exterior");
  assert.match(meterBox.guidance, /Keep the enclosure closed/);
  assert.doesNotMatch(meterBox.guidance, /open meter enclosure/i);
});

test("capture interface blocks inputs behind explicit safety and privacy checks", () => {
  assert.match(component, /Before opening the camera, confirm all three/);
  assert.match(component, /disabled=\{!ready \|\| remainingSlots < 1\}/);
  assert.match(component, /capture="environment"/);
  assert.match(component, /never enter a roof space or crawl under a home/);
  assert.match(component, /No people, mail, street numbers, number plates, bills, NMI/);
  assert.match(component, /Photos are optional/);
  assert.match(component, /save privately first/);
});
