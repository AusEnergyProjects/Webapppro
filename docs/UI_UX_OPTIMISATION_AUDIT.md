# CRM UI, UX and optimisation audit

Audit date: July 16, 2026

## Outcome

The installer CRM now uses a progressively disclosed workday model instead of presenting every system capability at once. My day, Jobs, Schedule and Customers are always visible. Templates, Reports, Integrations and Team remain available under More. Job cards use four primary sections, while Forms, Tasks, Notes and Handover remain one action away.

The benchmark population covers small operators, multi-trade businesses, wholesaler catalogues and household projects without using real personal information. Synthetic records are clearly labelled and can be isolated or excluded from administrator views.

## Evidence reviewed

- Desktop and phone layouts for customer, installer, wholesaler and administrator journeys.
- Account access, signup, dashboards, projects, product catalogues, jobs, schedules, customers, reports, integrations, teams, purchasing and administration.
- Production build output and route classification.
- Automated checks for authentication, role boundaries, owner scoping, customer privacy, prohibited data fields, responsive layout contracts and migration integrity.
- A generated population of 100 premium installers, 50 premium wholesalers, 200 free consumers, 150 products, 200 projects, 800 CRM jobs, 800 appointments and 2,400 tasks.
- Official feature information from Monday CRM, Tradify and ServiceM8.

## Competitor lessons applied

Monday CRM demonstrates the value of a configurable pipeline, activity history, dashboards, duplicate controls and automation. AEA now has a visual pipeline while retaining a practical list for operators who do not think in boards.

Tradify demonstrates the importance of a single flow across enquiries, quoting, scheduling, job tracking, payments, job costing, purchase orders, forms and mobile work. AEA now connects protected opportunities, private installer-owned customers, system-numbered jobs, field records, accounting, payments and wholesaler purchasing.

ServiceM8 demonstrates that the daily job card, schedule and mobile field experience must remain the centre of a trades product. AEA now keeps those daily actions visible while moving lower-frequency configuration out of the main path.

Primary sources:

- [Monday CRM features](https://monday.com/crm/features/)
- [Monday CRM mobile features](https://monday.com/crm/mobile/features)
- [Tradify features](https://www.tradifyhq.com/features)
- [ServiceM8 Australian pricing](https://www.servicem8.com/au/pricing)
- [ServiceM8 product overview](https://www.servicem8.com/au/)

## Findings and completed remediation

| Priority | Finding | Resolution |
| --- | --- | --- |
| Critical | AEA protected household jobs must never expose identity, contact details or street addresses to trades | Protected job cards show a system reference, scope and broad region only. Direct installer-owned customers remain separate. Automated privacy tests cover the API and UI. |
| High | The CRM presented too many destinations at the same level | Reduced the persistent navigation to four primary work areas and grouped advanced tools under More. |
| High | New job and new customer actions competed for attention | Replaced both buttons with one New menu. |
| High | A large team needs a pipeline view, while a small operator needs a simple list | Added List and Board views with a clear stage filter and predictable reset behaviour. |
| High | Job tabs were too dense | Kept Overview, Field work, Schedule and Money visible. Grouped Forms, Tasks, Notes and Handover under More. |
| High | Customer addresses were missing from installer-owned customer records | Added complete address fields to customer creation and editing. Protected platform jobs remain redacted. |
| High | Installer-entered job references could become inconsistent | Job IDs are system generated, chronological and read only. |
| High | Synthetic records could distort operations views | Added durable demo markers and administrator filters for live only, demo only or combined records. |
| Medium | Wholesaler product selection stopped before supply operations | Added purchase orders, fulfilment events and warranty claims without household data. |
| Medium | Web-only field work needs an offline future | The web CRM remains authoritative while versioned sync, device, media and offline action contracts support the planned iOS and Android field apps. |
| Medium | Dense datasets can make broad administrator lists slow or confusing | Admin directories are bounded, searchable and filterable by type, status and demo marker. |

## Optimisation status

- Production build succeeds with route-level client and server bundles.
- Static pages avoid a global client navigation bundle.
- API and authenticated HTML responses use controlled caching and security headers.
- Large benchmark seed data is generated once, applied as a migration and never shipped as client state.
- Job list and pipeline rendering are bounded for visual board columns.
- Images use the existing responsive optimisation path.
- External link audit checked 158 URLs. 153 were reachable or correctly identified as automation-blocked. Five provider endpoints or one retailer site rejected automated probes; these are documented external responses rather than broken internal navigation.

## Remaining product risks

- OAuth providers require production app credentials and release-account approval before live connections can complete.
- The native field app needs real-device testing, internal distribution and measured offline conflict testing.
- Large businesses now have cursor pagination and indexed server-side search. The next risk is governing named, shared and locked team views without adding navigation clutter.
- Moving an established trade business into AEA still requires guided imports, duplicate review and rollback.
- Rate cards remain intentionally parked until trade categories, labour structures and compliance requirements are sufficiently researched.

## Next recommended action

Run a five-business usability pilot covering a solo operator, a small crew, a dispatcher-led team, a multi-trade company and a wholesaler. Use the observed task completion time and errors to shape the guided customer, job and product importer before expanding the CRM navigation again.
