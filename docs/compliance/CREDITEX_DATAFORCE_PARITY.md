# Creditex Dataforce and Runabout capability parity

Status: verified minimum from read-only tenant inspection, with explicit unknowns

Reviewed: 1 August 2026

## Scope and evidence boundary

The signed-in Dataforce tenant was inspected read-only. No record was created, edited, submitted or deleted. The inspection verified a queue-led back-office compliance system with job or case navigation, record detail, status-driven review, ownership, evidence and form review, participant records, certificate and submission batch work, response reconciliation, and reporting or export administration.

This is the verified minimum replacement scope, not proof that every tenant feature has been inventoried. Dataforce menus expose only the tenant's configured programs and activities. The public Australian program source register is discovery and reconciliation material only. Neither that research nor a visible Dataforce menu is authority to publish an activity, evidence policy or calculation. Runabout private screens, Dataforce and Runabout field dictionaries, calculator logic, registry API behaviour, integration contracts, complete role permissions and retention rules remain unknown until Creditex supplies authorised documentation and representative exports.

Parity means Creditex can complete the same controlled business outcome with preserved data and audit history. It does not require a visual clone. The replacement should reduce context switching while retaining dense queues, filters, drill-down, explicit status, assignment, exceptions, submission control and immutable history.

## Status legend

- `Observed`: visible and usable in the inspected Dataforce tenant.
- `Partially observed`: the capability was visible, but its complete rules, edge cases or exports were not exercised.
- `Required extension`: needed for Creditex's end-to-end operating model but not proven as a Dataforce tenant tool.
- `Unknown`: not established by the authorised inspection.

## Read-only Dataforce workflow observations

### Program workspaces and activity separation

The bottom workspace tabs observed in the signed-in tenant were `Dashboard` and `Victorian Energy Upgrades`. This supports bottom-level separation by program or scheme. It does not show one bottom tab per activity. TLink should therefore provide:

1. a bottom workspace tab for each governed program or scheme available to the Creditex organisation;
2. an activity selector and activity-specific filters inside the selected program workspace; and
3. data-driven activity handling from effective-dated governed records, with no activity-specific interface or calculation hard-coded into the portal.

VEU `6(23)` is one possible activity example only. It has no special platform status and cannot be treated as the first or only supported activity. Every approved program, activity, category and scenario must use the same governed workflow.

The inspected tenant's configured `Activity` filter exposed only:

- `15 Weather Sealing`;
- `17 Showerheads`;
- `21A` to `21F` lighting variants;
- `30 In Home Displays`;
- `36 pre-rinse spray valve`; and
- `45 Home Energy Assessment`.

This is a limited tenant configuration, not a national activity catalogue and not regulatory authority. It may be used to test legacy value mapping only after Creditex supplies the authorised field dictionary and export.

### Advanced search and reusable filters

The right-side advanced search panel exposed search type, bulk actions, date-filter type and date range, the following filter groups, and saved custom quick filters:

| Filter group | Observed subfilters |
| --- | --- |
| Status Filters | Status; Sub Status; Submission Status; Invoice Status; Invoicing & Submission Filters; Quotation Status |
| Work & Personnel | Work Type; Field Worker; Created By |
| Client & Agent | Client; Agents |
| Customer & Address | Customer Type; Address Filters; Customer Filters |
| Job Filters | Job Source; Issue Status |
| Appointment Filters | Appointment Type; Outcome; Other Appointment Filters |
| Tag Filters | Match mode; Tags; Show tags as columns |
| Product Filters | Activity; Product Category; Product Type |
| Audit Filters | Completed; Not Completed |
| Other Filters | Other Filters; Additional Columns |

TLink parity requires each applicable dimension to be available as a deterministic server-side filter, composable across groups, reflected in result counts and export cohorts, and saveable as an organisation or named-user view. A legacy label may map to a clearer TLink term, but no source value can be silently discarded. Filters whose authoritative relationship does not yet exist must be shown as unavailable with the reason, not emulated from unrelated data.

The TLink portal now keeps every observed filter family in the advanced-search workflow. Facets backed by authoritative TLink relationships are interactive and server-side. Observed Dataforce subfilters that still lack a verified field or mapping remain visible as unavailable with the reason. Complete parity is therefore not claimed: Creditex must supply its current saved-filter inventory, field dictionary, enumeration values and representative exports before those gaps can be closed.

### New Job and customer intake

The observed `New Job` flow first searches for an existing customer by customer ID, person name, company, ABN or ACN, email, phone or external job ID. It also offers `Create New Customer`.

The observed create-customer intake includes title, first name, surname, email, phone, mobile, residential or business type, SMS consent state, external job ID, agent, property-address autocomplete or manual entry, unit or building details, and billing-address and owner-address flags. TLink must reuse authoritative installer CRM customer, contact, service-site and business records where available, preserve the legacy and external identifiers required for migration, and avoid repeated entry. Private customer, site and installer detail belongs in the purpose-authorised audited case view, not the default compliance queue.

## Verified parity matrix

| Dataforce or Creditex capability | Evidence status | TLink replacement contract | Workflow improvement and acceptance condition |
| --- | --- | --- | --- |
| Program or scheme workspace tabs with nested activity filtering | Observed | Bottom program workspaces populated from governed program records, with activity, category and scenario filtering inside each workspace | Preserve fast scheme switching without encoding a special path for any activity. Selected filters, counts and queues must remain deterministic and organisation-scoped. |
| Dashboard and operational work queues | Observed | Organisation-scoped case, evidence, task, finding, batch and reconciliation queues | One queue shell with saved filters, counts, priority, age, assignee and blockers. Counts must reconcile to the source tenant for the same cohort. |
| Job or case list and drill-down detail | Observed | One compliance case linked to the installer job and exact activity snapshot | Open one case workspace instead of separate customer, job, audit and submission contexts. Preserve external IDs and source links after migration. |
| Advanced search, filters and status-driven review | Observed | Structured server-side filters across status, work and personnel, client and agent, customer and address, job, appointment, tags, product, audit and other authorised dimensions | Filters must be deterministic, export the same selected cohort and retain saved operator views. Unsupported legacy dimensions remain explicit gaps rather than inferred values. |
| New Job and customer intake | Observed | Existing-customer lookup plus reusable customer, contact, service-site, installer and external-reference records | Reuse authoritative CRM data, preserve consent and address-purpose distinctions and avoid duplicate entry while keeping private fields out of the default queue. |
| Assignment and ownership | Observed | Named case assignments for case manager, primary reviewer, secondary reviewer and auditor | Show unassigned and overloaded work, prevent self-approval and retain assignment history. |
| Evidence and form review | Observed | Versioned evidence requirements and immutable case evidence linked to the exact requirement | Generate the checklist from the governed activity version, show originals and metadata beside the requirement and never make reviewers infer missing shots from a generic gallery. |
| Audit Centre, findings and follow-up | Observed | Requirement or evidence-specific findings, correction tasks, decisions and append-only audit events | Exception-first queue, structured severity, clear correction request, installer response and reviewer resolution. Waiver authority must be explicit. |
| Participant and account records | Observed | Legal participant organisations and people with external references and status | Reuse verified business and person facts across cases while retaining case-date snapshots. Do not grant access because a participant record exists. |
| Participant abilities and expiry | Observed | Effective-dated program or activity abilities with status, evidence and approver | Warn before expiry, hard-block invalid ability at installation or submission and preserve the check used for each case. |
| Product records and status | Partially observed | Effective-dated product registry, model, serial, approval, recall and suspension snapshots | One product lookup with installation-date validity and kill switch. Complete Dataforce product-field and status mapping still requires an authorised export. |
| Stock, installed equipment and decommissioning | Observed | Installed, decommissioned and stock equipment records with serial and evidence snapshots | Serial-level chain from stock to installation or disposal, duplicate checks and activity-specific destruction or recycling evidence. |
| Certificate or activity status history | Observed | Separate case decision, submission outcome, issued certificate, inventory, trade and settlement ledgers | Present a single timeline while keeping estimate, eligibility, submission, issuance, trade and settlement distinct. |
| Submission batch creation and staging | Observed | Provider-neutral batches and locked batch items built from approved case revisions | Preview validation, case-level exceptions, independent batch approval, immutable sent artifact and no silent re-export of changed cases. |
| Data-file and JSON export | Observed | Versioned connector mapping and hashed CSV, JSON, manual or API artifact | Generate from one canonical batch contract. Retain the exact file, manifest, mapping version and hash. |
| Asynchronous response upload | Observed | Immutable raw submission response linked to batch and connector | Upload once, hash, parse to a preview and require confirmation before reconciliation. Never overwrite the sent artifact. |
| Manual response reconciliation | Observed | Per-item response match, accepted or rejected quantity, errors, unmatched rows and correction tasks | Automatically propose exact matches and surface only exceptions. Ambiguous or quantity-changing matches require a second person. |
| Import and export administration | Observed | Idempotent, source-labelled importer with quarantine and reconciliation report | Dry run before acceptance, show create, update, duplicate and unknown counts, and never discard unmapped values. |
| Reporting and operational export | Observed | Source-backed queue, ageing, throughput, exception, submission, issuance and settlement reports | Every number drills to the included cases and records the filter and as-of time. Report parity needs Creditex's current report inventory and samples. |
| Operator, read-only API and read-write API access types | Observed | Named-user roles plus action-level permissions and named workload identities | Replace coarse access with least privilege, tenant isolation, revocation and audited purpose. Generic shared write credentials are prohibited. |
| Calculator logic and quantity determination | Unknown | Immutable calculator versions, source hashes, typed inputs, test vectors and calculation runs | Hard-disabled until exact Dataforce inputs, official formulas, rounding, effective dates and Creditex or regulator vectors reconcile. |
| Live registry submission API and response semantics | Unknown | Provider-neutral connector mapping and separately authorised transport adapter | Hard-disabled until Creditex provides API authority, credentials, schemas, idempotency rules, sandbox evidence and failure handling. |
| Complete activity and evidence catalogue | Unknown | Nationwide effective-dated program, activity and evidence-policy catalogue | Dataforce menus cannot seed the catalogue. Each activity needs authoritative public sources and Creditex private approval. |
| Retention, deletion, legal hold and restore | Unknown | Evidence retention, legal hold, immutable audit, backup and restore controls | No legacy assumption is accepted. Creditex legal approval and a successful restore exercise are required. |
| Certificate inventory, trading, fees and settlement | Required extension | Certificate lots, trades and settlements linked to regulator-issued outcomes | Dual-controlled inventory and money reconciliation. Do not infer issued quantity from an estimate or accepted case. |
| Runabout field capture and offline behaviour | Unknown | Requirement-led TLink field capture with original bytes, metadata envelope, offline queue and upload receipt | Full parity requires an authorised Runabout walkthrough, sample export and representative device tests. |

The TLink operations data model represents invitations and audit events; evidence policies and requirements; participants and abilities; assignments, tasks, evidence, findings and decisions; equipment; calculator versions, vectors and runs; batches, items, artifacts and responses; and certificate lots, trades and settlements. The rules workspace now authors and independently publishes the program, activity and evidence-policy portion with scoped pagination and immutable history. Data-model coverage is not proof of a complete private catalogue, finished legacy parity, live registry integration, correct formulas or production readiness.

## Better Creditex workflow

### One case workspace

The case header keeps job number, installer business, site jurisdiction, exact program and activity version, status, assignee, due date and blockers visible. Tabs or panels show:

1. activity and eligibility facts;
2. requirement-led evidence;
3. participants, licences and abilities;
4. installed and decommissioned equipment;
5. findings and corrections;
6. calculations and decisions;
7. submission and response history;
8. certificate, trade and settlement history; and
9. immutable audit history.

Customer contact details, exact address, raw coordinates and original evidence are revealed only when the named user's role and current task require them.

### Exception-first queues

Default queues should surface:

- evidence overdue, missing or rejected;
- participant ability or licence near expiry;
- product suspended, recalled or no longer listed;
- critical or major findings;
- cases waiting for installer correction;
- cases ready for second review;
- batches blocked by validation or approval;
- unmatched, duplicate or partially accepted responses;
- issued quantities not reconciled to inventory; and
- trades or settlements outside due or expected values.

### Governed evidence instead of generic forms

The installer sees only requirements from the exact published evidence-policy version. Each capture is linked to one requirement at capture time. Creditex sees the original, metadata, deterministic checks and any prior superseded evidence together. A policy change creates a new version and does not silently alter an installed case.

Current field compatibility is explicit. Photo and document requirements can be published only when their capture mode and file types are supported. Signatures, conditional logic, dynamic fields, other evidence types and trusted-original requirements remain publication blockers. JPEG metadata, GPS and capture time are verified again from assembled bytes; these checks do not establish original-camera authenticity.

### Deliberately separated external steps

The local states `draft`, `ready`, `exported` and `submitted` remain distinct. Generating a file is not an external submission. Importing a response is not acceptance until every item is reconciled. This keeps manual portal, CSV, JSON and later API submission safe behind the same batch workflow.

## Full parity acceptance

Creditex must complete these checks before Dataforce or Runabout is retired:

1. Provide an authorised inventory of every menu, screen, action, role, configured program, report, import, export, field and scheduled process used by the team.
2. Provide representative redacted exports, submission artifacts, response files, calculator examples, reports and Runabout captures.
3. Map every field, enumeration, status and external identifier to TLink, including `not mapped` and `not retained` decisions signed by Creditex.
4. Run role-based scenario tests for case intake, evidence correction, approval, submission, partial rejection, certificate issuance, trade, settlement, audit retrieval and incident suspension.
5. Reconcile historical samples and open cases by counts, hashes, totals, identifiers, states and exceptions.
6. Run a bounded parallel pilot and measure case completion, reviewer handling time, correction cycles, submission defects and reconciliation defects.
7. Prove backup, restore, retention, legal hold, access revocation and a rollback to the legacy process.
8. Obtain named Creditex operational, compliance, legal and financial acceptance for the exact cutover cohort.

Any legacy capability not yet inventoried remains an explicit parity gap. It is not silently dropped because it was absent from the inspected tenant menu.
