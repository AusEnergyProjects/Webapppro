import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/trade-mobile-server.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function policy(settings) {
  const exports = {};
  const dependencies = { 'cloudflare:workers': { env: settings }, '../../db': { getD1() { throw new Error('Release checks must not query customer data'); } } };
  new Function('require', 'exports', code)(name => { assert.ok(name in dependencies); return dependencies[name]; }, exports);
  return exports;
}

test('the configured 1.1.0 native releases supersede installed 1.0.2 on both platforms', () => {
  const api = policy({ AEA_MOBILE_LATEST_IOS_VERSION: '1.1.0', AEA_MOBILE_LATEST_ANDROID_VERSION: '1.1.0',
    AEA_MOBILE_IOS_DISTRIBUTION: 'testflight-internal', AEA_MOBILE_MIN_IOS_VERSION: '1.0.0', AEA_MOBILE_MIN_ANDROID_VERSION: '1.0.1',
    AEA_MOBILE_ANDROID_UPDATE_URL: 'https://expo.dev/artifacts/eas/signed.apk' });
  for (const platform of ['ios', 'android']) {
    const release = api.mobileAppPolicy(platform);
    assert.equal(release.platform, platform);
    assert.equal(release.latestVersion, '1.1.0');
    assert.equal(api.compareAppVersions(release.latestVersion, '1.0.2'), 1);
    assert.equal(api.appVersionAccepted(platform, '1.0.2'), true, 'An optional update must not lock out saved field work');
  }
  assert.equal(api.mobileAppPolicy('ios').distribution, 'testflight-internal');
  assert.equal(api.mobileAppPolicy('ios').updateUrl, 'https://ausenergyassessments.com/direct-trade/field-app');
  assert.equal(api.mobileAppPolicy('android').distribution, undefined);
  assert.equal(api.mobileAppPolicy('android').updateUrl, 'https://expo.dev/artifacts/eas/signed.apk');
});

test('internal TestFlight is advertised only when explicitly configured', () => {
  for (const distribution of ['', 'unavailable', 'testflight', 'unknown']) {
    assert.equal(policy({ AEA_MOBILE_IOS_DISTRIBUTION: distribution }).mobileAppPolicy('ios').distribution, undefined);
  }
});
