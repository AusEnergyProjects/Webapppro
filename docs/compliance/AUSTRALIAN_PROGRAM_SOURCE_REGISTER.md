# Australian energy program source register

Status: controlled discovery baseline, not an eligibility or calculation authority

Reviewed: 10 August 2026

Owner: TLink compliance domain with independent source verification and Creditex operational review required before publication

## Purpose and use boundary

This register identifies Australian certificate, retailer-obligation, grant, loan, tariff and network programs that can affect a trade-led energy upgrade. It is the discovery input for the versioned TLink compliance catalogue. It must not be used by itself to decide eligibility, calculate an incentive, set a customer price, create a certificate or submit a claim.

Every operational activity must be entered as an immutable, effective-dated activity version with its own official source, content SHA-256, jurisdiction, scenario and exact government product, evidence and calculation rules. Creditex approves the accuracy and operational use of that transcription within its accreditation and contractual scope; it does not author a private scheme rule. A program appearing here does not make it selectable in TLink.

The public sources reviewed do not support the claim that every Australian incentive creates a carbon certificate. The output types are materially different:

| Scheme kind | Examples | Operational output |
| --- | --- | --- |
| `certificate` | SRES, LRET, REGO, VEU, NSW ESS, NSW PDRS | STC, LGC, REGO, VEEC, ESC or PRC subject to the exact scheme |
| `project_credit` | ACCU Scheme | ACCUs after project registration, reporting and audit |
| `retailer_obligation` | ACT EEIS, SA REPS | Verified savings or productivity credited to an obliged retailer, not an open tradie certificate |
| `grant` | NSW Home Energy Saver discount, QLD solar for renters | Approved reimbursement or discount under program terms |
| `loan` | NSW Home Energy Saver loan, ACT Sustainable Household Scheme | Finance approval and settlement, not a certificate |
| `tariff` | WA DEBS, Tasmania and NT feed-in tariffs | Retail or regulated energy payment |
| `network` | demand response, connection and VPP programs | Network approval, demand response enrolment or tariff outcome |

TLink must never expose one generic `certificates_created` field across these programs. Calculation outputs must be typed and separated from eligibility, submission and regulator-issued state.

## Creditex public program position

Creditex states that its trading business creates and trades certificates and manages compliance nationwide for hot-water heat pumps, air conditioners, solar batteries and other energy-saving solutions. Its public accreditation claims reviewed on 8 August 2026 are:

- VEU Accredited Person A1107;
- NSW ESS Accredited Certificate Provider ACC0000107;
- NSW PDRS accreditations RDUE ACC0000108, SASC ACC0076224 and HADR ACC0076225;
- federal RET registered-agent accreditation 47056; and
- South Australian REPS activity-provider listing for residential WH1, HC2A and HC2B, which is not a public tradeable-certificate accreditation.

Sources: [Creditex Trading](https://trading.creditex.com.au/), [Creditex certificate services](https://trading.creditex.com.au/certificates/) and [ESCOSA REPS activity providers](https://www.escosa.sa.gov.au/industry/reps/obliged-retailers-activity-providers/technical-activity-providers).

The NSW Government also names Creditex as the delivery partner for the coming Home Energy Saver household discounts. The discount rules, evidence payload and operating interface were not public on 8 August 2026, so that program must remain future and disabled. Sources: [Home Energy Saver](https://www.energy.nsw.gov.au/households/grants-rebates/home-energy-saver) and [NSW announcement naming Creditex](https://www.energy.nsw.gov.au/news/energy-savings-nsw-households-loans-and-discounts-help-families-lower-their-bills).

## Current calculator and registry status

The controlled national catalogue covers 35 program pathways and 216 activity
templates. The released calculator exposes 50
`estimate_available` plus 6 `partial_estimate_available`, for 56 of 216
executable templates, and keeps 160 blocked or non-executable. Certificate
actions enabled remain 0. The sealed coverage hash is
`sha256:35e5ff0ff2bacff2504305a30be71c8b38ebe285f33d729bb842c364df124347`.
That sealed count describes implemented formula coverage, not current registry
availability. In version 301, every GEMS-backed pathway fails closed while the
reviewed official-row decrease leaves the registry
`OFFICIAL_PRODUCT_REGISTRY_STALE`.

Creditex administrators and active verified installers can use the same
source-pinned calculator contract. The TLink trade dashboard surface is
estimate-only for quote and invoice preparation and grants no registry-refresh,
certificate-creation, submission, trading or settlement authority.

The shared quote flow follows a short activity, plain-English scenario, date,
brand, model, postcode and formula-input sequence. It omits compliance
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

Milestone `AEA-IMMERSIVE-CUSTOMER-JOURNEY-49` is released from exact application
commit `bc4096d61cb493e819555d72113d0c77d45a1653`, pushed to the GitHub branch and
Sites internal `main`, as Sites version 301 through deployment
`appgdep_6a7898485dd48191acb31466092b5fe8` with environment revision 19 at
`https://compare.ausenergyassessments.com`. The semantic lightweight CSS and HTML
spatial public home uses no canvas, WebGL or video, respects reduced-motion
preferences and is responsive across desktop, laptop and mobile layouts. The
planner is task-first, results provide a clear `Start here` action and the TLink
logo links directly to the trade dashboard. The trade route remains static and
does not mount public animation.

Quote mode supports mixed exact approved SRES solar-water-heater and
air-source-heat-pump rows and VEU 1C, 1D, 3C and 3D rows, with up to 10 systems
in one estimate. Strict compliance remains fail-closed at one unit. Quote
flexibility does not create certificate authority or relax exact product,
effective-date or formula validation. No customer-shareable rebate receipt was
added.

Milestone `AEA-CALCULATOR-USABILITY-AUTHORITY-48` is historical Sites version
300 from exact application commit
`ca3d84a497258426c7ab34c87e8059df1cba2a27` through deployment
`appgdep_6a7875602838819182dc5ba7dec6366b`. It added the anonymous quote-only
calculator without compliance or certificate authority, a simpler
one-question customer planner, explicit Activity 15 weather-sealing scenarios,
future-date selection inside official windows, identical-model quantity support
and repeatable VEU Part 6 indoor-unit selection.

The released source also includes an official TESSA D17 to D20 automatic
registry implementation. The
live official source used for validation contained 746 rows, comprising 663
`Active` and 83 `Cancelled`, with source SHA-256
`3770ac57885bbd968e35e25c67b4546e9ff6d4325c63cf4c4592a9b5da0178b0`.
Historical version-300 administrator QA activated that TESSA snapshot as
current. The D17 picker exposed 70 official brands, or 71 options including the
placeholder;
Aestiva exposed four exact models, or five options including the placeholder.
The trade handoff applies one exact customer-entered discount to the next quote
or invoice; it does not infer a dollar discount from a certificate count. No
customer-shareable rebate receipt is included because the product owner
rejected that artifact as unnecessary.

Sites does not contain `CREDITEX_CEC_BATTERY_API_USERNAME`,
`CREDITEX_CEC_BATTERY_API_PASSWORD` or
`CREDITEX_CEC_BATTERY_LICENCE_REFERENCE`. BESS1 and BESS2 remain pending those
licensed credentials and an accepted activated snapshot. BESS3 and BESS4 remain
blocked because the available licensed CEC contract does not supply the exact
Rule-required maximum rated AC inverter output.

The Sites version 301 saved-version identity is
`appgprj_6a550c378000819185caf094173422bb~appgver_57a5cb197f548191a5ef29ab9c99f59e`
with content hash
`sha256:3bbab6b63c31708d6b9ded69b50da11e31d45ff75557d82823d3b12fc4a02e3b`
across 385 stored files and 35,328,000 stored bytes. Local archive
`.openai/site-release-bc4096d.tar.gz` is 9,823,592 compressed bytes with SHA-256
`5ae1990b73dd2fd54bebfc5182b8a1616fc0a51afd925ecd09cfd726eebc01a3`,
399 tar entries, 385 files and all 126 migrations. Provider identity is
`info294029--aea-energy-comparison`.

Full validation passed typecheck, lint, 32 of 32 integration tests, 1,803 main
tests with 1,793 passed, 10 intentionally skipped and 0 failed, all 126
migrations, the customer-plan PDF audit, the production build and the Sites
audit. Independent focused final validation passed 115 of 115.

Historical Sites version 300 saved-version identity is
`appgprj_6a550c378000819185caf094173422bb~appgver_e084d0c2568c81918bdcf23adc78ad5e`
with content hash
`sha256:29ca942f7801e5657cff10f4dd2e1e5dde14fc9386f19fb51f6691703c58db73`
across 384 files and 33,607,680 bytes. Local archive
`.openai/site-release-ca3d84a.tar.gz` is 8,175,111 bytes with SHA-256
`a2df1764b0850d46f8088ddd8fe6e8c422d6072f9560df08d43fdba81f82a79a`,
398 entries and all 126 migrations.

Signed-out version-301 live QA verified the public home, `/plan`, the result
`Start here` action and `/calculator`. Native future date `2026-09-03` persisted
and the live solar-PV result was 39 STCs. The browser console showed no warnings
or errors. The live trade route stayed static and contained no public animation.
Both live browser sessions presented the sign-in boundary, so no signed-in v301
dashboard QA is claimed.

Historical version-300 signed-in trade QA returned 39 STCs for a 9 August 2026,
postcode-3000, 6.6 kW small-scale solar PV estimate and verified VEU 1C repeated
identical-unit quantity plus the Activity 15 plain-English scenario flow. The
administrator refresh ran TESSA first and activated it as current, then the GEMS
refresh failed closed because official resource `gems-commercial-refrigerators`
decreased from 7,500 to 7,499 rows. Current public GEMS search returns
`OFFICIAL_PRODUCT_REGISTRY_STALE`. No quote, invoice, certificate or customer
record was written. Historical version-298 public QA remains recorded in release
truth.

The guarded VEU Public Registry foundation is released from exact commit
`1d77ab222638d3d43d9a49cac0b486173ce88e18` as Sites version 293. The complete
VEU calculator was committed as `d192d46b4e2056114251ec7cb0e3cfca3b5ea5d9`
and deployed as Sites version 294 through
`appgdep_6a77aa33d1288191965ba076f690dd46`. Exact bounded-refresh correction
`ad63b90a4e99211998aa1947b7ddd61d5ac1f640` is historical Sites version 295.
Exact guided calculator and PDRS licensed-runtime source
`1d3abe172e4eb2fa006fab639233cda49a6d37d4` is historical Sites version 296.
Exact simplified quote-calculator source
`11f4721b678425a4294e95c631e0d37d3fab0ffd` is historical Sites version 297, saved
as `appgprj_6a550c378000819185caf094173422bb~appgver_f6c71f20596c8191a59a1ee2c23045df`
with 378 stored files, 33,105,920 stored bytes and content hash
`sha256:03f919b3ec2902590c8079a1d6edf9d725e6163bb515ec6b761be3ed12b099c5`.
The 8,158,365-byte publication archive had SHA-256
`FCB2FA3E954FA758EB069C70B76A712C1FC23FEC0EC432380EBD3B58D8646563`
and was removed locally after Sites accepted the package and recorded custody.
Deployment `appgdep_6a781d231ee08191a7d506389be1676b` succeeded with environment
revision 19 at `https://compare.ausenergyassessments.com`.

Initial milestone source `c9fb34115209c0ea0a1fc02ee2095250458c256f` is
historical Sites version 298, saved as
`appgprj_6a550c378000819185caf094173422bb~appgver_acf528bb50208191b6bcd0948190172c`
with content hash
`sha256:ac6bd787b8bb9fd71e44e7d0c23368a528c26dba3eb328c0708f3989b5471c86`
and deployment `appgdep_6a786857458c8191ae557d2c2f0f2694`.

The active production snapshot contains exactly 75,492 Public Visible rows:
64,715 `Approved` and 10,777 `Legacy`. The released catalogue contains 32 VEU
definitions, with 30 aggregate codes formula-ready. Twenty-seven expose an
executable estimate path: 21 fully available aggregate families plus six
enforced partial subsets. The fully available codes are `3`, `13`, `15`, `17`,
`22`, `24`, `25`, `26`, `27`, `30`, `35`, `36`, `37`, `38`, `39`, `40`, `41`,
`42`, `43`, `44` and `48`. The partial codes are `1`, `6`, `31`, `33`, `34` and
`46`. Codes `14`, `28` and `32` have governed formulas but remain source-gated.

Current product evidence is deliberately split by authority and permission:

- 16,684 CER registered solar-water-heater and air-source-heat-pump rows are in
  the dedicated SRES registry;
- the last accepted GEMS projection contained 31,418 rows from 11 official
  data.gov.au resources. The current refresh detected the reviewed
  `gems-commercial-refrigerators` decrease from 7,500 to 7,499 rows. The accepted
  commercial-refrigerator artifact has 7,500 rows with SHA-256
  `dcd5e18d9c58ddf13cde8aa1c00f48c704965b7156db61b1a330eef2752d73df` and the
  held candidate has 7,499 unique rows with SHA-256
  `db6068208c9bc6fca9033879a166dbce1ad0941e376aea786ac5b155dd013b09`.
  The exact missing record is unknown without authorised read-only R2 bytes,
  and public GEMS search now returns `OFFICIAL_PRODUCT_REGISTRY_STALE`; no
  GEMS-backed
  calculator is active or current while that retained-byte review is unresolved;
- the historical 14-feed federal validation parsed 44,119 rows, but the 12,701
  CER-hosted public CEC module, inverter and battery rows remain
  controlled-manual; the separate PDRS licensed snapshot route is deployed and
  server-side only, but has no accepted snapshot because the central Sites CEC
  username, password and licence reference are not configured;
- the released official TESSA D17 to D20 automatic registry implementation
  parsed 746 live
  source rows, comprising 663 `Active` and 83 `Cancelled`, under source SHA-256
  `3770ac57885bbd968e35e25c67b4546e9ff6d4325c63cf4c4592a9b5da0178b0` and is
  activated and current in version 301;
- the current Synergy supported-solutions page parses 2,024 rows under a
  controlled-manual contract, while Horizon Power has no supported unattended
  feed; and
- the active VEU Public Registry projection contains exactly 75,492 Public
  Visible rows: 64,715 `Approved` and 10,777 `Legacy`. Its embedded interface is
  treated as a monitored official source, not represented as a supported public
  API.

Automatic registry paths retain exact source bytes in content-addressed R2
objects with immutable manifests. D1 stores indexed normalized projections,
snapshot identity, source status, category and effective dates for fast search
and server-side validation. Calculations query D1 and never download or parse a
registry. A live 64 MB VEU acquisition, exact-byte R2 replay, validation and D1
activation completed with all 75,492 rows. Failed, stale, drifted, incomplete,
overlapping or custody-invalid refreshes fail closed. Product-controlled formula
values are derived server-side and cannot be replaced by caller-entered values.

The optimized production VEU refresh POST succeeded with HTTP 200 under request
and Ray identifier `a2821aca0bc9b95b`, using 70.404 seconds wall time and 3.748
seconds CPU time. The current projection still contains 75,492 rows and the UI
reports snapshot prefix `78853aad-a77...`; the full snapshot identifier is not
claimed. The earlier pre-optimization HTTP 503 was the expected fail-closed
result at the resource boundary. Subsequent product GET requests returned HTTP
200. Exact version-297 source `11f4721b678425a4294e95c631e0d37d3fab0ffd`
is pushed to GitHub and the Sites managed source branch. Its deployment retained
the sealed 56-of-216 calculation coverage result and active 75,492-row registry
projection.

Signed-in trade QA used future date 17 August 2026. A 6.6 kW SRES solar-PV quote
for postcode 3000 returned 39 STCs. A VEU Activity 6 scenario (xi) quote for ERS
Tech model `ERS-AC24KWH-G`, with 3.5 kW indoor heating and cooling capacities,
returned 2 VEECs. Consumer-fact-sheet and disposal questions were absent,
registry refresh was absent and calculation details were collapsed. The
signed-in administrator calculator loaded at release 297. BESS1 and BESS2 remain
not live-active until the central licensed CEC snapshot is available.
Certificate actions remained disabled; no certificate was created, issued,
submitted, traded or settled.

## Federal program register

### Small-scale Renewable Energy Scheme, STCs

Status: current certificate scheme.

Current eligible system families:

- rooftop solar PV, no more than 100 kW and less than 250 MWh annual output;
- solar battery, 5 to 100 kWh nominal capacity, with entitlement limits applied to usable capacity;
- small wind, no more than 10 kW and less than 25 MWh annual output;
- small hydro, no more than 6.4 kW and less than 25 MWh annual output;
- solar water heater, normally no more than 700 litres without additional declarations; and
- air-source heat-pump water heater, no more than 425 litres.

The system, product-register entry, recall state, installer and designer credentials, installation date, assignment, address, component serials, safety certificate, declarations and evidence all affect a claim. Certificates must be created within 12 months of installation. Required documents can be requested for five years after certificate creation. The applicable deeming period and formula must be effective-dated. TLink must retain official-calculator inputs and output, not only the resulting count.

Cheaper Home Batteries operates through SRES rather than creating a separate certificate type. Tiered battery incentives commenced 1 May 2026. The federal battery evidence path requires original geotagged and timestamped images across installation stages, including battery and inverter serial evidence. Those official requirements must be transcribed into an effective-dated battery policy and must not be copied onto unrelated SRES activities.

Sources: [CER eligible small-scale systems](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems), [CER certificate creation](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/create-small-scale-technology-certificates), [CER registered-agent obligations](https://cer.gov.au/schemes/renewable-energy-target/renewable-energy-target-participants-and-industry/registered-agents), [CER entitlement calculation](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/calculate-small-scale-technology-certificate-entitlements), [CER solar batteries](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-batteries) and [CER 1 May 2026 battery changes](https://cer.gov.au/news-and-media/media/2026/march/battery-rebates-are-changing-1-may-2026).

Released calculator coverage reviewed through 9 August 2026:

- the CER air-source-heat-pump and both solar-water-heater CSV exports ingest
  16,684 current products into one effective-dated selector;
- the official water-heater/heat-pump and solar-PV postcode documents are
  transcribed with their exact current SHA-256 values and re-fetched for hash
  comparison on every registry refresh;
- every changed refresh retains exact source bytes in content-addressed R2
  objects, immutable D1 manifests, a full current projection and only changed or
  removed historical product deltas;
- a failed, changed, incomplete, stale, overlapping or custody-unverified
  refresh blocks affected product and postcode calculations instead of silently
  using a previous result; and
- registered solar-water-heater and air-source-heat-pump estimates pin the
  product, installation date, postcode, source snapshot and deterministic
  receipt, while certificate creation remains disabled.

Solar PV, solar battery, small wind and small hydro arithmetic is implemented
but not executable. Current controlled sources do not yet establish every
required component, installed-system value and accreditation fact, and the CEC
data cannot be automated commercially without recorded permission. No claim
creation or REC Registry submission connector exists.

### Large-scale Renewable Energy Target, LGCs

Status: current certificate scheme for accredited power stations, not an ordinary residential rebate path.

Relevant thresholds include solar PV above 100 kW or at least 25 MWh annual output, wind at least 10 kW and 25 MWh annual output, and hydro at least 6.4 kW and 25 MWh annual output. The workflow requires power-station accreditation, nominated-person authority, stakeholder agreements, generation boundaries, diagrams, approvals, revenue-quality metering and generation calculations.

Sources: [RET eligibility thresholds](https://cer.gov.au/schemes/renewable-energy-target/eligibility-renewable-energy-target), [power-station accreditation](https://cer.gov.au/schemes/renewable-energy-target/renewable-energy-target-participants-and-industry/power-stations/apply-accreditation) and [LGC calculations](https://cer.gov.au/schemes/renewable-energy-target/large-scale-renewable-energy-target/large-scale-generation-certificates/calculate-large-scale-generation-certificate-entitlements).

### Renewable Electricity Guarantee of Origin, REGOs

Status: current project certificate scheme, commenced November 2025 and operating alongside LGCs until the RET ends in 2030.

One certificate represents one eligible MWh. Facility registration, metering, raw data and first-claim validation apply. The same generation cannot create both REGO and LGC or I-REC certificates. Treat this as a future project connector, not as an ordinary installer activity.

Sources: [DCCEEW Guarantee of Origin Scheme](https://www.dcceew.gov.au/energy/renewable/guarantee-of-origin-scheme) and [CER REGO certificates](https://cer.gov.au/schemes/guarantee-origin-scheme/renewable-electricity-guarantee-origin/renewable-electricity-guarantee-origin-certificates).

### Australian Carbon Credit Unit Scheme

Status: current project-credit scheme.

Trade-adjacent current methods are:

- Industrial and Commercial Emissions Reduction, including eligible boilers, HVAC, controls, motors, pumps, fans, compressed air, waste heat, fuel switching and onsite generation; and
- Industrial Equipment Upgrades, including eligible compressed air, boiler, process-heating, refrigeration and pump work.

These require project registration, additionality and newness tests, historical data, engineered baselines, measurement and verification, professional declarations, monitoring, reporting and audit. Former aggregated-small-user, commercial-building, appliance, refrigeration, fan and lighting methods are closed to new registration. No ACCU, VEU or STC stacking conclusion may be inferred without an explicit method-specific overlap decision.

Sources: [current ACCU methods](https://cer.gov.au/schemes/australian-carbon-credit-unit-scheme/accu-scheme-methods), [ICER method](https://cer.gov.au/schemes/australian-carbon-credit-unit-scheme/accu-scheme-methods/industrial-and-commercial-emissions-reduction-method), [Industrial Equipment Upgrades method](https://cer.gov.au/schemes/australian-carbon-credit-unit-scheme/accu-scheme-methods/industrial-equipment-upgrades-method) and [closed ACCU methods](https://cer.gov.au/schemes/australian-carbon-credit-unit-scheme/accu-scheme-methods/closed-methods).

### Federal finance and grant wrappers

Track separately from certificate claims:

- Cheaper Home Batteries, delivered through SRES battery STCs;
- Household Energy Upgrades Fund discounted finance;
- Social Housing Energy Performance Initiative;
- Community Solar Banks;
- Community Batteries;
- Community Energy Upgrades Fund;
- Energy Efficiency Grants for Small and Medium Enterprises, closed; and
- Powering the Regions Fund for eligible large facilities.

Sources: [Cheaper Home Batteries](https://www.dcceew.gov.au/energy/programs/cheaper-home-batteries), [Household Energy Upgrades Fund](https://www.energy.gov.au/households/household-energy-upgrades-fund), [Social Housing Energy Performance Initiative](https://www.dcceew.gov.au/energy/programs/social-housing), [Community Solar Banks](https://www.dcceew.gov.au/energy/renewable/community-solar-banks) and [Community Batteries](https://www.dcceew.gov.au/energy/renewable/community-batteries).

## Victoria

### Victorian Energy Upgrades, VEECs

Status: current certificate scheme. Only an Accredited Person can create VEECs.

Part 6 is not one activity scenario and `6(23)` is not an official Version 25
calculation key. TLink stores the official structure as:

- registry activity code `6`;
- specification part `6`;
- product category `6A` to `6G`; and
- scenario `(i)` to `(xi)`.

If `6(23)` appears in a legacy export, it must remain an unverified external
label until the owning system supplies an authoritative field dictionary. It
must not select a rule, formula or certificate quantity.

Specifications Version 25 is already operative. It came into effect on 21 July
2026 and states that Versions 0.1 to 24.0 were no longer in effect from that
date. Version 25 itself contains both the Part 6 branch applicable until
29 September 2026 and the branch applicable from 30 September 2026. A
1 August 2026 installation therefore resolves to the through-29-September
clauses within Version 25, not to Version 24. Version 24 is retained only as
the superseded comparison source for the Version 25 change.

The published Part 6 minimum co-payment branches are:

| Product classification | Applicable until 29 Sep 2026 | Applicable from 30 Sep 2026 |
| --- | ---: | ---: |
| Multi-split with total rated cooling capacity below 10 kW, categories 6A, 6D and 6E | $1,000 including GST per installed product | $1,000 including GST per installed product |
| Multi-split with total rated cooling capacity at or above 10 kW, categories 6B, 6C, 6F and 6G | $1,000 including GST per installed product | $3,000 including GST per installed product |
| All ducted air conditioners, categories 6A to 6C | $1,000 including GST per installed product | $3,000 including GST per installed product |
| Other non-ducted air conditioners below 10 kW, categories 6D and 6E | $200 including GST per installed product | $200 including GST per installed product |
| Other non-ducted air conditioners at or above 10 kW, categories 6F and 6G | $1,000 including GST per installed product | $1,000 including GST per installed product |

For multi-split calculations in both branches, the heating or cooling capacity
input is the sum of the rated capacities of the installed indoor units, capped
at the registered rated capacity of the installed outdoor unit. From
30 September 2026, Version 25 adds a maximum 20 kW heating input and a maximum
20 kW cooling input for installations in residential premises. The marked
20 kW maxima do not apply before that date or to non-residential premises.
The scenario-specific 2.4 kW and 15 kW limits for scenarios (i) to (iv) still
apply.

The released calculator contains 32 VEU catalogue definitions and
resolves all 719 explicit Version 24 and Version 25 Table A postcode rows.
Thirty aggregate activity codes are formula-ready. Twenty-seven expose an
executable estimate path: 21 fully available aggregate families plus six
enforced partial subsets. The fully available set is `3`, `13`, `15`, `17`,
`22`, `24`, `25`, `26`, `27`, `30`, `35`, `36`, `37`, `38`, `39`, `40`,
`41`, `42`, `43`, `44` and `48`. Codes `14`, `28` and `32` have formulas but
remain source-gated. These counts describe the released formula boundary and
were verified through the signed-in administrator and verified-installer paths.

The exact `partial_estimate_available` messages are:

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

Every formula-dependent product must match the exact official VEU category,
source status and effective installation-date window. Only an `Approved` row
inside its declared inclusive window or a `Legacy` row inside its exact closed
inclusive window can count. GEMS-only, fuzzy, current `Legacy` and out-of-window
matches fail closed.

The remaining VEU boundaries are explicit:

- Activity 14 has no live Public Registry rows, Activity 28 has no governed
  connector or rows, and Activity 32 has no stable exact VEU-to-GEMS crosslink;
  Activity 32 must never use fuzzy matching;
- Activity 46 has no current `Approved` rows and 674 `Legacy` rows available
  only for exact in-window historical use;
- Activity 45 is closed; Activity 47 BESS1 and BESS2 definitions, licensed CEC
  POST route and nightly worker path are deployed but remain not live-active
  until an accepted licensed snapshot exists; BESS3 and BESS4 still require
  exact governed inverter-output authority, and BESS5 still requires the Scheme
  Administrator's exact recording method;
- the released quote calculator supports repeatable Part 6 multi-split or
  variable-refrigerant-flow indoor-unit selection and packaged-system quote-only
  estimates, but packaged and other multi-product compliance bundles remain
  blocked;
- Activity 27's AEMO load-table alternative is not enabled, the Part 34 J6
  refurbishment branch fails closed, and PBA and other project-based activities
  remain governed project methods rather than deemed calculators.

Across the national catalogue, product-backed pathways without a lawful
supported source connector remain unavailable rather than accepting
caller-entered substitutes. The released TESSA implementation closes that
product-authority boundary only for D17 to D20; its accepted production snapshot
is active and current in version 300. No other product or formula gate is
relaxed.

Current deemed-activity inventory:

| Part | Activity or categories | New-job status |
| --- | --- | --- |
| 1 | Solar or heat-pump water heater replacing electric resistance, 1C and 1D | Current |
| 3 | Heat-pump or solar water heater replacing gas or LPG, 3C and 3D | Current |
| 6 | High-efficiency air conditioning, 6A to 6G and scenarios i to xi | Current, with 30 Sep 2026 clause transition |
| 13 | External single glazing replaced with WERS-rated double glazing | Current |
| 14 | Secondary glazing, acrylic panel or insulating film | Current |
| 15 | Draught sealing for doors, windows, exhaust fans, vents, fireplaces, chimneys and evaporative-cooler outlets | Current |
| 17 | High-flow shower replaced with WELS low-flow shower rose | Current |
| 22 | Refrigerators and freezers, 22A to 22D | Current |
| 24 | High-efficiency televisions | Current |
| 25 | High-efficiency clothes dryers | Current |
| 26 | High-efficiency pool and spa pumps | Current |
| 27 | Public-lighting controls, replacement and removal | Current |
| 28 | Flexible gas-heating ductwork upgrade | Current |
| 30 | In-home displays and approved energy-use display apparatus | Current |
| 31 | High-efficiency three-phase induction motors | Current |
| 32 | Refrigerated display cabinets, ice-cream freezers and storage cabinets | Current |
| 33 | Efficient electronically commutated motors | Current |
| 34 | Building-based lighting controls, replacements and removals | Current |
| 35 | Non-building lighting controls, replacements and removals | Current |
| 36 | High-efficiency pre-rinse spray valves | Current |
| 37 | Gas steam-boiler replacement | Current |
| 38 | Gas steam or hot-water boiler or water-heater replacement | Current |
| 39 | Gas-to-air ratio control | Current |
| 40 | Combustion trim system | Current |
| 41 | Gas-fired burner replacement | Current |
| 42 | Boiler economiser | Current |
| 43 | Cold-room refrigeration controls and efficient components | Current |
| 44 | Commercial and industrial heat-pump water heater | Current |
| 45 | Residential Efficiency Scorecard | Closed 23 Jun 2026, block new jobs |
| 46 | Induction cooktop replacing gas or LPG-connected cooking | Current |
| 47 | Commercial and industrial solar PV, 30 to 100 kW and over 100 to 200 kW | Current |
| 48 | Ceiling insulation at uninsulated or under-insulated residential premises | Current |

Parts 5, 7, 9, 10 and 23 expired in January 2024. Part 12 was revoked in April 2026. Preserve them only for historical correction and audit.

VEU also has current project-based Measurement and Verification and Benchmark Rating paths. They require explicit project boundaries, baseline and operating periods, raw meter data, models, variables, calibration, qualified professionals, reports, certificate periods and persistence calculations.

#### VEU source classes and retention status

The source pack below was reviewed against official Victorian Government and
Essential Services Commission sources through 9 August 2026. A URL, title or
effective date in this register is not evidence that TLink has retained or
independently approved the exact bytes.

Authoritative instruments:

- [Victorian Energy Efficiency Target Act 2007, Authorised Version 023](https://content.legislation.vic.gov.au/sites/default/files/2025-07/07-70aa023-authorised.pdf),
  incorporating amendments as at 1 July 2025;
- [Victorian Energy Efficiency Target Regulations 2018, Authorised Version 020](https://content.legislation.vic.gov.au/sites/default/files/2026-06/18-145sra020-authorised.pdf),
  effective 30 June 2026, including Schedule 2 Part 6, Schedule 4 installation
  limits and the authoritative Code of Conduct in Schedule 6;
- [Victorian Energy Upgrades Specifications 2018, Version 25.0](https://www.energy.vic.gov.au/__data/assets/pdf_file/0041/795488/Victorian-Energy-Upgrades-Specifications-2018-Version-25.pdf),
  effective 21 July 2026 and containing both Part 6 date branches described
  above;
- [Victorian Energy Upgrades Specifications 2018, Version 24.0](https://www.energy.vic.gov.au/__data/assets/pdf_file/0031/792904/victorian-energy-upgrades-specifications-2018-version-24.pdf),
  effective 30 June 2026 and superseded from 21 July 2026, retained for
  comparison only; and
- [Victorian Energy Efficiency Target Guidelines, Version 16](https://www.esc.vic.gov.au/sites/default/files/documents/PBL%20-%20VEET%20guidelines%20v16%20-%2020260416.pdf),
  effective 16 April 2026.

Current public guidance and mandatory consumer documents:

- [Water Heating and Space Heating and Cooling Activity Guide, Version 3.17](https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Water%20Heating%20and%20Space%20Heating%20Cooling%20Activity%20Guide%20-%20V.%203.17%20-%2020250901.pdf),
  effective 1 September 2025. It predates Version 25 and cannot independently
  establish the 30 September 2026 branch;
- [Obligations and Program Guide for Accredited Persons, Version 3.8](https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Obligations%20and%20Program%20Guide%20for%20Accredited%20Persons%20-%20V%203.8%20-%2020260324.pdf),
  published 24 March 2026;
- [VEET Code of Conduct Guideline, Version 1.3](https://www.esc.vic.gov.au/sites/default/files/documents/PBL%20-%20VEU%20code%20of%20conduct%20-%20Code%20of%20Conduct%20Guideline%201.3%2020240801.pdf),
  published 1 August 2024. This is guidance only; Schedule 6 of the
  Regulations is authoritative;
- [Application Guide for Product Applicants, Version 2.0](https://www.esc.vic.gov.au/sites/default/files/documents/PBL%20-%20Application%20Guide%20for%20Product%20Applicants%20-%20V%202.0%20-%2020250603.pdf)
  and [Water Heating and Space Heating/Cooling Product Application Guide, Version 3.0](https://www.esc.vic.gov.au/sites/default/files/documents/PBL%20-%20Water%20Heating%20and%20Space%20Heating%20Cooling%20Product%20Application%20Guide%20-%20V%203.0%20-%2020250603.pdf),
  both published 3 June 2025; and
- the mandatory [Consumer rights under the Victorian Energy Upgrades program](https://www.energy.vic.gov.au/__data/assets/pdf_file/0028/585154/Victorian-Energy-Efficiency-Target-scheme-consumer-factsheet.pdf),
  published April 2024, and [Choosing the right size reverse cycle air conditioner](https://www.energy.vic.gov.au/__data/assets/pdf_file/0027/712809/VEU-space-heating-and-cooling-consumer-factsheet.pdf),
  Version 1, 2023. The [VEU industry program documents page](https://www.energy.vic.gov.au/victorian-energy-upgrades/installers/veu-industry-program-documents)
  requires consumers to receive current copies before agreeing to the
  applicable activity.

Dynamic official sources:

- the [VEU public registry](https://veu.esc.vic.gov.au/vpr/s/public-registry);
  and
- the [VEU Register of Products](https://veu.esc.vic.gov.au/vpr/s/productregister).

These live sources require effective-dated snapshots or exports with source
timestamps and fail-closed rechecks. A saved landing-page URL is not an
authoritative participant, accreditation, suspension or product record.

The public product source observed on 9 August 2026 contained exactly 75,492
rows: 64,715 `Approved` and 10,777 `Legacy`. Product eligibility is determined
for the installation date, not from a current-status label alone. Only a
category-matched `Approved` row inside its inclusive declared effective window
or a `Legacy` row inside its exact closed inclusive start and end dates can
count. GEMS-only matches, current `Legacy` rows and out-of-window rows cannot
establish VEU approval.

The released importer retains exact official response bytes and custody metadata
under content-addressed R2 keys, then writes indexed normalized current and
historical projections to D1 for product search and server-side validation.
Calculations query D1 only and never download or parse the Public Registry. A
live 64 MB acquisition, exact-byte R2 replay, validation and D1 activation
completed with all 75,492 rows. The guarded refresh uses schema, count,
source-status, effective-date, custody, freshness and reviewed count-decrease
checks before any replacement snapshot can activate. The optimized production
refresh POST completed as recorded above. This register does not claim that the
next automatic scheduled production run has completed.

Unavailable provider-portal artefacts:

- the exact current VEEC assignment form;
- Part 6 certificate-creation fields and upload schemas;
- declarations, evidence templates and field dictionaries; and
- current accredited-provider notices and program-specific instructions.

The official [VEU industry program documents page](https://www.energy.vic.gov.au/victorian-energy-upgrades/installers/veu-industry-program-documents)
directs program-specific documents to the accredited-provider portal. Public
guidance must not be used to infer those private artefacts. They require an
authorised portal export, exact-byte retention and independent approval before
any regulated-case onboarding or connector mapping.

Separate project-based sources are [Measurement and Verification Specifications Version 8](https://www.energy.vic.gov.au/__data/assets/pdf_file/0036/755487/Measurement-and-Verification-Specifications-Version-8.0.pdf)
and [Benchmark Rating Specifications Version 2](https://www.energy.vic.gov.au/__data/assets/pdf_file/0034/755485/Benchmark-Rating-Specifications-Version-2.0.pdf).
They are not Part 6 deemed-activity authorities.

### Victorian non-certificate programs

Solar Victoria programs accepting new applications on the review date are:

- Solar panel PV rebate with an optional equivalent interest-free loan;
- hot-water rebates for eligible heat-pump and solar products;
- solar panels for rental properties;
- Solar for Community Housing; and
- Solar for Apartments, extended to 30 June 2027.

Solar Victoria's interest-free solar battery loan closed to new applications in May 2025 after its target was met. Preserve approved legacy applications, installations and repayments for reconciliation only. Do not create a new battery-loan case. Commonwealth Cheaper Home Batteries support is handled separately through SRES battery STCs.

The combined household-income cap for new PV and hot-water applications changed to $150,000 on 1 July 2026. Product lists and the Notice to Market are independently versioned and must be resolved at application and installation. These programs must be tracked as separate grant or loan cases and reconciled against exact Solar Victoria eligibility, retailer, installer, product and evidence requirements. They are not additional VEEC types.

Sources: [Solar Victoria current programs](https://www.solar.vic.gov.au/), [2026 to 2027 Notice to Market overview](https://www.solar.vic.gov.au/notice-to-market-2026-27/section-1-overview), [official battery-loan closure notice](https://www.solar.vic.gov.au/solar-victoria-exceeds-battery-targets), [Solar Homes terms](https://www.solar.vic.gov.au/applicant-terms-conditions), [current product lists](https://www.solar.vic.gov.au/product-lists) and [current discounts and rebates](https://www.energy.vic.gov.au/households/save-with-all-electric-home/latest-discounts-and-rebates).

## New South Wales

### Energy Savings Scheme, ESCs

Status: current certificate scheme. IPART administers the scheme and an Accredited Certificate Provider nominated as Energy Saver creates ESCs. The current rule took effect 1 July 2026. One ESC represents one MWh after the applicable method and factors, rounded as required by the rule.

Current and transition activity inventory:

- household equipment removal: C1 spare refrigerator or freezer; C2 primary refrigerator or freezer;
- residential building fabric and equipment: D1 windows or doors, D2 secondary glazing, D5 high-efficiency pool pump, D6 ceiling insulation at uninsulated premises, D7 top-up ceiling insulation, D8 underfloor insulation, D9 wall insulation, D13 natural roof ventilator, D14 fan-forced, PV or occupied ventilator, D15 self-sealing exhaust fan, D16 high-efficiency air conditioning, D17 resistance water heater to heat-pump water heater, D18 resistance to solar electric-boost water heater, D19 gas to heat-pump water heater and D20 gas to solar electric-boost water heater;
- D6, D7, D8 and D9 had not commenced on the review date and must remain future;
- lighting and sealing: E1 to E5 lighting, E6 low-flow showerhead, E7 door draught sealing, E8 window draught sealing, E9 chimney damper, E10 external blind, E11 screw or bayonet LED, E12 exhaust sealing and E13 T5 to LED;
- commercial equipment: F1.1 new refrigerated cabinet, F1.2 replacement refrigerated cabinet, F2 liquid chiller, F3 close-control air conditioning, F4 air conditioning at or above 30 kW, F5 electronically commutated refrigerated motor, F6 electronically commutated ventilation motor, F7 three-phase induction motor, F10 oxygen trim, F11 burner, F12 economiser, F13 blowdown, F14 flash steam, F15 blowdown heat exchanger, F16 gas or electric-resistance water heater replaced by heat pump and F17 new heat-pump water heater;
- D11, D12, D21, F8 and F9 expired 30 June 2026; D3, D4 and D10 were deleted; SONA was removed; commercial-lighting creation ended 31 March 2026; and new or replacement gas-fired equipment became excluded on 1 July 2026.

Calculation methods include Project Impact Assessment with Measurement and Verification, Metered Baseline variants, Home Energy Efficiency Retrofits and Installation of High Efficiency Appliances for Business. Product status and suspension notices must be resolved at the installation date.

Sources: [current ESS Rule](https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Energy-Savings-Scheme-Rule-of-2009-1-July-2026.PDF), [rule change hub](https://www.energysustainabilityschemes.nsw.gov.au/ess-rule-and-changes), [calculation methods](https://www.energysustainabilityschemes.nsw.gov.au/ess-calculation-methods), [eligible activities and equipment](https://www.energysustainabilityschemes.nsw.gov.au/eligible-activities-and-equipment) and [product eligibility](https://www.energysustainabilityschemes.nsw.gov.au/product-eligibility).

### Peak Demand Reduction Scheme, PRCs

Status: current certificate scheme. An Accredited Certificate Provider nominated as Capacity Holder creates PRCs. The current Energy Security Safeguard Rule of 2022 dated 1 July 2026 is the governing working-tree source for implementations from that date. Earlier installation dates require their own archived rule versions.

Current activity inventory:

- RDUE HVAC1, aligned to ESS D16, with the applicable multi-split cap;
- RDUE HVAC2, aligned to ESS F4;
- RDUE RF2, aligned to ESS F1.2;
- RDUE SYS2, aligned to ESS D5;
- WH1 removed 1 July 2026 and suspended since 19 December 2024;
- SASC BESS1, new behind-the-meter battery, current from 1 July 2026;
- SASC BESS3 apartment batteries, SASC BESS4 small-business batteries and SASC BESS5 commercial and industrial batteries, future commencement 1 September 2026;
- HADR BESS2, demand-response or virtual-power-plant onboarding; and
- V2G1, commencement to be advised and therefore inactive.

Sources: [PDRS overview](https://www.energy.nsw.gov.au/nsw-plans-and-progress/regulation-and-policy/energy-security-safeguard/peak-demand-reduction-scheme), [rule and changes](https://www.energysustainabilityschemes.nsw.gov.au/pdrs-rule-and-changes), [legislation](https://www.energysustainabilityschemes.nsw.gov.au/pdrs-legislation), [peak saving](https://www.energysustainabilityschemes.nsw.gov.au/peak-saving), [peak shifting](https://www.energysustainabilityschemes.nsw.gov.au/peak-shifting), [peak response](https://www.energysustainabilityschemes.nsw.gov.au/peak-response) and [PDRS Method Guide Version 2.5](https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/documents/2025-09/PDRS-Method-Guide-V2.5-September-2025.pdf).

The released source implements 20 typed NSW ESS/PDRS estimator scenarios.
GEMS-backed D5, D16, F4, HVAC1, HVAC2, RF2 and SYS2 activity templates have
server-derived product contracts but are currently unavailable because the
shared GEMS registry is `OFFICIAL_PRODUCT_REGISTRY_STALE`. TESSA is activated
and current for D17 to D20; D17 picker brand and model resolution was verified,
but a live D17 to D20 calculation was not exercised. BESS1 and BESS2 remain
pending the absent central licensed CEC credentials and an accepted snapshot.
BESS3 and BESS4 remain blocked on the Rule-required maximum rated AC inverter
output, and BESS5 still requires the Scheme Administrator's exact recording
method. BESS3 to BESS5 also reject dates before 1 September 2026.

### NSW Home Energy Saver

Status: loans current; Creditex-delivered discount future and disabled.

The current zero-interest loan is up to $15,000 over ten years for eligible applicants with household income at or below $210,000. Eligible technology includes rooftop PV, batteries, heat-pump and solar water heating, reverse-cycle air conditioning, ceiling insulation, double glazing, induction cooking, level-two EV charging, draught proofing, ceiling fans, switchboard work and an existing-home NatHERS assessment. Suppliers must apply other eligible Commonwealth and NSW benefits first and disclose incentives.

Original geotagged before and after photos are an explicit evidence requirement. The supplier, licensing, inspection, certificate, consent, finance and settlement workflows are separate from an ESS, PDRS or SRES claim even where stacking is permitted.

Sources: [Home Energy Saver](https://www.energy.nsw.gov.au/households/grants-rebates/home-energy-saver) and [loan guidelines](https://www.energy.nsw.gov.au/sites/default/files/2026-06/Home-Energy-Saver-Loans-guidelines-25062026_0.pdf).

### Other NSW grant programs

- Solar for Apartment Residents and its Boost stream are current shared-solar grants. Batteries and EV infrastructure are excluded from those specific grants. Source: [Solar for Apartment Residents](https://www.energy.nsw.gov.au/households/grants-rebates/solar-for-apartment-residents).
- Community Housing Energy Performance claims may remain in delivery through December 2026. Source: [program FAQ](https://www.energy.nsw.gov.au/government-and-local-organisations/programs-grants-and-schemes/shepi/faq-chep).
- The Heat Pump Feasibility Grant closed 30 April 2026.
- The household VPP incentive is PDRS BESS2 and must not be duplicated as a separate claim. Source: [VPP incentive](https://www.energy.nsw.gov.au/households/grants-rebates/household-energy-saving-upgrades/virtual-power-plant-vpp-incentive).

## Australian Capital Territory

### Energy Efficiency Improvement Scheme

Status: current retailer-obligation scheme, not an open tradeable-certificate registry.

The ACT Government's current public Approved Energy Savings Provider register lists Harvest Hot Water and Kass & Co Pty Ltd trading as 4Eva Energy. Creditex was not listed on the review date. All Creditex EEIS submission must therefore remain disabled unless Creditex supplies a current approval or an authorised retailer arrangement that is verified with the Scheme Administrator.

Current and historical activity codes:

- building fabric: 1.1 building sealing, 1.2 exhaust-fan sealing, 1.3 ventilation opening, 1.4 thermally efficient window, 1.5 retrofit glazing, 1.6 window coverings, 1.7 pelmets, 1.8 ceiling insulation and 1.9 underfloor insulation;
- heating and cooling: 2.1 central reverse-cycle or heat-pump air conditioning, 2.2 ducted-gas replacement revoked, 2.3 room heat pump, 2.4 insulated duct, 2.5 separate central heating and cooling replaced with central heat pump and 2.6 room activity;
- water: 3.1 resistance water heater to high-efficiency system, 3.2 gas or LPG water heater to high-efficiency system and 3.3 low-flow shower;
- lighting: 4.1 residential lighting variants a to e and 4.2 commercial lighting linked to the NSW method;
- appliances: 5.1 decommission refrigerator or freezer, 5.2 efficient refrigerator or freezer, 5.3 dryer, 5.4 television, 5.5 standby controller revoked, 5.6 pool pump at or above seven stars and 5.7 refrigerated display cabinet.

Activity 4.2 must remain blocked pending legal confirmation because NSW commercial-lighting certificate creation ended 31 March 2026. Any additional retailer or Approved Energy Savings Provider intake evidence must be labelled as a contractual delivery or connector requirement, not as an EEIS scheme rule, and cannot weaken or vary the government requirements.

Sources: [EEIS overview](https://www.climatechoices.act.gov.au/policy-programs/energy-efficiency-improvement-scheme), [Approved Energy Savings Provider register](https://www.climatechoices.act.gov.au/policy-programs/energy-efficiency-improvement-scheme/approved-energy-savings-providers), [legislation hub](https://www.climatechoices.act.gov.au/policy-programs/energy-efficiency-improvement-scheme/legislation), [current Act](https://www.legislation.act.gov.au/a/2012-17/), [Eligible Activities DI2023-299](https://www.legislation.act.gov.au/DownloadFile/di/2023-299/current/PDF/2023-299.PDF), [Activity Code NI2025-184](https://www.legislation.act.gov.au/DownloadFile/ni/2025-184/current/PDF/2025-184.PDF) and [Record and Reporting Code NI2025-254](https://www.legislation.act.gov.au/DownloadFile/ni/2025-254/current/PDF/2025-254.PDF).

### Other ACT programs

- Sustainable Household Scheme: current three-percent loan from $2,000 to $20,000 for approved energy upgrades. Source: [scheme page](https://www.climatechoices.act.gov.au/policy-programs/sustainable-household-scheme).
- Home Energy Support: current rebates for eligible solar and electric-appliance or insulation upgrades. Source: [program page](https://www.climatechoices.act.gov.au/policy-programs/home-energy-support-rebates-for-homeowners).
- Sustainable Business: current audit and electrification assistance. Source: [program page](https://www.climatechoices.act.gov.au/policy-programs/sustainable-business-program).
- Solar for Apartments: current grant and zero-interest-loan program. Source: [program page](https://www.climatechoices.act.gov.au/policy-programs/solar-for-apartments-program).
- Access to Electric: page active but continuation after the June 2026 funding window is unknown and must be blocked. Source: [program page](https://www.climatechoices.act.gov.au/policy-programs/access-to-electric-program).
- Social Housing VPP: future, expected from early 2027 with technical eligibility unresolved. Source: [project page](https://www.climatechoices.act.gov.au/policy-programs/social-housing-virtual-power-plant-project).
- Commercial Landlords Pilot and the prior Business EV Charger funding window are closed unless a new instrument is published.

## South Australia

### Retailer Energy Productivity Scheme

Status: current retailer-obligation scheme through 2030, not a public tradie certificate registry. Obliged retailers remain liable and contract activity providers. Retailer credit transfers are not customer-installation certificates.

ESCOSA's public activity-provider page lists Creditex for residential or small-customer WH1, HC2A and HC2B only. All other REPS activity codes must remain disabled for Creditex unless an obliged retailer's current engagement and activity scope are provided and approved.

Current and historical activity codes:

- BS1A ceiling insulation at an uninsulated premises, BS1B top-up insulation, BS2 building sealing and BS3B secondary glazing;
- HC2A non-ducted reverse-cycle air conditioning, HC2B ducted or multi-split reverse-cycle air conditioning, HC2C HVAC connected to an approved demand-response aggregator and HC3 ducted evaporative air conditioning;
- WH1 gas, solar or heat-pump water-heater installation or replacement, WH2 low-flow shower, WH3 electric water heater moved to a solar-sponge or off-peak tariff and WH4 heat-pump water heater connected to demand response;
- CL1 commercial lighting;
- APP1A refrigerator or refrigerator-freezer, APP1B freezer, APP1D dryer, APP2 removal and disposal of refrigerator or freezer, APP3 pool pump, APP4 pool pump connected to demand response, EV1 EV charger connected to demand response and RDC1 refrigerated display cabinet;
- TOU1 residential single-rate to time-of-use tariff, VPP1 battery connected to an approved VPP, CB1 community battery connected to a VPP, CD1 commercial and industrial demand savings using PIAM&V; and
- LF1 only for existing approved legacy plans, with no new plans. L1, L2, L3, NB1, SPC1 and SPC2 were revoked 1 January 2026.

The current web index contains some mixed-year factor links. Resolve the exact Gazette, specification and factor at the installation date before publication, especially BS3B and LF1.

Sources: [REPS overview](https://energymining.sa.gov.au/industry/energy-efficiency-and-productivity/retailer-energy-productivity-scheme-reps), [2026 to 2030 targets](https://energymining.sa.gov.au/industry/energy-efficiency-and-productivity/retailer-energy-productivity-scheme-reps/reps-thresholds-and-targets), [activity specifications](https://energymining.sa.gov.au/industry/energy-efficiency-and-productivity/retailer-energy-productivity-scheme-reps/reps-activity-specifications), [ESCOSA activity providers](https://www.escosa.sa.gov.au/industry/reps/obliged-retailers-activity-providers/technical-activity-providers), [ESCOSA technical page](https://www.escosa.sa.gov.au/industry/reps/obliged-retailers-activity-providers/technical-activities-specifications), [current REPS code](https://www.escosa.sa.gov.au/industry/reps/codes), [technical bulletins](https://www.escosa.sa.gov.au/industry/reps/bulletins/technical-bulletins) and [general specification](https://energymining.sa.gov.au/__data/assets/pdf_file/0010/672697/REPS-General-Specifications.pdf).

## Queensland

No current Queensland tradable certificate or mandatory retailer-efficiency obligation was found. Queensland's former statutory renewable targets were repealed with operative provisions commencing 12 March 2026. The current infrastructure legislation creates planning powers, not certificate units, liable entities or approved-product certificate methods. Sources: [Energy Roadmap Amendment Act 2025](https://www.legislation.qld.gov.au/view/whole/html/asmade/act-2025-030) and [Energy Infrastructure Facilitation Act](https://www.legislation.qld.gov.au/view/whole/html/inforce/2026-04-27/act-2024-015).

Current or retained local modules are:

| Module | Current rule and output | Required control |
| --- | --- | --- |
| Supercharged Solar for Renters | `system_capacity = min(inverter_kW, panel_kW)`. Indicative rebate is the lesser of eligible installed cost and $2,500 for 3 to under 4 kW, $3,000 for 4 to under 5 kW, or $3,500 for at least 5 kW. | Live funding status, individual ownership, tenancy and lease, property class, individual meter, no existing solar, minimum 3 kW, approved seller, product and installer checks, and conditional approval before installation. Battery cost is excluded. |
| Queensland Community Housing Energy Upgrades | Generally `min($4,500 per eligible dwelling, eligible GST-exclusive cost)`. Conditional part-payment is the lesser of $2,250 or 50% of quoted cost. Common hot-water cost is allocated across dwellings served. | At least one primary measure, eligible community-housing provider and dwelling, activity-specific product and licence checks, close 30 October 2026 and completion by 30 June 2027. Conflicting GST presentation requires manual review. |
| Regional regulated feed-in tariff | From 1 July 2026 to 30 June 2027, `eligible_export_kWh * $0.06006`. | Confirm Ergon retail territory and current contract. South East Queensland uses retailer offers. The legacy 44 cent Solar Bonus is closed to new entrants and requires a grandfathered-account preservation check through 1 July 2028. |
| Ergon large-business demand response | Contract settlement uses verified curtailed MWh, a pre-event baseline, AEMO prices and private minimum-price, pool-share and trigger terms. | Enrolled Ergon business customer, about 1,000 kVA response capacity, interval data and executed contract. No public fixed reward can be calculated. |
| Home Energy Rating for existing homes | Accredited assessment and rating certificate service from 1 July 2026. | Procurement and assessor-accreditation workflow only. It is not an incentive or energy certificate. |

Sources: [Solar for Renters program](https://www.qld.gov.au/housing/home-energy-savings/supercharged-solar-for-renters), [eligibility](https://www.qld.gov.au/housing/home-energy-savings/supercharged-solar-for-renters/eligibility), [application process](https://www.qld.gov.au/housing/home-energy-savings/supercharged-solar-for-renters/how-to-apply), [enacted rebate regulation](https://www.legislation.qld.gov.au/view/whole/html/asmade/sl-2025-0156), [community-housing upgrades](https://www.business.qld.gov.au/industries/housing-accommodation/community/energy-upgrades/provider-owned-properties), [QCHEU regulation](https://www.legislation.qld.gov.au/view/whole/html/asmade/sl-2026-0003), [regional feed-in tariff](https://www.ergon.com.au/retail/business/tariffs-and-prices/solar-feed-in-tariff), [legacy Solar Bonus](https://www.qld.gov.au/housing/buying-owning-home/energy-water-home/solar/feed-in-tariffs/solar-bonus-scheme-44c), [Ergon demand response](https://www.ergon.com.au/retail/business/tariffs-and-prices/demand-response) and [rating program](https://www.chde.qld.gov.au/initiatives/modern-homes/home-energy-rating-existing-homes).

PeakSmart is closed to new participants. Battery Booster, Climate Smart Energy Savers, QBEST, PowerSavvy and the 2025 to 2026 aggregated demand-response pilot are closed or historical. They must not appear as current claim paths.

## Western Australia

No current WA tradable energy-efficiency or renewable-certificate scheme was found. Regulation 6 of the Electricity Industry (Licence Conditions) Regulations requires an eligible distributed-energy purchase contract, not a certificate market. Source: [WA legislation](https://www.legislation.wa.gov.au/legislation/statutes.nsf/RedirectURL?OpenAgent=&query=mrdoc_44887.htm).

| Module | Current rule and output | Required control |
| --- | --- | --- |
| WA Residential Battery Scheme | Synergy: `min(usable_kWh, 10) * $130`, maximum $1,300. Horizon: `min(usable_kWh, 10) * $380`, maximum $3,800. Minimum usable capacity is 5 kWh. Optional no-interest loan is $2,001 to $10,000 for an eligible household below $210,000 gross income. | One rebate per property, install date from 1 July 2025, funding and conditional approval, retailer, VPP, CEC battery and inverter, supported combination, gateway, Plenti vendor, NETCC/SAA/licence and network checks. Postcode alone cannot decide retailer territory. |
| DEBS | Synergy pays 10 cents per kWh from 3 pm to 9 pm and 2 cents otherwise. Horizon uses effective-dated town rows. Retailer need not buy more than 50 kWh per premises per day. | Interval exports, daily cap, retailer, exact Horizon town, current tariff version, eligible customer/system, meter and network approval. REBS is grandfathered only. |
| Synergy Battery Rewards | Activation credit is `$0.70 * metered event export kWh`, capped at installed battery capacity per event, plus separately calculated energy-offset and DEBS credits where applicable. | Executed versioned VPP terms, interval data and actual events. Forecasts must disclose that event timing and count are discretionary. |
| Horizon Community Wave and Buyback Bonus | `sum(interval export kWh * current town/season/time-band rate)`. | Exact town table, summer/winter window, compatible managed equipment and Secure Gateway Device. Keep separate from DEBS. |
| Small DER and Emergency Solar Management | From 1 May 2026, relevant new or upgraded SWIS systems at or below 30 kVA need remote disconnection/reconnection or the controlled 1.5 kW export-limit exception and Region B settings. | Connection-compliance gate only. The exception may affect DEBS eligibility and creates no credit. |

Sources: [battery scheme](https://www.wa.gov.au/organisation/energy-policy-wa/wa-residential-battery-scheme), [battery eligibility](https://www.wa.gov.au/organisation/energy-policy-wa/wa-residential-battery-scheme-eligibility-requirements), [industry rules](https://www.wa.gov.au/government/wa-residential-battery-scheme-information-industry), [Synergy supported solutions](https://www.synergy.net.au/Global/SSL), [DEBS](https://www.wa.gov.au/organisation/energy-policy-wa/energy-buyback-schemes), [Horizon pricing](https://www.horizonpower.com.au/pricing), [Battery Rewards](https://www.synergy.net.au/Your-home/Solar-battery-and-EV/Battery-Rewards), [Battery Rewards payment rules](https://www.synergy.net.au/Your-home/Solar-battery-and-EV/Battery-Rewards/Battery-Rewards-payments-and-rewards-FAQs), [Community Wave](https://www.horizonpower.com.au/for-home/solar-battery/community-wave/) and [small DER rules](https://www.wa.gov.au/organisation/energy-policy-wa/new-requirements-small-scale-solar-and-battery-systems).

Sunshine Saver is an eligibility and bill-estimate module. Energy Ahead is referral/status only because no public per-product formula exists. WEM capacity credits require a separate registered wholesale-market participant workbench. Clean Energy Future Fund Round 4, Charge Up EV Round 3 and the Synergy Solar Rewards pilot are closed. The Made in WA Energy Affordability Investment Program remains design-only and must not have a calculator yet.

## Tasmania

No current Tasmanian certificate scheme was found. Tasmania's legislated 2030 and 2040 renewable-generation targets create no certificate unit, surrender obligation, liable retailer, approved-product registry or deemed-upgrade method. Sources: [Energy Co-ordination and Planning Act](https://www.legislation.tas.gov.au/view/whole/html/inforce/current/act-1995-047), [Electricity Supply Industry Act](https://www.legislation.tas.gov.au/view/whole/html/current/act-1995-058) and [Tasmanian Renewable Energy Target](https://www.recfit.tas.gov.au/what_is_recfit/energy_vision/200_renewable_energy_target).

| Module | Current rule and output | Required control |
| --- | --- | --- |
| PowerSmart for Small Business | `min(actual eligible paid independent audit cost, $1,000)`, open through 30 June 2028 or earlier funding exhaustion. | Active ABN since at least 1 March 2024, 1 to 19 FTE, primary Tasmanian operation, independent competent audit after 11 April 2024, compliant report and one grant per ABN/business. No upgrade-product registry. |
| NILS Energy Saver support | Current public material indicates a no-interest loan up to $2,000 and historic/current partner material describes appliance and heat-pump subsidies, but the amount and income rules conflict. | Configurable pre-screen only with current delivery-provider confirmation and GEMS/star lookup. Return `manual review`, never definitive approval or amount. |
| Regulated feed-in tariff | From 1 July 2026 to 30 June 2027, `eligible net export kWh * $0.09276`. | Qualifying mainland Tasmania or Bruny Island small system, current rate, compliant meter and network/DER registration. Bass Strait Islands require separate treatment; postcode alone is not authoritative. |

Sources: [PowerSmart](https://www.recfit.tas.gov.au/grants_programs/energy-efficiency/powersmart_for_small_business), [PowerSmart guidelines](https://www.recfit.tas.gov.au/__data/assets/pdf_file/0008/547487/Guidelines_PowerSmart_for_Small_Business.pdf), [NILS referral](https://www.recfit.tas.gov.au/grants_programs/energy/energy_bill_relief), [NILS current program](https://nilstasmania.org.au/Website/Essentials), [regulated feed-in tariff](https://www.economicregulator.tas.gov.au/electricity/pricing/feed-in-tariffs), [Aurora solar rate](https://auroraenergy.com.au/residential/products/solar/solar-rates) and [TasNetworks DER Register](https://www.tasnetworks.com.au/Connections/Distributed-Energy-Resource-Register).

Energy Saver Loan Scheme closed 1 September 2025. Business Energy Efficiency Scheme has no confirmed open application path after its scheduled April 2026 conclusion. ChargeSmart, Deliver-e and earlier EV rebates are closed. Aurora Power Hours is a discretionary retailer offer and requires an accepted event plus interval data, not a deemed demand-response credit.

## Northern Territory

No current NT tradable certificate or mandatory retailer-efficiency scheme was found. Current electricity-market reform remains under development and cannot be represented as a customer credit. Source: [Territory Electricity Reform](https://dme.nt.gov.au/renewables-energy-systems/reform-territory-electricity-market).

| Module | Current rule and output | Required control |
| --- | --- | --- |
| Solar for Multi Dwellings | `min($7,500 * eligible residential dwellings, 50% * GST-exclusive eligible works cost)`, available through 31 December 2027 or earlier closure/exhaustion. | At least two dwellings, qualifying shared-property applicant, existing occupied residential building, common-property equipment behind dwelling meters, equitable allocation, no embedded network, no excluded prior shared solar, Power and Water approval, conditional approval and executed agreement before work. Battery qualifies only with new shared PV. Final amount remains departmental. |
| Regulated solar feed-in tariff | From 1 July 2026 to 30 June 2027, `$0.1866 * eligible smart-meter exports from 3 pm to 9 pm + $0.0933 * other eligible exports`. | Regulated contract, qualifying rooftop solar, electronic interval meter, retailer and network classification. Remote arrangements may use a different purchase agreement. |
| Solar, battery and electrical compliance | No financial output. | Current NT electrical licence, solar/battery accreditation, CEC-approved equipment, Power and Water pre-approval, size/location connection class, protection/commissioning and retained Electrical Certificate of Compliance. |
| Home and Business Battery Scheme | Closed. Historic formula was `$400 * usable kWh`, capped at $12,000. | Show `closed, no funding available` for new work. Retain only already-approved voucher support. |

Sources: [multi-dwelling program](https://nt.gov.au/industry/business-grants-funding/solar-for-multi-dwellings-grant-scheme), [terms current 30 June 2026](https://nt.gov.au/_media/docs/business-and-industry/grants/solar-for-multi-dwellings-grants-scheme-terms-and-conditions.pdf), [Jacana pricing](https://www.jacanaenergy.com.au/residential/pricing), [Utilities Commission pricing](https://utilicom.nt.gov.au/electricity/price-regulation/electricity-retail-pricing), [Power and Water PV classes](https://www.powerwater.com.au/customers/power/solar-power-systems/pv-class-requirements), [Power and Water connection rules](https://www.powerwater.com.au/customers/power/solar-power-systems), [NT electrical compliance](https://worksafe.nt.gov.au/electrical-safety/information-for-electrical-industry/certificate-of-compliance) and [closed battery scheme](https://nt.gov.au/industry/business-grants-funding/home-and-business-battery-scheme).

EV charger grants and 2025 energy-bill relief are closed. Community Solar Share and the Remote Renewable Power Rollout are government delivery or procurement programs without an open installer formula. No active public customer demand-response credit was identified.

## Four-jurisdiction module boundary

The federal SRES and LRET engines apply independently in QLD, WA, TAS and NT. Local rebates and grants may stack only where their current terms allow it. No local formula reviewed above uses an ABCB climate zone. Address still matters through authoritative service territory, network, town, meter, embedded-network, property and connection classifications. A postcode may assist a verified resolver, but must never be the final source of truth for those fields.

Every local result must be typed as dollars, finance, tariff credit, eligibility, compliance, closed or manual review. It must not return STC, LGC, VEEC, ESC or PRC unless the separate federal or applicable certificate engine actually produced that unit.

The working tree contains 30 typed local activity estimators across 11 QLD, WA,
TAS and NT programs. Twenty catalogue templates expose estimates where the
published formula and evidence source are complete. Product-controlled PV and
battery paths, Synergy Battery Rewards and Horizon managed-device paths remain
official-registry blocked until the applicable CEC and WA permissions or feeds
are in place.

## Minimum activity-version contract

Before an activity can be published, it needs:

- program, jurisdiction, scheme kind, regulator, administrator, policy owner, liable entity, claimant or certificate creator, output unit and authorised connector mode;
- official source URI, source title, content SHA-256, publication date, source version, checked date, effective-from and effective-to dates and state of draft, future, current, suspended, revoked or expired;
- official activity code, subcode, specification part, product category and scenario stored separately;
- sector, premises, fuel, baseline, end use, product-register source and applicable suspension notices;
- formula or official-tool version, typed inputs and units, climate or zone, lifetime, confidence, decay, transition, peak and STC factors, caps, co-payment and rounding;
- typed output such as STC, VEEC, ESC, PRC, normalised GJ, dollar grant, dollar loan or tariff;
- eligibility and exclusion rules, stacking and duplicate-claim decisions, and separate states for estimate, eligible, submitted, accepted and regulator-issued;
- conditional evidence requirements for before, mid-installation, after, commissioning and disposal stages;
- customer, owner, occupant, tenant and body-corporate consents and assignment capacity;
- address, geocode, NMI, MIRN, DPID, meter and network facts when required;
- installer organisation and person, licence, training and accreditation valid at the activity date;
- old and new equipment models, serials, operating state, decommissioning, disposal, product-register IDs, warranty and recall state;
- quote, invoice, payment, customer contribution, safety certificate, plumbing or gas certificate, network approval and incentive disclosures; and
- retention, legal hold, audit, correction, submission and settlement rules.

## Evidence and photo custody

The working-tree native TLink evidence capture now requests full-quality images and available EXIF, hashes the exact picked bytes, encrypts those same bytes and stores a versioned evidence envelope with capture, time, permission, location and safe device provenance. The working-tree server schema can retain the envelope and original hash. This is still not production custody: hosted receipt validation, immutable object storage, access logging, retention, legal hold, backup and restore and representative real-device behaviour remain unverified. Existing customer-facing evidence sanitisation remains a separate privacy path and must never replace a compliance original.

Every future original compliance photo must preserve:

- original bytes, MIME type, filename, byte size and SHA-256;
- complete raw EXIF, XMP and IPTC metadata;
- local timestamp, timezone and normalised UTC time;
- latitude, longitude, altitude and location accuracy when captured;
- device make and model, operating system and capture application;
- actor, device registration, job, service site, compliance case, activity version, evidence stage and required shot type;
- upload receipt, offline queue identity and device-clock offset;
- derived OCR, serial matching, geofence, duplicate, perceptual hash, clock-skew and tamper flags stored separately;
- every transformation and derivative with its own hash; and
- review, rejection, supersession, retention and legal-hold state.

Originals must never be replaced by a compressed derivative, annotation or PDF. Federal battery evidence explicitly requires original image files, and NSW Home Energy Saver explicitly requires original geotagged before and after photos. VEU, NSW and SA photo requirements vary by activity and effective date. No general geotag mandate was found in the reviewed ACT, Queensland, Western Australian, Tasmanian or Northern Territory public program documents. TLink should preserve metadata universally while requiring GPS only through the applicable effective-dated evidence policy.

## Dataforce workflow observations

Read-only inspection of the signed-in Dataforce tenant established useful workflow patterns, not an authoritative activity catalogue:

- separate customer, job, participant, product, stock, audit, submission and access-control work areas;
- activity and audit filters, desktop audit progress, findings and follow-up;
- field-worker abilities, expiry attributes and participant IDs;
- staged VEU submission batches, data-file and JSON exports, asynchronous response upload and manual reconciliation;
- import and export tools and certificate-status history; and
- operator, read-only API and read-write API access types.

The inspected tenant exposed only a limited configured subset of activities, so its menus cannot seed a national catalogue. Its coarse access types are not sufficient for the proposed Creditex case, evidence, reviewer and auditor boundaries. Current product notices also showed that evidence rules can be introduced and retracted within days, reinforcing the need for effective-dated policy versions and a kill switch.

## Unresolved hard gates

1. NSW Home Energy Saver discount guidelines, activity specification, evidence payload and Creditex operating interface are unpublished.
2. Creditex, Dataforce and Runabout provider-owned field dictionaries, export schemas and API contracts require written authority or authorised documentation. Public observation is not a connector specification, and a connector specification is not a scheme rule.
3. VEU does not expose a supported public bulk product API. The released VEU importer treats the official embedded source as a monitored input with effective dates, statuses, schema and count guards, D1 indexed projections and exact-byte R2 custody; its 75,492-row production snapshot is active. The released TESSA D17 to D20 source is activated and current with exact-byte custody, source hashing and effective-dated status; historical product and rule windows must still fail closed when unsupported.
4. The official `gems-commercial-refrigerators` source decreased from 7,500 to 7,499 rows. The governed refresh rejected the unexplained decrease and current public GEMS search returns `OFFICIAL_PRODUCT_REGISTRY_STALE`. All GEMS-backed calculator paths remain fail-closed until prior and current retained bytes are exactly reviewed and the decrease is accepted or rejected.
5. CER-hosted public CEC files remain controlled-manual. The separate licensed PDRS snapshot route is deployed but cannot activate BESS1 or BESS2 until Sites contains `CREDITEX_CEC_BATTERY_API_USERNAME`, `CREDITEX_CEC_BATTERY_API_PASSWORD` and `CREDITEX_CEC_BATTERY_LICENCE_REFERENCE` and those credentials produce an accepted snapshot. BESS3 and BESS4 still need exact governed maximum rated AC inverter-output authority, and BESS5 still needs the Scheme Administrator's exact recording method.
6. SA has mixed-vintage factor links. Resolve the current Gazette and activity factor for each installation date, especially BS3B and LF1.
7. Creditex was not listed on the current public ACT Approved Energy Savings Provider register. All Creditex EEIS submission remains disabled. Any retailer or provider intake evidence must be separately labelled as a contractual delivery or connector requirement, never as an EEIS scheme rule. Activity 4.2 needs current legal interpretation after the NSW commercial-lighting closure.
8. The public SA provider register lists Creditex only for WH1, HC2A and HC2B. Other REPS activity codes remain disabled without an obliged retailer's authorised current scope. Plenti, Brighte, QRIDA, GrantsNT, SmartyGrants, NILS, REPS-R and TESSA do not expose a verified public claim-submission API contract in the reviewed sources; the released TESSA product-registry import does not imply one.
9. Product, participant, licence, recall, suspension and rule status must be revalidated at installation and again at claim or certificate creation where required.
10. No certificate count may be hardcoded from this document. Every calculator needs a versioned implementation, official test vectors or independently derived expected values approved for Creditex operations, reconciliation against the official tool and independent approval.
11. No real case can start until Creditex approves the role matrix, legal data-sharing boundary, customer notice and consent, retention schedule, incident process and evidence-custody design.

## Required release controls

- Four-eyes approval for the operational transcription of government activity rules and formulas before publication.
- Exact official source citation and SHA-256 on every published government-source version.
- Automated effective-date, suspension, withdrawal and cross-tenant denial tests.
- An immediate kill switch for a suspended activity or product list.
- Original-evidence immutability, audited access, retention and legal hold.
- Separate estimates, eligibility decisions, submissions and regulator-issued outcomes.
- Provider-neutral manual or documented export connectors until an authorised API contract exists.
- Creditex compliance and legal sign-off before production activity publication.
