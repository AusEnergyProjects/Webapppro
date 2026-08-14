import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const calendarSource = read("../src/lib/trade-calendar-sync-server.ts");
const scheduleRouteSource = read("../src/app/api/trade-schedule/route.ts");
const dashboardSource = read("../src/components/DirectTradeDashboard.tsx");

function loadTypescriptModule(path, mocks) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function directAppointment(overrides = {}) {
  return {
    id: "appointment-1",
    work_order_id: "job-1",
    appointment_type: "installation",
    starts_at: "2026-08-15T17:00",
    ends_at: "2026-08-15T18:00",
    assignee_label: "Assigned Worker",
    notes: "Bring the ladder and call before arrival.",
    revision: 8,
    work_number: "TLJ-ABC123",
    title: "Energy assessment project",
    service_category: "energy-assessment",
    site_area: "Melbourne",
    source_type: "direct",
    customer_source: "trade_owned",
    customer_name: "Alex Customer",
    customer_email: "alex@example.com",
    customer_phone: "0412 345 678",
    site_contact_name: "Jordan Site Contact",
    site_contact_email: "jordan.site@example.com",
    site_contact_phone: "0491 111 222",
    address_line_1: "12 Example Street",
    address_line_2: "Unit 4",
    suburb: "Melbourne",
    site_state: "VIC",
    postcode: "3000",
    account_state: "VIC",
    access_instructions: "Call from the front gate.",
    parking_instructions: "Use visitor bay 4.",
    hazard_notes: "Dog in rear yard.",
    ...overrides,
  };
}

function connection(provider) {
  return {
    id: `${provider}-connection`,
    firebase_uid: "owner-1",
    provider,
    encrypted_credentials: "encrypted",
    token_expires_at: "2099-01-01T00:00:00.000Z",
  };
}

function calendarEventInsertRow(sql, values) {
  const match = sql.match(/INSERT INTO trade_crm_calendar_events\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/i);
  if (!match) return null;
  const columns = match[1].split(",").map((value) => value.trim());
  const tokens = match[2].split(",").map((value) => value.trim());
  let valueIndex = 0;
  return Object.fromEntries(columns.map((column, index) => {
    const token = tokens[index] || "";
    if (token === "?") return [column, values[valueIndex++]];
    const literal = token.match(/^'(.*)'$/s);
    return [column, literal ? literal[1] : token];
  }));
}

function calendarHarness({ provider = "google_calendar", appointment = directAppointment(), mapping = null } = {}) {
  const statements = [];
  const mappingState = { current: mapping };
  const database = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async all() {
              if (!sql.includes("FROM trade_crm_integrations")) {
                throw new Error(`Unexpected all SQL: ${sql}`);
              }
              return { results: [connection(provider)] };
            },
            async first() {
              if (sql.includes("FROM trade_crm_appointments")) {
                return appointment;
              }
              if (sql.includes("FROM trade_crm_calendar_events")) return mappingState.current;
              throw new Error(`Unexpected first SQL: ${sql}`);
            },
            async run() {
              statements.push({ sql, values });
              const row = calendarEventInsertRow(sql, values);
              if (row) {
                mappingState.current = {
                  ...(mappingState.current || {}),
                  status: row.status,
                  appointment_revision: row.appointment_revision,
                  external_event_id: row.external_event_id
                    || mappingState.current?.external_event_id
                    || "",
                  external_url: row.external_url || mappingState.current?.external_url || "",
                };
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  const calendar = loadTypescriptModule("../src/lib/trade-calendar-sync-server.ts", {
    "../../db": { getD1: () => database },
    "@/lib/trade-integration-crypto": {
      decryptIntegrationCredentials: async () => ({ access_token: "access-token" }),
      encryptIntegrationCredentials: async () => "encrypted-next",
    },
    "@/lib/trade-integrations-server": {
      providerSetting: () => {
        throw new Error("A current access token must not be refreshed in this test.");
      },
    },
  });
  return { calendar, mappingState, statements };
}

test("calendar appointment loading includes every field required by rich provider events", () => {
  for (const required of [
    /(?:w\.id\s+(?:AS\s+)?work_order_id|a\.work_order_id\b)/i,
    /a\.appointment_type/i,
    /a\.notes/i,
    /trade_crm_customers\s+c/i,
    /customer_name/i,
    /customer_email/i,
    /customer_phone/i,
    /trade_crm_site_contacts\s+sc/i,
    /trade_crm_customer_contacts\s+cc/i,
    /access_instructions/i,
    /parking_instructions/i,
    /hazard_notes/i,
  ]) assert.match(calendarSource, required, `calendar appointment query must load ${required}`);
  for (const source of [calendarSource, read("../src/app/api/trade-calendar-sync/route.ts")]) {
    assert.match(source, /s\.customer_id\s*=\s*c\.id\s+AND\s+s\.record_status\s*=\s*'active'/i);
    assert.match(source, /cc\.customer_id\s*=\s*c\.id\s+AND\s+cc\.record_status\s*=\s*'active'/i);
  }
});

test("batch schedule saves explicitly request a provider refresh", () => {
  assert.match(scheduleRouteSource,
    /syncCreatedAppointmentToConnectedCalendars\(access\.ownerUid,\s*appointmentId,\s*\{\s*force:\s*true\s*\}\)/,
    "a saved move or duration change must not accept a matching local mapping as proof the provider is current");
});

test("calendar job links open the exact authorised TLink job schedule", () => {
  assert.match(calendarSource, /jobId=\$\{encodeURIComponent\(eventText\(appointment\.work_order_id, 180\)\)\}/);
  assert.match(dashboardSource, /function jobNavigationFromSearch\(search: string\)/);
  assert.match(dashboardSource, /kind: "job", id: jobId, query: "", jobTab: "schedule"/);
  assert.match(dashboardSource,
    /const initialJobTarget = dashboardCommandTargetFromSearch\(window\.location\.search\);[\s\S]{0,260}!commandTarget[\s\S]{0,160}initialJobTarget\?\.kind === "job"[\s\S]{0,160}setCommandTarget\(initialJobTarget\);[\s\S]{0,80}return;/,
    "hydration must consume the incoming jobId before route synchronisation can remove it");
});

async function withProviderFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), init, payload: JSON.parse(String(init.body || "{}")) };
    requests.push(request);
    return handler(request);
  };
  try {
    return await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function providerEventText(provider, payload) {
  if (provider === "google_calendar") {
    return [payload.summary, payload.description, payload.location].filter(Boolean).join("\n");
  }
  return [payload.subject, payload.body?.content, payload.location?.displayName].filter(Boolean).join("\n");
}

function successfulProviderResponse(provider, request, id) {
  return Response.json({
    id,
    ...(provider === "google_calendar"
      ? { htmlLink: `https://calendar.google.test/${id}` }
      : { webLink: `https://outlook.test/${id}` }),
    start: request.payload.start,
    end: request.payload.end,
  });
}

for (const provider of ["google_calendar", "microsoft_calendar"]) {
  test(`${provider} receives complete authorised direct-customer job details`, async () => {
    const { calendar } = calendarHarness({ provider });
    await withProviderFetch(
      (request) => successfulProviderResponse(provider, request, `${provider}-event-1`),
      async (requests) => {
        const result = await calendar.syncCreatedAppointmentToConnectedCalendars(
          "owner-1",
          "appointment-1",
          { force: true },
        );
        assert.equal(result.connected, 1);
        assert.equal(result.synced, 1);
        assert.equal(result.failed, 0);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].init.method, "POST");

        const payload = requests[0].payload;
        const text = providerEventText(provider, payload);
        for (const detail of [
          "Alex Customer",
          "0412 345 678",
          "alex@example.com",
          "Jordan Site Contact",
          "jordan.site@example.com",
          "0491 111 222",
          "12 Example Street",
          "Unit 4",
          "Melbourne",
          "VIC",
          "3000",
          "Assigned Worker",
          "TLJ-ABC123",
          "Bring the ladder and call before arrival.",
          "Call from the front gate.",
          "Use visitor bay 4.",
          "Dog in rear yard.",
        ]) assert.match(text, new RegExp(detail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
        assert.match(text, /installation/i);
        assert.match(text, /https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/i);
        assert.match(text, /https:\/\/compare\.ausenergyassessments\.com\/direct-trade\/dashboard\?workspace=work/i);
        assert.match(text, /jobId=job-1/i);

        const location = provider === "google_calendar" ? payload.location : payload.location?.displayName;
        assert.match(location, /12 Example Street, Unit 4, Melbourne, VIC, 3000/i);
      },
    );
  });
}

for (const provider of ["google_calendar", "microsoft_calendar"]) {
  test(`${provider} protected jobs never leak customer identity, contact, exact address or appointment notes`, async () => {
    const protectedAppointment = directAppointment({
      work_order_id: "protected-job-1",
      work_number: "TLJ-PROTECTED",
      source_type: "opportunity",
      customer_source: "platform_private",
      service_category: "Energy assessment",
      site_area: "Melbourne CBD",
      customer_name: "Secret Customer",
      customer_email: "secret@example.com",
      customer_phone: "0499 999 999",
      site_contact_name: "Secret Site Contact",
      site_contact_email: "secret.site@example.com",
      site_contact_phone: "0498 888 888",
      address_line_1: "99 Secret Street",
      address_line_2: "Apartment 7",
      notes: "Gate code 1234",
      access_instructions: "Use secret side gate",
      parking_instructions: "Private garage code 4444",
      hazard_notes: "Private hazard note",
    });
    const { calendar } = calendarHarness({
      provider,
      appointment: protectedAppointment,
      mapping: {
        status: "synced",
        appointment_revision: 7,
        external_event_id: "previously-rich-event",
        external_url: "https://calendar.test/previously-rich-event",
      },
    });
    await withProviderFetch(
      (request) => successfulProviderResponse(provider, request, "protected-event"),
      async (requests) => {
        const result = await calendar.syncCreatedAppointmentToConnectedCalendars(
          "owner-1",
          "appointment-1",
          { force: true },
        );
        assert.equal(result.synced, 1);
        assert.equal(result.failed, 0);
        assert.equal(requests[0].init.method, "PATCH");
        const payload = requests[0].payload;
        const serialized = JSON.stringify(payload);
        assert.match(serialized, /TLJ-PROTECTED/);
        assert.match(serialized, /protected/i);
        assert.match(serialized, /Energy assessment/i);
        for (const secret of [
          "Secret Customer",
          "secret@example.com",
          "0499 999 999",
          "Secret Site Contact",
          "secret.site@example.com",
          "0498 888 888",
          "99 Secret Street",
          "Apartment 7",
          "Gate code 1234",
          "Use secret side gate",
          "Private garage code 4444",
          "Private hazard note",
        ]) assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
        if (provider === "google_calendar") assert.equal(payload.location, "");
        else {
          assert.deepEqual(payload.location, { displayName: "" });
          assert.deepEqual(payload.locations, []);
        }
        assert.doesNotMatch(serialized, /google\.com\/maps\/dir/i);
      },
    );
  });
}

test("a saved duration change force-PATCHes a current mapping with the new time and details", async () => {
  const appointment = directAppointment({
    starts_at: "2026-08-15T17:15",
    ends_at: "2026-08-15T17:45",
    notes: "Updated access instructions",
    revision: 8,
  });
  const mapping = {
    status: "synced",
    appointment_revision: 8,
    external_event_id: "google-event-current",
  };
  const { calendar, statements } = calendarHarness({ appointment, mapping });
  await withProviderFetch(
    (request) => successfulProviderResponse("google_calendar", request, "google-event-current"),
    async (requests) => {
      const result = await calendar.syncCreatedAppointmentToConnectedCalendars(
        "owner-1",
        "appointment-1",
        { force: true },
      );
      assert.equal(result.connected, 1);
      assert.equal(result.synced, 1);
      assert.equal(result.failed, 0);
      assert.equal(requests.length, 1, "force must not trust a matching local mapping revision");
      assert.equal(requests[0].init.method, "PATCH");
      assert.match(requests[0].url, /google-event-current$/);
      assert.match(requests[0].payload.start.dateTime, /^2026-08-15T17:15(?::00)?$/);
      assert.match(requests[0].payload.end.dateTime, /^2026-08-15T17:45(?::00)?$/);
      assert.match(requests[0].payload.description, /Updated access instructions/);
      assert.ok(statements.some((item) => item.sql.includes("INSERT INTO trade_crm_calendar_events")),
        "provider-confirmed update must refresh the local calendar mapping");
    },
  );
});

test("Microsoft requests ask Graph to return the payload start timezone", async () => {
  const appointment = directAppointment({
    starts_at: "2026-08-15T17:00",
    ends_at: "2026-08-15T18:00",
    site_state: "VIC",
    account_state: "VIC",
  });
  const { calendar } = calendarHarness({ provider: "microsoft_calendar", appointment });
  await withProviderFetch(
    (request) => successfulProviderResponse(
      "microsoft_calendar",
      request,
      "microsoft-event-preferred-zone",
    ),
    async (requests) => {
      const result = await calendar.syncCreatedAppointmentToConnectedCalendars(
        "owner-1",
        "appointment-1",
        { force: true },
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0].init.method, "POST");
      assert.equal(requests[0].payload.start.timeZone, "AUS Eastern Standard Time");
      assert.equal(new Headers(requests[0].init.headers).get("Prefer"),
        'outlook.timezone="AUS Eastern Standard Time"');
      assert.equal(result.created, 1);
      assert.equal(result.synced, 1);
      assert.equal(result.failed, 0);
    },
  );
});

test("Microsoft timing verification accepts Graph UTC/default responses equivalent to the requested local time", async () => {
  const appointment = directAppointment({
    starts_at: "2026-08-15T17:00",
    ends_at: "2026-08-15T18:00",
    site_state: "VIC",
    account_state: "VIC",
  });
  const { calendar } = calendarHarness({ provider: "microsoft_calendar", appointment });
  await withProviderFetch(
    () => Response.json({
      id: "microsoft-event-utc",
      webLink: "https://outlook.test/microsoft-event-utc",
      start: { dateTime: "2026-08-15T07:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-15T08:00:00.0000000", timeZone: "UTC" },
    }),
    async (requests) => {
      const result = await calendar.syncCreatedAppointmentToConnectedCalendars(
        "owner-1",
        "appointment-1",
        { force: true },
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0].init.method, "POST");
      assert.equal(result.created, 1);
      assert.equal(result.synced, 1);
      assert.equal(result.failed, 0);
    },
  );
});

test("a create response with unverified timing preserves its event ID so retry PATCHes instead of duplicating", async () => {
  const appointment = directAppointment({
    starts_at: "2026-08-15T17:15",
    ends_at: "2026-08-15T17:45",
    revision: 8,
  });
  const { calendar, mappingState } = calendarHarness({ appointment });
  let providerCall = 0;
  await withProviderFetch(
    (request) => {
      providerCall += 1;
      if (providerCall === 1) {
        return Response.json({
          id: "google-created-with-stale-time",
          htmlLink: "https://calendar.google.test/google-created-with-stale-time",
          start: { dateTime: "2026-08-15T18:00:00", timeZone: "Australia/Melbourne" },
          end: { dateTime: "2026-08-15T19:00:00", timeZone: "Australia/Melbourne" },
        });
      }
      return successfulProviderResponse(
        "google_calendar",
        request,
        "google-created-with-stale-time",
      );
    },
    async (requests) => {
      const first = await calendar.syncCreatedAppointmentToConnectedCalendars(
        "owner-1",
        "appointment-1",
        { force: true },
      );
      assert.equal(first.synced, 0);
      assert.equal(first.failed, 1);
      assert.equal(mappingState.current?.status, "error");
      assert.equal(mappingState.current?.external_event_id, "google-created-with-stale-time",
        "the provider-created event ID must survive failed timing verification");

      const retry = await calendar.syncCreatedAppointmentToConnectedCalendars(
        "owner-1",
        "appointment-1",
        { force: true },
      );
      assert.equal(retry.updated, 1);
      assert.equal(retry.synced, 1);
      assert.equal(retry.failed, 0);
      assert.deepEqual(requests.map((request) => request.init.method), ["POST", "PATCH"]);
      assert.match(requests[1].url, /google-created-with-stale-time$/);
    },
  );
});

test("Google unmapped creates use a deterministic valid event ID and recover 409 with PATCH", async () => {
  const appointment = directAppointment({ id: "appointment-idempotent" });
  const { calendar, mappingState } = calendarHarness({ appointment });
  let providerCall = 0;
  let generatedId = "";
  await withProviderFetch(
    (request) => {
      providerCall += 1;
      if (providerCall === 1) {
        generatedId = String(request.payload.id || "");
        return Response.json({ error: { code: 409, message: "The identifier already exists." } }, { status: 409 });
      }
      return successfulProviderResponse("google_calendar", request, generatedId);
    },
    async (requests) => {
      const result = await calendar.syncCreatedAppointmentToConnectedCalendars(
        "owner-1",
        "appointment-idempotent",
        { force: true },
      );
      assert.match(generatedId, /^[a-v0-9]{5,1024}$/,
        "Google event IDs must satisfy the provider base32hex identifier contract");
      assert.deepEqual(requests.map((request) => request.init.method), ["POST", "PATCH"]);
      assert.equal(requests.length, 2, "a 409 retry must not issue another create request");
      assert.match(requests[1].url, new RegExp(`/${generatedId}$`));
      assert.equal(result.created, 0);
      assert.equal(result.updated, 1);
      assert.equal(result.synced, 1);
      assert.equal(result.failed, 0);
      assert.equal(mappingState.current?.external_event_id, generatedId);
    },
  );

  async function captureGeneratedId(appointmentId) {
    const nextAppointment = directAppointment({ id: appointmentId });
    const { calendar: nextCalendar } = calendarHarness({ appointment: nextAppointment });
    let captured = "";
    await withProviderFetch(
      (request) => {
        captured = String(request.payload.id || "");
        return successfulProviderResponse("google_calendar", request, captured || "missing-id");
      },
      async () => {
        const result = await nextCalendar.syncCreatedAppointmentToConnectedCalendars(
          "owner-1",
          appointmentId,
          { force: true },
        );
        assert.equal(result.synced, 1);
        assert.equal(result.failed, 0);
      },
    );
    return captured;
  }

  assert.equal(await captureGeneratedId("appointment-idempotent"), generatedId,
    "the same TLink appointment must always produce the same Google event ID");
  assert.notEqual(await captureGeneratedId("appointment-other"), generatedId,
    "different TLink appointments must not share a Google event ID");
});

test("Google 409 on an existing mapped event fails that mapping without deterministic-ID diversion", async () => {
  const mappedEventId = "a1b2c3d4e5f6";
  const appointment = directAppointment({ revision: 8 });
  const mapping = {
    status: "synced",
    appointment_revision: 8,
    external_event_id: mappedEventId,
  };
  const { calendar, mappingState } = calendarHarness({ appointment, mapping });
  await withProviderFetch(
    () => Response.json({ error: { code: 409, message: "Conflict updating mapped event." } }, { status: 409 }),
    async (requests) => {
      const result = await calendar.syncCreatedAppointmentToConnectedCalendars(
        "owner-1",
        "appointment-1",
        { force: true },
      );
      assert.equal(requests.length, 1,
        "a mapped PATCH conflict must not trigger a second PATCH to the deterministic create ID");
      assert.equal(requests[0].init.method, "PATCH");
      assert.match(requests[0].url, new RegExp(`/${mappedEventId}$`));
      assert.doesNotMatch(requests[0].url, /\/tlink[a-v0-9]+$/);
      assert.equal(result.created, 0);
      assert.equal(result.updated, 0);
      assert.equal(result.synced, 0);
      assert.equal(result.failed, 1);
      assert.equal(mappingState.current?.status, "error");
      assert.equal(mappingState.current?.external_event_id, mappedEventId);
    },
  );
});

test("a provider 200 response with stale timing is failed instead of marked synced", async () => {
  const appointment = directAppointment({
    starts_at: "2026-08-15T17:15",
    ends_at: "2026-08-15T17:45",
    revision: 8,
  });
  const mapping = {
    status: "synced",
    appointment_revision: 8,
    external_event_id: "google-event-current",
  };
  const { calendar, statements } = calendarHarness({ appointment, mapping });
  await withProviderFetch(
    () => Response.json({
      id: "google-event-current",
      htmlLink: "https://calendar.google.test/current",
      start: { dateTime: "2026-08-15T18:00:00", timeZone: "Australia/Melbourne" },
      end: { dateTime: "2026-08-15T19:00:00", timeZone: "Australia/Melbourne" },
    }),
    async () => {
      const result = await calendar.syncCreatedAppointmentToConnectedCalendars(
        "owner-1",
        "appointment-1",
        { force: true },
      );
      assert.equal(result.connected, 1);
      assert.equal(result.synced, 0);
      assert.equal(result.failed, 1);
      assert.ok(statements.some((item) => item.sql.includes("trade_crm_calendar_events")
        && item.sql.includes("'error'")),
      "stale provider timing must be retained as a retryable mapping error");
    },
  );
});

test("same wall-clock text with the wrong provider offset fails timing verification", async () => {
  const appointment = directAppointment({
    starts_at: "2026-08-15T17:00",
    ends_at: "2026-08-15T18:00",
    site_state: "VIC",
    account_state: "VIC",
    revision: 8,
  });
  const { calendar, mappingState } = calendarHarness({ appointment });
  await withProviderFetch(
    () => Response.json({
      id: "google-event-wrong-offset",
      htmlLink: "https://calendar.google.test/google-event-wrong-offset",
      start: { dateTime: "2026-08-15T17:00:00+00:00", timeZone: "UTC" },
      end: { dateTime: "2026-08-15T18:00:00+00:00", timeZone: "UTC" },
    }),
    async (requests) => {
      const result = await calendar.syncCreatedAppointmentToConnectedCalendars(
        "owner-1",
        "appointment-1",
        { force: true },
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0].payload.start.dateTime, "2026-08-15T17:00:00");
      assert.equal(requests[0].payload.start.timeZone, "Australia/Melbourne");
      assert.equal(result.created, 0);
      assert.equal(result.updated, 0);
      assert.equal(result.synced, 0);
      assert.equal(result.failed, 1);
      assert.equal(mappingState.current?.status, "error");
      assert.equal(mappingState.current?.external_event_id, "google-event-wrong-offset");
    },
  );
});

test("a forced provider rejection is reported as failed instead of a false synced success", async () => {
  const mapping = {
    status: "synced",
    appointment_revision: 8,
    external_event_id: "google-event-current",
  };
  const { calendar, statements } = calendarHarness({ mapping });
  await withProviderFetch(
    () => Response.json({ error: { message: "provider unavailable" } }, { status: 503 }),
    async (requests) => {
      const result = await calendar.syncCreatedAppointmentToConnectedCalendars(
        "owner-1",
        "appointment-1",
        { force: true },
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0].init.method, "PATCH");
      assert.equal(result.connected, 1);
      assert.equal(result.synced, 0);
      assert.equal(result.failed, 1);
      assert.ok(statements.some((item) => item.sql.includes("trade_crm_calendar_events")
        && item.values.includes("CALENDAR_PROVIDER_FAILED")),
      "the failed mapping must retain the provider error for retry and UI status");
    },
  );
});
