import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as events from '../src/lib/trade-calendar-events.ts';
import { scheduleAppointmentLanes, scheduleDisplayWindow } from '../src/lib/trade-schedule.ts';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
function load(path, mocks, diagnosticConsole = console) {
  const source = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', 'console', source)(specifier => {
    if (!Object.hasOwn(mocks, specifier)) throw new Error(`Unexpected dependency ${specifier}`);
    return mocks[specifier];
  }, loaded, loaded.exports, diagnosticConsole);
  return loaded.exports;
}
const window = events.externalCalendarWindow('2026-10-01', '2026-10-08', 'NSW');
const mirrors = () => ({ externalIds: new Set(), appointmentIds: new Set() });
const google = overrides => ({ id: 'g1', status: 'confirmed', summary: 'Accepted meeting', attendees: [{ self: true, responseStatus: 'accepted' }], start: { dateTime: '2026-10-02T09:00:00+10:00' }, end: { dateTime: '2026-10-02T10:00:00+10:00' }, htmlLink: 'https://calendar.google.com/calendar/event?eid=g1', ...overrides });
const microsoft = overrides => ({ id: 'm1', subject: 'Teams meeting', responseStatus: { response: 'accepted' }, start: { dateTime: '2026-10-01T23:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-02T00:00:00.0000000', timeZone: 'UTC' }, onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/example' }, webLink: 'https://outlook.office.com/calendar/item/m1', ...overrides });
function normalize(provider, event, known = mirrors()) { return events.normalizeExternalCalendarEvent(provider, event, window, 'owner-member', known); }

test('calendar windows validate dates and limits and use exact Australian DST/half-hour UTC boundaries', () => {
  const dst = events.externalCalendarWindow('2026-10-03', '2026-10-05', 'NSW');
  assert.equal(dst.startUtc, '2026-10-02T14:00:00.000Z');
  assert.equal(dst.endUtc, '2026-10-04T13:00:00.000Z');
  assert.equal(Date.parse(dst.endUtc) - Date.parse(dst.startUtc), 47 * 3_600_000);
  assert.equal(events.externalCalendarWindow('2026-10-01', '2026-10-02', 'SA').startUtc, '2026-09-30T14:30:00.000Z');
  for (const [start, end] of [['2026-02-30', '2026-03-02'], ['2026-10-02', '2026-10-02'], ['2026-10-02', '2026-10-01'], ['2026-10-01', '2026-11-02'], ['invalid', '2026-10-02']]) assert.throws(() => events.externalCalendarWindow(start, end), /INVALID_CALENDAR_RANGE/);
});

test('Google includes accepted and own events, but omits unanswered, tentative, declined and cancelled invitations', () => {
  assert.equal(normalize('google_calendar', google()).startsAt, '2026-10-02T09:00');
  assert.ok(normalize('google_calendar', google({ attendees: [], organizer: { self: true } })));
  for (const status of ['needsAction', 'tentative', 'declined']) assert.equal(normalize('google_calendar', google({ attendees: [{ self: true, responseStatus: status }] })), null);
  assert.equal(normalize('google_calendar', google({ status: 'cancelled' })), null);
  assert.equal(normalize('google_calendar', google({ status: 'tentative' })), null);
  assert.equal(normalize('google_calendar', google({ attendees: [], organizer: { self: false } })), null);
});

test('Graph accepted/organiser events are projected with Teams links, UTC conversion and no attendee or body data', () => {
  const result = normalize('microsoft_calendar', microsoft({ body: { content: 'private body' }, attendees: [{ emailAddress: { address: 'private@example.com' } }] }));
  assert.equal(result.startsAt, '2026-10-02T09:00'); assert.match(result.joinUrl, /teams\.microsoft\.com/);
  assert.doesNotMatch(JSON.stringify(result), /private body|private@example.com/);
  assert.ok(normalize('microsoft_calendar', microsoft({ isOrganizer: true, responseStatus: { response: 'organizer' } })));
  for (const status of ['notResponded', 'tentativelyAccepted', 'declined', 'none']) assert.equal(normalize('microsoft_calendar', microsoft({ responseStatus: { response: status } })), null);
  assert.equal(normalize('microsoft_calendar', microsoft({ isCancelled: true })), null);
});

test('all-day and multi-day overlaps preserve exclusive ends and show events already in progress', () => {
  const allDay = normalize('google_calendar', google({ start: { date: '2026-09-30' }, end: { date: '2026-10-03' } }));
  assert.equal(allDay.allDay, true);
  assert.ok(events.externalCalendarEventOnDay(allDay, '2026-10-02'));
  assert.equal(events.externalCalendarEventOnDay(allDay, '2026-10-03'), null);
  const overnight = normalize('google_calendar', google({ start: { dateTime: '2026-10-01T23:30:00+10:00' }, end: { dateTime: '2026-10-02T01:30:00+10:00' } }));
  assert.equal(events.externalCalendarEventOnDay(overnight, '2026-10-02').startsAt, '2026-10-02T00:00');
  const graphAllDay = normalize('microsoft_calendar', microsoft({ isAllDay: true, start: { dateTime: '2026-10-01T14:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-10-02T14:00:00', timeZone: 'UTC' } }));
  assert.equal(graphAllDay.startsAt, '2026-10-02T00:00'); assert.equal(graphAllDay.endsAt, '2026-10-03T00:00');
  assert.equal(events.externalCalendarLastDay(graphAllDay), '2026-10-02');
  assert.equal(events.externalCalendarLastDay(overnight), '2026-10-02');
  assert.equal(normalize('google_calendar', google({ start: { date: '2026-09-29' }, end: { date: '2026-10-01' } })), null);
  assert.equal(normalize('google_calendar', google({ start: { date: '2026-10-08' }, end: { date: '2026-10-09' } })), null);
  assert.equal(normalize('google_calendar', google({ end: { dateTime: 'bad-date' } })), null);
});

test('events crossing a daylight-saving clock change retain exact offset times outside the ordinary time grid', () => {
  const foldWindow = events.externalCalendarWindow('2026-04-04', '2026-04-06', 'NSW');
  const folded = events.normalizeExternalCalendarEvent('google_calendar', google({ start: { dateTime: '2026-04-05T02:45:00+11:00' }, end: { dateTime: '2026-04-05T02:15:00+10:00' } }), foldWindow, 'owner-member', mirrors());
  assert.equal(folded.clockChange, true); assert.match(folded.timeDetail, /GMT\+11/); assert.match(folded.timeDetail, /GMT\+10/);
  assert.ok(events.externalCalendarEventOnDay(folded, '2026-04-05'));
  assert.equal(normalize('google_calendar', google()).clockChange, false);
  const ui = read('../src/components/TradeScheduleWorkspace.tsx');
  assert.match(ui, /!event\.allDay && !event\.clockChange/); assert.match(ui, /event\.allDay \|\| event\.clockChange/); assert.match(ui, /: event\.timeDetail/);
});

test('TLink outbound mappings and provider metadata prevent mirrored job duplication', () => {
  const known = { externalIds: new Set(['g1', 'm1']), appointmentIds: new Set(['appointment-1']) };
  assert.equal(normalize('google_calendar', google(), known), null);
  assert.equal(normalize('microsoft_calendar', microsoft(), known), null);
  assert.equal(normalize('google_calendar', google({ id: 'copied', extendedProperties: { private: { tlinkAppointmentId: 'appointment-1' } } }), known), null);
  assert.equal(normalize('microsoft_calendar', microsoft({ id: 'moved', transactionId: 'tlink-appointment-1' }), known), null);
  assert.ok(normalize('google_calendar', google({ id: 'other-business', extendedProperties: { private: { tlinkAppointmentId: 'other-business-appointment' } } }), known));
});

test('external timetable layout keeps long events and five-minute meetings at their actual size', () => {
  const long = { id: 'long', startsAt: '2026-10-02T08:00', endsAt: '2026-10-02T22:00' };
  const evening = { id: 'evening', startsAt: '2026-10-02T21:00', endsAt: '2026-10-02T21:05' };
  const layout = scheduleAppointmentLanes([long, evening], 'exact');
  assert.equal(layout.get('long').laneCount, 2); assert.notEqual(layout.get('long').lane, layout.get('evening').lane);
  assert.equal(scheduleDisplayWindow([long], 420, 1140, 'exact').endMinute, 23 * 60);
  const short = scheduleAppointmentLanes([{ id: 'first', startsAt: '2026-10-02T09:00', endsAt: '2026-10-02T09:05' }, { id: 'next', startsAt: '2026-10-02T09:06', endsAt: '2026-10-02T09:11' }], 'exact');
  assert.equal(short.get('first').laneCount, 1); assert.equal(short.get('next').laneCount, 1);
});

test('unsafe links and provider text are bounded without rendering HTML', () => {
  const result = normalize('google_calendar', google({ summary: '<script>alert(1)</script>\u0000' + 'a'.repeat(400), htmlLink: 'javascript:alert(1)', hangoutLink: 'https://meet.google.com.evil.test/secret' }));
  assert.equal(result.sourceUrl, ''); assert.equal(result.joinUrl, ''); assert.equal(result.title.length, 240); assert.doesNotMatch(result.title, /\u0000/);
});

function server(db = {}, { calendarAccessToken = async () => 'provider-test-token', warn = () => {} } = {}) { return load('../src/lib/trade-calendar-events-server.ts', { '../../db': { getD1: () => db }, './trade-calendar-sync-server': { calendarAccessToken }, './trade-calendar-events': events }, { warn }); }
async function withFetch(mock, work) { const previous = globalThis.fetch; globalThis.fetch = mock; try { return await work(); } finally { globalThis.fetch = previous; } }

test('provider list requests expand recurring occurrences without fetching or rewriting job data', async () => {
  const loaded = server(); const g = loaded.calendarReadUrl('google_calendar', window); const m = loaded.calendarReadUrl('microsoft_calendar', window);
  assert.equal(g.searchParams.get('singleEvents'), 'true'); assert.equal(g.searchParams.get('showDeleted'), 'false');
  assert.equal(m.pathname, '/v1.0/me/calendarView'); assert.match(m.searchParams.get('startDateTime'), /Z$/);
  const urls = [];
  await withFetch(async (url, init) => { urls.push(url); assert.equal(init.method, undefined); assert.equal(init.redirect, 'manual'); return Response.json(urls.length === 1 ? { items: [google()], nextPageToken: 'second-page' } : { items: [google({ summary: 'Updated occurrence' }), google({ id: 'next-occurrence' })] }); }, async () => {
    const result = await loaded.readExternalCalendarProvider({ provider: 'google_calendar' }, window, 'owner-member', mirrors());
    assert.equal(result.complete, true); assert.equal(result.events.length, 2); assert.equal(result.events[0].title, 'Updated occurrence');
    assert.match(urls[1], /pageToken=second-page/);
  });
});

test('calendar fetch options construct valid Requests in the actual Workers runtime', async () => {
  const { Miniflare } = await import('miniflare');
  const captured = []; const loaded = server();
  await withFetch(async (url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    const { signal, ...options } = init;
    assert.equal(signal.aborted, false);
    captured.push({ url, options });
    return Response.json(url.includes('googleapis.com') ? {} : { value: [] });
  }, async () => {
    for (const provider of ['google_calendar', 'microsoft_calendar']) assert.equal((await loaded.readExternalCalendarProvider({ provider }, window, 'owner-member', mirrors())).complete, true);
  });
  const runtime = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'], port: 0,
    script: `export default { async fetch(request) {
      const { url, options } = await request.json();
      try {
        const providerRequest = new Request(url, { ...options, signal: AbortSignal.timeout(12000) });
        return Response.json({ ok: true, redirect: providerRequest.redirect });
      } catch (error) { return Response.json({ ok: false, name: error.name }); }
    } }`,
  });
  const invoke = async payload => (await runtime.dispatchFetch('https://local.test/', { method: 'POST', body: JSON.stringify(payload) })).json();
  try {
    assert.deepEqual(await invoke({ ...captured[0], options: { ...captured[0].options, redirect: 'error' } }), { ok: false, name: 'TypeError' });
    for (const request of captured) assert.deepEqual(await invoke(request), { ok: true, redirect: 'manual' });
  } finally { await runtime.dispose(); }
});

test('calendar redirects fail without issuing a second request or forwarding credentials', async () => {
  const loaded = server();
  for (const provider of ['google_calendar', 'microsoft_calendar']) for (const status of [301, 302, 303, 307, 308]) {
    let requests = 0;
    await withFetch(async (url, init) => {
      requests += 1; assert.equal(init.redirect, 'manual'); assert.doesNotMatch(url, /redirect-target/);
      return new Response(null, { status, headers: { Location: 'https://redirect-target.example.test/collect' } });
    }, async () => {
      const result = await loaded.readExternalCalendarProvider({ provider }, window, 'owner-member', mirrors());
      assert.equal(result.complete, false); assert.deepEqual(result.events, []); assert.match(result.error, new RegExp(`HTTP ${status}`)); assert.equal(requests, 1);
    });
  }
});

test('provider refresh replaces cancelled or moved-out events instead of retaining stale imports', async () => {
  const loaded = server(); let cancelled = false;
  await withFetch(async () => Response.json({ items: cancelled ? [] : [google()] }), async () => {
    assert.equal((await loaded.readExternalCalendarProvider({ provider: 'google_calendar' }, window, 'owner-member', mirrors())).events.length, 1);
    cancelled = true;
    assert.equal((await loaded.readExternalCalendarProvider({ provider: 'google_calendar' }, window, 'owner-member', mirrors())).events.length, 0);
  });
});

test('Google omitted items is a successful empty page and does not stop pagination', async () => {
  const loaded = server();
  await withFetch(async () => Response.json({}), async () => {
    const result = await loaded.readExternalCalendarProvider({ provider: 'google_calendar' }, window, 'owner-member', mirrors());
    assert.deepEqual(result.events, []); assert.equal(result.complete, true); assert.equal(result.error, '');
  });
  const requests = [];
  await withFetch(async url => { requests.push(url); return Response.json(requests.length === 1 ? { nextPageToken: 'after-empty' } : { items: [google()] }); }, async () => {
    const result = await loaded.readExternalCalendarProvider({ provider: 'google_calendar' }, window, 'owner-member', mirrors());
    assert.equal(result.complete, true); assert.equal(result.events.length, 1); assert.equal(requests.length, 2); assert.match(requests[1], /pageToken=after-empty/);
  });
});

test('malformed Google results and missing Graph collections remain failures', async () => {
  const loaded = server();
  for (const [provider, payload] of [['google_calendar', null], ['google_calendar', []], ['google_calendar', { items: null }], ['google_calendar', { items: {} }], ['google_calendar', { error: { message: 'private provider detail' } }], ['microsoft_calendar', {}]]) {
    await withFetch(async () => Response.json(payload), async () => {
      const result = await loaded.readExternalCalendarProvider({ provider }, window, 'owner-member', mirrors());
      assert.equal(result.complete, false); assert.deepEqual(result.events, []); assert.match(result.error, /unreadable response/); assert.doesNotMatch(result.error, /private provider detail/);
    });
  }
});

test('pagination is bounded and reports incomplete results, and Graph never follows an untrusted next URL', async () => {
  const loaded = server(); let requests = 0;
  await withFetch(async () => { requests += 1; return Response.json({ items: [google({ id: String(requests) })], nextPageToken: String(requests) }); }, async () => {
    const result = await loaded.readExternalCalendarProvider({ provider: 'google_calendar' }, window, 'owner-member', mirrors());
    assert.equal(requests, 4); assert.equal(result.complete, false); assert.match(result.error, /Only part/);
  });
  requests = 0;
  await withFetch(async () => { requests += 1; return Response.json({ value: [microsoft()], '@odata.nextLink': 'https://evil.test/steal-token' }); }, async () => {
    const result = await loaded.readExternalCalendarProvider({ provider: 'microsoft_calendar' }, window, 'owner-member', mirrors());
    assert.equal(requests, 1); assert.equal(result.complete, false); assert.equal(result.events.length, 0);
  });
});

test('provider authentication, missing consent, timeout and server failures remain explicit', async () => {
  const loaded = server();
  for (const [status, message] of [[400, /HTTP 400/], [401, /Reconnect/], [403, /access was not granted/], [429, /HTTP 429/], [503, /HTTP 503/]]) await withFetch(async () => Response.json({ error: { message: 'private provider detail', token: 'secret-token' } }, { status }), async () => {
    const result = await loaded.readExternalCalendarProvider({ provider: 'google_calendar' }, window, 'owner-member', mirrors());
    assert.equal(result.complete, false); assert.equal(result.events.length, 0); assert.match(result.error, message);
    assert.doesNotMatch(JSON.stringify(result), /private provider detail|secret-token/);
  });
  await withFetch(async () => { throw new DOMException('timeout', 'TimeoutError'); }, async () => {
    assert.match((await loaded.readExternalCalendarProvider({ provider: 'google_calendar' }, window, 'owner-member', mirrors())).error, /too long/);
  });
});

test('credential failures give actionable guidance and safe stage diagnostics without fetching events', async () => {
  for (const [code, guidance] of [['INTEGRATION_CREDENTIALS_INVALID', /Reconnect/], ['INTEGRATION_ENCRYPTION_UNAVAILABLE', /Secure calendar setup is unavailable.*Contact TLink support/]]) {
    const warnings = []; let credentialReads = 0; let eventReads = 0;
    const loaded = server({}, { calendarAccessToken: async () => { credentialReads += 1; throw new Error(code); }, warn: (...args) => warnings.push(args) });
    await withFetch(async () => { eventReads += 1; throw new Error('Unexpected event read'); }, async () => {
      const result = await loaded.readExternalCalendarProvider({ provider: 'google_calendar', encrypted_credentials: 'secret-credentials', firebase_uid: 'private-owner' }, window, 'private-member', mirrors());
      assert.equal(result.complete, false); assert.deepEqual(result.events, []); assert.match(result.error, guidance);
      assert.equal(credentialReads, 1); assert.equal(eventReads, 0);
      assert.deepEqual(warnings, [['Calendar read failed', { provider: 'google_calendar', stage: 'credentials', code }]]);
      assert.doesNotMatch(JSON.stringify({ result, warnings }), /secret-credentials|private-owner|private-member/);
    });
  }
});

test('event diagnostics allow only fixed codes or known error names and never expose raw errors', async () => {
  const warnings = []; const loaded = server({}, { warn: (...args) => warnings.push(args) });
  const sensitive = 'private@example.com https://provider.test/private?token=secret-token';
  for (const error of [new TypeError(sensitive), Object.assign(new Error(sensitive), { name: sensitive })]) {
    await withFetch(async () => { throw error; }, async () => {
      const result = await loaded.readExternalCalendarProvider({ provider: 'microsoft_calendar' }, window, 'private-member', mirrors());
      assert.equal(result.complete, false); assert.doesNotMatch(JSON.stringify({ result, warnings }), /private@example|secret-token|private-member/);
    });
  }
  await withFetch(async () => Response.json({ error: { message: sensitive } }, { status: 503 }), async () => {
    await loaded.readExternalCalendarProvider({ provider: 'microsoft_calendar' }, window, 'private-member', mirrors());
  });
  assert.deepEqual(warnings, [
    ['Calendar read failed', { provider: 'microsoft_calendar', stage: 'events', code: 'TypeError' }],
    ['Calendar read failed', { provider: 'microsoft_calendar', stage: 'events', code: 'UNKNOWN_ERROR' }],
    ['Calendar read failed', { provider: 'microsoft_calendar', stage: 'events', code: 'CALENDAR_PROVIDER_HTTP_503' }],
  ]);
});

test('owner-selected business is the only authority for inbound events; team schedule permission does not grant access', async () => {
  let access = { isOwner: false, actorUid: 'staff', ownerUid: 'owner', memberId: 'staff-member', scheduleScope: 'team' }; const calls = [];
  const route = load('../src/app/api/trade-calendar-events/route.ts', { '@/lib/admin-server': { adminJson: (body, status = 200) => Response.json(body, { status }), mfaErrorResponse: () => null, sameOrigin: request => request.headers.get('origin') !== 'https://evil.test' }, '@/lib/trade-team-server': { requireInstallerTeamAccess: async () => access }, '@/lib/trade-calendar-events-server': { loadOwnerCalendarEvents: async (...args) => { calls.push(args); return { events: [], providers: [] }; } } });
  const request = () => new Request('https://example.test/api/trade-calendar-events?ownerUid=victim&rangeStart=2026-10-01&rangeEnd=2026-10-08');
  assert.equal((await route.GET(request())).status, 403); assert.equal(calls.length, 0);
  access = { ...access, isOwner: true }; assert.equal((await route.GET(request())).status, 403); assert.equal(calls.length, 0);
  access = { ...access, actorUid: 'owner', memberId: 'owner-member' };
  assert.equal((await route.GET(request())).status, 200); assert.deepEqual(calls[0], ['owner', 'owner-member', '2026-10-01', '2026-10-08']);
  assert.equal((await route.GET(new Request(request(), { headers: { origin: 'https://evil.test' } }))).status, 403); assert.equal(calls.length, 1);
});

test('read model isolates both connections and mirror references by the verified owner', async () => {
  const queries = [];
  const db = { prepare(sql) { return { bind(...values) { queries.push({ sql, values }); return { first: async () => ({ address_state: 'VIC' }), all: async () => ({ results: [] }) }; } }; } };
  const result = await server(db).loadOwnerCalendarEvents('selected-owner', 'owner-member', '2026-10-01', '2026-10-08');
  assert.deepEqual(result.events, []); assert.deepEqual(result.providers, []); assert.equal(result.timeZone, 'Australia/Melbourne');
  assert.equal(queries.length, 3); for (const query of queries) { assert.match(query.sql, /firebase_uid = \?/); assert.deepEqual(query.values, ['selected-owner']); }
});
