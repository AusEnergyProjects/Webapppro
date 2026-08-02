import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const provider = fs.readFileSync(
  new URL("../src/providers/app-provider.tsx", import.meta.url),
  "utf8",
);
const manualDeviceRoute = fs.readFileSync(
  new URL(
    "../../src/app/api/creditex/manual-field/devices/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("sign-out clears every authorised field lane before local identity removal", () => {
  const signOutStart = provider.indexOf(
    "const signOut = useCallback(async () => {",
  );
  const signOutEnd = provider.indexOf(
    "const value = useMemo<AppValue>",
    signOutStart,
  );
  assert.ok(signOutStart >= 0 && signOutEnd > signOutStart);
  const signOut = provider.slice(signOutStart, signOutEnd);
  assert.match(signOut, /resolveFieldAccessModes\(\)/);
  assert.match(signOut, /\['trade_team', 'creditex_manual'\]/);
  assert.match(signOut, /Promise\.allSettled\(modes\.map/);
  assert.match(signOut, /\/api\/creditex\/manual-field\/devices/);
  assert.match(signOut, /method: 'DELETE'/);
  assert.match(signOut, /\/api\/trade-team\/devices/);
  assert.match(signOut, /pushToken: ''/);
  assert.match(
    signOut,
    /Notifications\.unregisterForNotificationsAsync\(\)/,
  );
  assert.ok(
    signOut.indexOf("Promise.allSettled") < signOut.indexOf("purgeLocalData"),
  );
  assert.ok(
    signOut.indexOf("unregisterForNotificationsAsync")
      < signOut.indexOf("forgetPushToken"),
  );
  assert.ok(
    signOut.indexOf("purgeLocalData") < signOut.indexOf("firebaseSignOut"),
  );
});

test("push-token refresh updates both authorised field lanes", () => {
  const listenerStart = provider.indexOf(
    "Notifications.addPushTokenListener",
  );
  const listenerEnd = provider.indexOf(
    "return () =>",
    listenerStart,
  );
  assert.ok(listenerStart >= 0 && listenerEnd > listenerStart);
  const listener = provider.slice(listenerStart, listenerEnd);
  assert.match(listener, /resolveFieldAccessModes\(\)/);
  assert.match(listener, /Promise\.allSettled\(modes\.map/);
  assert.match(listener, /\/api\/creditex\/manual-field\/devices/);
  assert.match(listener, /\/api\/trade-team\/devices/);
});

test("manual device revocation is a protected bounded endpoint", () => {
  assert.match(manualDeviceRoute, /export async function DELETE/);
  assert.match(manualDeviceRoute, /sameOrigin\(request\)/);
  assert.match(manualDeviceRoute, /requireManualFieldMember/);
  assert.match(manualDeviceRoute, /readBoundedJsonRequest/);
  assert.match(manualDeviceRoute, /revokeManualFieldDevice/);
});
