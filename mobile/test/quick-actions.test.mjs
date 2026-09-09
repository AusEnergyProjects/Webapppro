import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8');
const work = read('../src/app/(tabs)/work.tsx');
const quickCommercial = read('../src/app/new-commercial.tsx');
const commercial = read('../src/components/field-commercial-workspace.tsx');
const screen = read('../src/components/screen.tsx');
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
  assert.match(work, /pathname: '\/new-commercial'/);
  assert.doesNotMatch(work, /commercialJobs\.map/);
});

test('commercial quick actions are search-first and reuse the native line editor', () => {
  assert.match(quickCommercial, /Name, mobile, email or address/);
  assert.match(quickCommercial, /if \(term\.length < 2\)/);
  assert.match(quickCommercial, /find_quick_quote_customers/);
  assert.match(quickCommercial, /result\.matches\.slice\(0, 10\)/);
  assert.match(quickCommercial, /resource=jobs&search=\$\{encodeURIComponent\(term\)\}&pageSize=25&total=0&commercial=invoice/);
  assert.match(quickCommercial, /item\.customerSource !== 'platform_private' && item\.stage !== 'cancelled'/);
  assert.match(quickCommercial, /\.slice\(0, 10\)/);
  assert.match(quickCommercial, /action: 'create_quick_quote_job'/);
  assert.match(quickCommercial, /'\/api\/trade-address-suggestions'/);
  assert.match(quickCommercial, /action: 'predict'/);
  assert.match(quickCommercial, /action: 'resolve'/);
  assert.match(quickCommercial, /accessibilityLabel=\{`Use address \$\{prediction\.label\}`\}/);
  assert.match(quickCommercial, /addressEntryMode: addressProvenance\.entryMode/);
  assert.match(quickCommercial, />Google Maps<\/Text>/);
  assert.doesNotMatch(quickCommercial, /showProperty|Add optional mobile or property|Mobile, optional|Search street address, optional|Suburb, optional/);
  assert.match(quickCommercial, /<FieldInput label="Mobile"/);
  assert.match(quickCommercial, /<FieldInput label="Search street address"/);
  assert.match(quickCommercial, /<FieldInput label="Suburb"/);
  assert.match(quickCommercial, /phone\.replace\(\/\\D\/g, ''\)\.length < 8/);
  assert.match(quickCommercial, /AUSTRALIAN_STATES\.has\(addressState\.trim\(\)\.toUpperCase\(\)\)/);
  assert.match(quickCommercial, /selectedCustomer\?\.phone \|\| phone/);
  assert.match(quickCommercial, /<FieldCommercialWorkspace/);
  assert.match(quickCommercial, /stage !== 'editor'/);
  assert.match(quickCommercial, /Retry work types/);
  assert.match(commercial, /kind === 'quote' \? '\/api\/trade-quotes' : '\/api\/trade-quick-invoices'/);
  assert.match(screen, /import \{ KeyboardAwareScrollView \} from '@\/components\/keyboard-aware-scroll-view'/);
  assert.match(screen, /<KeyboardAwareScrollView/);
  assert.doesNotMatch(screen, /scrollResponderScrollNativeHandleToKeyboard|automaticallyAdjustKeyboardInsets/);
});

test('server projections and document routes remain the authority for boss and team grants', () => {
  assert.match(accessRoute, /permissions = tradeFieldPermissions\(trade\)/);
  assert.match(fieldPermissions, /canManageQuotes: access\.isOwner \|\| \(access\.canViewQuotes && access\.canManageQuotes\)/);
  assert.match(fieldPermissions, /canManageInvoices: access\.isOwner \|\| \(access\.canViewInvoices && access\.canManageInvoices\)/);
  assert.match(quoteRoute, /if \(permission === "manage" && !canManageQuotes\(access\)\) throw new Error\("QUOTE_MANAGEMENT_REQUIRED"\)/);
  assert.match(invoiceRoute, /if \(manage \? !access\.canManageInvoices && !access\.isOwner : !access\.canViewInvoices && !access\.isOwner\)/);
});
