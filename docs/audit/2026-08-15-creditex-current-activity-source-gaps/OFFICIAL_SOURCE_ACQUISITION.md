# Official source acquisition supplement

Audit date: 15 August 2026 (Australia/Sydney)

Scope: exact-byte acquisition from primary Australian government and regulator sources for all 30 programmes and all 192 `current` or `limited` catalogue rows in the adjacent source-gap audit.

## Outcome

This pass acquired 171 canonical source identities represented by 178 physical task-temp copies:

- 167 are exact government or regulator source identities and are marked `custodyIngestionCandidate: true` in the deterministic manifest.
- 4 are programme-administrator sources and are explicitly excluded from government/regulator custody-ingestion candidates.
- 110 physical PDFs were parsed and rendered. After duplicate official URL and SHA-256 identities were collapsed, 107 canonical PDF sources have verified page counts and first-page renders.
- 20 DOCX/XLSX sources opened as valid ZIP containers and all 6 CSV product/register sources parsed successfully.
- 5 official source attempts remain unresolved: four HTTP 403 responses and one HTTP 404 response.

This changes the acquisition evidence, not the readiness verdict. All 192 rows remain incomplete and blocked. Exact bytes alone do not establish currency, incorporation, activity applicability, custody, transcription, independent review, or operational approval.

No file acquired here was seeded to D1, uploaded to R2, bound to an activity, treated as Creditex-approved, or published. Raw source bytes remain under `tmp/official-sources/**` until a controlled custody and independent-review import is available.

## Deterministic evidence

| Artifact | Purpose | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `tmp/official-sources/source-manifest.json` | 171 canonical sources, 5 failures, 30 programme summaries and 192 row-level completeness records | 609,958 | `56a1fd50cea659f3d7e81d413f1fd69a7aeeefe6149501aef4291c8e8a9b66a3` |
| `tmp/official-sources/pdf-inspection.json` | Page counts, extracted first-page text and rendered first-page identity for 110 physical PDFs | generated audit evidence | `f324c39a52fcdffb680ec049c9c0a4d6029f4e6a7d424166e943e96f51547f9d` |
| `tmp/official-sources/build-source-manifest.mjs` | Deterministic manifest builder with exact-byte and SHA-256 verification | generated audit tool | `95e68d2216a0a681be8d7793b36426b65277f6eb2458c240bef129cb9f28f6d4` |
| `tmp/creditex-current-activity-source-gap-inventory.json` | Existing exhaustive 192-row source-gap inventory joined by `activityTemplateId` | existing audit evidence | `a4c668c8c5bf54edd1dc6ef39287d2e418b8033faeff112ba04616ea1b448bc8` |

The source manifest was generated twice without changing inputs. Both runs produced SHA-256 `56a1fd50cea659f3d7e81d413f1fd69a7aeeefe6149501aef4291c8e8a9b66a3`.

Each canonical source entry records its primary official URL, final URL, HTTP status, content type, official filename, title, stated version/effective date where established, exact bytes, SHA-256, local temp copies, source class, programme applicability, page count/render for PDFs, and review boundary. Each of the 192 activity entries explicitly records every operational completeness flag as false.

## Sources that can enter controlled custody

The 167 entries with `authorityClass: government_or_regulator`, HTTP 200, exact bytes and SHA-256 are suitable candidates for an immutable original-byte custody import. The complete candidate list is the `sources[]` subset where `custodyIngestionCandidate` is `true` in `source-manifest.json`.

Custody import must preserve the exact original bytes, URL, final URL, retrieved content type, size and hash. It must not automatically mark an edition current, bind it to all activities in a programme, transcribe a form, approve a formula, or enable a claim/certificate action. Linked downloads and direct curated artifacts remain independently reviewable even when the bytes are authentic.

The 4 administrator-only entries are not in that candidate set:

- NT-FIT administrator tariff material.
- QLD-FIT administrator tariff material.
- WA-BATTERY-REWARDS administrator material.
- One shared WA-DEBS / WA-HORIZON-BUYBACK administrator pricing source.

WA-DEBS has both an exact government source and a separate administrator source; only the government source is a custody-ingestion candidate under this audit boundary.

## Priority source identities

### VEU version 25 and Activity 6

The earlier raw-download failure was resolved through the same official Victorian Government download path without bypassing access controls.

| Field | Verified value |
| --- | --- |
| Official URL | `https://www.energy.vic.gov.au/__data/assets/pdf_file/0041/795488/Victorian-Energy-Upgrades-Specifications-2018-Version-25.pdf` |
| Final URL | same as official URL |
| HTTP/content type | `200`, `application/pdf` |
| Official title/version | Victorian Energy Upgrades Specifications 2018, Version 25.0 |
| Effective | Version 25.0 from 21 July 2026; the document states revised Part 6 multi-split calculations and minimum co-payments apply from 30 September 2026 |
| Bytes/pages | 2,545,202 bytes, 165 pages |
| SHA-256 | `01d7f1725754a6d7a93058d844269ba88da4c5f7a054938e59f7e07e28d09fcd` |
| Manifest source ID | `source-bae06fe94f599b437f41` |

The VEU set now contains 16 canonical exact government/regulator sources, including the current Act and Regulations, VEU Guidelines v16, Obligations and Program Guide v3.8, Code of Conduct Guideline v1.3, Water Heating and Space Heating/Cooling Activity Guide v3.20, product-application guides, consumer factsheets and additional current-linked VEU artifacts.

VEU Activity 6 is still not a complete source pack. Missing dependencies include the exact public product-register export and status history applicable on the activity date, every scenario/evidence/form requirement incorporated by the current rules, AP portal form/upload schemas, complete transition handling, typed calculation inputs and independently reviewed golden vectors. Portal-only material requiring login was not accessed or bypassed.

### NSW ESS and PDRS

| Programme artifact | Official URL | Effective | Bytes | Pages | SHA-256 |
| --- | --- | --- | ---: | ---: | --- |
| Energy Savings Scheme Rule of 2009, 1 July 2026 | `https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Energy-Savings-Scheme-Rule-of-2009-1-July-2026.PDF` | 1 July 2026 | 2,118,820 | 198 | `de5e1badf45a19b2a8903b2fd29ad62d64db04fbf2fdb2e8a2d68dea3296ac51` |
| Peak Demand Reduction Scheme Rule of 2022, 1 July 2026 | `https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Peak-Demand-Reduction-Scheme-Rule-of-2022-1-July-2026.PDF` | 1 July 2026 | 710,172 | 43 | `0af5ccd5c431853c1b339d0887512ab0daf25335b129295b47a9cbca0da86c77` |

The manifest contains 10 canonical NSW-ESS sources and 4 canonical NSW-PDRS sources. These include current rule pages, HEER v4.8, IHEAB v4.3, PDRS Method v3.0, July 2026 reference tables, general ACP requirements and current declaration/nomination templates.

Neither programme is complete. Remaining requirements include every applicable current method and activity guide, accepted-product/register snapshots and status changes, activity-specific evidence/forms/declarations, typed formula and lookup sources, official examples or independently derived golden vectors, and exact activity-level incorporation review.

### CER SRES and STCs

The SRES set contains 43 canonical exact government/regulator sources. It includes current Commonwealth instruments, CER guidance and declaration material, postcode-zone sources, assignment and mandatory-data guides, battery evidence guides, and live CER PV module, inverter, battery, solar-water-heater and air-source heat-pump lists in CSV/XLSX formats.

| Instrument | Official URL | Version/effective | Bytes | Pages | SHA-256 |
| --- | --- | --- | ---: | ---: | --- |
| Renewable Energy (Electricity) Act 2000 | `https://www.legislation.gov.au/C2004A00767/2026-01-01/2026-01-01/text/original/pdf` | Compilation No. 34, 1 January 2026 | 933,705 | 232 | `478e7735d8e4cd89c988bcd7f7e2eac316fd09c831796eab3c5e92c760309343` |
| Renewable Energy (Electricity) Regulations 2001 | `https://www.legislation.gov.au/F2001B00053/2026-05-01/2026-05-01/text/original/pdf` | Compilation No. 90, 1 May 2026 | 1,697,039 | 369 | `1926144f85f5049b1382a1e32ac31f1a530f43cc4f6e2a83a50eeea668937f5a` |
| Renewable Energy (Electricity) Method for Solar Water Heaters Determination 2016 | `https://www.legislation.gov.au/F2017L00028/2022-01-01/2022-01-01/text/original/pdf` | Compilation No. 2, 1 January 2022 | 1,012,482 | 24 | `42cf0f24a2d5791b4e6bfe52ba59bc8044b14ca176714fb20f83cadfe3dfa243` |

CSV structural validation parsed 1,178 air-source heat-pump rows, 4,688 inverter rows, 4,529 PV module rows, 3,526 solar-battery rows, 6,591 solar-water-heater rows below 700 L and 8,989 rows above 700 L. These counts are retrieval/parse evidence, not an approved product eligibility decision.

SRES remains incomplete because the exact current SGU calculation instrument or regulator implementation, product-list release semantics and effective status decisions, complete registry schemas, official calculator vectors/reconciliation, and remaining activity-specific declarations/evidence have not all been source-bound and independently approved.

## Exact 192-row completeness matrix

`Complete rows` means a row has its complete effective rule/status, forms/evidence, product/scenario and calculation source pack. Every value is zero. The programme rows total exactly 192 current/limited catalogue rows.

| Programme | Rows | Exact gov/reg sources | Admin-only sources | Failed official attempts | Complete rows | Primary remaining subordinate-source gap |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| ACT-EEIS | 24 | 4 | 0 | 0 | 0/24 | Activity rule applicability, forms/evidence, products and calculation vectors |
| ACT-HES | 2 | 7 | 0 | 0 | 0/2 | Eligibility, approved products/providers, install and claim evidence |
| ACT-SBP | 2 | 1 | 0 | 0 | 0/2 | Eligibility, measures, calculation and application/claim forms |
| ACT-SFA | 1 | 2 | 0 | 0 | 0/1 | Funding terms, technical/product evidence and completion forms |
| ACT-SHS | 1 | 8 | 0 | 0 | 0/1 | Products/providers, loan/install evidence and completion documents |
| NSW-ESS | 42 | 10 | 0 | 0 | 0/42 | Remaining method/form/register packs, formulas and vectors |
| NSW-HES | 12 | 2 | 0 | 0 | 0/12 | Lender terms, products/installers, evidence and claim schemas |
| NSW-PDRS | 6 | 4 | 0 | 0 | 0/6 | Remaining methods/forms/registers, formulas and vectors |
| NSW-SAR | 1 | 4 | 0 | 0 | 0/1 | Installer/product eligibility, payment evidence and forms |
| NT-FIT | 1 | 1 | 1 | 0 | 0/1 | Retailer tariff mapping, eligibility, metering and contracts |
| NT-SMD | 4 | 2 | 0 | 1 | 0/4 | Landing 403; current forms, products and technical evidence |
| QLD-FIT | 2 | 1 | 1 | 0 | 0/2 | Voluntary retailer rates/contracts, eligibility and tariff mapping |
| QLD-HER | 1 | 1 | 0 | 0 | 0/1 | NatHERS method/software/assessor and evidence sources |
| QLD-QCHEU | 13 | 4 | 0 | 0 | 0/13 | Project funding, products/providers, contracts and acquittal forms |
| QLD-SSR | 3 | 9 | 0 | 0 | 0/3 | Approval/payment, product/installer status and install evidence |
| SA-REPS | 26 | 29 | 0 | 2 | 0/26 | Gazette/referral 403, incorporation, products, forms and calculations |
| SOLAR-VIC-APT | 1 | 2 | 0 | 0 | 0/1 | Retailer/installer terms, product lists, portal/forms and claims |
| SOLAR-VIC-CH | 1 | 2 | 0 | 0 | 0/1 | Retailer/installer terms, product lists, portal/forms and claims |
| SOLAR-VIC-HW | 1 | 3 | 0 | 0 | 0/1 | Retailer/installer terms, product lists, portal/forms and claims |
| SOLAR-VIC-PV | 1 | 3 | 0 | 0 | 0/1 | Retailer/installer terms, product lists, portal/forms and claims |
| SOLAR-VIC-RENTAL | 1 | 5 | 0 | 0 | 0/1 | Retailer/installer terms, product lists, landlord forms and claims |
| SRES | 6 | 43 | 0 | 0 | 0/6 | SGU method, release/status semantics, schemas and calculation vectors |
| TAS-FIT | 1 | 4 | 0 | 0 | 0/1 | Retailer tariff mapping, eligibility, metering and contracts |
| TAS-NILS-ES | 2 | 0 | 0 | 1 | 0/2 | Official page 403; terms, products/providers and forms |
| TAS-POWERSMART | 1 | 2 | 0 | 0 | 0/1 | Application, audit/report, product, install and payment schemas |
| VEU | 31 | 16 | 0 | 0 | 0/31 | Product/status registers, all forms/guides, portal schemas and calculations |
| WA-BATTERY-REWARDS | 1 | 0 | 1 | 0 | 0/1 | Government instrument, eligibility, products/VPP and evidence forms |
| WA-DEBS | 1 | 1 | 1 | 0 | 0/1 | Government tariff terms, eligibility, metering and contracts |
| WA-HORIZON-BUYBACK | 1 | 0 | 1 | 0 | 0/1 | Government instrument, eligibility, metering and contracts |
| WA-RBS | 2 | 1 | 0 | 1 | 0/2 | Current PDF 404, products/VPP, technical requirements and forms |
| **Total** | **192** | **programme-applicable counts, not additive source identities** | **programme-applicable counts** | **5** | **0/192** | **No row has a complete independently reviewed source pack** |

The source counts in this table are programme-applicable counts. Shared artifacts can apply to multiple Solar Victoria programmes, so those counts must not be summed to reproduce the 167 unique government/regulator identities.

## Unresolved exact source attempts

| Programme | URL | Result | Boundary |
| --- | --- | --- | --- |
| NT-SMD | `https://nt.gov.au/industry/business-grants-funding/solar-for-multi-dwellings-grant-scheme` | HTTP 403 | No bypass; official terms/sample were acquired separately, but the complete source pack is still missing |
| SA-REPS | `https://www.governmentgazette.sa.gov.au/2024/August/2024_055.pdf` | HTTP 403 | No cached or historic substitute used |
| SA-REPS | `https://www.sa.gov.au/__data/assets/pdf_file/0011/685901/210702-REPS-referral-form.pdf` | HTTP 403 | No cached or historic substitute used |
| TAS-NILS-ES | `https://www.recfit.tas.gov.au/grants_programs/energy/energy_bill_relief` | HTTP 403 | No bypass or administrator substitution used |
| WA-RBS | `https://www.wa.gov.au/system/files/2026-05/wa_residential_battery_scheme_requirements_217409.pdf` | HTTP 404 | Official HTML was retained; the missing PDF was not substituted |

## Validation performed

- Recomputed every retained body size and SHA-256 while building the manifest. Any mismatch fails generation.
- Parsed all 110 physical PDFs, extracted page counts/text and rendered every first page. The aggregate contact sheet and targeted VEU, NSW and Commonwealth first pages were visually inspected.
- Opened all 20 DOCX/XLSX artifacts as ZIP containers; 20/20 were structurally readable.
- Parsed all 6 CSV registry/product files; 6/6 succeeded.
- Regenerated `source-manifest.json` twice from unchanged inputs and obtained identical bytes and SHA-256.
- Confirmed the manifest contains 30 programme summaries and exactly 192 row-level entries, all with `operationallyReady: false`.

## Remaining release boundary

No operational source pack can be released from this acquisition alone. Each row still needs exact effective-edition selection, incorporated subordinate sources, immutable custody, activity-level binding, governed form/schema transcription, visible signature and document mappings where required, product/scenario/calculation applicability decisions, independent named review, runtime resolution tests and release validation.
