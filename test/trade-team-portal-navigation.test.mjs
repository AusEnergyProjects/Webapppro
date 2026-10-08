import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createMapNavigationGuard } from '../src/lib/trade-map-navigation.ts';

const portal = readFileSync(new URL('../src/components/TradeTeamPortal.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('TradeTeamPortal.tsx', portal, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = source.statements.filter(node => ts.isFunctionDeclaration(node)
  && ['teamWorkspaceLocation', 'teamCrmShortcuts', 'canUseTeamSales', 'TeamWorkspaceNavigation'].includes(node.name?.text));
assert.equal(functions.length, 4);
const executable = ts.transpileModule(functions.map(node => node.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
const jsx = (type, props, ...children) => ({ type, props: { ...props, children } });
const context = {
  React: { createElement: jsx }, URLSearchParams,
  TLinkNavigationIcon: 'Icon', TradeMessageUnreadBadge: 'UnreadBadge',
};
runInNewContext(`${executable}\nglobalThis.renderNavigation = TeamWorkspaceNavigation;globalThis.workspaceLocation = teamWorkspaceLocation;`, context);
const flatten = value => Array.isArray(value) ? value.flatMap(flatten)
  : value && typeof value === 'object' ? [value, ...flatten(value.props?.children)] : [];
const label = value => Array.isArray(value) ? value.map(label).join('')
  : value && typeof value === 'object' ? label(value.props?.children) : typeof value === 'string' ? value : '';
const base = { jobScope: 'own', scheduleScope: 'own', canViewCustomers: false, canSearchCustomers: false,
  canViewPriceBook: false, canManageTeam: false, canViewQuotes: false, canManageQuotes: false };
function render(permissions = {}, view = 'business', crmView = 'jobs', crewId) {
  const destinations = [], tree = context.renderNavigation({ permissions: { ...base, ...permissions }, view, crmView, crewId,
    onView: id => destinations.push(['portal', id]), onCrm: id => destinations.push(['crm', id]) });
  const buttons = flatten(tree).filter(node => node.type === 'button');
  return { tree, buttons, destinations, button: name => buttons.find(node => label(node) === name) };
}

test('field staff use one Home and Jobs workflow with Connect and their schedule', () => {
  const ui = render();
  assert.deepEqual(ui.buttons.map(label), ['Home dashboard', 'Jobs', 'Schedule', 'My time', 'Connect ', 'Forms', 'Tasks & training', 'Wattzun', 'My profile']);
  assert.equal(ui.tree.props['aria-label'], 'Staff workspace');
  assert.equal(ui.tree.props.className, 'dashboard-workspace-nav tlink-workspace-nav');
  assert.deepEqual(flatten(ui.tree).filter(node => node.type === 'h2').map(label), ['Daily work', 'Business tools', 'Specialist tools']);
  assert.equal(ui.button('Jobs').props['aria-current'], 'page');
  assert.equal(ui.button('My work'), undefined);
  assert.equal(flatten(ui.tree).filter(node => node.type === 'UnreadBadge').length, 1);
  ui.button('Schedule').props.onClick();
  assert.deepEqual(ui.destinations, [['crm', 'schedule']]);
});

test('Home selects the scoped dashboard and Connect keeps its communication destination', () => {
  const ui = render({}, 'business', 'today');
  assert.equal(ui.button('Home dashboard').props['aria-current'], 'page');
  assert.equal(ui.button('Jobs').props['aria-current'], undefined);
  ui.button('Home dashboard').props.onClick();
  ui.button('Connect ').props.onClick();
  assert.deepEqual(ui.destinations, [['crm', 'today'], ['portal', 'messages']]);
  assert.equal(flatten(ui.button('Connect ')).find(node => node.type === 'Icon').props.name, 'connect');
  assert.equal(render({ canViewInvoices: true, canRunReports: true }).button('Invoices'), undefined,
    'staff use scoped job invoices, not the owner-only invoice register');
});

test('Wattzun has its own active staff destination without changing work permissions', () => {
  const ui = render({}, 'wattzun', 'today');
  assert.equal(ui.button('Wattzun').props['aria-current'], 'page');
  assert.equal(ui.button('Home dashboard').props['aria-current'], undefined);
  assert.equal(ui.button('Customers'), undefined);
  ui.button('Wattzun').props.onClick();
  assert.deepEqual(ui.destinations, [['portal', 'wattzun']]);
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

test('Sales requires current customer and quote visibility and never grants crew access', () => {
  for (const permissions of [{}, { canViewCustomers: true }, { canViewQuotes: true },
    { canManageJobs: true, canManageQuotes: true },
    { canViewCustomers: true, canViewQuotes: true, jobScope: 'invalid' }]) {
    assert.equal(render(permissions).button('Sales'), undefined);
  }
  assert.equal(render({ canViewCustomers: true, canViewQuotes: true }, 'sales', 'jobs', 'crew-1').button('Sales'), undefined);
  for (const jobScope of ['own', 'team']) {
    const ui = render({ canViewCustomers: true, canViewQuotes: true, jobScope }, 'sales');
    assert.equal(ui.button('Sales').props['aria-current'], 'page');
    ui.button('Sales').props.onClick();
    assert.deepEqual(ui.destinations, [['portal', 'sales']]);
  }
  assert.match(portal, /portalView === "sales" && salesAllowed && <TradeSalesWorkspace/);
  assert.match(portal, /portalView === "sales" && !salesAllowed/);
});

const content = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'TradeTeamPortalContent');
const salesHandlers = content.body.statements.filter(node => ts.isFunctionDeclaration(node)
  && ['openSalesJob', 'openSalesQuote'].includes(node.name?.text));
assert.equal(salesHandlers.length, 2);
const handlersExecutable = ts.transpileModule(salesHandlers.map(node => node.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function salesNavigation(leave) {
  const guard = createMapNavigationGuard(), pending = [], changes = [];
  guard.register(leave);
  const handlerContext = { mapNavigation: { run: transition => { const operation = guard.run(transition); pending.push(operation); return operation; } },
    setCrmView: view => changes.push(['view', view]), setCrmTarget: target => changes.push(['target', target]),
    setPortalViewState: view => changes.push(['portal', view]) };
  runInNewContext(`${handlersExecutable}\nglobalThis.openJob=openSalesJob;globalThis.newQuote=openSalesQuote;`, handlerContext);
  return { changes, openJob: async (id, tab) => { handlerContext.openJob(id, tab); await Promise.all(pending); },
    newQuote: async () => { handlerContext.newQuote(); await Promise.all(pending); } };
}

test('Sales opens the same job and permitted quote tab through the existing leave guard', async () => {
  for (const tab of ['summary', 'quote']) {
    const navigation = salesNavigation(async () => {});
    await navigation.openJob('job-123', tab);
    assert.deepEqual(navigation.changes.filter(change => change[0] !== 'target'), [['view', 'jobs'], ['portal', 'business']]);
    const target = navigation.changes.find(change => change[0] === 'target')[1];
    assert.equal(target.workspace, 'work'); assert.equal(target.kind, 'job'); assert.equal(target.id, 'job-123'); assert.equal(target.jobTab, tab);
  }
  const blocked = salesNavigation(async () => { throw new Error('Keep the unsaved draft'); });
  await blocked.openJob('job-123', 'quote');
  assert.deepEqual(blocked.changes, []);
  assert.match(portal, /onRegisterLeave=\{registerMapSave\}/);
});

test('Sales quote creation uses the existing job quote path and requires create plus team quote authority', async () => {
  const navigation = salesNavigation(async () => {});
  await navigation.newQuote();
  const target = navigation.changes.find(change => change[0] === 'target')[1];
  assert.equal(target.workspace, 'work'); assert.equal(target.kind, 'new-job'); assert.equal(target.jobTab, 'quote');
  assert.match(portal, /canCreateSalesQuote = salesAllowed && permissions\?\.canCreateJobs && permissions\.jobScope === "team" && permissions\.canManageQuotes/);
  assert.match(portal, /onNewQuote=\{canCreateSalesQuote \? openSalesQuote : undefined\}/);
  const blocked = salesNavigation(async () => { throw new Error('Keep the unsaved draft'); });
  await blocked.newQuote(); assert.deepEqual(blocked.changes, []);
});

test('authenticated team shell exposes installation and theme while public invitation chrome stays conditional', () => {
  assert.match(portal, /!teamReady && <TLinkHeader active="team"/);
  assert.match(portal, /!teamReady && <SiteFooter>/);
  assert.match(portal, /className="tlink-get-app" href="\/direct-trade\/field-app"/);
  assert.match(portal, /aria-label="Night mode" aria-pressed=\{colourMode === "night"\}/);
  assert.match(portal, /readTradePersonalAppearance\(storage, appearanceScope\)/);
  assert.match(portal, /writeTradePersonalAppearance\(storage, appearanceScope, next\)/);
  assert.match(portal, /tradePersonalAppearanceStorageKey\(user\?\.uid \|\| "", business\?\.ownerUid \|\| ""\)/);
  assert.doesNotMatch(portal, /TLINK_COLOUR_MODE_STORAGE_KEY|writeTLinkColourMode|readTLinkColourMode/);
  assert.doesNotMatch(portal, /className="team-portal-hero"/);
  assert.doesNotMatch(portal, /tlink-team-header|tlink-team-navigation|tlink-team-themeToggle/);
  assert.match(portal, /<header className="dashboard-hero" ref=\{headerRef\}/);
  assert.match(portal, /<TLinkBrand context="Team workspace"/);
  assert.match(portal, /data-trade-theme=\{teamReady \? personalTheme : undefined\}/);
  assert.match(portal, /personalTheme = appearance\.themeKey \|\| employerTheme/);
  assert.match(portal, /<TeamWorkspaceHeader key=\{user\.uid\} businessName=\{data\.access\.businessName\}/);
  assert.match(portal, /shell\.style\.setProperty\("--trade-header-stack-height"/);
});

test('staff sidebar uses shared active styling without exposing owner-only destinations', () => {
  for (const [view, crmView, selected] of [['business', 'today', 'Home dashboard'], ['business', 'jobs', 'Jobs'], ['business', 'schedule', 'Schedule'], ['messages', 'jobs', 'Connect '], ['forms', 'jobs', 'Forms'], ['training', 'jobs', 'Tasks & training'], ['wattzun', 'jobs', 'Wattzun']]) {
    const ui = render({}, view, crmView);
    assert.match(ui.button(selected).props.className, /\bactive\b/);
    assert.equal(ui.buttons.filter(button => /\bactive\b/.test(button.props.className)).length, 1);
    for (const name of ['Business settings', 'Leads', 'Finance', 'Follow-ups', 'Trade network', 'Calculator']) assert.equal(ui.button(name), undefined);
  }
});

test('direct tools retain the original staff permission object and save map designs before leaving', () => {
  assert.match(portal, /staffPermissions=\{permissions\}/);
  assert.match(portal, /mapWorkspace=\{portalView === "map"\}/);
  assert.match(portal, /onRegisterMapSave=\{registerMapSave\}/);
  assert.match(portal, /mapNavigation\.run\(\(\) => setPortalViewState\(view\)\)/);
  assert.doesNotMatch(portal, /TradeFieldWorkPanel|TradeJobFormsPanel|todayJobs|selectedJobId|includeWork=1/);
  assert.match(portal, /fetch\("\/api\/trade-team",/);
});

test('crew and time views never imply financial or team administration access', () => {
  const ui = render({}, 'crew', 'jobs', 'crew-1');
  ui.button('My crew').props.onClick(); ui.button('My time').props.onClick();
  assert.deepEqual(ui.destinations, [['portal','crew'],['portal','time']]);
  assert.equal(ui.button('Team'), undefined);assert.equal(ui.button('Products'), undefined);assert.equal(ui.button('Customers'), undefined);
});


test('legacy work and saved job links open the canonical workspace and preserve the requested record', () => {
  for (const workspace of ['work', 'jobs']) {
    const result = context.workspaceLocation('?workspace=' + workspace);
    assert.equal(result.view, 'business'); assert.equal(result.target.kind, 'crm-view'); assert.equal(result.target.id, 'jobs');
  }
  const job = context.workspaceLocation('?workspace=work&jobId=job-123&jobTab=files');
  assert.equal(job.target.kind, 'job'); assert.equal(job.target.id, 'job-123'); assert.equal(job.target.jobTab, 'field');
  for (const tab of ['quote', 'invoice', 'field', 'summary', 'schedule']) assert.equal(context.workspaceLocation('?workspace=work&jobId=job-123&jobTab=' + tab).target.jobTab, tab);
  assert.equal(context.workspaceLocation('?workspace=work&jobId=%3Cscript%3E').target.kind, 'crm-view');
  assert.equal(context.workspaceLocation('').target.id, 'today');
});

test('saved customer deep links select the exact existing customer through the work workspace',()=>{
  const customer=context.workspaceLocation('?workspace=work&customerId=customer-saved:123');
  assert.equal(customer.view,'business');assert.equal(customer.target.kind,'customer');assert.equal(customer.target.id,'customer-saved:123');
  assert.equal(context.workspaceLocation('?workspace=work&customerId=%3Cscript%3E').target.kind,'crm-view');
  assert.equal(context.workspaceLocation('?workspace=sales&customerId=customer-saved').target,null);
  assert.equal(context.workspaceLocation('?workspace=work&jobId=job-saved&customerId=customer-saved').target.kind,'job');
});

test('staff customer links remain in sync and remove stale record targets after navigation',()=>{
  const effects=[];
  const findEffects=node=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect')effects.push(node.arguments[0]);ts.forEachChild(node,findEffects);};findEffects(source);
  const effect=effects.find(node=>node.getText(source).includes('!nextUrl.searchParams.has("customerId")'));
  const compiled=ts.transpileModule(`const effect=${effect.getText(source)};globalThis.effect=effect;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  for(const [portalView,crmTarget,expected] of [['business',{kind:'customer',id:'saved-new-customer'},{workspace:'work',customerId:'saved-new-customer'}],['business',{kind:'job',id:'saved-new-job',jobTab:'quote'},{workspace:'work',jobId:'saved-new-job',jobTab:'quote'}],['business',{kind:'crm-view',id:'customers'},{workspace:'customers'}],['forms',{kind:'customer',id:'old-customer'},{workspace:'forms'}]]) {
    const changes=[];
    const environment={URL,portalView,crmTarget,workspaceLocation:{current:''},teamWorkspaceLocation:context.workspaceLocation,
      window:{location:{href:'https://fixture.invalid/direct-trade/team?workspace=work&customerId=old-customer&jobId=stale-job&jobTab=invoice'},history:{state:{},replaceState:(_state,_title,href)=>changes.push(href)}}};
    runInNewContext(compiled,environment);environment.effect();assert.equal(changes.length,1);
    const parameters=new URL(changes[0],'https://fixture.invalid').searchParams;
    for(const key of ['workspace','customerId','jobId','jobTab'])assert.equal(parameters.get(key),expected[key]||null,`${portalView}/${crmTarget.kind} serialises ${key}`);
  }
});

test('staff record deep links respect an unsaved-work guard and restore the prior URL on rejection',async()=>{
  const effects=[];
  const findEffects=node=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect')effects.push(node.arguments[0]);ts.forEachChild(node,findEffects);};findEffects(source);
  const effect=effects.find(node=>node.getText(source).includes('const applyWorkspaceLink'));
  const compiled=ts.transpileModule(`const effect=${effect.getText(source)};globalThis.effect=effect;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  for(const rejected of [false,true]) {
    const changes=[],mapNavigation=createMapNavigationGuard(),listeners=new Map();
    if(rejected)mapNavigation.register(async()=>{throw new Error('Preserve unsaved work');});
    const environment={mapNavigation,teamWorkspaceLocation:context.workspaceLocation,workspaceLocation:{current:'/direct-trade/team?workspace=map'},setPortalViewState:value=>changes.push(['view',value]),setCrmTarget:value=>changes.push(['target',value]),setCrmView:value=>changes.push(['crm',value]),
      window:{location:{pathname:'/direct-trade/team',search:'?workspace=work&customerId=saved-customer',hash:''},history:{state:{},replaceState:(_state,_title,href)=>changes.push(['restore',href])},addEventListener:(type,callback)=>listeners.set(type,callback),removeEventListener:type=>listeners.delete(type)}};
    runInNewContext(compiled,environment);const cleanup=environment.effect();await new Promise(resolve=>setImmediate(resolve));
    if(rejected)assert.deepEqual(changes,[['restore','/direct-trade/team?workspace=map']]);
    else {assert.equal(changes[1][1].kind,'customer');assert.equal(changes[1][1].id,'saved-customer');assert.deepEqual(changes[2],['crm','customers']);}
    cleanup();assert.equal(listeners.size,0);
  }
});

test('Sales, tasks, training, communication, time and profile deep links keep their destinations', () => {
  for (const view of ['sales', 'tasks', 'training', 'messages', 'time', 'profile']) {
    const result = context.workspaceLocation('?workspace=' + view);
    assert.equal(result.view, view); assert.equal(result.target, null);
  }
  assert.match(portal, /window\.addEventListener\("popstate", applyWorkspaceLink\)/);
  assert.match(portal, /portalView === "profile" && <TradePersonalProfileSettings/);
  assert.doesNotMatch(portal, /TradePersonalNameSettings/);
});

test('ordinary staff can open their own profile without business settings or administration', () => {
  const ui = render({}, 'profile');
  assert.equal(ui.button('My profile').props['aria-current'], 'page');
  ui.button('My profile').props.onClick();
  assert.deepEqual(ui.destinations, [['portal', 'profile']]);
  assert.equal(ui.button('Business settings'), undefined);
  assert.equal(ui.button('Team'), undefined);
  assert.match(portal, /onProfile=\{\(\) => setPortalView\("profile"\)\}/);
  assert.match(portal, /TradePersonalProfileSettings key=\{`\$\{user\.uid\}:\$\{business\?\.ownerUid\}:\$\{data\.access\.memberId\}`\}/);
});

test('Sales state remounts when the reader, business, membership or permission scope changes', () => {
  const statement = content.body.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'salesScopeKey'));
  const scopeExecutable = ts.transpileModule(statement.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const keyFor = (overrides = {}) => {
    const values = { user: { uid: 'person-1' }, business: { ownerUid: 'business-1' },
      data: { ownerUid: 'business-1', access: { memberId: 'member-1', crewId: '' } }, permissions: { ...base, canViewCustomers: true, canViewQuotes: true }, ...overrides };
    runInNewContext(`${scopeExecutable}\nglobalThis.key=salesScopeKey;`, values);
    return values.key;
  };
  const initial = keyFor();
  for (const changed of [{ user: { uid: 'person-2' } }, { business: { ownerUid: 'business-2' } },
    { data: { ownerUid: 'business-1', access: { memberId: 'member-2', crewId: '' } } },
    { permissions: { ...base, canViewCustomers: true, canViewQuotes: true, jobScope: 'team' } }]) assert.notEqual(keyFor(changed), initial);
  assert.match(portal, /TradeSalesWorkspace key=\{salesScopeKey\}/);
});

test('tasks and training share one visible navigation entry', () => {
  for (const view of ['tasks', 'training']) {
    const ui = render({}, view);
    assert.equal(ui.button('Tasks & training').props['aria-current'], 'page');
    ui.button('Tasks & training').props.onClick();
    assert.deepEqual(ui.destinations, [['portal', 'tasks']]);
  }
});


test('reports remain discoverable when inner CRM navigation is removed', () => {
  assert.equal(render().button('Reports'), undefined);
  const ui = render({ canRunReports: true }, 'business', 'reports');
  assert.equal(ui.button('Reports').props['aria-current'], 'page');
  ui.button('Reports').props.onClick();
  assert.deepEqual(ui.destinations, [['crm', 'reports']]);
  assert.match(portal, /hideNavigation=\{portalView !== "map"\}/);
});
