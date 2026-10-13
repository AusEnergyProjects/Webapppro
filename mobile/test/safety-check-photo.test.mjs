import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/safety-check-photo.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function harness({ originalSize = 9 * 1024 * 1024, sizes = [3 * 1024 * 1024, 900_000], width = 6000, height = 4000 } = {}) {
  const state = { files: new Map([['original.heic', originalSize]]), attempts: [], deletes: [], releases: [], reads: 0 };
  class File {
    constructor(uri) { this.uri = uri; }
    get exists() { return state.files.has(this.uri); }
    get size() { return state.files.get(this.uri); }
    delete() { state.deletes.push(this.uri); state.files.delete(this.uri); }
  }
  const dependencies = {
    'expo-file-system': { File },
    'react-native': { Image: { getSize: async () => { state.reads++; return { width, height }; } } },
    'expo-image-manipulator': { SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: { manipulate: uri => {
      const index = state.attempts.length, attempt = { uri }; state.attempts.push(attempt);
      return { resize: size => { attempt.resize = size; }, release: () => state.releases.push(`context-${index}`), renderAsync: async () => ({
        release: () => state.releases.push(`render-${index}`), saveAsync: async options => {
          attempt.options = options; if (state.saveError) throw state.saveError;
          const uri = `cache-${index}.jpg`; state.files.set(uri, sizes[index] ?? 3 * 1024 * 1024); return { uri };
        },
      }) };
    } } },
  };
  const exports = {}; Function('require', 'exports', code)(id => { assert.ok(id in dependencies, id); return dependencies[id]; }, exports);
  return { state, ...exports };
}

test('ordinary large iPhone photos produce a bounded JPEG with preserved aspect ratio and originals untouched', async () => {
  const h = harness(); const result = await h.prepareSafetyCheckPhoto('original.heic');
  assert.equal(result.uri, 'cache-1.jpg'); assert.equal(result.size, 900_000);
  assert.deepEqual(h.state.attempts.map(item => item.resize), [{ width: 2560, height: null }, { width: 2200, height: null }]);
  assert.deepEqual(h.state.attempts.map(item => item.options), [{ format: 'jpeg', compress: 0.85 }, { format: 'jpeg', compress: 0.8 }]);
  assert.deepEqual(h.state.deletes, ['cache-0.jpg']); assert.equal(h.state.files.has('original.heic'), true);
  assert.deepEqual(h.state.releases, ['render-0', 'context-0', 'render-1', 'context-1']);
});

test('portrait dimensions resize their long edge and small photos are never enlarged', async () => {
  const portrait = harness({ width: 4000, height: 6000, sizes: [100_000] }); await portrait.prepareSafetyCheckPhoto('original.heic');
  assert.deepEqual(portrait.state.attempts[0].resize, { width: null, height: 2560 });
  const small = harness({ width: 600, height: 400, sizes: [100_000] }); await small.prepareSafetyCheckPhoto('original.heic');
  assert.equal(small.state.attempts[0].resize, undefined);
});

test('unreadable, absent and oversized originals fail before creating any upload derivative', async () => {
  for (const options of [{ originalSize: 4 }, { originalSize: 51 * 1024 * 1024 }, { width: 0 }, { height: Number.NaN }]) {
    const h = harness(options); await assert.rejects(() => h.prepareSafetyCheckPhoto('original.heic'));
    assert.equal(h.state.attempts.length, 0); assert.equal(h.state.files.has('original.heic'), true);
  }
  const missing = harness(); await assert.rejects(() => missing.prepareSafetyCheckPhoto('not-present'));
  assert.equal(missing.state.attempts.length, 0);
});

test('unbounded or failed derivatives never upload or remove the original and release every native resource', async () => {
  const h = harness({ sizes: [] }); await assert.rejects(() => h.prepareSafetyCheckPhoto('original.heic'), /readable quality/);
  assert.equal(h.state.attempts.length, 4); assert.equal(h.state.releases.length, 8);
  assert.deepEqual([...h.state.files.keys()], ['original.heic']);
  const failed = harness(); failed.state.saveError = new Error('Native conversion unavailable');
  await assert.rejects(() => failed.prepareSafetyCheckPhoto('original.heic'), /Native conversion unavailable/);
  assert.deepEqual(failed.state.releases, ['render-0', 'context-0']); assert.equal(failed.state.files.has('original.heic'), true);
});
