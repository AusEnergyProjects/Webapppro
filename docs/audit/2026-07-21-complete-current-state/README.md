# Complete current-state audit — reading guide

Audit date: 21 July 2026 (Australia/Sydney)<br>
Audit verdict: **AUDIT INCOMPLETE**<br>
Final repository checkpoint: `ff3c8efe3d5e501286d8e83e28086d6d4590be27`<br>
Deployed application: Sites version 199 from `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`

The 22 required audit documents are complete. The verdict remains `AUDIT INCOMPLETE` because ten external evidence classes—provider ownership/export/restore, production data, Firebase/provider accounts, durable operations, isolated authenticated journeys, recovery/load/accessibility/device proof and legal/industry facts—remain inaccessible, and complete raw command/tool provenance was not retained as the separate eleventh gap. The local repository scope is fully disposed: 675/675 tracked files, 23/23 original documents, 41/41 pages, 94/94 API route files, 197/197 HTTP operations, 145/145 regular tables and 79/79 production migrations.

## Start here

1. Read [01_EXECUTIVE_PRODUCT_SUMMARY.md](01_EXECUTIVE_PRODUCT_SUMMARY.md) for the product, business, hosting, maturity, ten highest risks and plain-English verdict.
2. Read [18_FINDINGS_RISKS_ASSUMPTIONS_AND_DECISIONS.md](18_FINDINGS_RISKS_ASSUMPTIONS_AND_DECISIONS.md) for the authoritative finding/unknown/contradiction registers and owner decisions.
3. Read [17_MOVE_OFF_SITES_DECISION_AND_PLAN.md](17_MOVE_OFF_SITES_DECISION_AND_PLAN.md) for the explicit `MIGRATE THE COMPLETE PRODUCTION APPLICATION` decision and reversible migration design.
4. Read [19_FORMAL_ROADMAP.md](19_FORMAL_ROADMAP.md) for dependency order, measurable gates, staffing scenarios and stop conditions.
5. Read [00_AUDIT_MANIFEST_AND_COVERAGE.md](00_AUDIT_MANIFEST_AND_COVERAGE.md) and [20_EVIDENCE_INDEX_AND_COMMAND_LOG.md](20_EVIDENCE_INDEX_AND_COMMAND_LOG.md) before relying on any completeness or runtime claim.

## Critical conclusions

- The product is a combined household energy-comparison/planning, assessment-intake, protected marketplace, customer portal, CRM/trade workflow/field-service, invoicing/payment-status and asset/service platform.
- The current application is broad and well tested at source level, but the combined Sites architecture is **not suitable for a business-critical production CRM**.
- Current Sites terms prohibit initiating/executing/otherwise facilitating financial transactions; the application contains Stripe/Square checkout creation. Activation on Sites is blocked pending written provider/legal determination or migration.
- Sites has no data/inference residency at launch, including Site code, D1/R2, artifacts and logs.
- Independent owner control, complete D1/R2 export, off-platform backup, PITR, restored copy, transfer and workspace-outage behavior remain unproven.
- The Database Console became externally committed/pushed/deployed during this read-only audit. It exposes no arbitrary SQL or bulk mutation, but its default-visible browsing covers 145 tables and generic insert/delete bypasses domain services. The audit recommends withdrawing it, abandoning generic mutation, and using only explicit projected read-only diagnostics plus named domain repair commands where justified.
- The recommended target is an owner-controlled managed modular monolith with managed PostgreSQL, versioned object storage, owner-controlled identity/secrets/jobs/observability/CI and an Australian-region posture where requirements demand it. Kubernetes/microservices are not justified by current evidence.

## Evidence status language

Every report uses the required taxonomy:

- `VERIFIED DEPLOYED`
- `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`
- `PARTIAL`
- `PLANNED ONLY`
- `BLOCKED`
- `BROKEN`
- `STALE`
- `CONTRADICTED`
- `DEPRECATED`
- `DEAD OR UNREACHABLE`
- `UNKNOWN`
- `NOT APPLICABLE`

Documentation is intent/history evidence, not implementation or deployment proof. A configured binding is not resource ownership. A green local test is not a live provider or recovery test. Missing evidence remains `UNKNOWN`.

## Snapshot warning

The repository changed during the audit:

- A: `543cc189` plus dirty Database Console evidence, production v198;
- B: clean `4a5cd19` console implementation, initially without deployment proof;
- C: Sites v199 deployed from `4a5cd19` while release records transitioned;
- D: final clean `ff3c8ef` documentation-only child recording v199.

Use `ff3c8ef` for final repository/document truth and `4a5cd19` for deployed application source. Do not merge these into one SHA.

## Document index

| Order | Document | Use it for |
| ---:| --- | --- |
| 00 | [Audit manifest and coverage](00_AUDIT_MANIFEST_AND_COVERAGE.md) | Verdict, identity, deterministic inventory/dispositions, access and exact continuation checkpoint |
| 01 | [Executive product summary](01_EXECUTIVE_PRODUCT_SUMMARY.md) | One-pass product/business/workflow/hosting/maturity/risk explanation |
| 02 | [Industry, business and glossary](02_INDUSTRY_BUSINESS_AND_GLOSSARY.md) | Australian industry primer, actors, value chain, workflows, primary-source applicability and terminology |
| 03 | [Product feature and workflow status](03_PRODUCT_FEATURE_AND_WORKFLOW_STATUS.md) | 31 current grouped feature rows, 11 future/blocked/deprecated rows and deployment-status reconciliation |
| 04 | [Documentation truth and link audit](04_DOCUMENTATION_TRUTH_AND_LINK_AUDIT.md) | All 23 original docs, canonical/stale/contradicted status, unfinished markers and link results |
| 05 | [Current architecture and technology](05_CURRENT_ARCHITECTURE_AND_TECHNOLOGY.md) | Business/system/data/auth/deployment diagrams and technology/runtime inventory |
| 06 | [Hosting, ownership and CRM suitability](06_HOSTING_OWNERSHIP_AND_CRM_SUITABILITY.md) | Component provider/control matrix, Sites/D1/R2 boundary and suitability judgments |
| 07 | [Frontend, UX and accessibility](07_FRONTEND_UX_AND_ACCESSIBILITY.md) | All 41 pages, navigation, errors, responsive behavior, skip-link/dialog findings and test gaps |
| 08 | [Backend, APIs, Worker and jobs](08_BACKEND_API_WORKERS_AND_JOBS.md) | All 94 route files/197 operations, Worker, cron, delivery ledgers and backend risks |
| 09 | [Data, database, storage and migrations](09_DATA_DATABASE_STORAGE_AND_MIGRATIONS.md) | All 145 tables/79 migrations, zero foreign keys, journal drift, D1/R2 lifecycle/recovery |
| 10 | [Authentication, security, privacy and compliance](10_AUTH_SECURITY_PRIVACY_AND_COMPLIANCE.md) | Identity/roles/object checks, threat paths, privacy handling and applicability gaps |
| 11 | [External integrations](11_EXTERNAL_INTEGRATIONS.md) | 21-provider/system inventory, data flows, environment-key evidence, reliability and manual recovery |
| 12 | [Testing, deployment, operations and resilience](12_TESTING_DEPLOYMENT_OPERATIONS_AND_RESILIENCE.md) | Executed tests/checks, release provenance, CI, liveness/readiness, telemetry, capacity and DR |
| 13 | [Database Console security review](13_DATABASE_CONSOLE_SECURITY_REVIEW.md) | Exact deployed behavior, threat matrix, control gaps and withdrawal/redesign decision |
| 14 | [AI navigation and platform intelligence](14_AI_NAVIGATION_AND_PLATFORM_INTELLIGENCE.md) | Deterministic search/navigation first, bounded cited AI later, authorization/evaluation controls |
| 15 | [Recommended documentation architecture](15_RECOMMENDED_DOCUMENTATION_ARCHITECTURE.md) | Future hierarchy, registry, owners, lifecycle, templates, link/staleness automation and retrieval |
| 16 | [Production platform options](16_PRODUCTION_PLATFORM_OPTIONS.md) | Minimal, balanced and enterprise architecture classes plus AWS/Azure/GCP/Cloudflare capability evidence |
| 17 | [Move-off-Sites decision and plan](17_MOVE_OFF_SITES_DECISION_AND_PLAN.md) | Five options, explicit verdict, target, reversible export/shadow/cutover/rollback sequence |
| 18 | [Findings, risks, assumptions and decisions](18_FINDINGS_RISKS_ASSUMPTIONS_AND_DECISIONS.md) | Stable detailed findings, category registers, contradictions, unknowns and owner decision packets |
| 19 | [Formal roadmap](19_FORMAL_ROADMAP.md) | Dependency phases, acceptance/runtime gates, staffing assumptions, rollout/rollback and stop conditions |
| 20 | [Evidence index and command log](20_EVIDENCE_INDEX_AND_COMMAND_LOG.md) | Commands/results, source index, citations, coverage ledger, inaccessible evidence and continuation order |

## Reading paths by role

### Business owner

Read 01 -> 18 owner decisions -> 17 -> 19. Then review the industry/privacy decision boundaries in 02 and hosting control in 06.

### Engineer or architect

Read 00 -> 05 -> 08 -> 09 -> 10 -> 11 -> 12 -> 13 -> 16 -> 17 -> 19 -> 20.

### Product or operations owner

Read 01 -> 03 -> 04 -> 06 -> 07 -> 11 -> 12 -> 18 -> 19.

### Privacy, security or industry reviewer

Read 02 -> 06 -> 09 -> 10 -> 11 -> 13 -> 18 -> 20. Confirm actual legal entity, services, jurisdictions, qualifications and provider contracts rather than relying on code.

### Documentation or AI/search owner

Read 04 -> 14 -> 15 -> 18 -> 19. Canonical document governance and retrieval authorization are prerequisites for any cited assistant.

## Immediate owner decisions

1. Block Sites payment initiation or accept an explicitly counsel/provider-reviewed risk while obtaining written OpenAI confirmation.
2. Withdraw the generic Database Console or accept a tightly time-bounded exposure while replacement controls are prepared.
3. Name the legal/billing/data/security owners and two human administrators for every production component.
4. Approve complete export/backup/restore investigation and later execution in an isolated owner-controlled target.
5. Define legal entity, privacy/residency, services/jurisdictions and qualification/claim boundaries.
6. Select first-release providers only after account/scope/sandbox/reconciliation evidence.
7. Choose a target provider/region from approved requirements; the audit recommends the architecture class, not a vendor purchase.

## Validation summary

- 675/675 tracked files disposed; 383 deep, 216 mechanical, 76 excluded with reason, zero inaccessible.
- 23/23 original documents reconciled; 13/13 internal Markdown links valid.
- 41/41 pages, 94/94 API routes, 197/197 HTTP operations, 145/145 regular tables and 79/79 migrations represented.
- Full Node suite repeatedly reported 699 total, 697 pass, zero fail, two fixture-dependent skips.
- ESLint, root/mobile TypeScript, focused Database Console tests and fresh replay of all 79 migrations passed.
- Link command remained non-zero: 177 checked, 171 non-broken including 16 automation-blocked, six reported broken; one credible ReAmped public-link defect.
- No tracked file outside this audit directory was changed by the audit.

The exact commands, evidence layers, non-run checks and external gaps are in report 20. Do not execute roadmap work from this folder without a separately scoped, authorised task.
