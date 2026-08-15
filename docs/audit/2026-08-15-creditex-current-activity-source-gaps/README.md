# Creditex current activity source gap audit

Audit date: 15 August 2026 (Australia/Sydney)

Scope: all 192 `current` or `limited` rows in `CREDITEX_WORK_PACK_COVERAGE`

Verdict: **release blocked for every row**

## Outcome

The repository has a generic governed work-pack engine and discovery/calculation catalogues, but it does not have an approved activity-specific field form or complete effective-dated official source pack for any of the 192 rows.

Engine capability and operational content are separate:

- Generic work-pack engine support: 192/192.
- Published governed work-pack versions: 0/192.
- Governed field forms actually in place: 0/192.
- Independently reviewed product, scenario, calculator and effective-status decisions: 0/192.
- Field collection, completion, external submission and certificate or claim release enabled by this audit: 0/192.

Static catalogue presence, a government landing page, repository calculator metadata or a locally executable estimate does not make an activity operationally ready.

## Reproducible manifest

The exhaustive machine-readable inventory and its generator remain under `tmp/` because they are audit working evidence, not approved official source content or production seeds.

| Artifact | Contract or purpose | SHA-256 |
| --- | --- | --- |
| `tmp/creditex-current-activity-source-gap-inventory.json` | `creditex-current-activity-source-gap-inventory/v1`; 192 activity records and 30 program summaries | `a4c668c8c5bf54edd1dc6ef39287d2e418b8033faeff112ba04616ea1b448bc8` |
| Canonical inventory payload | Internal `inventorySha256`, calculated before adding that field | `2be244dce48f400e9c13ceeb989326ef232307869088ad0f25c3987f4402e1e5` |
| `tmp/generate-creditex-current-activity-source-gap-inventory.mjs` | Deterministic inventory generator from repository catalogues and explicit audit evidence | `59df502ace553ba9abb5d79f189756b7ef9e9668858fb610e7cefaf2d5a117f0` |
| `test/creditex-work-pack-governance-readiness.test.mjs` | Runtime readiness false-positive regression harness | `27d784824bf85cc3b0454c121d3e69cba2808745b63182a1cd561aa36c6c7ed2` |

The manifest records, per `activityTemplateId`:

- program, activity, catalogue state and operational output classification;
- primary official discovery pointer plus the exact effective rule, form, evidence, product, scenario and calculator sources still required;
- active, suspended, withdrawn or expired decision state;
- form, document, signer, visible signature-box and final-PDF requirements;
- explicit product, scenario and calculator applicability decisions, with blank values treated as unresolved;
- local implementation signals, their non-authority boundary, blockers and role-based next actions.

Input identity recorded inside the JSON includes:

- work-pack coverage canonical SHA-256: `c2f68a59ca36663f1a8ed637c8e946de6928539b24d92a9df1d103ab5e4164b3`;
- calculation coverage canonical SHA-256: `35e5ff0ff2bacff2504305a30be71c8b38ebe285f33d729bb842c364df124347`;
- exact SHA-256 and size for ten catalogue, calculator, source-register and operating-model input files.

## Coverage counts

| Measure | Count |
| --- | ---: |
| Activities | 192 |
| Programs | 30 |
| Catalogue state `current` | 172 |
| Catalogue state `limited` | 20 |
| Tradable certificate creation activities | 85 |
| Retailer-obligation claims that are not certificates | 50 |
| Other non-certificate rows | 57 |
| Rows that must not expose certificate-creation language or actions | 107 |
| Rows with source version and effective-from metadata | 115 |
| Rows missing source version and effective-from metadata | 77 |
| Exact official government artifacts found in source control | 0 |
| Rows with blank scenario code requiring a reviewed decision | 192 |
| Blank scenario rows that already have conflicting local scenario signals | 71 |
| Rows with blank product category requiring a reviewed decision | 1 |
| Local estimate pathways executable | 56 |
| Certificate actions supported by those estimates | 0 |

Calculation catalogue states are 50 `estimate_available`, 6 `partial_estimate_available`, 86 `governed_formula_required`, 23 `official_registry_required` and 27 `not_applicable`. A catalogue `not_applicable` label is not sufficient by itself. It still requires an exact source-cited, independently reviewed applicability decision.

## VEU activity 6 critical gap

`veu-6`, high-efficiency air-conditioner installation, is the highest-priority false-readiness risk:

- `productCategory` is blank even though local VEU calculator metadata identifies VEU product-registry inputs such as capacity, HSPF, TCSPF, GWP and configuration.
- `scenarioCode` is blank even though the same metadata identifies scenarios `i` through `xi`.
- The local formula key is `veu-part-6-equations-6.1-to-6.5/v2`, but its result remains a partial estimate and cannot support a certificate action.
- Exact VEU Specifications version 25 bytes and the current Part 6 rule, evidence guide, product registry, scenario definitions, formula inputs, forms and transition notices are not in governed custody or independently reviewed.
- The official VEU version 25 PDF URL returned HTTP 403 during this audit. No historic PDF or repository descriptor was substituted.

VEU activity 6 must remain blocked until all those dependencies are retained, bound to the exact work-pack version and independently approved.

## Exact official artifacts located during the audit

Two current primary-source PDFs were retrieved from official NSW government URLs and byte-verified in the system temporary folder:

| Program artifact | Effective from | Bytes | Pages | SHA-256 |
| --- | --- | ---: | ---: | --- |
| Energy Savings Scheme Rule of 2009, 1 July 2026 | 2026-07-01 | 2,118,820 | 198 | `de5e1badf45a19b2a8903b2fd29ad62d64db04fbf2fdb2e8a2d68dea3296ac51` |
| Peak Demand Reduction Scheme Rule of 2022, 1 July 2026 | 2026-07-01 | 710,172 | 43 | `0af5ccd5c431853c1b339d0887512ab0daf25335b129295b47a9cbca0da86c77` |

These files are audit evidence only. They are not source-controlled, uploaded to Creditex official-source custody, bound to an activity, transcribed into forms or independently approved. They therefore do not make any NSW row ready.

The repository also declares expected hashes for five SRES lookup or product-registry releases. Their exact source bytes were not found in source control and they are not bound to work packs, so they remain acquisition targets rather than approved evidence.

## Source and acquisition gaps

- The repository contains discovery manifests and a manual exact-byte custody engine, but no all-activity official-source downloader, transcriber or form generator.
- `scripts/audit-links.mjs` checks links only. It does not retain exact bytes, determine effective editions, incorporate subordinate documents, transcribe rules or create approved forms.
- Seventy-seven rows have only a landing or discovery pointer without exact publication version and effective date.
- Eighty-seven rows have a version/effective descriptor but no exact governed bytes.
- Twenty-eight rows have repository review labels that are not exact official publication versions.
- Product, scenario and calculator applicability must be decided independently from exact rules. Blank metadata must never be converted to `not_applicable` by default.
- Every activity still needs its exact current forms, evidence policy, product and scenario sources, calculator source or reviewed non-applicability decision, visible signer mappings and immutable final-output definition.

## Release gate

An activity may become operational only when all of the following are true:

1. Exact current official rule and incorporated document bytes are retained with official URL, title, version, effective dates, size, SHA-256 and immutable custody object identity.
2. A source-cited active, suspended, withdrawn or expired decision is independently reviewed.
3. Activity-specific evidence policy, guided form schema, required documents, signer capacities, visible signature boxes, prefill mappings and immutable final-PDF mappings are published from those exact sources.
4. Product, scenario and calculator applicability each has an explicit source-cited reviewed decision. Blank metadata is unresolved, not not-applicable.
5. Every required product registry snapshot, scenario table, formula, lookup, golden vector, execution receipt and official reconciliation is exact-version bound and independently approved.
6. The policy author and reviewer are different named people, and the reviewer records a non-empty note, review time and exact artifact/version/schema identities.
7. The exact runtime resolver passes without stale, duplicate, withdrawn, incomplete or missing bindings.
8. Non-certificate rows cannot expose certificate-creation language or actions.
9. Focused governance regressions and affected broader validation pass, followed by signed-in desktop and phone checks before publication.

Until then, the row must remain visible for acquisition work but blocked from field completion, certificate or claim action and external submission.

## Validation

The audit artifacts were validated with:

```powershell
node --experimental-strip-types tmp/generate-creditex-current-activity-source-gap-inventory.mjs
node --experimental-strip-types --test test/creditex-work-pack-governance-readiness.test.mjs
npm.cmd exec -- eslint test/creditex-work-pack-governance-readiness.test.mjs tmp/generate-creditex-current-activity-source-gap-inventory.mjs
```

Results at this checkpoint:

- deterministic inventory generated with 192 unique activities and 30 program summaries;
- canonical internal inventory SHA-256 recomputed successfully;
- 17/17 runtime harness tests passed, including nine strict readiness regression contracts;
- focused ESLint passed;
- owned-file whitespace and patch checks passed.

This audit did not publish a governed activity version, approve source content, enable a form, change production data or deploy a release.
