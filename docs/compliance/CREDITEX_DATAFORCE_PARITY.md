# Creditex Dataforce and Runabout capability parity

Status: verified minimum from read-only tenant inspection, with explicit unknowns

Reviewed: 1 August 2026

## Scope and evidence boundary

The signed-in Dataforce tenant was inspected read-only. No record was created, edited, submitted or deleted. The inspection verified a queue-led back-office compliance system with job or case navigation, record detail, status-driven review, ownership, evidence and form review, participant records, certificate and submission batch work, response reconciliation, and reporting or export administration.

This is the verified minimum replacement scope, not proof that every tenant feature has been inventoried. Dataforce menus expose only the tenant's configured programs and activities. Runabout private screens, Dataforce and Runabout field dictionaries, calculator logic, registry API behaviour, integration contracts, complete role permissions and retention rules remain unknown until Creditex supplies authorised documentation and representative exports.

Parity means Creditex can complete the same controlled business outcome with preserved data and audit history. It does not require a visual clone. The replacement should reduce context switching while retaining dense queues, filters, drill-down, explicit status, assignment, exceptions, submission control and immutable history.

## Status legend

- `Observed`: visible and usable in the inspected Dataforce tenant.
- `Partially observed`: the capability was visible, but its complete rules, edge cases or exports were not exercised.
- `Required extension`: needed for Creditex's end-to-end operating model but not proven as a Dataforce tenant tool.
- `Unknown`: not established by the authorised inspection.

## Verified parity matrix

| Dataforce or Creditex capability | Evidence status | TLink replacement contract | Workflow improvement and acceptance condition |
| --- | --- | --- | --- |
| Dashboard and operational work queues | Observed | Organisation-scoped case, evidence, task, finding, batch and reconciliation queues | One queue shell with saved filters, counts, priority, age, assignee and blockers. Counts must reconcile to the source tenant for the same cohort. |
| Job or case list and drill-down detail | Observed | One compliance case linked to the installer job and exact activity snapshot | Open one case workspace instead of separate customer, job, audit and submission contexts. Preserve external IDs and source links after migration. |
| Search, filters and status-driven review | Observed | Structured case, evidence, task, finding, submission and certificate states | Filters must be deterministic, export the same selected cohort and retain saved operator views. |
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

The working-tree operations data model represents invitations and audit events; evidence policies and requirements; participants and abilities; assignments, tasks, evidence, findings and decisions; equipment; calculator versions, vectors and runs; batches, items, artifacts and responses; and certificate lots, trades and settlements. Data-model coverage is not proof of finished screens, live registry integration, correct formulas or production readiness.

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
