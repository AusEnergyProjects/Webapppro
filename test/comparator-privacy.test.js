/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const comparatorPath = path.resolve(__dirname, '../public/electricity-comparator.html');
const comparator = fs.readFileSync(comparatorPath, 'utf8');

test('comparison reminder links never write or restore an NMI query parameter', () => {
  assert.doesNotMatch(comparator, /q\.set\(['"]nmi['"]/);
  assert.doesNotMatch(comparator, /q\.get\(['"]nmi['"]\)/);
});

test('meter-based reminder links require a local re-upload instead of auto-running', () => {
  assert.match(comparator, /needsMeterUpload\?'0':'1'/);
  assert.match(comparator, /q\.set\('meter','reupload'\)/);
  assert.match(comparator, /q\.get\('meter'\)==='reupload'/);
});

test('lead forms submit only to the same-origin application endpoint', () => {
  assert.match(comparator, /const LEAD_API = '\/api\/leads'/);
  assert.doesNotMatch(comparator, /script\.google\.com\/macros/);
  assert.doesNotMatch(comparator, /mode:'no-cors'/);
});
