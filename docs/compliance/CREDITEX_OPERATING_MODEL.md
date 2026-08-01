# Creditex compliance operating model

Status: target operating contract and release gate, not production authority

Reviewed: 1 August 2026

Owner: Creditex compliance operations, with TLink platform and legal support

Related records:

- [Australian program source register](./AUSTRALIAN_PROGRAM_SOURCE_REGISTER.md)
- [Dataforce capability parity](./CREDITEX_DATAFORCE_PARITY.md)

## Decision and authority boundary

TLink will replace the fragmented installer, Dataforce and Runabout hand-offs with one compliance case centred on the installer job. One case is bound to one exact program, activity version, evidence-policy version and, where applicable, calculator version. A job may have more than one case only when an approved stacking or interaction rule permits it.

This document defines the target operating model. It does not assert that the full workflow is deployed, that Creditex may create every certificate described here, or that a customer is eligible for any incentive.

Public research is discovery evidence only. It is not authority to activate claims. Government and regulator instruments define each program, activity, evidence and calculation rule. Before any activity can accept a real case, TLink must capture and independently verify the exact effective official sources, and Creditex must approve the accuracy of the operational transcription. Creditex must also evidence its current accreditation, participant or retailer agreements, submission schema, reconciliation process and trading or settlement controls. Those operating-authority and connector records limit what Creditex may do; they never replace, vary or privately author a scheme rule.

## Operating invariants

1. The installer enters customer, site and job facts once. Compliance work reuses those authoritative records and does not create a parallel customer database.
2. An activity selector uses jurisdiction, planned installation date, premises, baseline equipment, proposed product and participant abilities to show only published activity versions. It never promises eligibility or value.
3. Registry labels are stored as structured fields. For example, VEU `6(23)` is not one calculation key: specification Part 6, category `6A` to `6G` and scenario `(i)` to `(xi)` remain separate.
4. A case snapshots every governing version when it is created. Later rule changes do not rewrite an existing case.
5. Original evidence, decisions, calculations, submission artifacts and registry responses are append-only. Corrections supersede prior records without erasing them.
6. Estimated, eligible, ready to submit, submitted, accepted, certificate issued, traded and settled are distinct states.
7. Closed, suspended, future, unresolved or withdrawn activities are hard-disabled for new cases.
8. Creditex review is independent of the installer. Approval of a high-risk item requires a different named user from its creator or primary reviewer.
9. Connector-specific formats sit behind a provider-neutral case and batch contract. Dataforce, Runabout or a registry is never the TLink source of truth.
10. A public program page can establish that a program exists. It cannot by itself establish Creditex operating authority, exact eligibility, the complete evidence rule or a certificate quantity.

## Single case-centred workflow

| Stage | Primary actor | Required system behaviour | Exit control |
| --- | --- | --- | --- |
| 1. Enquiry and preflight | Installer office | Capture the service site, planned date, baseline equipment, desired upgrade and customer role. Resolve potentially relevant programs without presenting an entitlement. | Site jurisdiction and activity date are known. |
| 2. Exact activity selection | Installer office | Select a published program and exact activity, category and scenario version. Show source, effective dates, exclusions and unresolved warnings. | Activity is effective and not withdrawn, suspended or blocked. |
| 3. Atomic job and case creation | TLink | Create the installer job and linked Creditex case together. Snapshot government-source version identifiers and source hashes. | Both records exist or neither exists. |
| 4. Participant and product preflight | Installer and Creditex | Check the business, individual installer, licences, training, accreditation or ability, product-list status, recall status, network conditions and approved supplier requirements. | All mandatory facts are current for the planned date, or the case is blocked. |
| 5. Evidence plan | TLink | Expand the exact evidence-policy version into ordered before, during, after, commissioning, payment and decommissioning requirements. | Every required item has an owner, timing and capture rule. |
| 6. Field capture | Installer field user | Capture originals against the job, case, activity and requirement. Preserve bytes and metadata through offline upload. | Required originals have durable upload receipts or explicit missing reasons. |
| 7. Completeness checks | TLink | Run deterministic checks for count, format, signatures, dates, coordinates where required, serials, duplicates and required documents. | Automated checks are explainable and do not make the compliance decision. |
| 8. Creditex review | Creditex reviewer | Review the evidence, participant and product facts in one case workspace. Raise findings against a specific requirement or evidence item. | Findings are resolved, waived with authority, or the case remains blocked. |
| 9. Eligibility and calculation | Creditex reviewers | Apply an approved calculator version to immutable inputs. Compare against official tools or accepted test vectors and record the decision basis. | Dual-controlled eligibility and ready-to-submit decisions exist. |
| 10. Submission batch | Creditex case manager | Group only locked, approved case revisions into a provider-neutral batch, then produce the required manual, CSV, JSON or authorised API artifact. | Artifact and manifest hashes are sealed and independently checked. |
| 11. Response reconciliation | Creditex case manager and reviewer | Import the untouched response, match every result to a batch item, record partial acceptance and create correction tasks. | Every item is accepted, rejected, corrected, withdrawn or explicitly unresolved. |
| 12. Issuance, trade and settlement | Authorised Creditex users | Record regulator-issued identifiers and quantities separately from estimates, then record inventory, trade and settlement events. | Quantity and money reconcile to source artifacts and dual-controlled approvals. |
| 13. Close and retain | Creditex and TLink | Close only after findings, submission outcomes, financial records and retention instructions are complete. | Audit package can be reproduced without Dataforce or Runabout. |

## Nationwide coverage contract

Coverage means TLink must understand and correctly classify the program. It does not mean every row is an enabled Creditex claim path.

| Jurisdiction | Programs and outputs in catalogue scope | Activation position on 1 August 2026 | Primary official sources |
| --- | --- | --- | --- |
| AU | SRES and STCs; LRET and LGCs; REGO; ACCU Scheme; federal grant and finance wrappers | SRES is the ordinary trade-led certificate candidate. LGC, REGO and ACCU paths require specialist project workflows. Each Creditex accreditation and authorised activity scope remains an operating activation gate. | [CER SRES systems](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems), [CER STC creation](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/create-small-scale-technology-certificates), [CER RET eligibility](https://cer.gov.au/schemes/renewable-energy-target/eligibility-renewable-energy-target), [CER REGO](https://cer.gov.au/schemes/guarantee-origin-scheme/renewable-electricity-guarantee-origin/renewable-electricity-guarantee-origin-certificates), [CER ACCU methods](https://cer.gov.au/schemes/australian-carbon-credit-unit-scheme/accu-scheme-methods) |
| ACT | EEIS retailer-obligation activities; Sustainable Household Scheme; Home Energy Support; Sustainable Business; Solar for Apartments; other time-limited programs | Catalogue and route by output type. The current public AESP register does not list Creditex, so all Creditex EEIS submission remains disabled unless current authority is supplied and verified. Activity 4.2 and programs with an unresolved funding window also remain blocked. | [ACT EEIS](https://www.climatechoices.act.gov.au/policy-programs/energy-efficiency-improvement-scheme), [AESP register](https://www.climatechoices.act.gov.au/policy-programs/energy-efficiency-improvement-scheme/approved-energy-savings-providers), [EEIS legislation](https://www.climatechoices.act.gov.au/policy-programs/energy-efficiency-improvement-scheme/legislation), [Sustainable Household Scheme](https://www.climatechoices.act.gov.au/policy-programs/sustainable-household-scheme) |
| NSW | ESS and ESCs; PDRS and PRCs; Home Energy Saver loans and future discounts; shared-solar and community programs | ESS and PDRS activity versions require exact rules, methods and Creditex accreditation scope. Home Energy Saver discounts remain future and disabled until final rules and Creditex interface are issued. | [ESS rule changes](https://www.energysustainabilityschemes.nsw.gov.au/ess-rule-and-changes), [ESS eligible activities](https://www.energysustainabilityschemes.nsw.gov.au/eligible-activities-and-equipment), [PDRS rule changes](https://www.energysustainabilityschemes.nsw.gov.au/pdrs-rule-and-changes), [Home Energy Saver](https://www.energy.nsw.gov.au/households/grants-rebates/home-energy-saver) |
| NT | Solar for Multi Dwellings; feed-in tariffs; legacy battery and EV grants | No current NT certificate scheme was found. Route active grants and tariffs as grant or tariff cases, not certificates. Closed battery and EV grants are historical only. | [Solar for Multi Dwellings](https://nt.gov.au/industry/business-grants-funding/solar-for-multi-dwellings-grant-scheme), [Jacana pricing](https://www.jacanaenergy.com.au/index.php/residential/pricing), [closed battery scheme](https://nt.gov.au/industry/business-grants-funding/home-and-business-battery-scheme) |
| QLD | Supercharged Solar for Renters; Community Housing Energy Upgrades; home energy ratings; legacy demand-response and battery programs | No current Queensland state certificate or retailer-obligation scheme was found. Current grants require their own application and reimbursement cases. PeakSmart new incentives, QBEST and Battery Booster remain closed or historical. | [Solar for Renters](https://www.qld.gov.au/housing/home-energy-savings/supercharged-solar-for-renters), [Community Housing Energy Upgrades](https://www.business.qld.gov.au/industries/housing-accommodation/community/energy-upgrades/provider-owned-properties), [Battery Booster closed-program fact sheet](https://www.energyandclimate.qld.gov.au/__data/assets/pdf_file/0026/52964/retailer-fact-sheet-battery-booster.pdf) |
| SA | REPS retailer-obligation activities and productivity outcomes | Route through an obliged-retailer arrangement. The public provider page lists Creditex only for residential or small-customer WH1, HC2A and HC2B. All other codes remain disabled unless an authorised current engagement says otherwise. The exact Gazette, specification and factor must be resolved per activity date, while retailer intake and connector requirements remain separately labelled contractual controls and not scheme rules. | [SA REPS](https://energymining.sa.gov.au/industry/energy-efficiency-and-productivity/retailer-energy-productivity-scheme-reps), [Creditex public activity scope](https://www.escosa.sa.gov.au/industry/reps/obliged-retailers-activity-providers/technical-activity-providers), [REPS activity specifications](https://energymining.sa.gov.au/industry/energy-efficiency-and-productivity/retailer-energy-productivity-scheme-reps/reps-activity-specifications), [ESCOSA technical activities](https://www.escosa.sa.gov.au/industry/reps/obliged-retailers-activity-providers/technical-activities-specifications) |
| TAS | PowerSmart for Small Business; NILS Energy Saver support; regulated feed-in tariff; closed loan and EV programs | No current Tasmanian certificate scheme was found. Active programs use grant, subsidy or tariff workflows. Delivery-provider product rules for NILS remain unresolved. | [PowerSmart](https://www.recfit.tas.gov.au/grants_programs/energy-efficiency/powersmart_for_small_business), [Energy bill relief](https://www.recfit.tas.gov.au/grants_programs/energy/energy_bill_relief), [feed-in tariffs](https://www.economicregulator.tas.gov.au/electricity/pricing/feed-in-tariffs) |
| VIC | VEU deemed activities, project-based M&V and benchmark rating; Solar Victoria rebates, loans and grants | VEU requires an exact activity tuple, current official rules and effective-dated Creditex accreditation scope. Solar Victoria PV, hot-water, rental, community-housing and apartment paths are separate non-certificate cases. Solar Victoria battery loans closed to new applications in May 2025 and are legacy only. | [VEU specifications](https://www.energy.vic.gov.au/victorian-energy-upgrades/installers/industry-specifications), [VEU public registry](https://veu.esc.vic.gov.au/vpr/s/public-registry), [Solar Victoria](https://www.solar.vic.gov.au/), [battery-loan closure](https://www.solar.vic.gov.au/solar-victoria-exceeds-battery-targets) |
| WA | Residential Battery Scheme; small solar and battery connection controls; DEBS; household assistance; legacy grants | No current Western Australian state certificate scheme was found. Use grant, loan, network and tariff cases. Independently assess stacking with federal battery STCs. | [WA Residential Battery Scheme](https://www.wa.gov.au/organisation/energy-policy-wa/wa-residential-battery-scheme), [scheme eligibility](https://www.wa.gov.au/organisation/energy-policy-wa/wa-residential-battery-scheme-eligibility-requirements), [DEBS](https://www.wa.gov.au/organisation/energy-policy-wa/energy-buyback-schemes) |

Creditex's public site describes VEU, NSW ESS and PDRS, federal RET and SA REPS services. Those statements support discovery only. The exact current accreditation schedule and authorised activity scope must be obtained from Creditex and checked against the relevant official register before activation. Sources: [Creditex Trading](https://trading.creditex.com.au/) and [Creditex certificate services](https://trading.creditex.com.au/certificates/).

The case model must preserve each program's actual outcome class. STCs, LGCs, REGOs, ACCUs, VEECs, ESCs and PRCs use certificate or project-credit pathways. ACT EEIS and SA REPS are retailer-obligation accounting pathways. Rebates, grants, loans, tariffs, network approvals and procurement programs use their own approval and settlement outcomes and must never be represented as certificate creation.

## Source authority tiers

| Tier | Source | Permitted use |
| --- | --- | --- |
| 1. Controlling | In-force legislation, scheme rules, regulator determinations, Gazettes, current specifications and official registry decisions | Establish the legal and technical rule effective for the activity date. |
| 2. Official operational | Regulator or program-administrator bulletins, product and participant registers, approved lists, calculators, forms, evidence guides and suspension notices | Resolve operational facts that can change without a new Act or headline rule. |
| 3. Creditex operating authority and connector scope | Current accreditation schedules, retailer or regulator agreements, participant contracts, authorised field dictionaries, submission schemas, reconciliation procedures and settlement controls | Establish what Creditex is accredited, contracted and technically permitted to do. These records can constrain an operational route but cannot define or vary government program, activity, evidence or calculation rules. Required for activation. |
| 4. Verified legacy observation | Read-only Dataforce or Runabout screens, exports and known operator procedures | Establish replacement parity and migration mappings. Never establish legal eligibility or a connector contract. |
| 5. Context only | Public marketing, announcements, archived pages, consultation drafts and secondary summaries | Discovery, backlog and change monitoring only. |

An activity can be published only when the controlling and operational government sources are captured, their machine transcription is independently verified, Creditex operating authority and connector scope are approved, contradictions are resolved and two authorised people sign the release. If a Tier 1 or Tier 2 source conflicts with a Creditex procedure or connector instruction, the government or regulator source controls and the activity remains blocked until a lawful resolution is obtained and recorded.

## Immutable government-source contracts

| Contract | Required immutable content |
| --- | --- |
| Program version | Program code, jurisdiction, scheme kind, regulator, administrator, liable entity, authorised claimant or creator, output type, source URI, title, version, SHA-256, checked time and effective dates. |
| Activity version | Program version; activity code, specification part, category, scenario and sector stored separately; baseline and end-use conditions; inclusions, exclusions, transitions, stacking decisions and status. |
| Evidence-policy version | Ordered transcription of government or regulator requirements with timing, minimum and maximum count, original-file rule, metadata and GPS rule, signatures, declarations, documents, allowed types, validation schema and exact official source citation. |
| Calculator version | Typed inputs and units, product and climate lookups, factors, lifetime, decay, caps, co-payment, rounding, typed output, official source hash, implementation hash and regulator or Creditex test vectors. |
| Product and participant snapshot | Product-list entry and status, recall or suspension state, participant identity, ability, licence, training, accreditation, expiry and the check time. |
| Connector mapping version | Provider and scheme, transport, field map, enumerations, file or API schema, artifact naming, response mapping, idempotency rules, authorised documentation and tests. |
| Case snapshot | IDs and hashes for all governing versions, installation facts, participant and product snapshots, consent and assignment, evidence requirement plan and approved stacking decisions. |

Published versions are never edited or deleted. A correction creates a new version and an explicit effective date. Withdrawal immediately prevents new selection but preserves historical cases. A case upgrade is an audited, explicit decision that keeps both snapshots and never silently recalculates prior work.

The TLink governance workspace implements one data-driven path for every program and activity. Administrators transcribe complete government evidence requirements into effective-dated drafts inside the selected program and activity scope. Publication seals a canonical snapshot and SHA-256, then requires a different named administrator to verify and approve that exact transcription. Publication activates a verified machine representation of the controlling sources; it does not create a Creditex rule. Terminal decisions remain immutable. The bootstrap `info@ausenergyassessments.com` membership can maintain drafts and invite named users, but a shared mailbox cannot request or approve a governed publication.

## Original photo and metadata custody

Every compliance photo or file is evidence first and a display asset second.

- Read the picked or captured original bytes once, calculate SHA-256 over those exact bytes and encrypt and upload the same bytes.
- Preserve the original MIME type, filename, size, EXIF, XMP and IPTC metadata. Do not resize, annotate, strip metadata or replace an original with a PDF.
- Bind a signed evidence envelope to the actor, registered device, job, case, activity version, evidence-policy version, requirement code, capture stage, local and UTC time, timezone, permission state, coordinates and accuracy when available, raw metadata, hash and upload receipt.
- Keep offline queue identity, capture attempt, resumable upload parts, server receipt and object-storage identity in the custody log.
- Store thumbnails, OCR, redaction, annotation and other derivatives separately with their own hashes and a link to the original.
- Store acceptance, rejection and supersession as separate review state. A rejected file remains retained and a replacement points back to it.
- Apply GPS as a requirement only when the effective evidence policy demands it. Preserve available metadata universally because a later audit may need it.
- Restrict raw coordinates and original-file access to named users with a case purpose. General CRM views receive only requirement and review status.
- Apply the Creditex-approved retention schedule and legal hold. A legal hold blocks expiry and deletion until formally released.
- Treat missing, denied, inaccurate, internally inconsistent or edited metadata as an explicit review fact. Never silently manufacture a geotag or timestamp.

The current evidence boundary preserves the exact picked bytes and client-calculated SHA-256 through encrypted offline staging and resumable upload. At completion, the server reassembles the object, recalculates its SHA-256, checks the declared JPEG, PNG, WebP or PDF signature and stores a server-stamped verification result. For governed JPEG requirements it parses EXIF again from the assembled bytes. Required embedded metadata, GPS and capture time must exist; embedded GPS must agree with the registered device reading; embedded local time must agree with the retained timezone, UTC offset and device capture time. Missing, malformed or inconsistent bytes are rejected and the unusable assembled object is removed.

Those checks verify byte content and internal consistency. They do not prove that a camera created the file, that an editor never touched it or that a physical device is accepted by a regulator. A policy with `original required` therefore remains blocked from publication until TLink has platform-backed device and camera attestation plus representative-device acceptance. Production custody also still requires approved object immutability, backup and restore, retention, legal hold, access logging and operating tests.

## Participant, product, licence and decommissioning controls

### Participants and abilities

- Model each legal organisation and individual separately, with ABN, external participant ID, role and status.
- Version abilities by program and, where required, by activity. Store effective dates, expiry, suspension and approval evidence.
- Check the ability at case creation, installation and submission. An expiry after installation can still affect submission and must be resolved explicitly.
- Never infer a person's licence or accreditation from their employer, and never infer Creditex accreditation from a public marketing statement.

### Products and licences

- Resolve the exact product registry and list version applicable to the installation date.
- Store manufacturer, model, serial number, quantity, product reference, warranty and recall or suspension state.
- Record electrician, plumber, gasfitter, designer, inspector and other licences only where the activity requires them, including jurisdiction, class, number, holder and validity window.
- Recheck mutable product, recall, participant and licence status before submission or certificate creation when the scheme requires it.

### Existing equipment, stock and disposal

- Record the baseline unit's type, fuel, model, serial, operating state and evidence before work starts where required.
- Track installed, removed, returned, scrapped and decommissioned equipment as separate equipment events.
- Require the activity-specific destruction, degassing, recycling, disposal declaration, receipt or serial evidence. A generic removed checkbox is insufficient.
- Prevent the same serial, original evidence or site event from supporting an unauthorised duplicate or stacked claim.

## Dual control and audit

The following are two-person controls before production:

- publish or withdraw a program, activity, evidence policy, calculator or connector mapping;
- approve an eligibility or ready-to-submit decision;
- waive a major or critical finding;
- seal, submit or cancel a batch;
- reconcile a response where the match is ambiguous or changes quantity;
- recognise certificate inventory or change an issued identifier;
- approve a trade, fee, settlement or correction; and
- release a legal hold or approve an exceptional evidence-custody action.

The creator or primary reviewer cannot be the secondary approver. Every proposal, approval, rejection, withdrawal and emergency suspension records the named actor, timestamp, reason, version and affected objects in an append-only audit log.

An authorised administrator may hard-disable an activity, product or connector immediately when a regulator notice or material risk is identified. Reactivation always requires fresh source capture and independent approval.

## Provider-neutral submission and reconciliation

The authoritative object is a sealed TLink submission batch, not a Dataforce screen, Runabout export or regulator portal session.

Each batch must contain:

- organisation, program, accreditation and connector-mapping version;
- batch number, case IDs and locked case revisions;
- activity, evidence-policy and calculator version hashes;
- per-case typed output, assignment or nomination state and source evidence hashes;
- export format, generated artifact hash, creator, checker and generation time; and
- idempotency key and external reference when the receiving system supports them.

Manual entry, CSV, JSON and API are transport modes behind the same contract. The exact sent artifact remains immutable. The untouched response file or API payload is stored separately with its own hash and receipt time. Reconciliation maps every response item to one batch item, preserves partial acceptance, records unmatched and duplicate items, and creates a correction case rather than editing history.

An estimate is not a created certificate. A regulator-accepted record is not automatically a trade or settlement. Issuance, inventory, trade, fee and payment remain separate ledgers linked by immutable references.

## Named-user access model

`info@ausenergyassessments.com` is the bootstrap owner invitation for the initial Creditex compliance organisation only. It is not the shared operational login for the Creditex team.

After the bootstrap owner claims the invitation:

1. verify the legal Creditex organisation, ABN, accreditation scope and data-sharing authority;
2. invite each Creditex worker to a named, verified identity;
3. assign the minimum role and action permissions required;
4. require strong authentication and revoke access immediately when the person leaves or changes role; and
5. retain the mailbox only for break-glass ownership recovery and audited membership administration.

The minimum role set is:

| Role | Purpose | Explicit boundary |
| --- | --- | --- |
| Administrator | Organisation settings, invitations, government-source governance and emergency suspension | Does not inherit installer workspace access and cannot self-approve controlled changes. |
| Case manager | Queue triage, assignment, corrections, batching and reconciliation | Cannot publish rules or independently approve their own high-risk case or batch action. |
| Reviewer | Evidence review, findings, eligibility and secondary approval | Cannot replace originals, hide findings or alter sealed submissions. |
| Auditor | Read-only cases, versions, custody, decisions, batches and reconciliation | No mutation, submission, trading or settlement authority. |

Submission, trading and settlement require explicit action-level entitlements approved by Creditex. The coarse Dataforce labels `operator`, `read-only API` and `read-write API` are not sufficient separation of duties.

Creditex identities are not TLink platform administrators or installer-team members. Installer identities cannot enter the Creditex portal merely because they own the originating job. All access is organisation-scoped and case-purpose logged.

## Hard-disabled and unresolved items

| Item | Required state | Unblock condition |
| --- | --- | --- |
| Public research by itself | Disabled | Exact effective official source, independently verified operational transcription, Creditex operating authority and connector scope, and dual approval. |
| Certificate or incentive calculators without approved test vectors | Disabled | Versioned implementation reconciles to official tools or accepted Creditex vectors and receives two-person approval. |
| NSW Home Energy Saver discounts | Future, disabled | Final guidelines, activity specification, evidence payload and Creditex operating interface are authoritative and approved. |
| Solar Victoria battery loans for new applicants | Closed, disabled | No reactivation unless Solar Victoria publishes a new offering. Legacy approved cases remain reconcilable. |
| NSW PDRS rule version with unresolved July 2026 source | Disabled for affected versions | Exact controlling rule and installation-date method are captured and approved. |
| Creditex ACT EEIS submission | Disabled | Creditex supplies a current AESP approval or authorised retailer arrangement and the Scheme Administrator position is verified. |
| ACT EEIS activity 4.2 | Disabled | Current legal interpretation and retailer operating plan resolve the NSW commercial-lighting dependency. |
| SA REPS activity codes other than public Creditex scope WH1, HC2A and HC2B | Disabled | An obliged retailer's authorised current Creditex engagement and activity scope are captured and approved. |
| SA REPS activities with mixed-vintage factors, including BS3B and LF1 | Disabled for affected versions | Exact current Gazette, specification, factor and Creditex retailer requirement are reconciled. |
| Future, suspended, revoked or expired activities and products | Disabled for new cases | A new effective source and separately approved version exists. |
| Dataforce and Runabout provider-owned schemas or APIs | Unknown, no live connector | Creditex provides authorised documentation, sample exports, field definitions and permitted access. These connector records do not establish scheme rules. |
| Unverified grant, loan, finance or portal APIs | Manual or documented export only | Provider authorises a tested contract and legal data review. |
| LGC, REGO and ACCU project paths in the ordinary installer workflow | Disabled | Specialist project, metering, reporting and audit workflows are separately designed and approved. |
| Production evidence acceptance, submission, issuance, trading and settlement | Disabled until release gates pass | Creditex legal and compliance approval, production security controls, end-to-end tests, migration rehearsal and bounded pilot. |
| Shared team credentials or generic API write access | Prohibited | Named user or workload identity with least privilege, audit and revocation. |

## Phased Dataforce and Runabout migration

No big-bang migration is permitted.

| Phase | Scope | Exit evidence |
| --- | --- | --- |
| 0. Authority and inventory | Obtain authorised Dataforce and Runabout field dictionaries, exports, API terms, activity configurations, user roles, volumes, retention obligations and open-case states. | Creditex signs the source inventory, role matrix and migration authority. |
| 1. Shadow foundation | Configure one exact independently verified government program and activity version, evidence policy and calculator in a non-production environment, within Creditex's approved operating scope. | Test vectors, access denial, custody, backup and audit checks pass. |
| 2. Historical import rehearsal | Import de-identified and then authorised historical samples with repeatable mapping and quarantine for unknown values. | Counts, hashes, totals, references and exception reports reconcile with no source mutation. |
| 3. Parallel pilot | Run a bounded group of new cases through TLink while Dataforce and Runabout remain the controlled fallback. | Case completeness, reviewer time, corrections, calculation and batch output reconcile case by case. |
| 4. Program cutover | Cut over one program and activity cohort at an agreed effective boundary. Prevent duplicate creation across systems. | Open-case ownership, submission batches, issued quantities and settlements reconcile. Rollback is rehearsed. |
| 5. Progressive expansion | Repeat the governed cutover by activity, jurisdiction and connector. | Each cohort has signed acceptance and no unresolved material exceptions. |
| 6. Legacy read-only and retirement | Freeze writes, retain searchable archives and export custody, decision, submission and settlement evidence. | Creditex accepts retention, audit retrieval, restore test and provider termination evidence. |

Each import is idempotent, source-labelled and reversible before acceptance. Unknown fields are quarantined, not discarded or guessed. Dataforce and Runabout remain read-only evidence sources until Creditex accepts the relevant cohort and rollback window.

## Production release gate

Real cases remain blocked until all of the following are evidenced:

- Creditex has approved its legal organisation identity, accreditation scope, participant terms, purpose, privacy notice, consent, retention, legal hold, incident and support processes;
- at least one complete government-source package has authoritative source hashes, verified evidence-rule transcription, calculator tests where applicable, participant and product checks and dual approval;
- named-user access, strong authentication, tenant isolation and append-only audit tests pass;
- original evidence survives capture, offline recovery, upload, hash verification, object retention, backup and restore on representative devices;
- batch generation and response reconciliation pass authorised test files without duplicate or silent loss;
- the Dataforce and Runabout migration rehearsal reconciles counts, hashes, states and open cases; and
- Creditex signs the bounded pilot, rollback plan and production activation.
