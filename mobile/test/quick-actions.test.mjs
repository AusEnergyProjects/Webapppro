import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8');
const work = read('../src/app/(tabs)/work.tsx');
const job = read('../src/app/job/[id].tsx');
const commercial = read('../src/components/field-commercial-workspace.tsx');
const accessRoute = read('../../src/app/api/field/access/route.ts');
const fieldPermissions = read('../../src/lib/trade-field-permissions.ts');
const quoteRoute = read('../../src/app/api/trade-quotes/route.ts');
const invoiceRoute = read('../../src/app/api/trade-quick-invoices/route.ts');

test('schedule plus menu offers permission-aware job, quote and invoice actions', () => {
  assert.match(work, /accessibilityLabel="Open new action menu"/);
  assert.match(work, /New job/);
  assert.match(work, /New quote/);
  assert.match(work, /New invoice/);
  assert.match(work, /apiRequest<\{ permissions: FieldPermissions \| null \}>\('\/api\/field\/access'\)/);
  assert.match(work, /user\?\.permissions\.canCreateJobs/);
  assert.match(work, /commercialPermissions\?\.canManageQuotes/);
  assert.match(work, /commercialPermissions\?\.canManageInvoices/);
  assert.match(work, /!job\.protectedJob && job\.fieldLane !== 'creditex_manual'/);
});

test('commercial quick actions deep-link to the existing native job editor', () => {
  assert.match(work, /pathname: '\/job\/\[id\]'/);
  assert.match(work, /params: \{ id: job\.id, openCommercial: kind \}/);
  assert.match(job, /useLocalSearchParams<\{ id: string; openCommercial\?: string \}>/);
  assert.match(job, /openCommercial === 'quote' \|\| openCommercial === 'invoice'/);
  assert.match(job, /<FieldCommercialWorkspace workOrderId=\{job\.id\} selected=\{activeFormId\}/);
  assert.match(commercial, /kind === 'quote' \? '\/api\/trade-quotes' : '\/api\/trade-quick-invoices'/);
});

test('server projections and document routes remain the authority for boss and team grants', () => {
  assert.match(accessRoute, /permissions = tradeFieldPermissions\(trade\)/);
  assert.match(fieldPermissions, /canManageQuotes: access\.isOwner \|\| \(access\.canViewQuotes && access\.canManageQuotes\)/);
  assert.match(fieldPermissions, /canManageInvoices: access\.isOwner \|\| \(access\.canViewInvoices && access\.canManageInvoices\)/);
  assert.match(quoteRoute, /if \(permission === "manage" && !canManageQuotes\(access\)\) throw new Error\("QUOTE_MANAGEMENT_REQUIRED"\)/);
  assert.match(invoiceRoute, /if \(manage \? !access\.canManageInvoices && !access\.isOwner : !access\.canViewInvoices && !access\.isOwner\)/);
});
