# TLink and Australian Energy Assessments release truth

Status: current repository snapshot

Truth owners: product owner and technical lead

Last reconciled locally: 2 September 2026

Deployment evidence last verified: 2 September 2026

This is the only current implementation and release-status document. The [dated complete audit](./audit/2026-07-21-complete-current-state/README.md) is the immutable evidence baseline. [ROADMAP.md](../ROADMAP.md) owns forward sequence. [HANDOVER_NEXT_TASK.md](./HANDOVER_NEXT_TASK.md) owns one executable milestone.

## Current public production release: apex launch and quiet cookieless analytics

Australian Energy Assessments is live at `https://ausenergyassessments.com`. The apex hostname is the canonical public origin. Public GET and HEAD requests to the previous `https://compare.ausenergyassessments.com` hostname return a permanent 308 redirect to the same path and query on the apex; `/api` routes are deliberately excluded. Durable no longer serves the apex or `www` and is retained only as the emergency rollback target for the initial 48-hour monitoring window.

Application source `e558e7b94625afddf536ab96bd5d9a1bf77909f9` on branch `codex/surge-durability-release` is the exact source deployed publicly as OpenAI Sites version 497. This release incorporates the public content migration, reviewed replacement guides, expanded accordion FAQ, official resource library, assessment and booking improvements, homepage booking path, consumer-language revisions, electricity-plan resilience, apex canonicalisation, robots and sitemap changes, structured data, social linking and the version 497 privacy correction.

Version 497 removes the fixed analytics-consent popup and its floating privacy-choice button. Public pages use basic cookieless Google Analytics measurement with analytics and advertising storage denied. Do Not Track, Global Privacy Control, a stored opt-out, private routes, print routes and PDF routes disable measurement. The privacy page contains the persistent inline control. Wattzun conversations, form answers, contact details and uploaded files are not sent to Google Analytics by this implementation.

| Release evidence | Exact identity |
| --- | --- |
| Application source | `e558e7b94625afddf536ab96bd5d9a1bf77909f9` |
| Git branch | `codex/surge-durability-release` |
| Sites project | `appgprj_6a550c378000819185caf094173422bb` |
| Saved version | `appgprj_6a550c378000819185caf094173422bb~appgver_cc1874a68a9c8191bb75f1496cabe735` |
| Public version | Sites version 497 |
| Deployment | `appgdep_6a981712ea788191a968ab219f4f0dc7`, status `succeeded` |
| Provider deployment | `https://aea-energy-comparison.info294029.chatgpt.site` |
| Hosted environment | Revision 34 |
| Stored archive | 50,370,560 bytes, 551 files, `sha256:2499cdb2b5a1cd3201c879a7b64c842d8d8b3b51806dcfb55091c0228197ad3f` |
| Canonical public domain | `https://ausenergyassessments.com` |
| Legacy public hostname | `https://compare.ausenergyassessments.com`, permanent redirect for public non-API routes |
| Google Analytics stream | `G-3PGGJ0JX4H` |

### Validation and live evidence

- The focused privacy-page tests passed 4 of 4. Typecheck, warning-free lint, all 164 migrations, the customer-plan PDF audit, production build, Sites server-bundle audit and public performance budgets passed.
- The complete `npm.cmd run validate` sequence reached the repository suite and reported 3,756 passed, 11 intentionally skipped and one unrelated Creditex operations-control failure at `test/creditex-operations-control.test.mjs:1169` with `COMPLIANCE_ACCESS_REQUIRED`. The same test failed alone; no analytics or public-page file is in that failure path.
- Sites reports version 497 as the latest saved version with exact source `e558e7b94625afddf536ab96bd5d9a1bf77909f9`; deployment `appgdep_6a981712ea788191a968ab219f4f0dc7` reports `succeeded` at environment revision 34.
- Fresh live checks on 2 September 2026 returned HTTP 200 for the apex home page, privacy page, sitemap and health endpoint. The former comparison hostname returned HTTP 308 for a representative public page while its `/api/health` route remained available with HTTP 200 as designed.
- The GitHub release branch resolved to exact application source `e558e7b94625afddf536ab96bd5d9a1bf77909f9` after publication.

### Current boundaries and follow-up

- The public Australian Energy Assessments website is live. Historical statements below that call the public website or comparison hostname pre-launch are retained only as release history and are not current status.
- Protected TLink, mobile-preview and Creditex operational records remain separately governed. This public-site launch does not convert their test records into production customer data. Any final test-data wipe remains a separately authorised operation.
- The live health response currently exposes `X-Release-Id: e425d5ab9f9ef21305e1ea27ea7929e16b783752`, the version 496 source, while Sites proves version 497 is sourced from `e558e7b94625afddf536ab96bd5d9a1bf77909f9`. The hosted `AEA_RELEASE_SHA` value must be corrected and version 497 redeployed before the header is used as exact runtime provenance.
- Google Analytics property-level Enhanced Measurement settings remain unverified. Confirm the property attached to measurement ID `G-3PGGJ0JX4H`, disable automatic events outside the approved page-view scope, and verify that private, print and PDF routes produce no analytics events.
- Google Search Console accepted `/sitemap.xml` after cutover and reported 47 discovered current pages. Indexing and coverage remain ongoing search-platform processes rather than a ranking guarantee.

## Previous production release: settled field sync and readable new-job inputs

Application and mobile update source `746df6d1ffe3fb8cfe9c8e6deab0d52516e65488` on branch `codex/tlink-field-app` is the exact source deployed publicly as Sites version 403 and published to the Android preview update channel for runtime 1.0.1. Signed Android build `233c6924-48ca-4417-abd8-9447135ad74f` remains the compatible native build from mobile source `f325d924242be20429edc7806b968b72d8a5d26c`.

The release keeps Victorian rental minimum standards selected by default while allowing it to be unticked. Minimum standards, electrical safety, gas safety and smoke alarm are four independent choices, and at least one is required. The same scope contract is enforced in public request intake, TLink job creation and TLink Field job creation. The web and mobile workflows use a section overview, open one section per screen, save before continuing and return Back to the overview.

The Android application is named TLink and uses the TLink icon in native launcher, splash and in-app identity. Its interface uses the rich navy and green TLink theme. TLink Team gives the office a visible three-step path: add the person, open details, set or change their unique TLink username, then generate and email a one-time six-digit PIN. A saved member email is required for PIN delivery. The main account owner has a `Set up my app` action, so a sole trader can assign their own TLink username and receive their own PIN. Changing the username revokes any unused PIN, and the existing device revocation and sign-out controls remain available.

The main-account save loop is fixed. Owner access bootstrapping no longer rewrites the member revision on every authenticated request when the authoritative owner details already match. A genuine owner-detail repair still updates the revision. The Team interface now treats only the typed `REVISION_CONFLICT` response as an optimistic-concurrency conflict, so duplicate usernames and other validation failures retain their exact server message.

The installed version mismatch is fixed without weakening the server gate. Signed Android build 2 is version 1.0.1, but its JavaScript request configuration had been hardcoded to 1.0.0, so the existing minimum 1.0.1 policy correctly rejected sign-in. TLink now reads `nativeApplicationVersion` from the installed binary and uses Expo config only as a fallback. The signed-out startup screen has an accessible top-right settings cog with check for update, secure full-build install, app version and native build details. The same existing update checker remains available after sign-in.

The post-PIN access stall is fixed. The created live Samsung session had never advanced beyond its creation timestamp, which proves the previous client stopped before the first authenticated access request. The client now caps the reachability probe at 1.5 seconds, verifies field access before encrypted local-owner preparation, releases the route gate before background synchronisation, caps JSON requests at 20 seconds, and stops repeated sync cursors. The authenticated access response refreshes the restricted-screen identity to the office-controlled field username.

The later completed-sync feedback loop is fixed. A successful access response had returned a newly allocated principal even when its username was unchanged. Updating that object caused the NetInfo listener to resubscribe, its immediate connectivity callback started another sync, and the cycle repeated. Unchanged identity refreshes now return no mutation, while the network listener depends only on signed-in status. The schedule can therefore settle on `All field work is safely synced`.

The field-created new-job form now uses explicit dark raised input surfaces with light entered text, muted placeholder text and a visible green selection colour. This removes the white-on-white Android fields that hid typed customer and property details.

PIN creation now uses a per-code salt and a server-held HMAC-SHA256 pepper instead of the slow Worker PBKDF2 path that caused the reported HTTP 500 timeout. Only the hash is stored. The email contains the exact saved username, one-time PIN, expiry and TLink app link. If Resend does not accept the email, the exact newly issued PIN is revoked and the dashboard reports that delivery failed rather than presenting false success.

TLink gives each technician, trade and assessor a device-bound session, a week calendar, assigned jobs, mobile job creation, workflow forms, pull-to-refresh and an explicit update check. The dashboard keeps a compact TLink-logo Get the app control at the top right, and the install page serves signed Android version 1.0.1 build 2. The assigned qualified assessor remains the final issuer. Evidence retains capture time, upload time and governed location metadata. Public report capabilities remain hashed, revocable and bounded to 60 days, require no viewer account, and expose the issued report plus PDF except internal notes.

| Release evidence | Exact identity |
| --- | --- |
| Application source | `746df6d1ffe3fb8cfe9c8e6deab0d52516e65488` |
| Mobile update source | `746df6d1ffe3fb8cfe9c8e6deab0d52516e65488` |
| Mobile native build source | `f325d924242be20429edc7806b968b72d8a5d26c` |
| Git branch | `codex/tlink-field-app` |
| Sites project | `appgprj_6a550c378000819185caf094173422bb` |
| Saved version | `appgprj_6a550c378000819185caf094173422bb~appgver_fae830ad12dc8191873f5bde961b51c9` |
| Public version | Sites version 403 |
| Deployment | `appgdep_6a8c68f328b88191b2c2a6d4ce53a7f4` with status `succeeded` |
| Provider deployment | `info294029--aea-energy-comparison` |
| Hosted environment | Revision 28 |
| Local release archive | 12,357,970 bytes, SHA-256 `4A4B498F999DB36F707E8EE0AA9DB169D91436EA11B10BAE990A81D2304DCB96` |
| Stored archive | 45,281,280 bytes, 501 files, `sha256:fe187c8273e2003b8284fe7efb287dabdc178062e682d9f32a2b18266a83c334` |
| Expo project | `@ausenergy/aea-field`, project `3b02565e-dc34-4088-8cdd-e3c8a9ba11e9` |
| Signed Android build | `233c6924-48ca-4417-abd8-9447135ad74f`, version 1.0.1, build 2, runtime 1.0.1, preview channel |
| Android update | Group `29fe8909-903b-481d-99d6-8db0b3ccdba2`, update `01a03475-deab-7cce-93b2-6f9afa26b287`, runtime 1.0.1, preview channel |
| Android APK | `https://expo.dev/artifacts/eas/cFVT_w5DmGllF2kIxs-eGg5DJlYZ23oewaErhK9fHqg.apk`, SHA-256 `6BC7610FC419086C0EAF41C81C97F063970A4241525E4B1BF5AE9937D4F63121`, expires 7 September 2026 |
| Custom domain | `https://compare.ausenergyassessments.com` |

### Validation and runtime evidence

- On exact released application source `746df6d1ffe3fb8cfe9c8e6deab0d52516e65488`, root typecheck, warning-free lint, the complete repository test suite, fresh D1 replay across 161 exact migrations through `0162_trade_field_username.sql`, the production build, Sites bundle audit and public-performance budgets passed. The final CSS payload met its 735,000-byte budget exactly.
- The focused native and field-access regression set passed 16 of 16. Native typecheck, warning-free lint and all 38 mobile tests passed. Android bundled 1,511 modules and iOS bundled 1,390 modules.
- Focused field-access tests passed 77 of 77. They cover owner username setup, owner lifecycle and permission protections, HMAC-pepper PIN storage without plaintext, missing-secret fail-closed behaviour, recipient selection, escaped TLink email content, successful provider acceptance, provider-failure PIN revocation and missing-email handling.
- Native mobile typecheck, lint and Android Expo export passed. The export bundled 1,511 modules and the TLink icon. Expo public config reported TLink version 1.0.1, runtime policy `appVersion` and the TLink icon paths. EAS produced the signed Android build from exact source `f325d924242be20429edc7806b968b72d8a5d26c`.
- The native TLink 512-pixel icon hash matches the public TLink icon, foreground and splash assets; the 192-pixel public icon matches the mobile favicon.
- Migration `0162_trade_field_username.sql` is additive. It adds the office-controlled username and normalised lookup value plus a per-owner uniqueness index. It performs no production table drop or rename.
- EAS published the Android update from a clean working tree at exact commit `746df6d1ffe3fb8cfe9c8e6deab0d52516e65488`. The preview channel resolves update group `29fe8909-903b-481d-99d6-8db0b3ccdba2` and Android update `01a03475-deab-7cce-93b2-6f9afa26b287` for runtime 1.0.1.
- Branch `codex/tlink-field-app` and Sites managed `main` both resolved to exact application source `746df6d1ffe3fb8cfe9c8e6deab0d52516e65488` before version 403 was saved.
- Sites version 403 deployed successfully with environment revision 28. The custom-domain health endpoint, Android release-policy endpoint and TLink field-app route returned HTTP 200 after deployment. The subsequent production error-log query returned zero events. The minimum and latest Android versions remain 1.0.1.

### Boundaries

- Samsung installation of version 1.0.1 build 2 and the settings-cog update are confirmed by the supplied screenshots. Applying Android update `01a03475-deab-7cce-93b2-6f9afa26b287`, confirming sync settles without a spinner, and confirming typed new-job text remains visible are the immediate physical-device verification.
- Real Resend mailbox delivery of a TLink PIN remains to be verified by the first deliberate owner or worker setup. Provider acceptance and failure rollback are covered by automated tests, but release verification did not create a live credential or send an unsolicited email.
- Any unused PIN issued before version 399 must be regenerated because the new server-secret-backed hash deliberately does not accept the former PBKDF2 representation.
- Contract-specific service wording remains provisional until the client service schedule is supplied and reviewed.
- Optional electrical, gas and smoke-alarm modules remain pre-launch/test-data capability until their declaration wording and test logic receive licensed-practitioner review.
- A device-reported GPS record is evidence metadata, not independent proof that a person attended the property.
- The internal Android APK expires on 7 September 2026 and must be refreshed or replaced by the permanent app distribution path before then. An iOS installable build was not produced in this release.
- Physical Android field testing and a supervised test-property rehearsal remain separate acceptance work.
- The hosted product remains pre-launch until the product owner explicitly declares it live.

## Incorporated release foundation: governed sources, conversation quality, continuity and route budgets

Milestone `AEA-SURGE-GOVERNANCE-QUALITY-BUDGETS-82` was validated in application source `7627d3ef7a28002b3b1b2cf6aebdbf76257683b7`, saved and deployed as Sites version 392 through deployment `appgdep_6a8bee30af108191b5d8db124c788fc0`, and then incorporated into the current version 402 application. Version 392 passed live desktop and phone acceptance before the later TLink releases superseded it.

The release completes the requested five controls. Thirty-two volatile official sources require an identified, current review-role approval and a SHA-256 match against the canonical maintained evidence record. The reviewed conversation corpus contains 20 approved cases across 10 required dimensions and its aggregate release report requires exactly one result per case without storing customer transcript content. Deterministic session selection rehearses persistent context and conversation continuity. Home, Surge, plan and calculator routes have separately enforced JavaScript and CSS graph budgets. Reviewed regressions cover practical household tips, exact product questions, certificate coverage, brand-neutral comparisons and context clarification.

`npm.cmd run validate` passed with all 36 integration tests, the complete repository suite, fresh D1 migrations through `0159_surge_conversation_quality_dimensions.sql`, customer-plan PDF audit, production build, Sites server-bundle audit and public performance budgets. The source-approval audit passed 32 of 32 volatile sources. The conversation-quality aggregate passed 20 of 20 reviewed cases across all 10 dimensions. The continuity rehearsal passed. Measured route graphs are home 291,663 bytes JavaScript and 1,385 bytes CSS, Surge 561,624 and 37,285, plan 508,969 and 27,524, and calculator 458,978 and 43,470.

This does not claim scheduled remote-byte retrieval, human approval of future upstream changes, deployed-model corpus execution, real-browser cross-session continuity, or completed stylesheet splitting. Those remain in the next five.

## Incorporated release candidate: AEA-SURGE-GOVERNED-DEPTH-83

Release deployment identity: pending. This release has no recorded application source, Sites saved version or deployment identifier until exact release evidence exists.

### Completed contracts

1. Official-source custody captures exact upstream bytes with URL and HTTP metadata and SHA-256, compares them with a maintained baseline, and keeps reviewer and approval state separate so the audit fails closed.
2. Conversation-quality reporting aggregates reviewed-case outcomes, required dimensions, latency, source and status counts, corpus, prompt and source hashes, and application, deployment and model identity without storing transcripts or customer identity.
3. Installed-browser continuity rehearsal covers restart, duplicate tab, fresh profile, corrupt-primary backup recovery and scroll handoff through a synthetic intercepted API.
4. Route graph budgets inspect built manifest and React Server Components page and layout ownership and enforce separate JavaScript and CSS budgets for home, Surge, plan and calculator.
5. Reviewed guidance covers six practical and product categories, certificate pathways, exact-input deterministic calculations and brand-neutral comparison boundaries.

The release adds migration `0163_surge_conversation_quality_model_identity.sql` for aggregate corpus, prompt, source, application, Git, deployment, requested-model, provider-model and latency identity. It stores no transcript or customer identity.

### Honest boundaries

- The exact-byte source custody release gate is not yet required because no reviewed baseline and independent approval exist. It becomes required only after the first production fixture is captured and independently approved.
- The evaluation corpus and continuity API are synthetic until a deployed-model run is recorded. This does not prove production provider response quality.
- Surge must not guess customer certificate quantities, trading values, registration fees, compliance fees, aggregator deductions or final cash discounts. Missing or stale exact inputs fail closed.

### Surge governed-depth follow-on queue

1. Capture the first production official-source fixture, complete independent review and make the exact-byte custody gate required.
2. Run the reviewed corpus against the deployed provider and model and establish a signed baseline and release threshold.
3. Extend installed-browser continuity rehearsal to concurrent two-way tab edits, conflict handling and deterministic replay.
4. Tighten the per-route JavaScript and CSS graph budgets after measured chunk and stylesheet restructuring.
5. Expand independently reviewed exact-model specifications and current programme and certificate coverage while preserving the exact-input and no-guessed-values rule.

## Incorporated release candidate: AEA-SURGE-ASSESSOR-OPERATING-MODEL-84

Release deployment identity: pending. This release has no recorded application source, Sites saved version or deployment identifier until exact release evidence exists.

### User and product outcome

Surge now has one stable assessor and educator operating model without a visual redesign. He is a calm, practical Australian home-energy guide who assumes the customer may be new to the subject, answers the immediate question first, explains why the recommendation fits, and asks at most one highest-value follow-up question when more context is genuinely required.

The seven supplied education documents were read in full, covering 465 of 465 pages. Their exact source custody, page counts, SHA-256 identities and review boundaries are maintained separately from the 19 teaching cards reviewed for editorial use that Surge can retrieve. Independent subject-matter review of those cards and the operating-model PDF remains outstanding. `electric saul.pdf` is treated as a useful baseline, while Surge is deliberately more explanatory, transparent and helpful.

### Reasoning and education contracts

1. Reviewed education can improve generic deterministic household guidance, but cannot override exact product, rebate, certificate, tariff, eligibility, safety or current-programme routes.
2. Good, Better and Best are optional method-quality tiers based on evidence, suitability, durability and verification. They must never imply social status, assume a budget or turn into a product sales ladder.
3. Product and brand guidance remains provider-neutral. Exact-model comparisons require approved specification evidence, while volatile claims require current official sources and governed deterministic calculations.
4. Hazardous do-it-yourself work, regulated trade instructions and unsupported legal conclusions are excluded. When uncertainty matters, Surge identifies it and asks one useful question or directs the customer to the appropriate qualified person.
5. Generated conversation copy remains plain Australian English and prohibits em dashes and en dashes.

The operating model is documented in the generated 22-page `surge-ai-operating-model-and-education-framework.pdf`. Its SHA-256 is `5AE904A523986FBA43719C56C75FFA3D5D438EF9B90939179E865BB9212A4108`. The PDF includes the role, priorities, decision method, source hierarchy, teaching pathway, personality, guardrails, product and programme boundaries, context handling, quality controls and change-management process.

### Honest boundaries

- The 19 teaching cards are a bounded reviewed set, not a claim that every subject in the 465-page corpus is already encoded.
- Source custody and automated checks do not replace independent professional approval of future education changes.
- A stronger operating model does not make stale programme, certificate, tariff, price or model data current. Those answers still fail closed unless authoritative current evidence is available.
- Automated corpus tests do not yet prove the deployed provider and model will satisfy every conversation-quality expectation.

### Surge assessor follow-on queue

1. Complete independent subject-matter review of the 19 teaching cards and the operating-model PDF.
2. Expand current official product, programme and certificate coverage while preserving exact-input calculations and fail-closed answers.
3. Run the reviewed conversation corpus against the deployed provider and model, then baseline beginner clarity, one-question progression, neutrality and leakage controls.
4. Add explicit approval and change-control records for every education-source and teaching-card revision.
5. Aggregate response-quality monitoring and tune Surge only from reviewed evidence rather than isolated anecdotes.

## Previous production release: grounded product and certificate guidance

Application source `0944c9b91765535b873b30029f545bde8f744831` on branch `codex/job-schedule-week-calendar` is the exact source deployed as public Sites version 391 at `https://compare.ausenergyassessments.com`.

Surge now resolves supported product, brand, model, rebate and certificate questions through the maintained official product registry and governed calculation paths before any model-generated answer is considered. The resolver is category and registry driven rather than hardcoded to named brands. It can identify likely registered candidates from a brand and capacity, then asks exactly one highest-value question when an exact model, postcode, existing system or another required input is missing.

Exact STC quantities require an exact registered model and postcode and are calculated by the deterministic estimator. VEEC quantities require a governed scenario and current rule inputs. Current certificate market references are shown only when the official feed is current, with the last reported trade date and value. Customer copy explains that certificate trading values move like a share price and that the real installer discount is usually lower after registration, compliance, administration and aggregator costs. Those costs are never guessed.

Current Solar Victoria support can be stated from the governed official programme facts with its date basis. Neutral product comparisons require exact verified specification sheets, so Surge does not invent noise, recovery, efficiency or warranty differences from brand reputation. Generated conversation copy continues to prohibit em dashes and en dashes.

| Release evidence | Exact identity |
| --- | --- |
| Application source | `0944c9b91765535b873b30029f545bde8f744831` |
| Sites project | `appgprj_6a550c378000819185caf094173422bb` |
| Saved version | `appgprj_6a550c378000819185caf094173422bb~appgver_3666fa042f0c8191a42942f3229725bc` |
| Public version | Sites version 391 |
| Deployment | `appgdep_6a8af0d5ca1081919f3c86b55f68a163` with status `succeeded` |
| Provider deployment | `info294029--aea-energy-comparison` |
| Local release archive | 12,224,610 bytes, SHA-256 `ffaeed5a983d077e0e0b2035bf0df9aa11517d27a2354bccb616d7a6400eb20d` |
| Custom domain | `https://compare.ausenergyassessments.com` |

### Validation and runtime evidence

- Focused assistant API, grounded product guidance and client route checks passed 41 of 41 tests.
- `npm.cmd run validate` completed with exit code 0 against exact application source `0944c9b91765535b873b30029f545bde8f744831`. It passed typecheck, warning-free lint, all 36 integration tests, the complete repository suite, fresh D1 migrations through `0158_remove_surge_account_context.sql`, customer-plan PDF accessibility audit, production build, Sites server bundle audit and public performance budgets.
- The production performance gate reports a 4,758-byte root launcher, 84,713-byte deferred assistant, 732,292-byte stylesheet, 293,048-byte public graph, 920,379-byte customer graph, 956,257-byte trade graph and 1,792,764-byte Creditex graph.
- GitHub `main`, the working branch and Sites managed `main` contained exact application source `0944c9b91765535b873b30029f545bde8f744831` before packaging.
- Live desktop QA confirmed the three-column workspace, non-collapsible desktop context rail and absence of the removed account-copy controls. Live 390 by 844 phone QA confirmed the compact horizontal header, collapsed context drawer and readable form. The clean release tab reported zero browser errors.

### Boundaries

- Registry-backed product coverage is limited to the supported public categories and brands available in maintained official registries. It is not a claim to cover every product sold anywhere.
- Surge does not guess certificate quantities, cash discounts, model eligibility or product performance facts. Missing or stale governing evidence fails closed.
- Current certificate market values depend on the maintained official feed. Stale values are not presented as current.
- Live QA did not send a chat turn, create a lead or alter saved customer context.
- The hosted product remains pre-launch until the product owner explicitly declares it live.

## Previous production release: practical Surge assessor guidance and account-copy removal

Application source `1b2509768bbca7947e3a01438da4c8814d20fe90` on branch `codex/job-schedule-week-calendar` is the exact source deployed as public Sites version 390 at `https://compare.ausenergyassessments.com`.

The release removes the unsolicited account-context save and delete feature in full. It removes the customer card, lazy client import, API route, server helper, component styles, feature tests and persisted `surge_account_context` table. Same-browser private context remains the only home-context persistence path.

Early deterministic guidance now uses the saved context to select practical provider-neutral actions such as safe gap sealing, door and window seals, door snakes, removable glazing films, cellular coverings, insulation top-ups, reverse-cycle heating, electric throws, filter cleaning, solar and tariff load shifting, evaporative outlet checks, humidity control, heat-pump drying and deciduous shade. Advice that conflicts with the latest saved context is excluded.

The assistant prompt and deterministic fallback now follow an assessor-style progressive qualification contract. Surge answers what can be answered, asks exactly one highest-value question when a material fact is missing, and continues until there is enough context for a reliable answer. Hot-water rebate qualification starts with the current system and then gathers location, proposed replacement and other eligibility facts as needed. Current programmes and values still require governed official sources and fail closed when evidence is missing or overdue. Generated conversation copy prohibits em dashes and en dashes.

| Release evidence | Exact identity |
| --- | --- |
| Application source | `1b2509768bbca7947e3a01438da4c8814d20fe90` |
| Sites project | `appgprj_6a550c378000819185caf094173422bb` |
| Saved version | `appgprj_6a550c378000819185caf094173422bb~appgver_9c189c6e240c8191b5e3d98d97606065` |
| Public version | Sites version 390 |
| Deployment | `appgdep_6a89b86b8c048191bb5d187f9e972407` with status `succeeded` |
| Hosted environment | Revision 24 |
| Package content hash | `sha256:441010807c5563b7e3890f2358dc6bdc4bb194d532959ba58cb337ff0f6f63aa` |
| Custom domain | `https://compare.ausenergyassessments.com` |

### Validation and runtime evidence

- Focused assistant, guidance, widget, migration and release checks passed 110 of 110 tests.
- `npm.cmd run validate` passed typecheck, warning-free lint, all 36 integration tests, 2,851 repository tests with 11 intentional skips and zero failures, a fresh 157-migration D1 database, customer-plan PDF audit, production build, Sites bundle audit and performance audit.
- The production performance gate reports a 4,758-byte root launcher, 84,713-byte deferred assistant, 732,292-byte stylesheet, 293,048-byte public graph, 920,379-byte customer graph, 956,257-byte trade graph and 1,792,764-byte Creditex graph.
- The matching local archive is 12,202,751 bytes with SHA-256 `2777CD1CC0D1565671CD4C0F872CC8707562CC2979E40888B18CF8E655C521A7`.
- Sites stored 44,584,960 bytes across 484 files with package content hash `sha256:441010807c5563b7e3890f2358dc6bdc4bb194d532959ba58cb337ff0f6f63aa` and deployed the saved version through deployment `appgdep_6a89b86b8c048191bb5d187f9e972407` at environment revision 24.
- Exact application source was present on GitHub `main`, the working branch and Sites managed `main` before packaging.
- Fresh desktop live QA confirmed that account controls are absent, the three-column workspace has no horizontal overflow and current assets load without console errors. An old retained tab referenced a superseded hashed asset, but the failure did not reproduce in a clean version 390 tab.

### Boundaries

- Saved home context remains same-browser for 30 days. It is not an account, verified property record or cross-device identity.
- Product names supplied in references remain examples only. Published guidance is provider-neutral.
- Current rebates, certificates, tariffs and programme eligibility require current governed official facts and fail closed when evidence is missing or overdue.
- Live QA did not send a chat turn, create a lead or alter home context.
- The hosted product remains pre-launch until the product owner explicitly declares it live.

## Previous production release: context-aware Surge guidance and five priority controls

Application source `8d887f867269a157d84928fb553eac4951ed517b` on branch `codex/job-schedule-week-calendar` is the exact source deployed as public Sites version 389 at `https://compare.ausenergyassessments.com`.

The release recalculates the guidance rail from the complete allowlisted home profile whenever an answer changes. Moisture and damp guidance is conditional on the current saved moisture answer, and regression coverage proves that the guidance appears when selected and disappears when the answer is removed.

It also adds a bounded official-change review queue, a reviewed conversation-quality corpus and release thresholds, aggregate-only profile-storage health reporting, measured surface-specific JavaScript graph budgets, and explicit signed-in save and delete controls for an account copy of home context. It does not automatically associate same-browser context with an account and does not store profile or conversation content in health or quality telemetry.

| Release evidence | Exact identity |
| --- | --- |
| Application source | `8d887f867269a157d84928fb553eac4951ed517b` |
| Sites project | `appgprj_6a550c378000819185caf094173422bb` |
| Saved version | `appgprj_6a550c378000819185caf094173422bb~appgver_dd2b493446408191b9b4b321d682d39b` |
| Public version | Sites version 389 |
| Deployment | `appgdep_6a898f2b620c81918109cac63f954590` with status `succeeded` |
| Hosted environment | Revision 24 |
| Package content hash | `sha256:a8ed0fe75ff54df21cc0ca4e5d1dcc84acbad9e446af7abf3f2ac47595f35184` |
| Custom domain | `https://compare.ausenergyassessments.com` |

### Validation and runtime evidence

- The focused behaviour and account-context suite passed 43 of 43 tests; the focused release set passed 58 of 58 tests and migration validation passed 33 of 33 across all 156 migrations.
- `npm.cmd run validate` passed typecheck, warning-free lint, all 36 integration tests, 2,839 repository tests with 11 intentional skips and zero failures, a fresh 156-migration D1 database, customer-plan PDF audit, production build, Sites bundle audit and performance audit.
- The production performance gate reports a 4,790-byte root launcher, 83,840-byte deferred assistant, 732,292-byte stylesheet, 293,115-byte public graph, 920,414-byte customer graph, 956,479-byte trade graph and 1,792,764-byte Creditex graph.
- The matching release archive is 12,206,992 bytes with 502 entries and SHA-256 `18E1C7ED733455D0B189D98AD56100A642F0A436C7249A1E07E6CB2D8F5B2E1C`.
- Sites stored 44,625,920 bytes across 488 files with the package content hash above and deployed the saved version through deployment `appgdep_6a898f2b620c81918109cac63f954590` at environment revision 24.
- GitHub `main`, the working branch and Sites managed `main` contained the exact application source before packaging.
- Live desktop QA confirmed 45 of 45 saved responses and guidance that changed with the saved context: after moisture was removed, the live tips contained no moisture advice and covered ceiling insulation, draughts and shell-first improvements. Live phone QA confirmed compact secondary drawers, a visible composer and no horizontal overflow.

### Boundaries

- The account copy remains an explicit signed-in action and is never created from browser context automatically.
- Storage-health and quality telemetry are aggregate-only and retain no customer content or identity.
- Live QA did not send a chat turn, create a lead or mutate an account copy.
- The hosted product remains pre-launch until the product owner explicitly declares it live.

## Previous production release: durable Surge context and chronological workspace

Application source `365101733253f2ff39532343bcef81303e96e1e2` on branch `codex/job-schedule-week-calendar` is the exact source deployed as public Sites version 379 at `https://compare.ausenergyassessments.com`.

| Release evidence | Exact identity |
| --- | --- |
| Application source | `365101733253f2ff39532343bcef81303e96e1e2` |
| Sites project | `appgprj_6a550c378000819185caf094173422bb` |
| Saved version | `appgprj_6a550c378000819185caf094173422bb~appgver_4928e91cf1688191b282c32650d17325` |
| Public version | Sites version 379 |
| Deployment | `appgdep_6a88e70dfe908191b90ea491455ef531` with status `succeeded` |
| Hosted environment | Revision 24 |
| Package content hash | `sha256:03137190ae5446ae2f176c52f9cfbfee5bb105db5ec4f1fdb58e625c57a2c541` |
| Custom domain | `https://compare.ausenergyassessments.com` |

### Released outcome

- Every maintained home-context field update is written immediately to the canonical same-browser session. Page hide, tab visibility changes, route changes and storage events flush or rehydrate the same allowlisted profile so reviewed `Not sure` answers are not silently lost.
- `Continue setup` appears beside incomplete progress and opens the next unreviewed section. Section saves continue forward until all 45 details have been reviewed; a reviewed unknown remains reviewed after serialisation and reload.
- Conversation turns render chronologically at the end of the workspace immediately above the composer. New replies target the conversation end rather than appearing above context forms or optional service controls.
- Desktop now has a persistent three-column workspace: home context, conversation and `Home guidance`. The guidance rail holds no transcript content; it provides at most three deterministic tips derived only from saved context plus the optional human-help path.
- Phone keeps context, starter prompts and guidance in compact closed drawers while the composer and normal document scroll remain immediately usable. There is no nested mobile scroll container.

### Validation and runtime evidence

- `npm.cmd run validate` passed on the exact application state: typecheck, warning-free lint, all 36 integration tests, the complete repository suite, all 153 migrations, customer-plan PDF audit, Vinext production build, Sites bundle audit and public-performance audit.
- The focused persistence, chronology, rail and responsive regression set passed 33 of 33 tests; `npm.cmd run typecheck`, `npm.cmd run lint` and `git diff --check` also passed independently.
- The public-performance audit reports a 4,758-byte root launcher, 76,956-byte deferred assistant and 732,292-byte global stylesheet.
- Sites stored 44,544,000 bytes across 479 files with the package content hash above. The matching local release archive was 12,209,964 bytes.
- Live 1440 by 900 desktop QA confirmed the complete context rail, chronological conversation area and persistent right-side guidance. Live 390 by 844 phone QA confirmed all three secondary areas start collapsed, the composer remains visible through normal page scrolling and no inner panel traps the gesture.
- GitHub `main`, the working branch and Sites managed `main` contained the exact application source above before packaging; saved version 379 and its deployment provenance remain pinned to that source even when later documentation-only checkpoints advance those branches.

### Boundaries

- Persistence remains same-browser, expires after 30 days and does not create a customer identity or cross-device sync.
- Guidance tips are deterministic presentation of saved customer-reported context, not new facts, professional verification, a formal rating or a product recommendation.
- Live QA did not send an assistant question or create a lead, email, trade record or customer record. Chronological turn ordering and persistence transitions are covered by automated regressions.
- The shared stylesheet remains a 732,292-byte raw build asset and the production build still reports large-chunk warnings. Both pass the current performance budgets but remain structural optimisation work.
- The hosted product remains pre-launch until the product owner explicitly declares it live.

## Previous production release: complete Surge context flow and quality controls

Application source `62b8f947731f8f9f313d3c6a2b8c4e4972d98c03` on branch `codex/job-schedule-week-calendar` is the exact source deployed as public Sites version 378 at `https://compare.ausenergyassessments.com`.

| Release evidence | Exact identity |
| --- | --- |
| Application source | `62b8f947731f8f9f313d3c6a2b8c4e4972d98c03` |
| Sites project | `appgprj_6a550c378000819185caf094173422bb` |
| Saved version | `appgprj_6a550c378000819185caf094173422bb~appgver_37bca6308e5481918c3a2be69a2048c4` |
| Public version | Sites version 378 |
| Deployment | `appgdep_6a8871da825c8191926a9d71cca8f4df` with status `succeeded` |
| Hosted environment | Revision 24 |
| Package content hash | `sha256:51fa36a204e87b17d1d5f507483606e376172c2ade6396d88608dd593289595b` |
| Custom domain | `https://compare.ausenergyassessments.com` |

### Released outcome

- Desktop `/surge` always renders the complete home-context rail and disables its disclosure control. The rail cannot be collapsed at desktop widths and reopens when the viewport returns from phone mode.
- Phone widths keep the context rail collapsed by default as one compact, tappable `Your home context` drawer. Opening it exposes all 13 edit sections without adding a nested page-scroll trap.
- Saving a home-context section advances to the next unreviewed section instead of closing the intake. The action remains `Save and continue` through steps 1 to 12, changes to `Finish home context` at step 13 and completes only after all 45 fields have been reviewed.
- Every context `Edit` action retains the released scroll-and-focus behaviour, and the saved profile continues across routes and browser tabs under the existing 30-day same-browser boundary.
- All 109 maintained official sources now carry an explicit volatility class and reuse basis. Programme guidance uses the governed catalogue review date and fails closed after it instead of presenting stale programme names or availability.
- Surge records only day-level aggregate quality counters for bounded intent, source status, correction, topic-switch, privacy and follow-up outcomes. Migration `0154_surge_conversation_quality_daily.sql` stores no prompt, answer, transcript, contact detail or customer identifier.

### Validation and runtime evidence

- `npm.cmd run validate` passed on the exact application state: typecheck, warning-free lint, all 36 integration tests, the complete repository suite, all 153 migrations, customer-plan PDF audit, Vinext production build, Sites bundle audit and public-performance audit.
- The focused context-rail and sequential-save regression set passed 33 of 33 tests. The governed-knowledge and conversation-quality set passed 127 of 127, the focused migration set passed 33 of 33 and `git diff --check` passed.
- The public-performance audit reports a 4,758-byte root launcher, 72,815-byte deferred assistant and 732,292-byte global stylesheet.
- Sites stored 44,523,520 bytes across 479 files with the package content hash above. The local release archive was 12,190,985 bytes with 493 entries and SHA-256 `B358AEB7933FB124DF332F3705859EAF7CADFF62B79272E216BA2818915E0F72`.
- Live desktop QA at 1280 by 720 confirmed the context disclosure is open, its body is rendered, the summary has `pointer-events: none`, all context groups are visible and the rail remains open after returning from phone mode.
- Live sequential QA exercised all 13 sections in order. Steps 1 to 12 exposed `Save and continue`, step 13 exposed `Finish home context`, the result reported 45 of 45 details reviewed and the chat welcome appeared.
- Live 390 by 844 phone QA confirmed the same rail starts closed, its summary remains interactive, opening it exposes 13 `Edit` actions, and closing desktop-only behaviour is not applied at the phone breakpoint.
- GitHub and Sites managed `main` contained the exact application source above before packaging; saved version 378 and its deployment provenance remain pinned to that source even when later documentation-only checkpoints advance those branches.

### Boundaries

- No authentication, calculation, trade workflow, lead, customer-data or customer-identity contract changed.
- Persistence remains bounded to the same browser, expires after 30 days and does not create cross-device identity.
- Aggregate quality instrumentation is a measurement foundation, not a claim that production conversation quality is already acceptable. Reviewed evaluation cases, thresholds and an operator view remain Priority 2.
- The governed registry now has freshness metadata and programme fail-closed behaviour, but expanding reviewed household guidance and official-change monitoring remains Priority 1.
- The shared stylesheet remains a 732,292-byte raw build asset and the production build still reports large-chunk warnings. Both pass the enforced release budgets but remain structural performance opportunities.
- No real lead, email, trade record or customer record was created during live verification.
- The hosted product remains pre-launch until the product owner explicitly declares it live.

## Superseded release checkpoint: Surge quality foundation

Application source `2e811927fe29bd6910064b766f945e2f2c84e2d5` was deployed as Sites version 377 under saved version `appgprj_6a550c378000819185caf094173422bb~appgver_cfd009a238e881918dc9fc72d26bba9b` and deployment `appgdep_6a886f5466e08191a86f591d20659be2`. It contained the sequential context flow, governed-source freshness and aggregate quality foundation, but live desktop QA found the native context disclosure closed after hydration. Version 378 superseded it with the controlled desktop rail correction.

## Previous production release: visible Surge edits and compact mobile navigation

Application source `cec5d66422ff9fe140b7d160c4d7ced836d6b74f` was deployed as public Sites version 376 under saved version `appgprj_6a550c378000819185caf094173422bb~appgver_49ef85c0ba9c81919996c18fdb33939f` and deployment `appgdep_6a8861729c64819198b2e984832b3f06`. It released visible context editing, the swipeable phone header, compact phone drawers and page-level chat scrolling.

## Previous production release: responsive Surge quick chat and mobile workspace

Application source `93458d308f2861286f2cde673a7f922c24201bac` was deployed as public Sites version 375 under saved version `appgprj_6a550c378000819185caf094173422bb~appgver_e3e5ced77f708191a734ca186c90c09f` and deployment `appgdep_6a885b22f07c8191af4887b6e6331ed9`. It restored the floating quick chat, collapsed phone context and suggestions, and removed the dedicated mobile workspace scroll trap.

## Superseded interim responsive releases

Sites versions 373 and 374 were deployment checkpoints for the compact typography, restrained radii, phone navigation and homepage contrast correction. They are superseded by version 376.

## Previous production release: Surge continuity and platform typography

Application source `9dc33106b51cb708837cbefa911ff1eaa3fa778d` was deployed as public Sites version 372 under saved version `appgprj_6a550c378000819185caf094173422bb~appgver_4a303cbf5afc8191bba9ec89b793fcd3` and deployment `appgdep_6a884b8fb4008191a62cea5d73058669`. It introduced the shared seven-role typography system, readable Surge actions, chronological conversation flow, same-browser profile continuity and the simplified compact Surge header.

## Previous production release: public Surge UX optimisation and shared wide layout

Application source `9c5e7199f3f9c521cf47510dafcf39cbe74d81f6` was deployed as public Sites version 371 under saved version `appgprj_6a550c378000819185caf094173422bb~appgver_4ce93839857c819180106e9800440d9e` and deployment `appgdep_6a883f07c4108191a8f1fcc7db68dba1`. It introduced the 1760-pixel shared shell, optimised homepage mascot treatment, full-page Surge navigation and aligned Step 11 controls.

## Previous production release: public customer-path performance recovery

Deployment source `bc71dda1fa5e79f4529c4ba408bd481a87a066ba` on branch `codex/job-schedule-week-calendar`, containing performance implementation commit `bd27d65f98b80b673c5ffc9812b9bc92bd78f9a4`, is the exact source deployed as public Sites version 370 at `https://compare.ausenergyassessments.com`.

| Release evidence | Exact identity |
| --- | --- |
| Deployment source | `bc71dda1fa5e79f4529c4ba408bd481a87a066ba` |
| Performance implementation | `bd27d65f98b80b673c5ffc9812b9bc92bd78f9a4` |
| Sites project | `appgprj_6a550c378000819185caf094173422bb` |
| Saved version | `appgprj_6a550c378000819185caf094173422bb~appgver_d648a0683fac8191b4557857b047cf83` |
| Public version | Sites version 370 |
| Deployment | `appgdep_6a8836cc0e288191b11a31849c948d9c` with status `succeeded` |
| Hosted environment | Revision 24 |
| Package content hash | `sha256:b479c50096dc9def83591a5d4db0752bb80efaaeb76f907133e4c7a221f1f5a6` |
| Custom domain | `https://compare.ausenergyassessments.com` |

### Released outcome

- The homepage and planner no longer mount a permanent canvas, pointer parallax, scan sweep, blur tile, orbit, particle field, floating room label or decorative telemetry layer.
- The always-running shared-header compositor effects are removed. The public homepage has zero infinite animations while preserving the approved static navy and teal treatment.
- The 1,650,041-byte whole-home PNG and 867,694-byte Surge mascot PNG are replaced by 71,206-byte and 71,106-byte WebP assets.
- Ordinary routes mount a 5,194-byte Surge launcher and load the 69,687-byte assistant only after an explicit open action. The 568,820-byte postcode-backed enquiry adapter loads only for optional enquiry submission.
- Main household header, planner, comparison, rebate and enquiry handoffs use client navigation, while dense secondary link groups avoid eager prefetch storms.
- The production build now fails closed when the launcher, deferred assistant, shared stylesheet or optimised public images exceed their explicit budgets or when deferred modules return to initial loading.

### Validation and runtime evidence

- `npm.cmd run validate` passed on the exact application state: typecheck, warning-free lint, 36 of 36 integration tests, 2,802 passing repository tests with 11 intentional skips and zero failures, all 152 migrations, customer-plan PDF audit, Vinext production build, Sites bundle audit and public-performance audit.
- Sites stored 44,410,880 bytes across 477 files with the package content hash above. The local release archive was 12,132,250 bytes with SHA-256 `6B7B7FD0D5FEE265ACE4CB0EE26A636BB57349EBF599BBAE7A67A6D4419736A8`.
- Live desktop QA confirmed the home heading and optimised image remain visible after 20 seconds with opacity 1, zero canvases, zero obsolete overlay nodes and zero infinite animations.
- Live 390 by 844 phone QA confirmed no horizontal overflow on the homepage, planner, electricity comparison, gas comparison, rebate calculator and dedicated Surge route.
- Live ordinary-route QA confirmed the full Surge panel is absent before an explicit action and then opens as the accessible `Ask Surge AI` dialog.
- The custom domain and Sites deployment both report version 370 with hosted environment revision 24.

### Boundaries

- No planner answer, assistant knowledge, API, authentication, database, migration, calculation, trade workflow or customer-data contract changed.
- The global stylesheet remains a shared 727,763-byte built asset and is the next structural performance opportunity; this release removed the measured public-path effects without attempting a risky repository-wide stylesheet split.
- No real lead, email, trade record or customer record was created during live verification.
- The hosted product remains pre-launch until the product owner explicitly declares it live.

## Previous production release: canonical Surge AI planner and optional enquiry workflow

Application source `731b4fad33169d6ed952f4f521f39d7a35b669e6` on branch `codex/job-schedule-week-calendar` is the exact executable source deployed as public Sites version 369 at `https://compare.ausenergyassessments.com`.

| Release evidence | Exact identity |
| --- | --- |
| Application commit | `731b4fad33169d6ed952f4f521f39d7a35b669e6` |
| Sites project | `appgprj_6a550c378000819185caf094173422bb` |
| Saved version | `appgprj_6a550c378000819185caf094173422bb~appgver_7a79dd6eef688191af31bf26f4bed226` |
| Public version | Sites version 369 |
| Deployment | `appgdep_6a882210191481918f4cc973cc5f249e` with status `succeeded` |
| Hosted environment | Revision 24 |
| Package content hash | `sha256:0318528df5e975c0e1958cb12649fd5df44eb5e718c46fd07a8fa16c5ef9df19` |
| Custom domain | `https://compare.ausenergyassessments.com` |

### Released outcome

- Surge AI and the Home Energy Planner now consume one canonical question, option, draft, storage and plan-generation contract. The 38 planner questions are presented exactly once through 13 staged Surge sections.
- A fresh Surge profile contains no asserted material household facts. `Not sure` remains valid, and each of the 45 planner plus practical-context details is explicitly reviewed before it can influence guidance.
- The dedicated Surge workspace keeps the editable home context visible beside the conversation. It retains the existing 4K command-centre treatment, assistant mascot, responsive mobile stack and reduced-motion boundary.
- `Open my energy plan` writes the same versioned planner session envelope used by the planner and opens `/plan`; the resulting canonical plan and normalized public snapshot are identical to a planner-built result.
- Guidance and the private plan remain usable without contact details. Service help is a separate optional path with all sharing controls off until the customer actively selects and confirms them.
- Australian Energy Assessments follow-up submits only to `/api/energy-assistant/leads`. Matched-trade sharing submits only to the existing `/api/leads` public-plan workflow. The adapter fails closed rather than calling both paths.
- The matched-trade path reuses the existing customer plan email, internal relay, opportunity matching, trade notification, contact-release and Interested-to-CRM workflow. It sends no chat transcript, uploaded file, photo, NMI, bill data or customer-only private plan to a trade.
- Public copy states that Surge AI is provider-neutral and does not recommend a brand, product, supplier or installer. It describes one structured enquiry and direct dealings with an approved matched trade without claiming absolute impartiality or removing the routing service.
- Existing conversation correction precedence, safety routing, model cost controls, public output filtering and trade-only platform boundaries remain intact.

### Validation and runtime evidence

- `npm.cmd run validate` passed on the exact application source, including typecheck, lint, integration tests, the complete repository suite, fresh D1 migration through `0153`, the customer-plan PDF audit, the production build and the Sites server bundle audit.
- Focused canonical planner and downstream workflow checks passed 176 of 176. Core model, API, breadth and privacy checks passed 139 of 139. The final UI integration set passed 101 of 101, the workflow acceptance set passed 5 of 5 and the independent adversarial release set passed 133 of 133.
- The release package contains all 152 migrations. Sites stored 46,837,760 bytes across 470 files with the package content hash recorded above.
- The local release archive is 14,499,847 bytes with SHA-256 `843D55F9E8357BD034A64409500F820AB9E74CFE8A756318E360E6590110DE1C`.
- Live desktop QA at 1280 by 720 confirmed the canonical 13-step intake, 45-detail context rail, full header, 4K background and absence of upload controls.
- Live 390 by 844 phone QA confirmed no horizontal overflow, no composer or keyboard autofocus, the context rail stacks above the intake, and the removed compare and upload paths remain absent.
- A fresh isolated browser-origin run reviewed all 45 details across all 13 stages, retained zero guessed facts, completed the intake and opened the identical planner session.
- Optional-service QA confirmed two mutually exclusive destinations, unchecked sharing controls, disabled submission before consent, canonical quote preparation and no live lead submission.
- The custom domain and Sites deployment both report exact version 369 with hosted environment revision 24.

### Boundaries

- The home profile is customer-reported guidance context, not verified property evidence or a formal rating. Existing conversations are not blocked by the fresh-conversation intake.
- Planner context uses same-tab session storage by design. It is sent only when the customer asks Surge and is treated as untrusted customer-reported baseline data.
- Downstream email, matching, trade notification and CRM behavior is verified by tests in this release. Production QA deliberately did not create a lead, send an email or mutate CRM data.
- No migration was added by this release. Production remains pre-launch until the product owner explicitly declares it live.

## Identity

| Layer | Identity | Status |
| --- | --- | --- |
| Audited repository baseline | `ff3c8efe3d5e501286d8e83e28086d6d4590be27` on `codex/sites-custom-domain-migration` | Verified by the 21 July audit |
| ABN schema expansion source | `7ebcb1905d3c28245fbcfede55525e0cfee8df8a` on `codex/abn-schema-expand` | Validated, pushed to GitHub and Sites managed `main` |
| Reviewed-ABN application activation | `481401d98ef2c0b294252a4cabeebc74eba40a52` | Validated and pushed to GitHub |
| Reviewed-ABN merged release | `fb9c80fb73bf2a0b5d461ed2ecbfa28df6022c71` | Preserves expansion and activation ancestry; Sites version 201 |
| Free-access application and contract source | `698a5057cc384d43112e5ccff38a99effbb01fa8` | Validated, pushed to GitHub and Sites managed `main`; Sites version 202 |
| Pre-advisor repository and production baseline | `01a8d09022b086c771c938960efa8d9a333542d3` | Documentation-only child of the application source; pushed to GitHub and live as Sites version 203 |
| Pre-advisor Sites deployment | Sites version 203 at `https://compare.ausenergyassessments.com` | Historical pre-change production identity |
| Customer home advisor application source | `53e6cf96aff6f48e9e393a23c4eedbeba997eb39` | Validated on the exact clean commit and pushed to GitHub and Sites managed `main` |
| Customer home advisor production application | Sites version 204 from `53e6cf96aff6f48e9e393a23c4eedbeba997eb39` | Historical customer-home-advisor release |
| Pre-context documentation checkpoint | `0a82a992e162087eb5ac76b4227dee3a505eae5b` | Documentation-only child of the home-advisor application; pushed to GitHub and live as Sites version 205 before this milestone |
| Advisor context and admin stability application source | `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77` | Validated, pushed to GitHub and Sites managed `main`; first saved and deployed as Sites version 206 |
| Independent customer plan application source | `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e` | Validated, pushed to GitHub and Sites managed `main`; first saved and deployed as Sites version 208 |
| Customer plan evidence and history application source | `6540ee671e64dbfdf80592283a1954b2ff482355` | Validated, pushed to GitHub and Sites managed `main`; first saved and deployed as Sites version 210 |
| Professional review, print and comfort application source | `ee75aadfd6800c01b92532b2d376a4a1e33c9d74` | Validated, pushed to GitHub and Sites managed `main`; first saved and deployed as Sites version 212 |
| Direct customer-plan PDF application source | `d5c675a5ceffa6e924df033e8cb8b505bb4d6336` | Validated, pushed to GitHub and Sites managed `main`; first saved and deployed as Sites version 214 |
| Browser-native customer PDF application source | `8cdec99bcd2d1cb9f2ec0dc18c87a71860412642` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 216 |
| Premium customer plan report application source | `fb6cacf8b0309a3fc26b40a43da5b025050d22d2` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 218 |
| Premium report documentation checkpoint | `a92e18b9ea79b53eaf6eda8665f37ec02c861972` | Historical documentation-only child of the version 218 application; published as Sites version 219 without changing the executable report source |
| Technical customer-plan presentation application source | `f401575a5bf463b85c7688424db0b99dddd220c5` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 220 |
| Customer-plan spacing and rounded-surface application source | `e74c2d95889a381cb3bb434607bc6584e54cf722` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 222 |
| Spacing release documentation checkpoint | `c2599eb5bedb11b1648da2b4a60e11b242cb2abb` | Historical documentation-only child of the version 222 application; published as Sites version 223 without changing the executable source |
| Customer-plan trust, evidence and revision application source | `bc427d295b3106907904a3c0b7bf9f2945561cd1` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 224 |
| Trust release documentation checkpoint | `23594c2b61dec855aeba0a10ba5a28eb3aeaf692` | Historical documentation-only child of executable Sites version 224 from `bc427d295b3106907904a3c0b7bf9f2945561cd1`; published as Sites version 225 without changing the executable source |
| Customer project cleanup application source | `9ecde96f8975f322be35283747cb7fe93b2579f9` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as intermediate Sites version 226 |
| Project-control readability application source | `da35ce60295d6c7150cddd9b35e33fcf64c8521b` | Validated after live visual QA, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 227 |
| Customer roadmap context application source | `0db488f325a79e22d126aace75647715b59c96f9` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 229 |
| Customer installer-request application source | `2607cc53f2e4c79546701e29d3d182fde4670952` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 230 |
| Customer installer-request saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_52a74079cae481918a86072452749e99` | Historical exact saved version 230 built from `2607cc53f2e4c79546701e29d3d182fde4670952` |
| Customer plan durability implementation source | `e74278c8b62c569541ea84b5a431917d03a1c13a` | Validated and pushed; saved as Sites version 231, whose deployment failed before public activation |
| Failed non-live saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_7a589f567528819189cf033456193bda` | Deployment `appgdep_6a6bcf5c0f7c8191b877d27581f9d82e` failed with `__dirname is not defined`; version 231 never became public and version 230 remained live |
| Customer plan durability worker-safe application source | `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 232 |
| Customer plan durability saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8` | Historical exact saved version 232 built from `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` |
| Customer plan durability documentation checkpoint | `2c55430757c316b4045e3edd9a26263a24793f14` | Documentation-only child of the version 232 application; historical and not executable |
| Installer-request and multi-photo application source | `5acc4ccf37acd608dc437d3a074410b1d840f706` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 233 |
| Authoritative installer-submit application source | `7d7a821123d9b70cace08ac632d58ca1d3851b1b` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 234 |
| Installer enquiry-pack and business-notification application source | `eeba3679c30789cfe2e633a913a18492270fcc3e` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 235 |
| Complete customer-installer handoff application source | `059f2ff8d3885b3453dd38d7dee8e660fd05c4fb` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 236 |
| Quote-communications documentation-only saved checkpoint | `40b4396b9ef41166a61ee346b023c00bcc9df11b` | Saved as Sites version 237 with identity `appgprj_6a550c378000819185caf094173422bb~appgver_a2882f3eb264819199cedf74de7add75`; never deployed, so version 236 stayed public until version 238 |
| Customer quote communications application source | `35552796048df63c03409d03401d33a47f326434` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 238 |
| Customer-to-trade contact workflow application source | `97e6c7356483706e8e978ab53b842a9e41152f7e` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 239 |
| Customer-to-trade contact saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_ae43b05060ac8191918c70e9960e213c` | Historical exact saved version 239 built from `97e6c7356483706e8e978ab53b842a9e41152f7e` |
| Customer-to-trade contact deployment | Sites version 239 from `97e6c7356483706e8e978ab53b842a9e41152f7e` at `https://compare.ausenergyassessments.com` | Historical deployment `appgdep_6a6c7cb6d6e0819187e9566a452e6850`; environment revision 19 |
| Customer-plan trade-enquiry application source | `b40c101939eec44b178b34ccb6397a989d2467d0` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 240 |
| Customer-plan trade-enquiry saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_f26581d5ff348191855551ce325e8c40` | Historical exact saved version 240 built from `b40c101939eec44b178b34ccb6397a989d2467d0` |
| Customer account trust application source | `da4fa911c0b6c7f520e266259af8882b95aaf14a` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 241 |
| Customer account trust saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_2149679b0df08191a77cd91ac13d9cc7` | Historical exact saved version 241 built from `da4fa911c0b6c7f520e266259af8882b95aaf14a` |
| Protected trade locality and reciprocal navigation application source | `399b04f4a5d680080610f9e88b994506bb60c16f` | Historical exact application source saved and deployed as Sites version 242 |
| Creditex compliance operations foundation application source | `2ef8ce19fd5423fd95652a7bc88265e80d7b827f` | Historical empty foundation; validated, pushed to GitHub and Sites managed `main`, then saved and deployed as Sites version 246 |
| Creditex foundation saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_3cef6ddd92e88191a54d034d3a6e72e3` | Exact historical saved version 246 from `2ef8ce19fd5423fd95652a7bc88265e80d7b827f`; package content hash `sha256:9d6ac6f6e5a3036ba8fedf14c94b0fdc61e608b32b203346fc327a8119f625ea` |
| Creditex foundation deployment | Sites version 246 from `2ef8ce19fd5423fd95652a7bc88265e80d7b827f` | Historical deployment `appgdep_6a6d5c42819081919d81dcd9451338bd`; environment revision 19 |
| Intermediate Creditex portal application source | `24a47a9f76b0bd5c390aab65b41b4e7a961db885` | Saved and deployed as Sites version 247; sign-in recovery worked, but live QA found the first operations aggregate was not accepted by production D1, so version 247 was superseded before release completion |
| Creditex operations portal application source | `7b08cb600bde30273774a544e07039acc6de1c03` | Historical exact validated source containing the activity-agnostic portal, assignment-scoped security corrections and D1-compatible aggregates; saved and deployed as Sites version 248 |
| Creditex operations portal saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_1b287ac469e88191aca7160bfa41c32c` | Historical exact saved version 248 built from `7b08cb600bde30273774a544e07039acc6de1c03`; package content hash `sha256:1928ee707d2076db876b6aa40e58219ae5e96273f8ee1ece08cfe74144cd2aac` |
| Creditex operations portal executable identity | Sites version 248 from `7b08cb600bde30273774a544e07039acc6de1c03` at `https://compare.ausenergyassessments.com` | Historical deployment `appgdep_6a6d733ea23c81918f4ccd8e4f30f98b`; environment revision 19 |
| Creditex evidence-policy governance application source | `d40c803bfa0b614ed806624a375a1fa47bd0e5a4` | Historical exact validated source for `CREDITEX-EVIDENCE-POLICY-GOVERNANCE-26`; saved and deployed as Sites version 249 |
| Creditex government-activity workflow application source | `a33b7053301a64bea4bbcbe76713067a2c1782dd` | Historical exact validated source for `CREDITEX-GOVERNMENT-ACTIVITY-WORKFLOW-27`; saved and deployed as Sites version 251 |
| Creditex government-activity workflow saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_a8b4368a16a88191be90ea1a3ce33481` | Historical exact saved Sites version 251 built from `a33b7053301a64bea4bbcbe76713067a2c1782dd`; package content hash `sha256:917cf16e38b0a69e2081992a8f2944699bf9492b78f40c8ce4745b55612bf285` |
| Creditex government-activity workflow executable identity | Sites version 251 from `a33b7053301a64bea4bbcbe76713067a2c1782dd` at `https://compare.ausenergyassessments.com/creditex/compliance` | Historical deployment `appgdep_6a6dbc598f0c81918d1e6656addd0463`; environment revision 19 |
| Initial Creditex VEU synthetic pilot application source | `3ac6c72057a8afea61e85817ba566ec543079886` | Historical exact source first deployed as Sites version 252 for `CREDITEX-VEU-SYNTHETIC-PILOT-28` |
| Authentication-corrected Creditex VEU pilot application source | `ebae330dab6c42881c14bc57548095b111d9c850` | Historical Sites version 253 from `ebae330dab6c42881c14bc57548095b111d9c850`; retains the pilot and corrects authentication recovery |
| Creditex VEU dense-register application source | `e8d12a4b562de3f9ac5b6821c4e1b062547722e0` | Historical exact validated source deployed as Sites version 254 |
| Creditex VEU operator-workspace implementation | `e0e48b6a74a0515fe936f4882bead071b7bee443` | Historical exact source deployed as intermediate Sites version 255 |
| Creditex VEU operator-workspace focus correction | `c6fdbc42729adf1b2f5e9bca6822c298885a55d4` | Historical exact source deployed as intermediate Sites version 256 |
| Creditex VEU operator-workspace application source | `1a535a0fd2237e8aa3dcf1daf82da009885197b0` | Historical exact validated application source with the production D1 projection correction; deployed as Sites version 257 |
| Creditex VEU operator-usability primary application source | `96ecb9698943445c57ba7f4caec99ff3839d3499` | Historical exact validated source saved as `appgprj_6a550c378000819185caf094173422bb~appgver_0187352d1e188191bb078c01d172a82b` and deployed as intermediate Sites version 258 through `appgdep_6a6e507b745881919113bda7403f8081` |
| Creditex VEU operator-usability application source | `19a1e0b98db0cb7be5eae9e9e1371251220e8fc1` | Historical exact validated application source with the compact drawer-heading correction; deployed as Sites version 259 |
| Creditex controlled-intake primary application source | `c423f3c3938b43bf92c8ec98d285b49e63024ee6` | Exact validated source for the dark register, Dataforce interchange and controlled intake foundations; saved and technically deployed as Sites version 260 |
| Operationally blocked Sites version 260 | `appgprj_6a550c378000819185caf094173422bb~appgver_8457f041be2881918ab5a196250df5a2` | Built from `c423f3c3938b43bf92c8ec98d285b49e63024ee6`; 180 files; 18,974,720 bytes; content hash `sha256:5dcedf66b4487104960462095e41850fac28a83f49ae9065c0e37f91467a7759`; deployment `appgdep_6a6eb18712108191ab4ebab327e75df7` succeeded but Creditex failed closed because migrations `0100` through `0105` were absent from the package |
| Corrective Creditex controlled-intake application source | `d441d41cad4d5299a882e73ea006a963fa360cf4` | Exact validated source that packages and audits all 106 migrations and preflights the new Creditex schema before trigger installation; pushed to GitHub and Sites managed `main` |
| Creditex governed-operations application source | `11b06b88d68609a9fcf254877a4afe379a95f8b3` | Historical exact validated source for stable dark navigation, global search, source and lookup approvals, physical custody, exact-decimal calculation and exact Dataforce parallel bindings; deployed as Sites version 262 |
| Historical Creditex governed-operations saved version | `appgprj_6a550c378000819185caf094173422bb~appgver_f2d304f9c9b481919b8d9588f0ef034f` | Exact Sites version 262 built from `11b06b88d68609a9fcf254877a4afe379a95f8b3`; 344 files; 30,412,800 bytes; content hash `sha256:60ede71e262e365ed8aa39fced47e8a550623266d6636ef8c326a821efdadb3c` |
| Primary Creditex exact-register and governed-authoring application source | `58b92e1f859c62de00e4d8bda11624ab3f1633b8` | Exact validated source for the 23-column Dataforce register, official VEU version dates, effective-dated lookup approval, legacy mapping authoring and draft-only calculator authoring; pushed to GitHub and Sites managed `main` |
| Failed non-live Sites version 263 | `appgprj_6a550c378000819185caf094173422bb~appgver_57b5288b2f00819197347262d9eb997f` | Saved from `58b92e1f859c62de00e4d8bda11624ab3f1633b8`; deployment `appgdep_6a6f0208b8208191ba75d01cd0b659d8` failed before activation with `incomplete input: SQLITE_ERROR`; Sites version 262 remained live and production did not change |
| Corrective Creditex exact-register and governed-authoring application source | `31b152933273db33bfa866bdbc491f6fdc35360a` | Exact validated correction that moves calculator trigger installation out of Sites migration parsing while preserving fail-closed schema guards; pushed to GitHub and Sites managed `main` |
| Historical Creditex exact-register saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_aa8d0183098881918f1fe626a7deb951` | Exact Sites version 264 built from `31b152933273db33bfa866bdbc491f6fdc35360a`; 346 files; 30,535,680 bytes; content hash `sha256:7add92fd081d36220e266666533ce162585bcf23531889182f7abbbd982a8ea2` |
| Historical Creditex exact-register executable identity | Sites version 264 from `31b152933273db33bfa866bdbc491f6fdc35360a` at `https://compare.ausenergyassessments.com/creditex/compliance` | Deployment `appgdep_6a6f09034b10819187e46054254b06b2` succeeded; environment revision 19; provider URL `https://aea-energy-comparison.info294029.chatgpt.site` |
| Creditex national-calculation foundations application source | `5eab88950c1047746484ce2ab4880d8e32be824a` | Exact validated source for 32 controlled Australian program pathways, 212 calculation-readiness records, deterministic SRES estimates and corrected Advanced search visual parity; pushed to GitHub and Sites managed `main` |
| Historical Creditex national-calculation saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_123d03e2e4b08191b196236068cca9b0` | Exact Sites version 265 built from `5eab88950c1047746484ce2ab4880d8e32be824a`; 346 files; 30,638,080 bytes; content hash `sha256:7ee3e873e71c98c648f2fba25ae6d0b83c30eb47b7a6a17bea2c422c14abd0dc` |
| Historical Creditex national-calculation executable identity | Sites version 265 from `5eab88950c1047746484ce2ab4880d8e32be824a` at `https://compare.ausenergyassessments.com/creditex/compliance` | Deployment `appgdep_6a6f2bac3b588191bb64b2b29c6e1b1b` succeeded; environment revision 19 |
| Creditex national manual-evidence lab application source | `ecec39abbc65fb5d25aa5d21d6dcfead724bcc0f` | Exact validated source for editable synthetic evidence forms and manual jobs across all 32 controlled program pathways and 212 controlled activity templates; pushed to GitHub and Sites managed `main` |
| Historical Creditex national manual-evidence saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_e42b1932db8481918304dad9fcf28bd2` | Exact Sites version 266 built from `ecec39abbc65fb5d25aa5d21d6dcfead724bcc0f`; 347 files; 30,883,840 bytes; content hash `sha256:ac05eacd1792bacdb6b5ef4e0dae86149f8cb484678401061e86ca96ddce69cd` |
| Primary Creditex governed manual-field preflight application source | `8c29808a9f4a80acc8e7f2304c4b49268f4f2c49` | Exact validated source for manual field custody, government-minimum composition, unified synthetic register, calculation coverage and blocked interchange descriptors; pushed to GitHub and Sites managed `main` |
| Superseded live Sites version 267 | `appgprj_6a550c378000819185caf094173422bb~appgver_87785290f1008191bbff3b539d3b05e5` | Built from `8c29808a9f4a80acc8e7f2304c4b49268f4f2c49`; deployment `appgdep_6a6f9ddd353c8191ad122f23d86d7fcf` succeeded, but signed-in QA found the read-only compound facet query was not accepted by production D1, so it was corrected and superseded before handoff |
| Historical Creditex governed manual-field source | `5d4b540dcbcb49b3d1d57eda122a4dca86d723bb` | Exact validated D1-compatible source deployed as Sites version 268 |
| Shared navigation discovery source | `37776ed557d7c0a25d92698f52e87cf59cee05b6` | Exact validated source for visible compare navigation origin and compact overflow discovery; deployed as Sites version 269 |
| Historical shared-navigation saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_ea8944a8b6d08191bf7b8fd3237619c4` | Exact Sites version 269 built from `37776ed557d7c0a25d92698f52e87cf59cee05b6`; 351 files; 31,303,680 bytes; content hash `sha256:bdd4fb3fe2ccad379fe6afc94f5ae92470213388ba2f9c236708b8cffbab0aed` |
| Historical Creditex governed-source application source | `8baad519d763f0955e481a925ca9114b4d708653` | Exact validated source for governed official-source custody, retained-byte access and draft-only independent review; deployed as Sites version 270 |
| Historical installer-to-Creditex job-handoff application source | `a45f250ee805aac1545c8643726dfde3964de22b` | Exact validated source for guided installer job creation, immutable compliance intent, accepted-quote case linking and the initial Creditex planned-work audit queue; deployed as Sites version 271 |
| Primary installer-to-Creditex operating-alignment source | `836bc779f33a5f77fc4a18a41227dc76dfbf9914` | Exact validated primary source for clickable job stages, address provenance, detail-rich review, optional quote linkage and the installer Dataforce register; deployed as Sites version 272, then superseded when signed-in QA found the installer Jobs index failed |
| Superseded operating-alignment saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_b4c31e72b728819184de2e54a102dfec` | Sites version 272 from `836bc779f33a5f77fc4a18a41227dc76dfbf9914`; 359 files; 31,580,160 bytes; content hash `sha256:62841c6571135be4d987c7bcc4d7e36be4b91bdbdde5435092826bd4c722f762`; superseded during live QA |
| Installer-register corrective application source | `c32be214558dd1a20ccb26d04bcf7b054b00f110` | Restored the production installer Jobs index without weakening company scope; deployed as Sites version 273, then superseded when signed-in Creditex QA exposed a schema-invalid and over-broad full-audit projection |
| Superseded installer-register saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_18bbab7ef36c8191a958c7512e3b02b0` | Sites version 273 from `c32be214558dd1a20ccb26d04bcf7b054b00f110`; 359 files; 31,580,160 bytes; content hash `sha256:7de1f8dbe50e1870b797ee11418b577f4307a10c4dcb8cf9c6cc8f41d7a2ad7f`; deployment `appgdep_6a70797ba4308191b7701e2a05ff8e97` was superseded |
| Historical Creditex application source | `c51934456c2248da4cfde9a0b759b70d69df56ee` | Exact validated production-schema source for the company-scoped installer register and bounded Creditex full-audit workspace; deployed as Sites version 274 |
| Historical Sites version 274 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_02f3ce1e33ec8191919abea0bc24f6ac` | Built from `c51934456c2248da4cfde9a0b759b70d69df56ee`; 359 files; 31,590,400 bytes; content hash `sha256:455c203ec7dfe5c21c5559453b33e4e7f1b92910412d9cd4130ac903ccb2aeb7`; deployment `appgdep_6a7082f95d2881919e97336aa038fc5a` |
| Multi-activity usability implementation source | `103439d03a5c322757cea27e77e8b147b6c85590` | Exact validated primary source for atomic multi-activity jobs, mandatory new-customer contacts, viewport-safe scheduling, installer register usability, customer filters and schedule quote actions |
| CRM production-diagnostic source | `ce0996779818690751016dfd5b3efdd8e7c1586e` | Added a privacy-safe diagnostic boundary for the separate production CRM schema-guard failure |
| CRM schema-guard correction source | `82e0faf64906047a5f42fabf83c605edf320cb63` | Corrected that CRM guard after production inspection proved the required schema was present |
| Superseded Sites version 277 | `appgprj_6a550c378000819185caf094173422bb~appgver_3037473e40d88191817b148c76b46504` | Built from `82e0faf64906047a5f42fabf83c605edf320cb63`; deployment `appgdep_6a716eaea7a481919682286140434b24`; signed-in QA still found the customer asset workspace failed |
| Asset-query diagnostic source | `eeb636665a21d230b7150e03d60f614b7f71b1db` | Isolated the remaining production failure to the asset timeline read without exposing SQL or private identifiers |
| Superseded Sites version 278 | `appgprj_6a550c378000819185caf094173422bb~appgver_1825408c19508191a3f8fc69e969d7ac` | Built from `eeb636665a21d230b7150e03d60f614b7f71b1db`; deployment `appgdep_6a7172b2ed008191b9460a81e8296993`; request `a25b0663ff18f2c1` confirmed the seven-arm timeline compound query remained incompatible with production D1 |
| Historical multi-activity application source | `13dbf2ddc4eea32c6a929ef15cb258a263ff99ea` | Exact validated final source with the D1-compatible seven-statement asset timeline batch; deployed as Sites version 279 |
| Historical Sites version 279 archive | `.openai/site-release-13dbf2d.tar.gz` | 7,781,979 bytes; SHA-256 `D6AC82425EC5EE82B84318978177D49F0E41E54DF755094FEC935F7549FDAA67`; 374 entries, all 120 migrations and zero CSV entries |
| Historical Sites version 279 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_e113332d3dac8191bff9ed71b5d51487` | Built from `13dbf2ddc4eea32c6a929ef15cb258a263ff99ea`; 360 stored files; 31,682,560 stored bytes; content hash `sha256:1630c642f67fb83d38fd428197e05e4ae32e4bad97c29eb111d6c090760d7dc3`; deployment `appgdep_6a7178bb43c08191b86b568dabd45b94` |
| Historical business-identity and quote-delivery application source | `fcfca482b0f86413423af2af8c5ae77054e6186f` | Exact validated source for milestone 43 and historical Sites version 280 |
| Historical Sites version 280 archive | `.openai/site-release-fcfca48.tar.gz` | 7,833,168 bytes; SHA-256 `806E919D9144B30A162C051660444F82F7BEAFE542EEBEB954C742675161139B`; 375 entries, all 121 migrations and zero CSV entries |
| Historical Sites version 280 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_a6468ced690881919d2e29c591fd11f3` | Built from `fcfca482b0f86413423af2af8c5ae77054e6186f`; 361 stored files; 31,856,640 stored bytes; content hash `sha256:cf01b5bdf49058a7b12e7177e864c08a17af1203dc23f1e4b22a10ce5d7dcc2c`; deployment `appgdep_6a71bf0136dc81918e71ba815cddd0ff` |
| Primary trade-workspace recovery source | `b7e40751e2556ffc64e37704c641a6e917046bb6` | Restored the milestone-44 TLink workspace and quote-delivery flows; retained in the ancestry of the current executable source |
| Superseded Sites version 281 | `appgprj_6a550c378000819185caf094173422bb~appgver_4f2d58013ec08191bb6c605a58b958b3` | Built from `b7e40751e2556ffc64e37704c641a6e917046bb6` and deployed through `appgdep_6a71e1807efc819192c7a71ecd6db9d0`; superseded during release QA after the inherited filesystem-dependent legacy electricity fallback returned HTTP 500 |
| Historical trade-workspace delivery-recovery application source | `9c278bb23f3f5eb9c3878c5a4cfc946264f1a29c` | Exact validated milestone-44 source containing `b7e40751e2556ffc64e37704c641a6e917046bb6` plus the worker-safe legacy fallback correction; historical Sites version 282 |
| Historical Sites version 282 release archive | `.openai/site-release-9c278bb.tar.gz` | 7,829,193 bytes; SHA-256 `EC1B166DD9957DA17C4F889E4802C349A76A71454627769D12B5BFD5A1E503E2`; 375 entries, all 121 migrations and zero CSV entries |
| Historical Sites version 282 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_fd653b2ad83c81918fd23a3366735271` | Exact Sites version 282 built from `9c278bb23f3f5eb9c3878c5a4cfc946264f1a29c`; 361 stored files; 31,907,840 stored bytes; content hash `sha256:86f36c8d918da0ae1b634db811ed645a27d4a50a1a35acc0eba79d5e20488d96`; deployment `appgdep_6a71e7f3af3c81918f0f89a3e0354d36` |
| Historical trade document controls and Jobs application source | `bfd472359dd8ec2457379bc3694dc3c9503ac7dd` | Exact validated milestone-45 source; deployed as historical Sites version 283 |
| Historical Sites version 283 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_435abd4eabd081918c58fd7adbbb49ae` | Exact Sites version 283 built from `bfd472359dd8ec2457379bc3694dc3c9503ac7dd`; 364 stored files; 31,682,560 stored bytes; content hash `sha256:e3da2fb4a4e4b342a0825a145d8ee3dd2124002123d04c28de753e6767b734c7` |
| Historical Sites version 283 executable identity | Sites version 283 from `bfd472359dd8ec2457379bc3694dc3c9503ac7dd` | Deployment `appgdep_6a7221a403808191a44c354d51922058` succeeded; environment revision 19 |
| VEU registry foundation application source | `1d77ab222638d3d43d9a49cac0b486173ce88e18` on `codex/sites-custom-domain-migration` | Exact committed source for the guarded VEU Public Registry importer and indexed product projection; deployed as historical Sites version 293 |
| Historical Sites version 293 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_3ea0067666848191816b9e9b51293599` | Exact Sites version 293 built from `1d77ab222638d3d43d9a49cac0b486173ce88e18`; deployment `appgdep_6a77783225d08191b4fcf8cf98888f06` succeeded with environment revision 19 |
| Complete VEU calculator application source | `d192d46b4e2056114251ec7cb0e3cfca3b5ea5d9` | Exact committed and deployed source for the complete governed VEU formula set and shared administrator and verified-installer calculator |
| Historical Sites version 294 executable identity | Sites version 294 from `d192d46b4e2056114251ec7cb0e3cfca3b5ea5d9` | Deployment `appgdep_6a77aa33d1288191965ba076f690dd46` succeeded before the bounded-refresh correction superseded it |
| Historical VEU bounded-refresh application source | `ad63b90a4e99211998aa1947b7ddd61d5ac1f640` on `codex/sites-custom-domain-migration` | Exact validated corrective source that preserves unchanged effective dates and retains only changed history deltas; deployed as historical Sites version 295 |
| Historical Sites version 295 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_eb2ea4c9ff00819184c55ca709f53ffd` | Exact Sites version 295 built from `ad63b90a4e99211998aa1947b7ddd61d5ac1f640`; content hash `sha256:30d481f24fdcb86d0db94321314fa6d044c37e591a72a47ff6ec09b2885b2563`; deployment `appgdep_6a77b30bab008191bd61b6476525b4f2` |
| Historical guided calculator and PDRS licensed-runtime source | `1d3abe172e4eb2fa006fab639233cda49a6d37d4` on `codex/sites-custom-domain-migration` | Exact validated source for the shared guided flow, server-side central CEC credential boundary, PDRS definitions and licensed snapshot runtime; deployed as Sites version 296 |
| Historical Sites version 296 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_5e6a96b498d481919a0d8816407d8134` | Exact Sites version 296 built from `1d3abe172e4eb2fa006fab639233cda49a6d37d4`; content hash `sha256:ebac21093161618b5e086d4e558582c07ce22db304346927255da5348c1c8186`; deployment `appgdep_6a77dec8694081918aa42f65c1442326` succeeded with environment revision 19 |
| Historical simplified quote-calculator source | `11f4721b678425a4294e95c631e0d37d3fab0ffd` on `codex/sites-custom-domain-migration` | Exact source for historical Sites version 297 and its short estimate-only quote flow |
| Historical Sites version 297 archive identity | Removed locally after Sites accepted the package and recorded custody | 8,158,365 bytes; SHA-256 `FCB2FA3E954FA758EB069C70B76A712C1FC23FEC0EC432380EBD3B58D8646563` |
| Historical Sites version 297 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_f6c71f20596c8191a59a1ee2c23045df` | Exact Sites version 297 built from `11f4721b678425a4294e95c631e0d37d3fab0ffd`; 378 stored files; 33,105,920 stored bytes; content hash `sha256:03f919b3ec2902590c8079a1d6edf9d725e6163bb515ec6b761be3ed12b099c5`; deployment `appgdep_6a781d231ee08191a7d506389be1676b` |
| Historical initial calculator usability and product-authority source | `c9fb34115209c0ea0a1fc02ee2095250458c256f` on `codex/sites-custom-domain-migration` | Initial executable source for milestone `AEA-CALCULATOR-USABILITY-AUTHORITY-48`; historical Sites version 298 |
| Historical Sites version 298 archive identity | `.openai/site-release-c9fb341.tar.gz` | 8,173,001 bytes; SHA-256 `ffb841f9a08e69c9697047a3d4fdfffcf1e1cb5f0539cc49a8ec8b42a5d419fd` |
| Historical Sites version 298 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_acf528bb50208191b6bcd0948190172c` | Exact Sites version 298 built from `c9fb34115209c0ea0a1fc02ee2095250458c256f`; content hash `sha256:ac6bd787b8bb9fd71e44e7d0c23368a528c26dba3eb328c0708f3989b5471c86`; deployment `appgdep_6a786857458c8191ae557d2c2f0f2694` succeeded with environment revision 19 |
| Historical calculator usability and product-authority application source | `ca3d84a497258426c7ab34c87e8059df1cba2a27` on `codex/sites-custom-domain-migration` | Exact executable source for historical Sites version 300 and TESSA-first governed refresh ordering |
| Historical Sites version 300 release archive identity | `.openai/site-release-ca3d84a.tar.gz` | 8,175,111 bytes; SHA-256 `a2df1764b0850d46f8088ddd8fe6e8c422d6072f9560df08d43fdba81f82a79a`; 398 entries; all 126 migrations |
| Historical Sites version 300 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_e084d0c2568c81918bdcf23adc78ad5e` | Exact Sites version 300 built from `ca3d84a497258426c7ab34c87e8059df1cba2a27`; 384 files; 33,607,680 bytes; content hash `sha256:29ca942f7801e5657cff10f4dd2e1e5dde14fc9386f19fb51f6691703c58db73`; deployment `appgdep_6a7875602838819182dc5ba7dec6366b` succeeded with environment revision 19 |
| Historical immersive customer journey application source | `bc4096d61cb493e819555d72113d0c77d45a1653` on `codex/sites-custom-domain-migration` | Exact executable source for milestone `AEA-IMMERSIVE-CUSTOMER-JOURNEY-49`; historical Sites version 301 |
| Historical Sites version 301 release archive identity | `.openai/site-release-bc4096d.tar.gz` | 9,823,592 compressed bytes; SHA-256 `5ae1990b73dd2fd54bebfc5182b8a1616fc0a51afd925ecd09cfd726eebc01a3`; 399 tar entries; 385 files; all 126 migrations |
| Historical Sites version 301 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_57a5cb197f548191a5ef29ab9c99f59e` | Exact Sites version 301 built from `bc4096d61cb493e819555d72113d0c77d45a1653`; 385 files; 35,328,000 bytes; content hash `sha256:3bbab6b63c31708d6b9ded69b50da11e31d45ff75557d82823d3b12fc4a02e3b`; deployment `appgdep_6a7898485dd48191acb31466092b5fe8` succeeded with environment revision 19 |
| Historical immersive plan action handoff application source | `f797ab7ee447bc31d66b5760f6613e46f107e97d` on `codex/sites-custom-domain-migration` | Exact executable source for milestone `AEA-IMMERSIVE-PLAN-ACTION-HANDOFF-50`; historical Sites version 302 |
| Historical Sites version 302 release archive identity | `.openai/site-release-f797ab7.tar.gz` | 11,484,967 compressed bytes; SHA-256 `291686F6352979EBE7C9E342BFB20BF67FBE0D3796BB68A6B3A530391333AFD2`; 402 tar entries; all 126 migrations |
| Historical Sites version 302 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_33c4dd63992481919b3d760cee8831fd` | Exact Sites version 302 built from `f797ab7ee447bc31d66b5760f6613e46f107e97d`; 388 files; 37,048,320 bytes; content hash `sha256:1e2af6133642887179c6887212801973a49006bf9a4f76a3f98d9eb3daf06300`; deployment `appgdep_6a790aefc05c8191b4a03f72181f7031` succeeded with environment revision 19 |
| Historical initial personalised plan and open trade lead application source | `59ea305f9a45d1e4c22b354af2e211d22fe11358` on `codex/sites-custom-domain-migration` | Exact executable source for historical Sites version 303 |
| Historical Sites version 303 release archive identity | `.openai/site-release-59ea305.tar.gz` | 11,501,890 bytes; SHA-256 `8fd77af8de6264dc3b8ea662851d3f4451c0315aa188b756a3e8380984c02a11`; 405 tar entries; ignored release staging was removed after its release record was committed |
| Historical Sites version 303 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_83ae907840f48191844403ab5575a1d9` | Exact Sites version 303 built from `59ea305f9a45d1e4c22b354af2e211d22fe11358`; 391 files; 37,160,960 bytes; content hash `sha256:65b5aa69eb0d4087d9cd3fb0b56fb0febdfb9972cd78b50c5f25cc9f5a680e32`; deployment `appgdep_6a7955e575008191b9cd07b1beff2df9` succeeded with environment revision 20 |
| Personalised plan repair and selective trade-sharing application source | `a0fcbf200ece76f68bbd83c298f1d556333c615e` on `codex/sites-custom-domain-migration` | Milestone implementation source; intermediate Sites version 304 exposed a production-only PDF-font fetch stall |
| Historical customer-plan PDF-font corrective source | `79f7e2e5be14464410ba40a749453c7473b22d4d` on `codex/sites-custom-domain-migration` | Exact executable source for historical Sites version 305 and milestone `AEA-PERSONALISED-PLAN-OPEN-TRADE-LEADS-51` |
| Historical Sites version 305 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_248c3d6df9448191b171e990ac8dfdd1` | Exact Sites version 305 built from `79f7e2e5be14464410ba40a749453c7473b22d4d`; 391 files; 37,201,920 bytes; content hash `sha256:e2869ae853c4e927c32799128bb83133c7a3d1974effd60ed23baacec5ae6976`; deployment `appgdep_6a797f25df8c819187590b70811a6794` |
| Historical complete guided journey application source | `c75ff7bb4355f2f74bc9996527900c3d515ab85e` on `codex/sites-custom-domain-migration` | Exact source for historical Sites version 306; superseded by the v307 mobile-header hotfix |
| Historical Sites version 306 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_60682607e5148191aa5351d3716bd9df` | Exact Sites version 306 built from `c75ff7bb4355f2f74bc9996527900c3d515ab85e`; 391 files; 37,744,640 bytes; content hash `sha256:61319a3fa5e852f5f8c9edbe8fe94a1508e612147a5252907d477e9da5084fd8`; deployment `appgdep_6a79aa88b3088191af653a395a2501a1` succeeded with environment revision 20 |
| Historical complete guided journey application source | `6df3fab3c9eaca55445cf1c3f16e58b276aae6fd` on `codex/sites-custom-domain-migration` | Exact executable source for historical Sites version 307 and milestone `AEA-COMPLETE-GUIDED-HOME-ENERGY-JOURNEY-52`; superseded by version 308 |
| Historical Sites version 307 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_cd22401f7e1c819197951851476ec4d8` | Exact Sites version 307 built from `6df3fab3c9eaca55445cf1c3f16e58b276aae6fd`; 391 files; 37,744,640 bytes; content hash `sha256:77467b54e8262afe476a5f57460b15da11d5b5b6b286e9d54bbdfeda74c69806`; deployment `appgdep_6a79b1799b988191a1ac6ac58888e134` |
| Historical structured customer enquiry gateway application source | `ad972cf2f61aeb59f2021f56b3c908ddb3ace0a0` on `codex/sites-custom-domain-migration` | Exact executable source for historical Sites version 308 and milestone `AEA-STRUCTURED-CUSTOMER-ENQUIRY-GATEWAY-53` |
| Historical Sites version 308 release package | Local package supplied to Sites | 392 entries; 11,903,586 bytes; SHA-256 `f9ce016769722f6b47d17107ec2d3d1ab0670a8afea3007a3ec5d0e117a859c8`; all 128 migrations through additive `0127_public_trade_lead_customer_address.sql` |
| Historical Sites version 308 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_d5eaf4c6b458819187a105747dfc6075` | Exact Sites version 308 built from `ad972cf2f61aeb59f2021f56b3c908ddb3ace0a0`; 392 files; 38,696,960 bytes; content hash `sha256:881c057c42808490cc7d354c6c0e8a349a17fcb774e201d5cd302f9c7ed19e57`; deployment `appgdep_6a79e3700444819191ac709f0bd509c6` |
| Historical governed-source and lead-delivery application source | `30ebbf2d7b4ac03f00cdc6632786e7a12535c92a` on `codex/sites-custom-domain-migration` | Exact predecessor application source for historical Sites version 309; superseded by the VEU registry and water-heater correction |
| Historical VEU registry, rounding and water-heater limits application source | `481cb3970ffd0efe498c9fbf7c9ba5f6a7e945c7` on `codex/sites-custom-domain-migration` | Exact executable source pushed to the GitHub working branch and Sites internal `main` for milestone `CREDITEX-VEU-REGISTRY-ROUNDING-LIMITS-54` |
| Historical Sites version 310 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_328bc0ff50648191abfb6cd0b6aafed8` | Exact Sites version 310 built from `481cb3970ffd0efe498c9fbf7c9ba5f6a7e945c7`; 392 files; 38,727,680 bytes; content hash `sha256:c238b3125d74473df101491648c78308402fcbefc846d8ea72f95006a81864f3`; all 128 migrations |
| Historical Sites version 310 executable identity | Sites version 310 from `481cb3970ffd0efe498c9fbf7c9ba5f6a7e945c7` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7a78c959908191a2fbd39fc247dfc2` succeeded; environment revision 20 |
| Historical practical-plan and guaranteed-trade-email source | `ceac4486531995a11a566d224b6638c0678fb3d4` on `codex/sites-custom-domain-migration` | Initial executable source for milestone `AEA-PRACTICAL-PLAN-TRADE-EMAIL-QUOTE-PREP-55`; saved as Sites version 311 |
| Historical Sites version 311 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_59994c1e46e88191b01a512cbf0e1561` | Exact Sites version 311 built from `ceac4486531995a11a566d224b6638c0678fb3d4`; 393 files; 38,963,200 bytes; content hash `sha256:8e92e79fcf36f499aa58beab765420a8483a99a0b47412e9a2c222938bd0d832`; its deployment identity was not retained in this handover |
| Historical legacy-consent email-recovery source | `33e9c3e11cf933ea4e752f21781f66f6ec8c2c37` on `codex/sites-custom-domain-migration` | Exact compatibility hotfix for stored public-plan contact releases; saved and deployed as Sites version 312 |
| Historical Sites version 312 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_922f83ef18c881918992e00a6d98df96` | Exact Sites version 312 built from `33e9c3e11cf933ea4e752f21781f66f6ec8c2c37`; 393 files; 38,973,440 bytes; content hash `sha256:4f5d93415f0fca83b6efb4067f79c3052f0fcf421fc43f49fb5fdb1a7bbb2fbc`; deployment `appgdep_6a7b13c66a6c819184d327dfda5cfcfc` succeeded with environment revision 20 |
| Historical practical-plan and trade-email application source | `bf26fb818773ba3405da9aadae247427426da1bb` on `codex/sites-custom-domain-migration` | Exact D1-compatible consent-claim correction and executable source for historical Sites version 313 |
| Historical Sites version 313 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_d35174fb4bb8819191c52f086c134573` | Exact Sites version 313 built from `bf26fb818773ba3405da9aadae247427426da1bb`; 393 files; 38,973,440 bytes; content hash `sha256:96d336879f45a3ce6f8980b507c51d21387bd05f7c09ac9eef9b6e693627771e`; all 129 migrations |
| Historical Sites version 313 executable identity | Sites version 313 from `bf26fb818773ba3405da9aadae247427426da1bb` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7b1720b67081919395c74e17195201` on provider `info294029--aea-energy-comparison` succeeded at `2026-08-11T12:36:44.594561Z`; environment revision 20; health returned HTTP 200 at `2026-08-11T12:37:06.174Z` |
| Historical streamlined enquiry and certificate-estimate source | `c1a62944078ace043b68bb23a37e924d3e91fefc` on `codex/sites-custom-domain-migration` | Exact customer quote-preparation, plan and calculator source for intermediate Sites version 314; live signed-in Leads GET still returned HTTP 500 |
| Historical Sites version 314 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_a3a30ab242c0819184e4ec846fa5ef2c` | Exact Sites version 314 built from `c1a62944078ace043b68bb23a37e924d3e91fefc`; 395 files; 38,973,440 bytes; content hash `sha256:78f156f9459b1187a52c9fb88054fab58e13d440d776d8c94833d73e488c676c`; all 129 migrations |
| Historical Sites version 314 executable identity | Sites version 314 from `c1a62944078ace043b68bb23a37e924d3e91fefc` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7b30ccbc348191833216f9b4b41c02` succeeded on provider `info294029--aea-energy-comparison` with environment revision 20; plan and calculator QA passed but signed-in trade lead reads failed |
| Historical bounded trade-opportunity read application source | `ec7cfe49b3d43ae44756cd4ed77924229dd28a3a` on `codex/sites-custom-domain-migration` | Exact nine-statement atomic D1 read-batch correction and executable source for historical milestone `AEA-PRACTICAL-PLAN-TRADE-EMAIL-QUOTE-PREP-55` |
| Historical Sites version 315 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_e55118f62f488191b616250cd819863d` | Exact Sites version 315 built from `ec7cfe49b3d43ae44756cd4ed77924229dd28a3a`; all 129 migrations |
| Historical Sites version 315 executable identity | Sites version 315 from `ec7cfe49b3d43ae44756cd4ed77924229dd28a3a` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7b42f0ec288191b1c79b062233cf81` on provider `info294029--aea-energy-comparison` succeeded at `2026-08-11T15:42:54.685549Z`; environment revision 20; exact signed-in lead GET and safe UI reload passed with no Worker error events |
| Historical lead-submission, service-catalogue and calculator implementation source | `1e7a835a2b0f967b725a9a6400ec5872fbf7cbf1` on `codex/sites-custom-domain-migration` | Full validated implementation for milestone `AEA-LEAD-SUBMISSION-SERVICE-CALCULATOR-56`; historical intermediate Sites version 316 |
| Historical Sites version 316 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_005cf69ce1ac8191a068af6e69c22c68` | Exact Sites version 316 built from `1e7a835a2b0f967b725a9a6400ec5872fbf7cbf1`; deployment `appgdep_6a7bef81996c8191951f013dce24d698` succeeded with environment revision 20 |
| Historical activity-date copy-corrected application source | `e01d7fc8eb80292ddfb019366355293c1103c5fe` on `codex/sites-custom-domain-migration` | Historical executable source for milestone `AEA-LEAD-SUBMISSION-SERVICE-CALCULATOR-56`; differs from version 316 only in the calculator footer activity-date wording |
| Historical Sites version 317 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_524c3bf7b99c81918281002a6aaf9aca` | Exact Sites version 317 built from `e01d7fc8eb80292ddfb019366355293c1103c5fe`; 397 files; 39,034,880 bytes; content hash `sha256:17d143da5104ac5231b50aac712b46c280b4f1af8b963d17f7786426e17364dc`; all 129 migrations |
| Historical Sites version 317 executable identity | Sites version 317 from `e01d7fc8eb80292ddfb019366355293c1103c5fe` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7bf11b64a8819187ab2155e60906ad` succeeded at `2026-08-12T04:06:57.633776Z`; environment revision 20 |
| Historical durable public-lead and quote application source | `621797579ea1f2249e8679b26056066a4c824668` on `codex/sites-custom-domain-migration` | Exact executable source for historical milestone `AEA-DURABLE-PUBLIC-LEAD-QUOTE-57` |
| Historical Sites version 318 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_b10013e775f481919c719d4f00f2260e` | Exact Sites version 318 built from `621797579ea1f2249e8679b26056066a4c824668`; 399 files; 39,157,760 bytes; content hash `sha256:8dc4ea96f8dffa646d073e8e0ca3b8106bd286bc0e3dbbf5533402df841f4cc6`; all 131 migrations through `0130_trade_issued_document_cleanup.sql` |
| Historical Sites version 318 executable identity | Sites version 318 from `621797579ea1f2249e8679b26056066a4c824668` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7c2aece3248191abf36ae69cdb2095` on provider `info294029--aea-energy-comparison` succeeded at `2026-08-12T08:12:48.019629Z`; environment revision 20; remained live through the failed version 319 attempt until version 320 succeeded |
| Failed historical Team and one-click quote application source | `9bc981227e258dffb036a1ddf9acd6ad9117b72a` on `codex/sites-custom-domain-migration` | Complete feature source saved as Sites version 319, but never activated because the Sites migration parser rejected multiline trigger bodies |
| Failed historical Sites version 319 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_f56d55c000988191a5d215afbe9f64c8` | Exact Sites version 319 built from `9bc981227e258dffb036a1ddf9acd6ad9117b72a`; deployment failed before activation with `incomplete input: SQLITE_ERROR` |
| Failed historical Sites version 319 deployment identity | `appgdep_6a7c7a96fe2c8191be72871005057712` | Failed before activation with `incomplete input: SQLITE_ERROR`; deployment URL was null; version 318 remained public |
| Historical Team and one-click quote application source | `732f096ca5a8d606cf616ae7ec323ae9d2ce66b7` on `codex/sites-custom-domain-migration` | Validated, pushed to GitHub and Sites internal `main`; exact Sites migration-parser repair source for historical Sites version 320 |
| Historical Sites version 320 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_6f8fcc323a708191b385cbb4384d7f2b` | Exact Sites version 320 built from `732f096ca5a8d606cf616ae7ec323ae9d2ce66b7`; 408 files; 39,536,640 bytes; archive storage content hash `sha256:3f58ebf1aab9097920b97060f4151b3397c36456c9df48fe690c4e5d4d6588bb`; all 134 migrations through `0133_public_lead_job_files.sql` |
| Historical Sites version 320 executable identity | Sites version 320 from `732f096ca5a8d606cf616ae7ec323ae9d2ce66b7` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7c85c3787c8191b79ee717958643c6` succeeded on provider `https://aea-energy-comparison.info294029.chatgpt.site` with environment revision 20 and remained public until version 321 replaced it |
| Historical Team simplification and Interested workflow application source | `523b517c4027ef72f2b267c95ae8c36fd26af92d` on `codex/sites-custom-domain-migration` | Validated and pushed to GitHub and Sites internal `main`; exact executable source for historical milestone `TLINK-TEAM-ONE-CLICK-QUOTE-58` |
| Historical Sites version 321 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_e6fdbb289b9081918f4eaeb2167d71bf` | Exact Sites version 321 built from `523b517c4027ef72f2b267c95ae8c36fd26af92d`; 412 files; 39,546,880 bytes; archive storage content hash `sha256:a071cd89ac2137ff5877943785decf00cdefa983056c9d029226e21fbc086424`; all 136 migrations through `0135_team_document_expiry_warnings.sql` |
| Historical Sites version 321 executable identity | Sites version 321 from `523b517c4027ef72f2b267c95ae8c36fd26af92d` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7c9aa092088191896d869614891e2f` succeeded on provider `https://aea-energy-comparison.info294029.chatgpt.site`; environment revision 20; remained public until version 322 replaced it |
| Historical reliable quote-delivery and jobs-register application source | `d15ceda44255a706c10a699347b9bd54eba60c5e` on `codex/sites-custom-domain-migration` | Validated and pushed to GitHub and Sites internal `main`; exact executable source for historical milestone `TLINK-RELIABLE-QUOTES-JOBS-59` |
| Historical Sites version 322 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_a8e54fbf4cac81919d1167626542cc2c` | Exact Sites version 322 built from `d15ceda44255a706c10a699347b9bd54eba60c5e`; 420 files; 39,669,760 bytes; archive storage content hash `sha256:87b51cd53dcc3def0962c6c3c7f3bfaee4e4acf1a0b9819392dd642880ad5a7b`; all 137 migrations through `0136_trade_quote_delivery_outbox.sql` |
| Historical Sites version 322 executable identity | Sites version 322 from `d15ceda44255a706c10a699347b9bd54eba60c5e` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7d06e32e9c8191ae98c3b875564465` succeeded on provider `https://aea-energy-comparison.info294029.chatgpt.site`; environment revision 20; remained public until version 323 replaced it |
| Historical quote, job and invoice usability application source | `e757ac2402da0830b68d0e50e95afd61281c03c0` on `codex/sites-custom-domain-migration` | Validated and pushed to GitHub and Sites internal `main`; exact executable source for historical milestone `TLINK-QUOTE-JOB-INVOICE-USABILITY-60` |
| Historical Sites version 323 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_2b0ec0ac2ba881918f97c0bc77756ca3` | Exact Sites version 323 built from `e757ac2402da0830b68d0e50e95afd61281c03c0`; 420 files; archive content hash `sha256:e3d9ba2384f9442bce46646b36db3af857287481333097aa4c10eb8d45bc7522`; all 137 migrations; stored-byte total was not reported |
| Historical Sites version 323 executable identity | Sites version 323 from `e757ac2402da0830b68d0e50e95afd61281c03c0` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7d163a7a608191ab3e260ed58f63a3` succeeded on provider `info294029--aea-energy-comparison`; environment revision 20; remained public until version 324 replaced it |
| Historical quote editor and delivery correction application source | `c12fa0613901aa7cb4c1c2167b0e4720e57b0900` on `codex/sites-custom-domain-migration` | Validated and pushed to GitHub and Sites internal `main`; exact executable source for historical milestone `TLINK-QUOTE-EDITOR-DELIVERY-CORRECTION-61` |
| Historical Sites version 324 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_c3f6022a453c8191a29d5e356267d7bc` | Exact Sites version 324 built from `c12fa0613901aa7cb4c1c2167b0e4720e57b0900`; 420 files; 39,761,920-byte archive; content hash `sha256:18b106a2a7edb790229f2a947b3ec47b52864aab53b81fc2e1f46973adb18e7d`; all 137 migrations |
| Historical Sites version 324 executable identity | Sites version 324 from `c12fa0613901aa7cb4c1c2167b0e4720e57b0900` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7d2c7a471c819192d6390b0d59e9fc` succeeded on provider `info294029--aea-energy-comparison` at `https://aea-energy-comparison.info294029.chatgpt.site`; environment revision 20; remained public until version 325 replaced it |
| Historical quote-delivery workflow application source | `37a4faf2e9cbbc6eee5ffdf007366d7944152761` on `codex/sites-custom-domain-migration` | Validated and pushed to GitHub and Sites internal `main`; exact executable source for historical milestone `TLINK-QUOTE-DELIVERY-WORKFLOW-62` |
| Historical Sites version 325 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_4815104beb548191a5f747deee51c8b7` | Exact Sites version 325 built from `37a4faf2e9cbbc6eee5ffdf007366d7944152761`; 420 files; 39,823,360 bytes; content hash `sha256:a9df49e58bcd5462037cfc2ec37b8eaaef38612d9aa447d57de2a1fabbd0646f`; all 137 migrations |
| Historical Sites version 325 executable identity | Sites version 325 from `37a4faf2e9cbbc6eee5ffdf007366d7944152761` at `https://compare.ausenergyassessments.com` | Deployment succeeded on provider `info294029--aea-energy-comparison` with environment revision 20; deployment ID was not retained; the first live drain stopped before the provider on a historical renderer integrity mismatch |
| Historical versioned quote-delivery application source | `852aaa4b60cc72b598b375bcd96bc4cc9dd29d3d` on `codex/sites-custom-domain-migration` | Validated and pushed to GitHub and Sites internal `main`; exact executable source for historical milestone `TLINK-VERSIONED-QUOTE-DELIVERY-63` |
| Historical Sites version 326 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_adb266d1b0a88191bb7df8841d02c1f2` | Exact Sites version 326 built from `852aaa4b60cc72b598b375bcd96bc4cc9dd29d3d`; 422 files; 39,833,600 bytes; content hash `sha256:8ef0f48632dac835b45ab48c1a14d4c70d4d2f191f4def5a43aff50c4aa55b5f`; local archive 12,128,693 bytes, 436 tar entries and SHA-256 `3164A99777EE66ECF8C6B5F35A2F2364C3A4296FFACEC60B347ED08700E24239`; all 138 migrations through `0137_trade_quote_delivery_renderer_revision.sql` |
| Historical Sites version 326 executable identity | Sites version 326 from `852aaa4b60cc72b598b375bcd96bc4cc9dd29d3d` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7d472339648191843e05066c7d576b` succeeded on provider `info294029--aea-energy-comparison` at `https://aea-energy-comparison.info294029.chatgpt.site`; environment revision 20; affected delivery `66499ae8-f1a7-406b-befb-4cebca78ed7c` reached provider status `email.delivered`; remained public until version 327 replaced it; visible Gmail inbox placement remains unverified |
| Historical quote-acceptance, accepted-invoice and accounting application source | `9624507b9f4ed274169b67076a40ddb34cd26acb` on `codex/sites-custom-domain-migration` | Validated and pushed to GitHub and Sites internal `main`; exact executable source for historical milestone `TLINK-QUOTE-ACCEPTANCE-INVOICE-ACCOUNTING-64` |
| Historical Sites version 327 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_02b29fe421e08191aa90224edfd0335a` | Exact Sites version 327 built from `9624507b9f4ed274169b67076a40ddb34cd26acb`; 424 files; 39,966,720 bytes; content hash `sha256:288982ce37c09394283008a4591df411ef860c53835705001d5261bbb3030afb`; local `aea-energy-sites-v327.tar.gz` archive 12,164,300 bytes, 438 tar entries and SHA-256 `95DE14D1809A290898236FF65026F6AD9447EB37A91126D61710CA9FDA31C347`; all 140 migrations through `0139_trade_accepted_invoice_one_per_job.sql` |
| Historical Sites version 327 executable identity | Sites version 327 from `9624507b9f4ed274169b67076a40ddb34cd26acb` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7d96af6830819193ccc0f33ff86abf` succeeded on provider `info294029--aea-energy-comparison` at `https://aea-energy-comparison.info294029.chatgpt.site`; environment revision 20; remained public until version 328 replaced it |
| Initial weekly job-schedule application source | `510a3eca360ccdce45411f2fcdcc6237a0804923` on `codex/job-schedule-week-calendar` | Full scheduling, permission, quote-handoff and atomic conflict implementation; pushed to GitHub and Sites internal `main`; historical Sites version 328 |
| Historical Sites version 328 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_911202a646708191afee5671a2cc4864` | Exact version 328 from `510a3eca360ccdce45411f2fcdcc6237a0804923`; 424 files; 39,649,280 bytes; content hash `sha256:e95ec1e5149726a4f32f508d05a2ca7082dba97b8e0b00956470e17f4ce0701d`; local archive 12,175,943 bytes, 438 tar entries and SHA-256 `80E93AAB2849EAF63B8B3BD1999A5274B324B65B0730AFE607358713A8985C02` |
| Historical Sites version 328 executable identity | Sites version 328 from `510a3eca360ccdce45411f2fcdcc6237a0804923` | Deployment `appgdep_6a7e7374057481919de9371f323d37d0` succeeded; signed-in desktop QA found the assignment button clipped outside its panel, so it was immediately superseded |
| First assignment-containment application source | `c082239d88a8debd112ee0a304885bb6626b01e8` on `codex/job-schedule-week-calendar` | Validated and pushed to both sources; historical Sites version 329 |
| Historical Sites version 329 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_e495fff0d8b48191aec0eba61cab3efa` | Exact version 329 from `c082239d88a8debd112ee0a304885bb6626b01e8`; 424 files; 39,649,280 bytes; content hash `sha256:f4e2b689cef6b67e714ad1fc29e5e8e13885dd5fd6588ea18e80c105afb5ddfa`; local archive 12,175,913 bytes, 438 tar entries and SHA-256 `30609BE43A3803172880CDEEB7D955DC31D8116DFA112C01681256999C9DF50F` |
| Historical Sites version 329 executable identity | Sites version 329 from `c082239d88a8debd112ee0a304885bb6626b01e8` | Deployment `appgdep_6a7e75f70ef48191a2e9444906ca96a0` succeeded; live QA proved the later component module still overrode its same-specificity rule, so version 330 replaced it |
| Historical weekly job-schedule application source | `b29598f7d7f3c3f07a86cf9e36fcccf6b167d47d` on `codex/job-schedule-week-calendar` | Validated and pushed to GitHub and Sites internal `main`; exact executable source for historical Sites version 330 |
| Historical Sites version 330 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_67cd53f5286c8191b8b89132318a9f7e` | Exact version 330 from `b29598f7d7f3c3f07a86cf9e36fcccf6b167d47d`; 424 files; 39,649,280 bytes; content hash `sha256:ac674d405a045e30fe3865c3311938d3258a201c6cc6bc8c0b4252d7ce9c929b`; local archive 12,175,852 bytes, 438 tar entries and SHA-256 `FB01E3DD88B828888C92174C36F39B61872FDBA64A9DF523429A2F30D64E1BD4`; all 140 migrations |
| Historical Sites version 330 executable identity | Sites version 330 from `b29598f7d7f3c3f07a86cf9e36fcccf6b167d47d` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7e775d85888191b6607c767ff40259` succeeded on provider `info294029--aea-energy-comparison` at `https://aea-energy-comparison.info294029.chatgpt.site`; environment revision 20; remained public until version 331 replaced it |
| Historical schedule-interaction and acceptance-receipt application source | `4d3463ec1173be50e3b76ef92fa92e9cb1f81993` on `codex/job-schedule-week-calendar` | Validated and pushed to GitHub and Sites internal `main`; exact executable source for historical milestone `TLINK-JOB-SCHEDULE-WEEK-CALENDAR-65` |
| Historical Sites version 331 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_27287ed04e3c8191be9b208dcedeb705` | Exact version 331 from `4d3463ec1173be50e3b76ef92fa92e9cb1f81993`; 424 files; 39,690,240 bytes; content hash `sha256:085383d397d4deec9ce80f277bc9971dc32b0988c4d7b3dc375be97120893fbd`; local archive 12,184,305 bytes, 438 tar entries and SHA-256 `9FFD9B378B089EAEC882BC1E2FF5C3222B7A929F9B80DF3DB0805B7422F64508`; all 140 migrations |
| Historical Sites version 331 executable identity | Sites version 331 from `4d3463ec1173be50e3b76ef92fa92e9cb1f81993` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7e857ee3588191bd857fe21cd8ec41` succeeded on provider `info294029--aea-energy-comparison` at `https://aea-energy-comparison.info294029.chatgpt.site`; environment revision 20; remained public until version 332 replaced it |
| Historical atomic schedule-planning application source | `362be0632b5e1a1d89a312c791c3665924f037d7` on `codex/job-schedule-week-calendar` | Validated and pushed to GitHub and Sites internal `main`; historical intermediate source for `TLINK-JOB-SCHEDULE-PLANNING-66` |
| Historical Sites version 332 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_8c462e5b0ef08191850c4ac79373a180` | Exact version 332 from `362be0632b5e1a1d89a312c791c3665924f037d7`; 424 files; 39,731,200 bytes; content hash `sha256:2761c5235a0e4a83cd11f77f4bd3a562788e1b712288f2589b9262273bb95fba`; local archive 12,195,010 bytes, 438 tar entries and SHA-256 `5FCA9C6CAA92BDF4780378C276A561DDC57ED68021D886B02F5CCC3CC816C5A1`; sediment `file_00000000078081faa8bb76de3f85046a`; all 140 migrations |
| Historical Sites version 332 executable identity | Sites version 332 from `362be0632b5e1a1d89a312c791c3665924f037d7` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7ed1cbcc0c81919e2204380055f04b` succeeded on provider `info294029--aea-energy-comparison`; environment revision 20; live schedule QA passed but exposed an incorrectly mounted unsupported compliance intake, so version 333 superseded it |
| Historical schedule-planning corrective application source | `d35fdb8d52056fec6b62b6b56a4739a0443cadcf` on `codex/job-schedule-week-calendar` | Validated and pushed to GitHub and Sites internal `main`; exact executable source for historical Sites version 333 under milestone `TLINK-JOB-SCHEDULE-PLANNING-66` |
| Historical Sites version 333 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_55bd301f865c8191b6987afa0b940f9c` | Exact version 333 from `d35fdb8d52056fec6b62b6b56a4739a0443cadcf`; 424 files; 39,731,200 bytes; content hash `sha256:08a58d94d2e72271e709964b5580c9790f160c2d530f6be45c0c8d464e1b64d5`; local archive 12,190,974 bytes, 438 tar entries and SHA-256 `3EFC66E6088161095065EC694D8198A11DB877C4FAB3D6A2D592FF8D7810911E`; sediment `file_00000000d950820bacd2ce7904ce9afc`; all 140 migrations |
| Historical Sites version 333 executable identity | Sites version 333 from `d35fdb8d52056fec6b62b6b56a4739a0443cadcf` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7ed5605fd881918d2f288f2194f66e` succeeded on provider `info294029--aea-energy-comparison` at `https://aea-energy-comparison.info294029.chatgpt.site`; environment revision 20; superseded by version 334 |
| Historical schedule-duration and calendar-sync corrective application source | `f92b2e1c90178e8fb56f1b2841b4cbbf7bb7e7cb` on `codex/job-schedule-week-calendar` | Validated and pushed to GitHub and Sites internal `main`; exact executable source for historical Sites version 334 under milestone `TLINK-JOB-SCHEDULE-PLANNING-66` |
| Historical Sites version 334 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_df433c53dcc481919d1a7474c8426cd5` | Exact version 334 from `f92b2e1c90178e8fb56f1b2841b4cbbf7bb7e7cb`; 424 files; 39,761,920 bytes; content hash `sha256:cde0a7384d705af650c8b61cb60f97d976c04bbfd8915438325740433043200b`; local archive 12,198,859 bytes, 438 tar entries and SHA-256 `97e0db5955ca340a7e22d195f733adcaf9fe4ab0bf6a2e4decc7689a967dedd9`; all 140 migrations |
| Historical Sites version 334 executable identity | Sites version 334 from `f92b2e1c90178e8fb56f1b2841b4cbbf7bb7e7cb` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7ee956504881918dbe3752c62d1080` succeeded on provider `info294029--aea-energy-comparison` at `https://aea-energy-comparison.info294029.chatgpt.site`; environment revision 20; superseded by version 335 to preserve the exact job deep link while appointment details are open |
| Current schedule-duration, calendar-sync and deep-link corrective application source | `df86aa3ced0ee8d67022626369ebb0412af0b8da` on `codex/job-schedule-week-calendar` | Validated and pushed to GitHub and Sites internal `main`; exact executable source for current milestone `TLINK-JOB-SCHEDULE-PLANNING-66` |
| Current Sites version 335 saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_bfbac71cff188191af22d0819944fb4d` | Exact version 335 from `df86aa3ced0ee8d67022626369ebb0412af0b8da`; 424 files; 39,761,920 bytes; content hash `sha256:e70ba30cd399229086af36c1565e202a7558b097294e69798f23f69b3af4122b`; local archive 12,198,748 bytes, 438 tar entries and SHA-256 `48d2a866ff37c0df7bf13525b5d551a35f0bd8b6abcc0eabcc1da15bc13f7f20`; sediment `file_000000009fb0820ba1573cc5b72a19f4`; all 140 migrations |
| Current Sites version 335 executable identity | Sites version 335 from `df86aa3ced0ee8d67022626369ebb0412af0b8da` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a7eec87402c81918ed74c29a8f03755` succeeded on provider `info294029--aea-energy-comparison` at `https://aea-energy-comparison.info294029.chatgpt.site`; environment revision 20; signed-in owner desktop and 390 by 844 QA passed, while staff team and own-role identities remain unavailable for live QA |
| Current Google Apps Script relay source state | Existing deployment `AKfycbxBjHL_I3aw0FsGkOVaUDic6AwW1W0ItuxadP1NF-0NolTwLahYnc9PsGpPAdv2tMqW` | Existing project and deployment unchanged; updated in place to version 15 at 12 August 2026 18:10 with description `durable public-plan delivery and read-only readiness monitoring`; exact relay SHA-256 `8afa2f66415f30c1220509585935f4167a43a3d2b3170f70fcb0fc943b851be2` |
| Contract cleanup | `0080_retire_legacy_trade_commercial_data.sql`, SHA-256 `2CA1A250D9B6C637010480DEE0528906A932F40835EFBC786D90AD561CE99BA4` | Deployed from `698a5057cc384d43112e5ccff38a99effbb01fa8` |

The additive schema expansion, reviewed-ABN application, authorised contract
cleanup, customer, installer and trade releases, protected-trade locality,
authorised compliance operations, evidence-policy governance, national
government-activity workflow, VEU pilot and guarded VEU registry foundation are
deployed to production. The complete calculator first shipped as Sites version
294 from `d192d46b4e2056114251ec7cb0e3cfca3b5ea5d9`, followed by the bounded-refresh
correction in Sites version 295. Sites version 296 from exact guided calculator
and PDRS source `1d3abe172e4eb2fa006fab639233cda49a6d37d4` is historical. Sites
version 297 from exact simplified quote-calculator source
`11f4721b678425a4294e95c631e0d37d3fab0ffd` is historical. Sites version 298
from exact application source `c9fb34115209c0ea0a1fc02ee2095250458c256f`
is historical. Sites version 300 from exact corrective source
`ca3d84a497258426c7ab34c87e8059df1cba2a27` is historical. Sites version 301
from exact source `bc4096d61cb493e819555d72113d0c77d45a1653` is historical. Sites version
302 from exact source `f797ab7ee447bc31d66b5760f6613e46f107e97d` is historical. Sites version
303 from exact source `59ea305f9a45d1e4c22b354af2e211d22fe11358` is historical. Intermediate
Sites version 304 from milestone source `a0fcbf200ece76f68bbd83c298f1d556333c615e`
and corrective Sites version 305 from
`79f7e2e5be14464410ba40a749453c7473b22d4d` are historical. Sites version 306
from `c75ff7bb4355f2f74bc9996527900c3d515ab85e` completed the guided customer
journey. Mobile-header corrective Sites version 307 from
`6df3fab3c9eaca55445cf1c3f16e58b276aae6fd`, structured-enquiry Sites version
308 from `ad972cf2f61aeb59f2021f56b3c908ddb3ace0a0` and predecessor Sites version
309 from `30ebbf2d7b4ac03f00cdc6632786e7a12535c92a` are historical. Sites version
310 from exact VEU registry, rounding and water-heater limits source
`481cb3970ffd0efe498c9fbf7c9ba5f6a7e945c7` is historical. Sites version 311
from `ceac4486531995a11a566d224b6638c0678fb3d4` established the practical-plan,
mandatory trade-email and quote-preparation release, and Sites version 312 from
`33e9c3e11cf933ea4e752f21781f66f6ec8c2c37` added exact stored-consent
compatibility. Both are historical. Sites version 313 from
`bf26fb818773ba3405da9aadae247427426da1bb` and customer-plan/calculator Sites
version 314 from `c1a62944078ace043b68bb23a37e924d3e91fefc` are historical. Version
314 passed its plan and calculator QA but its signed-in Leads GET still returned
HTTP 500. Sites version 315 from
`ec7cfe49b3d43ae44756cd4ed77924229dd28a3a` restored bounded trade-opportunity
reads and is historical. Full implementation Sites version 316 from
`1e7a835a2b0f967b725a9a6400ec5872fbf7cbf1` is also historical. Sites version
317 from `e01d7fc8eb80292ddfb019366355293c1103c5fe` is historical. Sites version
318 from `621797579ea1f2249e8679b26056066a4c824668` is historical and remained live
through the failed version 319 attempt. Version 319 from
`9bc981227e258dffb036a1ddf9acd6ad9117b72a` failed before activation with
`incomplete input: SQLITE_ERROR` and a null deployment URL. Sites version 320
from exact repair source `732f096ca5a8d606cf616ae7ec323ae9d2ce66b7` is historical.
Sites version 321 from exact application source
`523b517c4027ef72f2b267c95ae8c36fd26af92d` and Sites version 322 from exact
application source `d15ceda44255a706c10a699347b9bd54eba60c5e` are historical.
Sites version 323 from exact application source
`e757ac2402da0830b68d0e50e95afd61281c03c0` is historical. Sites version 324
from exact application source `c12fa0613901aa7cb4c1c2167b0e4720e57b0900`
and Sites version 325 from exact application source
`37a4faf2e9cbbc6eee5ffdf007366d7944152761` are historical. Sites version 326
from exact application source `852aaa4b60cc72b598b375bcd96bc4cc9dd29d3d`
is historical. It added versioned quote-email rendering without weakening
content-integrity checks, and its affected production delivery reached provider
status `email.delivered`; visible Gmail inbox placement remains unverified. Sites
version 327 from exact application source
`9624507b9f4ed274169b67076a40ddb34cd26acb` is historical. It added replay-safe
signed quote acceptance, one immutable accepted invoice per job, reusable
negative certificate Price Book items and exact Xero, MYOB and QuickBooks Online
draft-export adapters. No live provider export was executed during its release
validation. Sites versions 328 and 329 were successful but intentionally
superseded during signed-in layout QA. Sites version 330 from exact application
source `b29598f7d7f3c3f07a86cf9e36fcccf6b167d47d` is historical. Sites version 331
from exact application source `4d3463ec1173be50e3b76ef92fa92e9cb1f81993`
is also historical. Intermediate Sites version 332 from exact application source
`362be0632b5e1a1d89a312c791c3665924f037d7` added atomic assignment plus first
booking, guarded staged appointment movement and resizing, appointment details
and an explicit add-another path. Its live schedule QA passed, but it mounted a
direct-customer compliance intake on an accepted released lead and produced an
expected permission-denied request. Corrective Sites version 333 from exact
application source `d35fdb8d52056fec6b62b6b56a4739a0443cadcf` hid that unsupported
intake without weakening the API permission boundary and is historical. Sites
version 334 from exact source `f92b2e1c90178e8fb56f1b2841b4cbbf7bb7e7cb`
corrected duration geometry, connected-calendar updates, rich event details and
the job-detail revision projection. It is also historical. Current corrective
Sites version 335 from exact source
`df86aa3ced0ee8d67022626369ebb0412af0b8da` additionally preserves the exact
job deep link while appointment details are open and clears it only through
Back.
GEMS-backed calculators remain fail-closed after an unresolved reviewed
official-row decrease.
Certificate creation, submission, trading and settlement remain disabled.

## Current atomic job scheduling and planning release

Milestone `TLINK-JOB-SCHEDULE-PLANNING-66` is released from exact corrective
application source `df86aa3ced0ee8d67022626369ebb0412af0b8da`, pushed to GitHub
branch `codex/job-schedule-week-calendar` and Sites internal `main`. Sites saved
version
`appgprj_6a550c378000819185caf094173422bb~appgver_bfbac71cff188191af22d0819944fb4d`
and deployed it through `appgdep_6a7eec87402c81918ed74c29a8f03755` as current
Sites version 335. The public custom URL is
`https://compare.ausenergyassessments.com`, the deployment URL is
`https://aea-energy-comparison.info294029.chatgpt.site`, provider identity is
`info294029--aea-energy-comparison`, and environment revision is 20. Sites stored
424 files and 39,761,920 bytes with content hash
`sha256:e70ba30cd399229086af36c1565e202a7558b097294e69798f23f69b3af4122b`
and sediment `file_000000009fb0820ba1573cc5b72a19f4`. The local version-335
archive is 12,198,748 bytes with 438 tar entries and SHA-256
`48d2a866ff37c0df7bf13525b5d551a35f0bd8b6abcc0eabcc1da15bc13f7f20`.
The package contains all 140 migrations.

The focused job workspace continues to assign an active worker and create the
first appointment in one guarded save. Job detail responses now project the
revision used by that compare-and-swap operation, so `Assign and add
appointment` does not fail merely because the detail response omitted its
revision. A completed booking appears once, and another form opens only through
the explicit `Add another` action.

The visible week now uses truthful 15-minute geometry: a 30-minute appointment
occupies 32 pixels when one hour occupies 64 pixels. A whole appointment moves
in 15-minute steps, while its accessible bottom-edge control resizes duration in
the same increments. Typed duration changes and saved server values use the same
geometry. Several changes may remain local as `Unsaved` until one guarded `Save
schedule`, while `Discard changes` restores authoritative server state.

Every connected-calendar mutation now forces a provider PATCH and verifies that
the provider response contains the requested start and end before recording the
sync as current. Authorised events carry the customer name, phone and email,
full service location, job reference, appointment type, notes and exact TLink
job URL needed in the field, while protected-lead privacy remains enforced. The
appointment-details dialog retains that exact job URL. Its close control keeps
the selected job deep link, and `Back to all jobs` deliberately clears it.

Full `npm.cmd run validate` passed in 74.3 seconds on exact corrective source
`df86aa3ced0ee8d67022626369ebb0412af0b8da`, including typecheck, warning-free
lint, integration and Node tests, all 140 migrations, database checks, PDF audit,
production build and Sites server-bundle audit. This release changes no schema
and adds no migration.

Signed-in owner desktop QA measured an exact 32-pixel 30-minute card against a
64-pixel hour and confirmed the accessible bottom-edge resize control. Accepted
AEA job `TLJ-X5JVPTHX` was booked exactly once for Saturday 15 August 2026 from
2:00 pm to 4:00 pm and produced a rich Google Calendar event. The exact job deep
link remained selected when its appointment details closed and `Back to
schedule` cleared it. At 390 by 844 there was no horizontal overflow and the
details dialog remained usable. The `Test 123` Google event displayed 4:00 pm to
4:30 pm, matching the saved 30-minute appointment.

Controlled provider PATCH proof changed James William job `TLJ-X5JVPTHX` through
the phone dialog from 2:00-4:00 pm to 2:00-3:45 pm. TLink reported `1 appointment
saved. Connected calendars were updated and verified`, and Google reloaded at
exactly 2:00-3:45 pm. Restoring the job to 2:00-4:00 pm produced an authoritative
TLink two-hour duration and a Google reload at exactly 2:00-4:00 pm with no
remaining 3:45 occurrence.

`/api/health` returned HTTP 200 with `Cache-Control: no-store`,
`Content-Type: application/json` and `{ "ok": true, "service": "aea-energy" }`.
The Sites errors-only 120-minute query returned one information-level cancelled
job-detail GET caused by the QA browser reload, request `a2af48cb9998e7d1`, and
no exception or error. Widened 45-minute logs showed both schedule PATCH requests,
`a2af47a15e5fe7d1` and `a2af489e3eb1e7d1`, with outcome `ok`, followed by
successful CRM and schedule GETs.

Historical Sites version 334 came from exact source
`f92b2e1c90178e8fb56f1b2841b4cbbf7bb7e7cb`, saved as
`appgprj_6a550c378000819185caf094173422bb~appgver_df433c53dcc481919d1a7474c8426cd5`
and deployed through `appgdep_6a7ee956504881918dbe3752c62d1080`. It carried the
duration, connected-calendar, rich-event and job-revision corrections, but
version 335 superseded it to preserve the exact job deep link while details are
open. Historical corrective version 333 came from
`d35fdb8d52056fec6b62b6b56a4739a0443cadcf`, saved as
`appgprj_6a550c378000819185caf094173422bb~appgver_55bd301f865c8191b6987afa0b940f9c`
and deployed through `appgdep_6a7ed5605fd881918d2f288f2194f66e`.

Separate signed-in staff identities with team or own schedule permission were
unavailable, so staff-role presentation and permission mutations remain
unverified live. Authoritative server permission tests remain green. The hosted
environment remains pre-launch test data; test records may be replaced, but the
final wipe remains a separately authorised launch operation.

## Previous weekly job scheduling and quote handoff release

Milestone `TLINK-JOB-SCHEDULE-WEEK-CALENDAR-65` is released from exact executable
application source `4d3463ec1173be50e3b76ef92fa92e9cb1f81993`, pushed to
GitHub branch `codex/job-schedule-week-calendar` and Sites internal `main`. Sites
saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_27287ed04e3c8191be9b208dcedeb705`
and deployed it through `appgdep_6a7e857ee3588191bd857fe21cd8ec41` as historical
Sites version 331. The public custom URL is
`https://compare.ausenergyassessments.com`, the deployment URL is
`https://aea-energy-comparison.info294029.chatgpt.site`, provider identity is
`info294029--aea-energy-comparison`, and environment revision is 20. Sites stored
424 files and 39,690,240 bytes with content hash
`sha256:085383d397d4deec9ce80f277bc9971dc32b0988c4d7b3dc375be97120893fbd`.
The local version-331 archive is 12,184,305 bytes with 438 tar entries and
SHA-256 `9FFD9B378B089EAEC882BC1E2FF5C3222B7A929F9B80DF3DB0805B7422F64508`.
The package contains all 140 migrations.

The focused job workspace has one `Schedule` tab and no separate `Assign` tab.
Assignment, existing appointments, new-booking controls and a visible
Monday-to-Sunday calendar share the same workspace. Previous, next, today and
direct-week navigation can reach any valid future week without an artificial
horizon. Team-scope viewers can show All workers or one named worker, while
own-scope responses contain only the signed-in member's authorised calendar. The
toolbar and edge time labels now align without clipping. A double-click on an
open calendar position creates a one-hour proposal at that time. Its bottom edge
resizes in exact 15-minute increments through a 32-pixel touch target, with
equivalent keyboard controls, while the booking form stays synchronised.

Booking validation uses unfiltered authorised calendar data even when display is
filtered to one worker. It blocks a missing or inactive assignee, an unloaded or
hidden proposal week, latest-load failure, same-worker overlap and that worker's
unavailability. Different workers can overlap. The server repeats the exact
member predicates and an atomic D1 guard, so stale or bypassed client state cannot
create the conflicting appointment.

Direct-owned quote completion keeps `Done` and adds `Schedule and assign job`,
which closes the delivery preview and opens the combined Schedule tab. An AEA
released lead remains assignable before acceptance but every actual appointment
or reschedule requires an authoritative accepted row for the exact current quote
version. Historical acceptance of an older version and a concurrent switch back
to an unaccepted draft both fail closed. The focused job refreshes on focus,
visibility, same-job navigation and a bounded timer so a newly accepted current
quote unlocks scheduling promptly. Refresh preserves unsaved schedule drafts and
assignment choices while booking and assignment mutations fail closed until the
latest state arrives.

The accepted customer view now offers `Save acceptance PDF`. Its accepted-only
GET route requires the exact signed customer token, returns private no-store
PDF headers, and renders the stored signed acceptance, accepted scope, invoice
and payment snapshot. Attention or unconfigured payment state redacts payable
bank fields, and test payment details retain the prominent `DO NOT PAY` warning.
No connected Xero, MYOB or QuickBooks Online draft export was executed.

Full `npm.cmd run validate` passed on the exact final application source:
typecheck, warning-free lint, 36 of 36 integration tests, 2,235 total Node tests
with 2,225 passed, 10 intentionally skipped and zero failed, all 140 migrations,
PDF audit, production build and Sites server-bundle audit. The final focused set
passed 63 of 63 after the last refinements; the preceding broader calendar and
acceptance-PDF audit passed 111 of 111. `git diff --check` passed.

Signed-in owner/team-scope QA passed at desktop 1440 by 1000 and phone 390 by
844. Calendar alignment, contained phone scrolling and All/Me worker filters
passed. Double-click created the expected one-hour proposal and resize changed 60
to 45 to 60 minutes. The accepted AEA job no longer showed the acceptance-wait
copy; because its server-saved assignee remains `Unassigned`, the interface
correctly required assignment before the first appointment. No assignment or
appointment was saved. A separate signed-in own-scope staff identity was
unavailable, so that live role presentation remains unverified; authoritative
route, permission and UI coverage passed.

The accepted-customer receipt and `Save acceptance PDF` control were visible on
desktop and phone, and the live receipt GET returned HTTP 200 twice. Two earlier
invalid OCR transcriptions produced expected handled 404 `QUOTE_LINK_NOT_FOUND`
probes; the exact accepted link then returned 200. No quote decision or message
was submitted during QA.

Sites version 328 from `510a3eca360ccdce45411f2fcdcc6237a0804923`
successfully deployed the complete feature but live QA found the assignment
button clipped. Version 329 from `c082239d88a8debd112ee0a304885bb6626b01e8`
also succeeded, but its same-specificity global rule lost to the later-loaded
component stylesheet. Both were deliberately superseded. Version 330 from
`b29598f7d7f3c3f07a86cf9e36fcccf6b167d47d` corrected that layout. Version 331
was the visually verified refinement release and is historical after version
332 replaced it.

`GET /api/health` returned HTTP 200 with `ok: true`. The final one-minute
error-only Worker query returned zero events. The handled OCR 404 probes were
application responses, not Worker crashes or failed Worker outcomes.

The hosted environment remains pre-launch test. Test records may be created or
replaced, but no final customer, wholesaler, trade-account or job wipe is implied
by this release; that remains a separately authorised launch operation.

## Previous quote acceptance, accepted invoice and accounting release

Milestone `TLINK-QUOTE-ACCEPTANCE-INVOICE-ACCOUNTING-64` is released from exact
executable application source `9624507b9f4ed274169b67076a40ddb34cd26acb`,
committed at `2026-08-13T20:01:03+10:00` and pushed to GitHub and Sites internal
`main`. Sites saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_02b29fe421e08191aa90224edfd0335a`
and deployed it through `appgdep_6a7d96af6830819193ccc0f33ff86abf` as historical
Sites version 327. The public custom URL is
`https://compare.ausenergyassessments.com`, the deployment URL is
`https://aea-energy-comparison.info294029.chatgpt.site`, the provider identity
is `info294029--aea-energy-comparison`, and the deployment uses environment
revision 20. Sites stored 424 files and 39,966,720 bytes with content hash
`sha256:288982ce37c09394283008a4591df411ef860c53835705001d5261bbb3030afb`.
Local archive `aea-energy-sites-v327.tar.gz` is 12,164,300 bytes with 438 tar
entries and SHA-256
`95DE14D1809A290898236FF65026F6AD9447EB37A91126D61710CA9FDA31C347`.
The package contains all 140 migrations through
`0139_trade_accepted_invoice_one_per_job.sql`.

Acceptance now preserves signed certificate, rebate and other adjustment rows
from the immutable quote snapshot. Product and labour rows stay non-negative,
and the signed line sum must reconcile exactly to the accepted subtotal, GST and
total. A stable customer-decision identifier and payload hash make a lost-response
replay return the same exact receipt without a second decision or finance change.

The acceptance transaction creates at most one immutable accepted invoice per
job. It freezes the accepted lines, signed totals, due date and complete
bank-transfer details when available. Manual, quick and accounting finance state
is never silently overwritten. The job and invoice register expose the accepted
invoice with deterministic precedence, one row per job and preserved attention
or reconciliation states.

The Price Book accepts reusable certificate items with zero cost and a required
negative sell price. Selecting one maps it to a signed quote adjustment; ordinary
product and labour rows still reject negative prices. This supports separate STC,
VEEC and ESC lines without disguising them as a general percentage discount.

The accounting boundary exports the exact accepted invoice as a provider draft
to Xero, MYOB or QuickBooks Online. Each adapter preserves signed line-level
subtotal, GST and total arithmetic, uses stable provider idempotency and checks
an existing provider record for an exact reference, customer and amount collision
before any provider write. QuickBooks Online requires actual Australian tax-code
entity IDs for ten-percent GST and GST-free lines rather than United States
`TAX` and `NON` pseudo codes. Platform-private customer sources remain denied;
released-lead sources require the immutable disclosure needed for that export.

Independent acceptance, invoice, register, certificate and accounting review
passed 101 of 101. The integrated regression set passed 103 of 103 and the
release-document set passed 6 of 6. Typecheck, warning-free lint, `db:check`
across all 140 migrations, production build with Sites bundle audit and
`git diff --check` passed.

Raw unfiltered `npm test` reported 2,202 total: 2,178 passed, 10 skipped, 7
failed and 7 cancelled. Every failure and cancellation is confined to the
preserved unrelated `test/trade-field-evidence-finalisation.test.mjs`, whose
SHA-256 remains
`6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.

No live Xero, MYOB or QuickBooks provider export was executed. Provider-side
draft creation, connected-account tax mapping and round-trip reconciliation are
unverified and are the first controlled follow-up. This release does not initiate
or reconcile a card or bank transaction.

## Previous versioned quote delivery release

Milestone `TLINK-VERSIONED-QUOTE-DELIVERY-63` is released from historical exact executable
application source `852aaa4b60cc72b598b375bcd96bc4cc9dd29d3d`, which is
pushed to GitHub and Sites internal `main`. Sites saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_adb266d1b0a88191bb7df8841d02c1f2`
and deployed it through `appgdep_6a7d472339648191843e05066c7d576b` as historical
Sites version 326. The public custom URL is
`https://compare.ausenergyassessments.com`, the deployment URL is
`https://aea-energy-comparison.info294029.chatgpt.site`, the provider identity
is `info294029--aea-energy-comparison`, and the deployment uses environment
revision 20. Sites stored 422 files and 39,833,600 bytes with content hash
`sha256:8ef0f48632dac835b45ab48c1a14d4c70d4d2f191f4def5a43aff50c4aa55b5f`.
The local 12,128,693-byte archive has 436 tar entries and SHA-256
`3164A99777EE66ECF8C6B5F35A2F2364C3A4296FFACEC60B347ED08700E24239`.
The package contains all 138 migrations through
`0137_trade_quote_delivery_renderer_revision.sql`.

Migration `0137` adds immutable `email_renderer_revision` to durable delivery
rows. Existing rows use frozen revision 1 and new issues use revision 2. The
automatic worker and manual retry path rebuild with the stored or inherited
revision, then verify subject, recipient, email content hash, PDF filename and
PDF hash before provider submission. Unsupported renderer revisions fail closed.

The quote editor now has one final percentage-discount control outside the
reorderable lines. It applies after the net included scope, including negative
STC, VEEC or rebate lines and fixed-dollar discounts. Optional and choose-one
rows are excluded. This preserves negative rebate arithmetic instead of
treating it as positive scope. Consent sits in the sticky submit footer beside
the send action. `Create job and quote` opens a staged progress modal immediately
while customer, job, accepted details and files are prepared.

Quote `Q-TLJ-X4LMAQXU`, delivery
`66499ae8-f1a7-406b-befb-4cebca78ed7c`, was durably queued under version 324.
No scheduled cron invocation was available to drain it. Version 325 added an
exact-delivery request drain plus a bounded health-route fallback. Its first
live health drain stopped before Resend with `QUOTE_DELIVERY_CONTENT_CHANGED`
because the version-325 renderer no longer reproduced the older row's stored
integrity hash. The integrity guard behaved correctly. This was not provider
acceptance, delivery or Gmail loss.

The third automatic attempt after version 326 used frozen renderer revision 1
and preserved the immutable email and PDF hashes. Provider acceptance occurred
at `2026-08-13T04:49:50.861Z` with message ID
`bcee0035-743e-4795-acb0-7512b731e740`. Callback events then recorded sent at
`2026-08-13T04:49:56.651Z` and delivered at
`2026-08-13T04:50:00.168Z` with provider status `email.delivered`. The exact row
is now `delivered`, attempts equal 3, and failure code, last error, next attempt
and lease fields are cleared. Provider acceptance and delivery callback are
proven. Visible placement in the recipient's Gmail inbox remains unverified and
is not claimed.

Focused quote, delivery, PDF, discount and migration-inventory coverage passed
in the release sets. Typecheck, warning-free lint, `db:check` across all 138
migrations, production build with Sites bundle audit and `git diff --check`
passed. Raw unfiltered `npm test` is not represented as passing. Its known
failures and cancellations remain confined to the preserved unrelated
`test/trade-field-evidence-finalisation.test.mjs`, whose SHA-256 remains
`6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.

## Previous quote delivery workflow release

Milestone `TLINK-QUOTE-DELIVERY-WORKFLOW-62` used exact executable application
source `37a4faf2e9cbbc6eee5ffdf007366d7944152761`, pushed to GitHub and Sites
internal `main`. Sites saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_4815104beb548191a5f747deee51c8b7`
as historical Sites version 325. The deployment succeeded on provider
`info294029--aea-energy-comparison` with environment revision 20; its deployment
ID was not retained. Sites stored 420 files and 39,823,360 bytes with content
hash `sha256:a9df49e58bcd5462037cfc2ec37b8eaaef38612d9aa447d57de2a1fabbd0646f`.

Version 325 added exact-delivery request draining, the health-route fallback,
one final percentage-discount control, sticky-footer consent and the staged
lead-to-job progress modal. Its production drain exposed the historical renderer
integrity mismatch and stopped safely before the provider. Version 326 preserves
this workflow while reproducing historical content with frozen revision 1.

## Previous quote editor and delivery correction release

Milestone `TLINK-QUOTE-EDITOR-DELIVERY-CORRECTION-61` is released from exact
executable application source `c12fa0613901aa7cb4c1c2167b0e4720e57b0900`,
which is pushed to GitHub and Sites internal `main`. Sites saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_c3f6022a453c8191a29d5e356267d7bc`
and deployed it through `appgdep_6a7d2c7a471c819192d6390b0d59e9fc` as historical
Sites version 324. The public custom URL is
`https://compare.ausenergyassessments.com`, the deployment URL is
`https://aea-energy-comparison.info294029.chatgpt.site`, the provider identity
is `info294029--aea-energy-comparison`, and the deployment uses environment
revision 20. Sites stored 420 files from a 39,761,920-byte archive with content
hash `sha256:18b106a2a7edb790229f2a947b3ec47b52864aab53b81fc2e1f46973adb18e7d`.
The source package contains all 137 migrations.

The customer editor now presents the primary name, contact details and address
once. Secondary contacts, sites, jobs, assets and history stay available through
bounded progressive disclosure. Editable text boxes, selects and actions remain
visible and consistently formatted.

Each normal and choice quote row now owns a `Price book item` selector. Choosing
an item applies its current authoritative description, type, unit price and GST
together. Choosing `Custom line` clears the item reference and leaves a random
line editable. Percentage and fixed-dollar discounts are independent repeatable
rows with editable customer-facing labels. Multiple STC, VEEC, referral and sale
adjustments can remain separate while aggregate discount stays capped at the
positive included scope and GST is reduced proportionally.

Normal, choice and discount rows expose desktop drag-and-drop and 44-pixel `Up`
and `Down` controls for touch, keyboard and mobile. The complete line object
moves, saved positions persist and the PDF renderer preserves the exact authored
A/B/A sequence rather than regrouping rows by section.

Consent now appears above the preview. `Review quote PDF` scrolls to and focuses
the generated PDF. Delivery status remains visible through queued, sending,
accepted, delivered and needs-attention states with the request reference.

The reproduced production HTTP 500 had two exact D1 binding-count causes inside
the atomic issue batch. The issued-event statement had an extra quote-version ID
binding, and the delivery-outbox insert omitted one timestamp binding. Both are
corrected. The endpoint reports queued success only when the immutable version,
event, secure link, PDF and non-null durable delivery row commit together. A
storage failure returns an actionable request reference and cannot silently
present an unsaved or unqueued quote as sent.

Focused integrated customer, quote, PDF, reorder and delivery coverage passed 83
of 83. The combined quote and delivery set passed 89 of 89, and price-book
coverage passed 7 of 7. Typecheck, warning-free lint, `db:check` across all 137
migrations, production build with the Sites server-bundle audit and
`git diff --check` passed.

Raw unfiltered `npm test` reported 2,134 total: 2,110 passed, 7 failed, 7
cancelled and 10 skipped. Every failure and cancellation is confined to the
preserved unrelated `test/trade-field-evidence-finalisation.test.mjs`, whose
SHA-256 remains
`6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.

`/api/health` returned HTTP 200 at `2026-08-13T02:32:28.712Z`. Signed-in
production QA opened job `TLJ-X23Z3GL9`; its overview and customer details were
visible. Draft version 1 loaded three quote rows and three customer-shared
photos. Each row exposed `Custom line`, `Call-out`, `Istore Heatpump`, `Kris
extra fee` and `Labour`, plus Drag and bounded Up/Down controls. Totals remained
`$4,700` excluding GST, `$470` GST and `$5,170` including GST.

Preview opened the real delivery dialog with consent at the top. `Review quote
PDF` was operable and the PDF preserved the same three items and totals. Consent
was not checked, Confirm and submit was not pressed, and the temporary UI state
was discarded by returning to edit and reloading. No controlled live email was
sent or received and no provider callback was reconciled.

## Next five logical product steps

1. Correct the hosted `AEA_RELEASE_SHA` to exact deployed application source `e558e7b94625afddf536ab96bd5d9a1bf77909f9`, redeploy saved Sites version 497 and prove the live health header matches the saved-version source.
2. Add an automated release-provenance gate that blocks promotion when the accepted GitHub source, Sites source branch, saved version and health header do not all identify the same application commit.
3. Verify the Australian Energy Assessments Google Analytics property for `G-3PGGJ0JX4H`, disable unapproved Enhanced Measurement events and prove private, print and PDF routes emit no analytics events.
4. Complete the initial 48-hour observation window across apex health, public redirects, electricity and gas plan services, enquiry delivery and the Search Console sitemap already reporting 47 discovered pages.
5. If the observation window remains healthy, obtain explicit owner approval before cancelling Durable or removing any rollback configuration, then record the irreversible retirement evidence.

## Previous quote, job and invoice usability release

Milestone `TLINK-QUOTE-JOB-INVOICE-USABILITY-60` is released from exact
executable application source `e757ac2402da0830b68d0e50e95afd61281c03c0`, which
is pushed to GitHub and Sites internal `main`. Sites saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_2b0ec0ac2ba881918f97c0bc77756ca3`
and deployed it through `appgdep_6a7d163a7a608191ab3e260ed58f63a3` as historical
Sites version 323. The public custom URL is
`https://compare.ausenergyassessments.com`, the provider identity is
`info294029--aea-energy-comparison`, and the deployment uses environment revision
20. Sites stored 420 files with archive content hash
`sha256:e3d9ba2384f9442bce46646b36db3af857287481333097aa4c10eb8d45bc7522`.
The source package contains all 137 migrations. A stored-byte total was not
reported and is not claimed.

The quote defect came from a saved line with a blank description. Normalising
that incomplete draft failed, every total fell back to generic `Check items`, and
Preview caught the same generic failure without taking the user to the problem.
Validation now identifies the exact quote row and field, highlights it, scrolls
it into view and moves focus there. Quote-choice validation also runs through the
bounded authoritative choice contract before preview. Valid lines retain live
subtotal, GST, discount, total, cost, sell and margin calculations.

Jobs Actions now includes permission-gated `Edit customer` for linked customers
owned by the trade. It uses the existing customer editor and update boundary;
platform-private references stay protected. Job Overview now presents separate
structured job and customer information, including name, phone, email, address,
status, worker and schedule. This is bounded operational alignment with Creditex
and Dataforce, while installer operations and compliance administration remain
separate authorities.

Assignment now uses one capability-filtered active-team dropdown and one compact
Save action. The competing search and load-more controls have been removed from
that surface. Correctable draft invoices now support desktop drag-and-drop and
44-pixel up/down controls for touch and keyboard use. Reordering preserves all
line values and flows through the existing correction revision. Issued invoice
history remains immutable.

The affected quote, jobs, invoice and team set passed 92 of 92. An independent
final review passed 106 of 106 relevant tests. Typecheck, warning-free lint,
`db:check` across all 137 migrations, production build with the Sites
server-bundle audit and `git diff --check` passed.

Signed-in production QA reproduced the saved blank quote-description failure and
confirmed the exact invalid field was identified and focused. A valid `$110`
quote opened the exact email and PDF preview. It was not saved or sent. The jobs
register, customer editor, structured job and customer details, and compact
single-dropdown assignment surface were inspected without saving a customer or
assignment change. The invoice list loaded, but no correctable draft invoice
existed in the available working-demo data. Live rendering and interaction of the
new reorder controls therefore remain unverified; source regression coverage
passed. `/api/health` returned HTTP 200 at `2026-08-13T00:57:08.421Z`.

## Previous reliable quote delivery and jobs register release

Milestone `TLINK-RELIABLE-QUOTES-JOBS-59` is released from exact executable
application source `d15ceda44255a706c10a699347b9bd54eba60c5e`, which is pushed
to GitHub and Sites internal `main`. Sites saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_a8e54fbf4cac81919d1167626542cc2c`
and deployed it through `appgdep_6a7d06e32e9c8191ae98c3b875564465` as historical
Sites version 322. The public custom URL is
`https://compare.ausenergyassessments.com`, the provider URL is
`https://aea-energy-comparison.info294029.chatgpt.site`, and the deployment uses
environment revision 20. Sites stored 420 files and 39,669,760 bytes with archive
storage content hash
`sha256:87b51cd53dcc3def0962c6c3c7f3bfaee4e4acf1a0b9819392dd642880ad5a7b`.

The quote editor now has explicit percentage and dollar overall-discount actions.
Each discount accepts editable customer-facing details, including a sale,
referral credit or certificate value. Quote lines and totals update live from the
same authoritative calculation used by the server. The editor shows subtotal
excluding GST, GST, discount including GST, total including GST, internal cost,
sell value and margin. A fixed discount cannot reduce the quote below zero.

Quote issue no longer depends on one browser request reaching the email provider.
The issue transaction records the exact immutable quote version, customer link,
PDF and queued delivery outbox before returning. A lost response replays that
exact version without a duplicate send, while later editing uses a separate draft.

Delivery processing uses a compare-and-set lease, provider idempotency and a
bounded five-attempt schedule. The visible states are exactly `Sending`, `Email
accepted for delivery`, `Delivered` and `Needs attention`. One manual retry
creates an immutable successor delivery with its own provider identity instead of
rewriting failed evidence. Provider callbacks are monotonic, and complaints and
opt-outs remain suppressed.

Jobs is now a dense configurable register with separate Job ID, first name, last
name, phone, email, street address, postcode, suburb, state, assigned worker,
schedule, status, quote total excluding GST and certificate-bucket columns.
Server-side filters, sorting, paging and saved column choices remain tenant-bound.
Right-click, keyboard and visible Actions controls open the same view, edit,
assign and schedule operations.

Job status follows controlled precedence: `Cancelled`, `Certified`, `Audited`,
`Complete`, `Assigned`, `Quoting`. An audit state requires authoritative accepted
and verified compliance evidence. Certificate buckets remain `Pending` with a
zero count until an authoritative program source exists. Quote total excluding
GST uses the authoritative quote document and selected-choice projection; an
unquoted job is shown as `Not quoted`, not as a false zero value.

Additive migration `0136_trade_quote_delivery_outbox.sql` extends the deployed
inventory to 137 migrations and owns the durable quote-delivery ledger.

The integrated product set passed 102 of 102, the broad stale-repair set passed
80 of 80 and integration passed 36 of 36. Typecheck, warning-free lint,
`db:check` across all 137 migrations, production build, Sites server-bundle audit,
`git diff --check` and the customer-plan PDF audit passed.

Raw unfiltered `npm test` reported 2,114 total: 2,090 passed, 7 failed, 7
cancelled and 10 skipped. Every failure and cancellation is confined to preserved
unrelated test `test/trade-field-evidence-finalisation.test.mjs`, whose stale mock
and source-location expectations were not edited. It retains SHA-256
`6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.

Signed-in production QA opened existing job `TLJ-X23Z3GL9`. Jobs showed rows 1
through 13 of 13, the requested separate columns and zero page-level horizontal
overflow. The first quoted job showed `$4,700` excluding GST.

Quote lines `$200`, `$3,500` and `$1,000` rendered a live `$4,700` subtotal
excluding GST, `$470` GST, `$5,170` total, `$3,191` cost and `$1,509` margin.
Both discount actions were visible. A temporary 10 percent discount changed the
subtotal to `$4,230`, GST to `$423`, discount including GST to `$517` and total
to `$4,653`; it was removed without saving.

Release QA did not issue, send or retry a quote, and provider inbox receipt is not
claimed. `/api/health` returned HTTP 200 at `2026-08-12T23:57:03.130Z`.

## Previous TLink Team and one-click Interested release

Milestone `TLINK-TEAM-ONE-CLICK-QUOTE-58` is released from exact repair and
executable application source `523b517c4027ef72f2b267c95ae8c36fd26af92d`, which is
pushed to GitHub and Sites internal `main`. Sites saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_e6fdbb289b9081918f4eaeb2167d71bf`
and deployed it through `appgdep_6a7c9aa092088191896d869614891e2f` as historical
Sites version 321. The public custom URL is
`https://compare.ausenergyassessments.com`, the provider URL is
`https://aea-energy-comparison.info294029.chatgpt.site`, and the deployment uses
environment revision 20. Sites stored 412 files and 39,546,880 bytes with archive
storage content hash
`sha256:a071cd89ac2137ff5877943785decf00cdefa983056c9d029226e21fbc086424`.

Team is now a first-class trade workspace. Owners can govern granular access
permissions, saved permission presets, a dense roster with separate first name,
last name, phone and email columns, clear Open actions, device inventory and
active or inactive lifecycle history. Saved presets copy defaults only and never
authorize access. Deactivation removes access while retaining historical job,
file and member records. Job,
assignment, rescheduling, customer, report, quote, invoice, price-book, discount,
evidence and permission-management access remains separately controlled,
including own-work and team-work scopes. Only an owner can close the business
account.

Add-member contact fields are aligned. The phone control strips letters in the
client, and the server rejects non-phone characters before Australian
normalisation.

Member records now use generic document or photo upload with a title and optional
expiry date. The replaced licence and credential form is removed. Active
documents due within 30 days create permission-scoped notification-drawer warnings
and durable, idempotent owner-email work. Release QA sent no expiry email. Each
member has an allowlisted schedule colour. A member can update their own
availability, while an owner or delegated team manager can update staff
availability without widening job or appointment visibility.

For an exact authorised match, one Interested action atomically creates or
replays that accepting company's customer, primary contact, service site, numbered
job and draft quote, copies every customer-selected quote photo into canonical
job Files, and opens the quote tool. The same marketplace lead can therefore
produce independent tenant-owned IDs, workflow records, media objects and replay
state for every company that accepts it. Accepted customer context, answers and
copied photos remain available after the source lead is withdrawn, expires or is
removed.

The exact version 320 production failure occurred before mutation. Its Interested
preflight used seven `UNION ALL SELECT` terms, above the D1 production compound
`SELECT` limit of five. Version 321 replaces that preflight with one ordinary
`SELECT 1 WHERE EXISTS(...) OR ...` statement across the seven deterministic
records. The correction retains the atomic match status, tenant customer, contact,
site, job, copied job photos, draft quote and conversion workflow plus idempotent
replay.

Accepted CRM names use a deliberate placeholder without changing consent truth.
An unknown first name is persisted as `Redacted` and an unknown last name is
persisted separately as `Redacted`; an available component is preserved. The
composed CRM display is `Redacted Redacted` only when both are unavailable. The
immutable accepted-disclosure snapshot keeps undisclosed name fields blank, and
an authorised company user can later replace the CRM placeholders.

Additive migrations `0131_trade_team_permissions_and_member_files.sql`,
`0132_public_lead_accepted_disclosure.sql` and
`0133_public_lead_job_files.sql` remain deployed. Additive migrations
`0134_team_member_documents_and_colours.sql` and
`0135_team_document_expiry_warnings.sql` extend the deployed inventory to 136
migrations.
Historical version 319 used source `9bc981227e258dffb036a1ddf9acd6ad9117b72a`, saved
version
`appgprj_6a550c378000819185caf094173422bb~appgver_f56d55c000988191a5d215afbe9f64c8`
and deployment `appgdep_6a7c7a96fe2c8191be72871005057712`. It failed before
activation with `incomplete input: SQLITE_ERROR`, returned a null URL and left
version 318 live. Repair source `732f096ca5a8d606cf616ae7ec323ae9d2ce66b7`
keeps the three forward migrations Sites-parser compatible and installs and
verifies the exact complete trigger statements at runtime.

Historical version 320 used source `732f096ca5a8d606cf616ae7ec323ae9d2ce66b7`,
saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_6f8fcc323a708191b385cbb4384d7f2b`
and deployment `appgdep_6a7c85c3787c8191b79ee717958643c6`. It succeeded and
remained public until version 321 replaced it.

Product-focused Team coverage passed 67 of 67, bounded schedule coverage passed
34 of 34, lead and expiry coverage passed 35 of 35, integration passed 36 of 36,
and independent audit coverage passed 68 of 68. Typecheck, warning-free lint,
`db:check` across all 136 migrations, production build, Sites server-bundle audit,
`git diff --check` and the customer-plan PDF audit passed.

Raw unfiltered `npm test` reported 2,066 total: 2,042 passed, 7 failed, 7
cancelled and 10 skipped. Every failure and cancellation is confined to preserved
unrelated test `test/trade-field-evidence-finalisation.test.mjs`, whose stale mock
and source-location expectations were not edited. It retains SHA-256
`6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.

Signed-in production QA reloaded the pictured existing lead. `Create job and
quote` was present and enabled, and the prior workflow-preparation error was
absent. The Team workspace showed aligned separate first-name, last-name, phone,
email, status, colour and action columns, bordered `Open` actions and no `More`
text. The add-member contact fields were equal-height, equal-width aligned pairs,
and entering `abc0412def345678` into the telephone field left `0412345678`. The
document vault exposed only title, optional expiry and one PDF/JPEG/PNG file
input. The colour palette and self/team availability choices were visible. This
account had no appointments, so appointment colour rendering was not observed
live.

Release QA deliberately did not click Interested on the live lead, upload a
member document, mutate availability, send a quote, send a document-expiry email
or send any other live email. `/api/health` returned HTTP 200 and the 20-minute
Sites Worker errors-only query returned zero events after inspection.

## Previous durable public lead, customer delivery and quote handoff release

Milestone `AEA-DURABLE-PUBLIC-LEAD-QUOTE-57` is released from exact application
source `621797579ea1f2249e8679b26056066a4c824668`, which is pushed to GitHub and
Sites internal `main`. Sites saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_b10013e775f481919c719d4f00f2260e`
and deployed it through `appgdep_6a7c2aece3248191abf36ae69cdb2095` as historical
Sites version 318. Deployment succeeded on provider
`info294029--aea-energy-comparison` at `2026-08-12T08:12:48.019629Z` with
environment revision 20 at `https://compare.ausenergyassessments.com`.

The reproduced first-attempt public lead failure was an `AbortError` after cold
customer-PDF and font preparation followed by a synchronous Google Apps Script
relay inside the request. A later warm retry succeeded, but relying on a customer
retry was unacceptable. The route now writes the canonical intake to D1 and R2
and creates independent customer-email and internal-review outboxes before HTTP
200. It returns the truthful `planEmailStatus: queued` state. Customer PDF
generation and Resend delivery and the Apps Script internal-review relay execute
as independent asynchronous work with durable retries.

The signed lead-delivery monitor no longer calls the external relay or performs a
synthetic delivery. It is a read-only readiness check over required D1 schema and
indexes, R2 capability and provider configuration presence. It creates no lead,
writes no outbox, sends no email and makes no provider-deliverability claim.

Exact authorised trade matches can click a protected quote-photo thumbnail and
view the whole image in a focus-contained lightbox. X, backdrop and Escape close
the image, focus returns to the invoking thumbnail and object URLs are revoked.
Selecting Interest creates or reuses a deterministic pseudonymous CRM customer,
contact, site, job and draft quote, then opens the prefilled quote editor. Issue
and send are explicit, current recipient and access are rechecked for each new
issue or send, and issued PDF bytes and the secure customer link are immutable.
Per the product-owner override, there is no withdraw-or-change workflow after
issue.

Additive migrations `0129_public_plan_delivery_outboxes.sql` and
`0130_trade_issued_document_cleanup.sql` extend the deployed inventory to 131
migrations. The existing Google Apps Script project and deployment ID
`AKfycbxBjHL_I3aw0FsGkOVaUDic6AwW1W0ItuxadP1NF-0NolTwLahYnc9PsGpPAdv2tMqW`
were preserved and updated in place to version 15 at 12 August 2026 18:10 with
description `durable public-plan delivery and read-only readiness monitoring`.
The hosted editor source was compared with the committed relay and has exact
SHA-256 `8afa2f66415f30c1220509585935f4167a43a3d2b3170f70fcb0fc943b851be2`.

Final `npm.cmd run validate` exited 0. Typecheck, warning-free lint, 36 of 36
integration tests, `db:check`, production build, Sites bundle audit and
`git diff --check` passed. The full suite ran 1,980 tests with 1,970 passed, 10
intentional skips and 0 failures. All 131 migrations passed and the customer-plan
PDF audit rendered 24 pages. Focused quote and photo tests passed 123 of 123,
durable lead and email tests passed 38 of 38, monitor tests passed 29 of 29, and
the wider regression set passed 85 of 85.

Live custom-domain health, plan and trade dashboard checks returned HTTP 200.
The 15-minute post-release Worker errors-only query returned zero events. No
synthetic production lead, customer email or quote was sent, so first real
post-release customer provider acceptance and inbox receipt, every matched-trade
email and dashboard appearance, and the issued customer quote decision remain
explicitly pending runtime proof.

## Prior lead submission, service catalogue and calculator release

Milestone `AEA-LEAD-SUBMISSION-SERVICE-CALCULATOR-56` is released from exact
application source `e01d7fc8eb80292ddfb019366355293c1103c5fe`. Sites saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_524c3bf7b99c81918281002a6aaf9aca`
and deployment `appgdep_6a7bf11b64a8819187ab2155e60906ad` identify historical
Sites version 317. Deployment succeeded at `2026-08-12T04:06:57.633776Z` with
environment revision 20 at `https://compare.ausenergyassessments.com`.

Reused private-plan facts now render as readable label and value cards in two
desktop columns and one narrow-screen column. Lead submission opens an immediate
modal before the base request. The modal traps focus, cannot be dismissed by
backdrop or Escape, locks document scrolling and keeps a departure warning active
while lead creation or photo upload is running. Determinate progress covers the
lead and every selected photo. A failed photo upload retries only unfinished
photos, a skip requires confirmation, and safe completion focuses the existing
four-option customer gateway.

One canonical catalogue owns 12 services, including `electric-cooking` as
`Electric cooking and cooktops`. Public validation, any-selected service matching,
mandatory trade email, notification, CRM, job and work-order paths use those
values. Business owners can change future lead capabilities without rewriting
existing lead snapshots. Mandatory trade email retains approval, consent,
service-area, suppression, retry and idempotency checks, and now uses escaped
deterministic TLink-branded HTML with a plain-text fallback.

The public certificate-price response and calculator client no longer expose a
commercial supplier name or link. Current gross values remain available for every
supported certificate type, and stale or missing price data continues to fail
closed. Activity 46 uses purchase date for its rule boundary. Purchases from 30
June 2026 use the current built-in or freestanding scenario, A$200 minimum payment
and 1.5 reduction rounded to 2 VEECs. Purchases from 14 April through 29 June 2026
retain the exact legacy listed-product path. Dates before 14 April 2026 fail
closed until the exact historical rule versions are added.

Full implementation commit `1e7a835a2b0f967b725a9a6400ec5872fbf7cbf1`
was saved as historical intermediate Sites version 316 under
`appgprj_6a550c378000819185caf094173422bb~appgver_005cf69ce1ac8191a068af6e69c22c68`
and deployed through `appgdep_6a7bef81996c8191951f013dce24d698`. Historical
version 317 changes only the calculator footer from `selected installation date`
to `selected activity date`. Sites stored 397 files and 39,034,880 bytes with
content hash
`sha256:17d143da5104ac5231b50aac712b46c280b4f1af8b963d17f7786426e17364dc`
and all 129 migrations.

Final `npm.cmd run validate` passed typecheck, warning-free lint, integration,
1,946 total tests with 1,936 passed, 10 intentional skips and 0 failures,
`db:check` across all 129 migrations, the customer-plan PDF audit, production
build and Sites bundle audit. `git diff --check` passed. The final static copy
correction then passed typecheck, lint, build and the Sites bundle audit.
Independent review returned GO with no P0 or P1 finding, and the focused risk set
passed 135 of 135.

Live `/api/health` and `/api/certificate-prices` returned HTTP 200. The public
price response contains no `sourceName` or `sourceUrl`. Live inspection confirmed
readable reused-fact cards and the current Activity 46 purchase-date flow without
the obsolete product picker. No real lead or trade email was submitted during
version-317 QA. The upload modal and navigation protections are verified by source
and regression tests, not by a production submission.

## Prior practical plan, trade email and quote preparation release

Milestone `AEA-PRACTICAL-PLAN-TRADE-EMAIL-QUOTE-PREP-55` is released from exact
application source `ec7cfe49b3d43ae44756cd4ed77924229dd28a3a`. Sites saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_e55118f62f488191b616250cd819863d`
and deployment `appgdep_6a7b42f0ec288191b1c79b062233cf81` identify historical
Sites version 315. Deployment succeeded on provider
`info294029--aea-energy-comparison` at `2026-08-11T15:42:54.685549Z` with
environment revision 20.

The release correction chain remains explicit. Historical Sites version 311 was
saved from `ceac4486531995a11a566d224b6638c0678fb3d4` as
`appgprj_6a550c378000819185caf094173422bb~appgver_59994c1e46e88191b01a512cbf0e1561`.
It established the milestone but treated a valid stored version-6 contact release
as outdated. Historical Sites version 312 was saved from
`33e9c3e11cf933ea4e752f21781f66f6ec8c2c37` as
`appgprj_6a550c378000819185caf094173422bb~appgver_922f83ef18c881918992e00a6d98df96`
and deployed through `appgdep_6a7b13c66a6c819184d327dfda5cfcfc`. It added
exact version-4, version-6 and version-7 consent compatibility and recovered
zero-attempt terminal consent skips, but production D1 rejected the deep final
claim with `Expression tree is too large (maximum depth 100)`. Version 313 keeps
the full stored-release validation before claiming and uses a shallow exact-pair
predicate in the final atomic claim. Historical Sites version 314 was saved from
customer enquiry and calculator commit
`c1a62944078ace043b68bb23a37e924d3e91fefc` as
`appgprj_6a550c378000819185caf094173422bb~appgver_a3a30ab242c0819184e4ec846fa5ef2c`
and deployed through `appgdep_6a7b30ccbc348191833216f9b4b41c02`. Its live plan
and calculator QA passed, but the signed-in Leads GET still returned HTTP 500.
Version 315 corrects that production-only failure with bounded reads.

Every active approved match must own one unique durable notification delivery
before lead matching is reported as successful. Exact opportunity batches drain
after the request and from successful health checks, signed-in trade polling and
the minute scheduler. Provider failures retry after 5 minutes, 30 minutes, 2
hours, 4 hours, 8 hours, 16 hours and then daily until the provider accepts the
message, the customer withdraws consent or the trade is no longer eligible. The
public-plan notification does not depend on an optional account email preference,
but every send rechecks active platform approval, current consent, selected
service and service area, active opportunity and match, current email,
suppression and idempotency.

Email attachment and post-submit gateway download use one canonical customer PDF
generator and are byte-identical for the same plan inputs. The audited fixture is
a tagged 24-page report with embedded fonts, semantic lists, 48 checked links and
no active content. Plain-language immediate, better and long-term action tiers
cover draughts, moisture, ventilation, glazing, shading, heating, cooling, hot
water, cooking, solar, batteries, electric vehicles and assessment preparation.
Gas replacement guidance is conditional and recommends efficient affordable
electric alternatives without making product, price or savings claims.

The public enquiry exposes optional three-to-four-question preparation packs for
all 11 services, deduplicates only genuinely shared questions and requires an
explicit customer opt-in before known private plan facts are reused. Relevant
mobile and desktop file controls accept JPEG and PNG images. Answers and photos
remain optional and a photo-only retry cannot resubmit the base lead.

Version 314 made the final preparation section open by default and removed
repeated switchboard, roof, installed-heating, hot-water and other already-known
questions. The representative nine-service path fell from 19 questions to three,
the all-service path has at most five, and one service has one or two. Its
read-only reuse summary preserves reverse-cycle air conditioning, gas ducted or
space heating and evaporative cooling together. Photo guidance requests wide
whole-appliance and work-area views before close-up labels while retaining safe
full-switchboard and inverter views.

The version-314 calculator uses concise one-or-two-system quantity controls,
assumes zero prior VEU-funded water heaters for the public estimate while making
the final accredited-provider history check explicit, combines raw reductions
within one prescribed activity before its final whole-certificate rounding, and
shows a gross AUD estimate for every supported current certificate type. It fails
closed when price data is stale or missing and clears old certificate and dollar
results whenever an input changes. Live `/api/certificate-prices` was current at
`2026-08-11T14:00:46.718Z`; the gross AUD inputs were STC 39.65, ESC 29.50, VEEC
82.25, PRC 2.80, LGC 8.00, ACCU 38.75 and SMC 38.40. Customer copy states that
registration, audit, compliance, processing and other fees reduce the actual
rebate.

Private quote answers and stripped photo derivatives are held in D1 and R2,
never exposed through a public URL or email attachment, and are accessible only
to exact active matches for the relevant selected service. Customer withdrawal
blocks access immediately. Bounded tombstone cleanup removes retained R2 objects
after upload failure or withdrawal. Additive migration
`0128_public_plan_quote_preparation.sql` owns answer, file, grant, withdrawal and
cleanup state; the packaged inventory contains all 129 migrations through
`0128`. The mobile enquiry padding correction keeps the form readable without
horizontal document overflow.

Version 315 splits the trade-opportunity read into one atomic D1 batch containing
nine bounded statements. The maximum conservative query budget is 54 against the
live limit of 100, no statement has more than five joins, and the ordered base set
is deterministically capped at 100. Exact-match, project-consent, public-release,
withdrawal, contact, quote and arrival guards remain fail-closed.

The exact version-315 source passed `npm.cmd run validate`: typecheck,
warning-free full lint, 1,936 total tests with 1,926 passed, 10 intentional skips
and 0 failures, `db:check` across all 129 migrations, the 24-page customer-plan
PDF audit, production build and Sites bundle audit. The PDF audit confirmed
embedded fonts, tagged structure, semantic lists, 48 checked links and no active
content. `git diff --check` passed before release.

Live desktop and 355-pixel mobile QA confirmed the optional preparation pack,
service-specific questions and camera or file controls, readable form and zero
horizontal document overflow. The deployed bundle contains the post-submit
customer gateway for electricity comparison, gas comparison, rebate calculation
and the canonical personalised-plan PDF. No new lead was submitted solely for
visual QA.

Live signed-in version-315 QA reloaded an existing expected match. The prior `The
lead could not be refreshed`, `Leads could not be loaded` and false-empty states
were absent. The workspace showed 10 matching leads with the expected consented
detail, the exact GET and safe UI reload succeeded, and the post-check Worker
errors-only query was empty.
No mutating PATCH smoke was run and no lead status was changed.

The previously skipped exact delivery `bd53ebf192e525465b9026470b3ca5c5`
was recovered once under version 313 and reached `delivered` with Resend provider
message `a237b559-27c9-4ba1-a4f5-b9d4e582580f`. Durable evidence records
`provider_accepted`, `email.sent` and `email.delivered`. Current-version-7 control
delivery `d8a7968ff3ff1e5fbad350ed8692796e` also reached `delivered` with Resend
provider message `e81bbf1b-5c32-40f6-8395-aa6141187712`, including confirmed
provider acceptance and delivery. These are delivery results for existing
authorised leads, not visual-QA submissions.

## Prior VEU registry, rounding and water-heater limits release

Milestone `CREDITEX-VEU-REGISTRY-ROUNDING-LIMITS-54` is released from exact
executable application commit `481cb3970ffd0efe498c9fbf7c9ba5f6a7e945c7`,
pushed to the GitHub working branch and Sites internal `main`.

Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_328bc0ff50648191abfb6cd0b6aafed8`
and deployment `appgdep_6a7a78c959908191a2fbd39fc247dfc2` identify Sites
version 310 from that exact source. Deployment succeeded with environment
revision 20 at `https://compare.ausenergyassessments.com`. Sites stored 392 files
and 38,727,680 bytes with content hash
`sha256:c238b3125d74473df101491648c78308402fcbefc846d8ea72f95006a81864f3`.
The release contains all 128 migrations.

The production stale error was caused by a separate fifth VEU scheduled trigger
that was not being executed. The VEU refresh now runs from the provisioned minute
scheduler behind a 07:25 Australia/Sydney daily gate. The 48-hour
accepted-snapshot freshness check is retained and still fails closed.

Current VEU snapshot `ce79c9dc-63e8-4c27-9f4e-ee7961b423ba` contains 75,492
rows, was refreshed at `2026-08-11T00:09:32.316Z` and binds source SHA-256
`1fb51867a4de9b2ee306f1cc943c1444b6351b3b2c19ef3041f48c59cc3278b6`.
Victorian Energy Efficiency Target Act 2007 section 18(1A) requires each
separately eligible prescribed activity to be rounded independently and rounds
an exact half up. Two separately eligible 7.5-VEEC activities therefore return
16 VEECs, not 15; raw activity values are not combined before rounding.

Victorian Energy Efficiency Target Regulations 2018 Authorised Version 020
Schedule 4 limits prior plus current relevant water-heater products to two at a
residential premises from 10 June 2019 and five at a non-residential premises
from 31 May 2023. The calculator now requires a fail-closed prior-count answer
and enforces each premises limit across identical and mixed-model groups. Water
Heating and Space Heating and Cooling Activity Guide version 3.20 keeps in-line
additional-storage and manifold-connected systems outside the eligible estimate
path.

Final `npm.cmd run validate` passed typecheck, warning-free lint, integration,
1,897 tests with 1,887 passed, 10 intentional skips and 0 failures, `db:check`,
the customer-plan PDF audit, production build and Sites bundle audit. The focused
combined set passed 80 of 80, the estimate-route set passed 21 of 21 and the
independent release review passed 104 of 104. `git diff --check` passed.

Live `/api/health` returned HTTP 200. Activity 3C official-product search
returned HTTP 200 with `ok: true`, 421 matches and first result AGM Energy
`AGMHP270W`. Signed-in visual QA confirmed enabled brand and model pickers with
no stale error. The Worker errors-only query returned zero events.

The production SRES water-heater endpoint returned `ok: true` and current
registry `cer_sres_swh` with 16,758 records. Snapshot
`950e1b99-3914-47d2-9ff8-39964ebdcb5d` was activated at
`2026-08-10T23:51:08.395Z` with combined source SHA-256
`cbe27670e022c9da0dfc9e4af243330e0f1e2170732e9d046dc559793d2e28de`.
That count matches the expected version 58 total, but the live projection did
not expose a version or publication date.

No certificate was created, submitted, traded or settled during this release.

## Prior structured customer enquiry gateway release

Milestone `AEA-STRUCTURED-CUSTOMER-ENQUIRY-GATEWAY-53` was released from exact
executable application commit `ad972cf2f61aeb59f2021f56b3c908ddb3ace0a0`,
pushed to the GitHub working branch and Sites internal `main`.

Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_d5eaf4c6b458819187a105747dfc6075`
and deployment `appgdep_6a79e3700444819191ac709f0bd509c6` identify Sites
version 308 from that exact source. Deployment succeeded with environment
revision 20 under provider identity `info294029--aea-energy-comparison` at
`https://compare.ausenergyassessments.com` and
`https://aea-energy-comparison.info294029.chatgpt.site`. Sites stored 392 files
and 38,696,960 bytes with content hash
`sha256:881c057c42808490cc7d354c6c0e8a349a17fcb774e201d5cd302f9c7ed19e57`.
The local 392-entry release package was 11,903,586 bytes with SHA-256
`f9ce016769722f6b47d17107ec2d3d1ab0670a8afea3007a3ec5d0e117a859c8`
and contains all 128 migrations through additive
`0127_public_trade_lead_customer_address.sql`.

The public enquiry separates first and last name for searchable CRM records.
Postcode drives an exact suburb and state choice before street address and
optional unit number. Customers can select any of 11 services or select all.
Every active platform-approved TLink trade with a matching declared service and
service area is eligible for the handoff; there is no six-trade cap.

Australian Energy Assessments retains the complete address for its private CRM
record. Email and postcode support trade replies, while the household separately
controls whether trades also receive name, phone and street address. The public
enquiry contains no customer-account prompt. A successful response opens a
native gateway to electricity comparison, gas comparison, the rebate calculator
and the printable plan.

Plan-result next-step actions use light-mint surfaces with dark text and a
full-width mobile layout. Live DOM QA confirmed first and last name, postcode to
suburb/state to street/unit progression, all 11 services, privacy toggles and no
account prompt. Fresh production assets are `HomeEnergyPlanner-BCCDCklm.js` and
`HomeEnergyPlanner-DMhDf6y_.css`.

Final `npm.cmd run validate` passed typecheck, warning-free lint, integration,
1,882 tests with 1,872 passed, 10 intentional skips and 0 failures, `db:check`,
the customer-plan PDF audit, production build and Sites bundle audit.
`/api/health` returned HTTP 200. Postcode `3000` resolved Melbourne, VIC; `0872`
exposed valid NT, SA and WA locality tuples; invalid `9999` returned the expected
HTTP 400. Recent Worker outcomes were clean apart from that deliberate 400
validation probe.

Browser QA verified readable light-mint actions. A temporary client-side
successful-response mock opened the native gateway without sending a real lead,
and verified its four exact destinations and 390-pixel layout. The authorised
internal lead-webhook probe was not run because no local test token exists;
hosted v14 identity and signed lead delivery remain unverified, not failed. The
exact committed Apps Script relay source was saved and an update of the existing
deployment to version 14 was initiated.

## Prior complete guided home energy journey release

Milestone `AEA-COMPLETE-GUIDED-HOME-ENERGY-JOURNEY-52` was implemented by
application commit `c75ff7bb4355f2f74bc9996527900c3d515ab85e` and corrected for the
compact mobile header by exact executable commit
`6df3fab3c9eaca55445cf1c3f16e58b276aae6fd`. That historical commit is pushed
to the GitHub branch, GitHub `main` and Sites internal `main`.

Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_cd22401f7e1c819197951851476ec4d8`
and deployment `appgdep_6a79b1799b988191a1ac6ac58888e134` identify historical
Sites version 307 from the exact corrective source. Deployment succeeded with
environment revision 20 under provider identity
`info294029--aea-energy-comparison` at
`https://compare.ausenergyassessments.com` and
`https://aea-energy-comparison.info294029.chatgpt.site`. Sites stored 391 files
and 37,744,640 bytes with content hash
`sha256:77467b54e8262afe476a5f57460b15da11d5b5b6b286e9d54bbdfeda74c69806`.
Version 307 was superseded by historical version 308.

Historical Sites version 306 saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_60682607e5148191aa5351d3716bd9df`
and deployment `appgdep_6a79aa88b3088191af653a395a2501a1` identify exact
commit `c75ff7bb4355f2f74bc9996527900c3d515ab85e`. Sites stored 391 files and
37,744,640 bytes with content hash
`sha256:61319a3fa5e852f5f8c9edbe8fe94a1508e612147a5252907d477e9da5084fd8`.
Version 306 is historical and superseded by the v307 mobile-header hotfix.

The public planner is a complete 38-screen, one-question-at-a-time intake with a
plain-language `Not sure` path and conditional question skipping. It preserves
bounded home, equipment, envelope and priority answers through the no-account
enquiry, free-account handoff, printable plan and professional report without
asking the household to enter unsafe roof, subfloor or electrical areas.

Results present answer-specific Australian Government-aligned quick wins, an
ordered upgrade roadmap, a no-account enquiry, a distinct free-account action,
the printable plan and clear electricity, gas, calculator and rebate handoffs.
Electricity and gas comparisons use guided three-step journeys, retain NMI and
interval-data privacy, calculation evidence and retailer checks, and give one
clear next action after results.

All customer-facing copy spells out Australian Energy Assessments. At a
390-pixel viewport, the compact public header presents Account then the TLink
logo without a separator dot or document overflow. The professional trade
workspace remains static.

The shared report identity is
`2026-08-10-professional-personalised-report-v5`, design identity is
`2026-08-10-professional-personalised-report-design-v4` and PDF identity is
`2026-08-10-personalised-plan-pdf-v7`. The PDF audit rendered 18 tagged pages,
embedded both font programs and checked 37 links. July 2026 NatHERS Existing
Homes guidance and technical material and Australian Government quick-win
sources are planning references only. This self-reported plan is not a NatHERS
rating, assessment or endorsement.

Google Apps Script relay version 13 retains deployment ID
`AKfycbxBjHL_I3aw0FsGkOVaUDic6AwW1W0ItuxadP1NF-0NolTwLahYnc9PsGpPAdv2tMqW`.
The signed operational monitor returned exact `healthy`: `site_runtime` HTTP 200
in 1,134 ms, `electricity_plans` HTTP 200 in 43,155 ms, `gas_plans` HTTP 200 in
15,840 ms and signed `lead_delivery` HTTP 200 in 2,588 ms for probe
`3d36c715-4904-4a1b-bde3-aa3e8253c74b`. No real customer lead was submitted.

Full validation passed with 1,859 tests passed, 10 intentionally skipped and 0
failed, typecheck, warning-free lint, production build, all 127 migrations, the
customer-plan PDF audit and the Sites bundle audit. The v307 mobile-header
correction then passed 22 of 22 focused checks, typecheck, lint and production
build.

Live v306 QA exercised desktop and 390-pixel planner progression across all 38
screens, electricity and gas guided handoffs, full brand naming and no horizontal
overflow. Live v307 QA confirmed Account then TLink, no separator dot and no
horizontal overflow at 390 pixels. `/api/health` returned HTTP 200 and the recent
Sites Worker errors-only query was empty.

## Prior personalised plan and open trade lead release

Milestone `AEA-PERSONALISED-PLAN-OPEN-TRADE-LEADS-51` was implemented by
application commit `a0fcbf200ece76f68bbd83c298f1d556333c615e` and corrected for production
PDF fonts by exact executable commit `79f7e2e5be14464410ba40a749453c7473b22d4d`.
Both are pushed to the GitHub branch, GitHub `main` and Sites internal `main`.
Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_248c3d6df9448191b171e990ac8dfdd1`
and deployment `appgdep_6a797f25df8c819187590b70811a6794` identify Sites
version 305 from the exact corrective source. Deployment succeeded with
environment revision 20 under provider identity
`info294029--aea-energy-comparison` at
`https://compare.ausenergyassessments.com` and
`https://aea-energy-comparison.info294029.chatgpt.site`.

Sites stored 391 files and 37,201,920 bytes with content hash
`sha256:e2869ae853c4e927c32799128bb83133c7a3d1974effd60ed23baacec5ae6976`.
No separate local v305 release-archive identity was supplied. Historical Sites
version 303 retains its archive, saved-version and deployment identities in the
table above. Intermediate Sites version 304 exposed a production-only runtime
fetch stall for PDF fonts and is superseded by v305.

The public header, journey, question card, result and enquiry use one responsive
width contract. A reduced-motion-aware holographic energy field adds depth to
the customer experience while the professional trade workspace remains static.
The home intake records property type, storeys, approximate internal floor area,
occupants and shared walls. One plain-language approval question covers
apartments, units, townhouses, villas, duplexes, strata, body corporate, owners
corporation and shared common property. External-wall insulation remains a
separate fact and is not inferred from party walls.

The customer plan email attaches a personalised report with a cover, property
context, priorities, quick wins and useful AEA and government resources. The
exact report identity is `2026-08-10-personalised-report-v4`, the design identity
is `2026-08-10-personalised-report-design-v3` and the PDF identity is
`2026-08-10-personalised-plan-pdf-v7`.

A consented no-account enquiry creates one idempotent public opportunity and one
private contact-release record. Platform approval is authoritative. Every active
platform-approved installer with a declared matching service and state and any
active matching service area is included. There is no six-trade cap and no
separate capability-qualification subsystem. Contact disclosure and notification
recheck current platform approval and consent. Manual assignment applies the
same platform-approval, service, state and service-area boundary.

Australian Energy Assessments retains the submitted name, email, phone and
postcode for its own record. Every matching-trade handoff includes email,
postcode, service and the non-empty customer question. The customer separately
chooses whether trades receive their name and phone. The full plan and PDF remain
private and are not added to the opportunity payload.

Forward migration `0126_public_trade_lead_contact_release.sql` adds the private
contact-release ledger and the unique non-empty opportunity source-reference
contract. The production preflight found 210 opportunities, 210 non-empty source
references and 0 duplicate source references. After deployment, the refreshed
signed-in owner Database console reported 239 application tables and confirmed
that `public_trade_lead_contact_releases` is present. The migration chain ends at
`0126`; there is no per-service approval migration or table.

The Google Apps Script relay uses a signed, freshness-bounded envelope and one
stable submission identity across retries. Repeated delivery is deduplicated
before downstream effects. Historical version 12 deployment
`AKfycbxBjHL_I3aw0FsGkOVaUDic6AwW1W0ItuxadP1NF-0NolTwLahYnc9PsGpPAdv2tMqW`
served v305. Legacy version 10 deployment
`AKfycbwstZJE6asc39Mtbw1uEN_IE0osNOqcHvRV-Ope-AKfOgooEXMVHr5Hff2gHPXSv308`
is archived.

The signed `runOperationalHealthCheck` ran from 18:08:25 to 18:09:18 Sydney time
on 10 August 2026. Monitor `api-health-1786349306423` was `healthy`:
`site_runtime` HTTP 200 in 1,555 ms, `electricity_plans` HTTP 200 in 35,575 ms,
`gas_plans` HTTP 200 in 13,232 ms and `lead_delivery` HTTP 200 in 2,193 ms for
probe `7bbd1b86-db74-4b0f-acc9-290ff8ae9469`. Sites Worker request
`a28d84795b0fba39` returned HTTP 200 with outcome `ok`, 1,198 ms wall time and 7
ms CPU. A final five-minute errors-only query returned zero events.

Full `npm.cmd run validate` passed typecheck, lint, integration, all 1,858 main
tests with 10 intentional skips and zero failures, `db:check`, the PDF audit,
the production build and the Sites bundle audit. The focused font, public and
account group passed 41 of 41.

Live v305 result and print QA preserved Townhouse, two storeys, 100-199 m2,
three/four occupants and two or more shared sides. Quick wins, optional
name/phone sharing and the private full-plan boundary were present. The
impossible all-walls-adjoin-other-dwellings option was absent, and desktop
client width equalled scroll width.

The v305 correction bundles and validates the existing Liberation Sans regular
and bold fonts without a customer-plan PDF network fetch. Production PDF
requests `a28d5de18fe874e0` and `a28d603abf6674e0` returned HTTP 200
`application/pdf` in 467/441 ms wall/CPU and 452/430 ms wall/CPU respectively.
Local Cloudflare validation returned a valid 268,767-byte PDF in 203 ms cold and
115 ms cached. The PDF audit found 10 tagged pages and two embedded font
programs.

The Sites control plane recheck kept deployment
`appgdep_6a797f25df8c819187590b70811a6794` succeeded at environment revision 20,
last updated `2026-08-10T07:38:34.260391Z`. The custom domain
`compare.ausenergyassessments.com` remained active with an active provider and
SSL.

No real customer lead was submitted. The post-v305 mobile viewport override did
not apply, so no new live mobile emulation is claimed. Earlier 341-pixel QA of
the same visual source had no overflow; the v305 font correction did not change
that visual source.

Independent review noted one non-blocking P2: administrator allocation after
consent withdrawal can retain an inaccessible internal match. Current customer
contact remains hidden and no notification is sent. This does not broaden trade
access or change the authoritative platform-approval gate.

## Prior immersive plan action handoff release

Milestone `AEA-IMMERSIVE-PLAN-ACTION-HANDOFF-50` is released from exact
executable application commit `f797ab7ee447bc31d66b5760f6613e46f107e97d`,
pushed to the GitHub branch and Sites internal `main`, as Sites version 302.
Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_33c4dd63992481919b3d760cee8831fd`
has content hash
`sha256:1e2af6133642887179c6887212801973a49006bf9a4f76a3f98d9eb3daf06300`
across 388 stored files and 37,048,320 stored bytes. Deployment
`appgdep_6a790aefc05c8191b4a03f72181f7031` succeeded with environment revision
19 under provider identity `info294029--aea-energy-comparison` at
`https://compare.ausenergyassessments.com` and
`https://aea-energy-comparison.info294029.chatgpt.site`.

Local archive `.openai/site-release-f797ab7.tar.gz` is 11,484,967 compressed
bytes with SHA-256
`291686F6352979EBE7C9E342BFB20BF67FBE0D3796BB68A6B3A530391333AFD2`,
402 tar entries and all 126 migrations.

The generated home image is visible on the public home and planner. The semantic
four-stage journey adds progressive CSS 3D and pointer depth without WebGL,
canvas or video and has a reduced-motion path. The draught intake separates
`Open wall vents` from `Open or unused chimney or flue`; the duplicate
`Heat-pump space heating` choice is absent. Precise legacy heat-pump-space values
normalise into reverse-cycle air conditioning rather than creating a second
current heating category.

Plan results put `Start here` and answer-specific `Quick wins` before the longer
roadmap. Advice is conditional and can cover filters and app controls, layers or
electric throws, ventilation and moisture, hot-water routines, appliance timing,
solar load shifting, EV charging, fans and shading without presenting irrelevant
systems as installed.

The public result provides a no-account basic enquiry and a separate `Create free
account` action. The enquiry accepts only name, email and/or phone, postcode, one
interest, an optional message and explicit consent. It does not transmit plan
answers, NMI, interval data, usage, budget, address or account data. Enquiries
remain `hold_for_authority_review` with `autoSend: false`. Timing alone no longer
filters a valid request, honeypot traffic remains filtered and the client cannot
describe a filtered request as received. No lead was submitted during release
QA.

Shared navigation and result widths were corrected without changing the static
trade workspace. No customer-shareable rebate receipt was added. The Google Apps
Script relay source was updated for the home-upgrade enquiry, but its hosted
Apps Script deployment remains unverified.

Full `npm.cmd run validate` passed before deployment. Independent release review
found no remaining P0 or P1 issue.

Desktop live QA measured equal 1,407-pixel client and scroll widths with all
navigation destinations visible. The decoded home image was 1,253 pixels wide,
the `/plan` image was 1,313 pixels wide and the semantic flow was present. The
result showed `Start here`, `Quick wins`, the no-account basic enquiry and the
distinct account action. Live choices showed separate `Open wall vents` and
`Open or unused chimney or flue` options and no `Heat-pump space heating`
option.

At a 390-pixel mobile override, client and scroll widths were both 375 pixels,
the form was 297.6 pixels wide, navigation was 325.6 pixels wide and the image
remained visible at 1,055 pixels intrinsic width. The browser showed no warnings
or errors, and the viewport was reset after QA.

## Prior immersive customer journey and mixed water-heater quote release

Milestone `AEA-IMMERSIVE-CUSTOMER-JOURNEY-49` is historical and was released
from exact executable application commit
`bc4096d61cb493e819555d72113d0c77d45a1653`, pushed to the GitHub branch and
Sites internal `main`, as Sites version 301. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_57a5cb197f548191a5ef29ab9c99f59e`
has content hash
`sha256:3bbab6b63c31708d6b9ded69b50da11e31d45ff75557d82823d3b12fc4a02e3b`
across 385 stored files and 35,328,000 stored bytes. Deployment
`appgdep_6a7898485dd48191acb31466092b5fe8` succeeded with environment
revision 19 under provider identity `info294029--aea-energy-comparison` at
`https://compare.ausenergyassessments.com`.

Local archive `.openai/site-release-bc4096d.tar.gz` is 9,823,592 compressed
bytes with SHA-256
`5ae1990b73dd2fd54bebfc5182b8a1616fc0a51afd925ecd09cfd726eebc01a3`,
399 tar entries, 385 files and all 126 migrations.

The public home is a semantic lightweight CSS and HTML spatial experience with
no canvas, WebGL or video. It supports reduced-motion preferences and responsive
desktop, laptop and mobile layouts. The planner is task-first, result pages show
a clear `Start here` action and the TLink logo links directly to the trade
dashboard. The trade route remains static and does not mount public animation.

Quote mode now accepts mixed exact approved SRES solar-water-heater and
air-source-heat-pump rows and VEU 1C, 1D, 3C and 3D rows, with up to 10 systems
in one estimate. Strict compliance remains fail-closed at one unit. Mixed-system
quote support does not authorise certificate actions or relax exact product,
effective-date or formula validation. No customer-shareable rebate receipt was
added.

Full validation passed typecheck, lint, 32 of 32 integration tests, 1,803 main
tests with 1,793 passed, 10 intentionally skipped and 0 failed, all 126
migrations, the customer-plan PDF audit, the production build and the Sites
audit. Independent focused final validation passed 115 of 115.

Signed-out live QA verified the public home, `/plan`, the result `Start here`
action and `/calculator`. Native future date `2026-09-03` persisted and the live
solar-PV result was 39 STCs. The browser console showed no warnings or errors.
Live trade-route QA confirmed a static route with no public animation. Both live
browser sessions presented the sign-in boundary, so signed-in dashboard QA was
unavailable and no signed-in v301 dashboard claim is made.

GEMS remains fail-closed. The accepted commercial-refrigerator artifact has
7,500 rows with SHA-256
`dcd5e18d9c58ddf13cde8aa1c00f48c704965b7156db61b1a330eef2752d73df`.
The held candidate has 7,499 unique rows with SHA-256
`db6068208c9bc6fca9033879a166dbce1ad0941e376aea786ac5b155dd013b09`.
The exact missing record is unknown without authorised read-only access to the
retained R2 bytes. GEMS-backed pathways remain stale and must not be represented
as active or current.

## Prior calculator usability and product-authority release

Milestone `AEA-CALCULATOR-USABILITY-AUTHORITY-48` is released from exact
executable application commit `ca3d84a497258426c7ab34c87e8059df1cba2a27` as
Sites version 300. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_e084d0c2568c81918bdcf23adc78ad5e`
has content hash
`sha256:29ca942f7801e5657cff10f4dd2e1e5dde14fc9386f19fb51f6691703c58db73`
across 384 files and 33,607,680 bytes. Deployment
`appgdep_6a7875602838819182dc5ba7dec6366b` succeeded with
environment revision 19 at `https://compare.ausenergyassessments.com`.
Local archive `.openai/site-release-ca3d84a.tar.gz` is 8,175,111 bytes with
SHA-256 `a2df1764b0850d46f8088ddd8fe6e8c422d6072f9560df08d43fdba81f82a79a`,
398 entries and all 126 migrations. Initial application commit
`c9fb34115209c0ea0a1fc02ee2095250458c256f` is historical Sites version 298.

The release adds an anonymous quote-only `/calculator` route using the same
governed estimate contract without granting registry refresh, compliance or
certificate authority. The signed-out customer landing page has one dominant
home-plan start, a one-question-at-a-time planner, plain household taxonomy and
a direct TLink login beside Account. The planner separates hydronic heating,
wood heating, air conditioning and heat pumps and includes electric hot water
with a gas booster and two-phase electrical supply.

Calculator usability and flexibility are bounded as follows:

- Activity 15 exposes named weather-sealing scenarios for doors, windows,
  exhaust fans, wall vents, temporary and permanent chimney or flue sealing and
  evaporative-cooler outlets;
- future installation dates remain selectable only inside the applicable
  program and selected-product effective windows;
- VEU and SRES heat-pump or solar-water-heater estimates accept 1 to 10 units of
  one identical approved model, while mixed-model multi-unit jobs remain
  unsupported;
- VEU Part 6 accepts a repeatable indoor-unit list for multi-split and
  variable-refrigerant-flow quote estimates and supports packaged-system
  quote-only estimates; packaged-system compliance and other strict
  multi-product compliance bundles remain blocked; and
- a verified trade can enter one exact customer discount and apply it to the
  next quote or invoice. Certificate counts are not automatically converted to
  dollars because certificate prices and provider fees are not scheme formula
  inputs.

The released source includes the official TESSA D17 to D20 automatic registry
implementation, which retained exact source bytes and effective-dated product
state. The live official source used for source validation contained 746 rows,
comprising 663 `Active` and 83
`Cancelled`, with source SHA-256
`3770ac57885bbd968e35e25c67b4546e9ff6d4325c63cf4c4592a9b5da0178b0`.
Version-300 administrator QA activated the TESSA snapshot as current. The D17
picker exposed 70 official brands, or 71 options including the placeholder;
Aestiva exposed four exact models, or five options including the placeholder.

No customer-shareable rebate receipt is included. The product owner rejected
that artifact as unnecessary; the released workflow stops at the practical
quote or invoice discount handoff.

The three required licensed CEC keys are absent from Sites:

- `CREDITEX_CEC_BATTERY_API_USERNAME`;
- `CREDITEX_CEC_BATTERY_API_PASSWORD`; and
- `CREDITEX_CEC_BATTERY_LICENCE_REFERENCE`.

BESS1 and BESS2 therefore remain pending credentials and an accepted activated
snapshot. BESS3 and BESS4 remain blocked because the current licensed CEC
contract does not supply the exact Rule-required maximum rated AC inverter
output. These are source-authority limits, not user-role or licence locks.

Historical version-298 public QA confirmed the homepage, `/plan` and
`/calculator`, plus visible Account and TLink login links. A public SRES
small-scale solar PV estimate for future date 17 August 2026, postcode 3000 and
6.6 kW returned 39 STCs.

Version-300 signed-in trade QA returned 39 STCs for small-scale solar PV using
installation date 9 August 2026, postcode 3000 and 6.6 kW. It also verified the
VEU 1C repeated identical-unit quantity and Activity 15 plain-English scenario
flow. Version-300 administrator QA ran TESSA before GEMS and confirmed the
activated TESSA picker counts above. No quote, invoice, certificate or customer
record was written.

The subsequent GEMS refresh failed closed because official resource
`gems-commercial-refrigerators` decreased from 7,500 to 7,499 rows. Current
public GEMS search returns `OFFICIAL_PRODUCT_REGISTRY_STALE`. GEMS-backed
calculators must not be represented as active or current until the prior and
current retained official bytes are exactly reviewed and the decrease is
accepted or rejected through the governed process.

## Prior deployed simplified quote calculator, VEU registry and PDRS runtime release

The guarded registry foundation was released in exact application source
`1d77ab222638d3d43d9a49cac0b486173ce88e18` as Sites version 293. The complete
governed VEU calculator was then committed as
`d192d46b4e2056114251ec7cb0e3cfca3b5ea5d9` and deployed as Sites version 294
through `appgdep_6a77aa33d1288191965ba076f690dd46`. Exact corrective source
`ad63b90a4e99211998aa1947b7ddd61d5ac1f640` bounds registry-history writes and is
historical Sites version 295. Exact guided calculator and PDRS source
`1d3abe172e4eb2fa006fab639233cda49a6d37d4` is historical Sites version 296.
Exact simplified quote-calculator source
`11f4721b678425a4294e95c631e0d37d3fab0ffd` is historical Sites version 297. It is
saved as
`appgprj_6a550c378000819185caf094173422bb~appgver_f6c71f20596c8191a59a1ee2c23045df`
with 378 stored files, 33,105,920 stored bytes and content hash
`sha256:03f919b3ec2902590c8079a1d6edf9d725e6163bb515ec6b761be3ed12b099c5`.
The 8,158,365-byte publication archive had SHA-256
`FCB2FA3E954FA758EB069C70B76A712C1FC23FEC0EC432380EBD3B58D8646563`
and was removed locally after Sites accepted the package and recorded custody.
Deployment `appgdep_6a781d231ee08191a7d506389be1676b` succeeded with environment
revision 19 at the custom domain `https://compare.ausenergyassessments.com` and
provider URL `https://aea-energy-comparison.info294029.chatgpt.site`.

The current production snapshot contains exactly 75,492 Public Visible rows:
64,715 with source status `Approved` and 10,777 with source status `Legacy`.
The importer retains exact received source bytes, hashes and custody metadata in
content-addressed R2 objects. D1 stores indexed normalized current and historical
rows, the source manifest, snapshot identity, registry category, status and
effective dates needed for fast picker search and server-side validation.
Calculations query D1 only and never download or parse the Public Registry.

The production VEU refresh POST succeeded with HTTP 200 under request and Ray
identifier `a2821aca0bc9b95b`, using 70.404 seconds wall time and 3.748 seconds
CPU time. The active 75,492-row projection reports UI snapshot prefix
`78853aad-a77...`; the full snapshot identifier was not captured and is not
claimed. The earlier pre-optimization refresh returned HTTP 503 at the intended
fail-closed resource boundary. The optimized refresh subsequently succeeded and
later product GET requests returned HTTP 200.

The released calculator contains 35 controlled Australian program pathways and
216 activity templates. Its VEU catalogue has 32 definitions, 30 formula-ready
aggregate codes and 27 executable aggregate paths: 21 fully available families
plus six enforced partial subsets. The fully available set is `3`, `13`, `15`,
`17`, `22`, `24`, `25`, `26`, `27`, `30`, `35`, `36`, `37`, `38`, `39`,
`40`, `41`, `42`, `43`, `44` and `48`. Codes `14`, `28` and `32` are also
formula-ready but remain source-gated.

The shared quote flow now follows a short activity, plain-English scenario,
date, brand, model, postcode and formula-input sequence. It omits compliance
attestations such as consumer-fact-sheet, disposal and warranty questions from
the quote calculator, keeps registry and calculation evidence under collapsed
details and removes registry refresh from the trade surface. Source trust,
accepted-snapshot freshness and installation-date eligibility remain enforced
server-side. Quote mode is estimate-only; the default compliance path remains
strict.

Future quote dates follow the official rule windows rather than today's date.
VEU accepts dates from 30 June 2026 onward subject to the selected product's
effective window. SRES accepts dates through 2030. NSW and local programs use
their official effective windows.

The exact `partial_estimate_available` boundaries are:

- `1`: Exact estimates are available for 1C small systems and supported 1D
  systems. The 1C medium-system Bs/Be conflict between official sources remains
  fail-closed.
- `6`: Exact estimates are available for supported single-split and multi-split
  systems. Multi-split estimates use the approved outdoor unit plus the total
  connected indoor-unit capacities; packaged systems remain fail-closed.
- `31`: Exact estimates are available for 31A motors selected from the
  installation-date GEMS register. Activity 31B remains fail-closed until an
  exact VEU-approved product contract is available.
- `33`: Exact estimates are available for 33A products selected from the
  installation-date VEU Public Registry. Activity 33B remains fail-closed
  because the governed registry connector has no exact 33B product contract.
- `34`: Exact estimates are available only for sites that are not required to
  comply with Building Code Part J6. The Part J6 baseline branch remains
  fail-closed.
- `46`: Exact historical estimates require an installation-date-eligible Legacy
  VEU product. The current Public Registry has no Approved activity 46 product
  for a current installation.

National coverage is 50 `estimate_available` plus 6
`partial_estimate_available`, for 56 of 216 executable templates and 160 blocked
or non-executable templates. The sealed coverage hash is
`sha256:35e5ff0ff2bacff2504305a30be71c8b38ebe285f33d729bb842c364df124347`.
Certificate actions enabled remain 0.

Every formula-dependent VEU product must match the exact official category,
status and installation-date window. Only an `Approved` row inside its declared
inclusive window or a `Legacy` row inside its exact closed inclusive window can
count. GEMS-only, fuzzy, current `Legacy` and out-of-window matches fail closed.

Signed-in production QA passed on Sites version 297. On the trade dashboard, a
future-date SRES solar-PV quote for 17 August 2026, postcode 3000 and 6.6 kW
returned 39 STCs. A VEU Activity 6 scenario (xi) quote for ERS Tech model
`ERS-AC24KWH-G` on 17 August 2026 with 3.5 kW indoor heating and cooling
capacities returned 2 VEECs. Consumer-fact-sheet and disposal questions were
absent, registry refresh was absent and calculation details were collapsed.
The signed-in administrator calculator loaded at release 297. Certificate
actions remained disabled.

Exact source `11f4721b678425a4294e95c631e0d37d3fab0ffd` is pushed to GitHub and
the Sites managed source branch. Its deployment retained the sealed 56-of-216
calculation coverage result and active 75,492-row VEU registry projection while
adding the simplified estimate-only quote contract and future-date handling
verified above.

Remaining governed boundaries are exact:

- Activity 14 has no live Public Registry rows;
- Activity 28 has no governed connector or rows;
- Activity 32 has no stable exact VEU-to-GEMS crosslink and must never use fuzzy
  matching;
- Activity 46 has no current `Approved` rows and retains 674 `Legacy` rows for
  exact in-window historical use only;
- Activity 45 is closed;
- Activity 47 BESS1 and BESS2 definitions, licensed CEC POST route and nightly
  worker path are deployed, but no accepted licensed snapshot exists because
  the three central Sites CEC credentials are missing;
- BESS3 and BESS4 require exact governed inverter-output authority, and BESS5
  requires the Scheme Administrator's exact recording method;
- Activity 27's AEMO load-table alternative is not enabled;
- packaged VEU Part 6 systems remain unavailable until governed packaged-system
  and multi-indoor-unit bundle selection is implemented;
- the Part 34 J6 refurbishment branch fails closed; and
- PBA and other project-based activities remain governed project methods, not
  deemed calculators.

The shared calculator is estimate-only. Creditex administrators can perform the
guarded registry refresh; verified installers cannot. No certificate was
created, issued, submitted, traded or settled during release or live QA. This
record does not claim that the guarded daily schedule has completed an automatic
production run.

## Prior trade document controls and Jobs release

`TRADE-DOCUMENT-CONTROLS-AND-JOBS-45` is a prior release. Exact application
commit `bfd472359dd8ec2457379bc3694dc3c9503ac7dd` preserves milestone 44 and
completed the owner-scoped Jobs register and customer quote/invoice document
contract. Additive migrations brought the packaged schema total to 124.

The Jobs register uses one authoritative 23-column declaration for the visible
headings, one direct cell per declared value, the column selector, all-field
search and CSV export. Each owner-scoped job occupies one row, horizontal
scrolling preserves dense audit use and mobile values remain callable.

Business settings independently stores the customer-facing business name,
phone, email, bank name, account name, BSB, account number and payment
reference. The explicit 5:1 banner frame controls the same full-width crop used
by quote and invoice previews and new generated documents. Invoice authoring,
storage and output expose item rows, subtotal, discount, GST, total and
configured payment details. Redundant customer-facing `Work`,
`Always included` and `Your base scope` labels are removed.

Every new quote or invoice revision freezes the applicable document identity,
banner framing, payment values and financial presentation. Issued PDF bytes are
retained as the authoritative private artifact and are verified against the
quote or invoice identity before readback. A provider-accepted invoice conflict
enters `reconciliation_required`, remains non-resendable and cannot be presented
as issued until reconciled.

Exact application commit `bfd472359dd8ec2457379bc3694dc3c9503ac7dd` passed
`npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration
tests, 1,494 main tests with 1,492 passed, 2 intentionally skipped and 0 failed,
all 124 migrations, the customer-plan PDF audit, Vinext production build and
Sites server-bundle audit. The focused milestone acceptance review passed 62 of
62 tests. `git diff --check` passed. Experimental Node glob/type-strip and
build-plugin timing notices were non-failing toolchain warnings.

Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_435abd4eabd081918c58fd7adbbb49ae`
stores 364 files and 31,682,560 bytes with content hash
`sha256:e3da2fb4a4e4b342a0825a145d8ee3dd2124002123d04c28de753e6767b734c7`.
Deployment `appgdep_6a7221a403808191a44c354d51922058` succeeded as Sites
version 283 with environment revision 19.

Signed-in custom-domain QA opened Jobs, Schedule and Business without saving or
sending. Jobs rendered 8 company-scoped records, 23 visible headings and 23
direct cells in each inspected row. Schedule retained all 12 CRM tabs and the
expected two existing appointments. Business displayed every settings region
on one page, the 5:1 crop controls and side-by-side quote/invoice previews. The
previews showed the full-width banner, customer-facing business identity, item
grid, $4,040 subtotal, $200 discount, $384 GST, $4,224 total and payment area.

Public root, `/api/health` and `/direct-trade/dashboard` returned HTTP 200. Sites
reported the version-283 deployment as succeeded. The final 30-minute
errors-only production Worker query returned zero events. Release QA did not
upload branding, save settings, issue or send a quote or invoice, or create or
change a customer, job, intent, case, evidence, certificate, submission, trade
or settlement record.

Controlled Gmail and Outlook quote and invoice delivery, receipt and provider
callback reconciliation remain unverified. The invoice provider boundary is
source-tested, but no production invoice was sent. A legacy issued PDF without
provable retained bytes fails closed and requires a new revision. An approved
Australian production address provider remains unconfigured. Complete,
independently approved manual VEU, SRES/STC and NSW governed bundles remain to
be exercised through the live non-submitting workflow.

## Previous trade workspace delivery-recovery release

`TRADE-WORKSPACE-DELIVERY-RECOVERY-44` is a historical release. Exact application
commit `9c278bb23f3f5eb9c3878c5a4cfc946264f1a29c` contains primary TLink recovery
commit `b7e40751e2556ffc64e37704c641a6e917046bb6` plus the worker-safe legacy
electricity fallback correction. Sites version 281 from the primary recovery
commit was superseded during release QA after the inherited fallback route
returned HTTP 500. No migration was added.

Fourteen controlled themes now govern the complete trade header, search,
navigation rail, controls, workspace surfaces and customer documents with
readable contrast. Business presents Account, Appearance, Service areas, Quote
defaults, Notifications, Templates and Close account on one scroll page with
local save actions. Safe partial profile updates preserve omitted notification
and availability values. Jobs uses the available workspace width, retains the
company-scoped Dataforce-aligned register and callable mobile values, and
Schedule retains the permanent installer CRM navigation.

Quote issuance preflights the exact server PDF before creating an immutable
customer review link. PDF generation falls back to worker-safe standard fonts
when bundled font assets cannot be loaded. Existing issued review, PDF and media
reads accept only the active customer token or current verified trade owner;
customer mutations remain token-bound. Successful provider submission is
recorded as `provider_accepted`, not as inbox delivery.

The lead route and authorised relay share a 20-second downstream timeout while
the outer health check allows 25 seconds. The no-index electricity fallback no
longer reads from the Worker filesystem; it returns a no-store HTTP 307 to the
deployed legacy asset, whose HTML contains an explicit no-index directive.

Exact application commit `9c278bb23f3f5eb9c3878c5a4cfc946264f1a29c`
passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31
integration tests, 1,466 main tests with 1,464 passed, 2 intentionally skipped
and 0 failed, all 121 migrations, the customer-plan PDF audit, Vinext production
build and Sites server-bundle audit. The TLink recovery-focused set passed 104
of 104 before the final fallback correction, and the fallback set passed 8 of 8
after it. `git diff --check` passed. Experimental Node glob/type-strip and
build-plugin timing notices were non-failing toolchain warnings.

Archive `.openai/site-release-9c278bb.tar.gz` is 7,829,193 bytes with SHA-256
`EC1B166DD9957DA17C4F889E4802C349A76A71454627769D12B5BFD5A1E503E2`,
375 entries, all 121 migrations and zero CSV entries. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_fd653b2ad83c81918fd23a3366735271`
stores 361 files and 31,907,840 bytes with content hash
`sha256:86f36c8d918da0ae1b634db811ed645a27d4a50a1a35acc0eba79d5e20488d96`.
Deployment `appgdep_6a71e7f3af3c81918f0f89a3e0354d36` succeeded as Sites
version 282 with environment revision 19.

Signed-in custom-domain QA opened Jobs, Schedule, Business and one existing test
quote without saving or sending. Jobs rendered 8 company-scoped records across
the Dataforce-aligned register and used 1,661 px of the 2,048 px viewport.
Schedule retained all 12 CRM tabs and showed the expected two test appointments.
Business showed all seven settings regions, local save actions, 14 themes and
three border styles on one page. The existing customer review rendered the
exact $4,444.00 total, decision controls and no visible compliance-partner name.
Its PDF returned HTTP 200, `application/pdf`, 399,318 bytes and a valid
`%PDF-1.7` header. Opening the review records the designed daily `viewed` audit
event, creating it once or reusing it for that day.

Public root, health, compare, gas, direct-trade and dashboard probes returned
HTTP 200. After version 281 exposed the inherited fallback failure and version
282 propagated, ten consecutive custom-domain fallback probes returned HTTP 307
to the deployed legacy asset; the target returned HTTP 200 and contained the
no-index meta directive.
The final five-minute errors-only production Worker log returned zero events;
a subsequent five-probe sample again returned HTTP 307 with `no-store` and
`noindex, nofollow`, while the target and health endpoint both returned HTTP 200.

Release QA did not upload branding, save a theme or setting, add a recipient,
issue or send a quote, accept or decline a quote, close an account, or create or
change a customer, job, intent, case, evidence, certificate, submission, trade
or settlement record. No customer, business, quote version or commercial value
was changed.

Production provider receipt and Gmail or Outlook inbox/client rendering remain
unverified. The reported delivery attempt failed during quote preparation
before provider submission, and no replacement email was sent during QA. The
next authorised lead-delivery monitor run must confirm the new 20/25-second
timeout relationship against the live Google Workspace relay. Unreferenced
removed branding may remain in private object storage until a separately
authorised retention policy exists; branding referenced by an issued document
is retained for integrity. Legacy issued quote versions created before
migration `0120` do not have a frozen document snapshot and are reconstructed
from their retained legacy record. Account recovery and physical record erasure
remain intentionally absent.

## Previous trade business identity and quote-delivery release

`TRADE-BUSINESS-IDENTITY-QUOTE-DELIVERY-43` was the preceding production
release. Exact
application commit `fcfca482b0f86413423af2af8c5ae77054e6186f` adds one
authoritative TLink Business workspace, controlled customer-document branding,
immutable issued quote snapshots, branded provider delivery, server-generated
PDFs and a retained soft account-closure boundary.

Migration `0120_trade_business_identity_and_quote_delivery.sql` adds the
business identity, appearance, service-area, quote-document, delivery and
closure records. Installer and wholesaler account type is immutable. Logo and
banner inputs are signature-checked JPEG or PNG files no larger than 3 MB,
metadata is stripped, and object bytes remain private. Owners can choose six
controlled colour themes, three border styles and at most six postcode/radius
service areas.

Every newly issued quote freezes exact business, branding, recipient, customer,
scope, totals, terms and message values as `trade-quote-document-v1`. Customer
totals are recomputed on the server; supplier cost, markup and margin never
enter the customer snapshot, email or PDF. The current authorised customer email
or a newly authorised additional recipient is used for a branded HTML and text
message plus the matching two-page A4 PDF. Delivery retains message, document,
PDF and provider evidence. `sent` is recorded only after Resend accepts the API
request and returns a provider message ID; inbox delivery remains unverified.
The customer-facing review, media and PDF routes require the exact active review
token and use `no-store`. Owner logo and banner media separately require
verified trade access.

Account closure requires recent Firebase authentication and typed
`CLOSE ACCOUNT`. The atomic D1 batch closes workspace access, records the
retained closure ledger and stable administrator notification, revokes active
quote links, clears token material and suspends active team members. Closed
owners cannot mutate retained identity and see only the terminal closed state.
Firebase deletion, physical erasure and recovery remain separately authorised
future work.

Exact application commit `fcfca482b0f86413423af2af8c5ae77054e6186f`
passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31
integration tests, 1,457 main tests with 1,455 passed, 2 intentionally skipped
and 0 failed, all 121 migrations, the customer-plan PDF audit, Vinext production
build and Sites server-bundle audit. The focused account-closure set passed 22
of 22. Independent final review found no remaining P0, P1 or P2 defect. The
generated two-page A4 quote PDF was rendered through Poppler and visually
inspected after correcting one heading overlap.

Archive `.openai/site-release-fcfca48.tar.gz` is 7,833,168 bytes with SHA-256
`806E919D9144B30A162C051660444F82F7BEAFE542EEBEB954C742675161139B`
and 375 entries, including all 121 migrations and zero CSV entries. Saved
version
`appgprj_6a550c378000819185caf094173422bb~appgver_a6468ced690881919d2e29c591fd11f3`
stores 361 files and 31,856,640 bytes with content hash
`sha256:cf01b5bdf49058a7b12e7177e864c08a17af1203dc23f1e4b22a10ce5d7dcc2c`.
Deployment `appgdep_6a71bf0136dc81918e71ba815cddd0ff` succeeded as Sites
version 280 with environment revision 19.

Signed-in custom-domain QA opened the unified Business, Appearance, Quote
defaults and Templates sections and one existing Quote workspace without
saving or sending. It verified the current authorised recipient,
additional-email and customer-details controls, exact server totals, active
private review link and issued-PDF download. The customer view rendered at
desktop width and 390 px with the exact $4,444.00 total, download and decision
controls, and contained no visible compliance-partner name. Opening that view
records or reuses its designed daily `viewed` audit event; no customer, business,
quote-version or commercial content changed. Health, homepage, dashboard and
every current homepage asset returned HTTP 200. The final five-minute
errors-only Sites worker log contained zero events. Chrome-extension
message-channel warnings were observed but were not application errors.

Release QA did not upload branding, edit a business, add a recipient, issue or
send a quote, accept or decline a quote, close an account, or create or change a
customer, job, intent, case, evidence, certificate, submission, trade or
settlement record. Opening the existing customer review records or reuses its
designed daily `viewed` audit event; no customer, business, quote version or
commercial value was changed. A real Resend receipt and customer email-client
rendering remain unverified. Unreferenced removed branding may remain in private
object storage until an authorised retention policy exists; media referenced by
an issued document is retained for integrity. Legacy pre-`0120` issued versions
do not have a frozen document snapshot and use the retained legacy
reconstruction path.

## Previous trade multi-activity usability release

`TRADE-MULTI-ACTIVITY-USABILITY-42` was the preceding release. Primary application
commit `103439d03a5c322757cea27e77e8b147b6c85590` implemented atomic
multi-activity jobs, mandatory phone and email for new customers, an open
new-customer form beside existing-customer search, a viewport-safe date-time
picker, customer directory filters, callable contacts, dated latest jobs and
schedule quote actions. CRM diagnostic
`ce0996779818690751016dfd5b3efdd8e7c1586e` and guard correction
`82e0faf64906047a5f42fabf83c605edf320cb63` resolved a separate production
CRM schema-guard failure. Subsequent asset diagnostic
`eeb636665a21d230b7150e03d60f614b7f71b1db` isolated the remaining
production-only customer asset failure. Final application commit
`13dbf2ddc4eea32c6a929ef15cb258a263ff99ea` replaces the incompatible
seven-arm timeline compound query with seven bounded reads executed in one D1
batch.

Every selected activity is validated and retained in the same atomic job
transaction. The final review shows each program, activity, schedule,
technician, customer, address and commercial context without implying that a
certificate, rebate or governed case already exists. Installer Jobs keeps the
exact supplied 23-column Dataforce interchange, one job per row and complete
filtered CSV export. The customer directory defaults to first-name then
last-name order. Trade and customer surfaces omit the compliance partner name;
the separately authorised internal portal retains full assigned-job access.

Web and offline completion now fail closed when active governed cases lack
submitted evidence, contain superseded evidence or have changed photo proof.
Changed planned installation dates immutably supersede every still-planned
activity intent in the same guarded schedule transaction. JSON control bodies
are bounded by actual streamed bytes, and offline companion rows remain inside
the selected 500-job cohort and an overall fail-closed cardinality limit.

Exact application commit `13dbf2ddc4eea32c6a929ef15cb258a263ff99ea`
passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31
integration tests, 1,443 main tests with 1,441 passed, 2 intentionally skipped
and 0 failed, all 120 migrations, the customer-plan PDF audit, Vinext
production build and Sites server-bundle audit. The focused D1 asset timeline
suite passed 9 of 9, and independent final review found no remaining P0, P1 or
P2 defect.

Archive `.openai/site-release-13dbf2d.tar.gz` is 7,781,979 bytes with SHA-256
`D6AC82425EC5EE82B84318978177D49F0E41E54DF755094FEC935F7549FDAA67`
and 374 entries, including all 120 migrations and zero CSV entries. Saved
version
`appgprj_6a550c378000819185caf094173422bb~appgver_e113332d3dac8191bff9ed71b5d51487`
stores 360 files and 31,682,560 bytes with content hash
`sha256:1630c642f67fb83d38fd428197e05e4ae32e4bad97c29eb111d6c090760d7dc3`.
Deployment `appgdep_6a7178bb43c08191b86b568dabd45b94` succeeded as Sites
version 279 with environment revision 19.

Signed-in QA exercised New Job without submission, the exact installer job
register and CSV contract, customer sorting, filters and contact actions,
schedule quote access, the assigned internal compliance workspace and the
customer asset register. The final `/api/trade-assets` request returned HTTP
200 under request/ray `a25b2c9d7a1275df`; the asset and timeline UI rendered,
and errors-only worker logs contained zero events. The custom-domain health
endpoint also returned HTTP 200. No customer, job, business, intent, case,
evidence, certificate, submission, trade or settlement record was created or
changed during release QA.

Production environment revision 19 contains `CRM_INTEGRATION_ENCRYPTION_KEY`
but no `TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT` or
`TLINK_ADDRESS_AUTOCOMPLETE_TOKEN`. Verified Australian autocomplete therefore
remains blocked on an approved provider and credential; manual entry remains
available as `manual_pending_review`.

## Prior installer-to-Creditex operating alignment release

`TRADE-CREDITEX-OPERATING-ALIGNMENT-41` is the prior release. Primary
application commit `836bc779f33a5f77fc4a18a41227dc76dfbf9914`,
installer-register correction `c32be214558dd1a20ccb26d04bcf7b054b00f110`
and final production-schema correction
`c51934456c2248da4cfde9a0b759b70d69df56ee` were deployed as Sites versions
272 through 274. Version 274 retained the exact known 23-column Dataforce
register and bounded all 53 internal audit domains to 50-record keyset pages.
Its `.openai/site-release-c519344.tar.gz` archive was 7,775,395 bytes with
SHA-256
`CD5CA5072B17BC6970CB6EDEE0CA1A3C29D195A535397A91C9A0794810975F9C`;
Sites stored 359 files and 31,590,400 bytes with content hash
`sha256:455c203ec7dfe5c21c5559453b33e4e7f1b92910412d9cd4130ac903ccb2aeb7`.
Its persistent production-schema regression reported 106 of 106 passed.

## Prior installer-to-Creditex job handoff release

`TRADE-CREDITEX-JOB-HANDOFF-40` is the prior release from exact application
commit `a45f250ee805aac1545c8643726dfde3964de22b`. Migrations
`0115_trade_creditex_job_intent.sql` and
`0116_trade_crm_write_guard.sql` bring the packaged and audited inventory to
117 migrations.

The installer New Job workflow now uses five short stages: Work, Customer,
Program, Appointment and Review. Certificate or support selection is
progressively disclosed only for compatible work and jurisdiction. Controlled
claim output, program and activity selectors use the same national catalogue
contract as Creditex, while ordinary non-program work stays available.

One guarded write creates or attaches the customer and service site, creates
the job and appointment, and optionally writes an immutable
`tlink-creditex-job-intent-v1` snapshot. Creditex receives an assigned planning
row immediately and can inspect the complete authorised customer, service-site,
installer, commercial, appointment and retained workflow projection.
Credentials, tokens, storage keys and unrelated raw identifiers remain
redacted.

Accepted-quote conversion creates a regulated case only when the exact planned
program and activity still match a published, effective governed activity and
evidence policy. The case and intent link are written in the same database
batch. A stale job, site, activity or date is marked `Re-plan required` and
cannot silently link.

Exact application commit `a45f250ee805aac1545c8643726dfde3964de22b`
passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31
integration tests, the complete application suite, all 117 migrations, the
customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
The final intent, migration, installer wizard, CRM, accepted-handoff, Creditex
portal and field-contract regression set passed 105 of 105. Independent
security, data-boundary and interface review findings were corrected before
release.

Archive `.openai/site-release-a45f250.tar.gz` is 7,758,795 bytes with SHA-256
`23C885EF9D4BD11FA837107740E9B44381D0E8B71CA4432364F3531CFF148CC9`,
369 entries and all 117 migrations. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_1e6ba2c1ae64819197a3b33a13cbb364`
stores 355 files and 31,518,720 bytes with content hash
`sha256:28daf91f4202cf79d0c3c5ecbb7b4f42822bec6725644c3077423b3869e83e0e`.
Deployment `appgdep_6a701f23b43c8191ab61ef23e35166de` succeeded as
Sites version 271 with environment revision 19.

Signed-in installer QA opened the New Job flow, confirmed all five stages and
the conditional certificate selector, and did not submit the form. Signed-in
Creditex QA loaded `Compliance case control`, permanent navigation and the
`Certificate-work register`; it reported 0 assigned jobs. Desktop and compact
checks showed no document-level horizontal overflow. Browser image capture
timed out, so the retained evidence is the live rendered DOM, measured widths
and exercised interactions rather than a new screenshot artifact. No customer,
job, intent, case, evidence object, certificate, submission, trade or settlement
was created.

The national catalogue remains planning-only until exact government sources and
two-person governed publication exist. This release did not directly re-query
production governed program, activity, evidence-policy or case counts. No
certificate-calculation API is assumed, and certificate creation, regulator
submission, trading and settlement remain disabled. A changed plan currently
fails visibly as `Re-plan required`; automatic intent replacement is forward
work. Pre-case audit exposes authorised file and photo metadata, while original
governed evidence bytes remain behind the protected case evidence viewer.

## Prior Creditex governed source intake release

`CREDITEX-GOVERNED-SOURCE-INTAKE-39` is the prior release from exact application commit `8baad519d763f0955e481a925ca9114b4d708653`. It adds no migration; the packaged and audited inventory remains 115 migrations.

Every administrator, case manager, reviewer and auditor can reach a permanent `Official sources` workspace. Administrators and case managers may capture exact government files against server-projected owner-scoped draft targets. Reviewers and auditors may inspect the custody register and retrieve retained bytes. Governance decisions remain restricted to independently verified administrators, and the capturer cannot review their own artifact or binding.

Capture accepts only HTTPS Australian government sources and supported file signatures, retains exact bytes in R2 and computes SHA-256 on the server. Idempotent replay re-reads R2 and verifies exact size and hash. Retained-file access is same-origin, owner-scoped, private, no-store and audited before return; download re-verifies the current R2 bytes and never exposes the storage key. Artifact approval requires the same reviewer's immutable access receipt for the exact artifact, hash and byte count. Binding approval remains unavailable until that artifact has a current independent approval.

The custody register exposes the current official link beside the retained file, exact byte count, SHA-256, citation, artifact and binding decisions and deterministic cursor pagination with an authoritative total. Completed immutable decisions expose no approve or reject control. No capture or review action can activate or publish a rule, evidence policy or calculator, create a regulated case or certificate, send a regulator file, trade or settle.

Exact application commit `8baad519d763f0955e481a925ca9114b4d708653` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, the complete application suite, all 115 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit. The integrated custody, review, workbench, portal, pilot, policy, readiness, calculation and interchange set passed 86 of 86. Independent final review found no remaining blocker against exact replay verification, same-reviewer access receipts, authorised-role inventory access, immutable completed decisions and authoritative pagination.

Archive `.openai/site-release-8baad51.tar.gz` is 7,736,223 bytes with SHA-256 `BDBED88DB3F6675DFB0AD4BF133651F9B4609DA0432F42390DD591D5715205A8`. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_2deae2c2caa081919a369e1cd193bd5d` stores 351 files and 31,406,080 bytes with content hash `sha256:6cf77082dca1a638dc78e094791cd712f2417fdb17bd86c9a0ba772aa041d978`. Deployment `appgdep_6a6fc16429e88191af41bbf10fb18a6a` succeeded as Sites version 270 with environment revision 19.

Signed-in production QA loaded the privacy-minimised Operations workspace, opened the permanent `Official sources` tab and confirmed the contextual `Official source custody` heading. The workbench reported `0 shown of 0 records`, no eligible draft target and disabled capture and pagination controls. A 390 by 844 responsive override retained the complete four-tab workspace, source form and zero state. The override was cleared after QA. No source, policy, job, case, certificate, submission, trade or settlement record was created.

The real governed inventory remains 0. Exact VEU, NSW TESSA and REC Registry bundles are not yet retained or independently approved. A real two-person review must still exercise the exact retained-file access, artifact decision and binding decision sequence against an authorised non-production fixture. Authenticated regulator uploads, acceptance receipts and rejection payloads remain unavailable, and no public authoritative certificate-calculation API contract has been verified.

## Prior shared compare-navigation discovery release

`AEA-SHARED-NAV-DISCOVERY-38` corrected the compare-platform heading from exact application commit `37776ed557d7c0a25d92698f52e87cf59cee05b6`, saved as `appgprj_6a550c378000819185caf094173422bb~appgver_ea8944a8b6d08191bf7b8fd3237619c4` and deployed through `appgdep_6a6fb33354ac8191beb6ef116cbe9bca` as Sites version 269.

`Start` now begins at the visible navigation origin, all seven destinations retain their order, and compact layouts expose a visible `Scroll for more options` cue plus a continuation fade. Desktop hides the cue. Exact source `37776ed557d7c0a25d92698f52e87cf59cee05b6` passed the complete validation gate and its focused navigation set passed 21 of 21.

Archive `.openai/site-release-37776ed.tar.gz` is 7,717,752 bytes with SHA-256 `ED56FF26BE5E160878D8A72E022B703CCEC952058687FD66A7962CB51D269030`. Sites stored 351 files and 31,303,680 bytes with content hash `sha256:bdd4fb3fe2ccad379fe6afc94f5ae92470213388ba2f9c236708b8cffbab0aed`.

## Prior Creditex governed manual-field preflight release

`CREDITEX-GOVERNED-MANUAL-FIELD-PREFLIGHT-37` is the prior release from primary application commit `8c29808a9f4a80acc8e7f2304c4b49268f4f2c49` and D1-compatible corrective commit `5d4b540dcbcb49b3d1d57eda122a4dca86d723bb`. Migrations `0112_creditex_manual_field_capture.sql`, `0113_creditex_synthetic_register.sql` and `0114_creditex_manual_policy_merge.sql` bring the packaged and audited inventory to 115 migrations. Trigger bodies remain installed through the prepared-statement runtime guard path rather than Sites migration parsing.

The AEA Field compliance lane now binds exact original upload bytes, server-calculated SHA-256, capture time, EXIF, GPS, device identity, form version, job and prompt. Multipart and offline recovery are idempotent and append-only, R2 restore is receipt-bound, and required GPS fails closed when absent, mocked or when reported location accuracy is worse than 100 metres. User sign-out attempts server revocation before local purge, and server-side revocation forces sign-out on the next successful sync; offline revocation remains part of physical acceptance. Named physical-device acceptance remains separate from emulator, source and export validation.

Manual forms now compose an immutable published government minimum with a separately editable Creditex operational layer. Creditex can add instructions and prompts but cannot remove, weaken, replace or reorder a minimum. Exact policy bytes, hashes, effective dates, different-identity review, compare-and-swap locking and the composition diff are enforced before approval. Because production still contains zero published government policies, production form approval correctly remains blocked.

The VEU pilot and synthetic manual jobs now share one owner-scoped register, populated source, program, activity, installer, technician, status and postcode facets, and one full audit workspace while preserving the exact 23 supplied Dataforce columns and one row per job. The seven facet reads execute as exact grouped statements in one transactional D1 batch after live QA showed that the original compound derived query failed closed on production D1.

The national calculation inventory deterministically accounts for all 212 activity templates: 6 SRES technologies expose protected expected-entitlement estimates and 206 pathways remain blocked or non-executable. The coverage hash is `sha256:13aacf29e36038eaa3900a5716be816496f0f51574912e61cba7a941911a79de`. VEU, NSW TESSA and REC Registry surfaces expose only blocked readiness descriptors and preflight status. No exact approved TESSA or REC parser, serializer, bulk export, external request, certificate action, trade or settlement control exists in this release.

Exact corrective application commit `5d4b540dcbcb49b3d1d57eda122a4dca86d723bb` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,355 main tests with 1,353 passed, 2 intentionally skipped and 0 failed, all 115 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit. The AEA Field mobile suite passes 20 of 20 together with mobile type checking and lint. Android and iOS Expo exports complete, while the unresolved `android.googleServicesFile: "./google-services.json"` warning and absence of named physical-device acceptance prevent a native-production-readiness claim.

Archive `.openai/site-release-5d4b540.tar.gz` is 7,703,920 bytes with SHA-256 `f1ce735aed060d55e8461814707f53da22fb8845820629b96b6124db541fa989`, 365 entries, all 115 migrations and zero CSV entries. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_95cd969101b08191b89b03aaea09e827` stores 351 files and 31,303,680 bytes with content hash `sha256:b0d80a9e5d0c61084a227f8661df5d0366845ee5ac298c4a671a3eae753126a9`. Deployment `appgdep_6a6fa22d2bb48191b8bd5fd8317cbe9f` succeeded as Sites version 268 with environment revision 19.

Signed-in Chrome QA loaded 300 of 300 pilot jobs with the exact 23 Dataforce headers. All-field search returned the exact requested job and restored the full register; Advanced search exposed controlled stored-value facets; the App Id sort menu closed after an outside click; and double-click opened customer, job, appointment, files, custody, compliance and program-control detail. Evidence reported 32 controlled program pathways and 212 activity templates. Calculators reported 6 executable estimates, 206 blocked or non-executable pathways and 0 certificate actions. Connectors reported 5 safely blocked descriptors, 0 serializers and 0 external sends, with no external-action button. The compact mobile layout kept navigation, search and filters usable without document-level horizontal overflow. Production QA created no form, job, evidence object, certificate or external submission. Recent Sites Worker error-only logs returned zero events; browser logs contained only Chrome-extension asynchronous channel closures with no application stack.

The remaining blockers are explicit: no named physical iOS or Android acceptance matrix, unresolved native Firebase configuration and signing, zero published government policies, no exact approved TESSA v1.7 or REC Registry dictionaries and serializers, no ESC VEU authorised API contract or sandbox, 206 unapproved or non-executable calculation pathways and no production certificate, submission, trading or settlement action.

## Prior Creditex national manual-evidence lab release

`CREDITEX-NATIONAL-MANUAL-EVIDENCE-LAB-36` is the prior release from exact application commit `ecec39abbc65fb5d25aa5d21d6dcfead724bcc0f`. Migration `0111_creditex_manual_evidence_lab.sql` brings the packaged and audited inventory to 112 migrations.

The Evidence workspace now exposes a national synthetic manual-test lab for all 32 controlled Australian program pathways and all 212 activity templates. Creditex can generate an editable activity starter form, add and reorder photo, document, text, number, select, declaration, date and signature prompts, set capture timing and file or metadata controls, lock an immutable test-ready version and create an owner-scoped synthetic job pinned to that exact activity, schema and SHA-256.

Synthetic jobs support draft, field testing, ready for audit, changes required, passed and archived states. The current response snapshot is locked during review. Only an administrator or reviewer can require changes or pass a test at both API and database boundaries. Append-only events retain the complete response snapshot, hash, counts and review note needed to reconstruct a decision.

Creditex operational prompts do not become government rules. A government-requirement candidate must carry an HTTPS source title, version, clause and exact SHA-256, and remains non-authoritative until the separate evidence-policy governance workflow publishes independently approved retained source bytes. No file byte, regulated case, certificate, submission, trade or settlement is created by the manual lab.

Exact application commit `ecec39abbc65fb5d25aa5d21d6dcfead724bcc0f` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,289 main tests with 1,287 passed, 2 intentionally skipped and 0 failed, all 112 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit. The final focused compliance set passed 62 of 62. Independent review found no P0 or P1 blocker; its one database review-role hardening finding was corrected and regression-tested before release.

Archive `.openai/site-release-ecec39a.tar.gz` is 7,629,648 bytes with SHA-256 `2BAFF556C8F963612F6FC4878326C2A1924B38F0AB8E5D1046B00C5ED2044F53`, 361 entries, all 112 migrations and zero CSV entries. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_e42b1932db8481918304dad9fcf28bd2` stored 347 files and 30,883,840 bytes with content hash `sha256:ac05eacd1792bacdb6b5ef4e0dae86149f8cb484678401061e86ca96ddce69cd`. Deployment `appgdep_6a6f4c3dc8b88191a33403ba9acbd5d9` succeeded as Sites version 266 with environment revision 19.

Signed-in production QA loaded the Evidence workspace with catalogue metrics for 32 controlled program pathways and 212 controlled activity templates, two controlled catalogue selectors, the custody boundary, Form builder, Manual jobs and Installer preview. The existing 300-row Jobs register and compact Advanced search drawer remained available. At 390-pixel and 320-pixel responsive overrides the document did not overflow. Browser logs contained no application error.

The real governed inventory remains 0. Production QA did not create a synthetic form or job. The simulator records filenames and capture checks, not original bytes, EXIF, GPS or physical-device acceptance. Government policy merge, main-register projection, TESSA/REC/VEU interchange and live certificate actions remain incomplete and disabled.

## Prior Creditex national calculation foundations release

`CREDITEX-NATIONAL-CALCULATION-FOUNDATIONS-35` is the prior release from exact application commit `5eab88950c1047746484ce2ab4880d8e32be824a`. It does not add a migration; the packaged and audited inventory remains 111 migrations.

The national calculation-readiness catalogue contains 32 controlled Australian government program pathways and 212 activity templates, with exactly one pathway for every activity. Its states distinguish deterministic estimates, governed formula review, official registry and project methods, future activities, closed activities and non-certificate administration. Six SRES activities are estimate-available, 131 activities require governed formula review, and no certificate action is exposed.

The deterministic SRES estimator covers 2026 through 2030 solar photovoltaic, wind, hydro, registered solar water heater, air-source heat pump and eligible solar-battery expected entitlements. Inputs use exact decimal strings and controlled choices where the official source provides a bounded set. Outputs bind source and effective-period identifiers, every formula step, official final rounding and deterministic input, trace, output and receipt hashes. The protected route is authenticated, role-controlled, same-origin, no-store, streaming-body bounded to 16 KiB and cannot mutate a customer, job, case, certificate or external registry.

VEU version 24/version 25 and the current NSW ESS/PDRS rule windows are pinned as calculation-source references, but their formulas remain non-executable until exact source bytes and independently approved calculator assets exist. Closed and not-yet-commenced NSW activities are explicitly unavailable. The connector catalogue records REC Registry bulk upload, ESC VEU authorised API, NSW TESSA CSV/portal, ACT and SA private reporting, and federal project/facility boundaries without inventing a public certificate-write API.

Search, Refresh and Advanced search compute to the same 28-pixel visual contract in collapsed and expanded states. The Jobs register still contains exactly the supplied 23 Dataforce columns and no national-calculation field.

Exact application commit `5eab88950c1047746484ce2ab4880d8e32be824a` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,281 main tests with 1,279 passed, 2 intentionally skipped and 0 failed, all 111 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit. The focused national catalogue, estimator, protected route and operator-workspace suite passed 34 of 34. Independent final review found no remaining P1 or P2 defect and six live REC Registry oracle vectors reconciled.

Archive `.openai/site-release-5eab889.tar.gz` is 7,598,597 bytes with SHA-256 `402682B1F6BB535EA63FDA1DA26B4D9A37D351445457C75A3612B86FDCB32C6F`, 360 entries, all 111 migrations and zero CSV entries. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_123d03e2e4b08191b196236068cca9b0` stored 346 files and 30,638,080 bytes with content hash `sha256:7ee3e873e71c98c648f2fba25ae6d0b83c30eb47b7a6a17bea2c422c14abd0dc`. Deployment `appgdep_6a6f2bac3b588191bb64b2b29c6e1b1b` succeeded as Sites version 265 with environment revision 19.

Signed-in production QA confirmed the 10-installer, 30-technician and 300-job pilot still loads with the exact 23 Dataforce headers. Search, Refresh and Advanced search shared the same computed height, border, background, text colour, font and radius; the open Advanced search drawer retained the same trigger treatment and the Status sort menu closed after an outside click. The Calculators panel reported 212 activities, 6 estimate-available activities, 131 governed-formula-review activities and zero certificate actions. Live interaction returned 45 expected STCs for the default photovoltaic vector and 164 expected STCs for a 40 kWh battery certified on 1 May 2026. NSW PDRS BESS3, BESS4, BESS5 and V2G1 showed `Activity Not Commenced`, while WH1 showed `Activity Closed`. At actual 320-pixel and 390-pixel CSS widths the document did not overflow; the register retained table-owned horizontal scrolling and the calculator stacked into one readable column. Browser review found no application exception.

The real governed inventory remains 0. No single national government calculation API or documented public certificate-write API was found. Exact current VEU, SRES and NSW source bytes are not yet retained and independently approved in R2; official product, participant, licence and zone lookups are not yet materialised; VEU and NSW formula drafts remain blocked; TESSA, ESC VEU and REC Registry submission adapters are not active; and physical-device evidence custody acceptance remains incomplete. Certificate creation, submission, trading and settlement remain disabled.

## Prior Creditex exact Dataforce register and governed authoring release

`CREDITEX-DATAFORCE-REGISTER-GOVERNED-AUTHORING-34` is the prior release from primary application commit `58b92e1f859c62de00e4d8bda11624ab3f1633b8` and corrective application commit `31b152933273db33bfa866bdbc491f6fdc35360a`. It adds migrations `0109` and `0110`, bringing the packaged and audited inventory to 111 migrations.

The signed-in Jobs register now exposes only the exact 23 Dataforce job-list columns, in the exact Dataforce order, with one job per row. TLink governance and compliance fields remain available inside the full audit workspace instead of appearing as additional register columns. The row action is contained within `App Id`, so every populated row has exactly 23 cells and one controlled action. The desktop toolbar remains one line in this order: Density, all-field search, Search, Refresh and Advanced search. All controls are 28 pixels high, and the rightmost Advanced search control opens the existing right-edge drawer. At 320 and 390 pixels the compact toolbar remains one line with no document overflow.

The VEU source register records version 25 as effective from 21 July 2026 and version 24 as effective from 30 June 2026. Operational lookup materialisation is explicitly as-of dated, effective-window constrained and independently approved. Legacy mapping and calculator authoring are append-only and independently reviewed. Calculator artifacts remain draft-only, vectors remain `not_run`, and no authoring path can create a certificate, regulator submission, trade or settlement.

Exact corrective application commit `31b152933273db33bfa866bdbc491f6fdc35360a` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,267 main tests with 1,265 passed, 2 intentionally skipped and 0 failed, all 111 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit. The targeted operations, calculator and schema suite passed 49 of 49. Independent migration and final review reported READY with no P1 or P2 defect.

The corrected archive `.openai/site-release-31b1529.tar.gz` is 7,575,785 bytes with SHA-256 `0AE7AA64CE6D9B93D0A0D6DA65CEC1F11F1ADA8D4D1451E60EEDDD2AF38D87C5`, 360 entries, all 111 migrations and zero CSV entries. Migration `0110_creditex_calculator_authoring.sql` contains zero `CREATE TRIGGER` statements. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_aa8d0183098881918f1fe626a7deb951` stored 346 files and 30,535,680 bytes with content hash `sha256:7add92fd081d36220e266666533ce162585bcf23531889182f7abbbd982a8ea2`. Deployment `appgdep_6a6f09034b10819187e46054254b06b2` succeeded as Sites version 264 with environment revision 19.

Sites version 263 was saved from primary application commit `58b92e1f859c62de00e4d8bda11624ab3f1633b8`, but deployment `appgdep_6a6f0208b8208191ba75d01cd0b659d8` failed before activation with `incomplete input: SQLITE_ERROR`. The migration parser had split calculator trigger bodies at internal semicolons. Sites version 262 remained live throughout, no production change occurred, and the failed version was not redeployed. Corrective commit `31b152933273db33bfa866bdbc491f6fdc35360a` moved those trigger definitions into the existing prepared-statement schema-guard installer before version 264 was saved and deployed.

Signed-in production QA confirmed 10 of 10 installers, 30 of 30 field technicians, 300 of 300 jobs and all 34 activity families. The register rendered the exact 23 Dataforce headers in order, 23 cells per row and 300 controlled row actions. At desktop size, the table owned its 3,540 by 9,576 scroll area with no document overflow. A global `I01-T01` search returned 10 of 10 jobs and resetting it restored 300 of 300. Advanced search opened exactly one dialog with 25 controlled selects, focused Close first and restored focus to Advanced search after closing. The sort menu closed after outside action. Primary tabs remained at approximately 53 pixels and pilot tabs at approximately 143 pixels across every panel. At 320 and 390 pixels the compact toolbar stayed on one line without document overflow. Double-click opened the complete audit workspace. Browser review found only Chrome extension asynchronous-channel warnings and no application exception.

The real governed inventory remains 0. Exact v24 and v25 bytes are not yet retained and independently approved in R2, the first official current-effective lookup cohort is not yet approved, the physical custody matrix is incomplete, calculator drafts and vectors cannot execute, and mapping cannot perform an external action. Certificate creation, submission, trading and settlement remain disabled.

## Prior Creditex governed operations foundations release

`CREDITEX-GOVERNED-OPERATIONS-FOUNDATIONS-33` is the prior release from exact application commit `11b06b88d68609a9fcf254877a4afe379a95f8b3`. It adds migrations `0106` through `0108`, bringing the packaged and audited inventory to 109 migrations.

The signed-in Creditex shell now holds Operations, VEU test pilot and Government rules in one permanent 36-pixel primary tab bar and one dark palette. Pilot control, Jobs, Sources, Lookups, Evidence, Calculators and Connectors remain in one permanent 35-pixel inner tab bar. The Jobs toolbar presents Density, an all-populated-field search, compact Filters and Refresh at a shared 28-pixel height. The compact right-edge drawer retains installer and activity filtering, no bottom installer or activity-family rail is rendered, and column option menus close on outside action, Escape or selection. The full job audit workspace uses the same dark system with independently scrollable main and compliance regions.

Official-source approval now requires exact R2 object identity, bytes hash and binding hash plus a distinct governance reviewer; withdrawal of the latest approval blocks subsequent governed use. Lookup approval verifies row count, every row hash and the aggregate records hash before materialisation. Physical-custody acceptance records a tester-authored artifact and distinct governance decision in append-only tables. The version-2 calculator parses authoritative decimal strings to integers, produces canonical deterministic receipts and binds contract hashes. Dataforce reconciliation requires exact case-sensitive Job ID and App ID bindings to the same TLink work order and appointment, and only the server can create immutable engine receipts. Insert-time triggers recheck current approvals and close withdrawal races.

Exact application commit `11b06b88d68609a9fcf254877a4afe379a95f8b3` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,244 tests with 1,242 passed and 2 intentionally skipped, all 109 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit. The integrated Creditex suite passed 110 of 110 tests and the UI suite passed 40 of 40. Independent security review approved the five governed boundaries with no P1, P2 or P3 blocker, and independent UI review passed the final contrast and compact-control gates.

The final local archive `.openai/site-release-11b06b8.tar.gz` is 7,544,418 bytes with SHA-256 `E0F5B94C49CCA3776F3CEE2734C076F33F2E59324A301A211A7F55A6B94BACE4`, 358 entries and all 109 migrations. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_f2d304f9c9b481919b8d9588f0ef034f` stored 344 files and 30,412,800 bytes with content hash `sha256:60ede71e262e365ed8aa39fced47e8a550623266d6636ef8c326a821efdadb3c`. Deployment `appgdep_6a6edfb2b8e08191b295825c3db65d4d` succeeded as Sites version 262 with environment revision 19.

Signed-in production QA confirmed all three primary tabs at a stable 52.7-pixel top position and all seven pilot tabs at a stable 142.7-pixel top position. The global search returned the expected 10-job technician-code cohort from 300 records. Density, Search, Filters and Refresh each measured 28 pixels high. The filter drawer opened from the right edge, the Status column menu closed after an outside click, double-click opened the complete dark audit workspace and its main and compliance regions exposed independent scrolling. Recent Worker logs contained no Creditex failure; the only error in the review window was an unrelated existing `/api/trade-job-notifications` HTTP 500 from the Direct Trade dashboard.

The real governed inventory remains 0. Exact VEU version-25 bytes and bindings, authorised participant/product/licence/recall/suspension snapshots, physical iOS/Android/offline/restore acceptance, an independently approved official formula, Runabout field contract and authorised registry sandbox remain incomplete. Certificate creation, submission, trading and settlement remain disabled.

## Prior Creditex controlled intake foundations release

`CREDITEX-CONTROLLED-INTAKE-FOUNDATIONS-32` is a prior release from exact application commit `d441d41cad4d5299a882e73ea006a963fa360cf4`. Primary implementation commit `c423f3c3938b43bf92c8ec98d285b49e63024ee6` became Sites version 260, but its package omitted migrations `0100` through `0105`. Its unpreflighted guard batch reached a trigger that referenced a missing table; D1 rejected and rolled back the batch, so no new triggers persisted. The corrective commit packages and byte-audits all 106 migrations and checks the required Creditex tables and columns before installing any triggers.

The jobs workspace now uses the darker main-site visual system, consumes the full viewport and gives the register ownership of both scroll axes. Non-job panels own their vertical scrolling. The activity-family rail is removed; installer and VEU activity filtering live only in the compact right-edge advanced-search drawer. Column menus close after a sort choice, outside pointer action or Escape and restore focus.

Dataforce compatibility uses one exact 23-column contract: `App Id`, `Job Id`, `Status`, `SubStatus`, `Type`, `Work Type`, `Scheduled Datetime`, `Balance`, `Certificates (VEECs)`, `Submission`, `Invoiced`, `Field Worker`, `Agent`, `Client`, `Customer`, `Company Name`, `Ext Cust Ref`, `Phone`, `Mobile`, `Email`, `Address`, `Suburb` and `Postcode`. Export covers all matching filtered jobs, uses UTF-8 BOM and CRLF, neutralises spreadsheet formulas and is capped at 20,000 rows. Import accepts only the exact schema, at most 5 MiB and 2,500 rows, detects duplicates and stages unmapped legacy rows without creating or mutating a customer, job, regulated case, certificate, submission, trade or settlement.

The supplied private Dataforce export remained local and was never uploaded, committed, packaged or published. Local verification found 849 data rows, 23 exact headers, zero rejected rows, zero duplicates and an exact cell-preserving round trip; SHA-256 `22470CED083B3BAA4571108E34B5F91BD89154AD8381B54B693B3F9BDEF9BF31`, 210,478 bytes.

The installer compliance handoff now begins after quote acceptance and provides controlled Program, Activity, Product category and Scenario selectors. Official-source byte custody stores asserted government provenance and SHA-256 in R2 as pending review without activating rules. Evidence integrity receipts prove object custody, staged lookups retain effective dates and review state, and parallel external references remain non-evidentiary caller-supplied comparisons.

Exact corrective commit `d441d41cad4d5299a882e73ea006a963fa360cf4` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,220 main tests with 1,218 passed and 2 intentionally skipped, all 106 migrations through `0105_creditex_parallel_reconciliation.sql`, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit. The focused compliance suite passed 62 of 62 tests. `git diff --check` passed. Independent review reported no P0 or P1 defect.

The final local archive `.openai/site-release-d441d41.tar.gz` is 7,511,787 bytes with SHA-256 `FFBDCAFEA54E7FF72AD1E8E19B0983193E8C554583E3248129CD5E9FEAAE8CB1`, 355 entries and all 106 migrations. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_138b4cc8cf988191a4f3e4be4404a6d6` stored 341 files and 30,177,280 bytes with content hash `sha256:9b6fd4e639695ea43eb2623fb495b680c6130e7d1539abb3c645b0291898c2b1`. Deployment `appgdep_6a6eb97d1978819180b729e922f33971` succeeded as Sites version 261 with environment revision 19.

Signed-in production QA loaded 202 application tables and all 300 synthetic jobs. `compliance_cases` exposed the three new accepted-handoff fields. The dark full-screen workspace, compact drawer, absent activity rail, one installer selector, one activity selector, scrolling panels and menu dismissal were visually verified. A live export produced 300 rows with the exact 23 headers, zero formula-leading cells, 167,159 bytes and SHA-256 `E1399F3F3146C8AF361FC1E59DD094CB2704F7ABC5F4D6C11B757D8F11F9E2CC`. The post-deployment worker error query returned zero events.

The real governed inventory remains 0. The schema preflight does not yet fingerprint every index, trigger or CHECK definition. The accepted-scope hash is not database-constrained, one active case per work order cannot yet express VEU and STC together, parallel references are not bound to immutable imports, and exact source approval, authorised operational adapters, physical-device custody, approved calculators and registry sandbox reconciliation remain incomplete.

## Prior Creditex VEU operator usability release

This section is the historical `CREDITEX-VEU-OPERATOR-USABILITY-31` release from exact application commit `19a1e0b98db0cb7be5eae9e9e1371251220e8fc1`. Primary usability commit `96ecb9698943445c57ba7f4caec99ff3839d3499` became intermediate Sites version 258. Final saved version `appgprj_6a550c378000819185caf094173422bb~appgver_195313bad4888191a7b5472c6b215cc5` reports that historical source, and deployment `appgdep_6a6e5248b7048191acfe5904b1d4628b` succeeded as Sites version 259 with environment revision 19.

The 300-job register uses readable 12-pixel compact table text, clearer supporting text and denser controls. Advanced search is a 19-rem right-edge drawer with Job, installer, VEU activity, review state and evidence state together as quick filters. Secondary groups start collapsed. The former bottom installer roster is removed, while Dashboard plus all 34 VEU activity-family tabs remain.

Each column menu is a controlled disclosure. Outside pointer action, Escape or selecting a sort closes it, and Escape or sort selection returns focus to the originating heading. Version 259 also replaces the crowded filter header and count badge with the compact `All VEU jobs` heading.

The official source register records Victorian Energy Upgrades Specifications version 25 as effective from 21 July 2026, keeps version 24 as superseded comparison material and records both Part 6 branches in version 25. It does not treat 30 September 2026 as a separate instrument. Government departments, regulators and scheme administrators remain the sole rule authors.

The direct-trade installer integration is a proposed post-quote-acceptance handoff, not released runtime behavior. Its documented contract derives accepted job, site, jurisdiction, date and scope facts server-side, then exposes controlled Program, Activity, Product category and Scenario choices tied to an effective source version. It requires one active case per work order and retains the zero-program fail-closed boundary.

Exact final application commit `19a1e0b98db0cb7be5eae9e9e1371251220e8fc1` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, the complete main suite, all 100 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit. The focused Creditex VEU pilot suite passed 15 of 15 tests. Independent final review reported no P0 or P1 defect.

Signed-in version-259 QA at 2048 by 927 pixels confirmed no page-level overflow, 12-pixel table text, a 303.2-pixel drawer, all secondary groups initially collapsed, exactly one installer selector and one VEU activity selector, correct 30-job installer filtering, correct one-job combined installer and Part 6 filtering, outside-click dismissal, Escape dismissal, close-after-sort and focus return.

The final local archive `.openai/site-release-19a1e0b.tar.gz` is 6,894,158 bytes with SHA-256 `605BEE1AC610C7D4F82BD9CEBD5C2706B55BFB7F73B2640D1D5FBB6F041B21FF`. Sites stored 178 files and 18,780,160 bytes with content hash `sha256:81e8a258e445954acf669266c31c6fd7141d591925ff30148b6f70c4118172e9`.

The real governed inventory remains 0 published programs, 0 activity versions, 0 evidence policies and 0 regulated cases. Exact source-byte retention and independent activation approval, the installer case handoff, operational lookups, real-device evidence custody, calculators and external connector actions remain blocked or fail-closed.

## Prior Creditex VEU operator workspace

This section is the historical `CREDITEX-VEU-OPERATOR-WORKSPACE-30` release record. `CREDITEX-VEU-SYNTHETIC-PILOT-28` was first deployed as Sites version 252, authentication correction became version 253 and `CREDITEX-VEU-DENSE-REGISTER-29` became version 254. `CREDITEX-VEU-OPERATOR-WORKSPACE-30` came from exact application commit `1a535a0fd2237e8aa3dcf1daf82da009885197b0`. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_416748b2d09881919f375b0cf255789c` reports that exact source, and deployment `appgdep_6a6e119ef9c48191aa7a6da69463dd80` succeeded as historical Sites version 257 with environment revision 19.

The signed-in portal retains the discovery-only national reference catalogue, chained program and activity selectors and audited private case workspace. Its VEU Jobs workspace defaults to the complete 300-job queue and renders one semantic table row per job in a compact full-height table with local vertical and horizontal scrolling. It exposes 49 data columns plus one action column: every heading visible in the supplied Dataforce screenshot, explicit TLink installer and field-technician identity, government activity dimensions, all five fail-closed compliance states, trade workflow states and audit dates. Every column header has a dropdown; 41 verified fields support stable server-side ascending and descending order, while unsupported legacy semantics open an exact mapping explanation.

Advanced search now opens as a right-edge drawer so the register keeps the full working width when filters are not in use. The drawer has modal semantics, traps focus, makes the register inert, closes with Escape and returns focus to its trigger. It retains 12 filter groups, 27 pre-populated selectors, bounded date inputs and Apply and Clear actions. The fixed bottom Dashboard plus one tab for each of the 34 represented VEU activity families remains. Part `6` is one official family identifier; categories and scenarios remain separate governed dimensions, and `6(23)` has no special implementation path.

Right click, the row action control and keyboard access expose the same Dataforce-style Customer Details, Job, Appointment, copy and print menus. Job submenus cover Summary, Appointments, Actions, Questions, Quote and Invoice, Calculations, Transactions, Files, Issues, Emails and History. Appointment submenus cover Summary, Actions, Questions, Certificate Submissions, Decommissioning, Correspondence, Audit and History.

Double-clicking a row opens a full-viewport record workspace with collapsible navigation and compliance rails. It exposes owner-scoped customer details, private notes, service address, installer account, technician, work order, appointments, tasks, forms, quotes, invoices, files, issues, history, official sources, lookup contracts, evidence requirements, calculator contracts and connector facts. Media indicators show metadata, GPS and original-hash presence only when supported by bounded authoritative facts. Job-level regulated-case, compliance-evidence and submission-item counts come from the selected job, not a run-level fallback.

The live seed `veu-v25-2026-08-01-synthetic-v2` contains exactly 10 visibly synthetic installer companies, three assignment-only field technicians per installer and ten VEU jobs per technician: 10 installers, 30 technicians and 300 jobs balanced across all 34 activity families. Synthetic contact addresses use `example.invalid`; no real customer contact, Australian Business Number, Firebase field identity, evidence object, regulated case, certificate lot, submission, trade or settlement is fabricated.

Government departments, regulators and scheme administrators remain the sole rule authors. Creditex verifies exact operational transcriptions, audits evidence, manages corrections and performs authorised program actions within its accreditation and contractual connector scope; it does not own a private rule pack. Database triggers prevent synthetic work orders from entering regulated cases or submission items. All official-source bytes, operational lookups, evidence rules, formulas and external connectors that are not independently verified remain explicitly blocked.

The historical version-257 application source passed the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, 1,182 main tests with 1,180 passed, 2 intentionally skipped and 0 failed, all 100 migrations through `0099_creditex_synthetic_pilot.sql`, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit. The final focused pilot suite passed 15 of 15 tests and `git diff --check` passed. Independent final review reported no remaining P0, P1 or P2 defect at that checkpoint.

The version-257 local archive is 6,893,645 bytes with SHA-256 `A9B1526A4033D0CA060821A841A5DCF0D7ABA57AE6F0E1C84A42346587DC2038`. Sites stored 178 files and 18,780,160 bytes with content hash `sha256:38dfcd7487aa2a6cde6eedc11b628e55dadd3d1cac4430a8beeeecf20f523357`.

The historical version-252 package was 7,419,988 bytes with SHA-256 `CF7F72704BCAA585110FF3C9ADE8E1C4B212240CEE9BDD0B0F9673ACDB4B0727`. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_6ead08734a6c8191b018dc5a952acd33` stored the same 333 files and 29,624,320 bytes with content hash `sha256:be656467751fb195f2c381c2c450df8d9bfb74256a52d29650eaebc3bfe97eaf`; deployment `appgdep_6a6dd491dde88191bc862e69a2e59580` is superseded.

The historical version-253 package was 7,420,447 bytes with SHA-256 `51DF880CF8C919FA0386B891BC98C18064491988325049B59CC3F4A4BCE370DA`. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_900ff3f8d0448191a798a5eb10ef648c` stored 333 files and 29,624,320 bytes with content hash `sha256:20934a09b4658dafbd2b9c420c402028a3619a9fc9216bd2cb154ebcf12b1e98`; deployment `appgdep_6a6dde1747308191bf5c78bd4f674030` is superseded.

The exact version-253 source passed 1,180 main tests with 1,178 passed, 2 intentionally skipped and 0 failed, plus all 100 migrations through `0099_creditex_synthetic_pilot.sql`.

Signed-in production QA confirmed 10 of 10 installers, 30 of 30 technicians, 300 of 300 jobs and 34 of 34 activity families. At 2048 by 983 pixels, document dimensions matched the viewport exactly. The advanced drawer used modal semantics, made three background regions inert, focused Close on open, closed with Escape and returned focus to Advanced search. The Dataforce-style Job and Appointment action sets were present and initial focus landed on Customer Details.

Double-clicking `TEST-VEU-B5BA21F9-I01-T01-J01` loaded the complete authoritative record, including customer private notes, service site, installer account, appointment, expected evidence contracts, controlled audit states and job-level zero regulated counts. Files and Photos truthfully reported six expected requirements and zero captured originals. Both rails collapsed, Escape closed the workspace and focus returned to the originating row.

Version 255 first delivered the workspace. Version 256 corrected the advanced-drawer focus timing, then signed-in QA exposed a production-D1 failure in the 105-column job-detail query. Version 257 splits that projection into owner-scoped 63-column and 42-column reads while preserving a non-enumerating not-found response. Production request `a245e793ac2756fc` returned HTTP 200 for the opaque record route, and the post-release error-only Worker query returned zero events.

The historical Sites version 251 government-activity workflow package was 6,790,614 bytes with SHA-256 `B14686D098A1FF76D8DBF1F2CA26DE2AABB6D600D991289891A9CF31C6E50FFB`. Sites stored 178 files and 18,227,200 bytes with content hash `sha256:917cf16e38b0a69e2081992a8f2944699bf9492b78f40c8ce4745b55612bf285`.

## Prior released Creditex compliance operations portal

`CREDITEX-COMPLIANCE-OPERATIONS-25` is now a signed-in, activity-agnostic Creditex operations portal rather than a sign-in-only preview. Exact application commit `7b08cb600bde30273774a544e07039acc6de1c03` is deployed as Sites version 248 through `appgdep_6a6d733ea23c81918f4ccd8e4f30f98b` with environment revision 19.

The portal provides one audited workflow across every governed federal, state and territory program, activity, category and scenario. Program workspaces occupy a persistent bottom bar, while activities remain separate selectable dimensions within each program rather than hard-coded routes. The work areas cover privacy-minimised queues, deliberate case review, audit, tasks, participants, stock and decommissioning, submissions and reconciliation, certificates and settlement projections, reports, activity governance and access. Advanced search mirrors the Dataforce filter families for status, work and personnel, client and agent, customer and address, job, appointment, tags, product, audit and other filters. Unsupported legacy fields remain visibly unavailable with an exact reason instead of being fabricated.

Creditex administrators have organisation-wide access to governed work. Default queues exclude customer identity, exact address, contact, private notes, evidence filenames, object keys and raw geolocation. Opening private customer, installer, site, appointment or commercial details requires a deliberate case action and creates an audit record. Non-admin case details and every case-specific write recheck an active assignment at the server boundary; administrators are the explicit organisation-wide exception. An audited, receipt-bound evidence viewer streams only approved image and PDF types without revealing storage keys or original filenames. Concurrent dashboard and case requests use separate generation guards so an older response cannot overwrite a newer program or filter state.

The original stuck sign-in had two independent causes. Runtime trigger verification compared formatting-sensitive SQL left by earlier pre-activation versions, and reauthentication of the already-current Firebase user did not always emit another identity-state callback. Guard verification now canonicalises whitespace only outside quoted SQL, remains fail-closed on substantive differences, returns a stable bounded retry response while installation progresses and displays progress in the portal. Version 248 explicitly loaded the workspace after email or Google sign-in and deduplicated that request with the identity callback. Version 253 supersedes that transition: the identity listener owns workspace loading, the first request uses the cached valid token, only an authentication-specific `401` permits one forced refresh and retry, and a workspace failure preserves the signed-in identity for bounded recovery. Live QA reached the signed-in dashboard after reload.

Version 247 exposed a separate production-only issue: local SQLite accepted one 23-domain `WITH` and `UNION ALL` count query while production D1 returned HTTP 500 from the first operations aggregate. The production database console confirmed all 181 expected application tables were present. Version 248 replaces only that compound query with one bounded scalar-aggregate statement and retains identical organisation scoping. The operations dashboard then loaded successfully with a zero-case governed empty state and no false activity tabs.

No activity or evidence policy is seeded as published. Unverified calculators, manual response assertion, registry submission, certificate creation, trading, settlement, Dataforce or Runabout migration and real regulated cases remain hard-disabled. A policy withdrawn after a case is opened remains available for evidence correction and audit, but approvals and batch staging fail closed. `info@ausenergyassessments.com` is the claimed bootstrap administrator only. Routine Creditex access requires named verified individual users and least privilege; once two named administrators are active, the shared bootstrap membership should be suspended.

The post-review focused Creditex portal, API and operations-control suite passes 54 of 54 tests. The D1 aggregate regression subset passes 38 of 38. `npm.cmd run validate` passes type checking, warning-free lint, 31 of 31 integration tests, 1,089 main tests with 1,087 passed, 2 intentionally skipped and 0 failed, all 98 migrations through `0097_creditex_operations_lifecycle.sql`, the customer-plan PDF audit, production build and Sites server-bundle audit. `git diff --check` passes. The same complete gate passed both the assignment-boundary correction and the final D1-compatible executable source.

The version 248 local archive is 7,300,196 bytes with SHA-256 `5DDD878B2CAD584194DFCEC00B5245A353B9860DEF17CA83B4AE737860E9E3D2`. Sites stored 331 files and 28,968,960 bytes with content hash `sha256:1928ee707d2076db876b6aa40e58219ae5e96273f8ee1ece08cfe74144cd2aac`. GitHub `codex/sites-custom-domain-migration`, Sites managed `main`, saved-version provenance and the deployed executable all resolve to `7b08cb600bde30273774a544e07039acc6de1c03`.

Signed-in production verification confirmed the administrator dashboard, successful `/api/creditex/operations` rendering, all work-area navigation, the Dataforce-parity advanced filter families, the bottom program workspace bar, named-member invitation and role controls, and separate draft program and activity governance with registry code, specification part, product category and scenario fields. No case was auto-selected, so no private detail audit was created by queue load. The post-release Sites Worker error-only query returned zero events. Browser logging contained only the Chrome extension's closed asynchronous message-channel warning, not an application exception.

Physical-device capture, production original-evidence viewing, government-source transcription accuracy, calculator provenance, authorised submission adapters, retention, legal hold, backup, restore and real provider behavior remain unverified or blocked. Full Dataforce and Runabout equivalence still requires authorised exports, field dictionaries, reports, role maps and a Runabout walkthrough; the version-248 portal does not represent that unknown inventory as complete.

## Creditex evidence-policy governance release

`CREDITEX-EVIDENCE-POLICY-GOVERNANCE-26` is deployed from exact application commit `d40c803bfa0b614ed806624a375a1fa47bd0e5a4` as Sites version 249. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_bf90b67a89508191bbea3f1a2d926719` reports the exact application source, and deployment `appgdep_6a6da8704be08191a4d310adb523e0f3` succeeded. The protected production route is `https://compare.ausenergyassessments.com/creditex/compliance`; the Sites provider URL is `https://aea-energy-comparison.info294029.chatgpt.site`.

The release makes government-source activity and evidence transcriptions program-scoped, effective-dated and activity agnostic. It adds complete ordered evidence-requirement transcription, immutable sealed snapshots, different-identity administrator publication control, database-enforced publication invariants and fail-closed field compatibility. Publication verifies a machine representation of controlling government or regulator sources within Creditex's operating authority; it does not create a private Creditex rule. AEA Field receives only published requirements it can currently execute. The server verifies assembled evidence bytes, SHA-256, file signatures and governed JPEG EXIF, GPS and capture-time consistency instead of accepting client-authored metadata claims. Evidence maxima, duplicate-byte prevention, upload cleanup, immutable audit boundaries and terminal job-state mutation guards are enforced at the server or database boundary.

The exact application tree passes `npm run validate`: 31 of 31 integration tests; 1,157 main tests with 1,155 passed, 2 intentionally skipped and 0 failed; all 99 migrations through `0098_creditex_rule_governance.sql`; type checking; warning-free lint; the customer-plan PDF audit; production build; and Sites server-bundle audit. AEA Field passes type checking, lint, 8 of 8 tests and Android and iOS export. Expo Doctor reports 19 of 20 because of dependency patch drift, so that check is recorded as a known deviation rather than a pass.

The local release package is 7,352,352 bytes with SHA-256 `4E9087A40A00613E4BBDD111D8D5E1CA4A3A5AED01BCF3DA8DD9635396CF920F`. Sites stored 332 files and 29,276,160 bytes with content hash `sha256:3e66780f5d61ae46c650df39c711a9a26166f75f7d9eb58cf8461a39dc7bc123`.

Signed-in Chrome QA as the AEA Creditex administrator with the `Admin` role confirmed that reload progressed from the protected loading state to Operations without a stuck sign-in. The work queue and advanced filters loaded, the bottom Dashboard and program rail remained available, and activity-source governance, evidence-policy transcription, four-eyes notice and Access membership screen rendered. The current real production inventory is 0 governed programs, 0 activity versions, 0 policies and 0 cases. No production mutation was performed during QA.

Physical-device acceptance, platform-backed camera attestation, production original-evidence viewing, government-source transcription accuracy, verified calculators, authorised provider connectors, retention, legal hold, backup, restore and real certificate, registry, trading or settlement behavior remain unverified or blocked. The empty production catalogue is an intentional safety boundary, not evidence that national program coverage is complete.

## Current product model

AEA and TLink contain four connected products:

1. Household energy planning and comparison, including electricity, gas, NEM12 processing, guides, scenarios, rebates and assessment intake.
2. A protected marketplace connecting reviewed household opportunities with approved installers and suppliers.
3. Free TLink trade software for CRM, customers, jobs, scheduling, quotes, forms, field work, assets, handover, invoices, integrations and teams.
4. The AEA Field iOS and Android client for assigned encrypted offline work.

TLink trade software costs A$0. Access has no recurring fee, seat charge, lead charge, job charge, quote charge or payment-card requirement. Customer invoices and job-payment records are operational business records only. They cannot grant, rank or expand TLink access.

## Trade access policy

- A trade applicant must sign in with a verified account email and provide required business and contact details.
- The application rejects an ABN that does not pass the 11-digit checksum.
- A valid checksum does not prove that the applicant owns or represents the business.
- A new or changed ABN remains pending until an authorised reviewer checks it against an authoritative source.
- The reviewer records the outcome, reviewer identity and decision time.
- Trade workspaces and APIs require an active account, an approved business review and the appropriate role.
- Changing the ABN resets the review and removes trade access until a new approval.
- Licence, insurance, accreditation, supplier evidence and jurisdiction checks remain separate controls where the workflow requires them.
- No commercial, invoice, provider-payment or legacy account field can grant trade access.

The deployed `FREE-ACCESS-ABN-01` implementation enforces this policy across signup, server authorization, administration, data and tests.

## Customer home advisor release

`CUSTOMER-HOME-ADVISOR-01` is deployed from exact application commit `53e6cf96aff6f48e9e393a23c4eedbeba997eb39` as Sites version 204. It retires the dedicated customer Home records page and navigation while retaining completed-project handovers, warranty and correction integrity, consent events and administrator governance.

The project intake now:

- records owner or renter tenure separately from strata or common-property approval;
- accepts several goals and detailed home facts;
- uses a broad budget band only to sequence investigation;
- treats `Not sure` as useful information;
- generates an independent, brand-agnostic and editable starting plan;
- supports drag ordering, accessible arrow ordering, removal and bounded custom steps;
- preserves draught-proofing, insulation, glazing and window coverings through installer capability matching and accepted-work handoff;
- removes the household access-routine question;
- uses one optional evidence upload with durable sharing consent, generic installer filenames and safe-photo and privacy guidance;
- keeps private notes visibly editable; and
- places validation beside the customer action.

The flow is not a NatHERS assessment, certificate, formal evidence workflow, quote or savings promise. Forward migration `0081_customer_project_advisor.sql` adds and backfills the multi-goal projection, resets retired demo budgets, converts the old combined fabric category across matching and operational records, preserves complete matched-category lists through protected CRM enquiries and work orders, separates legacy strata approval from tenure, forces ambiguous legacy tenure back to an unanswered owner-or-renter choice, removes household occupancy from project context and anonymises stored evidence filenames without rewriting applied history.

## Advisor context and admin stability release

`CUSTOMER-ADVISOR-CONTEXT-02` is deployed from exact application commit `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77`, first saved and published as Sites version 206.

The administrator correction is intentionally narrow. Opening an unread notification case previously triggered an audited read update whose refresh could reorder the queue and collapse or move the active case. The current implementation pins that active case at its prior visible index during background refresh, restores its viewport anchor and preserves deliberate close or resolve behavior. A manual queue, search, category, priority, status, assignee or action-only change resets the pin so an out-of-filter case does not remain visible.

The household advisor now:

- records each important controlled fact as not known, customer reported, photo available for review or document available for review;
- states that those source labels do not prove a file is attached, linked to the fact, professionally reviewed or verified;
- derives a broad planning profile only from a valid residential postcode and matching state;
- labels that profile as an approximate planning aid, not a NatHERS climate zone, rating, assessment, equipment-size calculation or savings estimate;
- adjusts safe shading or building-shell sequencing from that bounded climate profile;
- accepts up to twelve private room profiles with controlled room types, comfort concerns and use periods;
- correlates heat, cold and time within the same room before changing advice;
- keeps private room names and routines out of generated wording and installer opportunities;
- puts renter-portable actions before permission-dependent fixed work;
- builds a maximum-thirty-item permission checklist from tenure, strata context, the current plan, evidence gaps and controlled customer classifications;
- separates portable options, owner or agent questions, strata or shared-property questions, licensed or site checks, and evidence questions into five previewable sections;
- retains every authoritative licensed or site-check rule even when a customer selects another classification;
- keeps arbitrary customer titles, identifiers and note wording inside the signed-in project and replaces them with controlled reminders in the shareable checklist; and
- states that the checklist is not legal advice and does not grant or confirm permission.

Only controlled broad climate, room-type and comfort-concern aggregates, and known or unknown evidence counts can enter an installer opportunity. Exact postcode remains available only at the protected matching boundary and is returned as an empty value to installers before the existing contact-release workflow. Private room names, use periods, permission titles, permission notes and project-private notes are excluded.

Forward migration `0082_customer_advisor_profile.sql` adds `customer_projects.advisor_profile` as additive JSON text with default `{}`. The server owns normalization and climate derivation. That release used plan version `2026-07-29-evidence-climate-advisor`; the prior `2026-07-29-home-advisor` version remains a safe legacy regeneration input through the existing edited-plan conflict boundary.

## Independent customer plan release

`CUSTOMER-PLAN-DECISION-03` is deployed from exact application commit `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e`, first saved and published as Sites version 208.

The release:

- gives every canonical plan item bounded `Based on`, `Still uncertain` and `Could change if` guidance without a false confidence score;
- asks at most three deterministic, safe questions linked to controlled inputs and accepts `Not sure`;
- keeps a bounded customer-owned review worksheet private and requires a second explicit action before an accepted proposal becomes a private plan step;
- builds one escaped, privacy-filtered HTML and plain-text email document from the server-owned saved plan;
- adds one verified, active, owner-scoped delivery route with explicit recipient confirmation, recipient-bound idempotency and a fail-closed five-attempt hourly limiter;
- adds an accessible recipient dialog and an A4 browser print or Save as PDF surface;
- excludes exact location, account and project identity, private notes, room names and routines, filenames, meter information, review text and custom plan wording from shared output;
- reconciles public `/plan`, account handoff and `/plan/print` with the current canonical goals, tenure, approval, budget, home facts, rationale and question engine;
- improves project-preparation guide and draft-status contrast; and
- makes no NatHERS, authenticated assessor, price, savings, brand or provider-ranking claim.

The current plan version is `2026-07-29-decision-support-advisor`. Legacy edited ordering, removals and private custom steps remain protected by the existing conflict boundary. Private review and custom content cannot enter installer opportunities, permission exports or independent shared output.

## Customer plan evidence and history release

`CUSTOMER-PLAN-EVIDENCE-04` is deployed from exact application commit `6540ee671e64dbfdf80592283a1954b2ff482355`, first saved and published as Sites version 210 through deployment `appgdep_6a695ca742d081918d73196751713f98`.

The release:

- uses one categorized fourteen-question home-detail intake in public `/plan` and the signed-in project builder;
- supports several main goals, owner or renter tenure, approval context, budget and staging as separate decisions;
- distinguishes roof, wall and underfloor insulation condition plus glazing, basic blinds, higher-performing coverings and external shade in plain language;
- derives answered, `Not sure` and unanswered counts from the same authoritative question contract;
- adds one action to mark every unanswered home question `Not sure` and one email-dialog action to review missing details;
- uses one concise privacy-filtered projection for inline email HTML, plain text, public print, signed-in print and browser Save as PDF;
- keeps plan steps reorderable, removable and open to bounded home-specific additions;
- makes every new upload `private-plan` by default and requires explicit `allocated-installers` scope plus current consent before an allocated verified installer can view it;
- strips JPEG, PNG and WebP metadata before any accepted image category is stored;
- makes fact-link edits independent from installer-sharing consent;
- adds bounded owner-scoped plan revisions and private outcome check-ins with atomic revision numbering and retention limits; and
- prevents private file counts, private notes, filenames, exact location, room routines and custom plan text from entering installer or shared report output.

The current plan version is `2026-07-29-home-feature-taxonomy-v2`, the advisor profile version is `2026-07-29-advisor-profile-v3`, the document version is `2026-07-29-plan-document-v1`, and the concise report version is `2026-07-29-concise-report-v1`. Forward migration `0083_customer_plan_evidence_history.sql` adds evidence fact links and sharing scope plus private revision and outcome tables without rewriting applied history. The prior `2026-07-15`, `2026-07-29-home-advisor`, `2026-07-29-evidence-climate-advisor` and `2026-07-29-decision-support-advisor` plan versions remain accepted legacy inputs through the existing edited-plan conflict boundary. Household answers and linked files are not represented as professionally reviewed or verified, no NatHERS claim is made, and no price or savings outcome is guaranteed.

## Professional review, responsive print and everyday comfort release

`CUSTOMER-PLAN-PRO-PRINT-05` is deployed from exact application commit `ee75aadfd6800c01b92532b2d376a4a1e33c9d74`, first saved and published as Sites version 212 through deployment `appgdep_6a69c4f838bc8191a0e050da219ab4a6`.

The release:

- adds an optional self-declared accredited energy or home-comfort adviser review to the signed-in Goals stage;
- records a controlled role, adviser name, accreditation scheme or body, reference and bounded professional notes;
- requires the current declaration version at the server boundary and removes the declaration whenever an advice-affecting household, room, plan or adviser input changes;
- attributes the home-answer review to the named self-declared adviser while clearly stating that AEA did not independently verify the person, accreditation, reference, evidence or observations;
- preserves household-supplied wording when no current declaration is present;
- adds a deterministic, capped and product-neutral `Helpful things you can try now` section to public, signed-in, email and print outputs;
- covers moisture and ventilation, personal warmth, safe seasonal airflow, appliance controls and timers, window coverings and landscaping, and renter-friendly or bounded do-it-yourself options only when the recorded facts support them;
- keeps helpful actions separate from the ordered upgrade roadmap, quotes, permissions and installer matching;
- replaced top-level account-page printing with one isolated privacy-filtered temporary-frame lifecycle, including single-print guarding, cancellation, timeout, unmount, `afterprint` and idempotent cleanup boundaries; this historical mitigation later proved insufficient when the product owner reproduced a Chrome freeze and is superseded by the direct-PDF release; and
- wraps long adviser names, references and notes and preserves semantic report section headings in A4 output.

The current plan version is `2026-07-29-adviser-print-comfort-v3`, the advisor profile version is `2026-07-29-advisor-profile-v4`, the professional declaration version is `2026-07-29-self-declared-adviser-v1`, the document version is `2026-07-29-plan-document-v2`, and the concise report version is `2026-07-29-concise-report-v2`. No schema or migration changed. Earlier plan versions remain accepted through the existing edited-plan conflict boundary.

## Direct customer plan PDF download fix

`CUSTOMER-PLAN-DIRECT-PDF-06` is deployed from exact application commit `d5c675a5ceffa6e924df033e8cb8b505bb4d6336`, first saved and published as Sites version 214 through deployment `appgdep_6a69e79a91548191987f12631559cb1f`.

The release:

- replaces public and signed-in customer-plan browser printing with one shared direct-PDF download contract;
- projects only the normalized privacy-filtered report into the PDF, while the account path continues to save the exact plan before generation and the public path remains non-mutating;
- generates A4 bytes in a dedicated lazy worker so font embedding and layout do not block the page;
- uses `pdf-lib`, fontkit and locally bundled DejaVu Sans TrueType fonts, preserves supported Unicode and fails explicitly for unsupported glyphs;
- downloads an `application/pdf` Blob through a privacy-safe filename with duplicate-generation guards and bounded worker, Blob and object-URL cleanup;
- removes customer-plan iframe, `srcdoc`, `contentWindow`, `afterprint` and `window.print()` paths; and
- makes no schema or migration change.

The PDF format version is `2026-07-29-direct-download-pdf-v1`. The plan version remains `2026-07-29-adviser-print-comfort-v3`, the advisor profile remains `2026-07-29-advisor-profile-v4`, the professional declaration remains `2026-07-29-self-declared-adviser-v1`, the document remains `2026-07-29-plan-document-v2`, and the concise report remains `2026-07-29-concise-report-v2`.

The public version 214 download passed its release checks, but the signed-in path was not exercised. Product-owner testing then proved that the account action could freeze or fail because it synchronously saved the project and could decode, resize and JPEG-encode pending photos on Chrome's main thread before PDF generation. The later hidden synthetic link click could also be suppressed after the original user activation had expired. This release did not meet the signed-in operational outcome and is superseded by `CUSTOMER-PLAN-NATIVE-PDF-07`.

## Browser-native customer plan PDF reliability correction

`CUSTOMER-PLAN-NATIVE-PDF-07` is deployed from exact application commit `8cdec99bcd2d1cb9f2ec0dc18c87a71860412642`, saved and published as Sites version 216 through deployment `appgdep_6a69f763e0b08191b6ac8539e0828d84`.

The correction:

- creates the privacy-filtered report directly from the current in-memory plan and never saves the project, prepares photos, uploads evidence or calls a customer-project API from the PDF action;
- submits one synchronous same-origin form request and returns a standard `application/pdf` attachment, preserving the real user gesture without a print dialog, client worker, font fetch, Blob URL or hidden synthetic-link click;
- generates the bounded A4 report at the edge with `pdf-lib` standard fonts and safe fallbacks for unsupported display characters;
- rejects cross-origin, wrong-content-type, malformed, oversized and unbounded report requests;
- removes the client PDF worker, fontkit and bundled DejaVu dependencies, eliminating about 2.76 MB of cold worker and font requests;
- excludes `/account` and all `/account/*` HTML from shared edge caching and returns `private, no-store, max-age=0`, so a fresh navigation cannot receive a stale customer-dashboard shell; and
- makes no schema or migration change and does not alter working-demo data.

The PDF format version is `2026-07-29-native-response-pdf-v2`. The plan, advisor profile, professional declaration, document and concise-report versions remain unchanged.

## Premium customer plan PDF and email report

`CUSTOMER-PLAN-PREMIUM-REPORT-08` is deployed from exact application commit `fb6cacf8b0309a3fc26b40a43da5b025050d22d2`, saved and published as Sites version 218 through deployment `appgdep_6a6a11c02e088191bb27cc302c8b35af`.

The release:

- adds one shared design and customer-copy contract for A4 PDF, responsive email HTML and plain text;
- replaces the dense report export with a branded cover, home snapshot, prominent first three actions, later roadmap, everyday comfort advice, plan confidence, professional attribution, trade checks and privacy;
- uses readable ten-point PDF body copy, clear sans-serif headings, compact page furniture and the site's navy, teal, green, mint and warm warning palette;
- keeps recommendation cards together across page breaks and gives completed plans an explicit progress state instead of an empty priority section;
- creates real allowlisted same-origin PDF link annotations with customer-friendly labels and no raw visible URL;
- uses a table-based, inline-styled 640-pixel email that stacks at narrow widths and contains no remote image dependency;
- preserves exact household and self-declared professional boundaries, private-field exclusions and safe HTML escaping;
- preserves the synchronous native form download, no-store response, route bounds and zero-mutation customer-project contract; and
- makes no schema or migration change and does not alter working-demo data.

The PDF format version is `2026-07-29-premium-report-pdf-v3`, the report version is `2026-07-29-premium-report-v3`, and the shared design version is `2026-07-29-premium-report-v1`. The plan, advisor profile, professional declaration and document versions remain unchanged.

## Technical customer plan presentation release

`CUSTOMER-PLAN-TECH-PRESENTATION-09` is deployed from exact application commit `f401575a5bf463b85c7688424db0b99dddd220c5`, saved and published as Sites version 220 through deployment `appgdep_6a6a265a51108191bdc8ae6a4eefbf8f` with environment revision 19.

The release:

- replaces the temporary PDF initials tile with the exact 96 by 96 transparent AEA navigation mark from one shared in-source asset;
- serves that same mark to email from `https://compare.ausenergyassessments.com/api/aea-brandmark` with a stable PNG response and immutable public caching;
- gives PDF and responsive email a more distinctive technical presentation using the site's deep navy, electric blue, teal, aqua, green, mint and warm warning palette;
- improves hierarchy and spacing across the branded cover, plan signals, lead home fact, remaining snapshot, first actions, later roadmap, everyday ideas, confidence, trade checks and privacy;
- retains the same normalized, privacy-filtered report content across PDF, HTML email and plain text;
- preserves the exact household-supplied or self-declared professional evidence boundary once in the PDF instead of repeating or weakening it;
- gives a completed plan truthful progress signals, including all steps complete and zero left to plan, without inventing a next action;
- preserves same-origin guide annotations, customer-friendly labels, bounded edge generation, native attachment download and zero project or evidence mutation; and
- makes no schema or migration change and does not alter working-demo data.

The PDF format version for that release is `2026-07-30-tech-presentation-pdf-v1`, the shared design version is `2026-07-30-tech-presentation-design-v1`, and the report version remains `2026-07-29-premium-report-v3`. Sites versions 218 and 219 are historical premium-report application and documentation checkpoints; version 220 is the historical technical-presentation checkpoint superseded by the spacing release below.

## Customer plan spacing and rounded-surface release

`CUSTOMER-PLAN-SPACING-10` is deployed from exact application commit `e74c2d95889a381cb3bb434607bc6584e54cf722`, saved and published as Sites version 222 through deployment `appgdep_6a6a8887a0048191b7eb1706e742ad28` with environment revision 19.

The release:

- centralises PDF and email spacing, padding and radius values in the shared report design module;
- gives repeated PDF information, priority, roadmap, snapshot, comfort and closing panels the same measured internal rhythm;
- uses clipped cubic-Bezier rounded paths for gradient surfaces so their corners cannot remain square behind a rounded border;
- softens PDF logo surrounds, metric tiles, number badges and accent bars without changing report facts;
- gives email 40 px desktop and 32 px mobile section spacing, 16 px tile gaps, 20 px content padding and 16 to 22 px radii;
- separates each everyday action into an individual rounded email tile and adds a visible gap between stacked mobile snapshot cells;
- removes transport-only whitespace so the maximum-content email remains below the existing 60,000-byte guard;
- preserves the exact AEA mark, customer wording, privacy projection, evidence boundary, same-origin annotations, native attachment route and provider controls; and
- makes no schema, migration, account, customer, project, trade, wholesaler or evidence-data change.

The PDF format version is `2026-07-30-tech-presentation-pdf-v2`, the shared design version is `2026-07-30-tech-presentation-design-v2`, and the report version remains `2026-07-29-premium-report-v3`. Sites version 220 is the historical technical-presentation source; version 222 is the historical spacing application source superseded by the trust release below.

## Customer plan trust, evidence and revision release

`CUSTOMER-PLAN-TRUST-11` is deployed from exact application commit `bc427d295b3106907904a3c0b7bf9f2945561cd1`, saved and published as Sites version 224 through deployment `appgdep_6a6b151c0178819185e4d57c1cbf75c2` with environment revision 19.

The release:

- uses one semantic premium report renderer for public `/plan/print` and the accessible signed-in preview dialog;
- repeats the complete applicable plan action set after the final ordered step so `Preview full report`, `Email this plan`, `Download PDF` and conditional `Reset advisor suggestions` remain available without a return scroll;
- adds optional guided photo capture with deterministic categories, three explicit safety and privacy confirmations, rear-camera preference, local preview, a 12-photo bound and the existing owner-scoped private evidence path;
- keeps meter-box guidance to a safely accessible closed exterior and never asks a customer to climb, enter a roof space, disturb insulation or remove a cover;
- adds immutable owner-scoped plan revisions through `0084_customer_plan_revision_restore.sql`, bounded retention and comparison of goals, home facts, pace, budget, plan version and ordered-step changes;
- requires explicit confirmation for draft-only restore and preserves project identity, address, work categories, private notes, adviser details, evidence, sharing permissions, quotes and installer activity;
- uses a typed `PLAN_REVISION_CONFLICT` boundary so only stale revision conflicts offer an explicit reload, while unrelated `409` business errors preserve their server message and unsaved edits remain mounted;
- adds PDF format `2026-07-30-tagged-plan-pdf-v3` with `en-AU` language, document and section structure, reading-order references, link objects and artifacts, but does not claim PDF/UA conformance;
- keeps the full saved plan and PDF authoritative while adaptively constraining only extreme email rendering below 88,000 HTML bytes;
- discloses every email-only shortening or omission in HTML and plain text and changes provider success wording so acceptance is not presented as inbox delivery; and
- preserves the exact AEA mark, premium visual system, normalized customer facts, evidence boundary, no-store delivery and zero project or evidence mutation during PDF download.

The release used synthetic report and email data only. No real email was sent, no real or working-demo account project was created or saved, no evidence was uploaded and no native print API was invoked. Controlled delivered-client acceptance in Gmail and Outlook and an independent PDF accessibility conformance audit remain unknown and are forward gates, not release claims.

## Customer project cleanup release

`CUSTOMER-PROJECT-CLEANUP-12` is deployed from exact application commit `da35ce60295d6c7150cddd9b35e33fcf64c8521b`, saved and published as Sites version 227 through deployment `appgdep_6a6b22db21c48191a2dedbdbf05274ef` with environment revision 19.

The release:

- places a compact, quiet `Delete draft` control beside the primary `Continue project` action on draft cards;
- keeps permanent deletion absent from every non-draft project card and removes the confusing draft archive action from project details;
- uses a labelled confirmation dialog with `Keep draft` focused first, forward and reverse Tab containment, Escape cancellation, background scroll lock and protected busy-state dismissal;
- requires same-origin Firebase authentication, an active owning customer account, explicit confirmation and matching plan-revision plus update-time tokens;
- forces the destructive action through HTTP `DELETE` so the existing PATCH action surface cannot request permanent deletion;
- refuses submitted projects and any project connected to opportunity, quote, contact-release, appointment, arrival or handover activity;
- selects private evidence object keys only on the server, removes R2 objects before owner-scoped dependent records and deletes the project row last;
- retains a retryable private draft and never reports success when object or database cleanup fails;
- keeps project-detail controls content-sized and top-aligned instead of stretching buttons through a long roadmap; and
- preserves readable primary action labels by overriding the older project-footer link colour at the exact component boundary.

Application commit `9ecde96f8975f322be35283747cb7fe93b2579f9` was the validated core implementation and was published as intermediate Sites version 226. The first signed-in visual check found that an older, more specific link-colour selector hid the `Continue project` label against its green background. Corrective child `da35ce60295d6c7150cddd9b35e33fcf64c8521b` added the narrow selector override and regression assertion, passed the complete release gate and superseded version 226 as version 227.

Live verification used an existing working-demo account only for read-only inspection. Four draft cards exposed the new delete control, the installer-matching card did not, the confirmation was opened and cancelled with `Keep draft`, and an existing project detail showed compact controls. No delete confirmation was activated, no project was edited and no demo account, project, evidence or workflow record was created or removed.

## Customer roadmap context release

`CUSTOMER-ROADMAP-CONTEXT-13` is deployed from exact application commit `0db488f325a79e22d126aace75647715b59c96f9`, saved and published as Sites version 229 through deployment `appgdep_6a6b38fcccbc8191b8b2daedf57b9e24` with environment revision 19.

The release:

- renames the five formal project stages to Home, Plan details, Your roadmap, Quote prep and Privacy;
- gathers goals, five bounded home basics, detailed home facts, considered work, room context, budget and pace before roadmap generation;
- gives home height, approximate age, floor area, roof type and switchboard state explicit `Not sure` answers and safe explanatory hints;
- derives compatibility priorities from the selected goals on the server, ignoring a conflicting client priority payload when goals exist;
- uses home basics and considered work in the canonical plan, `What shaped this roadmap` summary, saved plan snapshot, bounded revision comparison and restore, PDF and email;
- preserves current context and work choices when restoring a legacy revision that predates those fields;
- keeps current approval and access context outside revision restore;
- limits quote preparation to quote-stage facts, access constraints, optional evidence and private notes; and
- removes the repeated priority selectors from quote preparation and privacy review.

The exact application source passes the focused 85-test workflow, document, revision, taxonomy and enquiry set. The complete `npm.cmd run validate` gate passes: type checking, warning-free lint, 31 of 31 integration tests, the full 868-test suite with 866 passed, 2 intentionally skipped and 0 failed, all 85 migrations through `0084_customer_plan_revision_restore.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and Sites managed `main` contain the exact application SHA. The saved archive is 6,464,162 bytes with SHA-256 `F786B36378B6D9E2912527C2D146600610D1FE52CAC79CCD969E35E7D8FD9C73`.

The signed-in production project was reloaded after publication. Step 2 showed goals, the five home basics, detailed home categories, considered work, room profile, budget and pace. Step 3 showed `What shaped this roadmap` with goals, tenure, home basics, current home answers, considered work and budget or pace. Step 4 showed quote-only information and a read-only work summary, with no repeated priority selector. Live `/api/health` returned HTTP `200`, `Cache-Control: no-store` and `{"ok":true,"service":"aea-energy"}`. The recent Sites worker error-only query returned zero events. No working-demo answer, project, evidence item, account or email was created, saved, edited or deleted.

## Customer installer request completion release

`CUSTOMER-INSTALLER-REQUEST-14` is deployed from exact application commit `2607cc53f2e4c79546701e29d3d182fde4670952`, saved and published as Sites version 230 through deployment `appgdep_6a6b5469c8bc81919f0e2c9ef22da602` with environment revision 19.

The release:

- gives valid saved stages a green completed state, check mark and accessible completion label;
- opens the reusable `Where should the installer work?` dialog from the request action instead of placing missing-contact guidance at the top of the project;
- collects phone number, street address, optional unit detail and suburb while deriving postcode and state from the owned project;
- saves only private contact and derived location fields against the active owning customer profile and exact observed revision;
- retains the existing withheld-during-matching and named contact-release boundaries;
- uses an idempotent request identifier, exact project update token and bounded recovery fingerprint to reconcile uncertain submission results;
- prevents a recovered matching or quote-review project from accepting a contact change without an explicit recovery flag and profile compare-and-swap; and
- presents a clear success state with a direct return to the customer overview.

The exact application source passes 44 of 44 focused installer-request, profile, recovery, project and UI regressions. The complete `npm.cmd run validate` gate passes: type checking, warning-free lint, 31 of 31 integration tests, the full test suite, all 85 migrations through `0084_customer_plan_revision_restore.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. Independent final review closed all P1 and P2 findings. GitHub `main`, the working branch and Sites managed `main` contain the exact application SHA. The local release archive is 6,471,181 bytes with SHA-256 `4A8A79645C5F3C27D07B7069B481DD013EBB0E739FA83A16263783E3027EBE91`.

The signed-in production project showed `Plan details, complete` with a green check, green text and accessible completion state. The request action opened the centred private-details dialog with phone, service street address, optional unit detail, suburb, project postcode and state in context. Required-field guidance remained inside the dialog, and the dialog was closed without entering or saving customer contact data. No profile revision, project, evidence item or installer request was created or changed.

## Customer plan durability, evidence and history release

`CUSTOMER-PLAN-DURABILITY-15` was implemented in `e74278c8b62c569541ea84b5a431917d03a1c13a`. That commit was saved as Sites version 231, but deployment `appgdep_6a6bcf5c0f7c8191b877d27581f9d82e` failed before public activation with `__dirname is not defined` because the generated Worker contained a private Next Fontkit runtime. Saved identity `appgprj_6a550c378000819185caf094173422bb~appgver_7a589f567528819189cf033456193bda` is failed non-live evidence only. Version 230 remained public throughout that failed attempt.

Corrective child `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` replaced the private runtime with public `@pdf-lib/fontkit`, added an audited production-bundle boundary and became the executable source for Sites version 232. It is saved under `appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8` and was deployed through `appgdep_6a6bd28a71888191be19f89db9b82ca5` with environment revision 19 before version 233 superseded it.

The release:

- shows pending and saved guided-photo previews, filenames and progress in the exact prompt where the customer added them, with save/reload, replacement and removal handling;
- preserves guided photos if later work selections change while excluding generic evidence, empty slots and PDFs from that retained group;
- adds stable capture slots, metadata stripping, resumable multipart private uploads and compare-and-swap retake or removal;
- keeps draft deletion in a durable `deleting` state, freezes evidence writes, supports recoverable D1 and R2 cleanup and suppresses normal active, recommended, continue and edit behavior;
- replaces opaque revision numbers with plain labels, two-version comparison, a privacy-filtered export, private household check-ins and guarded draft-only restore;
- saves the latest private profile and submits the installer request from one confirmation with one bounded authoritative conflict recovery and no replay of project, evidence or request writes;
- embeds Liberation Sans, retains a tagged-document foundation, semantic lists and links, and fails before save when the current fonts do not support supplied text; and
- uses document format `2026-07-31-tagged-plan-pdf-v6` with public `@pdf-lib/fontkit` and a build gate that rejects `__dirname` or the private Next Fontkit marker in the Sites server bundle.

The focused PDF and email correction set passes 18 of 18. The complete `npm.cmd run validate` gate passes: type checking, warning-free lint, 31 of 31 integration tests, 914 total tests with 912 passed and 2 intentionally skipped, all 86 migrations through `0085_customer_evidence_resumable_retake.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. The nine-page tagged-PDF audit was rendered and inspected page by page with no clipping, overlap, missing glyph, harsh corner, spacing or footer defect. Unsupported scripts fail before save instead of producing replacement characters. `git diff --check` and the Sites server-bundle audit pass.

GitHub `main`, the working branch and Sites managed `main` contain exact application SHA `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`. The local release archive `aea-sites-7e1f0a8.tar.gz` is 7,085,796 bytes with SHA-256 `9555352A7F723A615F2D97E2BFEE736DCD6D491C4189B5E100D179D7CB121974`. Sites reports 311 stored archive files, 27,760,640 bytes and content hash `sha256:e48b4226de4114a1c68ab45ed29021778470a3333b477a44131f07b080e5f2f0`.

Signed-in production inspection loaded the saved roadmap, plain-language two-version comparison, privacy-filtered summary action and private check-in UI. A selected working-demo photo remained visibly named with `Added privately to this draft` directly inside its matching guided card. No photo, project, profile or installer request was saved, replaced, removed or submitted. The post-deployment Sites Worker error-only query returned zero events. Real Outlook desktop, independent assistive-technology or PDF/UA acceptance, pan-Unicode rendering, pixel-level redaction and restoration of a browser `File` object across a full reload remain unverified forward work.

## Customer installer request and multi-photo release

`CUSTOMER-INSTALLER-PHOTOS-16` is released from exact application commit `5acc4ccf37acd608dc437d3a074410b1d840f706`. Production logs from the reported failure showed the project draft save returning `200`, followed by two `409` profile saves and no installer-request submission. Source and local trigger reproduction proved the profile row was updated successfully, but D1 reported three total changes because `tlink_customer_search_update` also deletes and reinserts the search row. The API incorrectly required exactly one change and therefore returned a false revision conflict after committing the update.

The release:

- treats any positive conditional profile or request-submission change count as success while preserving zero as the real compare-and-swap conflict;
- covers both the customer-profile search trigger and the triggered trade-opportunity insert;
- keeps the one-confirmation flow, bounded uncertain-response reconciliation and idempotent request boundary;
- allows several independent photos under one guided prompt and renders every saved and pending photo in that section;
- provides per-photo retake, replace, remove or cancel controls plus `Add another photo` and `Choose another photo`;
- keeps earlier-selection photos grouped and visible;
- retains same-origin authentication, owner scope, private-by-default storage, metadata stripping, 8 MB per-file validation, the 12-file project cap, client-upload idempotency and exact-photo replacement locking; and
- applies `0086_customer_evidence_multi_photo_prompts.sql`, which removes only the obsolete active-prompt and in-progress-prompt uniqueness indexes.

The focused request, recovery, profile, project, evidence and guided-photo set passes 55 of 55. Exact application commit `5acc4ccf37acd608dc437d3a074410b1d840f706` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, 916 total tests with 914 passed and 2 intentionally skipped, all 87 migrations through `0086_customer_evidence_multi_photo_prompts.sql` against fresh SQLite and Cloudflare D1 paths, the tagged-PDF audit, Vinext production build and Sites server-bundle audit. `git diff --check` passes.

GitHub `main`, branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA. Local archive `aea-sites-5acc4cc.tar.gz` is 7,086,372 bytes with SHA-256 `B110B28AE3F5D1A5256E478C20D44A5727084C51C6D0159FA20E91D31F6D69B0`. Sites reports 312 stored files, 27,770,880 bytes and content hash `sha256:47e85a2c9289437ee38c3c478a6191687e46ffec393215a59092ac1185bc8c6f`.

Sites version 233 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_218ad21977748191a3283723f395cadd` and deployed through `appgdep_6a6be56ca9ac8191918423bd57f0a05d` with environment revision 19. Signed-in production inspection loaded the quote-preparation photo cards, privacy review and the active `Save details and request responses` modal. Customer-account and customer-project reads returned `200`; the post-deployment Worker error-only query returned zero events. The dialog was closed without saving a profile, submitting another working-demo request or changing project evidence.

## Authoritative customer installer submission release

`CUSTOMER-INSTALLER-SUBMIT-17` is released from exact application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b`. Production reproduction showed the modal contact PATCH returning `200`, followed by the project submission falsely reporting that the street address was missing. The submit query selected the raw D1 column `address_line_1`, while the shared readiness helper checked only camel-case `addressLine1`. Contact had already been committed, but the split client/server flow then rejected its own authoritative data.

The release:

- sends modal contact in the customer-project submission rather than performing a separate profile PATCH;
- validates phone, street, unit and suburb at the server boundary while deriving postcode and state from the owner-scoped project;
- persists contact, transitions the project, creates the installer opportunity and records consent in one guarded D1 batch;
- preserves project revision protection while removing the obsolete client-side profile revision token and retry loop;
- normalises both raw D1 snake-case and API camel-case address projections at the shared readiness boundary;
- makes matching and quote-review replays idempotent contact updates without duplicating opportunity or consent records;
- rejects terminal project states rather than returning a false success;
- returns the normalised saved profile and refreshed project state to the client; and
- keeps identity and contact withheld during matching until the customer separately approves direct contact.

The focused authoritative-submit set passes 50 of 50. Exact application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, 915 total tests with 913 passed and 2 intentionally skipped, all 87 migrations through `0086_customer_evidence_multi_photo_prompts.sql` against fresh SQLite and Cloudflare D1 paths, the tagged-PDF audit, Vinext production build and Sites server-bundle audit. `git diff --check` passes. An independent final semantic review found no remaining actionable submit-flow issue.

GitHub `main`, branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA. Local archive `aea-sites-7d7a821.tar.gz` is 7,086,533 bytes with SHA-256 `22DE94F3E9B22493FF79ED9DC70FF62F6D8B7259DC02AEB93E33B28445EEF2C3`. Sites reports 312 stored files, 27,770,880 bytes and content hash `sha256:3ffeb4fb493c6426cb78aceb8792de7e2e65830181d410c23d53ea9a8a87cc9f`.

Sites version 234 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_06f96686a8dc8191a0e01c2555c2de1b` and deployed through `appgdep_6a6bf3695b6081918ce2a9dd77bc3869` with environment revision 19. Signed-in production verification opened project `154aee4d-3648-4c7c-b393-c6715c518b24`, confirmed the screenshot-equivalent modal contact and selected `Save details and request responses`. Request `a238af3e5f81164e` returned HTTP `200`; the dialog reported `Request sent`, the account overview reported `Installer matching`, and the post-deployment Worker error-only query returned zero events.

This live verification intentionally changed working-demo data: that project moved from draft to installer matching, transactionally created the opportunity and consent records, and triggered normal administrator-notification and allocation processing. The HTTP `200` submit proves the guarded transaction completed; it does not independently prove downstream allocation rows because allocation failures are intentionally isolated from customer submission. No real customer, trade or wholesaler account was involved.

## Installer enquiry pack, approved evidence and business notification release

`INSTALLER-ENQUIRY-PACK-18` is deployed from exact application commit `eeba3679c30789cfe2e633a913a18492270fcc3e`.

The release:

- derives one bounded installer enquiry pack from the authoritative customer-plan document;
- shows goals, plan boundary, controlled home context, quote readiness and the first three ordered roadmap steps high in the matching lead;
- excludes customer and account identity, contact, exact location, private notes, room names and routines, permission notes, adviser identity and review text, arbitrary customer plan items, evidence filenames and meter data;
- reports the approved-evidence count and lazy-loads images only after the exact allocated installer selects `Show approved photos`;
- keeps PDFs behind an explicit protected download and reuses the authenticated, audited installer-evidence endpoint;
- rechecks reviewed-installer access, exact allocation, opportunity state and active evidence-sharing consent at every evidence read;
- opens notification links directly in the signed-in Leads workspace;
- enqueues exactly one durable business notification when a new match is created, without backfilling historical matches;
- dispatches outside the customer request, rechecks installer eligibility, consent, current recipient and suppression immediately before send, retries bounded synchronous delivery failures with frozen content, and treats terminal provider callbacks monotonically;
- limits the notification email to business name, state, service labels, timing or expiry, approved-evidence count and the signed-in Leads link;
- stops awaiting the independent administrator webhook during customer submission; and
- runs independent owner and project hydration reads concurrently before the authoritative transaction.

Focused notification tests pass 10 of 10, the enquiry-pack privacy and UI contract passes 3 of 3, and the related submit, contact and cron regressions pass. Exact application commit `eeba3679c30789cfe2e633a913a18492270fcc3e` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, 931 total tests with 929 passed and 2 intentionally skipped, all 88 migrations through `0087_trade_opportunity_notifications.sql` against fresh SQLite and Cloudflare D1 paths, the tagged-PDF audit, Vinext production build and Sites server-bundle audit. `git diff --check` passes. Independent implementation and notification reviews were closed before publication.

GitHub `main`, branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA. Local archive `aea-sites-eeba367.tar.gz` is 7,098,588 bytes with SHA-256 `326DD4224505C9364A8D2852877D4037C397422788F97394B00A0EA9D80D48F1`. Sites reports 313 stored files, 27,822,080 bytes and content hash `sha256:7eea5f36d7a31df1213c163a8d0f836b6f02dd18e3bdc6a60cc5cc5831b24121`.

Sites version 235 from `eeba3679c30789cfe2e633a913a18492270fcc3e` is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_0fac9e3297808191afc57d58d9377584` and deployed through `appgdep_6a6c0908063081919b2e985a27141e34` with environment revision 19. The required Resend environment names are present and the post-deployment Worker error-only query returns zero events.

No new working-demo match was created after this release, so no opportunity email was sent and the measured production submit duration was not repeated. The pre-release working-demo lead is intentionally not backfilled. Chrome control could list but not reliably claim the existing signed-in trade tab; the stable in-app browser reached the expected signed-out account gate. The automated privacy, API, UI, migration and delivery contracts pass, but live signed-in Leads/photo presentation, real provider delivery and the reduced production submit duration remain unverified. Deployment identity is verified; release acceptance is incomplete until those bounded checks are performed with dedicated non-customer fixtures.

## Complete customer-installer handoff release

`CUSTOMER-INSTALLER-HANDOFF-19` is deployed from exact application commit `059f2ff8d3885b3453dd38d7dee8e660fd05c4fb`.

The release:

- records one durable dispatch job in the authoritative customer-request transaction before returning compact HTTP `202`;
- drains allocation, operations email and business email outside the customer response with `waitUntil`, while the scheduled Worker remains the recovery path;
- retries provider work with bounded backoff and does not mark the dispatch complete while any exact admin or trade delivery is still outstanding;
- lets an explicit resubmit revive only exhausted pending or failed dispatch jobs, preserving completed and actively processing jobs;
- independently attempts the operations alert so an allocation failure cannot suppress it;
- treats offered, viewed, interested and connected allocations as eligible for their exact business alert;
- turns final project-request consent into explicit sharing of every active image that existed at that request boundary, while arbitrary PDFs and documents retain their separate explicit sharing choice;
- provides an owner-only `Share all project photos` repair for an existing matching or quote-review working-demo project without manufacturing historical allocations;
- replaces the first-three-step extract with the complete ordered privacy-safe plan, protected preview and protected PDF for the exact reviewed and allocated installer;
- renders every authorised evidence card, loads image previews concurrently, preserves partial success and keeps a protected download when a preview fails;
- clears protected plan and evidence state before sign-out or user change, revokes object URLs and blocks stale asynchronous responses from repopulating another user session; and
- reports checking, plan save, per-photo upload percentage and request dispatch in the modal, with reassurance after eight seconds and a longer-delay message after 25 seconds.

The complete non-release-integrity suite passes 941 tests with 939 passed, 2 intentionally skipped and 0 failed. The backend-focused dispatch, timing, notification and property-arrival set passes 32 of 32. Type checking, warning-free lint, all 89 migrations through `0088_customer_opportunity_dispatch_jobs.sql`, the tagged-PDF audit, the Vinext production build and the Sites server-bundle audit pass. `git diff --check` passes. Independent integrated QA found no remaining actionable privacy, idempotency, notification, progress, authentication-transition or migration issue.

GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA. Local archive `aea-sites-059f2ff.tar.gz` is 7,107,950 bytes with SHA-256 `D32307C4B0FABF955FB4CF878CBD31290F053E06BA3CA67A92DBFBED6FD262E4`. Sites reports 318 stored files, 27,873,280 bytes and content hash `sha256:6c489fbaa560f2df5dc6cb9d807d1ae7c1d7b7a752632909bc45bc1f71a9c090`.

Sites version 236 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_82454487760c8191b1f5338538b8fcb8` and deployed through `appgdep_6a6c3b56a1b881919e82e97eaa286bc4` with environment revision 19.

The executable application and deployment identity are verified. Signed-in production presentation, measured production submit duration and provider inbox receipt are not yet claimed. Automated authorization, privacy, idempotency, retry, progress and complete-projection contracts pass, but those live acceptance checks require the existing working-demo sessions and must not be inferred from configuration.

## Customer quote communications and discovery release

`CUSTOMER-QUOTE-COMMS-20` is deployed from exact application commit `35552796048df63c03409d03401d33a47f326434`.

The release:

- queues a customer email when an approved installer submits a new structured quote;
- queues an installer email when the customer accepts that exact quote and records the same accepted event in the trade Work updates bell and dialog;
- adds a top-level customer Quotes centre so waiting and accepted responses are visible without opening each project and scrolling through its detail;
- uses exact owner-scoped project and quote deep links from both email and dashboard surfaces;
- makes installer quote submission retry-safe through one durable request and revision ledger, with exact target fetch after submission;
- gives each project one durable accepted-quote claim so a stale competing acceptance cannot withdraw the winner, create a false acceptance event or replace the chosen installer, while a retry for the same accepted quote remains idempotent; and
- records authenticated Resend callbacks monotonically and preserves bounded retry processing for eligible frozen delivery payloads.

The exact application commit passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, 973 total tests with 971 passed, 2 intentionally skipped and 0 failed, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the tagged-PDF audit, the Vinext production build and the Sites server-bundle audit. The focused customer quote-communications set passes 26 of 26 and the focused Resend callback set passes 7 of 7. `git diff --check` passes.

GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA. Local archive `aea-sites-3555279.tar.gz` is 7,110,732 bytes with SHA-256 `387A5D0FC4A5BF74DB78964348EC3577457818FBC9BC35F86BCFF1C04F83B616`. Sites reports 321 stored files, 27,965,440 bytes and content hash `sha256:291666539b26173a276dc09c76bbba6e94955b434d6ab5f524b850e5cda6ad52`.

The documentation-only commit `40b4396b9ef41166a61ee346b023c00bcc9df11b` was saved as Sites version 237 with identity `appgprj_6a550c378000819185caf094173422bb~appgver_a2882f3eb264819199cedf74de7add75`, but it was never deployed. Sites version 236 stayed public until the exact version-238 application source was ready. Sites version 238 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_c9b4dbcee8408191a3fdce1aaef5548d` and deployed through `appgdep_6a6c5f96df388191a5e68ffd53fb68b0` with environment revision 19 at the custom domain.

The historical executable identity was Sites version 238 from `35552796048df63c03409d03401d33a47f326434`.

Signed-in Chrome verification confirmed that the top-level customer Quotes centre showed the accepted quote and the trade Work updates bell and dialog showed the accepted event. Opening the dialog moved focus into it and closing restored focus to the trigger. Production provider inbox receipt, provider credentials and sender approval, and hosted activity, delivery and acceptance-claim row counts remain unverified. Those provider-side and hosted-data facts are not inferred from source, local validation, environment-name presence or the signed-in visual check.

## Customer-to-trade contact and compact lead workflow release

`CUSTOMER-TRADE-CONTACT-21` is deployed from exact application commit `97e6c7356483706e8e978ab53b842a9e41152f7e`.

The release:

- replaces the customer shortlist and acceptance sequence with one `Get in touch with this business` action;
- states before and after the handover that contact permission does not accept a quote, create a contract or invoice, make a payment, or authorise work;
- commits the exact one-business claim, contact release, match connection, competing-option closure, consent receipt, activity event and durable installer follow-up in one owner-scoped batch;
- retains the legacy internal `accepted` identifier only for compatibility with the existing one-business claim, while refusing to let a legacy flag create first-time contact disclosure;
- derives one deterministic unread `New lead ready to review` Work update for the exact business that owns each new allocation, with no customer identity or private household content in the notification;
- collapses lead cards by default, retains a compact work summary and lets exact deep links expand and focus the authorised lead;
- groups structured quote inputs into aligned responsive price, timing and warranty sections without changing integer-cent calculations or immutable submissions; and
- focuses and scrolls the customer to the active project-builder heading after Continue, after the next panel renders and with reduced-motion support.

The exact application commit passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, the full test suite with no failures and 2 intentionally skipped tests, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the customer-plan PDF audit, the Vinext production build and the Sites server-bundle audit. The integrated focused customer-contact, lead-notification, trade-card, quote-layout and navigation set passed 68 of 68 tests; additional direct-trade and business-hub coverage passed 16 of 16; and the final privacy regression set passed 35 of 35. `git diff --check` passed.

GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA. Local archive `aea-sites-97e6c73.tar.gz` is 7,127,725 bytes with SHA-256 `BF9EAAE34B1FBB197C30AF94F0ADB9DBE92BBC347F8B60424C6D0444D9FCD7DF`. Sites reports 321 stored files, 27,985,920 bytes and content hash `sha256:8554bdbdbcc6c54afc9b04cb4d37b96d7ab423ed2ed64d591247bfa3ee6c6136`.

Sites version 239 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_ae43b05060ac8191918c70e9960e213c` and deployed through `appgdep_6a6c7cb6d6e0819187e9566a452e6850` with environment revision 19 at `https://compare.ausenergyassessments.com`.

Signed-in Chrome verification confirmed three unread new-lead bell items, the `New lead ready to review` wording and exact lead target, default-collapsed lead cards, exact expansion, the customer Quotes centre and the connected-state contact-only disclosure. Release QA did not submit a quote, release another contact, send a new provider email or mutate working-demo data. The Sites error-only query returned two informational canceled GET invocations caused while pages were reloaded and no Worker exception attributable to this release. A direct `/api/health` browser navigation was blocked by the local client extension and is not claimed as a successful health probe. Production provider inbox receipt and hosted row counts remain unverified.

## Customer plan trade enquiry and home-fact refinement release

`CUSTOMER-PLAN-TRADE-ENQUIRY-22` is deployed from exact application commit `b40c101939eec44b178b34ccb6397a989d2467d0`.

The release:

- replaces the public roadmap account-only continuation with `Enquire with verified trades` at both the roadmap action row and the actual bottom of the completed plan;
- explains the private account boundary before sign-in or account creation: the household can save its plan, ask for installer responses and compare inside AEA before choosing whether one verified business receives direct contact details;
- carries the exact selected public roadmap query into the account bridge, avoiding repeated owner or renter, goal, budget and home-fact entry;
- separates gas storage hot water, continuous-flow gas hot water and `Not sure`;
- records a household-reported single-phase, three-phase or unknown electricity clue without treating it as verified capacity, and directs the customer to an existing record, safe front-on photograph or licensed electrician rather than unsafe inspection;
- records whether kitchen and bathroom exhausts discharge outside, into the roof cavity or are not known, separately records a visible self-closing or backdraft damper clue, and prohibits entering the ceiling or dismantling equipment to answer;
- keeps anonymous and collapsed trade leads privacy-safe while making the released customer name the connected lead heading and placing the one authorised phone, email and service-address block first after expansion; and
- preserves the exact-match active contact-release gate, accessible expand and collapse relationship, and one non-duplicated customer-contact presentation.

The integrated focused customer plan, account bridge, taxonomy, trade identity and privacy set passed 99 of 99 tests. Independent public-plan coverage passed 52 of 52 tests plus type checking. The focused connected-trade set passed 13 of 13 tests. The complete `npm.cmd run validate` gate passed type checking, warning-free lint, 31 of 31 integration tests, 994 total tests with 992 passed, 0 failed and 2 intentionally skipped, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the nine-page customer-plan PDF audit, the Vinext production build and the Sites server-bundle audit. `git diff --check` passed.

GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain exact application commit `b40c101939eec44b178b34ccb6397a989d2467d0`. Sites version 240 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_f26581d5ff348191855551ce325e8c40` and deployed through `appgdep_6a6c971b63988191a92e4031fc74692b` with environment revision 19 at `https://compare.ausenergyassessments.com`.

The historical executable identity for that release was Sites version 240 from `b40c101939eec44b178b34ccb6397a989d2467d0`.

Live verification confirmed two `Enquire with verified trades` actions, including the true plan-bottom action. The selected handoff retained owner tenure, continuous-flow gas hot water, the reported three-phase clue, cavity-discharge exhaust and the visible damper clue in the query. The account privacy screen explained why an account or sign-in was required. A connected trade lead showed the released customer identity and contact block first after expansion. The post-deployment Sites Worker error-only query returned zero events. Verification did not create an account, save a plan, submit an enquiry, change a release or mutate production data.

No Sites version 240 release archive was uploaded or recorded, so no archive hash, stored-file count, stored-byte total or content hash is claimed. Production provider inbox receipt and hosted row counts remain unverified.

## Customer account trust and plain household ventilation release

`CUSTOMER-ACCOUNT-TRUST-23` is deployed from exact application commit `da4fa911c0b6c7f520e266259af8882b95aaf14a`.

The release:

- replaces separate customer-facing exhaust-discharge and backdraft-damper questions with one shared visible-fan question used by public `/plan` and the signed-in project builder;
- asks whether a kitchen exhaust fan or rangehood and a bathroom exhaust fan are fitted, while retaining explicit `No fans` and `Not sure` choices;
- tells the household that it does not need to know where a fan vents or whether it has a shutter or damper;
- maps retained legacy technical ventilation answers conservatively to `Not sure` unless a newer explicit fan answer already exists;
- keeps any later discharge-path investigation with a property manager or suitably qualified trade when moisture, steam or smells do not clear;
- gives every email-account input, including the password, a visible full-width control with a persistent requirement and field-associated errors;
- presents equal-width responsive create-account and sign-in tabs with a clear selected state and keyboard focus;
- supplies Firebase's hosted verification handler with an authorised current-origin customer return URL;
- reloads the Firebase customer identity and forces a fresh ID token before the application trusts a newly verified email state; and
- reports a verification-send failure accurately rather than silently claiming delivery.

The integrated focused customer taxonomy, decision-support, account UI and verification set passed 72 of 72 tests. Independent final review passed 18 of 18 customer account and verification tests, 25 of 25 trade-isolation tests and type checking, and reported no actionable defect. The complete `npm.cmd run validate` gate passed type checking, warning-free lint, the integration and full test suites, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the nine-page customer-plan PDF audit, the Vinext production build and the Sites server-bundle audit. `git diff --check` passed.

GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain exact application commit `da4fa911c0b6c7f520e266259af8882b95aaf14a`. Sites version 241 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_2149679b0df08191a77cd91ac13d9cc7` and deployed through `appgdep_6a6caabc547c81919c4642b1f7cfcde1` with environment revision 19 at `https://compare.ausenergyassessments.com`.

Live public production verification confirmed the simple fan question, its `No fans` and `Not sure` paths, and the absence of customer-facing discharge-path and damper questions. The live private-account entry measured a visible 364 by 48 pixel password control and equal 175 by 46 pixel account tabs at the desktop viewport with no horizontal overflow. The live `/account?verification=complete` return rendered the customer account entry without a route error. Local 390 by 844 visual inspection confirmed the responsive account layout. Browser error logs and the post-deployment Sites Worker error-only query returned zero events. Verification did not create an account, send an email or mutate production data.

No Sites version 241 release archive was uploaded or recorded, so no archive hash, stored-file count, stored-byte total or content hash is claimed. A newly generated provider verification email, inbox receipt and action-code completion were not exercised during release QA and remain unverified. Existing trade verification behavior is unchanged by this customer-only milestone.

## Protected trade locality and reciprocal product navigation release

`CUSTOMER-TRADE-LOCALITY-24` is deployed from exact application commit `399b04f4a5d680080610f9e88b994506bb60c16f`.

The release:

- places the installer-request consent in the sticky action area immediately above submit and renders a missing-consent alert beside that action;
- focuses the consent control after an invalid submission and associates the checkbox, error and other request fields through the same accessible error description;
- uses one shared aligned customer navigation on the account dashboard and profile, with current-page semantics and a branded TLink destination;
- exposes the real white Australian Energy Assessments mark and full-name return destination in public and signed-in TLink headers;
- adds immutable suburb to each new opportunity's existing postcode and state snapshot through migration `0092_trade_opportunity_matching_locality.sql`;
- writes the exact-current `2026-08-01-anonymized-matching-locality-v1` notice receipt for purpose `anonymized_installer_matching` in the guarded installer-request transaction;
- shows suburb, postcode and state to an eligible trade or its business notification only when the exact project has that active exact-version receipt; and
- keeps legacy, missing, mismatched and withdrawn receipts state-only without reading mutable customer profile locality or backfilling older opportunities.

The household's name, phone, email, street address, unit, precise distance, project names, private notes, meter data and unapproved documents remain excluded from installer matching. The customer-facing shareable plan and PDF continue to exclude exact postcode. The narrower locality disclosure is confined to the protected matching boundary and uses the opportunity snapshot, not the current customer profile.

The focused consent, navigation, privacy, locality, trade-enquiry and notification set passed 96 of 96 tests. The complete `npm.cmd run validate` gate passed type checking, warning-free lint, 31 of 31 integration tests, 1,014 main tests with 1,012 passed, 2 intentionally skipped and 0 failed, all 93 migrations through `0092_trade_opportunity_matching_locality.sql`, the nine-page customer-plan PDF audit, the Vinext production build and the Sites server-bundle audit. Targeted ESLint and `git diff --check` passed.

GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain exact application commit `399b04f4a5d680080610f9e88b994506bb60c16f`. Sites version 242 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_bc9f3157a9e88191881c5989f7de7ba0`, with package content hash `sha256:3d7535003e6b3fae6b2b7f4f86b5c69a59737a8aa607ba7feabdbd407fd890f0`, and deployed through `appgdep_6a6cc08dc6f881919a349de607f5a8a9` with environment revision 19 at `https://compare.ausenergyassessments.com`. The temporary local release package was deleted after deployment.

Live signed-in verification confirmed equal customer-navigation alignment at desktop, 900 and 768 pixel widths and no document overflow at 520 pixels. The profile route renders the same navigation with current-page semantics. TLink exposes the real white Australian Energy Assessments mark and full return name, wraps cleanly at 900 pixels and retains the full return at 520 pixels without document overflow. The installer-request dialog keeps its checkbox, missing-consent alert and submit action together; at 360 by 800 pixels the alert occupied 629.1 to 708.7 and the submit action 719.9 to 780.0 within the viewport. The production preview describes suburb, postcode and state as the protected job area. Browser inspection did not submit the form or change production data, and the post-deployment Sites Worker error-only query returned zero events.

Release QA deliberately did not create a new production opportunity. A newly written version-242 opportunity row and its locality-bearing business email were therefore not observed live and must not be inferred from the existing legacy state-only leads. Existing opportunities remain state-only by design. Hosted row counts and independent direct querying of the managed D1 database remain unavailable.

## Local validation evidence

The last complete shared-worktree validation was recorded before the release was split into compatible expansion, application activation and contract cleanup:

- `npm.cmd run validate`, including type checking, warning-free lint, 35 integration tests, 717 full-suite tests with 715 passed and 2 intentionally skipped, all 80 migrations replayed against a fresh local D1 database, and the production build.
- `npm.cmd --prefix mobile run typecheck`.
- The isolated `DatabaseSync(":memory:")` benchmark with 100,000 rows in each of five datasets. All guarded queries remained below the 75 ms p95 threshold; reviewed-supplier catalogue first-page p95 was 0.118 ms and deep-cursor p95 was 0.127 ms in the final recorded run.
- The audit snapshot contains exactly 22 nonempty Markdown reports with an H1 and balanced fences. Its redundant duplicate archive is excluded from public source; the two user-profile path roots in the manifest were generalised to `%USERPROFILE%` before publication without changing a substantive finding.

The exact expansion commit `7ebcb1905d3c28245fbcfede55525e0cfee8df8a` passed `npm.cmd run validate`, including all 80 migrations and the production build. The application activation passed type checking, warning-free lint, 29 integration tests, 718 full-suite tests with 716 passed and 2 intentionally skipped, all 80 migrations and the production build. The exact contract commit `698a5057cc384d43112e5ccff38a99effbb01fa8` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 30 integration tests, 719 full-suite tests with 717 passed and 2 intentionally skipped, all 81 migrations and the production build. Mobile type checking passes. The isolated 500,000-row benchmark passes every 75 ms p95 guard; reviewed-supplier first-page p95 is 0.168 ms and deep-cursor p95 is 0.124 ms.

Exact application commit `53e6cf96aff6f48e9e393a23c4eedbeba997eb39` passes 174 of 174 integrated focused customer-project, quote-preparation, capability-matching, consent, compatibility, operational-category and Home-record retirement tests. The complete `npm.cmd run validate` gate passes on that clean commit: type checking, warning-free lint, 32 integration tests, the full 755-test suite with 753 passed and 2 intentionally skipped, all 82 migrations against a fresh local D1 database, and the production build. `git diff --check` also passes. Desktop and 375-pixel browser checks confirm the redesigned Home, Goals, Plan, Work and Privacy stages, accurate progress, no preselected goal, explicit preservation or refresh of an edited plan, one evidence-upload boundary, action-local validation, the separate preparation guide and no mobile horizontal overflow. Sites version 204 has matching saved-source provenance; public health, the new guide and signed-out project entry return `200`, the retired Home records route returns `404`, and the recent worker-error query returns zero events.

Exact application commit `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77` passes 38 of 38 focused advisor and administrator stability tests. The complete `npm.cmd run validate` gate passes on the exact release source: type checking, warning-free lint, 32 of 32 integration tests, the full 770-test suite with 768 passed and 2 intentionally skipped, all 83 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passes. An independent final review found and closed two pre-release safety defects: customer classifications can no longer replace an authoritative site-check rule, and room concerns can no longer combine with the use period of another room. A malicious permission-title, identifier and note regression proves that arbitrary private wording is not copied into the shareable checklist.

Desktop visual inspection confirmed readable project-guide contrast. A 390 by 844 computed responsive check reported a 390-pixel viewport, 375-pixel root content width and no horizontal overflow. Signed-in working-demo customer verification confirmed five directly selectable steps, multiple goals, explicit source labels, room profiles, broad climate wording, editable linked plan steps and the five-section permission preview. Signed-in owner verification opened the first unread demo notification; after the audited read update removed its `Mark read` action, the record still had one `Close case` control, remained expanded and retained its first visible position. Public health, guide, signed-out customer route and administrator shell returned `200`. Sites version 206 has matching saved-source provenance and environment revision 19.

Exact application commit `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e` passes 51 of 51 focused plan, privacy, provider, accessibility and navigation regressions. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 784-test suite with 782 passed and 2 intentionally skipped, all 83 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passes. Independent privacy, security, accessibility, print and release reviews were closed before publication. Sites version 208 has matching saved-source provenance and environment revision 19.

Live public verification confirmed the reconciled seven-part `/plan` intake, multiple goals, owner-or-renter first, separate shared-property approval, current home facts, budget, pace, optional state, bounded questions and controlled rationales. The guide text renders as `rgb(185, 204, 215)` on the navy canvas without horizontal overflow. The live print route contains the ordered plan, decision questions, guide links and browser Print or Save as PDF action. A representative four-page A4 output was inspected without clipped cards, dark artifacts or application chrome. Required Sites delivery and limiter configuration names are present, but secret values were not read or reproduced. The authenticated email path was not exercised against a real recipient; ownership, privacy, idempotency, rate-limit and provider behavior are covered by automated regressions. No real account was created or used and no demo data changed.

Exact application commit `6540ee671e64dbfdf80592283a1954b2ff482355` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, the full 803-test suite with 801 passed and 2 intentionally skipped, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. A final focused privacy, report and compatibility set passed 27 of 27 tests. `git diff --check` passed. Independent taxonomy, evidence, privacy and final-diff reviews were closed before commit. GitHub and the Sites managed source branch both resolve to the exact application SHA. Sites saved version 210 reports that SHA as its source and deployment `appgdep_6a695ca742d081918d73196751713f98` succeeded with environment revision 19.

Local desktop and 390 by 844 planner checks found no horizontal overflow. A representative three-page, 137,415-byte A4 PDF was rendered and inspected without clipped content or application chrome. Live public `/plan` and `/plan/print` checks confirmed the categorized home questions, several goals, renter guidance, concise readiness language, ordered actions and readable desktop plus 390 px report layouts. Signed-in working-demo inspection confirmed five clickable builder steps, the same categorized taxonomy, `Not sure` bulk completion, budget, email and PDF actions, reorder and remove controls, the email-dialog `Review home details` correction path and the installer-only file count. The temporary project title existed only in unsaved browser state. No project was saved, no evidence was uploaded, no email was sent and no real customer, trade, wholesaler or assessor account was created. Live email-provider delivery and live authorization-denial mutation paths were deliberately not exercised; ownership, rate-limit, consent, privacy and provider-acceptance boundaries are covered by automated regressions.

Exact application commit `ee75aadfd6800c01b92532b2d376a4a1e33c9d74` passes 70 of 70 focused professional-review, print, report and compatibility tests; the final print-lifecycle subset was rerun after the cleanup review and passed 17 of 17. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 816-test suite with 814 passed and 2 intentionally skipped, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed. Independent taxonomy and final-diff reviews closed before publication. GitHub and the Sites managed source branch both resolve to the exact application SHA. Sites saved version 212 reports that SHA as its source and deployment `appgdep_6a69c4f838bc8191a0e050da219ab4a6` succeeded with environment revision 19.

Public desktop and narrow-viewport computed checks found no horizontal overflow and confirmed the categorized home facts, helpful-action section and separate roadmap. Signed-in working-demo inspection confirmed the optional adviser declaration and its controlled fields on Goals, plus helpful actions, email and print controls on Plan. A representative maximum-content six-page A4 report rendered in about half a second and was visually inspected without clipped professional text, split action cards, dark artifacts or application chrome. Browser screenshot capture timed out, so live layout evidence came from semantic snapshots and computed geometry rather than a screenshot. No working-demo value was saved, no evidence was uploaded, no email was sent, the live print dialog was not opened and both signed-in inspection tabs were discarded after verification.

The post-release Sites error-only query returned three informational canceled `/api/electricity-plans` health-monitor invocations and no exception message attributable to the newly checked release routes. This does not prove an end-to-end electricity-plan provider result and remains an operational monitor observation. No real account was created or used.

Exact application commit `d5c675a5ceffa6e924df033e8cb8b505bb4d6336` passes 40 of 40 focused PDF, customer-project UI and navigation tests. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 820-test suite with 818 passed and 2 intentionally skipped, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed. GitHub and the Sites managed source branch both contain the exact application SHA. Sites saved version 214 reports that SHA as its source and deployment `appgdep_6a69e79a91548191987f12631559cb1f` succeeded with environment revision 19.

A maximum-content seven-page A4 PDF with long adviser content and six everyday actions was rendered and visually inspected without clipped text, unreadable contrast or application chrome. Live public verification confirmed the exact `Preview and download PDF` route, one enabled `Download PDF` action, no native-print copy, no alert and no JavaScript dialog. The production action created a 29,002-byte three-page PDF. Independent parsing confirmed the `%PDF-` signature, A4 `595.28 × 841.89` page boxes, expected title and author, readable first-page text, no encryption and no embedded JavaScript. No project or account record was created or saved, no evidence was uploaded, no email was sent and no provider delivery path was exercised.

Exact application commit `8cdec99bcd2d1cb9f2ec0dc18c87a71860412642` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, the full 820-test suite with 818 passed and 2 intentionally skipped, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. The focused PDF, mutation-boundary, navigation and account-cache regression set passes 45 of 45 tests. `git diff --check` passed. GitHub `main`, the working branch and the Sites managed source branch contain the exact application SHA. Sites saved version 216 reports that SHA and deployment `appgdep_6a69f763e0b08191b6ac8539e0828d84` succeeded with environment revision 19.

A cold local Chrome-channel check completed the native PDF response in 139 ms. The live custom-domain action completed in 1,906 ms and made exactly one `POST /api/customer-plan-pdf` request. It downloaded `home-energy-plan-2026-07-29.pdf`, returned `200`, `application/pdf`, `Content-Disposition: attachment` and `Cache-Control: no-store`, and produced a 6,532-byte, unencrypted, three-page A4 document with a valid `%PDF-` signature. The button recovered to enabled `Download PDF`; there was no alert, page error, print dialog, client PDF worker, font fetch, project save or evidence upload. Live `/account` and `/account/projects/new` HTML returned `private, no-store, max-age=0`. The post-deployment Sites error-only log query returned zero events. The signed-in handler's zero-mutation contract is covered by source regression because the isolated release browser did not create or mutate a working-demo account.

Exact application commit `fb6cacf8b0309a3fc26b40a43da5b025050d22d2` passes 33 of 33 focused report, PDF and customer-project UI tests. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 822-test suite with 820 passed and 2 intentionally skipped, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed. GitHub `main`, the working branch and the Sites managed source branch contain the exact application SHA. Sites saved version 218 reports that SHA and deployment `appgdep_6a6a11c02e088191bb27cc302c8b35af` succeeded with environment revision 19.

A representative maximum-content professional-review report produced a 20,125-byte, unencrypted eight-page A4 PDF with no JavaScript, no blank page, no clipped or split action card, 13 same-origin link annotations and no raw visible URL. Every rendered PDF page was inspected. The matching email was inspected at 760-pixel desktop and 375-pixel mobile widths with no horizontal overflow or remote image. The live custom-domain action emitted one download event, recovered the enabled `Download PDF` button, opened no JavaScript dialog and produced no browser error. The post-deployment Sites error-only log query returned zero events. No project or account record was created or saved, no evidence was uploaded, no email was sent and no provider delivery path was exercised.

Exact application commit `f401575a5bf463b85c7688424db0b99dddd220c5` passes 56 of 56 focused final report, PDF, email, brand and navigation tests. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 826-test suite with 824 passed, 2 intentionally skipped and 0 failed, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and the Sites managed source branch contain the exact application SHA. Sites saved version 220 reports that SHA and deployment `appgdep_6a6a265a51108191bdc8ae6a4eefbf8f` succeeded with environment revision 19.

A representative household report produced a 41,925-byte, unencrypted nine-page A4 PDF with no JavaScript. Every page was rendered and visually inspected, including page 2 where the exact household-supplied evidence boundary appears once. A completed-plan PDF cover and second page were separately inspected and reported `16 STEPS COMPLETE` and `0 LEFT TO PLAN`, without inventing a next step. Live `GET /api/aea-brandmark` returned `200`, `image/png`, `Cache-Control: public, max-age=31536000, immutable`, 3,595 bytes and a valid PNG signature; browser inspection showed the exact 96 by 96 mark. Live `/plan` returned `200`, 54,406 bytes and was visually inspected. Sites logs recorded the new logo and plan requests with outcome `ok` and status `200`. No email was sent, no customer, project or other data was mutated, and native print was not invoked. Browser security blocked a local-file email render, so delivered Gmail and Outlook rendering remains unverified and is retained as explicit forward work.

Exact application commit `e74c2d95889a381cb3bb434607bc6584e54cf722` passes 56 of 56 focused final report, PDF, email, brand, navigation and customer-project tests. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 826-test suite with 824 passed, 2 intentionally skipped and 0 failed, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and the Sites managed source branch contain the exact application SHA. Sites saved version 222 reports that SHA and deployment `appgdep_6a6a8887a0048191b7eb1706e742ad28` succeeded with environment revision 19.

A synthetic representative report produced a 47,059-byte seven-page A4 PDF. Every page was rendered and visually inspected for repeated-card spacing, rounded clipping, section transitions, footer clearance and the privacy-to-closing sequence. The matching 42,249-byte email was served only from a local loopback preview and inspected across its priority, roadmap, separated comfort tiles, climate, confidence, trade and privacy sections. Automated regressions confirm the narrow-width snapshot gap, mobile section rhythm, rounded shell and tiles, PDF clipping operators and maximum-content email size guard. Live `/plan` returned `200` with 54,406 bytes and `/api/aea-brandmark` returned `200`, `image/png` with 3,595 bytes. The post-deployment Sites error-only query returned zero events. No email was sent, no customer, project or other data was mutated, and native print was not invoked. Delivered Gmail and Outlook rendering remains unverified and is retained as explicit forward work.

Exact application commit `bc427d295b3106907904a3c0b7bf9f2945561cd1` passes 73 of 73 focused preview, PDF, email, evidence, revision, photo and customer-project tests. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 850-test suite with 848 passed, 2 intentionally skipped and 0 failed, all 85 migrations through `0084_customer_plan_revision_restore.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and the Sites managed source branch contain the exact application SHA. Sites saved version 224 reports that SHA and deployment `appgdep_6a6b151c0178819185e4d57c1cbf75c2` succeeded with environment revision 19.

A synthetic representative report produced a 60,177-byte eight-page tagged A4 PDF with no encryption or JavaScript. Every page was rendered with Poppler and visually inspected for hierarchy, readable contrast, rounded surfaces, clipping, overlap and footer clearance. The document declares `en-AU`, a structure tree, reading-order references, link objects and artifacts; it is a tagged foundation, not a PDF/UA conformance claim. A synthetic responsive email was inspected at desktop and 375 px widths with no horizontal overflow. The true maximum-field fixture produced 62,289 HTML bytes and 9,143 plain-text bytes, retained the full saved plan and PDF and explicitly disclosed the email-only six-step and two-tip projection.

Live `/plan` and `/plan/print` loaded from the custom domain with no captured console errors or horizontal overflow. The premium `/plan/print` hierarchy exposed its expected download action, first-party navigation and normalized roadmap. Live `/api/health` returned `{"ok":true,"service":"aea-energy"}`. Signed-in action-bar, revision and photo behavior is covered by source regression because live verification deliberately did not create or save an account project, upload evidence or use real customer data. No email was sent and native print was not invoked. Delivered Gmail and Outlook acceptance and independent assistive-technology testing remain unverified.

Exact application commit `da35ce60295d6c7150cddd9b35e33fcf64c8521b` passes the focused 23-test server, revision and enquiry set plus the focused 7-test layout, UI and accessibility set. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 863-test suite with 861 passed, 2 intentionally skipped and 0 failed, all 85 migrations through `0084_customer_plan_revision_restore.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and Sites managed `main` contain the exact application SHA. Sites saved version 227 reports that SHA and deployment `appgdep_6a6b22db21c48191a2dedbdbf05274ef` succeeded with environment revision 19.

The signed-in production dashboard was reloaded after publication and visually inspected. Draft actions were compact, aligned and readable; the non-draft installer-matching project did not expose deletion. The confirmation dialog showed a clear permanent-action warning, held initial focus on `Keep draft` and was cancelled without issuing a delete request. The saved-project detail showed two compact top-aligned controls rather than oversized full-column controls. Live `/api/health` returned HTTP `200`, `Cache-Control: no-store` and `{"ok":true,"service":"aea-energy"}`. No demo project, evidence record, account, email or other working-demo data was created, edited or deleted.

Exact application commit `0db488f325a79e22d126aace75647715b59c96f9` passes the focused 85-test workflow, document, revision, taxonomy and enquiry set. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 868-test suite with 866 passed, 2 intentionally skipped and 0 failed, all 85 migrations through `0084_customer_plan_revision_restore.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and Sites managed `main` contain the exact application SHA. Sites saved version 229 reports that SHA and deployment `appgdep_6a6b38fcccbc8191b8b2daedf57b9e24` succeeded with environment revision 19.

The signed-in production project was reloaded after publication and inspected without saving. Step 2 showed the goals, five home basics, detailed home categories, optional considered work, room profile, budget and pace before the roadmap. Step 3 showed the six expected `What shaped this roadmap` groups. Step 4 showed only quote-preparation content and a read-only work summary, with no repeated priority selector. Live `/api/health` returned HTTP `200`, `Cache-Control: no-store` and `{"ok":true,"service":"aea-energy"}`. The recent Sites worker error-only query returned zero events. No demo project, evidence record, account, email or other working-demo data was created, edited or deleted.

Exact application commit `2607cc53f2e4c79546701e29d3d182fde4670952` passes 44 of 44 focused installer-request, private-profile, recovery, project and UI tests. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full test suite, all 85 migrations through `0084_customer_plan_revision_restore.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and Sites managed `main` contain the exact application SHA. Sites saved version 230 reports that SHA and deployment `appgdep_6a6b5469c8bc81919f0e2c9ef22da602` succeeded with environment revision 19.

The signed-in production project displayed `Plan details, complete` with the expected green completion styling and opened the private `Where should the installer work?` dialog from `Request private installer responses`. Phone, address and suburb remained blank in the working-demo profile; project postcode `3006` and state `VIC` were derived and shown read-only. Browser-side required-field guidance remained within the dialog. The dialog was closed without entering or saving contact data, submitting a request or mutating the project.

Exact corrective application commit `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` passes the focused 18-test PDF and email correction set. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, 914 total tests with 912 passed and 2 intentionally skipped, all 86 migrations through `0085_customer_evidence_resumable_retake.sql`, the Vinext production build and the post-build Sites server-bundle audit. The generated server bundle contains neither `__dirname` nor the private Next Fontkit marker. Every page of the nine-page `2026-07-31-tagged-plan-pdf-v6` audit was visually inspected. GitHub `main`, the working branch and Sites managed `main` contain the exact SHA. Sites saved version 232 reports the same SHA and deployment `appgdep_6a6bd28a71888191be19f89db9b82ca5` succeeded with environment revision 19.

The signed-in production project loaded the current roadmap, plain-language revision comparison, privacy-filtered summary action and private check-in UI. The live guided evidence section showed a selected working-demo photo beneath its matching prompt with the filename and `Added privately to this draft`. No evidence, project, profile or installer request was changed. The recent Sites Worker error-only query returned zero events.

The 29 July 2026 `npm.cmd run audit:links` result is not green: 166 of 169 destinations were reachable or accepted, 16 were separately classified as automation-blocked, and 3 provider or network probes failed or timed out. Those failures do not change the source validation result and remain external evidence gaps.

The product owner stated on 28 July 2026 that the environment contains working-demo data only and no real customer, trade or wholesaler accounts. Existing field-pilot recruitment code remains an inactive future workflow and was not activated or populated by this release. Migration `0079_trade_abn_access_gate.sql` adds only the reviewed-ABN projection, indexes and append-only decision ledger. It is deployed and performs no row deletion, column removal, table drop or provider cleanup. Deployed forward contract migration `0080_retire_legacy_trade_commercial_data.sql` uses that explicit authorisation to remove only retired commercial fields, tables and Stripe/Square integration rows after the reviewed-ABN application became live. Its preservation test retains account identities, jobs, quotes, invoices, accounting, calendar and ABN review records. Sites environment revision 19 contains zero Stripe or Square keys after the 16 observed retired keys were removed. Deployment and worker-log evidence is clean, but independent direct querying of the managed live D1 schema and rows remains unavailable; external provider registrations also remain unknown.

## Active deployed platform

The current verified deployed topology for Sites version 335 is:

- Web and API runtime: OpenAI Sites using a Vinext Cloudflare Worker build.
- Relational data: Sites binding `DB`, implemented with Cloudflare D1.
- Private evidence objects: Sites binding `EVIDENCE`, implemented with Cloudflare R2.
- Authentication: Firebase Authentication with application roles and tenant controls in D1.
- Source record: GitHub.
- Operational relay: Google Apps Script and Google Workspace.
- Customer and installer activity-email provider: Resend integration and callback handling are deployed. The affected quote reached provider status `email.delivered`; visible Gmail inbox placement remains unverified.
- Active public deployment target: Sites.
- Inactive deployment targets: Netlify and Vercel.

Logical binding access does not prove independent ownership of a Cloudflare account or resource. Ownership, complete export, off-platform backup, point-in-time recovery, transfer and workspace-loss behavior remain unproved.

## Verified deployed capability lineage

The 21 July audit reconciled these capability groups to deployed source:

- Native electricity and gas comparison plus the noindex electricity rollback route.
- Household accounts, project planning and protected opportunity intake.
- Installer and supplier profiles, verification, marketplace and catalogue flows.
- Installer CRM, customers, sites, assets, jobs, scheduling, quotes, invoices, field work, handover and team workflows.
- Owner-scoped integrations, provider-reconciliation foundations and the AEA Field sync contract.
- Restricted administration, operational notifications, pagination, search, query telemetry and saved Jobs and Customers views.

Subsequent verified releases add the free reviewed-ABN application, contract cleanup, customer home advisor, advisor context, administrator notification stability, independent customer-plan sharing, the shared home-detail taxonomy, private evidence scope, bounded plan history, optional self-declared professional review, helpful everyday actions, browser-native PDF attachment downloads that avoid print APIs and account mutations, the shared premium PDF plus email report, the exact-brand technical presentation with truthful completed-plan and evidence-boundary handling, consistent spacing with rounded report surfaces, premium on-page preview, duplicated bottom actions, guided private photo capture, plain-language two-version comparison, privacy-filtered export, private check-ins, guarded restore, tagged-PDF foundations, adaptive email compatibility, compact saved-project controls, recoverable deletion, pre-roadmap home and work context, goal-derived priorities, a non-duplicated quote-preparation stage, explicit completed-stage styling, one-confirmation private installer requests, resumable evidence, a worker-safe embedded-font boundary, trigger-safe request submission, multiple photos per guided prompt, one authoritative installer-submit transaction, a bounded installer enquiry pack, complete request-bound photo sharing, the full installer-safe plan and PDF, durable dispatch jobs, independent operations and business alerts, staged submit progress, a top-level customer Quotes centre, exact owner-scoped quote deep links, customer quote-submitted email, trade Work updates, quote submission idempotency, one immutable one-business claim, Resend callback retry handling, contact-only customer handover, owner-scoped new-lead bell items, compact lead cards, aligned quote sections, reliable next-step scroll focus, a privacy-first public-plan enquiry bridge, precise gas hot-water choices, reported electrical-phase planning clues, plain household exhaust-fan choices, a visible account form, refreshed customer verification state, connected-customer identity presented first in the authorised trade lead, consent beside installer-request submission, aligned shared customer navigation, reciprocal product branding, exact-current protected suburb/postcode/state matching, the authorised compliance foundation and operations portal, evidence-policy governance, the national government-activity workflow, the isolated VEU synthetic pilot, its dense register, the complete owner-scoped job audit workspace, the readable compact operator-usability refinement, the controlled-intake foundations, governed approval, custody, calculator and exact Dataforce parallel-operation foundations, the exact 23-column Dataforce operator register, effective-dated lookup approval, legacy mapping authoring, draft-only calculator authoring, the national calculation-readiness catalogue, deterministic SRES expected-entitlement estimator, national synthetic manual-evidence lab, exact manual-field custody, government-minimum composition, unified synthetic register, complete calculation coverage, blocked regulator interchange preflight, shared-navigation discovery, exact official-source custody with audited independent review, guided installer multi-activity planning, immutable pre-case job intent and planned-date revision, accepted-quote governed case linking, evidence-complete web and offline gates, viewport-safe scheduling, callable customer contacts, dated customer jobs, schedule quote actions, exact company-scoped Dataforce export, bounded on-demand internal audit domains, the D1-compatible customer asset timeline, one authoritative trade Business workspace, controlled private branding, immutable quote-document snapshots, branded email and server-PDF delivery evidence, token-authorised private customer documents, retained soft account closure, complete-shell theme recovery, full-width Jobs, permanent Schedule navigation, quote-PDF preflight and worker-safe generation, truthful provider-acceptance status, aligned lead-relay monitoring, a worker-safe noindex electricity fallback, exact 23-cell installer Jobs rows, customer-document business and payment identity, explicit 5:1 full-width banner framing, quote and invoice live previews, clear invoice discount, GST and total presentation, immutable exact-byte issued PDFs and conflict-safe invoice reconciliation. Those capabilities are deployed in Sites version 283 alongside the earlier owner Database Console. Public enquiry placement and handoff, account privacy explanation, selected home-fact continuity, simplified fan intake, account-control presentation, verification return routing, signed-in Quotes, connected contact disclosure, lead compaction, Work updates, consent presentation, reciprocal navigation, the signed-out compliance boundary, signed-in compliance administration, Dataforce-parity advanced filters, government-source discovery, activity-source governance, controlled installer selectors, evidence-policy transcription, four-eyes notice, Access membership, the 10-installer and 30-technician pilot population, 300 one-row jobs, the exact 23 Dataforce register columns in order, 23 cells per row, 300 row actions embedded within `App Id`, the stable dark full-height register, fixed primary and pilot tab bars, global all-field search, compact right-edge drawer, removal of the fixed activity rail, exact 23-column CSV export and stage-only import, source and lookup independent approvals, evidence and physical-custody foundations, exact-decimal calculator receipts, guarded draft-only calculator authoring, exact Dataforce-bound non-evidentiary comparisons, controlled mapping authoring, Dataforce-style context actions, double-click records, collapsible record rails, job-level compliance counts, deterministic dry-run manifest, synthetic isolation guards, 212 explicit calculation pathways, protected STC estimates, responsive calculator layouts, editable form versions, synthetic manual jobs, installer preview, exact byte and metadata custody contracts, policy-layer composition, source-aware advanced facets, guarded interchange readiness, visible compact navigation discovery, draft-only official-source custody and the production-safe planned-work handoff are verified. A newly written version-242 opportunity and locality-bearing notification were not created during release QA; controlled quote and invoice receipt in Gmail and Outlook, provider callback reconciliation, a production invoice send, an approved Australian address provider and complete independently approved VEU, SRES/STC and NSW governed bundles remain unverified. The controlled catalogue contains 32 program pathways and 212 calculation-readiness activity templates. This release did not directly re-query governed production inventory; regulated evidence and real registry activity remain incomplete as recorded above.

The audit recommends withdrawing the generic Database Console because broad catalogue access and generic mutation bypass domain services. That withdrawal is forward work and is not claimed complete here.

## P0 operating restrictions

- The current source contains no payment initiation or checkout route and excludes payment providers from the active integration and callback models. Legacy webhook endpoints acknowledge without reading the request or mutating state. Re-enablement requires written OpenAI and legal determination for the exact flow or migration to an approved host.
- The application must not collect or process payment-card data.
- No provider is treated as production ready from source configuration alone.
- The generic Database Console should not be expanded. Its withdrawal is the first administration-safety milestone after free-access cleanup.
- The specifically authorised demo-only commercial cleanup uses separate forward migration `0080_retire_legacy_trade_commercial_data.sql` after the expansion and application were live and reconciled. Any other production-data deletion remains prohibited without exact scope and evidence.

## Current unknowns and blockers

- Legal, billing and administrative ownership of every Sites, D1, R2, Firebase and provider component.
- Complete relational and object export, owner-held backup and isolated restore.
- Approved privacy, residency, retention, regulated-service and public-claim boundaries.
- Current Firebase MFA, revocation, recovery and authorised-domain settings.
- Fresh customer verification-email receipt and hosted Firebase action-code completion on the custom-domain return.
- Complete provider account, scope, webhook, quota, reconciliation and recovery evidence.
- Durable application telemetry, approved service objectives, load evidence and disaster-recovery exercises.
- Physical iOS and Android distribution, signing, device and accessibility acceptance.
- Full WCAG 2.2 AA evidence.
- Production Resend inbox receipt for the version-238 quote-submitted delivery and the version-239 business-contact handover wording.
- Controlled Gmail and Outlook delivery, receipt and callback reconciliation for both milestone-45 quote and invoice documents; release QA sent neither.
- A production invoice delivery through the provider boundary.
- Controlled connected-account draft export, tax mapping and exact round-trip reconciliation for Xero, MYOB and QuickBooks Online.
- An approved Australian address provider reused across customer, site and job.
- Independently approved complete manual VEU, SRES/STC and NSW governed bundles.
- Exact review and disposition of the retained prior and current
  `gems-commercial-refrigerators` bytes after the official row count decreased
  from 7,500 to 7,499; GEMS-backed calculators remain
  `OFFICIAL_PRODUCT_REGISTRY_STALE` until resolved.
- Recovery of legacy issued documents whose exact retained PDF bytes cannot be proven; the current contract fails closed and requires a new revision.
- Provider credentials and sender approval for the deployed Resend integration.
- Independent hosted row counts for customer-project activity events and deliveries, quote-submission ledger entries and one-business contact claims.
- Delivered rendering and clipping acceptance in controlled non-customer Gmail and Outlook inboxes.
- Independent tagged-PDF reading-order, link, assistive-technology and PDF/UA conformance evidence.

These remain `UNKNOWN` or `BLOCKED`. Source code and passing local tests cannot close them.

## Validation and release contract

Before this document can claim a new deployment:

1. Focused tests for the changed access, ABN, admin, migration and documentation boundaries pass.
2. `npm run validate` passes on the exact commit.
3. `npm run build` passes on the exact commit.
4. The final diff contains only authorised changes and no secrets, generated credentials or customer data.
5. The exact commit is pushed to the approved source branch.
6. A Sites version is saved from that exact commit.
7. Only the saved version is deployed.
8. Public health, relevant signed-in journeys, authorization denials, responsive behavior and provider-error evidence are checked.
9. This identity table is updated with the exact source, saved version, deployment, environment revision, checks and known deviations.

Steps 1 through 7 prove whether an exact deployment occurred. When those steps pass but a relevant step-8 acceptance check cannot be completed, record the application as deployed with acceptance incomplete and list the exact unverified journey or provider evidence. Do not promote that missing evidence to a passing claim.

## Release policy

- Preserve the compatibility electricity route until its approved stability and parity gate passes.
- Publish only validated commits to GitHub and the approved host.
- Never publish credentials, synthetic account output, secrets or customer data.
- Do not edit applied migration history. Use immutable staged forward migrations: a compatible expansion first and a separately approved, reconciled contract cleanup later.
- Keep the dated audit immutable. Correct current truth here and add new release evidence rather than rewriting the audit snapshot.
