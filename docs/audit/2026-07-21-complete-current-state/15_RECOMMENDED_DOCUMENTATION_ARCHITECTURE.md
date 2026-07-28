# Recommended documentation architecture

## Decision

Adopt one registry-backed documentation system that separates current truth, approved decisions, operating procedures, product requirements and history. The present repository has valuable evidence, but a rolling handover, a long release ledger, roadmap statements and historical architecture files all carry status claims in different shapes. The audit observed the concrete failure mode: clean implementation commit `4a5cd19…` contained the owner Database Console while the handover still called it “in progress” and production documentation ended at Sites v198; a later documentation-only commit `ff3c8ef…` then recorded deployment of that same application source as Sites v199. A machine-readable document registry and required lifecycle metadata would preserve both checkpoints and prevent the transitional contradiction from being read as current truth.

This audit recommends structure only. No existing document should be moved, merged, archived or deleted until an owner approves a separately reviewed documentation migration.

## Source-of-truth model

| Truth class | Authoritative source | Rule |
|---|---|---|
| Repository implementation | Git commit, manifests, schema, migrations and tests | Documentation may explain but never override executable evidence. |
| Production deployment | Provider deployment record tied to exact source SHA plus dated runtime checks | A merge or local commit is not deployment proof. |
| Current product status | `docs/current/product-status.md` generated/reconciled from feature registry and deployment evidence | Each capability separates intended, implemented, tested, configured, deployed and operational state. |
| Current platform/ownership | `docs/current/platform-register.md` | Each resource has owner, billing, admin path, data class, region, backup/export/restore proof and last verification. Unknowns remain explicit. |
| Approved architecture | Accepted ADRs plus current diagrams | Proposed architecture never appears in the current topology. |
| Next work | One milestone contract plus roadmap IDs | A handover may reference history but cannot itself be release truth. |
| Operational procedure | Tested runbook with last exercise and evidence | A procedure is not “proven” until exercised. |
| Regulatory/industry source | Source register with direct primary URL, jurisdiction, effective/check dates | Guidance and legal applicability are separated; expert confirmation is recorded. |
| History | Immutable release index and archived snapshots | Historical claims are clearly dated and cannot be mistaken for current state. |

## Proposed hierarchy

```text
docs/
  README.md                         # audience-based entry point
  registry.yaml                     # machine-readable document registry
  current/
    product-status.md               # current feature and workflow truth
    release.md                      # exact deployed SHA/version/environment
    platform-register.md            # hosting, ownership and data controls
    environments.md                 # local/preview/staging/production/DR
    known-risks.md                  # open accepted/unaccepted risks
  product/
    vision-and-boundaries.md
    personas-and-workflows.md
    feature-registry.yaml
    requirements/
    research/
  industry/
    primer.md
    glossary.yaml
    jurisdictions.md
    source-register.yaml
    compliance-matrix.md
  architecture/
    system-context.md
    containers-and-components.md
    deployment-topology.md
    trust-boundaries.md
    data-flows.md
    adrs/
  api/
    openapi.yaml
    events.md
    webhooks.md
    error-contract.md
  data/
    ownership-and-lineage.md
    schema.md
    migration-policy.md
    retention-and-deletion.md
    exports.md
  security/
    security-model.md
    roles-and-permissions.md
    threat-model.md
    privacy.md
    secret-management.md
    incident-response.md
  integrations/
    registry.yaml
    providers/
  frontend/
    information-architecture.md
    design-system.md
    accessibility.md
  testing/
    strategy.md
    coverage.md
    test-data.md
    release-gates.md
  deployment/
    build-and-provenance.md
    promotion.md
    rollback.md
  operations/
    observability.md
    service-level-objectives.md
    backup-restore-dr.md
    support-model.md
    runbooks/
  ai/
    use-case-registry.yaml
    data-and-retrieval-policy.md
    evaluation.md
    model-prompt-register.yaml
  roadmap/
    current.md
    decisions-needed.md
  templates/
  releases/
    index.yaml
    YYYY/
  archive/
```

## Document-class contract

Each row below is a complete normative contract. Every document must carry its own `status`, `last_verified`, `owner_role`, `review_cadence`, `evidence_requirements`, `supersedes` and `superseded_by` values. No class inherits any of those fields from generic front matter or surrounding prose. When there is no predecessor or successor, the document must still state `supersedes: []` and `superseded_by: null`. `Status` in this table is document lifecycle status; evidence claims inside the document continue to use the audit taxonomy in the next section.

| Class | Purpose | Status | Last verified date | Owner | Audience | Authoritative input | Review cadence | Evidence requirements | Supersedes / superseded-by |
|---|---|---|---|---|---|---|---|---|---|
| Current truth | Answer “what is live now?” | Required: `current`; change to `historical` when replaced and never leave two current authorities for one subject | Required ISO date tied to the newest deployment/runtime reconciliation | Product and engineering owners jointly | Everyone | Provider deployment + exact Git SHA + runtime evidence | Every release and monthly even without release | Version, SHA, environment, dated checks, discrepancies and explicit unknowns | Both fields required; replacement must reciprocally link the prior and new current document |
| Product/business | Explain users, value, workflow and boundaries | Required: `proposed`, `current`, `deprecated` or `historical` | Required ISO date of the last decision/research reconciliation | Product owner | Product, engineering, operations | Approved product decisions and research | Quarterly and on material product change | Decision IDs, research sources, workflow tests, boundaries and owner approval | Both fields required; use empty/null explicitly until a version is replaced |
| Industry/glossary | Define domain and sourced requirements | Required: `current` or `historical` | Required ISO source-check date; effective date remains separate | Industry/compliance owner | All roles | Primary official sources | Monthly freshness check and event-driven on rule change | Direct URL, publisher, jurisdiction, effective date, check date and expert-confirmation status | Both fields required; supersession links identify the exact replaced source/version |
| Architecture | Describe implemented and target systems separately | Required: `proposed`, `current` or `historical`; current and target content cannot share an unlabeled status | Required ISO date of repository, configuration and provider reconciliation | Technical owner | Engineering, security, operations | Repository/config/provider evidence and ADRs | Every material architecture change and quarterly | Diagrams, interfaces, ownership, trust/failure boundaries, source SHA and provider evidence | Both fields required; replacement architecture reciprocally links the prior document |
| ADR | Record one consequential decision | Required: `proposed`, `accepted`, `superseded` or `rejected` | Required ISO decision/review date | Decision owner | Engineering/operations | Decision packet | On proposal/acceptance; immutable after acceptance except a superseding ADR | Context, forces, options, decision, consequences, acceptance and validation evidence | Both fields required; an accepted replacement names every superseded ADR and each old ADR names its successor |
| API/contract | Define public/internal interfaces | Required: `current`, `deprecated` or `retired` | Required ISO date of schema/handler/contract-test reconciliation | Service owner | Engineering/integration partners | Generated schema plus contract tests | Every contract change and scheduled quarterly drift check | Machine schema, examples, authentication, authorization, errors, versioning and passing contract tests | Both fields required; deprecated/retired contracts link the replacement or explicitly state no successor |
| Data/schema | Explain source of truth, lineage and lifecycle | Required: `current` or `historical` | Required ISO date of schema/migration replay reconciliation | Data owner | Engineering/security/operations | Schema/migrations and data policy | Every migration and quarterly | Table/field classes, tenant keys, lineage, retention, migration/rollback and replay result | Both fields required; schema-reference replacements reciprocally link while migrations remain immutable history |
| Security/privacy/compliance | Define controls and assessed applicability | Required: `current`, `deprecated` or `historical`; each control claim also carries an audit-taxonomy status | Required ISO evidence/legal-source check date | Security/privacy owner | Engineering, operations, legal adviser | Threat model, laws/guidance and tested controls | Quarterly and every incident or material change | Control owner, test/result, evidence date, applicability decision, expert confirmation and unknowns | Both fields required; replacement records preserve the superseded assessment and its evidence date |
| Integration | Define provider contract, operation and recovery | Required: `current`, `blocked`, `deprecated` or `historical` | Required ISO date of configuration/runtime/provider-contract verification | Integration owner | Engineering/operations | Provider docs/config/runtime | Monthly while active and before provider changes | Environment, account/credential owner, scopes, limits, retries, webhooks, reconciliation, export/recovery and runtime proof | Both fields required; provider/version replacement links both directions, including blocked migrations |
| Frontend/design/accessibility | Define shared UI rules and verified journeys | Required: `current`, `proposed`, `deprecated` or `historical` | Required ISO date of component, browser/device and accessibility evidence | Design/front-end owner | Product/engineering/QA | Components, tokens and tested flows | Every design-system change and quarterly audit | Journey, component/token version, browser/device matrix, keyboard/assistive-technology evidence and exceptions | Both fields required; replaced rules/components link to the successor contract |
| Test/release | Define what proves a releasable state | Required: `current`, `deprecated` or `historical` | Required ISO date of CI/gate reconciliation | Engineering owner | Engineering/release owner | CI configuration and test evidence | Every gate change and quarterly | Exact commands, expected artifacts, environments, thresholds, results and approved exceptions | Both fields required; old gates become historical and reciprocally link the current gate contract |
| Deployment/runbook | Define a repeatable operational action | Required: `current`, `deprecated`, `historical` or `blocked` | Required ISO date of the last successful exercise or failed attempt | Service operator | Operators/on-call | Actual provider paths and rehearsals | Quarterly and after each use or provider change | Preconditions, commands, safety boundary, success signal, rollback, escalation, last exercise and evidence | Both fields required; archive only after reciprocal replacement links and consumer links are updated |
| Backup/restore/DR | Prove recoverability | Required: `current`, `blocked`, `deprecated` or `historical` | Required ISO date of the last restore exercise, not merely backup creation | Data/service owner | Operations, security, owner | Provider configuration and restore exercises | Backup monitored continuously; restore at least quarterly initially | RPO/RTO, independent copy, integrity check, restore log, reconciliation, custodian and unresolved gaps | Both fields required; replacement plans link both ways and preserve failed/historical exercises |
| Roadmap | Record dependency-ordered approved work | Required: `current` or `historical`; item-level status remains explicit | Required ISO date of milestone/capacity reconciliation | Product owner | All roles | Findings, decisions and capacity | Every milestone close and material reprioritisation | IDs, dependencies, acceptance criteria, decision state, capacity basis and outcome evidence | Both fields required; each current roadmap names the snapshot it supersedes and the old snapshot names its successor |
| Release record | Preserve immutable provenance and outcome | Required: `historical` after publication; immutability is a class rule, not a second status | Required ISO deployment/verification date | Release owner | Everyone | Git/provider/test/runtime evidence | Every deployment and correction event | SHA, artifact hash, environment, migrations, validation, runtime QA, rollback and deviations | Both fields required; normal releases may use empty/null, while corrections and replacement records must link reciprocally without rewriting history |

## Required front matter

Every governed Markdown document should start with metadata equivalent to:

```yaml
---
id: DOC-ARCH-SYSTEM-CONTEXT
title: System context
status: current                 # proposed/current/accepted/blocked/deprecated/retired/historical/archived/superseded/rejected
owner_role: technical-owner
audiences: [engineering, operations, security]
authoritative_for: [system-context]
last_verified: 2026-07-21
review_cadence: quarterly-and-material-change
review_due: 2026-10-21
evidence_requirements:
  - repository-and-configuration-evidence
  - accepted-adrs
  - dated-provider-or-runtime-evidence
evidence:
  document_git_sha: ff3c8efe3d5e501286d8e83e28086d6d4590be27
  deployment_source_sha: 4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5
  deployment_version: 199
supersedes: []
superseded_by: null
classification: internal
retrieval: allowed
---
```

The registry repeats only indexable fields and points to the document. CI rejects duplicate IDs, multiple current authorities for one subject, any missing class-mandated lifecycle field, an empty owner, an invalid status, a missing or malformed last-verified date, an absent review cadence, evidence that does not satisfy the class requirements, an overdue verification or a broken/non-reciprocal supersession chain. Generic template defaults do not satisfy a missing document value.

## Status and evidence rules

- Use the audit taxonomy consistently: `VERIFIED DEPLOYED`, `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`, `PARTIAL`, `PLANNED ONLY`, `BLOCKED`, `BROKEN`, `STALE`, `CONTRADICTED`, `DEPRECATED`, `DEAD OR UNREACHABLE`, `UNKNOWN`, `NOT APPLICABLE`.
- A planned item must never appear under “current capability.”
- Implementation proof requires a current path/symbol/contract and tests where meaningful.
- Deployment proof requires the exact implementation SHA in the deployed artifact.
- Operational proof is dated and expires; an old health result becomes historical evidence.
- Missing provider access is `UNKNOWN` or `BLOCKED`, not healthy, empty or absent.
- A release entry is append-only. Corrections add a correction note rather than rewriting the historic observation.

## Templates

The lifecycle fields are repeated in each template contract intentionally. A template is invalid if it relies on the generic front-matter example to supply them.

### ADR

Required fields: ID, title, status, last verified date, owner, review cadence, evidence requirements, supersedes, superseded-by, decision date, context, forces, options with evidence, decision, consequences, risks, migration/rollback, measurable acceptance and validation.

### Runbook

Required fields: service/environment, purpose, status, last verified date, owner/on-call, review cadence, evidence requirements, supersedes, superseded-by, access prerequisite, safety boundary, trigger, diagnosis, exact ordered procedure, success signal, rollback, escalation, data/secret handling, expected duration range, last exercise, exercise evidence and known failure modes.

### Release record

Required fields: environment, status, last verified date, owner/operator, review cadence, evidence requirements, supersedes, superseded-by, source SHA, artifact/content hash, saved version, deployment ID, migration set/checksum, configuration revision, validation commands/results, approvals, runtime checks, security/privacy checks, rollback target and incidents/deviations.

### Provider record

Required fields: purpose, status, last verified date, owner/billing/deployment authority, review cadence, evidence requirements, supersedes, superseded-by, account/resource IDs (redacted), data classes/regions, credentials, scopes, limits, retries/timeouts, idempotency, webhooks, monitoring, support, export, backup/restore, exit plan, last operational proof and unknowns.

## Generated and validated documentation

1. Generate an OpenAPI inventory from route contracts or maintain one reviewed schema and test it against all route handlers. The current repository has 94 route files and 197 exported HTTP operations; prose cannot reliably remain the only catalogue.
2. Generate schema reference from `db/schema.ts` and migration checksums, but keep business ownership, retention and sensitivity annotations human-owned.
3. Generate a dependency/version page from manifests and lockfiles.
4. Validate local Markdown links, anchors, case, image references, application routes and API references on every change.
5. Validate external links on a scheduled, rate-limited job; record redirect/auth/network states separately from broken links.
6. Check official-source freshness and surface a review task before, not after, the review date.
7. Compare current release metadata with Sites/provider state and Git remote SHA; fail the “current truth” check on drift.
8. Treat diagram source as code. Mermaid diagrams should state whether they are current, configured, deployed or target architecture.

## AI retrieval design

Documentation retrieval should use registry records as the first filter:

- authorize the user for the document classification before retrieval;
- select only `current` documents unless the user explicitly asks for history;
- attach document ID, section anchor, Git SHA, last-verified and review-due metadata to each chunk;
- chunk by one heading plus its local table/list, not arbitrary token windows;
- never mix proposed and current chunks without explicit labels;
- exclude secrets, incident evidence, personal records and restricted runbooks from general indexes;
- retain exact source citations and deep links in every generated answer;
- return contradictions and expired sources rather than selecting one silently;
- invalidate/re-index on merged content or lifecycle changes;
- keep retrieval logs privacy-safe and free of document bodies where possible.

## Migration sequence for documentation only

1. Approve owners, audiences, lifecycle values and authoritative subjects.
2. Add the registry and metadata validator without moving files.
3. Register the current 23 tracked documents and label every conflict found in `04_DOCUMENTATION_TRUTH_AND_LINK_AUDIT.md`.
4. Create new current-truth documents from verified evidence; link, do not silently copy, release history.
5. Introduce ADR, runbook, release and provider templates.
6. Add link, staleness, API-route, migration and deployment-provenance checks.
7. Update navigation to the new audience-based index.
8. Redirect superseded documents, retain their Git history and move them to `archive/` only after link consumers are updated.
9. Pilot the read-only documentation assistant only after registry and authorization checks pass.

Acceptance requires 23/23 legacy documents registered, exactly one current authority for every declared subject, zero unresolved internal broken links, every governed document carrying explicit status, last verified date, owner, review cadence, evidence requirements, supersedes and superseded-by fields, planned/current separation tested, and a release record that reconciles Git SHA to the live provider version.
