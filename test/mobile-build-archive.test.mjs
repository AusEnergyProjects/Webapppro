import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const archiveRules = fs.readFileSync(path.join(root, '.easignore'), 'utf8');

// EAS uses Git-compatible ignore rules at the repository root. Exercise their
// matching behavior in an isolated fixture, without copying client credentials.
function excluded(paths) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tlink-eas-archive-'));
  try {
    const init = spawnSync('git', ['init', '--quiet', '--template=', fixture], { encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    fs.writeFileSync(path.join(fixture, '.gitignore'), archiveRules);
    const result = spawnSync('git', ['-c', 'core.excludesFile=', '-C', fixture, 'check-ignore', '--no-index', '--stdin', '-z'], {
      input: paths.join('\0') + '\0', encoding: 'utf8',
    });
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    return new Set(result.stdout.split('\0').filter(Boolean));
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith('tlink-eas-archive-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

test('the root archive rules include only the configured Android client file while Git still excludes it', () => {
  assert.equal(fs.existsSync(path.join(root, 'mobile/.easignore')), false, 'EAS only reads the repository-root ignore file');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'mobile/app.json'), 'utf8'));
  assert.equal(config.expo.android.googleServicesFile, './google-services.json');
  const ignored = excluded(['mobile/google-services.json', 'google-services.json', 'other/google-services.json', 'mobile/other/google-services.json']);
  assert.deepEqual([...ignored], ['google-services.json', 'other/google-services.json', 'mobile/other/google-services.json']);
  const git = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', 'mobile/google-services.json'], { encoding: 'utf8' });
  assert.equal(git.status, 0, 'Firebase client configuration must remain excluded from Git');
});

test('native modules and build inputs survive archive filtering without generated native folders', () => {
  const included = ['mobile/app.json', 'mobile/eas.json', 'mobile/package.json', 'mobile/package-lock.json',
    'mobile/modules/tlink-calls/android/build.gradle', 'mobile/modules/tlink-calls/android/src/main/AndroidManifest.xml',
    'mobile/modules/tlink-calls/ios/TLinkCallsModule.swift', 'mobile/modules/tlink-calls/ios/TLinkCalls.podspec',
    'mobile/modules/tlink-calls/expo-module.config.json', 'mobile/plugins/with-tlink-calls.js', 'build/sites-vite-plugin.ts',
    '.env.example', 'mobile/.env.example'];
  for (const file of included) assert.equal(fs.existsSync(path.join(root, file)), true, file);
  assert.deepEqual([...excluded(included)], []);
});

test('signing credentials, private environment files, dependencies and outputs stay outside the archive', () => {
  const files = ['credentials.json', 'mobile/credentials.json', 'mobile/key.p8', 'mobile/key.p12', 'mobile/key.key',
    'mobile/profile.mobileprovision', 'mobile/keystore.jks', 'mobile/cert.pem', 'mobile/GoogleService-Info.plist',
    '.env.local', 'mobile/.env.local', 'mobile/.env', 'node_modules/package/index.js', 'mobile/node_modules/package/index.js',
    '.next/server.js', '.wrangler/state.db', '.sites-release/bundle.tar.gz', 'tmp/fixture.json', 'mobile/.expo/state.json',
    'mobile/dist/index.js', 'mobile/web-build/index.html', 'mobile/ios/Pods/file', 'mobile/android/app/build/file',
    'mobile/modules/tlink-calls/android/build/file', 'mobile/.gradle/cache', 'mobile/.kotlin/cache', 'mobile/tsconfig.tsbuildinfo'];
  assert.deepEqual([...excluded(files)], files);
});

test('archive rules retain every existing root Git exclusion and public example exception', () => {
  const effective = text => text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const archive = new Set(effective(archiveRules));
  for (const rule of effective(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'))) assert.ok(archive.has(rule), rule);
});
