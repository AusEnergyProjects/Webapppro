# Simpro Lightning and TLink: product audit and implementation priorities

Reviewed 1 October 2026. TLink source baseline: `5e63cf0e467492990cf2cc97008935d59695a9e7`, deployed as Sites 719. This is a dated product and source audit, not the canonical release-status document. Public Simpro claims were researched separately from TLink implementation. No paid Simpro tenant was tested.

## Recommendation

TLink should win on an easy, complete job journey: a customer asks for work, the business quotes and books it, the right person completes the required evidence, the customer receives the result, and the business gets paid. Customers, compliance, sole traders and larger companies must all use the same records. The default interface should expose only what the current person needs next.

The first investment should be making that existing journey coherent. Extend Wattzun into signed-in TLink as the business assistant, alongside a single customer job link, a practical action queue and guided compliance closeout. A generic chatbot or a larger menu would not create a durable advantage.

TLink already has substantial operational capability. It does not yet have verified evidence for replacing every external subscription or acting as a full enterprise ERP. Preserve the goal of one operational platform while measuring and closing those gaps.

## What Simpro actually offers

Lightning launched on 13 May 2026 as an AI layer across the Simpro group's existing products. It is broader than a CRM. The published launch terms described a 15% contract uplift until 31 May, followed by 25%, and an annual increase cap of CPI + 3%. These are historical published launch terms, not a current Australian quote. [Launch announcement](https://www.simprogroup.com/company/press/simpro-group-unveils-lightning).

| Offering | Published purpose | Evidence boundary |
| --- | --- | --- |
| Cooper / JustAsk | Ask questions about business records, margins, overdue invoices and customer history | Public product description; not tested in a customer account |
| JobReady | Prepare a job briefing using history, skills and materials | Advertised available agent |
| JobScribe | Capture and transcribe work documentation | Advertised available agent |
| JobBrief | Draft customer summaries and next steps | Advertised available agent |
| FieldReady | Guide workers through procedures and system use | Advertised available agent |
| Two-way messaging and GPS time tracking | Customer communication and arrival/departure prompts | Platform features; do not describe every feature as generative AI |

The [Lightning page](https://www.simprogroup.com/lightning) explicitly labels its headline improvement figures as industry benchmarks, not measured Lightning customer results. TLink should avoid adopting those percentages as evidence of its own potential savings.

RAIN is a subsequent release programme. It promotes native sales pipeline/CRM, subcontractor work orders and financials, mobile stock, guided forms, a rebuilt field app and a document hub. It also describes quote acceptance, invoicing, payments and scheduling improvements. The catalogue warns that delivery timing can change. [RAIN catalogue](https://www.simprogroup.com/rain).

Keep product families separate: the July group announcement attributes AI photo validation to BigChange and photo-assisted hazard forms to AroFlo. Those are not evidence that Simpro itself ships the same tools. RAIN improvements are described as included for Lightning customers. [7 July announcement](https://www.simprogroup.com/company/press/simpro-group-announces-rain).

### Price, availability and switching friction

The checked pricing page does not give a fixed Australian base subscription. Price depends on office/field users and additions; an initial implementation fee covers onboarding, training and migration. Digital Forms, SMS, maintenance planning, takeoffs and fleet tracking are among separately listed additions. The sales route is a guided demo. [Pricing](https://www.simprogroup.com/pricing).

However, the current add-ons page says new digital workers come with the Lightning upgrade. It would be inaccurate to say every AI worker requires another subscription. [Add-ons](https://www.simprogroup.com/features/add-ons).

Availability is not uniform evidence: an August article describes scheduler recommendations beginning rollout and broader assignment later, while the current RAIN page labels scheduling delivered. The guide updated 30 September still advises checking region, package and release status. Validate a specific account before describing universal autonomous scheduling. [August feature discussion](https://www.simprogroup.com/blog/ai-features-field-service-software), [current field-service AI guide](https://www.simprogroup.com/blog/ai-for-field-service).

Simpro's AI pledge says it will not share customer information with third parties for model training without express permission. This is a vendor commitment, not a technical audit of every data flow. [AI pledge](https://www.simprogroup.com/company/ai-pledge).

### Strengths TLink must take seriously

Simpro already markets a customer portal covering quotes, jobs, invoices, assets, requests, payments and history. Merely having customer access is not unique. Its multi-company product describes controlled sharing, company-specific records and branding, shared resources and combined reporting. [Customer portal](https://www.simprogroup.com/features/crm-for-field-service), [multi-company](https://www.simprogroup.com/features/multi-company).

Delight targets customer reactivation and quote follow-up. Fast Cash targets receivables follow-up and prioritised human worklists. These focus on revenue and cash collection, areas where TLink should measure completed outcomes instead of counting AI features. [Delight](https://www.simprogroup.com/features/delight), [Fast Cash](https://www.simprogroup.com/features/fast-cash).

## TLink audit against the four pillars

| Pillar | Verified source foundation | What remains to establish |
| --- | --- | --- |
| Customers | No-account planner, secure quote review and rental-report links, private CRM records and consent-based contact disclosure | One secure job link combining status, questions, appointments, documents and payment. Old customer account and rescheduling APIs return 410; do not market them as current capability |
| Compliance | Versioned forms, evidence and signatures, completion locks, organisation approval, person/activity training checks and readiness blockers | Approved coverage per activity, operational provider/registry delivery and representative end-to-end assurance. AI must not approve eligibility or fabricate evidence |
| Sole traders | Quotes, invoices, scheduling, customers, stock, forms, files, reporting and communications; repository policy preserves free core access | Faster onboarding and import, fewer duplicate surfaces, a clear next action, and measured time saved |
| Larger companies | Business membership switching, per-action permissions, own/team schedules, operational reports, receivables and direct job margins | Dedicated branch/division hierarchy, cost centres, group reporting and representative scale validation. No payroll/general-ledger implementation was found in the inspected scope |

Source anchors: [customer retirement](../../src/lib/customer-account-retirement.mjs), [planner](../../src/app/plan/page.tsx), [quote review](../../src/app/quote-review/[token]/page.tsx), [rental reports](../../src/app/rental-report/[token]/page.tsx), [team permissions](../../src/lib/trade-team-server.ts), [business membership](../../src/lib/trade-business-context-server.ts), [reporting](../../src/lib/trade-business-reports.ts).

### Confirmed old-build clutter

- `InstallerCrmWorkspace` separated Field work/Assessment, Files and More > Forms. It also rendered compliance activity records in both Overview and Field work.
- `TradeJobFilesPanel` collected activity evidence, signatures, PDFs, work packs, rental reports, handover, commercial documents and saved message attachments. Generic supporting/custom forms remained in `TradeJobFormsPanel`, outside that Files surface.
- The four screenshot panels were real additional customer sections: main-site instructions, additional contacts, additional service sites, and assets/history. Their records remain stored; their default customer-screen editors are removed by this cleanup. Existing job-to-site links remain. A future enterprise contacts/sites management surface needs explicit design before promising that capability to large customers.
- The native Messages tab and the web communication navigation cover calls as well as messaging, so Connect is a more accurate name. Internal route identifiers can remain `messages` without exposing that implementation detail to users.
- Some account-project wording refers to retired customer journeys. It needs contextual review because historical records and consent boundaries still matter; indiscriminate deletion would be unsafe.

Source anchors: [CRM workspace](../../src/components/InstallerCrmWorkspace.tsx), [Files](../../src/components/TradeJobFilesPanel.tsx), [supporting forms](../../src/components/TradeJobFormsPanel.tsx), [native tabs](../../mobile/src/app/(tabs)/_layout.tsx).

### AI and integration boundaries

The command centre is scoped search and navigation, not an evidenced general CRM AI operator. Supplier receipt extraction already demonstrates a useful pattern: untrusted-document handling, explicit unknowns, structured output and human review before stock changes. Reuse that pattern for job summaries and drafts. [Command centre](../../src/components/TLinkCommandCentre.tsx), [receipt extraction](../../src/lib/trade-stock-receipt-ai.ts), [receipt review](../../src/components/TradeStockReceiptUpload.tsx).

Accounting, SMS and calendar integration code exists. This audit did not verify connected-provider end-to-end operation. Current Xero export sets invoice status `AUTHORISED`; older notes describing all exports as drafts are outdated. Calendar integrations are one-way. Provider configuration and successful delivery remain separate facts. [Accounting export](../../src/lib/trade-accounting-export.ts), [integration configuration](../../src/lib/trade-integrations-server.ts).

The native app includes persisted queues, encrypted local data, resumable uploads and conflict handling. Source inspection does not prove physical-device reliability or distribution. Sites publication updates the web system; native installation/update-channel delivery must be checked separately.

## Implementation sequence

### Wattzun inside signed-in TLink

Use the existing Wattzun identity rather than introduce another branded assistant. Its business mode should work with the selected business, current staff permissions and current job. Public household guidance and private business assistance need explicit context boundaries; signing in alone must not grant an AI model unrestricted database access.

The target capabilities are job briefings, typed or dictated work summaries, quote/invoice drafts, customer-reply drafts, evidence-gap explanations, business questions and scheduling suggestions. Reuse the existing deterministic APIs and calculations through narrow authorised actions. Retrieve only the records needed for the question, include source links and timestamps, and say when data is missing.

Start with **Prepare this job**: assemble the customer/job history the worker is entitled to see, show missing required evidence, and prepare useful drafts. Staff review any message, booking, charge or important record change. Governed compliance rules and authorised reviewers remain the approval authority. AI output is not evidence that work occurred or a certificate was approved.

This can address the same classes of work Lightning advertises and exploit TLink's customer/compliance context. Feature parity, better outcomes and lower cost still require implementation and measurement; they are not established by the existing public Wattzun assistant.

These are proposed priorities, not a claim that new AI or enterprise features were implemented in this cleanup.

| Order | Small complete product slice | Acceptance evidence |
| --- | --- | --- |
| Now | Remove the screenshot clutter; one Files home for forms/photos/documents; Connect phone navigation | Existing records remain accessible, form drafts survive disclosure changes, uploads refresh the list, permissions remain enforced |
| 1 | One Needs attention queue using existing job/quote/invoice/compliance states | Every item explains the blocker, names its owner and opens the exact next action; no duplicate status source |
| 2 | One secure customer job link | Customers can review, respond and supply required information without an account; only authorised customer-visible material is disclosed |
| 3 | Guided closeout | Required evidence, assigned reviewer and completion readiness are visible; incomplete evidence blocks only the appropriate next step |
| 4 | Record-grounded job summary and customer-message drafts | Referenced source records and unknowns are visible; user reviews before sending, booking, charging or making a compliance decision |
| 5 | Guided onboarding and import | Test an initial target of first customer/job within ten minutes; preview, deduplication, useful errors and preserved source history |
| 6 | Permission-scoped Ask Wattzun and scheduling suggestions | Defined calculations, source links, business/role boundaries, skills/training/conflict checks and an explainable suggestion |
| 7 | Enterprise organisation structure | Branch/entity boundaries, approval thresholds, shared resources, group reports and representative multi-team load tested independently |

A sole trader should see today's work and the next useful action. A larger organisation should reveal additional controls when needed. This does not mean deleting the enterprise data model or asking a sole trader to configure departments before creating a job.

## Affordable delivery

Keep core TLink trade software free under the current repository policy. Do not introduce seat, lead, job or quote access gates through this work. Include customer participation, core forms, files and normal operational reporting as platform capabilities.

Use deterministic rules for permissions, readiness, totals and reminders. Use AI for interpretation and drafts where it demonstrably saves effort. Generate summaries when relevant inputs change and reuse approved output. Ordinary work should continue if an AI allowance is exhausted.

SMS, voice relay, storage, payment processing and AI have variable provider costs. A single platform can absorb or transparently bundle those costs, but unlimited zero-cost usage is not an evidenced promise. Measure provider cost per completed job and active business, together with support time, before setting allowances or pricing. Do not promise replacement of tax lodgement, payroll, banking or statutory accounting before those functions exist and are validated.

Measure time to first job, duplicate entry per job, time to complete documentation, evidence correction rate, completion-to-invoice time, retained active businesses and monthly cost by business size. These are proposed measures; this audit did not collect a production benchmark.

## Scope and limits

The audit used current source, relevant contracts/tests, public official Simpro material and the supplied screenshots. It was a focused product and architecture review, not a full penetration test, regulatory coverage certification, performance benchmark or paid competitor trial. No customer messages, calls, charges or certificate submissions were performed. The accompanying implementation is the requested interface cleanup only; the roadmap above remains proposed.

## Cleanup release evidence

- Web application source: `5496340ae9cc5144f5f6d0a5b2c46f76c342443c`, branch `codex/tlink-simplify-connect`. GitHub and the Sites source branch were verified against that exact SHA. Sites version 720 deployment `appgdep_6abe58dbcad0819193421c4996f9a069` succeeded with environment revision 207.
- Native compatibility patch: `178686d26fcc6cd407e8fd37022714c7633fc39a`, branch `codex/tlink-connect-native-133`, based on the existing 1.3.3 binary source. Only native Connect wording/icon and adjacent documentation changed there.
- Expo iOS 1.3.4 production update: group `e4c93175-733e-4ff0-aa8f-111ff5b25694`, source `5496340`.
- Expo Android 1.3.3 preview update: group `1b124faf-38d6-498f-9c4b-d6f9c339f5a0`, source `178686d`.
- Expo iOS 1.3.3 production update: group `641eb00d-23d5-4cb8-805f-0e6cbef51540`, source `178686d`. The first export crashed; the subsequent bounded retry completed and published successfully.
- Focused web regression command used `node --experimental-strip-types --test` across the CRM, customer, Files/navigation, forms, field-completion and message-files tests: 150 passed, none failed/skipped. This includes nine new executed TSX/event-handler regressions for Files navigation, collapsed-form retention, permissions and file-list refresh.
- Native communication tests: 49 passed on 1.3.4; the same relevant set had 48 tests on the older 1.3.3 baseline and all passed. Web and both native typechecks passed. Scoped ESLint and `git diff --check` passed.
- `npm.cmd run export:verify` produced Android and iOS bundles. `npm.cmd run package:sites -- C:/Webproject/_site-artifacts/tlink-simplify-connect-20261001.tar` passed the production build, Worker bundle audit, 230-migration archive check and public performance budgets. No migrations were added or changed.
- Removed obsolete customer panel handlers, client contact state/types and unused CSS. No customer records, files, consent rules or backend APIs were deleted. Full repository validation and physical-device call/update acceptance were not performed.

This report's subsequent Wattzun recommendation and release-evidence edits are documentation only. They do not change the application source identity above.
