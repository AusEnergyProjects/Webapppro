import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../src/components/rental-photo-preview.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture(overrides = {}) {
  const env = { states: [], effects: [], files: new Map(), downloads: [], writes: [], deleted: [], index: 0, closed: 0,
    owner: { key: 'business-one', epoch: 1 }, result: { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }, ...overrides };
  class File {
    constructor(root, ...parts) { this.uri = parts.length ? [root, ...parts].join('/') : root; }
    get exists() { return env.files.has(this.uri); }
    write(bytes) { env.writes.push(this.uri); env.files.set(this.uri, bytes); }
    delete() { env.deleted.push(this.uri); env.files.delete(this.uri); }
  }
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-crypto': { randomUUID: () => 'preview-id' },
    'expo-file-system': { File, Paths: { cache: 'file:///cache' } },
    react: {
      useState(initial) {
        const index = env.index++;
        if (!(index in env.states)) env.states[index] = initial;
        return [env.states[index], value => { env.states[index] = typeof value === 'function' ? value(env.states[index]) : value; }];
      },
      useEffect(effect) { env.effects.push(effect); },
    },
    'react-native': { ActivityIndicator: 'spinner', Image: 'image', Modal: 'modal', Text: 'text', View: 'view', StyleSheet: { create: value => value } },
    'react-native-safe-area-context': { SafeAreaView: 'safe-area' },
    '@/components/field-button': { FieldButton: 'button' },
    '@/lib/api': { async downloadRentalEvidencePhoto(...args) { env.downloads.push(args); if (env.download) return env.download(...args); return env.result; } },
    '@/lib/database': {
      assertLocalDataOwner(owner) { assert.deepEqual(owner, env.owner); },
      subscribeLocalDataOwner(listener) { env.ownerListener = listener; return () => { env.unsubscribed = true; }; },
    },
    '@/lib/theme': { colours: {}, spacing: {} },
  };
  const exports = {};
  new Function('require', 'exports', compiled)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, exports);
  env.photo = env.photo || { jobMediaId: 'correct-photo', contentType: 'image/jpeg', title: 'Saved photo 2' };
  env.render = () => { env.index = 0; return exports.RentalPhotoPreview({ photo: env.photo, owner: env.owner, online: env.online ?? true, onClose: () => { env.closed++; } }); };
  env.render(); env.cleanup = env.effects[0]();
  return env;
}

function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (tree && typeof tree === 'object') return text(tree.props?.children);
  return tree === null || tree === undefined || typeof tree === 'boolean' ? '' : String(tree);
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('saved preview downloads the exact photo under the selected business and clears its temporary file on close', async () => {
  const env = fixture(); await flush();
  assert.equal(env.downloads.length, 1); assert.equal(env.downloads[0][0], 'correct-photo'); assert.equal(env.downloads[0][1], 'business-one');
  const signal = env.downloads[0][2]; assert.equal(signal.aborted, false);
  const tree = env.render(); const image = nodes(tree, node => node.type === 'image')[0];
  assert.equal(image.props.source.uri, 'file:///cache/tlink-rental-preview-preview-id.jpg'); assert.equal(image.props.resizeMode, 'contain');
  nodes(tree, node => node.type === 'button' && text(node) === 'Close preview')[0].props.onPress(); assert.equal(env.closed, 1);
  env.cleanup(); assert.equal(signal.aborted, true); assert.deepEqual(env.deleted, [image.props.source.uri]); assert.ok(env.unsubscribed);
});

test('phone photos preview offline without a download and their original file survives closing', async () => {
  const uri = 'file:///camera/original.jpg';
  const env = fixture({ online: false, photo: { uri, title: 'Photo on this phone 1' }, files: new Map([[uri, new Uint8Array([1])]]) });
  await flush(); assert.equal(env.downloads.length, 0); assert.equal(nodes(env.render(), node => node.type === 'image')[0].props.source.uri, uri);
  env.cleanup(); assert.ok(env.files.has(uri)); assert.deepEqual(env.deleted, []);
});

test('business switches close a pending preview and prevent a late response from writing private media', async () => {
  let resolve; const env = fixture({ download: () => new Promise(done => { resolve = done; }) });
  const signal = env.downloads[0][2]; env.owner = { key: 'business-two', epoch: 2 }; env.ownerListener();
  assert.equal(signal.aborted, true); assert.equal(env.closed, 1);
  resolve(env.result); await flush(); assert.deepEqual(env.writes, []); assert.deepEqual(env.states.slice(0, 2), ['', '']); env.cleanup();
});

test('business switches delete already displayed private cached media', async () => {
  const env = fixture(); await flush(); assert.equal(env.files.size, 1);
  env.owner = { key: 'business-two', epoch: 2 }; env.ownerListener();
  assert.equal(env.files.size, 0); assert.equal(env.closed, 1); env.cleanup(); assert.equal(env.deleted.length, 1);
});

test('closing during a download cancels it and ignores the late result', async () => {
  let resolve; const env = fixture({ download: () => new Promise(done => { resolve = done; }) });
  const tree = env.render(); assert.match(text(tree), /Opening photo/); assert.equal(nodes(tree, node => node.type === 'button')[0].props.disabled, undefined);
  tree.props.onRequestClose(); assert.equal(env.closed, 1); env.cleanup(); assert.equal(env.downloads[0][2].aborted, true);
  resolve(env.result); await flush(); assert.deepEqual(env.writes, []);
});

test('offline saved photos show a recoverable explanation while Close preview remains available', async () => {
  const env = fixture({ online: false }); await flush();
  const tree = env.render(); assert.match(text(tree), /Reconnect to preview/); assert.equal(env.downloads.length, 0);
  const retry = nodes(tree, node => node.type === 'button' && text(node) === 'Retry preview')[0]; retry.props.onPress(); assert.equal(env.states[2], 1);
  assert.equal(nodes(tree, node => node.type === 'button' && text(node) === 'Close preview').length, 1); env.cleanup();
});

test('a mismatched saved content type cannot be cached or displayed', async () => {
  const env = fixture({ result: { bytes: new Uint8Array([1]), contentType: 'image/png' } }); await flush();
  const tree = env.render(); assert.match(text(tree), /did not match this evidence/); assert.deepEqual(env.writes, []); assert.equal(nodes(tree, node => node.type === 'image').length, 0); env.cleanup();
});
