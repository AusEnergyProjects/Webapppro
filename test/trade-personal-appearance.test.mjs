import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const load = (name, dependencies = {}) => {
  const source = fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const context = { exports: {}, require: id => dependencies[id] };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
};
const branding = load('trade-business-branding');
const { DEFAULT_TRADE_PERSONAL_APPEARANCE, readTradePersonalAppearance: read, writeTradePersonalAppearance: write, tradePersonalAppearanceStorageKey: keyFor } = load('trade-personal-appearance', { './trade-business-branding': branding });
const plain = value => JSON.parse(JSON.stringify(value));
const defaultAppearance = { colourMode: 'day', themeKey: null };
function storageFixture() { const entries = new Map(); return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }; }

test('personal appearance restores exact choices only for the same user and business', () => {
  const storage = storageFixture(), key = keyFor('josh', 'aea');
  assert.equal(write(storage, key, { colourMode: 'night', themeKey: 'violet_sunset' }), true);
  assert.deepEqual(plain(read(storage, key)), { appearance: { colourMode: 'night', themeKey: 'violet_sunset' }, storageAvailable: true });
  for (const other of [keyFor('kris', 'aea'), keyFor('josh', 'kris-business')]) assert.deepEqual(plain(read(storage, other).appearance), defaultAppearance);
  assert.equal(storage.entries.has('tlink-colour-mode'), false);
  assert.notEqual(keyFor('user:business', 'one'), keyFor('user', 'business:one'));
});

test('reset persists business colour inheritance and day mode', () => {
  const storage = storageFixture(), key = keyFor('josh', 'aea');
  write(storage, key, { colourMode: 'night', themeKey: 'rose_plum' });
  write(storage, key, DEFAULT_TRADE_PERSONAL_APPEARANCE);
  assert.deepEqual(plain(read(storage, key).appearance), defaultAppearance);
  const result = read(storage, 'missing'); result.appearance.themeKey = 'rose_plum';
  assert.deepEqual(plain(read(storage, 'missing').appearance), defaultAppearance, 'fallbacks cannot mutate shared defaults');
});

test('every canonical business theme is supported and invalid preferences inherit the business', () => {
  for (const themeKey of branding.TRADE_BRAND_THEME_KEYS) assert.equal(read({ getItem: () => JSON.stringify({ colourMode: 'night', themeKey }) }, 'key').appearance.themeKey, themeKey);
  for (const raw of [null, '', '{', '{}', 'null', '[]', JSON.stringify({ colourMode: 'NIGHT', themeKey: null }), JSON.stringify({ colourMode: 'day', themeKey: 'invented' })]) {
    assert.deepEqual(plain(read({ getItem: () => raw }, 'key')), { appearance: defaultAppearance, storageAvailable: true });
  }
});

test('unavailable storage and absent identity cannot persist or claim persistence', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  for (const storage of [blocked, null]) { assert.equal(read(storage, 'key').storageAvailable, false); assert.equal(write(storage, 'key', defaultAppearance), false); }
  for (const key of [keyFor('', 'aea'), keyFor('josh', ''), null]) { assert.equal(key, null); assert.equal(read(storageFixture(), key).storageAvailable, false); assert.equal(write(storageFixture(), key, defaultAppearance), false); }
});
