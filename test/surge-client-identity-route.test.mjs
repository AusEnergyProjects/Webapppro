import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = new URL("../src/app/api/energy-assistant/route.ts", import.meta.url);

test("energy assistant route gates JSON before server handling and wires anonymous shared admission", async () => {
  const source = await readFile(routePath, "utf8");

  assert.match(source, /if \(!isJsonRequest\(request\)\) return unsupportedMediaType\(\)/);
  assert.ok(
    source.indexOf("if (!isJsonRequest(request))")
      < source.indexOf("await handleEnergyAssistantRequest(request, {"),
  );
  assert.match(source, /database = getD1\(\)/);
  assert.match(source, /createSharedSurgeUsageGuard\(\{/);
  assert.match(source, /createSurgeConversationQualityRecorder\(database\)/);
  assert.match(source, /createSurgeGroundedProductGuidanceResolver\(database\)/);
  assert.match(source, /resolveGroundedAnswer,/);
  assert.match(source, /waitUntil\(recorder\(event\)\.catch\(\(\) => undefined\)\)/);
  assert.match(source, /clientKey: identity\.clientKey/);
  assert.match(source, /networkKey: identity\.networkKey/);
  assert.match(source, /requestKey: requestId/);
  assert.match(source, /estimatedMicroUsd/);
  assert.match(source, /requireValidatedModelForOrdinaryAdvice: true/);
  assert.match(source, /return deniedReservation\(\)/);
  assert.match(source, /headers\.append\("Set-Cookie", setCookie\)/);
  assert.doesNotMatch(source, /x-forwarded-for|cf-connecting-ip|clientIp/);
});
