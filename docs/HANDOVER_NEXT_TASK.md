# Next task handover

Status: `AEA-SURGE-GOVERNANCE-QUALITY-BUDGETS-82` is released as public Sites version 392 from exact application source `7627d3ef7a28002b3b1b2cf6aebdbf76257683b7`.

Prepared: 24 August 2026

Milestone ID: `AEA-SURGE-GOVERNANCE-QUALITY-BUDGETS-82`

Working branch: `codex/job-schedule-week-calendar`

Current production application source: `7627d3ef7a28002b3b1b2cf6aebdbf76257683b7`

Performance foundation commit: `bd27d65f98b80b673c5ffc9812b9bc92bd78f9a4`

Current production: Sites version 392 at `https://compare.ausenergyassessments.com`

Current saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_dc5db73a1b708191ad47cfd0847bb8d2`

Current deployment: `appgdep_6a8bee30af108191b5d8db124c788fc0`

Current environment revision: 24

Current migration inventory: 158 migrations through `0159_surge_conversation_quality_dimensions.sql`

## Released milestone: governed sources, conversation quality, continuity and route budgets

This milestone completes the requested five priorities without storing customer conversation content or weakening any current-fact boundary.

- All 32 volatile official sources now require an identified, current review-role approval whose SHA-256 matches the canonical maintained evidence record. A missing, overdue or changed approval fails closed.
- The reviewed conversation corpus now contains 20 approved cases across 10 dimensions, including practical guidance, product specifications, certificate coverage, neutral brand comparison and context clarification. The aggregate release report requires one reviewed result for every corpus case and stores no transcript.
- Deterministic session-selection rehearsal covers persistent same-browser context, newer incomplete duplicate tabs and newer conversation state. It exercises the pure merge boundary used by the Surge client.
- Home, Surge, plan and calculator routes now have separate JavaScript and stylesheet graph budgets measured from the production build.
- The practical-tip and conversation regression set covers low-cost draught measures, reverse-cycle heating, evaporative-cooling vent covers, solar and tariff load shifting, heat-pump clothes dryers, exact-product questions and governed certificate answers.

### Validation and release evidence

- `npm.cmd run validate` completed with exit code 0 against exact application source `7627d3ef7a28002b3b1b2cf6aebdbf76257683b7`.
- All 36 integration tests and the complete repository test suite passed.
- Fresh D1 migration verification passed through `0159_surge_conversation_quality_dimensions.sql`.
- Official-source approval audit passed for 32 of 32 volatile sources.
- Conversation-quality reporting passed 20 of 20 reviewed cases across all 10 required dimensions with no coverage errors.
- Session continuity rehearsal passed.
- Production build, Sites server-bundle audit, customer-plan PDF audit and public performance budgets passed.
- Route graphs were measured at home 291,663 bytes JavaScript and 1,385 bytes CSS, Surge 561,624 and 37,285, plan 508,969 and 27,524, and calculator 458,978 and 43,470.
- Exact application source `7627d3ef7a28002b3b1b2cf6aebdbf76257683b7` was pushed to the working branch, GitHub `main` and Sites managed `main` before packaging.
- The matching local archive is 12,225,380 bytes with SHA-256 `757DE1B28A317C795C5C539BD3EEE183248D196DEE3292471205580D29C65E22`.
- Sites saved version 392 as `appgprj_6a550c378000819185caf094173422bb~appgver_dc5db73a1b708191ad47cfd0847bb8d2`, storing 484 files and 44,595,200 bytes with content hash `sha256:e01fa4d43a5e69bb67344a3549ff50f6282f6b2d45953098f12a6c9508370894`.
- Deployment `appgdep_6a8bee30af108191b5d8db124c788fc0` succeeded at environment revision 24 through provider deployment `info294029--aea-energy-comparison`.
- Live desktop QA passed on home, Surge, plan and calculator. Live 390 by 844 phone QA confirmed the compact scrolling header, collapsed secondary Surge rails, readable home copy and no horizontal overflow. Tested routes reported no browser console errors.

### Boundaries

- The approval hash covers the canonical maintained evidence record. Scheduled retrieval of retained remote bytes and human approval of future upstream changes remains the next governed-source step.
- The continuity rehearsal is deterministic source-level coverage. A real-browser duplicate-tab, close, reopen and storage-failure matrix remains next.
- Route budgets now fail the release when a graph grows beyond its allowance. Further stylesheet and graph splitting remains separate optimisation work.
- Product and certificate responses remain limited to maintained official registries and deterministic calculators. Missing, stale or unsupported facts still fail closed.

## Previous released milestone: grounded product and certificate guidance

This follow-on release grounds supported product, brand, model, rebate and certificate questions in the maintained official registry and governed calculation paths. The resolver is generic across supported public product categories and brands and does not hardcode Reclaim, iStore or another vendor as a special case.

Exact STC quantities require an exact registered model and postcode. VEEC quantities require a governed scenario and current rules. Current certificate market references include the last reported trade date and value only while the official feed remains current, then explain that trading values move like a share price and that registration, compliance, administration and aggregator costs usually reduce the customer discount. The resolver never invents those deductions.

Likely product candidates can be narrowed from a brand and capacity, but model-neutral performance comparisons remain blocked until exact verified specification sheets are available. Surge asks exactly one highest-value question when an exact model, location, existing system or eligibility fact is missing, and it does not invoke the general model for a grounded answer.

### Validation and release evidence

- Focused assistant API, grounded guidance and client route checks passed 41 of 41 tests.
- `npm.cmd run validate` completed with exit code 0 against exact application source `0944c9b91765535b873b30029f545bde8f744831`, including all 36 integration tests, the complete repository suite, migrations through `0158_remove_surge_account_context.sql`, production build, bundle audit and public performance budgets.
- Exact application source `0944c9b91765535b873b30029f545bde8f744831` was pushed to the working branch, GitHub `main` and Sites managed `main` before packaging.
- The matching local archive is 12,224,610 bytes with SHA-256 `ffaeed5a983d077e0e0b2035bf0df9aa11517d27a2354bccb616d7a6400eb20d`.
- Sites saved version 391 as `appgprj_6a550c378000819185caf094173422bb~appgver_3666fa042f0c8191a42942f3229725bc` and deployed it through `appgdep_6a8af0d5ca1081919f3c86b55f68a163` to provider deployment `info294029--aea-energy-comparison`.
- Live desktop and 390 by 844 phone QA passed with zero browser errors. Account-copy controls remain absent.

### Boundaries

- Product coverage is limited to maintained official registries and supported public categories, not every product sold globally.
- Stale market references fail closed and are not presented as current.
- Certificate counts, cash discounts and performance differences are not guessed.
- Live QA did not mutate customer context, submit a lead or send a production chat turn.

## Previous released milestone: practical assessor guidance and account-copy removal

This release removes the unsolicited account-copy card, its API, server helper, component, tests and database table. Surge keeps the private same-browser home context only, without presenting account controls or suggesting that an account is required.

The early guidance rail now prioritises practical, provider-neutral actions supported by the saved home context. The bounded rules cover safe gap sealing, door and window seals, door snakes, suitable removable window films, cellular coverings, insulation top-ups, efficient reverse-cycle heating, electric throws, filter cleaning, solar and tariff load shifting, evaporative outlet checks, humidity control, heat-pump drying and seasonal deciduous shade. Safety-critical ventilation, flues, exhausts and regulated work remain explicit boundaries.

Surge's answer policy now behaves like an energy assessor and educator. It gives the useful part of an answer immediately, then asks exactly one highest-value qualifying question when location, existing equipment, tenure, eligibility, proposed replacement or another material fact is missing. Rebate and certificate answers remain fail-closed against the governed official-source registry and never guess values or eligibility. Conversation copy continues to prohibit em dashes and en dashes.

### Validation and release evidence

- Focused assistant, guidance, widget, migration and release tests pass 110 of 110 checks.
- Regression coverage prevents the removed account component, route and server helper from returning.
- Contextual guidance tests cover moisture removal, low-cost draught actions, window measures, solar load shifting and tariff timing.
- Hot-water rebate tests prove one-question-at-a-time qualification, beginning with the current hot-water system before a proposed replacement.
- `npm.cmd run validate` passed typecheck, warning-free lint, all 36 integration tests, 2,851 repository tests with 11 intentional skips and zero failures, a fresh 157-migration D1 database, customer-plan PDF audit, production build, Sites bundle audit and performance audit.
- The production performance gate reports a 4,758-byte root launcher, 84,713-byte deferred assistant, 732,292-byte stylesheet, 293,048-byte public graph, 920,379-byte customer graph, 956,257-byte trade graph and 1,792,764-byte Creditex graph.
- Exact application source `1b2509768bbca7947e3a01438da4c8814d20fe90` was pushed to the working branch, GitHub `main` and Sites managed `main` before packaging.
- The matching local archive is 12,202,751 bytes with SHA-256 `2777CD1CC0D1565671CD4C0F872CC8707562CC2979E40888B18CF8E655C521A7`.
- Sites saved version 390 as `appgprj_6a550c378000819185caf094173422bb~appgver_9c189c6e240c8191b5e3d98d97606065`, storing 484 files and 44,584,960 bytes with content hash `sha256:441010807c5563b7e3890f2358dc6bdc4bb194d532959ba58cb337ff0f6f63aa`.
- Deployment `appgdep_6a89b86b8c048191bb5d187f9e972407` succeeded with environment revision 24 at the custom domain and provider URL `https://aea-energy-comparison.info294029.chatgpt.site`.
- Fresh desktop live QA confirmed that account controls are absent, the three-column workspace has no horizontal overflow and current release assets load without console errors. An older running tab retained a superseded hashed asset reference, but that failure was not reproduced in a clean current-release tab.

### Boundaries

- Saved home context stays in the same browser. No account-copy control, automatic account association or replacement account mechanism is included.
- Product and brand names in customer-supplied references are treated as examples only. Published guidance remains provider-neutral.
- Current rebates, certificates, tariffs and programme eligibility require current governed official facts. Surge asks for missing context and fails closed when those facts are unavailable or overdue.

## Previous production release: context-aware guidance and five priority controls

This release removes stale moisture guidance as soon as the saved context no longer reports moisture or damp issues. The guidance rail is derived again from the complete allowlisted profile on every profile change, so each tip must be supported by the customer's currently saved answers.

The same bounded release completes the five requested follow-on controls:

- a 25-record official-source review queue with changed and overdue volatile facts remaining fail-closed;
- a reviewed conversation evaluation corpus with explicit correction, topic-switch, privacy, follow-up and source-status release thresholds;
- immediate same-browser profile writes, cross-tab merge recovery and aggregate-only storage-health counters with no profile or conversation content;
- measured public, customer, trade and Creditex JavaScript graph budgets that prevent protected entry chunks from returning to the public launcher;
- explicit signed-in `Save context to my account` and `Delete account copy` controls, with no automatic account association.

### Validation and release evidence

- The focused behaviour and account-context suite passed 43 of 43 tests; the focused release set passed 58 of 58 tests and migration validation passed 33 of 33 across all 156 migrations.
- `npm.cmd run validate` passed typecheck, warning-free lint, all 36 integration tests, 2,839 repository tests with 11 intentional skips and zero failures, a fresh 156-migration D1 database, customer-plan PDF audit, production build, Sites bundle audit and the measured performance gate.
- The production graph audit reports a 4,790-byte root launcher, 83,840-byte deferred assistant, 732,292-byte stylesheet, 293,115-byte public graph, 920,414-byte customer graph, 956,479-byte trade graph and 1,792,764-byte Creditex graph.
- Exact application source `8d887f867269a157d84928fb553eac4951ed517b` was pushed to the working branch, GitHub `main` and Sites managed `main` before packaging.
- The matching release archive is 12,206,992 bytes with 502 entries and SHA-256 `18E1C7ED733455D0B189D98AD56100A642F0A436C7249A1E07E6CB2D8F5B2E1C`.
- Sites saved version 389 as `appgprj_6a550c378000819185caf094173422bb~appgver_dd2b493446408191b9b4b321d682d39b`, storing 488 files and 44,625,920 bytes with content hash `sha256:a8ed0fe75ff54df21cc0ca4e5d1dcc84acbad9e446af7abf3f2ac47595f35184`.
- Deployment `appgdep_6a898f2b620c81918109cac63f954590` succeeded with environment revision 24 at the custom domain and provider URL `https://aea-energy-comparison.info294029.chatgpt.site`.
- Live desktop QA confirmed 45 of 45 saved responses, the complete context rail and moisture-free advice after moisture was removed. The three current tips cover ceiling insulation, the largest draughts and shell-first work. Live phone QA confirmed compact context, suggested-question and home-tip drawers, a visible composer and no horizontal overflow.

### Boundaries

- The optional account copy is created or deleted only by an explicit signed-in action. Browser context is not automatically associated with an account.
- Storage-health and conversation-quality records are daily aggregates and contain no profile, prompt, answer, transcript, contact detail or customer identifier.
- Live QA did not send a chat turn, save an account copy or create a lead. Those mutations remain covered by automated tests rather than production data creation.
- The hosted product remains pre-launch until the product owner explicitly declares it live.

## Released milestone: AEA-SURGE-CONTEXT-CONTINUITY-79

### User outcome

Customers do not lose reviewed home details when they change routes, switch tabs or return later in the same browser. One progress action resumes the next incomplete stage, conversation turns stay together at the bottom above the composer, and desktop uses the otherwise empty right side for useful context guidance and optional help.

### Released scope

- Persist every allowlisted profile mutation immediately and flush the latest refs on page hide or tab visibility changes; hydrate the same canonical session after route, reload and cross-tab storage changes.
- Treat reviewed unknown or `Not sure` as reviewed through serialisation and rehydration so the 45-detail counter cannot fall merely because a customer chose the safe unknown response.
- Add `Continue setup` to the progress summary and move section saves forward until the next incomplete section or final completion.
- Render transcript turns at the conversation end immediately above the composer; keep forms, service help and saved context outside the transcript.
- Add a desktop-only persistent `Home guidance` rail with at most three deterministic saved-context tips and optional human help; use compact collapsed drawers for the same secondary content on phone.
- Preserve natural page scrolling and the mobile swipeable header while keeping desktop context permanently visible.

### Validation and release evidence

- The focused persistence, chronological-layout and responsive-rail regression set passed 33 of 33 tests.
- `npm.cmd run validate` passed typecheck, warning-free lint, all 36 integration tests, the complete repository suite, all 153 migrations, customer-plan PDF audit, Vinext build, Sites bundle audit and public-performance audit.
- The performance gate reports a 4,758-byte root launcher, 76,956-byte deferred assistant and 732,292-byte shared stylesheet.
- Exact source `365101733253f2ff39532343bcef81303e96e1e2` was pushed to GitHub and Sites managed `main` before the matching release package was saved.
- Sites saved version 379 as `appgprj_6a550c378000819185caf094173422bb~appgver_4928e91cf1688191b282c32650d17325`, storing 479 files and 44,544,000 bytes with content hash `sha256:03137190ae5446ae2f176c52f9cfbfee5bb105db5ec4f1fdb58e625c57a2c541`.
- Deployment `appgdep_6a88e70dfe908191b90ea491455ef531` succeeded with environment revision 24 at the custom domain and provider URL `https://aea-energy-comparison.info294029.chatgpt.site`.
- Live 1440 by 900 and 390 by 844 QA confirmed the desktop three-column workspace, collapsed mobile secondary drawers, visible composer and natural page scroll.

### Boundaries and remaining optimisation work

- Persistence is same-browser for 30 days, not an account, verified property record or cross-device identity.
- Live QA did not send a chat turn or create a lead; chronological turn order and state restoration are covered by automated tests.
- Tips use only deterministic allowlisted context and do not infer missing property facts.
- The stylesheet remains approximately 732 KB raw and large-chunk warnings remain within the enforced budgets.
- The hosted product remains pre-launch until the product owner explicitly declares it live.

## Previous released milestone: AEA-SURGE-CONTEXT-QUALITY-77

### User outcome

Customers can work through every home-context section without the form unexpectedly closing. Desktop keeps the complete context visible and non-collapsible; phone keeps it in the compact drawer. Surge also has the first governed-source freshness and privacy-safe conversation-quality foundations for the requested Priority 1 and Priority 2 work.

### Released scope

- Keep desktop context open under React control, disable its summary interaction and retain a CSS safety rule so native disclosure state cannot blank the rail after hydration.
- Keep the same context as a collapsed-by-default native drawer only at phone widths and restore desktop openness when the breakpoint changes.
- Mark the current section reviewed and advance to the next unreviewed section on every save. Complete only after all 45 fields across all 13 sections are reviewed.
- Assign every maintained official source a volatility class and reuse basis, bind programme facts to the governed review date and suppress stale programme names and availability after that boundary.
- Store only daily aggregate conversation-quality counters for controlled outcomes. Do not store prompts, answers, transcripts, contact details or customer identifiers.
- Preserve released edit focus, phone navigation, page-level scrolling, quick-chat/full-page boundaries, typography, corners and same-browser continuity.

### Validation and release evidence

- The focused context-rail and sequential-save regression set passed 33 of 33 tests; governed-knowledge and quality coverage passed 127 of 127; focused migration coverage passed 33 of 33.
- `npm.cmd run validate` passed typecheck, warning-free lint, all 36 integration tests, the complete repository suite, all 153 migrations, the customer-plan PDF audit, Vinext build, Sites bundle audit and public-performance audit.
- The production performance gate reports a 4,758-byte root launcher, 72,815-byte deferred assistant and 732,292-byte shared stylesheet.
- Exact source `62b8f947731f8f9f313d3c6a2b8c4e4972d98c03` was pushed to GitHub and Sites managed `main` before the matching release package was saved.
- Sites saved version 378 as `appgprj_6a550c378000819185caf094173422bb~appgver_37bca6308e5481918c3a2be69a2048c4`, storing 479 files and 44,523,520 bytes with content hash `sha256:51fa36a204e87b17d1d5f507483606e376172c2ade6396d88608dd593289595b`.
- The matching local archive is 12,190,985 bytes with 493 entries and SHA-256 `B358AEB7933FB124DF332F3705859EAF7CADFF62B79272E216BA2818915E0F72`.
- Deployment `appgdep_6a8871da825c8191926a9d71cca8f4df` succeeded with environment revision 24 at the custom domain and provider URL `https://aea-energy-comparison.info294029.chatgpt.site`.
- Live desktop QA confirmed the rail is open and non-interactive. Sequential QA advanced through all 13 steps and reached 45 of 45 reviewed. Live 390 by 844 QA confirmed the same rail is collapsed and tappable on phone, exposes all 13 edits when opened and returns to open when desktop width is restored.

### Boundaries and remaining optimisation work

- No authentication, calculator, trade workflow, lead, customer-data or customer-identity contract changed.
- Persistence remains bounded to the same browser, expires after 30 days and does not provide cross-device identity; signed-in association remains a separate milestone.
- Aggregate telemetry is deliberately content-free. A reviewed evaluation corpus, operating thresholds and a bounded quality view remain Priority 2 rather than being inferred from raw customer conversations.
- The 109-source registry now has explicit freshness metadata, but broader reviewed household guidance and official-change monitoring remain Priority 1.
- The shared stylesheet remains approximately 732 KB raw and the production build reports large-chunk warnings. Both pass the current performance gates, but splitting them safely by public, customer, trade and Creditex surfaces remains separate work.
- No real lead, message, trade record or customer record was created during verification.
- The hosted product remains pre-launch until the product owner explicitly declares it live.

## Previous released milestone: AEA-SURGE-CONTINUITY-TYPOGRAPHY-72

Sites version 372 introduced the shared seven-role typography system, readable Surge actions, chronological conversation flow, same-browser profile continuity and the simplified compact Surge header. Versions 373 and 374 were superseded responsive-layout checkpoints now carried into version 376.

## Previous released milestone: AEA-SURGE-RESPONSIVE-QUICKCHAT-75

Sites version 375 restored the floating in-place quick chat, kept deliberate Surge calls on `/surge`, collapsed the long phone context and starter prompts, and removed nested mobile workspace scrolling.

## Previous released milestone: AEA-PUBLIC-SURGE-UX-OPTIMISATION-71

Sites version 371 introduced the shared 1760-pixel shell, optimised homepage mascot treatment, full-page `/surge` navigation and aligned Step 11 controls from exact source `9c5e7199f3f9c521cf47510dafcf39cbe74d81f6`.

## Previous released milestone: AEA-PUBLIC-PERFORMANCE-RECOVERY-69

### User outcome

Every customer click should feel immediate, the home page must remain visually stable during a long visit, and decorative effects must not consume continuous rendering work or expose stray labels over the hero image.

### Owning workflow and expected files

- Public route shell and customer navigation: `src/app/layout.tsx`, `src/components/ComparatorChrome.tsx` and a lightweight Surge loader.
- Home and planner visual shell: `src/components/CustomerJourneyScene.tsx`, `src/components/PlannerHomeJourney.tsx`, their feature-local styles in `src/app/globals.css` and the shared home asset.
- Regression coverage: focused navigation, hero and lazy-Surge tests.

### In scope

- Remove the home hero's continuous canvas, parallax, scan, blur, orbit, particle and floating-label work while retaining the approved home image and journey summary.
- Remove the same continuous canvas, parallax and decorative overlay work from the planner while retaining its answer-driven static crop, stage summary and progress.
- Replace the oversized home PNG with a materially smaller web-optimised asset.
- Keep the full Surge workspace off ordinary-route startup and load it only when the customer opens Surge or visits `/surge`.
- Use client-side Next navigation for the shared customer header, account, TLink and internal footer links.
- Remove only code and styles made obsolete by these changes.

### Out of scope

- No changes to planner answers, assistant knowledge, APIs, authentication, database migrations, trade workflows, calculations or customer data contracts.
- No repository-wide stylesheet rewrite or speculative dependency churn.
- No change to the public brand direction beyond removing the reported decorative tiles and unstable effects.

### Acceptance criteria

- The home hero contains no continuously animated canvas, pointer parallax, scan sweep, blur tile or floating `Comfort`, `Energy`, `Action`, `Live home model` or `Private by design` label.
- The hero remains readable and correctly cropped at desktop and 390-pixel phone widths with reduced motion respected by construction.
- Ordinary routes do not fetch or evaluate the full Surge workspace chunk until an explicit open action; `/surge` still loads the full workspace.
- Shared internal header and footer destinations use client navigation without changing route identity or accessibility state.
- Focused regression tests, typecheck, lint, production build and the full repository validation gate pass before release.
- Desktop and phone QA cover `/`, representative customer click-through routes and `/surge`, including a sustained home-page stability check.

### Local implementation and validation evidence

- The home and planner now render the approved whole-home illustration as a static Next image. The permanent canvas frame loop, pointer parallax, scan and blur passes, orbit and particle layers, floating room labels and decorative telemetry tiles are removed together with their dead component and CSS paths.
- The whole-home image fell from 1,650,041-byte PNG to 71,206-byte WebP. The Surge mascot fell from 867,694-byte PNG to 71,106-byte WebP. The two visual assets are 2,375,423 bytes smaller in total.
- Ordinary routes now mount a 5,194-byte built Surge launcher instead of the full assistant workspace. The deferred assistant JavaScript fell from the 644,974-byte baseline chunk to 69,687 bytes because the 568,820-byte postcode-backed enquiry adapter is now loaded only when a customer submits the optional enquiry.
- The shared built stylesheet fell from 746,804 bytes to 727,763 bytes after removal of obsolete home, planner and continuously composited header effects. A production-build audit now fails when the launcher, deferred assistant, shared CSS or optimised images exceed their explicit budgets or when the full assistant or locality adapter returns to initial loading.
- The shared header, home start paths and primary planner, electricity, gas, rebate and completed-enquiry handoffs use Next client navigation. Dense navigation and secondary card groups suppress eager prefetch so the homepage does not start downloading every destination.
- `npm.cmd run validate` passes end to end: typecheck, warning-free lint, 36 of 36 integration tests, 2,802 passing repository tests with 11 intentional skips and zero failures, all 152 migrations, the customer-plan PDF audit, Vinext production build, Sites bundle audit and the new public-performance budget audit.
- Local in-app browser QA passes at desktop and 390 by 844 phone sizes across `/`, `/plan`, `/compare`, `/gas-compare`, `/calculator` and `/surge`. The home page remained visible after the reported idle interval with zero canvases, zero decorative overlay nodes and zero infinite animations; phone routes had no horizontal overflow. The ordinary-route Surge workspace stayed absent until the explicit open action, then opened as the accessible `Ask Surge AI` dialog.
- GitHub and the Sites managed `main` branch both received exact release source `bc71dda1fa5e79f4529c4ba408bd481a87a066ba`. Sites stored 44,410,880 bytes across 477 files with content hash `sha256:b479c50096dc9def83591a5d4db0752bb80efaaeb76f907133e4c7a221f1f5a6` and deployed version 370 successfully with hosted environment revision 24.
- Live desktop and 390 by 844 phone QA passed on the custom domain. The homepage remained fully visible after 20 seconds with image and copy opacity at 1, zero canvases, zero obsolete overlay nodes and zero infinite animations. Planner, electricity, gas, calculator and dedicated Surge routes loaded without horizontal overflow, and the ordinary-page Surge dialog appeared only after an explicit open action.

### Stop conditions

- Stop if the fix would change an API, data, identity, billing or migration contract.
- Stop if build output proves Vinext cannot safely lazy-load the existing Surge workspace without altering its customer contract.
- Preserve the existing untracked `.sites-release/` material and do not publish if release provenance cannot be reconciled to the exact validated commit.

## Previous released state to preserve

- Australian Energy Assessments remains the primary public household brand. Its header wordmark is the sole serif exception; controls and customer content remain sans-serif.
- The shared header uses a compact static navy and teal HUD treatment, an active Surge AI tab and the deliberate TLink logo and trade-workspace bridge without permanent compositor animation.
- Desktop exposes all eight customer destinations without clipping. Phone navigation scrolls inside the header without widening the page.
- `/surge` is the dedicated assistant destination. It reuses the one root-mounted widget and never mounts a duplicate assistant.
- Surge AI uses a 3840 by 2160 command-centre background, translucent surfaces and a visible mascot avatar beside each assistant response.
- A fresh public or customer chat reviews the same 38 canonical questions as the Home Energy Planner across 13 staged sections, plus bounded practical routine and constraint details. Fresh material answers are unknown rather than guessed.
- Surge AI and the planner share one question, option, draft, storage and plan-generation contract. `Open my energy plan` hands the exact same versioned session to `/plan`.
- The profile is locally retained, exact-field and exact-option allowlisted and bounded. It excludes contact details, photos, uploads and arbitrary properties.
- Advice and the private plan require no contact details. Australian Energy Assessments follow-up and matched-trade sharing are explicit, separate, mutually exclusive choices with sharing controls off by default.
- Matched-trade sharing reuses the established public-plan customer email, internal relay, opportunity matching, trade notification, contact release and Interested-to-CRM workflow. The private plan and chat are not put in the trade envelope.
- The quote, interval and vehicle upload analyser and its PDF parsing dependency have been removed from customer chat.
- On other customer routes, the floating mascot and tuck preference continue to persist across same-origin routes, reloads and tabs until explicit unhide.
- Completed planner answers may inform a later Surge AI question in the same browser tab. Only maintained fields and option values cross the API boundary.
- Photos, uploaded bytes, contact details and arbitrary planner properties never enter plan context.
- Household planner context is ignored in trade mode at the server and model boundaries.
- Current question and newer chat corrections outrank saved plan context in model and deterministic fallback paths.
- Customer responses remain provider-neutral, answer first, casually educational and limited to one useful follow-up question.
- Public replies do not expose citations, source URLs, internal platform names or model internals.
- The hosted product remains pre-launch until the product owner explicitly declares it live.

## Next executable milestone: SURGE-OFFICIAL-REVIEW-OPERATIONS-82

### Objective

Connect the bounded official-change queue to scheduled official hash checks and reviewer approval without copying commercial authors, inventing rebate values or turning unreviewed web pages into answer authority.

### Acceptance gate

- Every new answer-influencing record has an official canonical URL, publisher, jurisdiction, reviewed summary, observed date, volatility class, reuse basis and next-review date before it can become active.
- Scheduled checks feed the bounded official-change queue with due, stale and changed high-volatility records without automatically promoting newly discovered content.
- Stable educational guidance remains separate from volatile programme, certificate, product-list, price and eligibility facts.
- Volatile records fail closed after their review date.
- Programme answers state the matching jurisdiction and date basis, answer the posed rule before asking for more input and never invent a dollar amount.
- Deterministic certificate calculations have complete official rules, inputs, units, rounding, caps and maintained test vectors.
- Retrieval prefers directly reviewed governing sources and cannot promote generic discovery pages on loose keyword overlap.
- Each released answer family passes two natural paraphrases plus a correction or topic-switch case.
- Safety routing, model-cost controls, privacy, one-follow-up behaviour and public output sanitisation remain intact.
- Full validation, build, package audit and bounded live desktop/mobile QA pass before release.

### Stop conditions

- Stop rather than guess when an official rule, effective date, formula, product list or jurisdiction cannot be verified.
- Do not activate bulk-discovered pages merely to increase a source count.
- Do not copy proprietary commercial content or claim an author, book or website has been ingested without an explicit licence.

## Next five logical product steps

1. Schedule retained-byte retrieval for all 32 volatile official sources and require named human review before a changed hash can become answer authority.
2. Run the reviewed conversation corpus against the deployed assistant in CI and publish a privacy-safe aggregate operator trend with no customer transcript or identity.
3. Add real-browser continuity rehearsals across route changes, duplicate tabs, close and reopen, storage failure and recovery.
4. Split the remaining shared stylesheet and JavaScript graphs by public, customer, trade and Creditex ownership, then reduce the enforced route budgets from measured evidence.
5. Expand independently reviewed official product, certificate and practical-guidance vectors across supported jurisdictions and categories, including context-mutation tests for climate, tenure, tariffs, heating, cooling, glazing, insulation and ventilation.

## Historical release handovers

Status: `TLINK-JOB-SCHEDULE-PLANNING-66` released as current Sites version 335; owner schedule and Google Calendar QA passed; staff team, own-role and accounting-provider draft export QA remain unverified

Prepared: 14 August 2026

Milestone ID: `TLINK-JOB-SCHEDULE-PLANNING-66`

Working branch: `codex/job-schedule-week-calendar`

Milestone source baseline: `bc82429e232d00ef83769016839a895c36d8069e`

Current schedule-duration, calendar-sync and deep-link corrective application commit: `df86aa3ced0ee8d67022626369ebb0412af0b8da`

Historical schedule-duration and calendar-sync corrective application commit: `f92b2e1c90178e8fb56f1b2841b4cbbf7bb7e7cb`

Historical schedule-planning corrective application commit: `d35fdb8d52056fec6b62b6b56a4739a0443cadcf`

Historical atomic schedule-planning application commit: `362be0632b5e1a1d89a312c791c3665924f037d7`

Historical schedule-interaction and acceptance-receipt application commit: `4d3463ec1173be50e3b76ef92fa92e9cb1f81993`

Historical weekly job-schedule application commit: `b29598f7d7f3c3f07a86cf9e36fcccf6b167d47d`

Historical initial weekly job-schedule application commit: `510a3eca360ccdce45411f2fcdcc6237a0804923`

Historical first assignment-containment application commit: `c082239d88a8debd112ee0a304885bb6626b01e8`

Historical quote-acceptance, accepted-invoice and accounting application commit: `9624507b9f4ed274169b67076a40ddb34cd26acb`

Historical versioned quote-delivery application commit: `852aaa4b60cc72b598b375bcd96bc4cc9dd29d3d`

Historical quote-delivery workflow application commit: `37a4faf2e9cbbc6eee5ffdf007366d7944152761`

Historical quote editor and delivery correction application commit: `c12fa0613901aa7cb4c1c2167b0e4720e57b0900`

Historical quote, job and invoice usability application commit: `e757ac2402da0830b68d0e50e95afd61281c03c0`

Historical quote-delivery and jobs-register application commit: `d15ceda44255a706c10a699347b9bd54eba60c5e`

Historical Team full implementation commit: `9bc981227e258dffb036a1ddf9acd6ad9117b72a`

Historical Sites compatibility repair commit: `732f096ca5a8d606cf616ae7ec323ae9d2ce66b7`

Historical Team simplification and Interested workflow correction: `523b517c4027ef72f2b267c95ae8c36fd26af92d`

Current production application source: `df86aa3ced0ee8d67022626369ebb0412af0b8da`

Current production: Sites version 335 at `https://compare.ausenergyassessments.com`

Current saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_bfbac71cff188191af22d0819944fb4d`

Current deployment: `appgdep_6a7eec87402c81918ed74c29a8f03755`

Migration inventory: all 140 migrations through `0139_trade_accepted_invoice_one_per_job.sql`

Historical version 334 application source: `f92b2e1c90178e8fb56f1b2841b4cbbf7bb7e7cb`

Historical version 334 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_df433c53dcc481919d1a7474c8426cd5`

Historical version 334 deployment: `appgdep_6a7ee956504881918dbe3752c62d1080`; succeeded but version 335 replaced it to preserve the exact selected-job deep link while appointment details are open

Historical version 334 package: 424 files, 39,761,920 bytes, content hash `sha256:cde0a7384d705af650c8b61cb60f97d976c04bbfd8915438325740433043200b`; local archive 12,198,859 bytes, 438 entries and SHA-256 `97e0db5955ca340a7e22d195f733adcaf9fe4ab0bf6a2e4decc7689a967dedd9`

Historical version 333 application source: `d35fdb8d52056fec6b62b6b56a4739a0443cadcf`

Historical version 333 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_55bd301f865c8191b6987afa0b940f9c`

Historical version 333 deployment: `appgdep_6a7ed5605fd881918d2f288f2194f66e`; succeeded and remained public until version 334 replaced it

Historical version 332 application source: `362be0632b5e1a1d89a312c791c3665924f037d7`

Historical version 332 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_8c462e5b0ef08191850c4ac79373a180`

Historical version 332 deployment: `appgdep_6a7ed1cbcc0c81919e2204380055f04b`; succeeded but live QA exposed an unsupported compliance intake mounted for an accepted released lead, so version 333 replaced it

Historical version 332 package: 424 files, 39,731,200 bytes, content hash `sha256:2761c5235a0e4a83cd11f77f4bd3a562788e1b712288f2589b9262273bb95fba`, sediment `file_00000000078081faa8bb76de3f85046a`; local archive 12,195,010 bytes, 438 entries and SHA-256 `5FCA9C6CAA92BDF4780378C276A561DDC57ED68021D886B02F5CCC3CC816C5A1`

Historical version 331 application source: `4d3463ec1173be50e3b76ef92fa92e9cb1f81993`

Historical version 331 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_27287ed04e3c8191be9b208dcedeb705`

Historical version 331 deployment: `appgdep_6a7e857ee3588191bd857fe21cd8ec41`; succeeded and remained public until version 332 replaced it

Historical version 330 application source: `b29598f7d7f3c3f07a86cf9e36fcccf6b167d47d`

Historical version 330 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_67cd53f5286c8191b8b89132318a9f7e`

Historical version 330 deployment: `appgdep_6a7e775d85888191b6607c767ff40259`; succeeded and remained public until version 331 replaced it

Historical version 329 application source: `c082239d88a8debd112ee0a304885bb6626b01e8`

Historical version 329 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_e495fff0d8b48191aec0eba61cab3efa`

Historical version 329 deployment: `appgdep_6a7e75f70ef48191a2e9444906ca96a0`; succeeded but live QA proved the later-loaded component module still overrode the one-column assignment rule, so version 330 replaced it

Historical version 328 application source: `510a3eca360ccdce45411f2fcdcc6237a0804923`

Historical version 328 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_911202a646708191afee5671a2cc4864`

Historical version 328 deployment: `appgdep_6a7e7374057481919de9371f323d37d0`; succeeded but signed-in desktop QA found the assignment button clipped outside its panel, so it was immediately superseded

Historical version 327 application source: `9624507b9f4ed274169b67076a40ddb34cd26acb`

Historical version 327 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_02b29fe421e08191aa90224edfd0335a`

Historical version 327 deployment: `appgdep_6a7d96af6830819193ccc0f33ff86abf`; succeeded and remained public until version 328 replaced it

Historical version 326 application source: `852aaa4b60cc72b598b375bcd96bc4cc9dd29d3d`

Historical version 326 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_adb266d1b0a88191bb7df8841d02c1f2`

Historical version 326 deployment: `appgdep_6a7d472339648191843e05066c7d576b`; succeeded and remained public until version 327 replaced it

Historical version 325 application source: `37a4faf2e9cbbc6eee5ffdf007366d7944152761`

Historical version 325 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_4815104beb548191a5f747deee51c8b7`

Historical version 325 deployment: succeeded on provider `info294029--aea-energy-comparison` with environment revision 20; the deployment ID was not retained in the release evidence

Historical version 324 application source: `c12fa0613901aa7cb4c1c2167b0e4720e57b0900`

Historical version 324 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_c3f6022a453c8191a29d5e356267d7bc`

Historical version 324 deployment: `appgdep_6a7d2c7a471c819192d6390b0d59e9fc`; succeeded and remained public until version 325 replaced it

Historical version 323 application source: `e757ac2402da0830b68d0e50e95afd61281c03c0`

Historical version 323 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_2b0ec0ac2ba881918f97c0bc77756ca3`

Historical version 323 deployment: `appgdep_6a7d163a7a608191ab3e260ed58f63a3`; succeeded and remained public until version 324 replaced it

Historical version 322 application source: `d15ceda44255a706c10a699347b9bd54eba60c5e`

Historical version 322 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_a8e54fbf4cac81919d1167626542cc2c`

Historical version 322 deployment: `appgdep_6a7d06e32e9c8191ae98c3b875564465`; succeeded and remained public until version 323 replaced it

Historical version 321 application source: `523b517c4027ef72f2b267c95ae8c36fd26af92d`

Historical version 321 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_e6fdbb289b9081918f4eaeb2167d71bf`

Historical version 321 deployment: `appgdep_6a7c9aa092088191896d869614891e2f`; succeeded and remained public until version 322 replaced it

Historical version 320 application source: `732f096ca5a8d606cf616ae7ec323ae9d2ce66b7`

Historical version 320 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_6f8fcc323a708191b385cbb4384d7f2b`

Historical version 320 deployment: `appgdep_6a7c85c3787c8191b79ee717958643c6`; succeeded and remained public until version 321 replaced it

Failed historical version 319 application source: `9bc981227e258dffb036a1ddf9acd6ad9117b72a`

Failed historical version 319 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_f56d55c000988191a5d215afbe9f64c8`

Failed historical version 319 deployment: `appgdep_6a7c7a96fe2c8191be72871005057712`, failed before activation with `incomplete input: SQLITE_ERROR`, URL null

Historical version 318 application source: `621797579ea1f2249e8679b26056066a4c824668`

Historical version 318 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_b10013e775f481919c719d4f00f2260e`

Historical version 318 deployment: `appgdep_6a7c2aece3248191abf36ae69cdb2095`; remained live until version 320 succeeded

Historical version 317 application source: `e01d7fc8eb80292ddfb019366355293c1103c5fe`

Historical version 317 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_524c3bf7b99c81918281002a6aaf9aca`

Historical version 317 deployment: `appgdep_6a7bf11b64a8819187ab2155e60906ad`

Historical intermediate version 316 source: `1e7a835a2b0f967b725a9a6400ec5872fbf7cbf1`

Historical intermediate version 316 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_005cf69ce1ac8191a068af6e69c22c68`

Historical intermediate version 316 deployment: `appgdep_6a7bef81996c8191951f013dce24d698`

Historical version 315 application source: `ec7cfe49b3d43ae44756cd4ed77924229dd28a3a`

Historical version 315 saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_e55118f62f488191b616250cd819863d`

Historical version 315 deployment: `appgdep_6a7b42f0ec288191b1c79b062233cf81`

Current release package: 424 files, 39,761,920 bytes, Sites archive content hash `sha256:e70ba30cd399229086af36c1565e202a7558b097294e69798f23f69b3af4122b`, sediment `file_000000009fb0820ba1573cc5b72a19f4`; local version-335 archive 12,198,748 bytes, 438 tar entries and SHA-256 `48d2a866ff37c0df7bf13525b5d551a35f0bd8b6abcc0eabcc1da15bc13f7f20`

Production URL: `https://compare.ausenergyassessments.com`

Sites deployment URL: `https://aea-energy-comparison.info294029.chatgpt.site`

Internal compliance URL: `https://compare.ausenergyassessments.com/creditex/compliance`

Sites provider identity: `info294029--aea-energy-comparison`

Environment revision: 20

## Released milestone: TLINK-JOB-SCHEDULE-PLANNING-66

### User outcome

Assignment and the first appointment now save together from the visible week
calendar. Existing appointments can be inspected, moved and resized in the same
workspace, and several staged calendar changes share one guarded Save or Discard
decision. A completed booking is shown once and another form opens only when the
user chooses `Add another`. The calendar shows the exact saved duration, keeps
connected Google events current with useful authorised field details and retains
the selected job deep link until the user deliberately returns to the schedule.

### Owning workflow and expected files

- Job workspace orchestration: `src/components/InstallerCrmWorkspace.tsx`.
- Focused weekly calendar interactions: `src/components/TradeScheduleWorkspace.tsx`,
  `src/components/InstallerCrmJobRegister.module.css` and `src/app/globals.css`.
- Atomic assignment, booking and batch schedule guards:
  `src/app/api/trade-crm/route.ts`, `src/app/api/trade-schedule/route.ts`,
  `src/lib/trade-schedule.ts` and `src/lib/trade-schedule-server.ts`.
- Connected-calendar update verification and rich event projection:
  `src/app/api/trade-calendar-sync/route.ts` and
  `src/lib/trade-calendar-sync-server.ts`.
- Exact selected-job deep-link orchestration:
  `src/components/DirectTradeDashboard.tsx` and
  `src/components/TradeBusinessHub.tsx`.
- Focused regression coverage: trade CRM, team permission, notification,
  compliance-intent, schedule navigation, batch mutation and rich connected-event
  tests.

### Delivered scope

- Create the first appointment and update the job's assignee in one
  revision-protected atomic server action. Project that job revision through the
  detail GET consumed by `Assign and add appointment`.
- Keep the completed appointment authoritative and closed behind `Add another`
  instead of preparing an accidental duplicate.
- Open an appointment detail dialog with the accepted quote, authorised customer
  contact, service address, directions and 15-minute controls. Closing retains
  the exact selected-job deep link; `Back to all jobs` clears it deliberately.
- Move a whole appointment and resize its accessible bottom edge in 15-minute
  increments. Render a 30-minute card at 32 pixels against a 64-pixel hour and
  apply the same geometry to typed and server-loaded durations.
- Stage up to five distinct appointment changes locally and submit them through
  one `Save schedule` action or restore server truth with `Discard changes`.
- Apply accepted-quote, assignment, capability, revision, same-worker conflict,
  unavailability, notification, calendar-sync and compliance-intent guards to
  every changed appointment.
- Force a connected-calendar PATCH for every schedule mutation and verify the
  returned start and end before recording the provider sync as current.
- Include the authorised customer name, phone, email, full service location, job
  reference, appointment type, notes and exact TLink job URL in connected events
  while preserving protected-lead privacy.
- Allow different workers to overlap while rejecting final same-worker overlap,
  including conflicts created within one batch.
- Preserve owner, team and own-schedule privacy projections and protected lead
  redaction.
- Hide direct-customer compliance intake from accepted released leads while
  retaining the API permission denial.

### Out of scope

- New permissions, migrations, calendar providers or route optimisation.
- Customer notification delivery, reminders or arrival updates.
- Final deletion of pre-launch customer, wholesaler, trade or job records.
- Netlify deployment.

### Release evidence

- Exact corrective application source
  `df86aa3ced0ee8d67022626369ebb0412af0b8da` is pushed to GitHub branch
  `codex/job-schedule-week-calendar` and Sites internal `main`.
- Sites saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_bfbac71cff188191af22d0819944fb4d`
  was deployed successfully as version 335 through
  `appgdep_6a7eec87402c81918ed74c29a8f03755`, provider
  `info294029--aea-energy-comparison`, environment revision 20.
- Full `npm.cmd run validate` passed in 74.3 seconds on the exact corrective
  source, including typecheck, warning-free lint, integration and Node tests, all
  140 migrations, database checks, customer-plan PDF audit, production build and
  Sites bundle audit. The release changes no schema and adds no migration.
- Sites stored 424 files and 39,761,920 bytes with content hash
  `sha256:e70ba30cd399229086af36c1565e202a7558b097294e69798f23f69b3af4122b`
  and sediment `file_000000009fb0820ba1573cc5b72a19f4`. The local archive
  contained 438 entries and 12,198,748 bytes with SHA-256
  `48d2a866ff37c0df7bf13525b5d551a35f0bd8b6abcc0eabcc1da15bc13f7f20`.
- Signed-in owner desktop QA measured an exact 32-pixel 30-minute card against a
  64-pixel hour and confirmed the accessible bottom-edge resize control.
- Accepted AEA job `TLJ-X5JVPTHX` was booked exactly once for Saturday 15 August
  2026 from 2:00 pm to 4:00 pm and produced a rich Google Calendar event. The
  exact job deep link remained selected when appointment details closed and
  `Back to all jobs` cleared it.
- At 390 by 844 there was no horizontal overflow and the details dialog remained
  usable. The `Test 123` Google event displayed 4:00 pm to 4:30 pm, matching the
  saved 30-minute appointment.
- Controlled provider PATCH proof changed James William job `TLJ-X5JVPTHX` from
  2:00-4:00 pm to 2:00-3:45 pm through the phone dialog. TLink reported `1
  appointment saved. Connected calendars were updated and verified`, and Google
  reloaded at exactly 2:00-3:45 pm. The job was then restored to 2:00-4:00 pm;
  authoritative TLink reload showed two hours and Google reload showed exactly
  2:00-4:00 pm with no remaining 3:45 occurrence.
- `/api/health` returned HTTP 200 with `Cache-Control: no-store`,
  `Content-Type: application/json` and
  `{ "ok": true, "service": "aea-energy" }`. The Sites errors-only 120-minute
  query returned one information-level cancelled job-detail GET caused by the QA
  browser reload, request `a2af48cb9998e7d1`, and no exception or error. The
  widened 45-minute logs showed both schedule PATCH requests, requests
  `a2af47a15e5fe7d1` and `a2af489e3eb1e7d1`, with outcome `ok`, followed by
  successful CRM and schedule GETs.

### Historical corrective versions

Version 334 from exact source `f92b2e1c90178e8fb56f1b2841b4cbbf7bb7e7cb`
was saved as
`appgprj_6a550c378000819185caf094173422bb~appgver_df433c53dcc481919d1a7474c8426cd5`
and deployed through `appgdep_6a7ee956504881918dbe3752c62d1080`. Sites stored
424 files and 39,761,920 bytes with content hash
`sha256:cde0a7384d705af650c8b61cb60f97d976c04bbfd8915438325740433043200b`;
the local 438-entry, 12,198,859-byte archive had SHA-256
`97e0db5955ca340a7e22d195f733adcaf9fe4ab0bf6a2e4decc7689a967dedd9`.
It delivered the duration, connected-calendar, rich-event and job-revision
corrections, but version 335 replaced it to preserve the exact selected-job deep
link while appointment details are open.

Version 333 from exact source `d35fdb8d52056fec6b62b6b56a4739a0443cadcf`
was saved as
`appgprj_6a550c378000819185caf094173422bb~appgver_55bd301f865c8191b6987afa0b940f9c`
and deployed through `appgdep_6a7ed5605fd881918d2f288f2194f66e`. Sites stored
424 files and 39,731,200 bytes with content hash
`sha256:08a58d94d2e72271e709964b5580c9790f160c2d530f6be45c0c8d464e1b64d5`
and sediment `file_00000000d950820bacd2ce7904ce9afc`; the local 438-entry,
12,190,974-byte archive had SHA-256
`3EFC66E6088161095065EC694D8198A11DB877C4FAB3D6A2D592FF8D7810911E`.

### Remaining evidence boundary

Separate signed-in staff identities with team or own schedule permission were
unavailable, so live staff-role presentation and permission mutations remain
unverified.
Authoritative server permission tests remain green. The hosted environment
remains a test environment until the user explicitly declares it live; the
final wipe is a separate deliberate operation.

## Previous released milestone: TLINK-JOB-SCHEDULE-WEEK-CALENDAR-65

### User outcome

When a trade user schedules a job, the relevant week calendar stays visible in
the same job workspace so they can see other work before choosing a person and
time. Assignment and appointment scheduling live under one `Schedule` tab.

After a direct-owned quote is sent, the completion screen offers both `Done`
and `Schedule and assign job`. Australian Energy Assessments leads can still be
assigned in preparation, but no appointment can be added or moved until the
customer has accepted the exact current quote version.

### Owning workflow and expected files

- Job workspace orchestration: `src/components/InstallerCrmWorkspace.tsx`.
- Focused weekly calendar mode: `src/components/TradeScheduleWorkspace.tsx` and
  `src/app/globals.css`.
- Authoritative calendar data and conflict enforcement:
  `src/app/api/trade-schedule/route.ts`,
  `src/app/api/trade-crm/route.ts` and
  `src/lib/trade-schedule-server.ts`.
- Focused acceptance coverage: existing trade CRM, team-permission and
  scheduling tests plus one focused job-schedule UI contract where useful.

### In scope

- Remove the separate job `Assign` tab and route all job assignment actions to
  the job `Schedule` tab.
- Keep the assignment selector and appointment booking controls together in
  that tab. A new appointment uses the job's saved assignee so job access and
  appointment ownership cannot silently diverge.
- Show one Monday-to-Sunday calendar at a time beside the scheduling workflow,
  with previous week, next week, today and direct week selection.
- Default the focused calendar to the job's saved or draft-selected worker and
  let authorised team viewers switch between one worker and all workers so a
  large roster does not overcrowd the scheduling view.
- Let navigation continue to any valid future week without an artificial
  forward horizon.
- Use the existing permission model and server response so team-schedule access
  sees the team calendar and own-schedule access sees only the signed-in
  member's appointments.
- Preview the proposed person, start and duration against the visible week and
  clearly identify overlaps before submission.
- Apply the same authoritative overlap and unavailability guard when a job
  appointment is created from the job workspace.
- Preserve customer privacy redaction, service-capability assignment checks,
  calendar-mirror behavior and existing schedule authority.
- Keep direct-job quote delivery efficient by opening the same combined
  `Schedule` tab from the terminal send result while retaining `Done` as a
  close-only action.
- Gate every appointment scheduling and rescheduling mutation for a released
  Australian Energy Assessments lead on authoritative customer acceptance of
  the exact current quote version, including a transaction-time race guard.
- Keep ordinary assignment available before that acceptance so the business
  can prepare ownership and access without prematurely booking the customer.

### Out of scope

- Team-role or permission-model changes, new database tables or migrations.
- Replacing the full dispatch calendar, availability editor or external Google
  Calendar and Outlook integration.
- Changing customer appointment requests, field workflow, quotes, invoices or
  compliance case behavior.
- Final pre-launch deletion of customer, wholesaler, trade-account or job data.
  The hosted environment remains a test environment until the user explicitly
  declares it live; the final wipe is a separate deliberate operation.
- Netlify deployment.

### Acceptance criteria

1. A focused job shows one `Schedule` tab and no separate `Assign` tab.
2. The job context action for assignment opens that same `Schedule` tab.
3. The tab shows current assignment, appointment controls and a visible seven-day
   calendar before the user saves an appointment.
4. Owners and staff with team schedule scope see authorised team appointments;
   own-scope staff see only their own appointments and the UI states that scope.
5. The job's selected worker is shown by default. Authorised team viewers can
   choose all workers or one specific worker without changing server scope.
6. Previous, next, today and direct week navigation work one week at a time and
   can reach dates beyond the initial API buffer.
7. A proposed overlap for the same worker is identified and cannot be submitted
   until its visible week is loaded and clear. Different workers may overlap.
   The server rejects same-worker overlap or unavailability even if the client
   preview is bypassed or stale.
8. Protected-customer labels remain redacted and no contact or exact protected
   address is added to the calendar payload.
9. Desktop and narrow-phone layouts keep the booking controls usable and the
   weekly calendar internally scrollable without document-level overflow.
10. Focused scheduling, permission and CRM tests pass, followed by the required
   production build and full validation on the exact final source.
11. A sent direct-owned quote offers `Done` and `Schedule and assign job`; the
    latter closes the send preview and opens the combined `Schedule` tab.
12. A released Australian Energy Assessments lead offers only `Done` after
    sending and explains that scheduling waits for customer acceptance.
13. Historical acceptance of an older quote version does not unlock scheduling
    for a newer current draft, while direct-owned jobs remain schedulable.

### Smallest validation set

- Focused Node tests for trade scheduling, team permission UI and the job
  register/schedule workspace.
- Type checking, lint and `git diff --check` during implementation.
- `npm run build`, followed by `npm run validate` on the final source.
- Signed-in read-only desktop and phone interaction checks for week navigation,
  permission copy, calendar visibility and layout. Do not create or change a
  production appointment during QA.

### Stop condition

Stop and open a separate milestone if completion requires a new permission,
schema migration, external calendar-provider change, final pre-launch data
wipe, or a redesign of the full dispatch workspace beyond the job scheduling
flow.

### Implementation and validation state

- Implemented on 14 August 2026 in isolated worktree
  `C:\Webproject\aea-energy-schedule-week-calendar`, branch
  `codex/job-schedule-week-calendar`, from baseline
  `44e6f14ea5e99a1a027dd12dbcb5b7f679cd7d64`.
- Exact application source `4d3463ec1173be50e3b76ef92fa92e9cb1f81993`
  is committed and pushed to GitHub branch
  `codex/job-schedule-week-calendar` and Sites internal `main`. It is saved as
  Sites version 331 and deployed through
  `appgdep_6a7e857ee3588191bd857fe21cd8ec41`.
- The separate `Assign` tab/action is removed. Assignment, current
  appointments, booking controls and the focused weekly calendar now share one
  `Schedule` tab.
- The focused calendar reuses the authoritative schedule API, labels own versus
  team scope from the returned permissions, previews the proposed booking and
  disables unrelated dispatch controls.
- It opens on the saved or draft-selected worker to avoid crowding, and
  authorised team viewers can switch the dropdown to all workers or one named
  worker. Own-scope staff still receive only their server-authorised calendar.
- Toolbar and boundary time labels align without clipping. Double-click creates
  a one-hour proposal at the open position; its bottom edge resizes in exact
  15-minute increments through a 32-pixel touch target and keyboard controls.
- Booking stays disabled until the selected week is loaded, visible and clear.
  Conflict/loading changes are announced through a live status linked to the
  booking controls, any failed latest calendar load blocks stale submission, a
  failed far-week load has an explicit retry path and a suspended or removed
  saved assignee must be replaced before booking.
- Appointment creation keeps the saved job assignee authoritative and now uses
  the same server overlap and unavailability guard as full dispatch scheduling.
- Same-worker overlap and that worker's unavailability are blocked in both the
  preview and atomic server mutation. Different workers can be booked at the
  same time; focused client and real D1 tests cover that boundary.
- Direct-owned quote completion now preserves `Done` and adds
  `Schedule and assign job`, which closes the preview and opens this same
  combined tab.
- Released Australian Energy Assessments leads remain assignable but all actual
  appointment mutations require the customer's acceptance row for the exact
  current accepted quote version. A stale historical acceptance and a
  concurrent change back to an unaccepted version both fail closed.
- Focus, visibility, same-job navigation and bounded polling refresh acceptance
  eligibility without remounting the workspace or discarding draft schedule and
  assignment choices. Booking and assignment mutations fail closed while that
  refresh is pending.
- The accepted customer view exposes `Save acceptance PDF`. The accepted-only
  token-authorised route returns private secure PDF headers and the retained
  signed acceptance, selected scope, invoice and payment snapshot. Attention or
  unconfigured payment state is redacted and test payment details preserve the
  `DO NOT PAY` warning.
- Confirmed checks on the exact implementation source: typecheck passed,
  warning-free lint passed, integration 36/36 passed, and the complete Node run
  reported 2,235 total, 2,225 passed, 10 intentional skips and 0 failures. The
  final focused set passed 63/63 after the last refinements and the preceding
  broader calendar/PDF audit passed 111/111. `git diff --check`, all 140
  migrations, PDF audit, production build and Sites server-bundle audit passed.
- Signed-in live owner/team-scope QA passed at 1440 by 1000 and 390 by 844.
  Calendar alignment, contained phone scrolling, All/Me filters, one-hour
  double-click proposal and 60-to-45-to-60-minute resize all passed. The accepted
  AEA job no longer showed acceptance-wait copy; its server-saved assignment is
  still `Unassigned`, so it correctly required assignment before booking. No
  assignment or appointment was saved. A separate signed-in own-scope staff
  identity was unavailable, so that live role view remains unverified;
  authoritative route, permission and component coverage passed.
- `Save acceptance PDF` was visible on desktop and phone, and the live receipt
  GET returned HTTP 200 twice. Two invalid OCR transcriptions produced expected
  handled 404 `QUOTE_LINK_NOT_FOUND` probes before the exact accepted link
  returned 200. No quote decision or message was submitted, and no connected
  accounting-provider draft export was executed.
- Sites versions 328 and 329 were successful but deliberately superseded during
  live QA: version 328 exposed the original clipped desktop assignment control,
  and version 329 proved a same-specificity global rule still lost to the
  later-loaded component module. Version 330 from
  `b29598f7d7f3c3f07a86cf9e36fcccf6b167d47d` corrected the layout. Version 331
  was the visually verified refinement release and is historical after version
  332 replaced it.
- `GET /api/health` returned HTTP 200 with `ok: true`. The final one-minute
  error-only Worker query returned zero events; the handled OCR 404 probes were
  not Worker crashes or failed Worker outcomes.

### Historical follow-on outcome

The first two recorded follow-on actions were delivered by versions 332 and 333.
The current priority order is the single next-five sequence near the end of this
handover.

## Previous released milestone: TLINK-QUOTE-ACCEPTANCE-INVOICE-ACCOUNTING-64

Status: exact executable application source
`9624507b9f4ed274169b67076a40ddb34cd26acb` is pushed to GitHub and Sites
internal `main` and released as historical Sites version 327. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_02b29fe421e08191aa90224edfd0335a`
and deployment `appgdep_6a7d96af6830819193ccc0f33ff86abf` reconcile to that
source. Deployment succeeded at the public custom URL
`https://compare.ausenergyassessments.com` and provider URL
`https://aea-energy-comparison.info294029.chatgpt.site` under provider identity
`info294029--aea-energy-comparison` with environment revision 20. Sites stored
424 files and 39,966,720 bytes with content hash
`sha256:288982ce37c09394283008a4591df411ef860c53835705001d5261bbb3030afb`.
The local `aea-energy-sites-v327.tar.gz` archive is 12,164,300 bytes with 438 tar
entries and SHA-256
`95DE14D1809A290898236FF65026F6AD9447EB37A91126D61710CA9FDA31C347`. The package
contains all 140 migrations through
`0139_trade_accepted_invoice_one_per_job.sql`.

### Implemented outcome

Signed certificate and rebate rows can now be accepted without corrupting the
quote total. Acceptance is replay-safe and returns one exact receipt for one
customer decision. The same transaction creates at most one immutable accepted
invoice for the job, freezes complete bank-transfer details when present and
preserves any authoritative manual, quick or accounting finance state.

The job and invoice register show that accepted invoice without duplicate rows.
The Price Book supports reusable certificate items with zero cost and a required
negative sell price, while normal product and labour rows remain non-negative.

The accepted invoice can be exported as a provider draft to Xero, MYOB or
QuickBooks Online. Each adapter preserves signed line-level subtotal, GST and
total arithmetic, uses stable provider idempotency and performs exact
found-record collision checks before any provider write. QuickBooks Online uses
actual Australian sales-tax entity IDs instead of United States pseudo codes.

### Validation and remaining controlled proof

- Independent review passed 101 of 101, the integrated regression set passed
  103 of 103 and the release-document set passed 6 of 6.
- Typecheck, warning-free lint, `db:check` across all 140 migrations, production
  build with Sites bundle audit and `git diff --check` passed.
- Raw unfiltered `npm test` reported 2,202 total: 2,178 passed, 10 skipped, 7
  failed and 7 cancelled. Every failure and cancellation remains confined to
  preserved unrelated `test/trade-field-evidence-finalisation.test.mjs`, whose
  SHA-256 is
  `6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.
- No live Xero, MYOB or QuickBooks export was executed. Connected-provider draft
  creation, Australian tax mapping and exact round-trip reconciliation remain
  unverified until the controlled provider QA milestone.

## Previous released milestone: TLINK-VERSIONED-QUOTE-DELIVERY-63

Status: historical exact executable application source
`852aaa4b60cc72b598b375bcd96bc4cc9dd29d3d` is pushed to GitHub and Sites
internal `main` and released as historical Sites version 326. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_adb266d1b0a88191bb7df8841d02c1f2`
and deployment `appgdep_6a7d472339648191843e05066c7d576b` reconcile to that
source. Deployment succeeded at the public custom URL
`https://compare.ausenergyassessments.com` and provider URL
`https://aea-energy-comparison.info294029.chatgpt.site` under provider identity
`info294029--aea-energy-comparison` with environment revision 20. Sites stored
422 files and 39,833,600 bytes with content hash
`sha256:8ef0f48632dac835b45ab48c1a14d4c70d4d2f191f4def5a43aff50c4aa55b5f`.
The local 12,128,693-byte archive has 436 tar entries and SHA-256
`3164A99777EE66ECF8C6B5F35A2F2364C3A4296FFACEC60B347ED08700E24239`. The package
contains all 138 migrations through
`0137_trade_quote_delivery_renderer_revision.sql`.

### Implemented outcome

Delayed quote delivery now rebuilds an issued email with the same immutable
renderer revision that created its integrity hash. Historical queued rows use
frozen renderer revision 1, newly issued rows use revision 2, and an unknown
revision still fails closed. The subject, recipient, email hash, PDF filename
and PDF hash remain integrity-checked before any provider request.

The quote editor has one final percentage-discount control outside line-item
ordering. It applies after the net included scope, including negative STC, VEEC
or rebate lines and fixed-dollar discounts, while optional and choose-one rows
remain excluded. This prevents a percentage discount from being calculated
against a rebate as though it were positive work. Consent is in the sticky
submit footer, and the lead `Create job and quote` action opens a visible staged
progress modal while customer, job, accepted details and files are prepared.

### Incident and current delivery truth

- Quote `Q-TLJ-X4LMAQXU`, delivery
  `66499ae8-f1a7-406b-befb-4cebca78ed7c`, was durably queued under version 324.
  No scheduled cron invocation was available to drain it.
- Version 325 added exact-delivery request draining plus a bounded health-route
  fallback. Its first drain correctly stopped before Resend because the current
  renderer no longer reproduced the older row's stored content hash. The
  `QUOTE_DELIVERY_CONTENT_CHANGED` guard prevented changed customer content
  from being sent; this was not a provider or Gmail loss.
- Version 326 records `email_renderer_revision`, migrates existing rows to the
  frozen revision 1 contract and issues new rows with revision 2. Automatic and
  manual retries use the stored or inherited revision and verify predecessor
  metadata before provider submission.
- The third automatic attempt used frozen renderer revision 1 and preserved the
  immutable email and PDF hashes. Provider acceptance occurred at
  `2026-08-13T04:49:50.861Z` with message ID
  `bcee0035-743e-4795-acb0-7512b731e740`. The callback ledger then recorded
  `delivery_sent` at `2026-08-13T04:49:56.651Z` and `delivered` at
  `2026-08-13T04:50:00.168Z` with provider status `email.delivered`.
- The exact row is now `delivered`, attempts equal 3, and failure, last-error,
  next-attempt and lease fields are cleared. Provider acceptance, sent callback
  and delivered callback are proven. Visible placement in the recipient's Gmail
  inbox remains unverified and is not claimed.

### Validation and release evidence

- Quote, delivery, PDF, discount and migration-inventory coverage passed in the
  focused release sets. Typecheck, warning-free lint, all 138 migrations,
  production build with Sites bundle audit and `git diff --check` passed.
- The protected unrelated
  `test/trade-field-evidence-finalisation.test.mjs` remains outside this change
  with SHA-256
  `6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.
  Its known failures and cancellations mean raw unfiltered `npm test` is not a
  clean release signal and is not represented as passing.
- Deployment `appgdep_6a7d472339648191843e05066c7d576b` succeeded. Runtime
  evidence proves provider acceptance and the delivered callback for the
  affected quote. Visible Gmail inbox placement was not independently observed.

## Previous released milestone: TLINK-QUOTE-DELIVERY-WORKFLOW-62

Version 325 used exact application source
`37a4faf2e9cbbc6eee5ffdf007366d7944152761` and saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_4815104beb548191a5f747deee51c8b7`.
Its deployment succeeded on provider `info294029--aea-energy-comparison` with
environment revision 20; the deployment ID was not retained. Sites stored 420
files and 39,823,360 bytes with content hash
`sha256:a9df49e58bcd5462037cfc2ec37b8eaaef38612d9aa447d57de2a1fabbd0646f`.
It added exact-delivery request draining, a bounded health-route queue drain,
the final percentage-discount control, sticky-footer consent and the staged
lead-to-job progress modal. Its runtime drain exposed the cross-version renderer
integrity mismatch and stopped safely before the provider.

## Previous released milestone: TLINK-QUOTE-EDITOR-DELIVERY-CORRECTION-61

Status: exact executable application source
`c12fa0613901aa7cb4c1c2167b0e4720e57b0900` is pushed to GitHub and Sites
internal `main` and released as historical Sites version 324. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_c3f6022a453c8191a29d5e356267d7bc`
and deployment `appgdep_6a7d2c7a471c819192d6390b0d59e9fc` reconcile to that
source. Deployment succeeded at the public custom URL
`https://compare.ausenergyassessments.com` and provider URL
`https://aea-energy-comparison.info294029.chatgpt.site` under provider identity
`info294029--aea-energy-comparison` with environment revision 20. Sites stored
420 files from a 39,761,920-byte archive with content hash
`sha256:18b106a2a7edb790229f2a947b3ec47b52864aab53b81fc2e1f46973adb18e7d`.
The package contains all 137 migrations.

### Implemented outcome

The customer editor is one clear record, every quote line can use the price book
or stay custom, all line and discount rows can be reordered, the PDF keeps that
exact order, and quote issue no longer fails before the customer delivery is
durably queued.

### Implemented capability

- Primary name, contact and address fields appear once in the customer editor.
  Secondary contacts, sites, jobs, assets and history stay available through
  bounded progressive disclosure, with visible consistently styled controls.
- Normal and choice rows expose a per-row `Price book item` selector. Selecting
  an item fills its authoritative description, type, unit price and GST;
  selecting `Custom line` clears that item reference and keeps the line editable.
- Percentage and fixed-dollar discounts are independent repeatable rows with
  editable labels. Multiple STC, VEEC, referral and sale adjustments can remain
  separate while the server caps aggregate discount at the positive included
  scope and apportions GST correctly.
- Normal, choice and discount rows expose desktop drag-and-drop and 44-pixel
  `Up` and `Down` controls for touch, keyboard and mobile. Full line objects and
  saved positions move together, and the PDF preserves the authored A/B/A order.
- Consent is above the preview and `Review quote PDF` scrolls to and focuses the
  generated document. Submission keeps queued, sending, accepted, delivered and
  attention states visible with their request reference.
- The production HTTP 500 came from two exact D1 bind-count faults inside the
  atomic issue batch. The issued-event statement had one extra quote-version ID
  binding, and the outbox insert was missing one timestamp binding. Both are
  corrected. Queued success is returned only after the immutable version, event,
  secure link, PDF and non-null durable delivery row commit together.

### Validation and release evidence

- Focused integrated coverage passed 83 of 83, the combined quote and delivery
  set passed 89 of 89, and price-book coverage passed 7 of 7.
- Typecheck, warning-free lint, `db:check`, production build with Sites
  server-bundle audit and `git diff --check` passed.
- Raw unfiltered `npm test` reported 2,134 total: 2,110 passed, 7 failed, 7
  cancelled and 10 skipped. All failures and cancellations are confined to the
  preserved unrelated `test/trade-field-evidence-finalisation.test.mjs`, whose
  SHA-256 remains
  `6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.
- `/api/health` returned HTTP 200 at `2026-08-13T02:32:28.712Z`.
- Signed-in production QA opened job `TLJ-X23Z3GL9`. Overview and customer
  details were visible. Draft version 1 loaded three rows and three
  customer-shared photos. Each row exposed `Custom line`, `Call-out`, `Istore
  Heatpump`, `Kris extra fee` and `Labour`, plus Drag and bounded Up/Down
  controls. Totals remained `$4,700` excluding GST, `$470` GST and `$5,170`
  including GST.
- Preview opened the real delivery dialog with consent at the top. `Review quote
  PDF` was operable and the PDF preserved the same three items and totals.
  Consent was not checked, Confirm and submit was not pressed, and the temporary
  UI state was discarded by returning to edit and reloading. No controlled live
  email was sent or received and no provider callback was reconciled.

## Previous released milestone: TLINK-QUOTE-JOB-INVOICE-USABILITY-60

Status: exact executable application source
`e757ac2402da0830b68d0e50e95afd61281c03c0` is pushed to GitHub and Sites
internal `main` and released as historical Sites version 323. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_2b0ec0ac2ba881918f97c0bc77756ca3`
and deployment `appgdep_6a7d163a7a608191ab3e260ed58f63a3` reconcile to that
source. Deployment succeeded at the public custom URL
`https://compare.ausenergyassessments.com` and provider identity
`info294029--aea-energy-comparison` with environment revision 20. Sites stored
420 files with archive content hash
`sha256:e3d9ba2384f9442bce46646b36db3af857287481333097aa4c10eb8d45bc7522`.
The package contains all 137 migrations.

### Implemented outcome

Incomplete saved quote rows now explain exactly what needs attention and put
focus on that field, jobs expose practical customer and assignment controls in a
compact layout, and correctable draft invoice lines can be reordered without
deleting and re-entering them.

### Implemented capability

- Quote validation identifies the exact row and missing field, highlights it,
  scrolls it into view and focuses it. The saved blank-description failure no
  longer collapses totals to generic `Check items` or makes Preview appear inert.
- Valid lines retain live subtotal, GST, discount, total, cost, sell and margin.
  The same bounded authoritative quote-choice contract runs before preview.
- Jobs Actions exposes permission-gated `Edit customer` for a linked customer
  the trade owns and reuses the existing customer editor and update boundary.
  Platform-private references stay protected.
- Overview shows separate structured job and customer information, including
  name, phone, email, address, status, worker and schedule. TLink and Creditex
  remain separate operating and compliance authorities.
- Assignment is one capability-filtered active-team dropdown with one compact
  Save action. The separate team search and load-more controls are absent.
- Correctable draft invoice lines have desktop drag-and-drop plus 44-pixel
  up/down controls for touch and keyboard. Reordering preserves all line data
  and uses the existing correction revision; issued history stays immutable.

### Validation and release evidence

- The affected quote, jobs, invoice and team set passed 92 of 92. Independent
  final review passed 106 of 106 relevant tests.
- Typecheck, warning-free lint, `db:check`, production build with the Sites
  server-bundle audit and `git diff --check` passed.
- Signed-in production QA reproduced the stored blank quote-description defect
  and confirmed the exact invalid control was focused. A valid `$110` quote
  opened the exact email and PDF preview. It was not saved or sent.
- Signed-in QA inspected the jobs register, customer editor, structured job and
  customer cards, and compact single-dropdown assignment without saving a
  customer or assignment change.
- The invoice list rendered in production. The working-demo data had no
  correctable draft invoice, so live rendering and interaction of the new reorder
  controls remain unverified; their source regression coverage passed.
- `/api/health` returned HTTP 200 at `2026-08-13T00:57:08.421Z`.

## Previous released milestone: TLINK-RELIABLE-QUOTES-JOBS-59

Status: exact executable application source
`d15ceda44255a706c10a699347b9bd54eba60c5e` is pushed to GitHub and Sites
internal `main` and released as historical Sites version 322. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_a8e54fbf4cac81919d1167626542cc2c`
and deployment `appgdep_6a7d06e32e9c8191ae98c3b875564465` reconcile to that
source. Deployment succeeded at the public custom URL
`https://compare.ausenergyassessments.com` and provider URL
`https://aea-energy-comparison.info294029.chatgpt.site` with environment revision
20. Sites stored 420 files and 39,669,760 bytes with archive storage content hash
`sha256:87b51cd53dcc3def0962c6c3c7f3bfaee4e4acf1a0b9819392dd642880ad5a7b`.

### Implemented outcome

Quotes now calculate discounts and totals live, issue through a durable delivery
ledger instead of a fragile browser request, and surface an operational jobs
register with the separate columns and actions a trade business needs each day.

### Implemented capability

- `+ Percent discount` and `+ Dollar discount` add one overall discount with
  editable customer-facing details. Percentage and fixed values use the same
  authoritative server calculation as saved and issued quotes.
- Quote totals update live for subtotal excluding GST, GST, discount including
  GST and total including GST. Internal cost, sell value and margin update from
  the same line projection. Fixed discounts are capped at the quote total.
- Issue atomically persists the exact immutable quote version, secure link, PDF
  and queued outbox before returning. Replaying a lost response claims the same
  version and cannot duplicate delivery.
- The worker uses compare-and-set leasing, provider idempotency, bounded backoff
  and at most five automatic attempts. The visible states are `Sending`, `Email
  accepted for delivery`, `Delivered` and `Needs attention`. One manual retry
  creates an immutable successor delivery. Complaints and opt-outs stay
  suppressed.
- Jobs is a dense tenant-bound register with separate Job ID, first name, last
  name, phone, email, street address, postcode, suburb, state, assigned worker,
  schedule, status, quote total excluding GST and certificate-bucket columns.
  Filters, sorting, paging, saved columns, right-click, keyboard and visible
  Actions controls are supported.
- Controlled job status precedence is `Cancelled`, `Certified`, `Audited`,
  `Complete`, `Assigned`, `Quoting`. Certificates remain `Pending` with a zero
  count until an authoritative program source exists.
- Migration `0136_trade_quote_delivery_outbox.sql` brings the deployed inventory
  to 137 and owns the durable delivery ledger.

### Validation and release evidence

- Integrated product coverage passed 102 of 102, the broad stale-repair set
  passed 80 of 80 and integration passed 36 of 36.
- Typecheck, warning-free lint, `db:check`, production build, Sites server-bundle
  audit, `git diff --check` and the customer-plan PDF audit passed.
- Raw unfiltered `npm test` reported 2,114 total: 2,090 passed, 7 failed, 7
  cancelled and 10 skipped. Every failure and cancellation is confined to the
  preserved unrelated `test/trade-field-evidence-finalisation.test.mjs`, whose
  SHA-256 remains
  `6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.
- Signed-in production QA opened existing job `TLJ-X23Z3GL9`. Jobs showed 1
  through 13 of 13 rows, the requested separate columns, zero page horizontal
  overflow and `$4,700` excluding GST on the first quoted job.
- Quote lines `$200`, `$3,500` and `$1,000` showed live subtotal `$4,700`
  excluding GST, GST `$470`, total `$5,170`, cost `$3,191` and margin `$1,509`.
  A temporary 10 percent discount changed subtotal to `$4,230`, GST to `$423`,
  discount including GST to `$517` and total to `$4,653`. It was removed without
  saving.
- Release QA did not issue, send or retry a quote. Provider inbox receipt remains
  unverified. `/api/health` returned HTTP 200 at
  `2026-08-12T23:57:03.130Z`.

## Previous released milestone: TLINK-TEAM-ONE-CLICK-QUOTE-58

Status: exact repair and executable application source
`523b517c4027ef72f2b267c95ae8c36fd26af92d` is pushed to GitHub and Sites
internal `main` and released as historical Sites version 321. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_e6fdbb289b9081918f4eaeb2167d71bf`
and deployment `appgdep_6a7c9aa092088191896d869614891e2f` reconcile to that
source. Deployment succeeded at the public custom URL
`https://compare.ausenergyassessments.com` and provider URL
`https://aea-energy-comparison.info294029.chatgpt.site` with environment revision
20.

### Implemented outcome

TLink now has a first-class Team system and one Interested action creates the
accepting company's complete customer, job, quote and job-file context before the
quote editor opens.

### Implemented capability

- Team provides owner-governed access permissions, a dense roster with separate
  first name, last name, phone and email columns, bordered Open actions, saved
  permission presets, paged device inventory and active or inactive lifecycle
  records. Saved presets copy defaults only and never authorize access.
  Deactivation revokes access while preserving historical jobs, files and records.
- Add-member contact fields are aligned. The phone control strips letters in the
  client, and the server rejects non-phone characters before Australian
  normalisation.
- Member records now use generic document or photo upload with a title and
  optional expiry date. The replaced licence and credential form is removed.
  Active documents due within 30 days create permission-scoped drawer warnings
  and durable idempotent owner-email work.
- Each member has an allowlisted schedule colour. A member can change their own
  availability, while an owner or delegated team manager can update staff
  availability without widening job or appointment visibility.
- Permissions cover customer visibility and search, reports, jobs, assignment and
  reassignment, own or team scheduling, quotes, invoices, price book, discounts,
  evidence and permission administration. Only the owner can close the business
  account.
- Interested atomically creates or replays the accepting company's customer,
  primary contact, service site, numbered job and draft quote, then opens the
  quote tool. Every company accepting the same lead receives independent
  tenant-owned IDs, workflow records, media objects and replay state.
- The version 320 production failure occurred before mutation because D1 rejected
  the seven-term compound preflight `SELECT` against its five-term production
  limit. Version 321 uses one non-compound
  `SELECT 1 WHERE EXISTS(...) OR ...` preflight while preserving the atomic
  tenant-owned workflow and idempotent replay.
- All customer-selected quote photos are copied into canonical job Files before
  the Interested action returns success. Accepted customer context, answers and
  copied files survive later source withdrawal, expiry or removal.
- An unknown accepted CRM first name persists as `Redacted` and an unknown last
  name persists separately as `Redacted`. Available parts remain unchanged, and
  the immutable disclosure snapshot keeps every undisclosed name field blank.
  An authorised company user can later replace the CRM placeholders.
- Migrations `0131_trade_team_permissions_and_member_files.sql`,
  `0132_public_lead_accepted_disclosure.sql` and
  `0133_public_lead_job_files.sql` remain deployed. Migrations
  `0134_team_member_documents_and_colours.sql` and
  `0135_team_document_expiry_warnings.sql` bring the deployed inventory to 136.
  Exact complete trigger statements remain installed and verified at runtime
  because the Sites migration parser cannot consume multiline trigger bodies.

### Validation and release evidence

- Product-focused Team coverage passed 67 of 67, bounded schedule coverage passed
  34 of 34, lead and expiry coverage passed 35 of 35, integration passed 36 of
  36 and independent audit coverage passed 68 of 68.
- Typecheck, warning-free lint, `db:check` across all 136 migrations, production
  build, Sites server-bundle audit, `git diff --check` and the customer-plan PDF
  audit passed.
- Raw unfiltered `npm test` reported 2,066 total: 2,042 passed, 7 failed, 7
  cancelled and 10 skipped. Every failure and cancellation is confined to the
  preserved unrelated `test/trade-field-evidence-finalisation.test.mjs`, whose
  stale mock and source-location expectations were not edited. It retains SHA-256
  `6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.
- Signed-in production QA reloaded the pictured existing lead. `Create job and
  quote` was present and enabled, and the prior workflow-preparation error was
  absent. The Team workspace showed aligned separate first-name, last-name,
  phone, email, status, colour and action columns, bordered `Open` actions and
  no `More` text. The add-member contact fields were equal-height, equal-width
  aligned pairs, and entering `abc0412def345678` into the telephone field left
  `0412345678`. The document vault exposed only title, optional expiry and one
  PDF/JPEG/PNG file input. The colour palette and self/team availability choices
  were visible; this account had no appointments, so appointment colour rendering
  was not observed live.
- Release QA did not click Interested on the live lead, upload a member document,
  mutate availability, send a quote, send a document-expiry email or send any
  other live email. `/api/health` returned HTTP 200 and the 20-minute Sites Worker
  errors-only query returned zero events after inspection.

### Historical Sites version 320

Version 320 used source `732f096ca5a8d606cf616ae7ec323ae9d2ce66b7`, saved
version
`appgprj_6a550c378000819185caf094173422bb~appgver_6f8fcc323a708191b385cbb4384d7f2b`
and deployment `appgdep_6a7c85c3787c8191b79ee717958643c6`. It succeeded and
remained public until version 321 replaced it.

### Failed historical Sites version 319

Version 319 used source `9bc981227e258dffb036a1ddf9acd6ad9117b72a`, saved
version
`appgprj_6a550c378000819185caf094173422bb~appgver_f56d55c000988191a5d215afbe9f64c8`
and deployment `appgdep_6a7c7a96fe2c8191be72871005057712`. It failed before
activation with `incomplete input: SQLITE_ERROR`, returned a null URL and never
became public. Version 318 remained live until corrected version 320 succeeded.

## Previous released milestone: AEA-DURABLE-PUBLIC-LEAD-QUOTE-57

Exact source `621797579ea1f2249e8679b26056066a4c824668`, saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_b10013e775f481919c719d4f00f2260e`
and deployment `appgdep_6a7c2aece3248191abf36ae69cdb2095` identify historical
Sites version 318. It remained public through the failed version 319 attempt and
was replaced only after version 320 succeeded.

## Previous released milestone: AEA-LEAD-SUBMISSION-SERVICE-CALCULATOR-56

Status: exact application source `e01d7fc8eb80292ddfb019366355293c1103c5fe`
is pushed and was released as historical Sites version 317. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_524c3bf7b99c81918281002a6aaf9aca`
and deployment `appgdep_6a7bf11b64a8819187ab2155e60906ad` reconcile to that
source. Deployment succeeded at `2026-08-12T04:06:57.633776Z` with environment
revision 20.

### Implemented outcome

The public enquiry now keeps the customer in an accessible progress dialog until
lead and photo work reaches a safe decision point, uses one 12-service catalogue
through customer and trade workflows, and presents a current Activity 46 estimate
without exposing commercial source provenance.

### Implemented capability

- Known plan facts use readable label and value cards in two desktop columns and
  one narrow-screen column.
- Submit opens the progress modal before the lead request. Focus is contained,
  backdrop and Escape dismissal are blocked, body scrolling is locked and the
  departure warning remains active while lead creation or photo upload continues.
  Determinate progress covers the lead and every selected photo.
- Photo failure retries only unfinished photos. Skipping remaining photos requires
  confirmation. Completion then focuses the existing four-option customer gateway.
- One canonical catalogue owns 12 services, including `electric-cooking` as
  `Electric cooking and cooktops`, across public validation, any-selected matching,
  mandatory trade email, notification, CRM, job and work-order paths.
- Business owners can change capabilities used for future leads. Existing lead
  snapshots are not rewritten.
- Mandatory trade lead email uses escaped deterministic TLink-branded HTML and a
  plain-text fallback without weakening approval, consent, service-area,
  suppression, retry or idempotency checks.
- Public certificate-price JSON and calculator assets contain no commercial
  supplier name or link. Gross values remain available for every supported
  certificate type only while price data is current.
- Activity 46 uses purchase date. Purchases from 30 June 2026 use the simple
  built-in or freestanding path, A$200 minimum and 1.5 reduction rounded to 2
  VEECs. Purchases from 14 April through 29 June 2026 retain the exact legacy
  product listing. Earlier dates fail closed pending exact rule history.

### Validation and release evidence

- Full implementation commit `1e7a835a2b0f967b725a9a6400ec5872fbf7cbf1`
  became historical intermediate version 316. It was saved as
  `appgprj_6a550c378000819185caf094173422bb~appgver_005cf69ce1ac8191a068af6e69c22c68`
  and deployed through `appgdep_6a7bef81996c8191951f013dce24d698`.
- Historical version 317 changes only the calculator footer from `selected
  installation date` to `selected activity date`. Sites stored 397 files and
  39,034,880 bytes with content hash
  `sha256:17d143da5104ac5231b50aac712b46c280b4f1af8b963d17f7786426e17364dc`
  and all 129 migrations.
- Final `npm.cmd run validate` passed typecheck, warning-free lint, integration,
  1,946 total tests with 1,936 passed, 10 intentional skips and 0 failures,
  `db:check` across all 129 migrations, the customer-plan PDF audit, production
  build and Sites bundle audit. `git diff --check` passed. The final static copy
  correction then passed typecheck, lint, build and the Sites bundle audit.
- Independent review returned GO with no P0 or P1 finding. The focused risk set
  passed 135 of 135.
- Live `/api/health` and `/api/certificate-prices` returned HTTP 200. The public
  response has no `sourceName` or `sourceUrl`. Live visual checks confirmed the
  readable known-fact cards and current Activity 46 purchase-date flow.
- No real lead or trade email was submitted during release QA. The progress modal
  and navigation protections are source and regression verified, not production
  submission verified.

## Previous released milestone: AEA-PRACTICAL-PLAN-TRADE-EMAIL-QUOTE-PREP-55

Status: exact application source `ec7cfe49b3d43ae44756cd4ed77924229dd28a3a`
is pushed and was released as historical Sites version 315. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_e55118f62f488191b616250cd819863d`
and deployment `appgdep_6a7b42f0ec288191b1c79b062233cf81` reconcile to that
source. Deployment succeeded on provider `info294029--aea-energy-comparison` at
`2026-08-11T15:42:54.685549Z` with environment revision 20.

### Implemented outcome

The no-account plan enquiry now prepares a useful desktop-quote pack, every
active approved match owns a durable trade-email delivery, and email and gateway
download use the same practical plain-language customer PDF.

### Implemented capability

- Lead matching is not reported as successful unless every active approved
  match has one unique durable notification delivery. Exact opportunity batches
  drain after lead requests and from health, signed-in trade polling and the
  minute scheduler. Failed provider attempts retry after 5 minutes, 30 minutes,
  2 hours, 4 hours, 8 hours, 16 hours and then daily until accepted, withdrawn
  or no longer eligible.
- Public-plan trade email does not depend on an optional account preference.
  Every send still rechecks current platform approval, consent, selected service,
  service area, active opportunity and match, current email, suppression and
  idempotency.
- Email attachment and post-submit plan download share one canonical generator
  and are byte-identical for the same inputs. The audited fixture is a tagged
  24-page PDF with embedded fonts, semantic lists, 48 checked links and no active
  content.
- Plain-language action tiers cover immediate, better and long-term options for
  draughts, moisture, ventilation, glazing, shading, heating, cooling, hot water,
  cooking, solar, batteries, electric vehicles and assessment preparation.
  Conditional electrification guidance recommends efficient affordable electric
  replacements for gas equipment without promising a product or saving.
- All 11 services expose an optional three-to-four-question preparation pack.
  Only genuinely shared questions are deduplicated, and known private plan facts
  remain suggestions until the customer explicitly opts to reuse them.
- The final enquiry is open by default and avoids re-asking known planner facts.
  Nine selected services require three short optional questions, all 11 require
  at most five, and one service requires one or two. Multi-system heating keeps
  reverse-cycle air conditioning, gas ducted or space heating and evaporative
  cooling together instead of forcing one answer.
- Service-specific mobile and desktop controls accept JPEG and PNG images.
  Answers and photos are optional and photo-only retry cannot resubmit the base
  lead. Wide whole-appliance and work-area photos come before label close-ups;
  safe full-switchboard and inverter views remain supported.
- The public certificate estimate uses simple one-or-two-system quantity controls,
  a zero prior-funded-product estimate assumption with final accredited-provider
  checks, one final whole-certificate rounding point per prescribed activity and
  a current gross AUD value for every supported certificate type. Missing or
  stale price data fails closed and input changes clear stale results.
- Private answers and stripped photo derivatives use D1 and R2, are never sent
  by email or exposed through a public URL, and are available only to exact active
  matches for the relevant service. Withdrawal blocks access immediately and
  bounded tombstone cleanup removes retained objects after failure or withdrawal.
- Additive migration `0128_public_plan_quote_preparation.sql` owns the quote-pack
  answer, file, grant, withdrawal and cleanup state. The Sites bundle contains all
  129 migrations. The mobile enquiry padding correction keeps the form readable
  without horizontal overflow.

### Validation and release evidence

- Historical Sites version 311 was saved from exact milestone source
  `ceac4486531995a11a566d224b6638c0678fb3d4` as
  `appgprj_6a550c378000819185caf094173422bb~appgver_59994c1e46e88191b01a512cbf0e1561`.
  Its 393-file, 38,963,200-byte archive has content hash
  `sha256:8e92e79fcf36f499aa58beab765420a8483a99a0b47412e9a2c222938bd0d832`.
  Its deployment ID was not retained in this handover.
- Historical Sites version 312 from exact hotfix
  `33e9c3e11cf933ea4e752f21781f66f6ec8c2c37` added exact stored version-4,
  version-6 and version-7 consent compatibility and recovered zero-attempt
  terminal consent skips. Saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_922f83ef18c881918992e00a6d98df96`
  deployed through `appgdep_6a7b13c66a6c819184d327dfda5cfcfc`, but production
  D1 rejected the deep final claim with expression depth 100.
- Historical version 313 retains full stored-release validation before claiming
  and uses a shallow exact-pair predicate in the final atomic D1 claim.
- Historical version 314 from `c1a62944078ace043b68bb23a37e924d3e91fefc`
  was saved as
  `appgprj_6a550c378000819185caf094173422bb~appgver_a3a30ab242c0819184e4ec846fa5ef2c`
  and deployed through `appgdep_6a7b30ccbc348191833216f9b4b41c02`. Its plan
  and calculator checks passed, but the signed-in Leads GET still returned HTTP
  500, so it is an intermediate release rather than the current live baseline.
- Version 315 executes the trade-opportunity read as one atomic D1 batch of nine
  bounded statements. Its maximum conservative budget is 54 against the live
  limit of 100, no statement uses more than five joins, and the ordered base set
  is deterministically capped at 100. Exact match, consent, public release,
  withdrawal and downstream contact, quote and arrival guards remain fail-closed.
- Final `npm.cmd run validate` passed typecheck, warning-free full lint, 1,936
  total tests with 1,926 passed, 10 intentional skips and 0 failures, `db:check`
  across all 129 migrations, the 24-page customer-plan PDF audit, production
  build and Sites bundle audit. `git diff --check` passed.
- The canonical email attachment and gateway download are byte-identical for the
  same inputs. The audited PDF has 24 tagged pages, embedded fonts, semantic
  lists, 48 checked links and no active content.
- Live desktop and 355-pixel mobile QA confirmed the optional quote pack,
  service-specific questions and camera or file controls, readable form and zero
  document overflow. The deployed bundle contains the four-way customer
  next-step gateway. No new lead was submitted solely for visual QA.
- Live signed-in version-315 QA reloaded an existing expected match. The refresh,
  load and false-empty errors were absent and 10 matching leads appeared with the
  expected consented detail. The exact GET and safe UI reload succeeded and the
  post-check Worker errors-only
  query was empty. No mutating PATCH smoke was run and no lead status changed.
- `/api/certificate-prices` was current at `2026-08-11T14:00:46.718Z`. The gross
  AUD inputs were STC 39.65, ESC 29.50, VEEC 82.25, PRC 2.80, LGC 8.00, ACCU
  38.75 and SMC 38.40, with explicit copy that registration, audit, compliance,
  processing and other fees reduce the customer rebate.
- Previously skipped delivery `bd53ebf192e525465b9026470b3ca5c5` was recovered
  exactly once and reached `delivered` through Resend provider message
  `a237b559-27c9-4ba1-a4f5-b9d4e582580f`, with `provider_accepted`, `email.sent`
  and `email.delivered` evidence. Current-version-7 control delivery
  `d8a7968ff3ff1e5fbad350ed8692796e` also reached `delivered` through provider
  message `e81bbf1b-5c32-40f6-8395-aa6141187712`.

## Previous released milestone: CREDITEX-VEU-REGISTRY-ROUNDING-LIMITS-54

Status: exact executable application commit
`481cb3970ffd0efe498c9fbf7c9ba5f6a7e945c7` is pushed to the GitHub working
branch and Sites internal `main`, and released as historical Sites version 310.
It was superseded by the version 311 to 315 release chain above.

The historical saved-version identity is
`appgprj_6a550c378000819185caf094173422bb~appgver_328bc0ff50648191abfb6cd0b6aafed8`.
Deployment `appgdep_6a7a78c959908191a2fbd39fc247dfc2` succeeded with environment
revision 20 at `https://compare.ausenergyassessments.com`. Sites stored 392 files
and 38,727,680 bytes with content hash
`sha256:c238b3125d74473df101491648c78308402fcbefc846d8ea72f95006a81864f3`.
The release contains all 128 migrations.

### Released outcome

The VEU product picker is current again, scheduled refresh no longer depends on
an unprovisioned fifth trigger, and water-heater quote estimates now apply the
official per-activity rounding point and Schedule 4 premises-history limits.

### Released capability

- The VEU daily refresh is gated at 07:25 Australia/Sydney inside the provisioned
  minute scheduler. The separate fifth trigger is removed and the 48-hour
  accepted-snapshot freshness boundary still fails closed.
- Current snapshot `ce79c9dc-63e8-4c27-9f4e-ee7961b423ba` contains 75,492 rows,
  was refreshed at `2026-08-11T00:09:32.316Z` and binds source SHA-256
  `1fb51867a4de9b2ee306f1cc943c1444b6351b3b2c19ef3041f48c59cc3278b6`.
- Victorian Energy Efficiency Target Act 2007 section 18(1A) rounds each
  separately eligible prescribed activity independently and rounds an exact half
  up. Two separately eligible activities worth 7.5 VEECs each therefore produce
  16 VEECs, not 15.
- Victorian Energy Efficiency Target Regulations 2018 Authorised Version 020
  Schedule 4 limits prior plus current relevant water-heater products to two at
  residential premises from 10 June 2019 and five at non-residential premises
  from 31 May 2023. A required fail-closed prior-count field and server validation
  enforce the limit for identical and mixed models.
- Water Heating and Space Heating and Cooling Activity Guide version 3.20 keeps
  in-line additional-storage and manifold-connected systems ineligible.
- Certificate actions remain disabled. This release did not create, submit,
  trade or settle a certificate.

### Validation and operational QA

- Final `npm.cmd run validate` passed typecheck, warning-free lint, integration,
  1,897 tests with 1,887 passed, 10 intentional skips and 0 failures,
  `db:check`, the customer-plan PDF audit, production build and Sites bundle
  audit.
- The focused combined regression set passed 80 of 80, the estimate-route set
  passed 21 of 21 and the independent release review passed 104 of 104.
  `git diff --check` passed.
- `/api/health` returned HTTP 200. Activity 3C official-product search returned
  HTTP 200 with `ok: true`, 421 matches and first result AGM Energy `AGMHP270W`.
  Signed-in visual QA confirmed enabled brand and model pickers with no stale
  error. Recent Worker error logs were empty.
- The production SRES water-heater endpoint returned `ok: true` and current
  registry `cer_sres_swh` with 16,758 records. Snapshot
  `950e1b99-3914-47d2-9ff8-39964ebdcb5d` was activated at
  `2026-08-10T23:51:08.395Z` with combined source SHA-256
  `cbe27670e022c9da0dfc9e4af243330e0f1e2170732e9d046dc559793d2e28de`.
  That count matches the expected version 58 total; the live projection did not
  expose a version or publication date.

### Exact remaining source and delivery limits

- GEMS remains fail-closed pending exact reconciliation of the retained
  7,500-row source against the reviewed 7,499-row candidate.
- Scheduled execution is implemented and source-tested; the next natural
  scheduled VEU activation should be retained as operational evidence.

## Previous released milestone: AEA-STRUCTURED-CUSTOMER-ENQUIRY-GATEWAY-53

Status: historical exact executable application commit
`ad972cf2f61aeb59f2021f56b3c908ddb3ace0a0` is pushed to the GitHub working
branch and Sites internal `main`, and released as historical Sites version 308.

The current saved-version identity is
`appgprj_6a550c378000819185caf094173422bb~appgver_d5eaf4c6b458819187a105747dfc6075`.
Deployment `appgdep_6a79e3700444819191ac709f0bd509c6` succeeded with environment
revision 20 under provider identity `info294029--aea-energy-comparison` at
`https://compare.ausenergyassessments.com` and
`https://aea-energy-comparison.info294029.chatgpt.site`. Sites stored 392 files
and 38,696,960 bytes with content hash
`sha256:881c057c42808490cc7d354c6c0e8a349a17fcb774e201d5cd302f9c7ed19e57`.
The local 392-entry package was 11,903,586 bytes with SHA-256
`f9ce016769722f6b47d17107ec2d3d1ab0670a8afea3007a3ec5d0e117a859c8`.

### Released outcome

The public plan now ends in one readable, no-account enquiry that captures a
searchable address, accepts every relevant service, preserves household control
over trade disclosure and opens a clear four-way next-step gateway after a
successful submission.

### Released capability

- First and last name are separate searchable CRM fields. Postcode drives an
  exact suburb and state choice before street address and optional unit number.
- Customers can select any of 11 services or select all. Every active
  platform-approved trade with a matching declared service and service area is
  eligible for the handoff; there is no six-trade cap.
- Australian Energy Assessments retains the full address privately. Email and
  postcode support trade replies, while name, phone and street-address sharing
  remain separate customer choices.
- The public enquiry has no customer-account prompt. Its successful state opens
  a native gateway to electricity comparison, gas comparison, the rebate
  calculator and the printable plan.
- Light-mint plan-result actions with dark text remain readable in normal, hover
  and focus states and become full-width controls on mobile.
- Additive migration `0127_public_trade_lead_customer_address.sql` adds split
  identity and structured address fields while retaining the legacy combined
  name for a safe mixed-version deployment. The package contains all 128
  migrations through `0127`.
- The exact committed Apps Script relay source was saved in the existing project
  and the existing deployment update to version 14 was initiated. Hosted v14
  signed lead delivery remains unverified because hosted secrets are redacted
  and no local test token exists. No real customer lead was submitted.

### Validation and operational QA

- Final `npm.cmd run validate` passed typecheck, warning-free lint, integration,
  1,882 tests with 1,872 passed, 10 intentional skips and 0 failures,
  `db:check`, the customer-plan PDF audit, production build and Sites bundle
  audit.
- `/api/health` returned HTTP 200. Postcode `3000` resolved Melbourne, VIC;
  `0872` exposed valid NT, SA and WA localities; invalid `9999` returned the
  expected HTTP 400. Recent Worker outcomes were clean apart from that deliberate
  400 probe.
- Fresh assets `HomeEnergyPlanner-BCCDCklm.js` and
  `HomeEnergyPlanner-DMhDf6y_.css` expose the structured enquiry and gateway.
  Live DOM QA confirmed first/last name, postcode to suburb/state to street/unit,
  all 11 services, privacy toggles and no account prompt.
- Browser QA confirmed the light-mint calls to action are readable. A temporary
  client-side successful-response mock opened the native gateway without sending
  a real lead, and verified all four exact destinations and the 390-pixel layout.
- The authorised internal lead-webhook probe was not run because its hosted
  secret is redacted and no local token exists. This is unverified, not failed.

### Exact remaining source and delivery limits

- Hosted Apps Script v14 signed lead delivery and a real downstream trade inbox
  receipt were not exercised.
- GEMS remains fail-closed pending authorised exact reconciliation of the retained
  7,500-row source against the reviewed 7,499-row candidate.

## Previous released milestone: AEA-COMPLETE-GUIDED-HOME-ENERGY-JOURNEY-52

Status: complete journey application commit
`c75ff7bb4355f2f74bc9996527900c3d515ab85e` was released as historical Sites
version 306, then exact mobile-header corrective commit
`6df3fab3c9eaca55445cf1c3f16e58b276aae6fd` was pushed to the GitHub branch,
GitHub `main` and Sites internal `main` and released as historical Sites version
307 before version 308 superseded it.

The historical v307 saved-version identity is
`appgprj_6a550c378000819185caf094173422bb~appgver_cd22401f7e1c819197951851476ec4d8`.
Deployment `appgdep_6a79b1799b988191a1ac6ac58888e134` succeeded with environment
revision 20 under provider identity `info294029--aea-energy-comparison` at
`https://compare.ausenergyassessments.com` and
`https://aea-energy-comparison.info294029.chatgpt.site`. Sites stored 391 files
and 37,744,640 bytes with content hash
`sha256:77467b54e8262afe476a5f57460b15da11d5b5b6b286e9d54bbdfeda74c69806`.

Historical v306 saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_60682607e5148191aa5351d3716bd9df`
and deployment `appgdep_6a79aa88b3088191af653a395a2501a1` identify exact
commit `c75ff7bb4355f2f74bc9996527900c3d515ab85e`. Its 391-file, 37,744,640-byte
package had content hash
`sha256:61319a3fa5e852f5f8c9edbe8fe94a1508e612147a5252907d477e9da5084fd8`.
It is explicitly historical and superseded by the v307 mobile-header hotfix.

### Released outcome

Households now move through one complete 38-screen home intake into an ordered,
professional-quality plan, conditional quick wins, a private report, no-account
enquiry or free-account handoff and guided electricity and gas comparisons.

### Released capability

- One plain-English question appears per planner screen. Complete home context is
  preserved through enquiry, account, print and report paths, with safe `Not sure`
  answers and conditional skipping of irrelevant construction questions.
- Results include answer-specific quick wins, an ordered roadmap, printable plan,
  no-account enquiry, separate account choice and clear electricity, gas,
  calculator and rebate actions.
- Guided electricity and gas comparison use three-step journeys, preserve private
  NMI and interval-data boundaries and retain calculation and retailer checks.
- Customer-facing copy spells out Australian Energy Assessments. At 390 pixels,
  the compact header presents Account then the TLink logo without a separator dot
  or horizontal overflow. The trade dashboard remains static.
- Report identity is `2026-08-10-professional-personalised-report-v5`, design
  identity is `2026-08-10-professional-personalised-report-design-v4` and PDF
  identity remains `2026-08-10-personalised-plan-pdf-v7`. The audited 18-page PDF
  is tagged, embeds its fonts and contains 37 checked links.
- July 2026 NatHERS Existing Homes guidance and technical material and Australian
  Government quick-win sources are planning references only, not a NatHERS
  rating, assessment or endorsement.
- Google Apps Script relay version 13 retains deployment ID
  `AKfycbxBjHL_I3aw0FsGkOVaUDic6AwW1W0ItuxadP1NF-0NolTwLahYnc9PsGpPAdv2tMqW`
  and the signed exact-healthy delivery boundary. No real customer lead was
  submitted.

### Validation and operational QA

- Full validation passed with 1,859 tests passed, 10 intentionally skipped and 0
  failed, typecheck, warning-free lint, production build, all 127 migrations,
  customer-plan PDF audit and Sites bundle audit.
- The PDF audit rendered 18 tagged pages with embedded fonts and 37 checked links.
  Report contract v5 and design contract v4 are the current shared email, print
  and PDF presentation contracts.
- The v307 mobile-header correction passed 22 of 22 focused checks, typecheck,
  lint and production build.
- The signed version-13 monitor returned exact `healthy`: `site_runtime` HTTP 200
  in 1,134 ms, `electricity_plans` HTTP 200 in 43,155 ms, `gas_plans` HTTP 200 in
  15,840 ms and signed `lead_delivery` HTTP 200 in 2,588 ms for probe
  `3d36c715-4904-4a1b-bde3-aa3e8253c74b`.
- Live v306 QA exercised desktop and 390-pixel planner progression across all 38
  screens, electricity and gas handoffs, full brand naming and no horizontal
  overflow. Live v307 QA confirmed Account then TLink, no separator dot and no
  horizontal overflow at 390 pixels. `/api/health` returned HTTP 200 and the
  recent Sites Worker errors-only query was empty.

### Exact remaining source and delivery limits

- GEMS remains fail-closed pending authorised exact reconciliation of the retained
  7,500-row source against the reviewed 7,499-row candidate.
- No real customer lead, customer email attachment or downstream trade inbox was
  used during release verification.

## Previous released milestone: AEA-PERSONALISED-PLAN-OPEN-TRADE-LEADS-51

Status: milestone application commit
`a0fcbf200ece76f68bbd83c298f1d556333c615e` and production PDF-font correction
`79f7e2e5be14464410ba40a749453c7473b22d4d` are pushed to the GitHub branch,
GitHub `main` and Sites internal `main`. Exact executable commit
`79f7e2e5be14464410ba40a749453c7473b22d4d` is released as Sites version 305
through deployment `appgdep_6a797f25df8c819187590b70811a6794` with
environment revision 20 at `https://compare.ausenergyassessments.com`.

The saved-version identity is
`appgprj_6a550c378000819185caf094173422bb~appgver_248c3d6df9448191b171e990ac8dfdd1`.
The active Sites project is `appgprj_6a550c378000819185caf094173422bb` and the
deployment URL remains `https://aea-energy-comparison.info294029.chatgpt.site`.
Sites stored 391 files and 37,201,920 bytes with content hash
`sha256:e2869ae853c4e927c32799128bb83133c7a3d1974effd60ed23baacec5ae6976`.
No separate local v305 release-archive identity was supplied.

### Released outcome

Give households one clear property-specific plan and report, then make a
consented no-account enquiry available to every matching platform-approved trade
without adding a second approval system.

### Released capability

- Public customer surfaces share one responsive width contract and use a
  reduced-motion-aware holographic energy field. The professional trade
  workspace remains static.
- Home context records property type, storeys, approximate internal floor area,
  occupants and shared walls. The approval question now covers apartments,
  units, townhouses, villas, duplexes, strata, body corporate, owners corporation
  and shared common property. External-wall insulation remains a separate fact.
- The customer email attaches a personalised report with cover, property
  context, priorities, quick wins and useful AEA and government resources. Its
  exact identities are `2026-08-10-personalised-report-v4`,
  `2026-08-10-personalised-report-design-v3` and
  `2026-08-10-personalised-plan-pdf-v7`.
- A consented no-account enquiry creates one idempotent public opportunity and
  private contact-release record. Platform approval is authoritative. Every
  active platform-approved installer with a declared matching service and state
  and any active matching service area is included. There is no six-trade cap
  and no separate capability-qualification subsystem.
- Contact disclosure, notification and manual assignment recheck the same active
  platform approval, service, state, area and current-consent boundary.
- The lead relay and probe use signed, fresh envelopes and one stable submission
  identity across retries. Repeated delivery is deduplicated before downstream
  effects.
- Australian Energy Assessments retains the submitted name, email, phone and
  postcode for its own record. Every trade handoff includes email, postcode,
  service and the non-empty customer question. Sharing name and phone with
  matching trades is separately optional. The full plan and PDF remain private.
- Forward migration `0126_public_trade_lead_contact_release.sql` adds the contact
  release and unique non-empty opportunity source-reference contracts. The
  migration chain ends at `0126` and contains no per-service approval migration.

### Validation and operational QA

- Full `npm.cmd run validate` passed typecheck, lint, integration, all 1,858 main
  tests with 10 intentional skips and zero failures, `db:check`, the PDF audit,
  the production build and the Sites bundle audit. The focused font, public and
  account group passed 41 of 41.
- Production preflight found 210 opportunities, 210 non-empty source references
  and 0 duplicates before migration `0126`. The refreshed signed-in owner
  Database console then reported 239 application tables and confirmed
  `public_trade_lead_contact_releases` is present.
- Historical Google Apps Script version 12 deployment
  `AKfycbxBjHL_I3aw0FsGkOVaUDic6AwW1W0ItuxadP1NF-0NolTwLahYnc9PsGpPAdv2tMqW`
  served v305. Prior version 10 deployment
  `AKfycbwstZJE6asc39Mtbw1uEN_IE0osNOqcHvRV-Ope-AKfOgooEXMVHr5Hff2gHPXSv308`
  is archived.
- The signed `runOperationalHealthCheck` ran from 18:08:25 to 18:09:18 Sydney
  time with monitor `api-health-1786349306423` healthy: `site_runtime` HTTP 200 in
  1,555 ms, `electricity_plans` HTTP 200 in 35,575 ms, `gas_plans` HTTP 200 in
  13,232 ms and `lead_delivery` HTTP 200 in 2,193 ms for probe
  `7bbd1b86-db74-4b0f-acc9-290ff8ae9469`. Sites Worker request
  `a28d84795b0fba39` returned HTTP 200 with outcome `ok`, 1,198 ms wall time and
  7 ms CPU. A final five-minute errors-only query returned zero events.
- Live v305 result and print QA preserved Townhouse, two storeys, 100-199 m2,
  three/four occupants and two or more shared sides. Quick wins, optional
  name/phone trade sharing and the private full-plan boundary were visible. The
  impossible all-walls-adjoin-other-dwellings option was absent and desktop
  client width equalled scroll width.
- Production PDF requests `a28d5de18fe874e0` and `a28d603abf6674e0`
  returned HTTP 200 `application/pdf` in 467/441 ms wall/CPU and 452/430 ms
  wall/CPU respectively. Local Cloudflare validation returned a valid
  268,767-byte PDF in 203 ms cold and 115 ms cached. The audit found 10 tagged
  pages and two embedded font programs.
- No real customer lead was submitted. The post-v305 mobile viewport override
  did not apply, so no new live mobile emulation is claimed. Earlier 341-pixel QA
  of the same visual source had no overflow; the v305 font correction did not
  change that visual source.

### Exact remaining source and delivery limits

- GEMS remains fail-closed pending authorised read-only R2 access and an exact
  comparison of the held 7,500-to-7,499 row change.
- The release proves signed relay acceptance and customer-plan PDF
  generation/download, not a real customer lead submission, customer email
  attachment or downstream trade inbox presentation.
- Independent review noted one non-blocking P2: administrator allocation after
  consent withdrawal can retain an inaccessible internal match. Current contact
  data stays hidden and no notification is sent.

## Previous released milestone: AEA-IMMERSIVE-PLAN-ACTION-HANDOFF-50

Status: exact executable application commit
`f797ab7ee447bc31d66b5760f6613e46f107e97d` is pushed to the GitHub branch and
Sites internal `main`, and released as Sites version 302 through deployment
`appgdep_6a790aefc05c8191b4a03f72181f7031` with environment revision 19 at
`https://compare.ausenergyassessments.com`.

The saved-version identity is
`appgprj_6a550c378000819185caf094173422bb~appgver_33c4dd63992481919b3d760cee8831fd`
with Sites content hash
`sha256:1e2af6133642887179c6887212801973a49006bf9a4f76a3f98d9eb3daf06300`.
Sites stored 37,048,320 bytes across 388 files under provider identity
`info294029--aea-energy-comparison`. Local archive
`.openai/site-release-f797ab7.tar.gz` is 11,484,967 compressed bytes with
SHA-256 `291686F6352979EBE7C9E342BFB20BF67FBE0D3796BB68A6B3A530391333AFD2`,
402 tar entries and all 126 migrations.

### Released outcome

Carry the public customer through a visible home journey into a useful,
personalised plan and an obvious next action without forcing account creation or
collecting the plan as part of a basic enquiry.

### Released capability

- The generated home image is visible on the public home and planner. A semantic
  four-stage journey adds progressive CSS 3D and pointer depth without WebGL,
  canvas or video and respects reduced-motion preferences.
- Draught intake separates `Open wall vents` from `Open or unused chimney or
  flue`. The duplicate `Heat-pump space heating` option is removed and the exact
  legacy value safely normalises into reverse-cycle air conditioning.
- Results put `Start here` and answer-specific `Quick wins` before the longer
  roadmap. Relevant advice covers filters and controls, layers and electric
  throws, ventilation and moisture, hot-water routines, appliance timing, solar
  load shifting, EV charging, fans and shading.
- A no-account basic enquiry sits beside a separate `Create free account`
  action. It accepts only name, email and/or phone, postcode, one interest, an
  optional message and explicit consent. It does not transmit plan answers, NMI,
  interval data, usage, budget, address or account data.
- Public enquiries remain `hold_for_authority_review` with `autoSend: false`.
  Timing alone no longer discards a valid request, honeypot traffic remains
  filtered and the client cannot label a filtered request as received.
- Shared navigation, result, roadmap and form widths are responsive without
  horizontal overflow. The trade workspace remains static.
- The Google Apps Script relay source recognises the home-upgrade enquiry, but
  its hosted deployment remains unverified.
- No customer-shareable rebate receipt was added.

### Validation and live QA

- Full `npm.cmd run validate` passed before deployment. Independent release
  review found no remaining P0 or P1 issue.
- Desktop live QA measured equal 1,407-pixel client and scroll widths with every
  navigation destination visible. The decoded home image was 1,253 pixels wide;
  the `/plan` image was 1,313 pixels wide; and the plan result showed `Start
  here`, `Quick wins`, the no-account enquiry and the distinct account action.
- Live planner choices showed separate `Open wall vents` and `Open or unused
  chimney or flue` options and no `Heat-pump space heating` option.
- At a 390-pixel mobile override, client and scroll widths were both 375 pixels,
  the form was 297.6 pixels wide and navigation was 325.6 pixels wide. The image
  remained visible at 1,055 pixels intrinsic width. The browser showed no
  warnings or errors. No lead was submitted, and the viewport was reset.

### Exact remaining source and delivery limits

- GEMS remains fail-closed pending authorised read-only R2 access and an exact
  comparison of the held 7,500-to-7,499 row change.
- The Apps Script relay source was updated, but the hosted Apps Script deployment
  was not verified in this release.
- The public enquiry is an authority-review handoff, not automatic installer
  dispatch, certificate creation, submission, trading or settlement authority.

## Previous released milestone: AEA-IMMERSIVE-CUSTOMER-JOURNEY-49

Status: exact executable application commit
`bc4096d61cb493e819555d72113d0c77d45a1653` is pushed to the GitHub branch and
Sites internal `main`, and released as Sites version 301 through deployment
`appgdep_6a7898485dd48191acb31466092b5fe8` with environment revision 19 at
`https://compare.ausenergyassessments.com`.

The saved-version identity is
`appgprj_6a550c378000819185caf094173422bb~appgver_57a5cb197f548191a5ef29ab9c99f59e`
with Sites content hash
`sha256:3bbab6b63c31708d6b9ded69b50da11e31d45ff75557d82823d3b12fc4a02e3b`.
Sites stored 35,328,000 bytes across 385 files under provider identity
`info294029--aea-energy-comparison`. Local archive
`.openai/site-release-bc4096d.tar.gz` is 9,823,592 compressed bytes with
SHA-256 `5ae1990b73dd2fd54bebfc5182b8a1616fc0a51afd925ecd09cfd726eebc01a3`,
399 tar entries, 385 files and all 126 migrations.

### Released outcome

Make the public customer journey directional, immersive, accessible and
responsive without moving trade work away from its professional static
workspace, and allow practical mixed approved water-heater quotes without
weakening strict compliance.

### Released capability

- The public home uses semantic lightweight CSS and HTML spatial presentation,
  with no canvas, WebGL or video. It supports reduced-motion preferences and
  responsive desktop, laptop and mobile layouts.
- The planner is task-first, result pages expose a clear `Start here` action and
  the TLink logo links directly to the trade dashboard.
- The trade route remains static and does not mount the public spatial
  animation.
- Quote mode supports mixed exact approved SRES solar-water-heater and
  air-source-heat-pump rows and VEU 1C, 1D, 3C and 3D rows, up to 10 systems.
- Strict compliance remains fail-closed at one unit. The mixed-system quote
  contract grants no certificate authority and does not relax exact product or
  effective-date validation.
- No customer-shareable rebate receipt was added.

### Validation and live QA

- Full validation passed typecheck, lint, 32 of 32 integration tests, 1,803 main
  tests with 1,793 passed, 10 intentionally skipped and 0 failed, all 126
  migrations, the customer-plan PDF audit, the production build and the Sites
  audit. Independent focused final validation passed 115 of 115.
- Signed-out live QA verified the public home, `/plan`, the result `Start here`
  action and `/calculator`. Native future date `2026-09-03` persisted and the
  live solar-PV result was 39 STCs. The browser console showed no warnings or
  errors.
- Live trade-route QA confirmed a static route with no public animation.
  Signed-in dashboard QA was unavailable because both live browser sessions
  presented the sign-in boundary. No signed-in v301 dashboard QA is claimed.

### Exact remaining source limit

GEMS remains fail-closed. The accepted commercial-refrigerator artifact has
7,500 rows with SHA-256
`dcd5e18d9c58ddf13cde8aa1c00f48c704965b7156db61b1a330eef2752d73df`.
The held candidate has 7,499 unique rows with SHA-256
`db6068208c9bc6fca9033879a166dbce1ad0941e376aea786ac5b155dd013b09`.
The exact missing record is unknown without authorised read-only R2 bytes, so
GEMS-backed pathways remain stale and fail-closed.

## Previous released milestone: AEA-CALCULATOR-USABILITY-AUTHORITY-48

Status: historical. Exact executable application commit
`ca3d84a497258426c7ab34c87e8059df1cba2a27` is released as Sites version 300
through deployment `appgdep_6a7875602838819182dc5ba7dec6366b` with
environment revision 19 at `https://compare.ausenergyassessments.com`.
The saved-version identity is
`appgprj_6a550c378000819185caf094173422bb~appgver_e084d0c2568c81918bdcf23adc78ad5e`
and its Sites content hash is
`sha256:29ca942f7801e5657cff10f4dd2e1e5dde14fc9386f19fb51f6691703c58db73`.
Sites stored 384 files and 33,607,680 bytes. Local archive
`.openai/site-release-ca3d84a.tar.gz` is 8,175,111 bytes with SHA-256
`a2df1764b0850d46f8088ddd8fe6e8c422d6072f9560df08d43fdba81f82a79a`,
398 entries and all 126 migrations.

Initial application commit `c9fb34115209c0ea0a1fc02ee2095250458c256f`
was historical Sites version 298. Version 300 is the historical corrective release
that refreshes TESSA before attempting the shared GEMS refresh.
Historical version 298 is saved as
`appgprj_6a550c378000819185caf094173422bb~appgver_acf528bb50208191b6bcd0948190172c`
with content hash
`sha256:ac6bd787b8bb9fd71e44e7d0c23368a528c26dba3eb328c0708f3989b5471c86`.
Deployment `appgdep_6a786857458c8191ae557d2c2f0f2694` succeeded. Its local archive
`.openai/site-release-c9fb341.tar.gz` is 8,173,001 bytes with SHA-256
`ffb841f9a08e69c9697047a3d4fdfffcf1e1cb5f0539cc49a8ec8b42a5d419fd`.

### Released outcome

Make the public, customer and trade calculator paths fast and obvious while
keeping quote estimates separate from strict compliance and certificate work.

### Released capability

- `/calculator` provides anonymous quote-only estimates through the governed
  calculator contract without registry refresh, compliance or certificate
  authority.
- The customer landing page has one dominant home-plan start, the planner asks
  one question at a time, household language replaces industry shorthand and a
  direct TLink login sits beside Account. Heating options separate hydronic,
  wood, air conditioning and heat pump choices; hot water includes electric
  with a gas booster; electrical supply includes two phase.
- Activity 15 exposes clear weather-sealing scenarios for doors, windows,
  exhaust fans, wall vents, temporary and permanent chimney or flue sealing and
  evaporative-cooler outlets.
- Future installation dates are available inside the official program and
  selected-product effective windows.
- One estimate can include 1 to 10 identical approved heat-pump or
  solar-water-heater units. Mixed-model multi-unit jobs are not yet supported.
- VEU Part 6 supports a repeatable multi-split or variable-refrigerant-flow
  indoor-unit list and packaged-system quote-only estimates. Packaged-system
  compliance and other strict multi-product compliance bundles remain blocked.
- The official TESSA D17 to D20 automatic registry implementation retained 746
  live source rows during source validation, comprising 663 `Active` and 83
  `Cancelled`, with source SHA-256
  `3770ac57885bbd968e35e25c67b4546e9ff6d4325c63cf4c4592a9b5da0178b0`.
  It is activated and current in version 300.
- A trade can enter one exact customer discount and apply it to the next quote
  or invoice. Certificate counts are not automatically converted to a dollar
  amount because market prices and provider fees are not scheme formula inputs.
- No customer-shareable rebate receipt is included. The product owner rejected
  it as unnecessary, so the workflow ends at the quote or invoice discount.

### Exact remaining blockers and limits

- Sites does not contain `CREDITEX_CEC_BATTERY_API_USERNAME`,
  `CREDITEX_CEC_BATTERY_API_PASSWORD` or
  `CREDITEX_CEC_BATTERY_LICENCE_REFERENCE`.
- BESS1 and BESS2 remain pending until those licensed credentials produce and
  activate an accepted snapshot.
- BESS3 and BESS4 remain blocked because the current licensed CEC contract does
  not provide the Rule-required maximum rated AC inverter output.
- Repeated water-heater quantities apply to one identical approved model only.
- Packaged-system calculations are quote-only until the exact compliance bundle
  is governed and validated.
- The post-TESSA GEMS refresh failed closed because official resource
  `gems-commercial-refrigerators` decreased from 7,500 to 7,499 rows. Current
  public GEMS search returns `OFFICIAL_PRODUCT_REGISTRY_STALE`; do not represent
  any GEMS-backed calculator as active or current until the prior and current
  retained source bytes are exactly reviewed and the decrease is accepted or
  rejected through the governed process.

### Confirmed live QA

- Historical version-298 public QA loaded the homepage, `/plan` and
  `/calculator`, showed Account and TLink login links and accepted future date
  17 August 2026, postcode 3000 and
  6.6 kW small-scale solar PV and returned 39 STCs.
- Version-300 signed-in trade QA returned 39 STCs for small-scale solar PV using
  installation date 9 August 2026, postcode 3000 and 6.6 kW.
- Version-300 trade QA verified the VEU 1C repeated identical-unit quantity and
  Activity 15 plain-English weather-sealing scenario flow.
- Version-300 administrator QA ran the NSW refresh in the required TESSA-first
  order. TESSA activated as current; the D17 picker exposed 70 official brands,
  or 71 options including the placeholder, and Aestiva exposed four exact
  models, or five options including the placeholder.
- The subsequent GEMS refresh failed closed on the reviewed decrease described
  above. No quote, invoice, certificate or customer record was written.

## Previous released milestone: CREDITEX-NATIONAL-CALCULATOR-47

Status: the registry foundation, complete VEU formula set and shared calculator
integration are released and active. Exact calculator commit
`d192d46b4e2056114251ec7cb0e3cfca3b5ea5d9` was deployed as Sites version 294
through `appgdep_6a77aa33d1288191965ba076f690dd46`. Exact refresh-optimization
commit `ad63b90a4e99211998aa1947b7ddd61d5ac1f640` is historical Sites version 295.
Exact guided calculator and PDRS licensed-runtime commit
`1d3abe172e4eb2fa006fab639233cda49a6d37d4` was deployed as Sites version 296.
Exact simplified quote-calculator commit
`11f4721b678425a4294e95c631e0d37d3fab0ffd` superseded it as Sites version 297
and is now historical after version 300.

Sites version 297 is saved as
`appgprj_6a550c378000819185caf094173422bb~appgver_f6c71f20596c8191a59a1ee2c23045df`.
Sites stored 378 files and 33,105,920 bytes with content hash
`sha256:03f919b3ec2902590c8079a1d6edf9d725e6163bb515ec6b761be3ed12b099c5`.
The 8,158,365-byte publication archive had SHA-256
`FCB2FA3E954FA758EB069C70B76A712C1FC23FEC0EC432380EBD3B58D8646563`
and was removed locally after Sites accepted the package and recorded custody.
Deployment `appgdep_6a781d231ee08191a7d506389be1676b` succeeded with environment
revision 19 at `https://compare.ausenergyassessments.com`.

Registry baseline release: exact commit
`1d77ab222638d3d43d9a49cac0b486173ce88e18`, Sites version 293. The production
VEU snapshot contains exactly 75,492 Public Visible rows: 64,715 `Approved` and
10,777 `Legacy`.

Outcome: provide one governed calculator workspace across every controlled
Australian program while enabling an estimate only when the formula, effective
date, location lookup and required official-product evidence are all connected.
The controlled national catalogue contains 35 program pathways and 216 activity
templates. Creditex administrators and active verified installers use the same
calculator contract. The trade dashboard `Calculator` remains estimate-only for
quote and invoice preparation and cannot refresh a registry or perform a
certificate action.

The shared quote flow now follows a short activity, plain-English scenario,
date, brand, model, postcode and formula-input sequence. It omits compliance
attestations such as consumer-fact-sheet, disposal and warranty questions from
the quote calculator, keeps registry and calculation evidence under collapsed
details and removes registry refresh from the trade surface. Source trust,
accepted-snapshot freshness and installation-date eligibility remain enforced
at the server boundary. Quote mode is estimate-only; the default compliance
path remains strict.

Future quote dates follow the official rule windows rather than today's date:

- VEU accepts dates from 30 June 2026 onward, subject to the selected product's
  effective window;
- SRES accepts dates through 2030; and
- NSW and local programs use their official effective windows.

Released formula and coverage boundary:

- the VEU catalogue contains 32 definitions;
- 30 aggregate VEU activity codes are formula-ready;
- 27 VEU aggregate codes expose executable estimate paths: 21 fully available
  families plus six enforced partial subsets;
- the 21 fully available codes are `3`, `13`, `15`, `17`, `22`, `24`, `25`,
  `26`, `27`, `30`, `35`, `36`, `37`, `38`, `39`, `40`, `41`, `42`,
  `43`, `44` and `48`;
- codes `14`, `28` and `32` are additionally formula-ready but remain
  source-gated;
- national coverage is 50 `estimate_available` plus 6
  `partial_estimate_available`, for 56 of 216 executable templates and 160
  blocked or non-executable templates;
- the sealed coverage hash is
  `sha256:35e5ff0ff2bacff2504305a30be71c8b38ebe285f33d729bb842c364df124347`;
  and
- certificate actions enabled remain 0.

Exact `partial_estimate_available` messages:

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

Registry and calculation boundary:

- exact official VEU response bytes and custody metadata are retained in
  content-addressed R2 objects;
- D1 stores indexed current and historical projections for fast product search
  and calculation-time validation;
- calculations query D1 and never download or parse the Public Registry;
- a live 64 MB acquisition, exact-byte R2 replay, validation and D1 activation
  completed with all 75,492 rows; and
- every formula-dependent product must match the exact official category,
  source status and installation-date window. Only an `Approved` row inside its
  declared inclusive window or a `Legacy` row inside its exact closed inclusive
  window can count. GEMS-only, fuzzy, current `Legacy` and out-of-window matches
  fail closed.

The production VEU refresh POST succeeded with HTTP 200 under request and Ray
identifier `a2821aca0bc9b95b`, using 70.404 seconds wall time and 3.748 seconds
CPU time. The current 75,492-row projection reports UI snapshot prefix
`78853aad-a77...`; the full snapshot identifier is not claimed. The earlier
pre-optimization HTTP 503 was the expected fail-closed result at the resource
boundary. The optimized refresh later succeeded and subsequent product GET
requests returned HTTP 200.

Explicit remaining VEU boundaries:

- Activity 14 has no live Public Registry rows;
- Activity 28 has no governed product connector or rows;
- Activity 32 has no stable exact VEU-to-GEMS crosslink and must never use fuzzy
  matching;
- Activity 46 has no current `Approved` rows and 674 `Legacy` rows available
  only for exact in-window historical use;
- Activity 45 is closed;
- Activity 47 BESS1 and BESS2 definitions, the licensed CEC POST route and the
  nightly worker path are deployed, but the activities are not live-active
  because the central Sites CEC username, password and licence reference are not
  configured and no accepted licensed snapshot exists;
- the BESS1 picker is visible without any per-trade credential prompt, while
  both BESS1 and BESS2 guided selectors are wired to use an accepted snapshot
  once active; BESS3 and BESS4 still require exact governed inverter-output
  authority and BESS5 still requires the Scheme Administrator's exact recording
  method;
- Activity 27's AEMO load-table alternative is not enabled;
- the Part 34 J6 refurbishment branch fails closed; and
- PBA and other project-based activities remain governed project methods, not
  deemed calculators.

Validation, release and live QA evidence:

- exact simplified quote-calculator source
  `11f4721b678425a4294e95c631e0d37d3fab0ffd` is pushed to GitHub and the Sites
  managed source branch;
- Sites version 297 stores 378 files and 33,105,920 bytes with content hash
  `sha256:03f919b3ec2902590c8079a1d6edf9d725e6163bb515ec6b761be3ed12b099c5`
  and deployment `appgdep_6a781d231ee08191a7d506389be1676b` succeeded with
  environment revision 19;
- signed-in trade SRES QA used future date 17 August 2026, postcode 3000 and
  6.6 kW solar PV and returned 39 STCs;
- signed-in trade VEU QA used Activity 6 scenario (xi), ERS Tech model
  `ERS-AC24KWH-G`, future date 17 August 2026 and 3.5 kW indoor heating and
  cooling capacities and returned 2 VEECs;
- consumer-fact-sheet and disposal questions were absent, registry refresh was
  absent and calculation details were collapsed on the trade surface; and
- the signed-in administrator calculator loaded at release 297.

The sealed coverage result remains 56 of 216 executable templates. Packaged
VEU Part 6 systems and pathways without a lawful supported product connector,
including current TESSA-backed families, remain unavailable. BESS1 and BESS2
remain not live-active until the central licensed CEC snapshot is available.

No certificate was created, issued, submitted, traded or settled during release
or live QA.

## Previous released milestone 45 contract

Outcome: restore one job per row with each value in its Dataforce-aligned
column, then make customer quote and invoice documents use an explicit saved
business identity, full-width positioned banner, clear tax, discount and
payment details, and an accurate owner-visible document preview without
changing an already issued document.

Owning workflow:

- the owner-scoped Jobs register in `InstallerCrmWorkspace`;
- business document identity, banner framing, payment details and previews in
  `TradeBusinessSettingsWorkspace`, `trade-profile` and an additive migration;
- immutable quote snapshots and customer PDF rendering in the trade quote
  server, panel and PDF generator;
- quick invoice calculation, storage, delivery and owner/customer presentation
  in the existing invoice workflow;
- affected layout rules in `src/app/globals.css`.

In scope:

- restore separate Dataforce-aligned Jobs cells, one job per row, horizontal
  scrolling, callable mobile values, company scoping and matching CSV order;
- make the issued-PDF download action visually consistent with adjacent actions;
- save customer-facing business name, phone, email and bank payment details
  separately from the TLink identity used to sign in;
- provide a bounded banner focal-position and scale control whose preview
  matches the full-width PDF crop;
- snapshot saved document identity, banner framing and payment details into new
  quote and invoice versions so historical output remains immutable;
- show subtotal, discount, GST and total explicitly in invoice authoring,
  storage, customer delivery and the Business settings document preview;
- remove the redundant customer-facing `Work`, `Always included` and
  `Your base scope` labels while retaining itemised scope and internal margin
  controls.

Out of scope:

- sending another production quote or invoice during release verification;
- proving Gmail or Outlook inbox receipt;
- SMS or payment initiation;
- Firebase identity deletion, physical erasure or account recovery;
- regulator submission, certificate creation, certificate trade or settlement;
- changing the internal compliance portal, governed calculation authority or
  tenant boundary;
- uploading production branding or changing live customer, business, quote,
  case, certificate or evidence data during release verification.

Acceptance criteria:

- the Jobs register renders one record per row with values in their declared
  columns at desktop and mobile breakpoints;
- customer-document contact values are independently editable, validated and
  tenant-scoped without changing login identity;
- owner preview and generated quote PDF use the same full-width banner crop and
  customer-facing identity;
- invoice totals reconcile exactly as subtotal minus discount plus GST equals
  total, with saved payment details shown only when configured;
- issued quote content remains byte-stable and only a new issue or invoice
  revision can adopt changed branding or payment settings;
- focused tests, migration replay, complete validation, production build, Sites
  bundle audit and rendered-PDF inspection pass.

Stop condition: stop if an issued quote changes after issuance, totals do not
reconcile, internal margin or protected data reaches a customer document,
customer-document settings can cross tenant boundaries, the job export order no
longer matches the register, or verification would send a message or mutate
production business, quote or invoice data.

## Previous milestone 45 release result

Application source `bfd472359dd8ec2457379bc3694dc3c9503ac7dd` was deployed as
historical Sites version 283. It preserves milestone 44 and completed the
customer-document controls and Jobs register contract. Additive migrations
bring the packaged schema total to 124.

The installer Jobs register now renders one company-scoped job per row with 23
separate Dataforce-aligned headings and 23 corresponding cells. The visible
register, column selector, all-field search, horizontal scrolling and CSV export
share the same declared order. Mobile numbers remain callable and no invented
operator columns were added.

Business settings now keeps the customer-facing business name, phone, email,
bank name, account name, BSB, account number and payment reference separate from
the TLink sign-in identity. A bounded 5:1 banner frame makes the full-width PDF
crop explicit. Quote and invoice previews use that same banner, document
identity and theme. Invoice authoring and output show line items, subtotal,
discount, GST, total and configured payment details. The redundant
customer-facing `Work`, `Always included` and `Your base scope` wrappers were
removed.

New quote and invoice revisions snapshot their document identity and financial
presentation. Issued PDF bytes are retained as the authoritative private object
and are verified against the document identity before readback. Provider
acceptance conflicts fail into `reconciliation_required`; they cannot be
resent or displayed as issued until reconciled.

`npm.cmd run validate` passed on exact source `bfd4723`: type checking,
warning-free lint, 31 of 31 integration tests, 1,494 main tests with 1,492
passed, 2 intentionally skipped and 0 failed, all 124 migrations, the
customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
The focused milestone acceptance set passed 62 of 62. `git diff --check`
passed. Experimental Node glob/type-strip and build-plugin timing notices were
non-failing toolchain warnings.

Release provenance:

- Application source: `bfd472359dd8ec2457379bc3694dc3c9503ac7dd`
- Saved version:
  `appgprj_6a550c378000819185caf094173422bb~appgver_435abd4eabd081918c58fd7adbbb49ae`
- Deployment: `appgdep_6a7221a403808191a44c354d51922058`
- Sites version 283, environment revision 19
- Sites stored 364 files and 31,682,560 bytes with content hash
  `sha256:e3da2fb4a4e4b342a0825a145d8ee3dd2124002123d04c28de753e6767b734c7`

Signed-in custom-domain QA opened Jobs, Schedule and Business without saving or
sending. Jobs rendered 8 company-scoped records, 23 visible headings and 23
direct cells in each inspected row. Schedule retained all 12 CRM tabs and showed
the expected two existing appointments. Business presented every settings
section on one page, the explicit 5:1 crop controls and side-by-side quote and
invoice previews. The previews showed the full-width banner, business identity,
item grid, $4,040 subtotal, $200 discount, $384 GST, $4,224 total and payment
area.

Public root, `/api/health` and `/direct-trade/dashboard` probes returned HTTP
200. Sites reports version 283 and deployment
`appgdep_6a7221a403808191a44c354d51922058` as succeeded. The final 30-minute
errors-only production Worker query returned zero events.

Release QA did not upload branding, save a theme or setting, add a recipient,
issue or send a quote, accept or decline a quote, close an account, or create or
change a customer, job, intent, case, evidence, certificate, submission, trade
or settlement record. No customer, business, quote version or commercial value
was changed.

Remaining controlled limitations:

- controlled Gmail and Outlook quote and invoice delivery, receipt and provider
  callback reconciliation are not yet proven for this milestone;
- the invoice provider boundary is source-tested, but release QA did not send a
  production invoice;
- a legacy issued PDF without provable retained bytes fails closed and requires
  a new revision rather than reconstruction;
- an approved Australian production address provider remains unconfigured;
- one independently approved, complete manual VEU, SRES/STC and NSW governed
  bundle has not yet been exercised through the live non-submitting workflow.

## Historical next five logical product steps for Sites version 335

1. Suggest conflict-free slots using working hours, travel time and service duration.
2. Add customer confirmations, reminders and arrival updates.
3. Add route-aware multi-stop planning.
4. Rehearse the bounded pre-launch data reset and enforce the launch gate.
5. Add schedule conversion telemetry and operational alerts.

## Previous released milestone

Status: `TRADE-WORKSPACE-DELIVERY-RECOVERY-44` released and historical

Released application source:
`9c278bb23f3f5eb9c3878c5a4cfc946264f1a29c`, deployed as historical Sites
version 282 through `appgdep_6a71e7f3af3c81918f0f89a3e0354d36`.

Milestone 44 restored the complete themed trade shell, one-page Business
settings, full-width Jobs, permanent Schedule navigation, quote-PDF preflight,
truthful provider acceptance, lead-monitor timing and worker-safe rollback
handling. Its full contract and evidence remain in `ROADMAP.md` and
`docs/RELEASE_TRUTH.md`.

## Earlier released milestone

Status: `TRADE-BUSINESS-IDENTITY-QUOTE-DELIVERY-43` released and historical

Released application source:
`fcfca482b0f86413423af2af8c5ae77054e6186f`, deployed as historical Sites
version 280 through `appgdep_6a71bf0136dc81918e71ba815cddd0ff`.

Milestone 43 established one authoritative Business workspace, controlled
private branding, bounded service areas, immutable quote-document snapshots,
branded email and server-PDF delivery evidence, token-authorised customer
documents and retained soft account closure. Its full contract and release
evidence remain in `ROADMAP.md` and `docs/RELEASE_TRUTH.md`.

## Earlier released milestone

Status: `TRADE-MULTI-ACTIVITY-USABILITY-42` released and historical

Prepared: 4 August 2026

Milestone ID: `TRADE-MULTI-ACTIVITY-USABILITY-42`

Working branch: `codex/sites-custom-domain-migration`

Previous production application source: `c51934456c2248da4cfde9a0b759b70d69df56ee`

Released application source: `13dbf2ddc4eea32c6a929ef15cb258a263ff99ea`

Historical production: Sites version 279 from application commit `13dbf2ddc4eea32c6a929ef15cb258a263ff99ea`

Saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_e113332d3dac8191bff9ed71b5d51487`

Deployment: `appgdep_6a7178bb43c08191b86b568dabd45b94`

Production URL: `https://compare.ausenergyassessments.com`

Creditex URL: `https://compare.ausenergyassessments.com/creditex/compliance`

Sites provider URL: `https://aea-energy-comparison.info294029.chatgpt.site`

Environment revision: 19

## Released milestone contract

Outcome: an installer can create one accurate scheduled certificate-work job
with a complete customer record and one or more compatible program activities,
then carry the same private job, activity, schedule and commercial context into
field work and the assigned compliance review without duplicate entry.

Owning workflow:

- guided customer, multi-activity, appointment and review capture in
  `TradeNewJobForm`;
- durable multi-activity planning intents in `trade-crm`,
  `trade-compliance-intent` and an additive migration;
- installer Jobs and Customers navigation in `InstallerCrmWorkspace`;
- appointment and quote handoff in `TradeScheduleWorkspace`;
- the shared `SiteDatePicker`, installer-visible compliance wording and focused
  regressions for each changed boundary.

In scope:

- keep existing-customer search available while showing the new-customer form
  by default and require a valid phone and email for every newly created
  customer;
- let one job contain multiple controlled program and activity selections,
  reject exact duplicates and retain one immutable planning intent per selected
  activity;
- keep the final review detail rich and show every selected program activity
  without implying that a certificate, rebate or governed case exists;
- keep date and time selection usable inside the viewport on desktop and mobile;
- retain the exact known Dataforce 23-column order while making the customer
  identity visible in the frozen leading job context and phone values directly
  callable;
- sort customers by first name then last name, expose filters for every customer
  directory category and show a date with the latest job;
- make in-product back navigation prominent and preserve the current filtered
  list state;
- expose quote status and direct view, revise and prepare-to-send actions from
  the schedule appointment workspace;
- remove the compliance partner name from installer and customer-facing TLink
  dashboard copy while preserving the internal authorised partner boundary.

Out of scope:

- activating an unverified government rule, evidence policy or calculator;
- calculating or creating a certificate from discovery-only catalogue data;
- sending a regulator submission, trade or settlement;
- adding or guessing Dataforce meanings that are absent from the supplied
  23-column export;
- provisioning an address-provider account or secret;
- changing the internal compliance partner organisation, access model or
  dedicated administrator portal;
- creating production customers, jobs, evidence or compliance cases during
  release verification.

Acceptance criteria:

- the new-customer fields are open by default and cannot submit without a valid
  email, phone and service address;
- a job can save two or more compatible controlled activities atomically and
  every activity remains independently identifiable for later audit;
- the shared date-time picker remains fully visible and keyboard-operable at
  the top and bottom of the viewport;
- the Jobs register still has exactly the supplied 23 headers in order and one
  job per row, while customer identity and callable phone values are usable
  without scrolling to the far-right columns;
- the customer directory defaults to first-name then last-name order, every
  shown category has a corresponding filter, and latest job includes its date;
- schedule appointment details provide safe paths into quote view, revision and
  send preparation without bypassing the quote preview and consent controls;
- installer and customer TLink dashboards contain no visible compliance partner
  name, while the authorised internal portal and tenant checks remain intact;
- type checking, lint, focused tests, migration replay, integration tests, the
  complete suite, production build and Sites bundle audit pass.

Stop condition: stop if multiple activities cannot remain atomic and
independently identifiable, if an existing tenant or actor boundary fails, if
the Dataforce 23-column contract changes, if migration replay diverges, or if
release verification would mutate production data.

## Release result

Released application source `13dbf2ddc4eea32c6a929ef15cb258a263ff99ea`
was deployed as Sites version 279. Primary implementation commit
`103439d03a5c322757cea27e77e8b147b6c85590` keeps new-customer entry open
beside existing-customer search, requires phone and email, and creates every
selected controlled activity in one atomic job transaction. Each activity
retains its exact program, activity, policy and later case identity across web
and mobile field capture. The installer Jobs register preserves the exact known
23-column Dataforce contract while showing identity first, callable contact
details, complete filters and explicit navigation. Customer A-to-Z sorting,
latest-job dates, schedule quote actions, the portalled date-time picker and
detail-rich multi-activity review are included.

The completion boundary now fails closed if any active governed case is missing
submitted evidence, if an evidence item has been superseded, or if photo proof
changes between preflight and the atomic transition. JSON control requests are
stream-bounded by actual bytes, and offline bootstrap companion rows are
restricted to the selected 500-job cohort with an overall fail-closed
cardinality limit.

A changed installation date now immutably supersedes each still-planned
activity intent and inserts its exact next revision in the same guarded
schedule transaction. Concurrent schedule writes roll back completely, while
case-linked intents remain date-locked.

CRM diagnostic `ce0996779818690751016dfd5b3efdd8e7c1586e` and guard correction
`82e0faf64906047a5f42fabf83c605edf320cb63` resolved a separate production
CRM schema-guard failure. Subsequent asset diagnostic
`eeb636665a21d230b7150e03d60f614b7f71b1db` isolated the remaining customer
asset failure to a seven-arm compound timeline query. Final commit
`13dbf2ddc4eea32c6a929ef15cb258a263ff99ea` executes the seven bounded
owner-, customer- and optional-site-scoped reads in one D1 batch, globally sorts
them by the unchanged API contract and returns at most 500 rows without
presenting partial history as complete.

`npm.cmd run validate` passed type checking, warning-free lint, 31 of 31
integration tests, 1,443 main tests with 1,441 passed, 2 intentionally skipped
and 0 failed, all 120 migrations through
`0119_trade_multi_activity_jobs.sql`, the customer-plan PDF audit, Vinext
production build and Sites server-bundle audit. The focused asset timeline suite
passed 9 of 9. Independent final review found no remaining P0, P1 or P2 defect.

Release provenance:

- Application source: `13dbf2ddc4eea32c6a929ef15cb258a263ff99ea`
- Archive `.openai/site-release-13dbf2d.tar.gz`: 7,781,979 bytes, SHA-256
  `D6AC82425EC5EE82B84318978177D49F0E41E54DF755094FEC935F7549FDAA67`,
  374 entries, all 120 migrations and zero CSV entries
- Saved version:
  `appgprj_6a550c378000819185caf094173422bb~appgver_e113332d3dac8191bff9ed71b5d51487`
- Deployment: `appgdep_6a7178bb43c08191b86b568dabd45b94`
- Sites version 279, environment revision 19
- Sites stored 360 files and 31,682,560 bytes with content hash
  `sha256:1630c642f67fb83d38fd428197e05e4ae32e4bad97c29eb111d6c090760d7dc3`

Signed-in QA exercised New Job without submission, the exact 23-column job
register and CSV contract, customer sorting, filters and callable contacts,
dated latest jobs, schedule quote access, the assigned internal compliance
workspace and the customer asset register. The final `/api/trade-assets`
request returned HTTP 200 under request/ray `a25b2c9d7a1275df`; the asset and
timeline UI rendered, and errors-only worker logs contained zero events. The
custom-domain health endpoint returned HTTP 200. No production customer, job,
business, intent, case, evidence, certificate, submission, trade or settlement
record was created or changed.

Superseded signed-in QA releases:

- Sites version 277 from `82e0faf64906047a5f42fabf83c605edf320cb63`:
  saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_3037473e40d88191817b148c76b46504`,
  deployment `appgdep_6a716eaea7a481919682286140434b24`, archive 7,791,568
  bytes with SHA-256
  `5634F3374E72FA45620F3FF0EA9178C3DD65090C283E9365E3B127FE9DCF06FC`.
- Sites version 278 from `eeb636665a21d230b7150e03d60f614b7f71b1db`:
  saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_1825408c19508191a3f8fc69e969d7ac`,
  deployment `appgdep_6a7172b2ed008191b9460a81e8296993`, archive 7,791,566
  bytes with SHA-256
  `D72C597AE7075C1FCE24EDBA3F2236966B9F3ADBA5B3366EACB42B0A9C25E8FA`.

## Earlier released milestone

Status: `TRADE-CREDITEX-OPERATING-ALIGNMENT-41` released and historical

Historical Sites version 274 provenance:

- Primary implementation source commit: `836bc779f33a5f77fc4a18a41227dc76dfbf9914`
- Installer-register corrective commit: `c32be214558dd1a20ccb26d04bcf7b054b00f110`
- Released application source commit: `c51934456c2248da4cfde9a0b759b70d69df56ee`
- Saved version:
  `appgprj_6a550c378000819185caf094173422bb~appgver_02f3ce1e33ec8191919abea0bc24f6ac`
- Deployment: `appgdep_6a7082f95d2881919e97336aa038fc5a`
- The baseline archive is 7,775,395 bytes with SHA-256
  `CD5CA5072B17BC6970CB6EDEE0CA1A3C29D195A535397A91C9A0794810975F9C`.
  Sites stored 359 files and 31,590,400 bytes with content hash
  `sha256:455c203ec7dfe5c21c5559453b33e4e7f1b92910412d9cd4130ac903ccb2aeb7`.
- The baseline production-schema regression reported 106 of 106 audit-group statements passed.

Remaining controlled limitation: production has no
`TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT` or
`TLINK_ADDRESS_AUTOCOMPLETE_TOKEN`. Manual address entry remains available,
but it is explicitly stored and shown to Creditex as `manual_pending_review`.

## Superseded next-five sequence after milestone 42

1. **Approve one complete VEU, SRES and NSW governed bundle each:** retain exact current official-source bytes, effective dates, product and participant registers, evidence policy and calculation vectors under independent review, then exercise every bundle through a manual non-submitting job.
2. **Complete immutable intent revision and case supersession:** extend the guarded planned-date revision path to address, activity, product and technician changes, then add linked-case supersession and a clear authorised return-to-installer path.
3. **Configure one approved Australian production address provider:** reuse the same signed address component for customer, service-site and New Job creation and edits while preserving the manual-review fallback.
4. **Complete the Dataforce field and import contract:** split Phone and Mobile into explicit durable fields and reconcile unresolved lifecycle, agent, client, submission and certificate mappings without adding unverified columns.
5. **Complete physical field acceptance and governed form publishing:** publish versioned compliance-managed forms into real jobs, validate original bytes, GPS, EXIF and offline recovery on named iOS and Android devices, and keep installer completion separate from audit acceptance.

## Earlier released milestone

Status: `TRADE-CREDITEX-JOB-HANDOFF-40` released and live

Prepared: 3 August 2026

Milestone ID: `TRADE-CREDITEX-JOB-HANDOFF-40`

Working branch: `codex/sites-custom-domain-migration`

Released application source commit: `a45f250ee805aac1545c8643726dfde3964de22b`

Previous production application source: `8baad519d763f0955e481a925ca9114b4d708653`

Historical production for milestone 40: Sites version 271 from application commit `a45f250ee805aac1545c8643726dfde3964de22b`

Production URL: `https://compare.ausenergyassessments.com`

Creditex URL: `https://compare.ausenergyassessments.com/creditex/compliance`

Sites provider URL: `https://aea-energy-comparison.info294029.chatgpt.site`

Production access: public comparison host with authenticated installer and Creditex workspaces

## Released milestone contract

Outcome: an installer creates one scheduled TLink job, optionally selects a
controlled government program and activity once, and carries that exact
pre-case intent through accepted-quote linking, on-site governed evidence
questions and the Creditex audit workflow without re-entering the same fields.

Owning workflow:

- guided installer job creation in `TradeNewJobForm` and `trade-crm`;
- the durable installer-to-Creditex pre-case intent contract;
- accepted-quote conversion in `trade-compliance`;
- installer job overview and Creditex planned-intake visibility;
- focused schema, contract, route and responsive regressions.

In scope:

- replace the evidence-and-invoice-heavy creation tail with a short
  program/activity and appointment flow;
- validate controlled program/activity identifiers, jurisdiction and service
  category server-side and retain an immutable catalogue snapshot;
- keep a non-program job path;
- keep regulated case creation behind an accepted commercial handoff and an
  independently governed published activity and evidence policy;
- preselect the governed activity from the saved intent when an exact current
  match exists;
- make every assigned planned job visible to the authorised Creditex
  organisation with its customer, service-site, installer, commercial,
  appointment and retained workflow details, while withholding authentication
  secrets and storage credentials;
- preserve the existing AEA Field governed-question and original-evidence
  custody path after the case is opened.

Out of scope:

- activating a government rule or evidence policy;
- claiming that a discovery catalogue template is an approved compliance rule;
- creating a certificate, regulator submission, trade or settlement;
- creating production test customers, jobs or compliance records;
- changing the customer enquiry, quoting, invoicing or external registry
  systems beyond the fields needed for this handoff.

Acceptance criteria:

- program and activity are controlled dropdowns, not free text;
- the activity determines the TLink work category and the service-site
  jurisdiction is validated;
- an appointment can be created with the assignee and start time while optional
  visit details stay progressively disclosed;
- one atomic write creates the customer, site, job, appointment and optional
  compliance intent;
- Creditex can see its assigned planned intents and open the complete authorised
  job audit workspace, while the installer sees the same program/activity on
  the job;
- accepted-quote case creation pins the exact governed version and marks the
  intent linked;
- no regulated action is enabled by a catalogue-only intent;
- desktop and mobile layouts remain usable without document-level horizontal
  overflow.

Validation:

- focused intent, migration, wizard, CRM, accepted-handoff, Creditex portal and
  field-contract regressions;
- type checking, warning-free lint, integration tests, full application tests,
  migration replay, production build and Sites bundle audit;
- signed-in installer and Creditex browser QA without creating production data.

Stop condition: stop if program/activity identity cannot remain stable across
the job and case, if an unauthorised organisation could see an intent, if the
flow would bypass accepted quote or governed policy controls, or if completion
would require production data or an external regulator submission.

## Released milestone 40 outcome

The installer New Job flow now has five short stages: Work, Customer, Program,
Appointment and Review. Certificate and support selection stays conditional on
the work type and service-site jurisdiction. Where a pathway applies, the
installer chooses controlled claim output, program and activity values. Where
it does not apply, the ordinary non-program job path remains available.

One guarded transaction creates or attaches the customer and service site,
creates the TLink job and appointment, and optionally writes an immutable
`tlink-creditex-job-intent-v1` planning snapshot. The snapshot retains the
selected catalogue version, program, activity, claim output, jurisdiction,
service category, installation date and installer/customer/job references. It
is planning evidence only and cannot create a regulated case or certificate.

Creditex now has a `Certificate-work register` containing every assigned
installer planning record from job creation onward. Authorised Creditex roles
can open the full customer, service-site, installer, commercial, appointment
and workflow audit projection. Authentication credentials, tokens, raw storage
keys and unrelated internal identifiers are not exposed. The installer sees
the same planned program and activity from the job.

Accepted-quote conversion revalidates the exact intent against a published,
effective governed program, activity and evidence policy before it creates a
case. A matching case pins the governed version and links the intent in the
same database batch. A stale or incompatible intent is visibly marked
`Re-plan required` and cannot silently create a case.

## Milestone 40 validation and release evidence

- Exact application commit `a45f250ee805aac1545c8643726dfde3964de22b`
  passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31
  integration tests, the complete application suite, all 117 migrations,
  customer-plan PDF audit, Vinext production build and Sites server-bundle
  audit.
- The final intent, migration, installer wizard, CRM, accepted-handoff,
  Creditex portal and field-contract regression set passed 105 of 105.
  Independent security, data-boundary and interface review findings were fixed
  before release.
- Archive `.openai/site-release-a45f250.tar.gz` is 7,758,795 bytes with
  SHA-256
  `23C885EF9D4BD11FA837107740E9B44381D0E8B71CA4432364F3531CFF148CC9`,
  369 entries and all 117 migrations.
- Saved Sites version
  `appgprj_6a550c378000819185caf094173422bb~appgver_1e6ba2c1ae64819197a3b33a13cbb364`
  reports exact source `a45f250ee805aac1545c8643726dfde3964de22b`,
  355 stored files, 31,518,720 stored bytes and content hash
  `sha256:28daf91f4202cf79d0c3c5ecbb7b4f42822bec6725644c3077423b3869e83e0e`.
- Deployment `appgdep_6a701f23b43c8191ab61ef23e35166de` succeeded
  as Sites version 271 with environment revision 19.

## Milestone 40 live production evidence

- Signed-in installer QA opened the dashboard and New Job flow without
  submitting it. All five stages, controlled certificate/support selector,
  customer selection, appointment controls and review boundary rendered with
  no document-level horizontal overflow.
- The default energy-assessment work type correctly offered only `No government
  certificate or support activity`; program and activity choices remain
  conditional until the installer selects compatible certificate-generating
  work and a service jurisdiction.
- Signed-in Creditex QA recovered the existing administrator session and loaded
  `Compliance case control`, the permanent compliance navigation and the
  `Certificate-work register`. The assigned-work queue reported 0 jobs and no
  production record was created.
- Desktop and compact homepage checks kept the corrected shared heading and all
  navigation destinations reachable without document-level horizontal
  overflow. Browser image capture timed out, so this release retains live
  rendered-DOM, width and interaction evidence rather than a new screenshot
  artifact.

## Milestone 40 important limits and unverified areas

- The 32 program pathways and 212 activity templates are controlled planning
  catalogue records, not independently approved government rules.
- This release did not directly re-query production governed program, activity,
  evidence-policy or case counts. It created no production data, and the live
  Creditex assigned-work register reported 0 jobs.
- No certificate, regulator submission, trade or settlement is created. No
  single public authoritative API contract has been verified for every
  Australian certificate calculation.
- A changed job, service site or installation date does not yet create an
  automatic replacement intent. The current system detects the mismatch,
  displays `Re-plan required` and blocks case linking.
- Pre-case Creditex audit exposes authorised photo and file metadata. Original
  governed evidence bytes remain available only after case creation through
  the existing protected evidence viewer.

## Previous released milestone

Status: `CREDITEX-GOVERNED-SOURCE-INTAKE-39` released and live

Prepared: 3 August 2026

Milestone ID: `CREDITEX-GOVERNED-SOURCE-INTAKE-39`

Working branch: `codex/sites-custom-domain-migration`

Released application source commit: `8baad519d763f0955e481a925ca9114b4d708653`

Primary application source commit: `8baad519d763f0955e481a925ca9114b4d708653`

Previous production application source: `37776ed557d7c0a25d92698f52e87cf59cee05b6`

Prior production for milestone 39: Sites version 270 from application commit `8baad519d763f0955e481a925ca9114b4d708653`

Production URL: `https://compare.ausenergyassessments.com/creditex/compliance`

Sites provider URL: `https://aea-energy-comparison.info294029.chatgpt.site`

Production access: public host with an authenticated Creditex portal

## Released milestone 39 outcome

Outcome: an authorised Creditex operator can capture an exact official source into governed draft-only custody, and an independent reviewer can inspect the same retained bytes before any artifact or rule binding can be approved.

Owning workflow and files:

- official-source custody and target projection: `src/lib/creditex-official-source-custody-server.ts`;
- protected list and upload route: `src/app/api/creditex/official-sources/route.ts`;
- protected retained-byte route: `src/app/api/creditex/official-sources/[id]/route.ts`;
- operator workbench and responsive presentation: `src/components/CreditexOfficialSourceWorkbench.tsx` and its module stylesheet;
- Creditex workspace mount and role-aware navigation: `src/components/CreditexCompliancePortal.tsx`;
- focused custody, route, review and portal regressions under `test/`.

In scope:

- list only the signed-in organisation's governed source artifacts and their current independent review state;
- supply server-controlled draft targets for program, activity, evidence-policy and calculator bindings;
- upload exact official bytes through the existing multipart custody boundary and show the server-computed SHA-256 and byte count;
- download exact retained bytes only after organisation scoping, R2 retrieval, byte-length comparison and SHA-256 verification;
- present the current official URL beside the retained artifact so a reviewer can compare both;
- preserve artifact review before binding review, different-identity review and verified-governance requirements;
- keep every record draft-only and every publication, certificate, submission, trade and settlement action blocked.

Out of scope:

- publishing a government rule, activity version, evidence policy or calculator;
- accepting a source without a named independent reviewer;
- creating live regulated jobs, certificates, submissions, trades or settlements;
- treating the research source index as governed custody;
- claiming complete VEU, TESSA, REC Registry or other program rule coverage;
- creating production test data during release QA.

Acceptance criteria:

- an empty governed inventory is clearly displayed as zero and is not populated with research-only references;
- target selectors come from owner-scoped server data and contain only draft records;
- uploads retain exact bytes, compute the hash on the server and return explicit current artifact and binding decisions;
- retained-byte download fails closed for missing, altered or wrong-organisation R2 objects;
- the capturer cannot review the artifact or its binding, and binding approval remains unavailable until the artifact has a current independent approval;
- no rule activation, policy publication, certificate action or external send is introduced;
- desktop and compact layouts remain readable with no document-level horizontal overflow.

Validation:

- focused official-source custody, route, review, portal and workspace tests;
- type checking, warning-free lint, integration and full application tests;
- all migrations, customer-plan PDF audit, Vinext production build and Sites bundle audit;
- authenticated empty-state and permission-boundary browser QA without uploading production data.

Stop condition: stop if source bytes cannot be independently inspected, exact-byte integrity cannot be proven, owner scope is ambiguous, a target is not draft-only, or completion would require production data or a regulator submission.

The [complete current-state audit](./audit/2026-07-21-complete-current-state/README.md) remains the immutable evidence baseline. [RELEASE_TRUTH.md](./RELEASE_TRUTH.md) owns released implementation status and deployment identity. [ROADMAP.md](../ROADMAP.md) owns approved forward sequencing. Sites version 270 was the production identity for milestone 39. The governed inventory verified during that release was 0 published programs, 0 activity versions, 0 evidence policies and 0 regulated cases.

## Milestone 39 validation and release evidence

- Exact application commit `8baad519d763f0955e481a925ca9114b4d708653` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, the complete application suite, all 115 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The integrated custody, review, workbench, portal, pilot, policy, readiness, calculation and interchange set passed 86 of 86. Independent final review found no remaining blocker against exact-byte replay verification, same-reviewer retained-byte access receipts, authorised-role inventory access, immutable completed decisions and authoritative cursor pagination.
- Archive `.openai/site-release-8baad51.tar.gz` is 7,736,223 bytes with SHA-256 `BDBED88DB3F6675DFB0AD4BF133651F9B4609DA0432F42390DD591D5715205A8`.
- Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_2deae2c2caa081919a369e1cd193bd5d` reports exact source `8baad519d763f0955e481a925ca9114b4d708653`, 351 stored files, 31,406,080 stored bytes and content hash `sha256:6cf77082dca1a638dc78e094791cd712f2417fdb17bd86c9a0ba772aa041d978`.
- Deployment `appgdep_6a6fc16429e88191af41bbf10fb18a6a` succeeded as Sites version 270 with environment revision 19.

## Milestone 39 live production evidence

- Signed-in Chrome QA loaded the existing Operations workspace and its zero-case privacy-minimised queue, then opened the permanent `Official sources` tab without changing identity or creating data.
- The contextual heading changed to `Official source custody`. The governed workbench rendered the exact-source capture form, server-controlled draft-target selector, current-government-link field, citation, exact-file input, optional HTTP metadata and retained-source register.
- Production correctly reported `0 shown of 0 records`, no eligible draft target, disabled `Retain source`, and disabled previous and next pagination. No research-only link was promoted into governed custody.
- At a 390 by 844 responsive override, all four compliance tabs, the complete source workbench, zero state and disabled safety controls remained reachable. The override was cleared after QA.
- The compare-platform homepage at the same responsive override showed `Scroll for more options`, kept `Start` visible and retained all seven navigation destinations. At the default viewport the cue remained hidden while the complete navigation stayed available.

## Milestone 39 important limits and unverified areas

- Exact official VEU, NSW TESSA and REC Registry source bundles have not yet been retained or independently approved in production.
- The workbench is draft-only custody. It cannot publish a rule or policy, execute a calculator, create a certificate, send a regulator file, trade or settle.
- A real Creditex reviewer identity still needs to exercise the retained-file download, artifact decision and binding decision sequence against an authorised non-production fixture before the first production policy review.
- TESSA and REC authenticated uploads, regulator acceptance receipts and rejection payloads remain unavailable; no public authoritative certificate-calculation API contract has been verified.

## Released milestone 38 outcome

The shared compare-platform navigation no longer clips its first destinations. `Start` now begins at the visible scroll origin, all seven existing destinations remain ordered, and layouts up to 1320 pixels move navigation onto a clear full-width row with a visible `Scroll for more options` cue and right-edge continuation fade. The cue is associated with the navigation for assistive technology, compact layouts retain horizontal snap access, and the page itself does not overflow.

Exact application commit `37776ed557d7c0a25d92698f52e87cf59cee05b6` passed the complete `npm.cmd run validate` gate, including 31 of 31 integration tests, the full application suite, all 115 migrations, customer-plan PDF audit, Vinext production build and Sites server-bundle audit. The focused navigation suite passed 21 of 21. Local responsive measurements at desktop, approximately 390 pixels and approximately 320 pixels had zero document-level overflow and kept `Start` visible before scrolling and `Assessments` reachable at the scroll end.

Archive `.openai/site-release-37776ed.tar.gz` is 7,717,752 bytes with SHA-256 `ED56FF26BE5E160878D8A72E022B703CCEC952058687FD66A7962CB51D269030`. Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_ea8944a8b6d08191bf7b8fd3237619c4` reports exact source `37776ed557d7c0a25d92698f52e87cf59cee05b6`, 351 stored files, 31,303,680 stored bytes and content hash `sha256:bdd4fb3fe2ccad379fe6afc94f5ae92470213388ba2f9c236708b8cffbab0aed`. Deployment `appgdep_6a6fb33354ac8191beb6ef116cbe9bca` succeeded as Sites version 269 with environment revision 19.

## Released milestone 37 outcome

The next five Creditex priorities are now integrated as one synthetic, fail-closed preflight:

1. AEA Field can capture an exact manual-evidence prompt on its dedicated compliance lane, retain original upload bytes in R2, calculate SHA-256 server-side, inspect capture time, EXIF and GPS, recover multipart and offline uploads, and bind every receipt to the exact device, job, form version and prompt. User sign-out attempts server revocation before local purge, and a server-side revocation forces sign-out on the next successful sync.
2. Manual forms compose an immutable, independently approved government minimum with a separately editable Creditex operational layer. Creditex can add instructions and additional prompts, but cannot remove, weaken, replace or reorder a government minimum. Exact bytes, hashes, effective dates, dual control and compare-and-swap locking are enforced before approval.
3. Synthetic manual jobs and the VEU pilot now share one owner-scoped register, populated advanced-search facets and complete audit workspace while preserving the exact 23 supplied Dataforce columns and one row per job.
4. Every one of the 212 controlled activity templates has one deterministic calculation-readiness result. Six SRES technologies expose a protected estimate; 206 pathways remain visibly blocked or non-executable and no certificate action is enabled.
5. VEU, NSW TESSA and REC Registry boundaries now have explicit blocked descriptors and preflight status. No exact external serializer, regulator request, certificate creation, trade or settlement action is exposed without retained official dictionaries, independent approval and accepted external receipts.

This is a production-quality synthetic test foundation, not a claim that every government rule, certificate calculation or regulator connector is complete. The simple installer path remains: select a controlled program and activity, use its pinned evidence form, capture each requested item once, resolve visible failures, then hand the complete immutable job to Creditex for audit.

## Milestone 37 owning workflow and files

- Manual field capture, R2 custody, replay protection and physical acceptance: `src/lib/creditex-manual-field-server.ts`, `src/lib/creditex-manual-field-acceptance-server.ts`, `src/app/api/creditex/manual-field/**`, migration `0112_creditex_manual_field_capture.sql` and the matching AEA Field mobile modules.
- Unified exact register and audit projection: `src/lib/creditex-synthetic-job-register-server.ts`, `src/app/api/creditex/synthetic-job-register/route.ts`, `src/components/CreditexVeuPilotWorkspace.tsx`, `src/components/CreditexManualJobAuditWorkspace.tsx` and migration `0113_creditex_synthetic_register.sql`.
- Government-minimum and Creditex-layer composition: `src/lib/creditex-manual-policy-merge.ts`, `src/lib/creditex-manual-policy-merge-server.ts`, its protected route and migration `0114_creditex_manual_policy_merge.sql`.
- National calculation and interchange readiness: `src/lib/creditex-calculation-coverage.ts`, `src/lib/creditex-interchange-preflight.ts`, `src/lib/creditex-tessa-csv.ts`, `src/lib/creditex-rec-bulk-upload.ts` and their protected readiness routes.
- Regression evidence: the Creditex manual-field, acceptance, policy-merge, register, calculation-coverage, interchange, schema-guard and mobile capture, upload-recovery and sign-out suites.

## Milestone 37 safety boundaries

- Every new manual-form, manual-job, capture and register path remains `synthetic_test`. It cannot create or mutate a regulated case, certificate, regulator submission, trade or settlement.
- The server hashes and inspects original uploaded bytes. Client-authored filenames, hashes, coordinates, timestamps or completion claims are never treated as proof.
- Required GPS fails closed when absent, mocked or when reported location accuracy is worse than 100 metres. Physical acceptance remains separate from emulator or source validation.
- A government minimum must come from a published, effective, independently approved policy record. With the current governed inventory at zero, production form approval remains blocked.
- Creditex instructions are operational additions only. They never become a private government rule pack.
- The register contains only the exact Dataforce columns. Program, activity, custody and governance detail remains in filters and the audit workspace.
- TESSA and REC entries are readiness descriptors only. There is no exact approved parser, serializer, bulk download or live-send control in this release.
- Deterministic estimates remain preflight values. They cannot register, issue, trade or settle a certificate.

## Milestone 37 validation and release evidence

- Exact corrective application commit `5d4b540dcbcb49b3d1d57eda122a4dca86d723bb` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,355 main tests with 1,353 passed, 2 intentionally skipped and 0 failed, all 115 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The AEA Field mobile suite passed 20 of 20, together with mobile type checking and lint. Android and iOS Expo exports completed. Android still reports the unresolved `android.googleServicesFile: "./google-services.json"` warning, so native Firebase signing and physical-device acceptance are not claimed.
- The final D1 register-facet correction passed its focused 5-test set and retained exact facet counts, labels, parent relationships and empty-value exclusion across seven read-only grouped queries in one transactional batch.
- Archive `.openai/site-release-5d4b540.tar.gz` is 7,703,920 bytes with SHA-256 `f1ce735aed060d55e8461814707f53da22fb8845820629b96b6124db541fa989`, 365 entries, all 115 migrations and zero CSV entries.
- Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_95cd969101b08191b89b03aaea09e827` reports exact source `5d4b540dcbcb49b3d1d57eda122a4dca86d723bb`, 351 stored files, 31,303,680 stored bytes and content hash `sha256:b0d80a9e5d0c61084a227f8661df5d0366845ee5ac298c4a671a3eae753126a9`.
- Deployment `appgdep_6a6fa22d2bb48191b8bd5fd8317cbe9f` succeeded as Sites version 268 with environment revision 19.

## Milestone 37 live production evidence

- Signed-in Chrome QA loaded 300 of 300 VEU pilot jobs with the exact 23 Dataforce headers, 23 sortable columns and one job per row.
- Global all-field search reduced the register to the exact requested job and restored the complete register. The compact drawer exposed stored-value source, program, activity, installer, technician, status and postcode filters.
- The App Id sort menu closed after an outside click. Double-click opened the complete audit workspace, including customer, job, appointment, files and photos, compliance status, program controls and original-evidence custody surfaces.
- Evidence reported 32 controlled program pathways and 212 activity templates, with the editable form starter, manual-job and installer-preview surfaces present. No production form or job was created during QA.
- Calculators reported 212 covered templates, 6 executable estimates, 206 blocked or non-executable pathways and 0 enabled certificate actions. Connectors reported 5 blocked descriptors, 0 serializers and 0 external sends, with no send, submit, trade or certificate-creation button.
- The compact mobile layout retained navigation, global search and the right-edge filter drawer without document-level horizontal overflow; the wide register kept its own horizontal scroller.
- Sites Worker error-only logs returned zero events after the signed-in checks. Browser logs contained only Chrome-extension asynchronous message-channel closures with no application stack.

Sites version 267 contained the complete milestone implementation from `8c29808a9f4a80acc8e7f2304c4b49268f4f2c49`, but signed-in QA found that production D1 rejected the compound seven-arm facet query and the pilot failed closed. No data mutation was involved. Version 268 replaces that query with seven exact grouped statements executed through one transactional D1 batch; the same signed-in route then loaded successfully.

## Milestone 37 important limits and unverified areas

- No named physical iOS or Android device has completed the online, offline, multipart, GPS, EXIF, retry, R2 restore and sign-out matrix.
- Native Firebase configuration, platform signing, distribution, device accessibility and background-upload acceptance remain incomplete.
- The real governed inventory remains 0 published programs, 0 activity versions, 0 complete evidence policies and 0 regulated cases, so no government minimum is yet approved into a production form.
- No exact approved TESSA v1.7 or REC Registry dictionary, parser, serializer, bulk export, rejection map or accepted external receipt is retained. The ESC VEU authorised API contract and sandbox remain unavailable.
- Only 6 of 212 pathways expose deterministic SRES estimates. The remaining 206 are blocked or non-executable until exact source assets, lookups, independent formula approval and oracle reconciliation exist.
- Production certificate creation, regulator submission, trading and settlement remain disabled.

## Superseded next-five sequence after milestone 37

1. **Add automatic intent revision and return workflow:** create a new immutable planning version when the job, service site, activity or installation date changes, supersede the prior version visibly, and let Creditex accept or return the exact current plan without weakening the accepted-quote or governed-policy gate.
2. **Approve the first governed VEU, SRES and NSW bundles:** retain the complete current official source bytes, effective periods, product and participant snapshots, formulas and evidence requirements under two-person review, then publish one bounded activity chain per program.
3. **Bind dynamic compliance forms into AEA Field:** render the case-pinned government minimum plus editable Creditex operational prompts, declarations and signatures with controlled conditional logic, offline capture and immutable version identity.
4. **Enforce evidence-complete job gates:** prevent installer completion and Creditex submission readiness until every required question, original file, photo metadata, geolocation rule, declaration and signature passes the pinned policy, while keeping correction instructions simple.
5. **Complete Creditex pre-case evidence operations:** add audited original-byte access where authority permits, operational notifications, Dataforce import mapping and bounded legacy backfill so Creditex can manage real volume without creating certificates or external submissions prematurely.

## Released milestone 36 outcome

Creditex now has a national synthetic manual-test lab for all 32 controlled Australian program pathways and all 212 controlled activity templates. An administrator, case manager or reviewer can select any catalogued activity, generate an editable starter form, add and reorder installer prompts, lock an exact test-ready form version, create a synthetic manual job and move it through field testing, audit, changes required, passed and archived states.

The form builder supports photo, document, text, number, controlled select, declaration checkbox, date and signature prompts. Each prompt can record capture timing, minimum and maximum files, permitted MIME types, original-file retention, metadata retention and GPS requirements. Jobs pin the exact activity snapshot, form bytes and SHA-256 so a later form edit cannot silently change work already under test.

Creditex operational instructions remain separate from government rules. A prompt can be identified as a government-requirement candidate only when it carries an HTTPS official source, title, version, clause and exact SHA-256. This lab cannot publish that candidate as government policy. The independently governed evidence-policy workflow remains the authority for government requirements.

## Milestone 36 owning workflow and files

- Manual evidence contracts and validation: `src/lib/creditex-manual-evidence-lab.ts`.
- Owner-scoped form, job and append-only event operations: `src/lib/creditex-manual-evidence-lab-server.ts`.
- Protected same-origin API: `src/app/api/creditex/manual-evidence-lab/route.ts`.
- Creditex operator and installer-preview interface: `src/components/CreditexManualEvidenceLab.tsx` and `src/components/CreditexManualEvidenceLab.module.css`.
- Storage and runtime protection: `drizzle/0111_creditex_manual_evidence_lab.sql`, `db/schema.ts` and `src/lib/creditex-schema-guards.ts`.
- Regression evidence: `test/creditex-manual-evidence-lab.test.mjs`, `test/creditex-schema-guards.test.mjs`, `test/creditex-operations-control.test.mjs` and `test/creditex-veu-pilot.test.mjs`.

## Milestone 36 safety boundaries

- Every form and job is `synthetic_test`; real customer aliases are rejected and no regulated case, evidence object, certificate, submission, trade or settlement is written.
- Draft forms are editable. Locked form versions are immutable and must be cloned before change. Started jobs retain their pinned form and activity snapshots.
- A ready-for-audit response snapshot cannot be modified during approval. Only an administrator or reviewer can require changes or pass a test, at both API and database boundaries.
- Required counts, file counts, MIME types, typed answers, GPS, metadata, original-file and review-note requirements fail closed.
- The lab records filenames and capture checks only. Physical file bytes, camera capture, EXIF, offline sync and R2 storage are not represented as accepted.
- The exact 23-column Dataforce register and its CSV contract remain unchanged.

## Milestone 36 validation and release evidence

- Exact application commit `ecec39abbc65fb5d25aa5d21d6dcfead724bcc0f` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,289 main tests with 1,287 passed, 2 intentionally skipped and 0 failed, all 112 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The final manual-evidence, schema-guard, VEU-pilot and operations-control set passed 62 of 62. Independent release review found no P0 or P1 blocker. Its one database review-role hardening finding was corrected and covered by a regression test before release.
- Archive `.openai/site-release-ecec39a.tar.gz` is 7,629,648 bytes with SHA-256 `2BAFF556C8F963612F6FC4878326C2A1924B38F0AB8E5D1046B00C5ED2044F53`, 361 entries, all 112 migrations and zero CSV entries.
- Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_e42b1932db8481918304dad9fcf28bd2` reports exact source `ecec39abbc65fb5d25aa5d21d6dcfead724bcc0f`, 347 stored files, 30,883,840 stored bytes and content hash `sha256:ac05eacd1792bacdb6b5ef4e0dae86149f8cb484678401061e86ca96ddce69cd`.
- Deployment `appgdep_6a6f4c3dc8b88191a33403ba9acbd5d9` succeeded as Sites version 266 with environment revision 19.

## Milestone 36 live production evidence

- Signed-in Chrome QA loaded the Evidence workspace with catalogue metrics for 32 controlled program pathways and 212 controlled activity templates, two controlled catalogue selectors, the original-evidence custody boundary and no application alert.
- Form builder, Manual jobs and Installer preview all rendered. The manual-job panel exposed a synthetic-only job creator and the preview rendered the TLink Field handoff without creating a production record.
- The exact 300-job register still opened, and Advanced search exposed its compact right-edge drawer with installer, activity, review, evidence and the existing Dataforce-equivalent filter families.
- At 390-pixel and 320-pixel responsive overrides the document width equalled the viewport width. Wide controls used bounded internal horizontal scrolling instead of document overflow.
- Browser review found zero application errors. Three Chrome-extension asynchronous message-channel closures were excluded because they carried no application stack.

## Milestone 36 important limits and unverified areas

- The starter generator is available for every activity, but exact government evidence requirements are not automatically published into forms until retained source bytes and independent evidence-policy approval exist.
- Production QA did not create a synthetic form or job. The complete create, lock, field-test, review, change and pass loop is proven by the owner-scoped database and API regression suite rather than a new production row.
- Original photo and document bytes, EXIF, GPS, device identity, offline recovery, upload recovery and R2 restore remain outside this manual simulator.
- Manual test jobs do not yet appear in the main 23-column Jobs register or full job-audit workspace.
- TESSA, ESC VEU and REC Registry interchange remains disabled. Certificate creation, submission, trading and settlement remain disabled.

## Superseded next-five sequence after milestone 36

1. **Connect the physical field-test path:** bind locked manual-form prompts to AEA Field test-device capture, original bytes, EXIF, GPS, device identity, offline queue, retry and R2 restore, then record named physical acceptance.
2. **Merge government policy without weakening it:** render independently approved government evidence requirements as immutable fields, layer editable Creditex instructions and additional operational prompts above them, and show an exact version diff before a form can be locked.
3. **Unify manual jobs with the Creditex audit workflow:** project synthetic manual jobs into the existing register, advanced filters and full audit workspace without changing the exact 23 Dataforce columns or allowing a synthetic row into regulated tables.
4. **Build regulator interchange dry runs:** implement exact NSW TESSA v1.7 CSV preflight and download, separate REC Registry SGU and SWH/ASHP bulk packs, and a disabled ESC VEU API adapter with immutable manifests, receipts and rejection reconciliation. Keep every live send disabled.
5. **Complete source-approved calculation coverage:** retain exact formula assets and lookup snapshots, author independently reviewed calculators and golden vectors, and run a complete 212-activity regression before enabling any expected-entitlement result.

## Released milestone 35 outcome

Creditex now has one national calculation-readiness workspace across 32 controlled Australian government program pathways and 212 controlled activity templates. Every activity declares exactly one calculation or administration pathway, including deterministic estimate, governed formula review, official registry, project method, not commenced, closed or non-certificate administration. Unsupported and unapproved paths fail visibly closed instead of returning a misleading zero.

The released SRES estimator covers 2026 through 2030 solar photovoltaic, wind, hydro, registered solar water heater, air-source heat pump and eligible solar-battery expected entitlements. It uses exact base-10 arithmetic, official final-step rounding, controlled inputs, source and effective-period identifiers, a complete calculation trace and deterministic input, trace, output and receipt hashes. Expected STCs remain separate from any future registry-accepted quantity.

## Milestone 35 owning workflow and files

- National program and activity coverage: `src/lib/australian-government-program-catalogue.ts` and `src/lib/australian-certificate-calculation-catalogue.ts`.
- Deterministic STC estimates: `src/lib/creditex-stc-estimator.ts`, `src/lib/bounded-json-request.ts` and `src/app/api/creditex/stc-estimates/route.ts`.
- Operator workflow: `src/components/CreditexVeuPilotWorkspace.tsx` and `src/components/CreditexVeuPilotWorkspace.module.css`.
- Regression evidence: `test/australian-government-program-catalogue.test.mjs`, `test/australian-certificate-calculation-catalogue.test.mjs`, `test/creditex-stc-estimator.test.mjs`, `test/creditex-stc-estimate-route.test.mjs` and `test/creditex-veu-pilot-workspace.test.mjs`.

## Milestone 35 safety boundaries

- The estimator returns an expected entitlement only. It cannot create, validate, register, trade or settle a certificate and cannot promise a customer rebate.
- VEU, ESS, PDRS, ACCU, LGC, REGOs, ACT EEIS and SA REPS remain non-executable unless their exact governing source bytes, formula assets and independent approvals exist.
- Closed and future activities are explicitly unavailable, not presented as formula-pending or current.
- The protected estimate route is authenticated, role-controlled, same-origin, no-store, streaming-body bounded to 16 KiB and non-mutating.
- No undocumented regulator endpoint is called. Registry, portal, CSV and partner connectors remain controlled disabled contracts.
- The Jobs register retains only the exact 23 supplied Dataforce columns; national programme and calculation fields remain in the calculation and audit workspaces.

## Milestone 35 validation and release evidence

- Exact application commit `5eab88950c1047746484ce2ab4880d8e32be824a` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,281 main tests with 1,279 passed, 2 intentionally skipped and 0 failed, all 111 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The focused national catalogue, estimator, protected route and operator-workspace suite passed 34 of 34. Independent final review found no remaining P1 or P2 defect and reconciled six live REC Registry oracle vectors.
- Archive `.openai/site-release-5eab889.tar.gz` is 7,598,597 bytes with SHA-256 `402682B1F6BB535EA63FDA1DA26B4D9A37D351445457C75A3612B86FDCB32C6F`, 360 entries, all 111 migrations and zero CSV entries.
- Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_123d03e2e4b08191b196236068cca9b0` reports exact source `5eab88950c1047746484ce2ab4880d8e32be824a`, 346 stored files, 30,638,080 stored bytes and content hash `sha256:7ee3e873e71c98c648f2fba25ae6d0b83c30eb47b7a6a17bea2c422c14abd0dc`.
- Deployment `appgdep_6a6f2bac3b588191bb64b2b29c6e1b1b` succeeded as Sites version 265 with environment revision 19.

## Milestone 35 live production evidence

- Signed-in Chrome QA confirmed the 10-installer, 30-technician and 300-job VEU pilot still loads, with the exact 23 Dataforce headers and no added register column.
- Search, Refresh and Advanced search computed to the same 28-pixel height, border, background, text colour, font weight and radius in collapsed and expanded states. Advanced search exposed one drawer and the Status menu closed after an outside click.
- The Calculators panel reported 212 activities, including 6 estimate-available activities and 131 governed-formula-review activities, with zero certificate actions.
- Live calculations returned 45 expected STCs for the default PV vector and 164 expected STCs for a 40 kWh battery with a 1 May 2026 safety-certification date.
- NSW PDRS BESS3, BESS4, BESS5 and V2G1 showed `Activity Not Commenced`, WH1 showed `Activity Closed`, and current unapproved NSW formulas remained blocked.
- At actual 390-pixel and 320-pixel CSS widths there was no document overflow, the table retained its own horizontal scroll and the calculator stacked into one readable column.
- Browser review found only Chrome-extension asynchronous-channel warnings and no application exception.

## Milestone 35 important limits and unverified areas

- No single national government calculation API or documented public certificate-write API was found. TLink therefore needs effective-dated local rule assets, official calculator or registry reconciliation and separately authorised submission adapters.
- Exact current VEU, SRES and NSW source bytes are not yet retained in R2 with approved hashes and supersession links.
- Official participant, product, licence, recall, suspension, postcode-zone and model-register snapshots are not yet imported and independently approved.
- VEU, ESS and PDRS formula drafts, eligibility history and cross-claim logic remain non-executable.
- TESSA CSV v1.7, the current ESC VEU API pack and REC Registry bulk-upload adapters are not implemented.
- Physical iOS, Android, offline, GPS, EXIF, upload-recovery and R2-restore acceptance remain incomplete.
- External certificate creation, submission, trading and settlement remain disabled.

## Active milestone 37 contract

### One user outcome

Connect one locked manual form to the AEA Field test-device path and prove that the original bytes, capture time, device identity, EXIF, GPS, offline queue, retry and R2 restore all reconcile to the exact synthetic job and prompt without weakening a government requirement or enabling a real certificate action.

### Stop condition

Stop and open a new milestone before any real customer evidence, regulated case, certificate action, undocumented external integration, formula activation without retained exact bytes and independent approval, new paid service or change to tenant, identity or payment boundaries. Do not claim physical acceptance until the named iOS, Android, offline, metadata, GPS, upload-recovery and R2-restore matrix passes.

## Released milestone 34 outcome

Creditex now has an exact Dataforce job-list surface and governed authoring foundations without adding TLink-only fields to the operator register or enabling any regulated external action. The register exposes the exact 23 Dataforce headers in the exact Dataforce order, one job per row and one controlled row action embedded inside `App Id`. TLink governance fields remain available in the complete job audit workspace.

The released operator workflow provides:

- one desktop toolbar line ordered Density, all-field search, Search, Refresh and Advanced search, with every control 28 pixels high;
- the rightmost Advanced search control opening the compact right-edge drawer and restoring focus after close;
- compact 320-pixel and 390-pixel layouts that stay on one line with no document overflow;
- one exact 23-column Dataforce display, import, export and copy projection;
- one table-owned vertical and horizontal scroll surface, with no document-level desktop overflow;
- menu dismissal after outside action, Escape or selection;
- global all-field search and the complete double-click audit workspace;
- corrected official VEU version dates, with version 25 effective from 21 July 2026 and version 24 effective from 30 June 2026;
- explicit as-of and effective-window lookup approval and materialisation;
- append-only legacy mapping authoring and independent review; and
- draft-only calculator and golden-vector authoring whose vectors remain `not_run`.

## Milestone 34 owning workflow and files

- Exact register and responsive toolbar: `src/components/CreditexVeuPilotWorkspace.tsx` and `src/components/CreditexVeuPilotWorkspace.module.css`.
- Dataforce contract: `src/lib/creditex-dataforce-job-csv.ts`.
- Effective-dated lookup review: `src/lib/creditex-source-lookup-review-server.ts`.
- Legacy mapping authoring and review: `src/lib/creditex-legacy-mapping-authoring-server.ts`, `src/lib/creditex-legacy-mapping-guards.ts` and their protected routes.
- Calculator authoring: `src/lib/creditex-calculator-authoring-server.ts`, `src/lib/creditex-calculator-authoring-guards.ts` and its protected route.
- Schema and deployment-parser correction: `db/schema.ts`, migrations `0109` and `0110`, and `src/lib/creditex-schema-guards.ts`.

## Milestone 34 safety boundaries

- User-facing register columns are the exact 23 Dataforce columns only. TLink compliance and governance dimensions remain in the audit workspace rather than becoming extra register columns.
- Lookup approval is append-only, independently reviewed, explicitly as-of dated and constrained by authoritative effective windows.
- Mapping authoring cannot infer an unmapped source field or target path and cannot invoke Dataforce, Runabout or a registry.
- Calculator authoring remains draft-only. Test vectors remain `not_run`; no protected runner, approval or execution surface is exposed in this release.
- No mapping or calculator endpoint can create a certificate, submission, trade or settlement.
- The controlled VEU population remains synthetic and cannot become regulated work.

## Milestone 34 validation and release evidence

- Primary application commit `58b92e1f859c62de00e4d8bda11624ab3f1633b8` passed the complete application review. Corrective application commit `31b152933273db33bfa866bdbc491f6fdc35360a` moved calculator trigger installation into the existing prepared-statement schema-guard path after Sites migration parsing rejected trigger bodies containing internal semicolons.
- Exact corrective commit `31b152933273db33bfa866bdbc491f6fdc35360a` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,267 main tests with 1,265 passed, 2 intentionally skipped and 0 failed, all 111 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The targeted operations, calculator and schema suite passed 49 of 49. Independent migration and final review reported READY with no P1 or P2 defect.
- Corrected archive `.openai/site-release-31b1529.tar.gz` is 7,575,785 bytes with SHA-256 `0AE7AA64CE6D9B93D0A0D6DA65CEC1F11F1ADA8D4D1451E60EEDDD2AF38D87C5`, 360 entries, all 111 migrations, zero CSV entries and zero `CREATE TRIGGER` statements in `0110_creditex_calculator_authoring.sql`.
- Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_aa8d0183098881918f1fe626a7deb951` reports 346 stored files, 30,535,680 stored bytes and content hash `sha256:7add92fd081d36220e266666533ce162585bcf23531889182f7abbbd982a8ea2`.
- Deployment `appgdep_6a6f09034b10819187e46054254b06b2` succeeded as Sites version 264 with environment revision 19.
- Sites version 263 was saved from `58b92e1f859c62de00e4d8bda11624ab3f1633b8`, but deployment `appgdep_6a6f0208b8208191ba75d01cd0b659d8` failed before activation with `incomplete input: SQLITE_ERROR`. Sites version 262 remained live, no production change occurred and version 263 was not redeployed.

## Milestone 34 live production evidence

- Signed-in administrator QA confirmed 10 of 10 installers, 30 of 30 field technicians, 300 of 300 jobs and all 34 activity families.
- The register rendered the exact 23 Dataforce headers in order, 23 cells per row and 300 controlled row actions. TLink-only governance fields were absent from the register and available inside the audit workspace.
- At desktop size, the table owned its 3,540 by 9,576 scroll area with no document overflow. At 320 and 390 pixels the toolbar remained one line with no document overflow.
- The toolbar stayed on one line in the order Density, search field, Search, Refresh and Advanced search, with every control 28 pixels high.
- Global search for `I01-T01` returned 10 of 10 jobs; reset restored 300 of 300.
- Advanced search opened exactly one dialog containing 25 controlled selects, focused Close first and returned focus to Advanced search on close. A column sort menu closed on outside action.
- Primary tabs remained at approximately 53 pixels and pilot tabs at approximately 143 pixels across every panel. Double-click opened the complete audit workspace.
- Browser review found only Chrome extension asynchronous-channel warnings and no application exception.

## Milestone 34 important limits and unverified areas

- Exact v24 and v25 source bytes have not yet been retained in R2, hash-verified and independently approved.
- The first official participant, product, licence, recall and suspension cohort has not yet been imported and approved.
- Physical iOS, Android, offline, upload-recovery and R2-restore acceptance remain incomplete.
- Calculator drafts and authoritative golden vectors remain unapproved and cannot execute.
- The first mapping artifact and authorised Dataforce-bound parallel receipt remain incomplete. Runabout and registry sandbox contracts remain unavailable.
- External certificate creation, submission, trading and settlement remain disabled.

## Prior released milestone 33 outcome

Creditex now has the governed approval and parallel-operation foundations needed to move retained government material, operational lookup snapshots, physical-device custody evidence, official formulas and exact Dataforce references through independent review without allowing an unapproved item to become a rule, eligibility result, certificate, submission, trade or settlement.

The released operator workflow also closes the presentation defects raised during production review:

- Operations, VEU test pilot and Government rules keep one dark visual system and one fixed 36-pixel primary tab bar in the same position;
- Pilot control, Jobs, Sources, Lookups, Evidence, Calculators and Connectors keep one clear, fixed 35-pixel inner tab bar in the same position on every panel;
- the Jobs toolbar is ordered Density, all-field search, Filters and Refresh, with every control 28 pixels high;
- the global search covers every populated scalar job, customer, site, installer, technician, work and appointment field;
- advanced search is a compact right-edge drawer and the removed installer/activity-family bottom rail does not return;
- column option menus close on outside action, Escape or selection; and
- the full job audit workspace now uses the same dark palette, with independent scrolling for its main record and compliance rail.

The five governed foundations delivered in this milestone are:

1. an append-only official-source approval bridge with exact R2 object, SHA-256, binding, reviewer separation and current-approval checks;
2. an operational-lookup approval bridge that verifies every row hash, row count and aggregate records hash before materialisation;
3. tester-authored physical-custody acceptance with a distinct governance decision, exact artifact hashes and append-only database protection;
4. a deterministic version-2 exact-decimal calculator engine with canonical receipts and contract hashes; and
5. exact, case-sensitive Dataforce Job ID and App ID bindings with immutable server-generated comparison receipts and insert-time approval guards.

## Milestone 33 owning workflow and files

- Portal and dark workspaces: `src/components/CreditexCompliancePortal.tsx`, `src/components/CreditexVeuPilotWorkspace.tsx`, `src/components/CreditexOperationsWorkspace.module.css`, `src/components/CreditexEvidencePolicyGovernance.module.css` and `src/components/CreditexVeuJobAuditWorkspace.module.css`.
- Source and lookup approval: `src/lib/creditex-source-lookup-review-server.ts` and the protected official-source and lookup review routes.
- Field custody: `src/lib/creditex-field-custody-acceptance-server.ts` and its protected API route.
- Calculator: `src/lib/creditex-calculator-engine.ts`.
- Dataforce parallel operation: `src/lib/creditex-parallel-reconciliation-server.ts` and `src/app/api/creditex/parallel-reconciliation/route.ts`.
- Schema: `db/schema.ts`, `src/lib/creditex-schema-guards.ts` and migrations `0106` through `0108`.

## Milestone 33 safety boundaries

- Approval is append-only and requires a governance identity distinct from the retained-source or tester identity.
- Withdrawing the latest approval blocks subsequent activity use, lookup materialisation and calculator execution; insert-time guards close the approval-withdrawal race.
- Physical-custody acceptance proves only the exact tester artifact reviewed. It does not generalise to an untested device, operating system, offline path or field activity.
- Calculator receipts are deterministic and immutable, but no official VEU formula has yet been independently approved for certificate estimation.
- Dataforce reconciliation is non-evidentiary and exact-reference bound. It cannot create a certificate, regulator submission, trade or settlement.
- Runabout and registry interfaces remain unconnected, and real regulated work remains disabled.

## Milestone 33 validation and release evidence

- Exact application commit `11b06b88d68609a9fcf254877a4afe379a95f8b3` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,244 main tests with 1,242 passed, 2 intentionally skipped and 0 failed, all 109 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The integrated Creditex suite passed 110 of 110 tests; the UI suite passed 40 of 40. Independent security review approved the source, lookup, custody, calculator and Dataforce boundaries with no P1, P2 or P3 blocker. Independent UI review passed the corrected contrast and compact-control gates.
- Local archive `.openai/site-release-11b06b8.tar.gz` is 7,544,418 bytes with SHA-256 `E0F5B94C49CCA3776F3CEE2734C076F33F2E59324A301A211A7F55A6B94BACE4`, 358 archive entries and all 109 migrations.
- Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_f2d304f9c9b481919b8d9588f0ef034f` reports exact source `11b06b88d68609a9fcf254877a4afe379a95f8b3`, 344 stored files, 30,412,800 stored bytes and content hash `sha256:60ede71e262e365ed8aa39fced47e8a550623266d6636ef8c326a821efdadb3c`.
- Deployment `appgdep_6a6edfb2b8e08191b295825c3db65d4d` succeeded as Sites version 262 with environment revision 19.
- Signed-in production QA confirmed all three primary tabs at the same 52.7-pixel top position, all seven pilot tabs at the same 142.7-pixel top position, a working all-field technician-code search returning 10 of 300 jobs, 28-pixel Density/Search/Filters/Refresh controls, compact right-edge filtering, outside-click sort dismissal and the dark double-click audit workspace.
- The audit main pane and compliance rail exposed independent vertical scrolling. Recent Worker logs contained no Creditex failure; the only error in the review window was an unrelated existing `/api/trade-job-notifications` HTTP 500 from the Direct Trade dashboard.

## Milestone 33 important limits and unverified areas

- Exact current VEU source bytes have not yet been retained in TLink R2 and independently approved through the new bridge.
- Authorised participant, product, licence, recall and suspension snapshots have not yet been imported and approved.
- Physical iOS, Android, offline, upload-recovery and R2-restore acceptance remain incomplete.
- Approved official formulas and authoritative golden vectors remain 0.
- Runabout and registry sandbox contracts remain unavailable, and routine Creditex use still requires named individual MFA accounts rather than the shared bootstrap administrator.

## Prior released milestone 32 outcome

Creditex now has the controlled post-acceptance intake foundations needed to receive an installer job, stage legacy Dataforce records, retain official-source and evidence bytes, review effective-dated operational facts and compare external references without claiming a real certificate outcome. Government and regulators remain the sole rule authority; Creditex administers, audits and submits within those rules.

The released operator workflow provides:

- a dark, full-viewport job register with table-owned scrolling and a compact right-edge advanced-search drawer;
- installer and VEU activity filtering only inside advanced search, with the fixed bottom activity-family rail removed;
- heading menus that close after sort selection, outside pointer action or Escape and restore focus;
- one exact 23-column Dataforce interchange contract for filtered CSV export and stage-only CSV import;
- UTF-8 BOM, CRLF and spreadsheet-formula-safe exports, with a 20,000 matching-row export ceiling;
- exact-header, 5 MiB and 2,500-row import limits, duplicate detection and no silent coercion;
- a governed post-quote-acceptance installer intake with dependent Program, Activity, Product category and Scenario selectors;
- immutable accepted-scope hashes derived from the accepted commercial handoff at the application boundary;
- manual official-source byte custody in R2 with asserted government URL, SHA-256, pending-review state and no automatic activation;
- evidence-object integrity receipts, effective-dated staged lookup snapshots and non-evidentiary external-reference comparisons; and
- fail-closed schema preflight before the trigger installation that protects synthetic and regulated records.

The supplied private Dataforce export remained local. It proved an exact 23-header, 849-row, zero-rejection, zero-duplicate and exact cell-preserving round trip with SHA-256 `22470CED083B3BAA4571108E34B5F91BD89154AD8381B54B693B3F9BDEF9BF31`; it was not uploaded, committed, packaged or published.

## Milestone 32 owning workflow and files

- Register and interaction: `src/components/CreditexVeuPilotWorkspace.tsx` and `src/components/CreditexVeuPilotWorkspace.module.css`.
- Dataforce interchange: `src/lib/creditex-dataforce-job-csv.ts`, `src/lib/creditex-dataforce-import-server.ts` and `src/app/api/creditex/dataforce/route.ts`.
- Post-acceptance intake: `src/components/TradeComplianceIntake.tsx`, `src/lib/trade-commercial-handoff.ts`, `src/lib/trade-commercial-handoff-server.ts`, `src/lib/creditex-compliance-server.ts` and `src/app/api/trade-compliance/route.ts`.
- Source, evidence, lookup and comparison foundations: `src/lib/creditex-official-source-custody-server.ts`, `src/lib/creditex-evidence-integrity-server.ts`, `src/lib/creditex-operational-lookup-server.ts` and `src/lib/creditex-parallel-reconciliation-server.ts`.
- Schema: `db/schema.ts`, migrations `0100` through `0105`, and `src/lib/creditex-schema-guards.ts`.
- Sites migration packaging and audit: `build/sites-vite-plugin.ts` and `scripts/audit-sites-server-bundle.mjs`.

## Milestone 32 safety boundaries

- CSV import is stage-only. It cannot create or mutate a customer, job, regulated case, certificate, registry submission, trade or settlement.
- Manual official-source custody stores asserted provenance and bytes as pending review; it does not establish that the source is current, official or approved.
- R2 evidence receipts prove stored-object integrity only. They do not prove physical capture, device provenance, GPS truth or activity compliance.
- Operational lookups are staged and effective-dated but the authorised government adapters and approval mappings are not connected.
- The accepted-scope hash is application-derived and is not yet enforced by a database constraint.
- One active compliance case per work order remains enforced, so a combined VEU and STC claim cannot yet be represented.
- Parallel references are caller-supplied and non-evidentiary until they are bound to immutable legacy imports and authorised registry responses.
- External certificate creation, registry submission, trading and settlement remain disabled.

## Milestone 32 live production evidence

- Signed-in production opened as `AEA Creditex administrator · Admin` and rendered all 300 isolated synthetic jobs.
- Live D1 exposed 202 application tables. `compliance_cases` exposed 21 columns including `commercial_handoff_id`, `accepted_quote_version_id` and `accepted_scope_sha256`.
- The dark full-screen register, narrow advanced-search drawer, one installer selector, one activity selector, absent bottom activity rail and closed-after-sort heading menus were visually verified.
- The Lookups and Evidence panels own their vertical scrolling; the Evidence panel reported a 895-pixel viewport and 913-pixel scroll extent with `overflow-y: auto`.
- A live filtered export produced 300 rows and the exact 23 Dataforce headers with zero formula-leading cells; SHA-256 `E1399F3F3146C8AF361FC1E59DD094CB2704F7ABC5F4D6C11B757D8F11F9E2CC`, 167,159 bytes.
- The Sites worker error-only query after deployment returned zero events.

## Milestone 32 validation and release evidence

- Exact primary application commit `c423f3c3938b43bf92c8ec98d285b49e63024ee6` passed the complete release gate and was saved as Sites version 260.
- Version 260 deployment `appgdep_6a6eb18712108191ab4ebab327e75df7` technically succeeded but was operationally blocked because the package omitted migrations `0100` through `0105`. The session request entered the unpreflighted guard batch; D1 rejected a trigger that referenced a missing table and rolled back the batch, so no new schema triggers persisted.
- Corrective commit `d441d41cad4d5299a882e73ea006a963fa360cf4` packages and audits all 106 migrations and preflights the new Creditex schema before any trigger batch.
- `npm.cmd run validate` passed type checking, warning-free lint, 31 of 31 integration tests, the complete 1,220-test main suite with 1,218 passed and 2 intentionally skipped, all 106 migrations through `0105_creditex_parallel_reconciliation.sql`, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The focused compliance suite passed 62 of 62 tests. `git diff --check` passed. Independent review reported no P0 or P1 defect.
- Local archive `.openai/site-release-d441d41.tar.gz` is 7,511,787 bytes with SHA-256 `FFBDCAFEA54E7FF72AD1E8E19B0983193E8C554583E3248129CD5E9FEAAE8CB1`, 355 archive entries and all 106 migrations.
- Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_138b4cc8cf988191a4f3e4be4404a6d6` reports exact source `d441d41cad4d5299a882e73ea006a963fa360cf4`, 341 stored files, 30,177,280 stored bytes and content hash `sha256:9b6fd4e639695ea43eb2623fb495b680c6130e7d1539abb3c645b0291898c2b1`.
- Sites version 261 deployment `appgdep_6a6eb97d1978819180b729e922f33971` succeeded with environment revision 19.

## Milestone 32 important limits and unverified areas

- The real governed inventory is still 0. No activity, evidence policy, calculator or regulated case is approved for live use.
- The schema preflight proves required objects and columns exist but does not fingerprint every index, trigger or CHECK definition; partial schema drift remains a P2 risk.
- Exact authorised source approval, operational government adapters, physical AEA Field custody, an independently approved calculator, immutable legacy-import binding and an authorised registry sandbox remain incomplete.
- Routine Creditex use still requires named individual accounts, least privilege and MFA rather than the shared bootstrap administrator.

## Prior milestone 31 outcome

Creditex now has a more readable and compact full-viewport VEU operator workspace while preserving TLink's owner scope, private-data controls and fail-closed government compliance boundaries. The controlled dataset remains 10 synthetic installer companies, 30 assignment-only field technicians and 300 synthetic jobs across all 34 represented VEU activity families.

The released operator workflow provides:

- one readable 12-pixel compact table row per job, 49 data columns plus one action column, 41 verified server-sortable fields and one controlled menu on every heading;
- table-owned vertical and horizontal scrolling without page-level desktop overflow;
- compact and comfortable density controls;
- a 19-rem advanced-search drawer with Job, installer, VEU activity, review state and evidence state together as quick filters;
- secondary advanced-search groups collapsed initially, with the former installer roster removed from the bottom of the workspace;
- column menus that close after sorting, outside pointer action or Escape and return focus to their heading;
- Dashboard plus all 34 VEU activity-family tabs along the bottom;
- Dataforce-style Customer Details, Job and Appointment context menus from right click, the row action control or keyboard;
- Job Summary, Appointments, Actions, Questions, Quote and Invoice, Calculations, Transactions, Files, Issues, Emails and History routes;
- Appointment Summary, Actions, Questions, Certificate Submissions, Decommissioning, Correspondence, Audit and History routes;
- Copy Row, truthful disabled Copy Selection, Print and Print Preview actions;
- a full-viewport double-click record workspace with collapsible navigation and compliance rails;
- owner-scoped customer, private notes, service address, installer account, technician, work, appointment, job, source, lookup, evidence, calculator, connector and audit facts;
- media presence, metadata, GPS and original-hash indicators derived only from bounded authoritative evidence facts; and
- job-level regulated-case, compliance-evidence and submission-item counts rather than run-level substitutes.

Part `6` remains one official VEU family among many. Categories and scenarios remain separate governed dimensions. `6(23)` was only an informal example and has no privileged implementation path.

The official source register now records Victorian Energy Upgrades Specifications version 25 as effective from 21 July 2026, keeps version 24 as superseded comparison material and records both Part 6 branches in version 25. It does not treat 30 September 2026 as a separate instrument. Government and regulator sources remain the only rule authority.

The installer-dashboard integration is currently a proposed post-quote-acceptance handoff, not released runtime behavior. TLink will derive accepted job, site, jurisdiction, date and scope facts server-side, then expose controlled Program, Activity, Product category and Scenario choices tied to an effective source version. One active case per work order and the zero-program fail-closed state are mandatory boundaries.

## Prior milestone 31 owning workflow and files

- Schema and migration: `db/schema.ts`, `drizzle/0099_creditex_synthetic_pilot.sql` and `src/lib/creditex-schema-guards.ts`.
- Pilot contracts and server: `src/lib/creditex-veu-pilot-contract.ts`, `src/lib/creditex-veu-pilot-server.ts` and `src/app/api/creditex/pilot/route.ts`.
- Register and drawer: `src/components/CreditexVeuPilotWorkspace.tsx` and `src/components/CreditexVeuPilotWorkspace.module.css`.
- Full record workspace: `src/components/CreditexVeuJobAuditWorkspace.tsx` and `src/components/CreditexVeuJobAuditWorkspace.module.css`.
- Portal: `src/components/CreditexCompliancePortal.tsx`.
- Government-source reference: `src/lib/australian-government-program-catalogue.ts`.
- Official-source register: `docs/compliance/AUSTRALIAN_PROGRAM_SOURCE_REGISTER.md`.
- Proposed installer handoff contract: `docs/compliance/CREDITEX_OPERATING_MODEL.md`.
- Tests: `test/creditex-veu-pilot.test.mjs`, the Creditex portal and operations suites, and the Australian programme catalogue suite.

## Prior milestone 31 safety boundaries

- All pilot companies, technicians, customers, sites, appointments and jobs are visibly synthetic and isolated from regulated workflow.
- Same-origin Firebase identity and active Creditex membership checks precede every dashboard and record read.
- Job detail requires an active organisation-owned synthetic run, a synthetic trade account, an assignment-only technician and an active owner-scoped synthetic work order.
- Private customer, installer and service-site data is loaded only after the scoped job identity is established.
- Raw evidence envelopes, storage keys and direct file bytes are not returned to the operator workspace.
- Audit writes require a successfully matched authoritative detail response and an allowed role.
- The pilot creates no regulated case, certificate, submission, trade or settlement.
- External submission, forced compliance, Dataforce import and Runabout import remain disabled.

## Prior milestone 31 production evidence

- Signed-in production QA at 2048 by 927 pixels loaded the complete 300-job queue with no page-level overflow and a readable 12-pixel table type size.
- The advanced drawer measured 303.2 pixels, exposed Job, installer, VEU activity, review state and evidence state as quick filters, and started with every secondary group collapsed.
- Installer `I01` returned 30 matching jobs. Combining installer `I01` with Part `6` returned one matching job, and clearing filters restored 300 jobs.
- The workspace contained exactly one installer selector and one VEU activity selector. The former installer roster was absent, while Dashboard plus all 34 activity-family tabs remained.
- The Job ID column menu closed on outside pointer action, Escape and a selected sort action. Escape and sort selection restored focus to the originating heading.
- The final version-259 drawer showed `All VEU jobs` without the crowded count badge.

## Prior milestone 31 validation and release evidence

- Exact application commit `19a1e0b98db0cb7be5eae9e9e1371251220e8fc1` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, the complete main suite, all 100 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The focused Creditex pilot suite passed 15 of 15 tests. `git diff --check` passed.
- Independent final review reported no P0 or P1 defect.
- Primary application commit `96ecb9698943445c57ba7f4caec99ff3839d3499` became intermediate Sites version 258 through deployment `appgdep_6a6e507b745881919113bda7403f8081`.
- Final local archive `.openai/site-release-19a1e0b.tar.gz` is 6,894,158 bytes with SHA-256 `605BEE1AC610C7D4F82BD9CEBD5C2706B55BFB7F73B2640D1D5FBB6F041B21FF`.
- Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_195313bad4888191a7b5472c6b215cc5` reports exact source `19a1e0b98db0cb7be5eae9e9e1371251220e8fc1`, 178 stored files, 18,780,160 stored bytes and content hash `sha256:81e8a258e445954acf669266c31c6fd7141d591925ff30148b6f70c4118172e9`.
- Sites version 259 deployment `appgdep_6a6e5248b7048191acfe5904b1d4628b` succeeded with environment revision 19.

## Prior milestone 31 limits and unverified areas

- Exact authorised VEU source bytes, hashes, effective periods, the Version 24 to 25 clause diff and current accredited-provider portal artefacts are not yet retained and independently approved inside TLink.
- The post-acceptance installer handoff is a documented contract only. It is not active runtime behavior while the governed programme inventory remains empty.
- Live participant, accreditation, licence, product, recall and suspension sources are not connected.
- Physical-device evidence capture, original-byte restoration, offline recovery, GPS and metadata custody are not yet proven for a selected real activity.
- Verified formulas and approved golden vectors remain 0. No VEEC quantity or rebate is calculated.
- Registry, Dataforce and Runabout connectors remain dry-run or disabled. No external request was sent.
- The shared `info@ausenergyassessments.com` account remains a bootstrap administrator. Routine Creditex operations require named individual users and least privilege.
- The two bounded job-detail reads are not one D1 snapshot. This is acceptable for the immutable synthetic pilot, but regulated cutover needs an explicit consistency contract.

## Stop conditions

Stop before any regulated-case onboarding when:

- an exact current instrument and its effective dates are not retained and independently verified;
- an activity category and scenario combination is inferred rather than sourced;
- an authorisation, tenant-isolation or synthetic-leakage guard fails;
- original photo bytes, hashes, capture time, timezone, device provenance, location accuracy and controlled metadata cannot be retained together;
- a calculator would use unverified equations, tables, units, caps or rounding;
- a connector would assert a regulator response without an authorised request and immutable response artifact; or
- D1 and R2 ownership, backup, export, recovery and restore remain unproved for regulated evidence.

## Superseded next-five sequence before milestone 32

1. **Retain and independently approve the exact VEU source pack:** retain the authorised bytes, hashes, effective periods, Version 24 to 25 clause diff, Part 6 branch-trigger semantics and current accredited-provider portal artefacts before publishing any governed activity.
2. **Implement the direct-trade post-acceptance handoff:** remove compliance selection from initial job setup, derive accepted job facts server-side, add the controlled installer panel and enforce one active case per work order while the zero-program state remains fail-closed.
3. **Connect authoritative operational lookups:** add effective-dated participant, product, licence, recall and suspension snapshots with source timestamps and fail-closed rechecks.
4. **Prove AEA Field evidence custody:** complete real-device iOS, Android, offline, original-byte, metadata, GPS and R2 restore evidence for one independently approved activity.
5. **Run one verified end-to-end parallel activity:** reconcile an independently approved calculator, golden vectors, authorised Dataforce and Runabout mappings and a registry sandbox or approved interface without touching real certificate inventory.

## Superseded next-five sequence after milestone 35

1. **Retain and approve the exact current rule packs:** store the exact VEU v24/v25, SRES law and register, and NSW ESS/PDRS source bytes in R2 with SHA-256, effective dates, supersession links and named independent approvals.
2. **Replace manual inputs with official effective-dated lookups:** import participant, product, licence, recall, suspension, postcode-zone and model-register snapshots so supported installer choices become authoritative dropdowns.
3. **Implement reviewed VEU and NSW calculation drafts:** transcribe VEU, ESS and PDRS formulas with premises-history and cross-claim eligibility, deterministic receipts and regulator-oracle golden-vector reconciliation while keeping activation independently gated.
4. **Build authorised submission interchange:** implement TESSA CSV v1.7 import, export and preflight, then obtain the current ESC VEU API pack or sandbox and REC Registry bulk-upload contract before enabling controlled adapters.
5. **Connect installer cases to field evidence custody:** bind post-acceptance job creation to the selected program and activity, generate its evidence template, and complete named iOS, Android, offline, GPS, EXIF, upload-recovery and R2-restore acceptance.

## Prior released milestone record: `CUSTOMER-TRADE-LOCALITY-24`

Status: released implementation milestone

Released application commit: `399b04f4a5d680080610f9e88b994506bb60c16f`

Released application: Sites version 242, saved version `appgprj_6a550c378000819185caf094173422bb~appgver_bc9f3157a9e88191881c5989f7de7ba0`, deployment `appgdep_6a6cc08dc6f881919a349de607f5a8a9`

The release keeps installer-request consent and validation beside submission, aligns the shared customer navigation, adds reciprocal TLink and Australian Energy Assessments branding and discloses only a current-consented immutable suburb, postcode and state opportunity snapshot to eligible installers. Migration `0092_trade_opportunity_matching_locality.sql` added the bounded locality and consent-receipt contract. The focused set passed 96 of 96 tests and the complete validation gate passed all 93 migrations through `0092`, the production build and Sites bundle audit. Live verification did not create a new production opportunity, so a version-242 locality-bearing row and business email remain intentionally unverified. This milestone was superseded as the current production identity by the Creditex foundation, the signed-in Creditex operations portal in version 248, the evidence-policy governance system in version 249 and the government-activity workflow in version 251.

## Prior released milestone record: `CUSTOMER-ACCOUNT-TRUST-23`

Status: released implementation milestone

Prepared: 31 July 2026

Released application commit: `da4fa911c0b6c7f520e266259af8882b95aaf14a`

Released application for this milestone: Sites version 241 from application commit `da4fa911c0b6c7f520e266259af8882b95aaf14a`

## Current milestone outcome

Make the remaining household ventilation questions answerable without technical building knowledge, make the email account form visibly usable, and make the Firebase customer-verification return refresh the trusted account identity instead of relying on a stale token.

## Customer and trade outcomes

- Public `/plan` and the signed-in project builder now ask the same plain question: whether a kitchen exhaust fan or rangehood and a bathroom exhaust fan are fitted.
- The choices are kitchen, bathroom, no kitchen or bathroom fan, and `Not sure`. The household is explicitly told that it does not need to know where a fan vents or whether it has a shutter or damper.
- Legacy discharge and damper answers are retained only as a conservative `Not sure` migration when no newer explicit fan answer exists.
- Technical discharge-path confirmation is deferred to a property manager or suitably qualified trade only when moisture, steam or smells do not clear.
- Every email-account input, including the password, is a visible full-width control with a persistent eight-character requirement.
- Create-account and sign-in choices are equal-width responsive tabs with a clear selected state, hover and keyboard focus treatment.
- Customer verification uses Firebase's hosted action handler with an authorised current-origin return to `/account?verification=complete`.
- On return, focus or visibility refresh, the customer identity is reloaded and a fresh ID token is obtained before a verified state is trusted.
- Verification-send failure is reported as failure instead of being silently represented as successful delivery.
- Existing trade signup and verification behavior was not changed by this customer-only milestone.

## Integrity and communication design

- One shared home-feature taxonomy drives the public and private planners, evidence readiness, report projection and deterministic advice.
- The simplified question records only what an ordinary household can safely see. It does not imply that fan discharge or airtightness has been checked.
- Legacy technical answers are never guessed into a specific modern fan selection.
- Firebase remains the verification-code processor. The application supplies the bounded return URL, then refreshes provider state and the token before server-backed account data is trusted.
- Account status messages distinguish information, success and error and keep field errors associated with the relevant control.
- The customer helper is imported only by the customer account panel and dashboard. The trade signup source content remains identical to the prior release.

## Acceptance and release evidence

- Exact application commit `da4fa911c0b6c7f520e266259af8882b95aaf14a` passed the complete release gate.
- The integrated focused customer taxonomy, decision-support, account UI and verification set passed 72 of 72 tests. Independent account and verification review passed 18 of 18 tests, trade-isolation review passed 25 of 25 tests, and type checking passed.
- `npm.cmd run validate` passed, including type checking, warning-free lint, the integration and full test suites, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the nine-page customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- `git diff --check` passed. An independent final read-only review reported no actionable defect.
- GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA.
- Sites version 241 was saved directly from the exact managed source commit and deployed publicly. No local release archive was uploaded or supplied for this release, so archive size, archive hash, stored-file count, stored bytes and package content hash are not claimed.
- Live public production verification confirmed the simple fan question and absence of customer-facing discharge-path and damper questions.
- Live account-entry verification measured a visible 364 by 48 pixel password control and equal 175 by 46 pixel tabs at the desktop viewport, with no horizontal overflow.
- The live `/account?verification=complete` route rendered the customer account entry rather than an application route error.
- Local 390 by 844 visual inspection confirmed responsive tab and password-control layout.
- A new provider email was not sent during release QA, so newly generated email receipt and action-code processing remain unverified.
- The Sites Worker error-only query returned zero events. Release verification made no production data mutation.

## Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Current executable application commit: `da4fa911c0b6c7f520e266259af8882b95aaf14a`
- Sites application version: 241
- Sites saved-version identity: `appgprj_6a550c378000819185caf094173422bb~appgver_2149679b0df08191a77cd91ac13d9cc7`
- Sites production deployment: `appgdep_6a6caabc547c81919c4642b1f7cfcde1`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites access: public custom domain
- Sites environment revision: 19
- D1 migration count: 92, through `0091`
- Immutable audit changes: none
- Working-demo data changed during release verification: none

## Known release risk

The shared household taxonomy, account presentation, customer verification settings, trusted-state refresh and live return route passed automated and production presentation checks. Release QA did not create a new account or send a verification email, so provider inbox receipt and a fresh end-to-end email action remain unverified. Existing trade verification debt identified during review is outside this customer-only milestone and was not changed or represented as fixed. No local archive or Sites package metrics were supplied for this source-only save. Production provider inbox receipt and hosted row counts remain unverified.

## Stop conditions

Stop the affected path when:

- public and signed-in planners present different exhaust-fan choices;
- a household is required to know fan discharge, backdraft-damper or self-sealing details;
- a legacy technical answer is guessed into a specific modern household answer;
- the password control is clipped, transparent, too small or not associated with its requirement;
- account tabs do not expose a selected state or become uneven or unusable at a supported viewport;
- a customer verification link returns outside the authorised current site or a verified account is trusted before Firebase identity and token refresh;
- verification-send failure is represented as successful delivery;
- live verification would send to an unapproved recipient or mutate new demo data;
- the release source, saved version and public deployment cannot be reconciled; or
- a change would alter the immutable dated audit.

## Prior released milestone: `CUSTOMER-PLAN-TRADE-ENQUIRY-22`

### Outcome

The prior release added the privacy-first `Enquire with verified trades` bridge, preserved every public planner selection through account entry, added precise gas hot-water and reported electrical-phase choices, and placed authorised customer identity first for connected trade leads. Its technical exhaust-discharge and damper questions are superseded by the plain household fan question in `CUSTOMER-ACCOUNT-TRUST-23`; the enquiry bridge, hot-water, electrical and connected-lead contracts remain active.

### Historical release identity

- Application commit: `b40c101939eec44b178b34ccb6397a989d2467d0`
- Sites version: 240
- Saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_f26581d5ff348191855551ce325e8c40`
- Deployment: `appgdep_6a6c971b63988191a92e4031fc74692b`
- Environment revision: 19

## Prior released milestone: `CUSTOMER-TRADE-CONTACT-21`

### Outcome

The prior release replaced shortlist and quote-acceptance language with one contact-only customer choice, committed the exact one-business contact handover atomically, added owner-scoped new-lead Work updates, collapsed lead cards, aligned quote fields and returned Continue navigation to the active project step. Those privacy, contact and navigation contracts remain active beneath the public-plan enquiry and connected-lead presentation added by the current milestone.

### Historical release identity

- Application commit: `97e6c7356483706e8e978ab53b842a9e41152f7e`
- Sites version: 239
- Saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_ae43b05060ac8191918c70e9960e213c`
- Deployment: `appgdep_6a6c7cb6d6e0819187e9566a452e6850`
- Environment revision: 19
- Local archive: `aea-sites-97e6c73.tar.gz`, 7,127,725 bytes, SHA-256 `BF9EAAE34B1FBB197C30AF94F0ADB9DBE92BBC347F8B60424C6D0444D9FCD7DF`
- Sites package evidence: 321 stored files, 27,985,920 bytes, content hash `sha256:8554bdbdbcc6c54afc9b04cb4d37b96d7ab423ed2ed64d591247bfa3ee6c6136`

Signed-in production verification confirmed three unread new-lead bell items, default-collapsed lead cards, exact expansion, the top-level Quotes centre and contact-only connected state. Production provider inbox receipt and hosted row counts remained unverified.

## Earlier released milestone: `CUSTOMER-QUOTE-COMMS-20`

### Outcome

The prior release added the top-level customer Quotes centre, exact quote deep links, customer and trade quote emails, trade Work updates, retry-safe quote submission and a concurrency-safe one-business claim. Its customer-visible shortlist and acceptance sequence is superseded by `CUSTOMER-TRADE-CONTACT-21`; its durable delivery and immutable quote-submission contracts remain active.

### Historical release identity

- Application commit: `35552796048df63c03409d03401d33a47f326434`
- Sites version: 238
- Saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_c9b4dbcee8408191a3fdce1aaef5548d`
- Deployment: `appgdep_6a6c5f96df388191a5e68ffd53fb68b0`
- Environment revision: 19

The historical release used acceptance wording for its one-business selection. Current customer and trade surfaces use contact-only wording, and the retained internal accepted identifier is compatibility state rather than commercial acceptance.

## Earlier released milestone: `CUSTOMER-INSTALLER-HANDOFF-19`

### Outcome

Make one customer confirmation complete the installer handoff quickly and visibly: save the private request, share the complete privacy-safe plan plus every customer-uploaded photo with each exact allocated installer, and send durable email alerts to both operations and the allocated businesses.

The request must not look frozen while background matching and delivery continue. The customer-facing response must finish after the authoritative request and durable follow-up work are recorded, not after external email providers, administrator webhooks or installer allocation have completed.

### Owning workflow and expected files

- Customer request and durable follow-up: `src/app/api/customer-projects/route.ts`, opportunity allocation helpers, notification delivery helpers, `worker/index.ts` and an additive D1 migration if required.
- Evidence and full plan delivery: `src/app/api/customer-project-evidence/route.ts`, `src/app/api/trade-opportunities/route.ts`, the authoritative customer-plan document and PDF projection, and installer Leads UI.
- Customer progress feedback: the saved-project advisor component and its feature-local styles.
- Tests: focused customer-submit, evidence authorization, plan projection, admin delivery, business delivery, worker and UI contracts.

### In scope

- Treat the final confirmed installer request as explicit consent to share every active photo uploaded to that project with exact allocated installers while the match remains active. Uploaded PDFs and other documents retain their separate explicit sharing choice because their contents cannot be automatically privacy-filtered.
- Reconcile older matching demo projects through the same project-level request consent without manufacturing synthetic production rows.
- Present every shared photo in the lead and provide a protected download for every shared document.
- Present the complete ordered privacy-safe customer plan in the lead and provide its complete installer-safe PDF, not a three-step extract.
- Record durable allocation, operations-email and business-email work before returning success.
- Drain newly recorded work immediately outside the customer response and retain the scheduled worker as the recovery path.
- Send an operations email for every new customer installer request and one business email for each new eligible allocation.
- Keep provider idempotency, bounded retry, bounce and complaint suppression, delivery events and recipient revalidation.
- Show immediate, accessible progress feedback with clear stages, elapsed-time reassurance and a success transition.
- Measure and record the production request duration with a dedicated working-demo fixture only when the live test can avoid real customer or business impact.

### Out of scope

- Releasing customer identity, exact address, contact details, private notes, room names, routines, permission notes, adviser identity or meter data before separate direct-contact approval.
- Changing reviewed-ABN access or the exact allocated-installer authorization boundary.
- Creating real customer, trade, wholesaler or administrator accounts.
- Broad CRM redesign, unrestricted messaging, quoting automation or pilot execution.
- Netlify deployment or changes to the immutable dated audit.

### Acceptance criteria

- Submission returns without awaiting installer allocation, the administrator webhook, Resend or another external provider. Automated timing contracts prove those slow dependencies cannot extend the customer response.
- The confirmation button changes immediately to an accessible multi-stage progress state. A request taking longer than eight seconds explains that it is still working, and success or failure appears inside the same dialog.
- Every active customer-uploaded photo is counted and available to each exact eligible allocation after submission. Documents already explicitly approved for installer sharing remain available, while private documents remain owner-only. Authorization tests deny unrelated, expired, inactive, unreviewed and unallocated installers.
- The installer receives the complete canonical privacy-safe plan in order, including every controlled roadmap step, plus a protected full-plan PDF.
- The plan and evidence projection excludes identity, exact location, contact, private notes, room names and routines, permission notes, adviser identity and review text, customer-written arbitrary items, original evidence filenames and meter data.
- A durable operations email and durable business email are queued automatically after submission. Immediate background draining and scheduled recovery are both covered, provider failures remain observable, and duplicate requests cannot duplicate deliveries.
- Desktop, mobile, keyboard and assistive-status behavior pass focused UI checks.
- The exact application commit passes `npm.cmd run validate`, `npm.cmd run build`, migration replay, Sites bundle audit, `git diff --check`, GitHub reconciliation, Sites save and production deployment.

### Smallest validation set

- Focused evidence, full-plan, notification, allocation, timing and modal-progress tests during implementation.
- Fresh SQLite and Cloudflare D1 migration replay for every additive migration.
- Complete `npm.cmd run validate`, explicit `npm.cmd run build` and `git diff --check`.
- Signed-in production verification of the request dialog and the allocated installer Leads view when a safe working-demo fixture is available.
- Provider delivery ledger and worker error inspection without exposing recipient addresses or message content.

### Acceptance and release evidence

- Exact application commit `059f2ff8d3885b3453dd38d7dee8e660fd05c4fb` records the authoritative customer request and durable operations, allocation and business-email work before returning HTTP `202`.
- The customer response does not await Resend, the administrator webhook or installer allocation. Immediate Worker draining uses `waitUntil`, and the scheduled Worker retains the recovery path.
- Explicit installer-request consent promotes every active project image that existed at the request boundary. Arbitrary PDFs and other documents retain their separate explicit sharing choice.
- The allocated reviewed installer receives every authorised evidence card plus the complete ordered privacy-safe plan, protected preview and protected PDF. Identity, exact location, contact, private notes, routines, permission notes, adviser identity, customer-written arbitrary items, filenames and meter data remain excluded.
- The dialog reports checking, plan save, per-photo upload progress and request dispatch. It adds reassurance after eight seconds, a longer-delay message after 25 seconds, blocks duplicate close or resubmit while busy, and preserves partial upload success.
- Backend-focused dispatch, timing, notification and property-arrival tests pass 32 of 32. The complete non-release-integrity suite passes 941 tests: 939 passed, 2 intentionally skipped and 0 failed.
- Type checking, warning-free lint, all 89 migrations through `0088_customer_opportunity_dispatch_jobs.sql`, the tagged-PDF audit, Vinext production build and Sites server-bundle audit pass. `git diff --check` passes.
- GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA.
- Local archive `aea-sites-059f2ff.tar.gz` is 7,107,950 bytes with SHA-256 `D32307C4B0FABF955FB4CF878CBD31290F053E06BA3CA67A92DBFBED6FD262E4`.
- Sites stored 318 files, 27,873,280 bytes with content hash `sha256:6c489fbaa560f2df5dc6cb9d807d1ae7c1d7b7a752632909bc45bc1f71a9c090`.
- Sites version 236 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_82454487760c8191b1f5338538b8fcb8` and deployed as `appgdep_6a6c3b56a1b881919e82e97eaa286bc4` with environment revision 19.

### Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Current executable application commit: `059f2ff8d3885b3453dd38d7dee8e660fd05c4fb`
- Sites application version: 236
- Sites saved-version identity: `appgprj_6a550c378000819185caf094173422bb~appgver_82454487760c8191b1f5338538b8fcb8`
- Sites production deployment: `appgdep_6a6c3b56a1b881919e82e97eaa286bc4`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites environment revision: 19
- D1 migration count: 89
- Immutable audit changes: none
- Working-demo data changed during release verification: none before the bounded signed-in acceptance check

### Known release risk

Automated privacy, authorization, idempotency, retry, progress, full-plan and complete-evidence contracts pass. Live provider inbox receipt and signed-in production presentation remain acceptance checks until they are exercised with the existing working-demo data. Provider configuration alone is not delivery proof.

### Stop conditions

Stop this milestone when:

- the complete plan or evidence cannot be shared without exposing a prohibited private field;
- a background task cannot be made durable before the customer response;
- the requested email needs a new paid provider, account or unapproved recipient;
- an authorization, tenant or reviewed-ABN test fails;
- a migration would need to rewrite shared history or populate synthetic accounts;
- live testing would affect a real customer, trade or administrator; or
- the release source, archive, saved version and production deployment cannot be reconciled.

## Prior released milestone: `INSTALLER-ENQUIRY-PACK-18`

### Outcome

Application commit `eeba3679c30789cfe2e633a913a18492270fcc3e` established the bounded privacy-safe enquiry pack, consent-gated evidence presentation, exact-allocation evidence authorization, direct Leads notification link and durable business-notification ledger through `0087_trade_opportunity_notifications.sql`. It passed its complete release gate and was deployed as historical Sites version 235 through `appgdep_6a6c0908063081919b2e985a27141e34`.

Those enquiry-pack, protected-evidence and notification-ledger contracts remain active underneath version 236. Milestone 19 supersedes only the first-three-step presentation, partial image-sharing behavior and request-latency boundary.

## Prior released milestone: `CUSTOMER-INSTALLER-SUBMIT-17`

### Outcome

Make the final installer-response confirmation one authoritative action. Exact application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b` passed the complete release gate and was deployed as historical Sites version 234 through `appgdep_6a6bf3695b6081918ce2a9dd77bc3869`. Documentation checkpoint `2b7805d193cfa6ec04858caee0a6715d36fe0b1d` recorded that release before version 235 superseded it.

Those single-transaction contact, project-transition, consent and opportunity-creation contracts remain active underneath version 236.

## Prior released milestone: `CUSTOMER-INSTALLER-PHOTOS-16`

### Outcome

Remove trigger-amplified false conflicts and let each guided photo prompt hold several independent photos. Exact application commit `5acc4ccf37acd608dc437d3a074410b1d840f706` passed the complete release gate and was deployed as historical Sites version 233 through `appgdep_6a6be56ca9ac8191918423bd57f0a05d`. Documentation checkpoint `a0a438271b03936e3972383e5586c2a12caa51aa` recorded that release before version 234 superseded it.

Those multi-photo, private-evidence, trigger-safe change-count and per-photo control contracts remain active underneath version 236.

## Prior released milestone: `CUSTOMER-PLAN-DURABILITY-15`

### Outcome

Make plan completion durable and understandable: keep guided photos visible where customers added them, preserve safe resumable evidence handling, make deletion recoverable, turn plan history into a useful comparison and check-in tool, submit installer requests from one confirmation, and deliver worker-safe accessible PDF and email reports.

Implementation commit `e74278c8b62c569541ea84b5a431917d03a1c13a` completed the product slice. Its first saved Sites version 231 failed before public activation because a private Next Fontkit bundle referenced `__dirname`; version 230 remained live. Corrective child `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` replaced that private boundary with public `@pdf-lib/fontkit`, added a post-build Sites bundle audit and became the executable source for version 232. Documentation checkpoint `2c55430757c316b4045e3edd9a26263a24793f14` recorded that release before version 233 superseded it.

### User outcomes

- A newly selected guided photo immediately shows a local preview, filename and saving state in the exact card where it was added.
- A saved photo stays visible after reload with replace and remove controls; if work choices change, the photo remains visible under a clearly labelled earlier-selection group.
- Guided evidence is not silently duplicated as generic evidence.
- A draft that is being deleted cannot still look active, accept new uploads or open through a stale continue link; recoverable cleanup can be finished from the dashboard.
- Customers can compare two plain-language roadmap versions, download a private-safe comparison, record private before-and-after observations and restore an earlier roadmap only as a new draft version.
- Missing private contact details save and the installer request submits from one confirmation, with one bounded authoritative conflict recovery rather than a second customer step.
- PDF and email delivery retain the premium visual hierarchy, embedded fonts, semantic lists and links. Unsupported scripts receive a clear fail-before-save response rather than corrupted visible text.

### In scope

- In-place pending and saved guided-photo previews, save or upload status, replacement, cancellation and removal.
- Stable capture slots, metadata stripping, resumable multipart private evidence uploads and compare-and-swap retake or removal.
- Retained guided evidence after work choices change, without duplicating generic evidence or supporting PDFs.
- Durable `deleting` state, frozen evidence writes, retryable D1 and R2 cleanup, and deletion-aware dashboard and direct-route behavior.
- Plain-language revision history, two-version comparison, privacy-filtered export, private outcome check-ins and guarded draft-only restore.
- One-confirmation private-profile save and installer request with a single bounded conflict recovery.
- Embedded Liberation Sans, tagged-document foundations, semantic lists and links, WCAG AA small-copy colours and fail-before-save unsupported-text handling.
- Public worker-safe `@pdf-lib/fontkit` plus a production bundle guard against `__dirname` and the private Next Fontkit marker.
- Migration `0085_customer_evidence_resumable_retake.sql` and the focused evidence, deletion, history, request, email and PDF regressions.

### Out of scope

- The deferred household and experienced-assessor field pilot.
- Real Gmail or Outlook desktop delivery acceptance and independent assistive-technology or PDF/UA conformance.
- Customer-visible crop, blur, redaction or annotation.
- Restoring a browser `File` object after a full reload without customer reselection.
- Rendering CJK, Arabic, Devanagari, Vietnamese or other scripts not covered by the current embedded fonts.
- Editable revision names or private revision notes.
- New provider configuration, live installer-request submission or mutation of working-demo evidence during release verification.
- The five forward product steps recorded below.
- Changes to the immutable dated audit or a Netlify deployment.

### Privacy and safety boundaries

- Evidence remains same-origin authenticated, owner scoped, private by default and unavailable to installers unless the customer explicitly marks it for the existing allocated-installer sharing boundary.
- Image metadata is stripped before durable storage; uploads remain bounded to 12 files of 8 MB and expired sessions cannot revive a deleted or deleting project.
- Retake and removal require the exact observed evidence revision so a stale browser cannot overwrite a newer file.
- Deletion freezes new evidence writes before cleanup and never treats a partially cleaned project as active again.
- Comparison exports exclude exact address, room names, evidence filenames, private notes and custom roadmap wording.
- Restoring a roadmap cannot replace project identity, private notes, evidence, quotes, installer activity or contact-release state.
- Contact details remain private platform data until the customer separately approves a named installer handover.
- A PDF with unsupported text fails before save and does not emit replacement characters or a partially corrupted document.

### Acceptance criteria

- Pending, saved and earlier-selection guided photos remain visible in the matching guided-photo section with accurate state and controls.
- Resumable sessions, stable capture slots, stale-revision rejection and deleting-project upload denial pass focused server and UI regressions.
- Deleting projects stay excluded from active totals, recommendations, continue links and editable detail routes until cleanup finishes.
- Version comparison, export, private check-ins and restore preserve all excluded private and installer state.
- Profile save and request submission use one confirmation and one bounded authoritative conflict recovery without replaying project, evidence or request writes.
- Focused PDF and email correction tests pass 18 of 18; type checking, warning-free lint, 31 integration tests, 914 total tests with 912 passed and 2 intentionally skipped, all 86 migrations, the Vinext production build, bundle audit and diff hygiene pass.
- Every page of the nine-page tagged-PDF audit is visually clean and contains no clipping, overlap, missing glyph, harsh corner or footer defect.
- GitHub, Sites managed source, saved version 232 and the public deployment resolve to exact corrective application commit `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`.
- Live signed-in inspection loads the saved roadmap, comparison and check-in UI and shows a selected working-demo photo directly beneath its matching guided prompt without mutating it.

### Stop conditions

Stop the affected path when:

- an evidence write could cross owners, bypass the private default, exceed the upload limits, retain unsafe metadata or resume after deletion starts;
- a stale retake, removal, deletion cleanup, profile update or request could overwrite newer state;
- deleting a draft could expose it as active, silently abandon private objects or allow a normal edit route;
- a comparison export or restore could include or overwrite excluded private or installer state;
- an unsupported script could produce corrupted or partially saved customer output;
- a generated Sites server bundle contains `__dirname` or the private Next Fontkit marker;
- live verification would replace or remove a working-demo photo, save profile data or submit an installer request;
- the release commit, GitHub branch, Sites source, archive, saved version and deployment do not reconcile;
- the immutable audit would change; or
- a legal, privacy, regulated-service or account-ownership decision requires an authorised human.

### Release evidence

The exact application source passed:

```powershell
node --test test/customer-plan-pdf.test.mjs
npm.cmd run audit:sites-server-bundle
npm.cmd run validate
git diff --check
```

Observed results:

- implementation commit: `e74278c8b62c569541ea84b5a431917d03a1c13a`;
- failed non-live Sites version 231: saved identity `appgprj_6a550c378000819185caf094173422bb~appgver_7a589f567528819189cf033456193bda`, deployment `appgdep_6a6bcf5c0f7c8191b877d27581f9d82e`, failure `__dirname is not defined`; it never became public and version 230 remained live;
- corrective executable application at that release: `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`;
- focused PDF and email correction set: 18 of 18 passed;
- integration suite: 31 of 31 passed;
- complete test suite: 914 total, 912 passed, 2 intentionally skipped and 0 failed;
- type checking and warning-free lint: passed;
- migration verification: all 86 migrations through `0085_customer_evidence_resumable_retake.sql` passed against fresh SQLite and Cloudflare D1 paths;
- PDF audit: nine visually clean pages, tagged-document foundation present, document format `2026-07-31-tagged-plan-pdf-v6`, unsupported scripts fail before save;
- Vinext production build, the Sites bundle audit and `git diff --check`: passed with no `__dirname` or private Next Fontkit marker;
- GitHub `main`, the working branch and Sites managed `main`: exact application SHA `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`;
- local release archive: `aea-sites-7e1f0a8.tar.gz`, 7,085,796 bytes, SHA-256 `9555352A7F723A615F2D97E2BFEE736DCD6D491C4189B5E100D179D7CB121974`;
- Sites stored archive: 311 files, 27,760,640 bytes, content hash `sha256:e48b4226de4114a1c68ab45ed29021778470a3333b477a44131f07b080e5f2f0`;
- Sites application version 232: saved identity `appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8`, production deployment `appgdep_6a6bd28a71888191be19f89db9b82ca5`, environment revision 19;
- live signed-in inspection loaded the saved roadmap, two-version comparison, privacy-filtered export action and private check-in UI;
- a selected working-demo photo remained visibly named with `Added privately to this draft` in its matching guided card; and
- no working-demo photo, project, profile or installer request was saved, replaced, removed or submitted. The post-deployment Sites Worker error-only query returned zero events.

### Released implementation state at version 232

- GitHub branch: `codex/sites-custom-domain-migration`
- Implementation commit: `e74278c8b62c569541ea84b5a431917d03a1c13a`
- Corrective application commit at release: `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`
- Sites application version: 232
- Sites saved-version identity: `appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8`
- Sites production deployment: `appgdep_6a6bd28a71888191be19f89db9b82ca5`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites environment revision: 19
- D1 migration count: 86
- Immutable audit changes: none
- Working-demo data changed during live verification: none

### Known release risk at version 232

The last recorded exact production-only `npm audit --omit=dev` result reports six existing advisories: one low and five high. The package installation used for the worker-safe Fontkit correction reported 23 advisories across the full development tree, but no automatic audit fix was run and that broad count is not substituted for a fresh production-only audit. Dependency remediation remains a separate bounded patch with the complete validation and live-release gates.

## Prior released milestone: `CUSTOMER-INSTALLER-REQUEST-14`

The prior release established explicit completed-stage styling and the focused private installer-request dialog with protected recovery. Its exact application commit was `2607cc53f2e4c79546701e29d3d182fde4670952`, deployed as Sites version 230 through deployment `appgdep_6a6b5469c8bc81919f0e2c9ef22da602`. Documentation baseline `8a3a38c2e68de30f77720be0800acf6119fb32f0` recorded that checkpoint. Those contracts remain active underneath version 236.

## Prior released milestone: `CUSTOMER-ROADMAP-CONTEXT-13`

The prior release established the authoritative pre-roadmap home and work context, goal-derived priorities, `What shaped this roadmap` summary and non-duplicated quote-preparation stage. Its exact application commit was `0db488f325a79e22d126aace75647715b59c96f9`, deployed as Sites version 229 through deployment `appgdep_6a6b38fcccbc8191b8b2daedf57b9e24`. Documentation-only child `f4dbde8b742ece96e44f5a941f26bc712b0f82f8` recorded that checkpoint without changing the executable application. Those contracts remain active underneath version 236.

## Earlier released milestone: `CUSTOMER-PROJECT-CLEANUP-12`

The earlier release established compact project controls and guarded permanent deletion for unused private drafts. Its exact application commit was `da35ce60295d6c7150cddd9b35e33fcf64c8521b`, deployed as Sites version 227 through deployment `appgdep_6a6b22db21c48191a2dedbdbf05274ef`. Documentation-only child `563a4d805d9c6443096d5c73317ec18fc56f041e` recorded that checkpoint without changing the executable application. Those controls remain active underneath version 236.

## Earlier released milestone: `CUSTOMER-PLAN-TRUST-11`

The earlier release established the shared premium preview, duplicated bottom actions, guided private photos, bounded revision compare and restore through `0084_customer_plan_revision_restore.sql`, tagged-PDF foundations through format `2026-07-30-tagged-plan-pdf-v3` and adaptive email compatibility. Its exact application commit was `bc427d295b3106907904a3c0b7bf9f2945561cd1`, deployed as Sites version 224 through deployment `appgdep_6a6b151c0178819185e4d57c1cbf75c2`. Documentation-only child `23594c2b61dec855aeba0a10ba5a28eb3aeaf692` was later published as historical Sites version 225 without changing that executable application. Those contracts remain active underneath version 236.

## Earlier released milestone: `CUSTOMER-PLAN-SPACING-10`

The earlier release established consistent spacing and rounded surfaces throughout the premium PDF and email. Its exact application commit was `e74c2d95889a381cb3bb434607bc6584e54cf722`, deployed as Sites version 222 through deployment `appgdep_6a6a8887a0048191b7eb1706e742ad28`. Documentation-only child `c2599eb5bedb11b1648da2b4a60e11b242cb2abb` was later published as historical Sites version 223 without changing the executable application. Those visual contracts remain active underneath version 236.

## Earlier released milestone: `CUSTOMER-PLAN-TECH-PRESENTATION-09`

The earlier release established the exact-brand technical presentation, truthful completed-plan signals and single household or professional evidence boundary. Its exact application commit was `f401575a5bf463b85c7688424db0b99dddd220c5`, first deployed as Sites version 220 through deployment `appgdep_6a6a265a51108191bdc8ae6a4eefbf8f`. Those contracts remain active underneath the later spacing and trust releases.

## Earlier released milestone: `CUSTOMER-PLAN-PREMIUM-REPORT-08`

The earlier release established the shared premium PDF, responsive email HTML and plain-text hierarchy while retaining the reliable non-mutating native attachment path. Its exact application commit was `fb6cacf8b0309a3fc26b40a43da5b025050d22d2`, first deployed as Sites version 218 through deployment `appgdep_6a6a11c02e088191bb27cc302c8b35af`. Documentation-only child `a92e18b9ea79b53eaf6eda8665f37ec02c861972` was recorded as historical Sites version 219 without changing that executable application. The shared report projection and privacy boundaries remain active underneath the later technical presentation and spacing releases.

## Earlier released milestone: `CUSTOMER-PLAN-NATIVE-PDF-07`

The prior release established the reliable non-mutating browser-native PDF attachment path. Its exact application commit was `8cdec99bcd2d1cb9f2ec0dc18c87a71860412642`, first deployed as Sites version 216 through deployment `appgdep_6a69f763e0b08191b6ac8539e0828d84`. Its delivery mechanism remains active underneath the premium report presentation.

## Earlier released milestone: `CUSTOMER-PLAN-DIRECT-PDF-06`

The prior direct-PDF release used a client worker and produced a valid PDF from the public planner. Its exact application commit was `d5c675a5ceffa6e924df033e8cb8b505bb4d6336`, first deployed as Sites version 214 through deployment `appgdep_6a69e79a91548191987f12631559cb1f`. The signed-in action was not exercised during that release and later failed the product-owner operational check: it saved the project and could process or upload pending evidence before generating the PDF, then relied on a delayed hidden-link click. It is superseded by `CUSTOMER-PLAN-NATIVE-PDF-07`.

## Earlier released milestone: `CUSTOMER-PLAN-PRO-PRINT-05`

The prior release added the optional self-declared professional review and bounded everyday-action section. Its exact application commit was `ee75aadfd6800c01b92532b2d376a4a1e33c9d74`, first deployed as Sites version 212 through deployment `appgdep_6a69c4f838bc8191a0e050da219ab4a6`. Its temporary-frame browser-print mitigation passed source-level gates but was superseded after the product owner reproduced a Chrome freeze.

## Earlier released milestone: `CUSTOMER-PLAN-EVIDENCE-04`

The prior release established the shared categorized fourteen-question home-detail taxonomy, explicit `Not sure` handling, private-by-default evidence scope, bounded plan history and one concise privacy-filtered report across email and print. Its exact application commit was `6540ee671e64dbfdf80592283a1954b2ff482355`, first deployed as Sites version 210 through deployment `appgdep_6a695ca742d081918d73196751713f98`.

## Earlier released milestone: `CUSTOMER-PLAN-DECISION-03`

### Milestone outcome

Turn the current household plan into a decision-ready, independently useful document without implying a site assessment, authenticated assessor review or savings guarantee.

The milestone completes the four post-context product priorities:

1. explain why each controlled plan item appears, what remains unknown and what could change its position;
2. show no more than three safe, material next questions, with `Not sure` always valid;
3. add a private customer-owned review worksheet that clearly labels feedback as `Recorded by you`; and
4. produce one privacy-filtered independent plan brief for accessible preview, email and A4 print or browser PDF.

It also removes the visible product drift reported in the same customer journey:

- reinforce readable project-preparation guide paragraphs on the navy canvas;
- make the draft save-status message readable and announce changes accessibly;
- replace the stale public `/plan` recommendation contract with the current canonical advisor options and generator; and
- provide an accessible email-recipient dialog plus `Print or save PDF` action from the signed-in plan step.

### User outcomes

- A household can understand the controlled evidence behind each recommendation without being shown a false numerical confidence score.
- At most three unanswered questions identify the next information that could materially change safety, permission or plan order.
- A customer can privately record questions, feedback they heard and proposed changes without the system claiming that an assessor authored or verified them.
- Accepting a recorded proposal does not silently change the plan. A customer must explicitly add it as a private plan step.
- A verified signed-in customer can save the exact current draft, enter one confirmed recipient and request one independently useful plan email.
- The email response says `Accepted for delivery`; it does not claim inbox delivery.
- The same privacy-filtered document appears in a high-contrast A4 print view that supports printing or the browser's Save as PDF action.
- The public quick planner uses the same canonical goals, tenure, approval, budget, home-feature and recommendation boundaries as the signed-in advisor.
- Private project labels, exact location, room routines, filenames, account contact data, private notes, customer review text and arbitrary permission text do not enter the independent brief.

### In scope

- Bump the versioned customer plan contract while preserving edited legacy plans through the existing conflict boundary.
- Add bounded, controlled rationale and next-question derivation.
- Extend the existing owner-scoped advisor-profile JSON with at most twenty private review items.
- Keep review kinds, targets and statuses allowlisted and text capped at 500 characters.
- Add a shared privacy-filtered plan-document projection with escaped inline HTML and plain text.
- Add authenticated, owner-scoped email delivery with explicit recipient confirmation, strict single-address validation, idempotency and a fail-closed five-attempt hourly rate limit.
- Reuse the configured email delivery provider. Do not add a new provider or send a release-test email to a real address.
- Add an accessible modal with focus management, Escape close, focus return and live status.
- Add an A4 print surface generated from the same saved plan projection.
- Reconcile the public quick planner and account handoff with the current canonical plan engine.
- Add focused domain, privacy, route, provider, accessibility, responsive and contrast regression tests.

### Out of scope

- The deferred household or experienced-assessor field pilot.
- Remote assessor invitations, authenticated assessor identity, external editing, access tokens or reviewer credentials.
- Professional evidence review, verification or a claim that an attachment has been assessed.
- A formal NatHERS assessment, NatHERS certificate, energy rating, equipment sizing or legal approval.
- Brands, provider ranking, current market prices, savings promises or finance advice.
- A server-side browser or a binary PDF generation dependency. A4 print plus browser Save as PDF is the bounded PDF path.
- Real customer, trade, wholesaler or assessor account creation.
- Installer opportunity, direct-contact, payment or subscription changes.
- Changes to the immutable dated audit.
- Netlify deployment.

### Privacy and safety boundaries

- Guidance and next questions are derived only from controlled inputs and fixed internal guide destinations.
- `Not sure` is useful evidence and never blocks saving or submission.
- Questions must not ask a person to climb a roof, enter a roof space, remove electrical covers, block required ventilation or perform unsafe inspection.
- Review text remains customer-owned private project data. It never enters installer opportunity output, permission packs, email, print or public planner URLs.
- Only the owning active customer can read or write the saved plan used for delivery.
- Email delivery accepts one normalized address, requires a verified account and explicit confirmation, and fails closed when rate-limit storage or provider configuration is unavailable.
- Custom plan text and private plan notes are omitted from the independent brief. The brief reports omitted counts without copying the wording.
- The report is an independent home energy plan prepared from customer selections. It is not a completed site assessment, quote, legal permission decision or savings promise.

### Acceptance criteria

- Every canonical generated plan item has bounded `Based on`, `Still uncertain` and `Could change if` guidance.
- Next questions are deterministic, unique, fixed-destination, safe and capped at three.
- Review-item normalization enforces kinds, targets, statuses, length and count; invalid targets do not create an assessor identity or verification state.
- Submitted-project locking and duplicate-before-revision behaviour remain intact.
- Review text cannot enter installer opportunity, permission-pack or independent-brief output.
- The plan email API rejects missing consent, unverified identity, inactive account, wrong ownership, archived projects, multiple or malformed recipients, oversized bodies, unavailable rate limiting and unavailable provider configuration.
- No automated test or live release check sends an email to a real address.
- The print surface uses the exact saved ordering and controlled current plan content, is keyboard reachable and renders on A4 without the application shell.
- The public `/plan` and signed-in advisor produce the same canonical item sequence for equivalent controlled input.
- Project-preparation paragraphs and the draft status meet readable contrast and mobile layout requirements.
- Focused tests, the full validation gate, all migrations, production build, diff hygiene, source provenance and desktop plus 390 px live checks pass.

### Stop conditions

Stop the affected path when:

- actual remote assessor access or identity is required;
- arbitrary review, project or permission text could escape into installer or shared output;
- an accepted review changes the plan without a second explicit customer action;
- an unsafe question or blocking guess would be introduced;
- legacy edited plan items would be lost during version regeneration;
- provider configuration, rate-limit storage or source provenance cannot be verified;
- a change would create or use a real account for release testing;
- the release commit, GitHub branch, Sites source, archive and saved version do not reconcile;
- a change would alter the immutable dated audit; or
- a legal, privacy, regulated-service or account-ownership decision requires an authorised human.

### Release evidence

The exact application source passed:

```powershell
node --experimental-strip-types --test test/customer-plan-decision-support.test.mjs test/customer-plan-sharing.test.mjs test/customer-advisor-contract.test.mjs test/customer-project-advisor-ui.test.mjs test/customer-project-advisor.test.mjs test/home-energy-plan.test.mjs test/dark-canvas.test.mjs test/direct-trade-enquiry.test.mjs test/service-reminder-delivery.test.mjs test/site-navigation.test.mjs
npm.cmd run validate
npm.cmd test
npm.cmd run test:integration
git diff --check
```

Observed results:

- focused plan, privacy, provider, accessibility and navigation review set: 51 of 51 passed;
- complete suite: 784 tests, 782 passed, 2 intentionally skipped and 0 failed;
- integration suite: 31 of 31 passed;
- type checking: passed;
- warning-free lint: passed;
- migration verification: all 83 migrations passed on fresh SQLite and Cloudflare D1 paths;
- Vinext production build: passed;
- `git diff --check`: passed;
- GitHub and Sites managed source branch: exact application SHA `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e`;
- Sites application version: 208, deployment `appgdep_6a6943bcb758819196c764370a2b683a`, public, environment revision 19;
- required Sites delivery and limiter configuration names are present; secret values were not read or reproduced;
- live public `/plan` exposes the reconciled seven-part advisor intake and controlled question-led result;
- the live guide paragraph colour is `rgb(185, 204, 215)` on the navy canvas with no horizontal overflow;
- the live print route contains the ordered plan, decision questions, guide links and browser Print or Save as PDF action;
- representative local A4 output was inspected across four pages with complete cards, visible links, clean page breaks and no application shell;
- no real account was created or used, no working-demo data changed and no release check sent an email.

The authenticated email route and signed-in sharing UI were verified through owner-scope, privacy, provider, idempotency, limiter, modal and projection regressions. Live delivery was deliberately not exercised because the release boundary prohibits sending a test message to a real address.

### Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Application commit: `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e`
- Sites application version: 208
- Sites application deployment: `appgdep_6a6943bcb758819196c764370a2b683a`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites environment revision: 19
- D1 migration count: 83
- Immutable audit changes: none
- Demo data changed during live verification: none

## Prior released milestone: `CUSTOMER-ADVISOR-CONTEXT-02`

### Milestone outcome

The administrator notification inbox now keeps an expanded case open and at its prior visible position when the automatic audited read-state update refreshes and reorders the queue.

The household project builder also completes the next four advisor priorities:

1. controlled evidence-source confidence and provenance;
2. postcode and state based broad climate sequencing;
3. room-by-room comfort evidence that changes advice only when the concern and use period belong to the same room; and
4. a renter, owner and strata permission checklist derived from tenure, approval context, the current plan and remaining evidence questions.

The result remains an independent, brand-agnostic planning workflow. It is not a NatHERS assessment, legal permission decision, quote, fixed-price estimate or savings promise.

### User outcomes

- An administrator can open an unread case without the case collapsing or jumping away when the read update completes.
- Explicit close and resolve remain deliberate actions.
- A deliberate queue, search, category, priority, status or assignee change resets the open-case boundary instead of keeping an out-of-filter record visible.
- A household can label each important controlled fact as not known, customer reported, photo available for review or document available for review.
- Evidence labels describe the available source only. They do not claim that a file is attached to the fact, professionally reviewed or verified.
- A valid matching postcode and state produce a broad planning profile that can change whether shading or building-shell investigation appears first.
- Invalid, non-residential or postcode/state-mismatched input produces no climate profile.
- A household can add up to twelve private room profiles using controlled room types, concerns and use periods.
- Same-room hot daytime evidence can lead with shade and solar control. Same-room cold overnight evidence can lead with safe draught and insulation investigation.
- Private room names and routines do not enter the installer opportunity.
- Renter-portable and reversible actions appear before permission-dependent fixed work.
- The customer can build and preview a five-section property-permission checklist before downloading it.
- A customer-selected permission class cannot remove a mandatory licensed trade or site check.
- Arbitrary permission titles, identifiers and note wording remain inside the signed-in project. The shareable checklist uses controlled text and private-note reminders.
- Every generated evidence, climate and room step links to a plain-language explanation.

### In scope

- Stabilise the expanded case in `AdminNotificationInbox` across audited background refreshes.
- Add a small pure state helper for queue pinning and explicit reset semantics.
- Add regression tests for reordering, filter-boundary updates, unavailable cases and deliberate filter changes.
- Add `customer_projects.advisor_profile` as additive JSON text through `0082_customer_advisor_profile.sql`.
- Persist and hydrate the advisor profile through create, update, list and duplicate project paths.
- Add server normalization for evidence sources, climate, rooms and permission items.
- Keep a maximum of twelve rooms, sixty characters per private room name and controlled values for room type, concern and use period.
- Keep a maximum of thirty permission items and controlled classifications.
- Generate the permission pack from tenure, strata context, current plan, evidence gaps and customer classifications.
- Keep authoritative safety rules in their controlled section even when customer classification differs.
- Replace arbitrary shareable permission text with controlled reminders.
- Derive installer opportunity context from broad climate, controlled room-type and concern aggregates, and known or unknown source counts.
- Preserve the exact-postcode allocation boundary while returning an empty postcode to installers before contact release.
- Add preparation-guide sections for evidence, broad climate and room comfort.
- Correct guide paragraph contrast on the navy customer canvas.

### Out of scope

- Professional review or verification of household evidence.
- Formal NatHERS climate zones, ratings, certificates or equipment sizing.
- Legal advice or proof that owner, agent, strata or owners-corporation permission has been granted.
- Brand, product, provider or installer ranking.
- Current market-price estimates or guaranteed savings.
- Automatic access for an assessor.
- Creation of real customer, trade, wholesaler or assessor accounts.
- Generic Database Console withdrawal.
- Changes to the immutable dated audit.
- Netlify deployment.

### Advisor and privacy boundaries

- Use `independent home energy plan`, not `NatHERS assessment` or `NatHERS certificate`.
- Treat `Not sure` as valid information.
- Do not infer attachment review, professional validation or proof from a customer source selection.
- Do not tell customers to enter roof spaces, climb roofs, remove electrical covers or block required ventilation.
- Keep room names, room use periods, permission titles, permission notes, exact location and project-private notes out of installer opportunity payloads.
- Keep arbitrary permission wording out of the shareable checklist.
- Use controlled aggregates only where installer matching needs them.
- Keep the permission checklist as a question and review aid. It does not grant permission or replace licensed or site-specific advice.
- Use broad climate only to order investigations. It does not size equipment or predict savings.

### Data and compatibility requirements

- `customer_projects.advisor_profile` is additive JSON text with default `{}`.
- The forward migration is `0082_customer_advisor_profile.sql`. Applied migration history remains unchanged.
- That prior release's plan version was `2026-07-29-evidence-climate-advisor`.
- The prior `2026-07-29-home-advisor` plan version is legacy and regenerates through the existing edited-plan conflict boundary.
- Server normalization derives climate from the stored postcode and state. Client-supplied climate text is not authoritative.
- Invalid evidence-source, room, concern, use-period and permission values fall back to controlled safe states.
- Room concerns affect plan sequencing only when the relevant concern and use period occur in the same room.
- User classification is supplementary. It cannot replace an authoritative permission or licensed-site-check rule.
- API writes remain owner scoped and preserve backward compatibility for rows without an advisor profile.
- Duplicate projects preserve the normalized advisor profile without creating installer disclosure.

### Acceptance criteria

- The first unread demo case remains expanded and first in the visible queue after its automatic audited read update.
- That case no longer shows its `Mark read` action after the update, while `Close case` remains available.
- Manual filter changes reset the pinned case.
- Evidence labels make no unsupported review or attachment claim.
- Valid postcode and state input produce one bounded planning profile; invalid or mismatched input produces none.
- Hot daytime and cold overnight rules do not cross-correlate separate rooms.
- Room and permission limits are enforced by server normalization.
- Renter-portable actions precede fixed or permission-dependent work.
- The permission pack contains five controlled sections and retains authoritative safety rules.
- Malicious or private permission titles, notes and identifiers are not copied into the pack.
- Installer opportunity output excludes private room and permission content.
- Focused tests, full validation, all migrations, the production build, diff hygiene, source provenance and live checks pass.

### Validation commands and observed results

The exact application commit passed:

```powershell
node --experimental-strip-types --test test/admin-notification-inbox-stability.test.mjs test/customer-advisor-contract.test.mjs test/customer-project-advisor-ui.test.mjs test/customer-project-advisor.test.mjs
npm.cmd run validate
node --experimental-strip-types --test
git diff --check
```

Observed results:

- focused advisor and administrator regression set: 38 of 38 passed;
- integration suite inside the release gate: 32 of 32 passed;
- full suite: 770 tests, 768 passed, 2 intentionally skipped and 0 failed;
- type checking: passed;
- warning-free lint: passed;
- migration verification: all 83 migrations passed on fresh SQLite and Cloudflare D1 paths;
- Vinext production build: passed;
- `git diff --check`: passed;
- application source and Sites managed branch: exact SHA `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77`;
- Sites application version: 206, deployment `appgdep_6a68ff2f45d08191aec1274c14168407`, public, environment revision 19;
- public health, guide, signed-out customer route and administrator shell: HTTP 200;
- signed-in customer verification: all five steps selectable; evidence labels, room profile, broad climate, editable plan and five-section permission preview present;
- responsive verification: desktop guide contrast is readable; the 390 by 844 computed layout has no horizontal overflow;
- signed-in administrator verification: one working-demo notification changed from unread to read, stayed expanded and retained its first visible position;
- no real account was created or used.

The Sites error-only query returned three informational canceled `/api/electricity-plans` health-monitor invocations and no exception message attributable to the newly checked release routes. The monitor cancellation remains a separate operational observation, not a passing end-to-end electricity-plan provider check.

### Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Application commit: `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77`
- Sites application version: 206
- Sites application deployment: `appgdep_6a68ff2f45d08191aec1274c14168407`
- Production URL: `https://compare.ausenergyassessments.com`
- D1 migration count: 83
- Immutable audit changes: none
- Demo data changed during live verification: one notification read-state only

### Release and stop conditions

Stop the affected work when:

- evidence wording would imply professional review that did not occur;
- broad climate wording could be mistaken for a NatHERS result;
- room or permission text could disclose private household information to installers;
- a customer classification could remove a mandatory safety or licensed-site check;
- advice could encourage unsafe inspection, blocked ventilation or unauthorised fixed work;
- a change would create or use a real account for release testing;
- the release commit, GitHub branch, Sites source, archive and saved version do not reconcile;
- a change would alter the immutable dated audit;
- a legal, regulated-service, privacy, provider or account-ownership decision requires an authorised human.
