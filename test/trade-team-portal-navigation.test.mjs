import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const portal = readFileSync(new URL('../src/components/TradeTeamPortal.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('TradeTeamPortal.tsx', portal, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = source.statements.filter(node => ts.isFunctionDeclaration(node)
  && ['teamCrmShortcuts', 'TeamWorkspaceNavigation'].includes(node.name?.text));
assert.equal(functions.length, 2);
const executable = ts.transpileModule(functions.map(node => node.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
const jsx = (type, props, ...children) => ({ type, props: { ...props, children } });
const context = {
  React: { createElement: jsx },
  TLinkNavigationIcon: 'Icon', TradeMessageUnreadBadge: 'UnreadBadge',
};
runInNewContext(`${executable}\nglobalThis.renderNavigation = TeamWorkspaceNavigation;`, context);
const flatten = value => Array.isArray(value) ? value.flatMap(flatten)
  : value && typeof value === 'object' ? [value, ...flatten(value.props?.children)] : [];
const label = value => Array.isArray(value) ? value.map(label).join('')
  : value && typeof value === 'object' ? label(value.props?.children) : typeof value === 'string' ? value : '';
const base = { jobScope: 'own', scheduleScope: 'own', canViewCustomers: false, canSearchCustomers: false,
  canViewPriceBook: false, canManageTeam: false, canViewQuotes: false, canManageQuotes: false };
function render(permissions = {}, view = 'work', crmView = 'jobs', crewId) {
  const destinations = [], tree = context.renderNavigation({ permissions: { ...base, ...permissions }, view, crmView, crewId,
    onView: id => destinations.push(['portal', id]), onCrm: id => destinations.push(['crm', id]) });
  const buttons = flatten(tree).filter(node => node.type === 'button');
  return { tree, buttons, destinations, button: name => buttons.find(node => label(node) === name) };
}

test('field staff see Home, work, Connect, jobs and their schedule without restricted tools', () => {
  const ui = render();
  assert.deepEqual(ui.buttons.map(label), ['Home dashboard', 'My work', 'My time', 'Connect ', 'Jobs', 'Schedule', 'To do & training']);
  assert.equal(ui.tree.props['aria-label'], 'Staff workspace');
  assert.equal(ui.button('My work').props['aria-current'], 'page');
  assert.equal(flatten(ui.tree).filter(node => node.type === 'UnreadBadge').length, 1);
  ui.button('Schedule').props.onClick();
  assert.deepEqual(ui.destinations, [['crm', 'schedule']]);
});

test('Home selects the scoped dashboard and Connect keeps its communication destination', () => {
  const ui = render({}, 'business', 'today');
  assert.equal(ui.button('Home dashboard').props['aria-current'], 'page');
  assert.equal(ui.button('My work').props['aria-current'], undefined);
  ui.button('Home dashboard').props.onClick();
  ui.button('Connect ').props.onClick();
  assert.deepEqual(ui.destinations, [['crm', 'today'], ['portal', 'messages']]);
  assert.equal(flatten(ui.button('Connect ')).find(node => node.type === 'Icon').props.name, 'connect');
  assert.equal(render({ canViewInvoices: true, canRunReports: true }).button('Invoices'), undefined,
    'staff use scoped job invoices, not the owner-only invoice register');
});

test('customer directory requires both existing view and search permissions', () => {
  assert.equal(render({ canViewCustomers: true }).button('Customers'), undefined);
  assert.equal(render({ canSearchCustomers: true }).button('Customers'), undefined);
  const ui = render({ canViewCustomers: true, canSearchCustomers: true });
  ui.button('Customers').props.onClick();
  assert.deepEqual(ui.destinations, [['crm', 'customers']]);
});

test('price book shortcut points to the supported staff CRM target and marks selection', () => {
  const ui = render({ canViewPriceBook: true }, 'business', 'pricebook');
  assert.equal(ui.button('Products').props['aria-current'], 'page');
  assert.equal(ui.button('Jobs').props['aria-current'], undefined);
  ui.button('Products').props.onClick();
  assert.deepEqual(ui.destinations, [['crm', 'pricebook']]);
});

test('map design and team management retain their distinct permission gates', () => {
  assert.equal(render({ canViewQuotes: true }).button('Map & quote'), undefined);
  assert.equal(render({ canManageQuotes: true }).button('Map & quote'), undefined);
  const ui = render({ canViewQuotes: true, canManageQuotes: true, canManageTeam: true });
  ui.button('Map & quote').props.onClick();ui.button('Team').props.onClick();
  assert.deepEqual(ui.destinations, [['portal', 'map'], ['portal', 'team']]);
  assert.equal(ui.button('Quotes'), undefined, 'a quotes-list destination is not supported by the existing staff CRM');
});

test('authenticated team shell exposes installation and theme while public invitation chrome stays conditional', () => {
  assert.match(portal, /!teamReady && <TLinkHeader active="team"/);
  assert.match(portal, /!teamReady && <SiteFooter>/);
  assert.match(portal, /className="tlink-team-getApp" href="\/direct-trade\/field-app"/);
  assert.match(portal, /aria-label="Night mode" aria-pressed=\{colourMode === "night"\}/);
  assert.match(portal, /readTLinkColourMode\(window\.localStorage\)/);
  assert.match(portal, /writeTLinkColourMode\(window\.localStorage, next\)/);
  assert.doesNotMatch(portal, /className="team-portal-hero"/);
});

test('direct tools retain the original staff permission object and save map designs before leaving', () => {
  assert.match(portal, /staffPermissions=\{permissions\}/);
  assert.match(portal, /mapWorkspace=\{portalView === "map"\}/);
  assert.match(portal, /onRegisterMapSave=\{registerMapSave\}/);
  assert.match(portal, /mapNavigation\.run\(\(\) => setPortalViewState\(view\)\)/);
  assert.match(portal, /permissions\?\.canViewQuotes && <button className="tlink-team-quoteButton"/);
});

test('crew and time views never imply financial or team administration access', () => {
  const ui = render({}, 'crew', 'jobs', 'crew-1');
  ui.button('My crew').props.onClick(); ui.button('My time').props.onClick();
  assert.deepEqual(ui.destinations, [['portal','crew'],['portal','time']]);
  assert.equal(ui.button('Team'), undefined);assert.equal(ui.button('Products'), undefined);assert.equal(ui.button('Customers'), undefined);
});
