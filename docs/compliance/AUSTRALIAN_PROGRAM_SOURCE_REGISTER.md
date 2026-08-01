# Australian energy program source register

Status: controlled discovery baseline, not an eligibility or calculation authority

Reviewed: 1 August 2026

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

Creditex states that its trading business creates and trades certificates and manages compliance nationwide for hot-water heat pumps, air conditioners, solar batteries and other energy-saving solutions. Its public accreditation claims reviewed on 1 August 2026 are:

- VEU Accredited Person A1107;
- NSW ESS Accredited Certificate Provider ACC0000107;
- NSW PDRS accreditations RDUE ACC0000108, SASC ACC0076224 and HADR ACC0076225;
- federal RET registered-agent accreditation 47056; and
- South Australian REPS activity-provider listing for residential WH1, HC2A and HC2B, which is not a public tradeable-certificate accreditation.

Sources: [Creditex Trading](https://trading.creditex.com.au/), [Creditex certificate services](https://trading.creditex.com.au/certificates/) and [ESCOSA REPS activity providers](https://www.escosa.sa.gov.au/industry/reps/obliged-retailers-activity-providers/technical-activity-providers).

The NSW Government also names Creditex as the delivery partner for the coming Home Energy Saver household discounts. The discount rules, evidence payload and operating interface were not public on 1 August 2026, so that program must remain future and disabled. Sources: [Home Energy Saver](https://www.energy.nsw.gov.au/households/grants-rebates/home-energy-saver) and [NSW announcement naming Creditex](https://www.energy.nsw.gov.au/news/energy-savings-nsw-households-loans-and-discounts-help-families-lower-their-bills).

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

These are source-register facts, not active TLink rules. This register does
not establish which approved case event selects the effective-date branch,
retain any exact source bytes or hashes, approve a clause transcription, or
activate a calculator. Those controls remain fail-closed pending exact-byte
retention and independent approval.

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
Essential Services Commission sources on 2 August 2026. A URL, title or
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

Status: current certificate scheme. An Accredited Certificate Provider nominated as Capacity Holder creates PRCs. The current public rule page states a 1 July 2026 rule; the research source set also contains a 1 April 2026 PDF. The exact July rule PDF and installation-date version must be resolved before publication.

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

No current state certificate or retailer-obligation scheme was found.

- Supercharged Solar for Renters: current grant, open from 12 December 2025, with capacity-banded rebates and approval required before installation. Source: [program page](https://www.qld.gov.au/housing/home-energy-savings/supercharged-solar-for-renters).
- Queensland Community Housing Energy Upgrades: current grant open 2 February to 30 October 2026, with approved primary measures for draught sealing, cooking, insulation, solar, air conditioning, water heating, shading and glazing and limited supplementary fan or LED work. Source: [provider-owned properties program](https://www.business.qld.gov.au/industries/housing-accommodation/community/energy-upgrades/provider-owned-properties).
- Home Energy Rating for existing homes: current accreditation and certificate service from 1 July 2026, not a rebate. Source: [rating program](https://www.chde.qld.gov.au/initiatives/modern-homes/home-energy-rating-existing-homes).
- PeakSmart new incentives, QBEST and Battery Booster are closed. Existing demand-response operation or legacy claims must remain historical only. Source: [PeakSmart](https://www.energex.com.au/manage-your-energy/peaksmart-air-conditioning) and [Battery Booster closed-program fact sheet](https://www.energyandclimate.qld.gov.au/__data/assets/pdf_file/0026/52964/retailer-fact-sheet-battery-booster.pdf).

## Western Australia

No current state certificate scheme was found.

- WA Residential Battery Scheme: current rebate and optional zero-percent loan. The state rebate differs between Synergy and Horizon areas; approved-vendor, VPP, product, installer, network and settlement controls apply. Federal battery STCs may stack where independently eligible. Sources: [scheme](https://www.wa.gov.au/organisation/energy-policy-wa/wa-residential-battery-scheme), [eligibility](https://www.wa.gov.au/organisation/energy-policy-wa/wa-residential-battery-scheme-eligibility-requirements) and [applicant information](https://www.wa.gov.au/government/wa-residential-battery-scheme-information-applicants).
- Small solar and battery connection requirements: current from 1 May 2026 for new or upgraded systems at or below 30 kVA. Source: [connection requirements](https://www.wa.gov.au/organisation/energy-policy-wa/new-requirements-small-scale-solar-and-battery-systems).
- Distributed Energy Buyback Scheme: current tariff or buyback program, not a certificate. Source: [buyback schemes](https://www.wa.gov.au/organisation/energy-policy-wa/energy-buyback-schemes).
- Energy Ahead: current hardship and household-assistance program, not an open tradie claim channel. Source: [program announcement](https://www.wa.gov.au/government/announcements/energy-ahead-formerly-the-household-energy-efficiency-scheme).
- Charge Up EV Round 3 and Clean Energy Future Fund Round 4 are closed to applications, although approved milestone claims may remain in flight. Source: [Charge Up EV FAQ](https://www.wa.gov.au/organisation/energy-policy-wa/faq-charge-grants).

## Tasmania

No current state certificate scheme was found.

- PowerSmart for Small Business: current energy-audit reimbursement program through 30 June 2028 or exhaustion of funding. Source: [program page](https://www.recfit.tas.gov.au/grants_programs/energy-efficiency/powersmart_for_small_business).
- No Interest Loan Scheme Energy Saver subsidy: current low-income appliance and heat-pump support through 2027 to 2028, with the exact product list and caps controlled by the delivery provider and therefore unresolved. Source: [energy bill relief](https://www.recfit.tas.gov.au/grants_programs/energy/energy_bill_relief).
- Feed-in tariff: current regulated tariff, 9.276 cents per kWh from 1 July 2026 to 30 June 2027, with network and DER registration requirements. Sources: [Tasmanian Economic Regulator tariff](https://www.economicregulator.tas.gov.au/electricity/pricing/feed-in-tariffs), [TasNetworks solar connections](https://www.tasnetworks.com.au/solar-connections) and [DER Register](https://www.tasnetworks.com.au/Connections/Distributed-Energy-Resource-Register).
- Energy Saver Loan Scheme closed 1 September 2025. Business Energy Efficiency Scheme, ChargeSmart, Deliver-e and earlier EV rebates are closed or require confirmation of legacy settlement only. Source: [closed loan scheme](https://www.recfit.tas.gov.au/grants_programs/energy-efficiency/energy_saver_loan_scheme).

## Northern Territory

No current state certificate scheme was found.

- Solar for Multi Dwellings: current grant closing 31 December 2027 or earlier if funding is exhausted. It covers shared PV, sharing technology, smart meters and batteries only when installed with the shared system, subject to title, body-corporate, network, design, quote, resolution, completion and audit evidence. Sources: [program](https://nt.gov.au/industry/business-grants-funding/solar-for-multi-dwellings-grant-scheme) and [terms](https://nt.gov.au/_media/docs/business-and-industry/grants/solar-for-multi-dwellings-grants-scheme-terms-and-conditions.pdf).
- Jacana feed-in tariffs: current tariff products for 1 July 2026 to 30 June 2027, not installer certificates. Source: [Jacana pricing](https://www.jacanaenergy.com.au/index.php/residential/pricing).
- Home and Business Battery Scheme and EV charger grants are closed. Sources: [battery scheme](https://nt.gov.au/industry/business-grants-funding/home-and-business-battery-scheme) and [EV charger grants](https://nt.gov.au/industry/business-grants-funding/electric-vehicle-charger-residential-and-business-grants-scheme).
- Time-of-use tariffs are customer tariff choices, and Remote Renewable Power Rollout is infrastructure procurement. Neither is an ordinary trade claim.

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
3. The final NSW July 2026 evidence and method-guide consultation outcome is not published. Consultation text is not effective law.
4. The exact July 2026 PDRS rule source must supersede or reconcile the public April 2026 PDF before an activity version is published.
5. SA has mixed-vintage factor links. Resolve the current Gazette and activity factor for each installation date, especially BS3B and LF1.
6. Creditex was not listed on the current public ACT Approved Energy Savings Provider register. All Creditex EEIS submission remains disabled. Any retailer or provider intake evidence must be separately labelled as a contractual delivery or connector requirement, never as an EEIS scheme rule. Activity 4.2 needs current legal interpretation after the NSW commercial-lighting closure.
7. The public SA provider register lists Creditex only for WH1, HC2A and HC2B. Other REPS activity codes remain disabled without an obliged retailer's authorised current scope. Plenti, Brighte, QRIDA, GrantsNT, SmartyGrants, NILS, REPS-R and TESSA do not expose a verified public claim API contract in the reviewed sources.
8. Product, participant, licence, recall, suspension and rule status must be revalidated at installation and again at claim or certificate creation where required.
9. No certificate count may be hardcoded from this document. Every calculator needs a versioned implementation, official test vectors or independently derived expected values approved for Creditex operations, reconciliation against the official tool and independent approval.
10. No real case can start until Creditex approves the role matrix, legal data-sharing boundary, customer notice and consent, retention schedule, incident process and evidence-custody design.

## Required release controls

- Four-eyes approval for the operational transcription of government activity rules and formulas before publication.
- Exact official source citation and SHA-256 on every published government-source version.
- Automated effective-date, suspension, withdrawal and cross-tenant denial tests.
- An immediate kill switch for a suspended activity or product list.
- Original-evidence immutability, audited access, retention and legal hold.
- Separate estimates, eligibility decisions, submissions and regulator-issued outcomes.
- Provider-neutral manual or documented export connectors until an authorised API contract exists.
- Creditex compliance and legal sign-off before production activity publication.
