import { AEA_SERVICE_IDENTITIES, AEA_BUNDLE_IDENTITIES } from "./aea-service-identity.mjs";
export { AEA_RESERVED_SERVICE_IDS, isAeaReservedService, requiresAeaDelivery } from "./aea-service-identity.mjs";

// Australian Energy Assessments's service and commercial catalogue. Prices are fixed AUD cents excluding GST.
// Customer offers and schema derive GST-inclusive totals from this single source.
export const AEA_SERVICE_REVIEW_DATE = "2026-09-14";
const sources = {
  smoke: { label: "Consumer Affairs Victoria: smoke alarms", url: "https://www.consumer.vic.gov.au/housing/renting/repairs-alterations-safety-and-pets/keeping-the-property-safe/smoke-alarms-and-fire-safety" },
  safety: { label: "Consumer Affairs Victoria: gas and electrical safety", url: "https://www.consumer.vic.gov.au/housing/renting/repairs-alterations-safety-and-pets/gas-electrical-and-water-safety-standards/rental-providers-gas-and-electrical-safety" },
  electrical: { label: "Energy Safe Victoria: residential tenancy electrical checks", url: "https://www.energysafe.vic.gov.au/industry-guidance/electrical/electricians-toolkit/residential-tenancy" },
  minimum: { label: "Consumer Affairs Victoria: rental minimum standards", url: "https://www.consumer.vic.gov.au/housing/renting/repairs-alterations-safety-and-pets/minimum-standards/minimum-standards-for-rental-properties" },
  cords: { label: "ACCC Product Safety: blind and curtain cord standards", url: "https://www.productsafety.gov.au/business/search-mandatory-standards/blinds-curtains-and-window-fittings-mandatory-standard" },
  minimumFuture: { label: "Consumer Affairs Victoria: upcoming minimum energy-efficiency standards", url: "https://www.consumer.vic.gov.au/resources-and-tools/legislation/public-consultations-and-reviews/new-minimum-energy-efficiency-standards" },
  ratingNew: { label: "Home Energy Rating: understanding your new-home certificate", url: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate" },
  ratingAssessment: { label: "Home Energy Rating: getting an existing-home assessment", url: "https://www.homeenergyrating.gov.au/households/existing-homes/how-get-assessment" },
  rating: { label: "Australian Government: Home Energy Rating", url: "https://www.homeenergyrating.gov.au/" },
  gas: { label: "Building and Plumbing Commission: gas servicing and records", url: "https://www.bpc.vic.gov.au/plumbers/delivering-safe-and-compliant-plumbing/as-4575-servicing-type-a-gas-appliances" },
  gasForm: { label: "BPC gas reporting form (regulator record, not the full customer service record)", url: "https://www.bpc.vic.gov.au/resource-hub/forms/bpc-gas-servicing-record-reporting-form" },
  electricalChecklist: { label: "Energy Safe electrical checklist PDF (May 2021 template; use current 2022 standard)", url: "https://www.energysafe.vic.gov.au/sites/default/files/2022-12/ElectricalSafetyChecklist_May2021.pdf" },
  electricalExample: { label: "Energy Safe electrical report example PDF (May 2021)", url: "https://www.energysafe.vic.gov.au/sites/default/files/2022-12/ElectricalSafetyCheckReport_sample_May2021.pdf" },
  minimumChecklist: { label: "Consumer Affairs Victoria: rental minimum standards checklist PDF", url: "https://www.consumer.vic.gov.au/library/publications/housing-and-accommodation/renting/rental-minimum-standards/rental-minimum-standards-checklist-for-rental-providers-pdf.pdf" },
  ratingConsent: { label: "Home Energy Rating: client information and consent form PDF", url: "https://www.homeenergyrating.gov.au/sites/default/files/2026-08/NatHERS%20Client%20Information%20and%20Consent%20Form.pdf" },
  ratingTechnical: { label: "Home Energy Rating: existing-home assessment Technical Note", url: "https://www.homeenergyrating.gov.au/resources/existing-homes-technical-note" },
};

export const AEA_SERVICES = Object.freeze([
  {
    ...AEA_SERVICE_IDENTITIES.smokeAlarmBlindSafety,
    cadence: "Per annual visit", icon: "shield",
    title: "Smoke Alarm & Blind Safety Checks Victoria",
    inclusions: [
      "Inspect every smoke alarm's location, condition, power supply and expiry",
      "Test and clean alarms, with replacement batteries included",
      "Standard like-for-like replacement of faulty or expired alarms included",
      "Check corded blinds and curtains, with basic cord anchors and safety labels included",
      "Between-visit fault callouts for covered smoke alarms and blind safety devices",
      "Item-by-item results, photos and any further action clearly recorded",
      "One combined smoke and blind safety report, with the next smoke check due date",
      "Same-day email of your completed report",
      "Secure shareable report link and downloadable PDF"
    ],
    scope: "The $100 + GST annual service includes batteries, standard like-for-like replacement alarms, basic cord anchors and labels, and fault callouts between annual visits. Standard hardwired alarm replacement is carried out by an appropriately licensed electrician. New wiring, changes to the alarm layout or interconnection, specialist alarm systems and major blind repairs are scoped and authorised separately.",
    legal: "Victorian rental providers must arrange smoke alarm safety checks at least every 12 months. Our annual blind safety check is an included service interval; it is not a claim that Victorian law requires an annual blind inspection. Hardwired alarm electrical work requires an appropriately licensed electrician.",
    faqs: [
      [
        "What does the $100 + GST service include?",
        "The annual service is $110 including GST. It covers smoke alarm inspection, testing and cleaning; replacement batteries; standard like-for-like replacement of faulty or expired alarms; blind and curtain cord checks; basic cord anchors and safety labels; and fault callouts between annual visits. You also receive one combined report with a secure link and downloadable PDF."
      ],
      [
        "Are replacement alarms and batteries really included?",
        "Yes. Replacement batteries and standard like-for-like alarm replacements are included. Hardwired replacements are performed by an appropriately licensed electrician. If the property needs new wiring, additional alarm locations, changes to interconnection or a specialist alarm system, we explain that additional scope before you authorise it."
      ],
      [
        "What is included in the blind safety check?",
        "We inspect accessible corded blinds and curtains for unsafe loops and missing, loose or damaged safety devices. Basic cord anchors and safety labels are included. A damaged blind mechanism, replacement window covering or major repair is identified separately. The findings show which coverings were checked and any access limitations."
      ],
      [
        "How often must smoke alarms and blinds be checked?",
        "Victorian rental smoke alarm checks are required at least every 12 months. Our service includes a blind cord safety check at each annual visit. That annual blind check is our service commitment; it is not a separate claim that Victorian law requires an annual blind inspection."
      ],
      [
        "What happens if an alarm develops a fault between visits?",
        "Contact Australian Energy Assessments as soon as a fault is reported. Fault callouts for the covered smoke alarms and blind safety devices are included between annual visits, and we arrange the response according to the fault and its urgency. Included standard replacements remain covered; any separate wiring or specialist repair work is explained before authorisation."
      ],
      [
        "Do I need to prepare the property or be there?",
        "Provide the property address, tenant or access contact, and any previous report or known fault. We need safe access to each alarm and corded window covering, so please arrange for furniture or stored items that block access to be moved. We agree the access arrangements before the visit; the owner does not need to attend personally if authorised access is available."
      ],
      [
        "What happens if an item is unsafe or cannot be checked?",
        "The report identifies the affected alarm or window covering, the finding, evidence and action taken or still needed. Included remedial work is recorded. Unsafe smoke alarms require urgent attention, and an inaccessible or untested item is never recorded as passing. Further work outside the included scope is explained before authorisation."
      ],
      [
        "When and how will I receive my report?",
        "Your completed smoke and blind safety report is emailed the same day, with a secure shareable link and a downloadable PDF. It records the work actually performed, including any defects or limitations. Provide the correct authorised landlord or agent email address when booking so the record reaches the right person."
      ],
      [
        "Is the report a compliance certificate?",
        "It is a dated service and safety record showing the alarms and blind cords checked, their findings and any work performed. It does not certify that unrelated parts of the property meet every rental standard. Where electrical work requires a Certificate of Electrical Safety, that is a separate practitioner-issued record."
      ],
      [
        "Can I include this in a two-year safety bundle?",
        "Yes. Both bundles include two annual smoke and blind services with these same standard inclusions, plus one electrical check. The gas bundle also includes one gas check with no appliance surcharge. Each completed visit has one combined report; the second annual service is completed and recorded when it takes place."
      ]
    ], sources: [sources.smoke, sources.minimum, sources.cords],
  },
  {
    ...AEA_SERVICE_IDENTITIES.gasSafety,
    cadence: "Per safety check", icon: "flame",
    title: "Rental Gas Safety Checks Victoria",
    inclusions: [
      "Appropriately qualified gasfitter with the required Type A servicing endorsement",
      "Gas installation, fitting and appliance safety checks within the tenancy scope",
      "Every in-scope gas appliance included, with no additional appliance charge",
      "Appliance identification and servicing under the applicable AS 4575 requirements",
      "Relevant leak, ventilation, flue, combustion and safety checks",
      "Defect evidence, safety actions and the next check due date",
      "Complete written gas service record alongside the visit findings",
      "Same-day email of your completed report and gas service record",
      "Secure shareable report link and downloadable PDF"
    ],
    scope: "No extra charge for additional gas appliances. The fixed inspection price is per property. Repairs, replacement parts and appliance replacement are explained and authorised separately.",
    legal: "For tenancies covered by Victoria's gas safety-check requirements, checks are required every two years where gas is supplied. Servicing must follow the applicable AS 4575 requirements. A complete service record and the required regulatory submission are separate obligations; a simple inspection summary does not replace them.",
    faqs: [
      [
        "What does a gas safety check cost, and are extra appliances included?",
        "The fixed price is $250 + GST, or $275 including GST per property. There is no surcharge for additional in-scope gas appliances. The gasfitter records each appliance and performs the applicable installation and servicing checks. Repairs, replacement parts and replacement appliances are authorised separately."
      ],
      [
        "Who performs the check?",
        "An appropriately qualified gasfitter with the required Type A appliance-servicing endorsement performs the gas work. The service record identifies the practitioner and their licence or registration details, including the licensed issuer or supervisor where required. An electrician's licence alone does not authorise gas servicing."
      ],
      [
        "Which parts of the gas system are checked?",
        "The check covers the gas installation, fittings and appliances within the residential tenancy scope. It includes the relevant leak, isolation, accessibility, clearance, ventilation, flue, combustion and appliance-servicing checks. Each appliance's details, findings and required actions are recorded; a quick carbon monoxide reading alone is not the whole service."
      ],
      [
        "How often is a gas safety check required?",
        "Victorian rental gas safety checks are required every two years for covered tenancies where gas is supplied. Send us the last report so the next appointment can follow the actual due date. An overdue or unknown check should be arranged promptly, including when you select a two-year bundle."
      ],
      [
        "Do all-electric properties need a gas check?",
        "A property with no gas supply does not need this gas safety service. The electrical, smoke and blind bundle is the appropriate option for an all-electric property. If the property still has a gas connection or disconnected appliances and you are unsure of the scope, tell us when enquiring so the gasfitter can confirm what needs checking."
      ],
      [
        "How should the property be prepared?",
        "Tell us about every gas appliance, any known fault and the previous service report. Arrange safe access to appliances, meters, isolation points and the areas needed for inspection. Confirm the gas supply and other services needed for testing are available; a disconnected supply or blocked appliance can prevent a complete check."
      ],
      [
        "What happens if a gas appliance is unsafe?",
        "The gasfitter explains the finding and takes the appropriate safety action, which can include isolating an unsafe appliance. The report records the defect, action taken and further work required. Repairs and parts outside the service scope need separate authorisation. A completed report can contain failed findings; it does not mean every appliance passed."
      ],
      [
        "When will I get the report and supporting records?",
        "The completed report and full gas service record are emailed the same day, with a secure shareable link and downloadable PDF. The record includes the applicable AS 4575 service documentation. Regulatory reporting is a separate obligation of the licensed practitioner; a short visit summary does not replace the complete customer service record."
      ],
      [
        "Can gas, smoke and blind checks share one report?",
        "Yes. A gas visit can include the annual smoke alarm and blind safety service, with one combined report covering the work completed at that visit. Electrical work must be completed by the appropriately licensed electrician. Bundle appointments follow each check's due date; a gas check that is already due is not postponed merely to fit a second-year visit."
      ],
      [
        "Does gas safety testing replace the rental minimum standards assessment?",
        "No. The gas report records the gas work and its findings. It does not assess every rental minimum standard, the electrical installation or the home's energy rating. Those services can be selected with your enquiry so Australian Energy Assessments can coordinate the required scope."
      ]
    ], sources: [sources.safety, sources.gas, sources.gasForm],
  },
  {
    ...AEA_SERVICE_IDENTITIES.electricalSafety,
    cadence: "Per safety check", icon: "bolt",
    title: "Rental Electrical Safety Checks Victoria",
    inclusions: [
      "Licensed electrician, with practitioner and licence details recorded",
      "Visual inspection of the installation and accessible electrical equipment",
      "Required switchboard, earthing and circuit checks",
      "Safety-switch inspection and testing, with the required results recorded",
      "Inspection and test results against the applicable AS/NZS 3019:2022 requirements",
      "Photos, clear defect findings and anything that could not be inspected",
      "Written safety-check report, recommended actions and next check due date",
      "Same-day email of your completed electrical safety report",
      "Secure shareable report link and downloadable PDF"
    ],
    scope: "The fixed price covers the safety inspection, testing and report. Repairs, switchboard upgrades and replacement equipment are quoted and authorised separately.",
    legal: "For tenancies covered by Victoria's electrical safety-check requirements, checks are required every two years. Energy Safe Victoria specifies section 4 of AS/NZS 3019:2022. Electrical repair or maintenance work requires a Certificate of Electrical Safety; the safety-check report is not a substitute for that certificate.",
    faqs: [
      [
        "What is included in the $250 + GST price?",
        "The electrical safety check costs $275 including GST per property. It covers the licensed electrician's inspection, required testing and written report, with recorded results, defects and limitations. Electrical repairs, replacement equipment and switchboard upgrades are scoped and authorised separately."
      ],
      [
        "What does the electrician inspect and test?",
        "The electrician checks the installation and accessible equipment under the applicable section 4 requirements of AS/NZS 3019:2022. The work includes relevant switchboard, earthing, circuit and safety-switch inspection and testing. The report records the actual tests and coverage; a visual glance at the switchboard is not a complete electrical safety check."
      ],
      [
        "How often is an electrical safety check required?",
        "Victorian rental requirements specify a check every two years for covered tenancies. Give us the latest report so we can work from the actual due date. If the last check is unknown or overdue, arrange the check promptly instead of waiting for the next annual smoke alarm visit."
      ],
      [
        "Is this a Certificate of Electrical Safety?",
        "The safety-check report records the installation's condition and test results. A Certificate of Electrical Safety, or COES, is a separate record required for electrical installation, repair or maintenance work. Where work requires a COES, the electrician issues the applicable certificate; it does not replace the rental safety-check report."
      ],
      [
        "Will the electricity need to be turned off?",
        "Some inspection and testing needs the power to be interrupted. Tell us before the appointment about medical equipment, alarms, computers, sensitive appliances or other access needs so the electrician can coordinate the testing. Arrange safe access to the switchboard, outlets and equipment that need inspection."
      ],
      [
        "What happens if the electrician finds a fault?",
        "The report identifies the defect, supporting evidence and required action. The electrician explains any immediate safety response and the repair needed. Repairs outside the inspection price are separately authorised. An unsafe or untested item remains clearly identified even when the inspection report is complete."
      ],
      [
        "When and how will I receive the report?",
        "Your completed electrical safety report is emailed the same day, with a secure shareable link and downloadable PDF. It includes the inspection date, practitioner details, results, limitations and next check due date. Any applicable certificate for separate electrical work is issued by the electrician as that work is completed."
      ],
      [
        "Can the electrician complete smoke and blind checks at the same visit?",
        "Yes. The electrical, smoke alarm and blind safety visit can produce one combined report for those completed checks. Our two-year electrical bundle also includes the second annual smoke and blind service, with its own dated record when performed."
      ],
      [
        "Does this include portable appliance test and tag?",
        "This is the rental property's electrical safety inspection and testing service. A separate inventory-based portable appliance test-and-tag programme is not implied by the price. Tell us about supplied appliances and any specific test-and-tag requirement so the electrician can confirm the required scope."
      ],
      [
        "Does a satisfactory report guarantee the property stays safe for two years?",
        "The report records the installation's condition and the testing completed on the inspection date. New faults, damage or alterations can occur afterwards and must be addressed when identified. Keep the report available and arrange qualified attention for a new electrical fault rather than waiting for the next scheduled check."
      ]
    ], sources: [sources.electrical, sources.safety, sources.electricalChecklist, sources.electricalExample],
  },
  {
    ...AEA_SERVICE_IDENTITIES.minimumRentalStandards,
    cadence: "Per onsite assessment", icon: "home",
    title: "Rental Minimum Standards Assessment Victoria",
    inclusions: [
      "Onsite assessment against the applicable Victorian rental minimum standards",
      "Room-by-room observations covering the relevant 15 standard categories",
      "Checks of amenities, locks, windows, ventilation, heating and other applicable items",
      "Visual findings on mould, damp, structural soundness and weatherproofing",
      "Window-covering and cord-anchor observations",
      "Dated photo evidence and clear compliant, non-compliant or unable-to-assess findings",
      "Practical actions and any specialist evidence still needed",
      "Same-day email of your completed assessment report",
      "Secure shareable report link and downloadable PDF"
    ],
    scope: "This assessment includes visual observations of structural soundness and weatherproofing against the rental minimum standards. Specialist structural engineering, pest and asbestos investigations are separate. Licensed electrical and gas safety testing and the annual smoke service are only included when selected.",
    legal: "Victorian rental properties must meet the applicable minimum standards before they are advertised for rent. Requirements include window-covering cord anchors, and further energy-efficiency standards are being phased in. The assessment uses the requirements applicable to the property and inspection date; an inspection report cannot guarantee future compliance.",
    faqs: [
      [
        "What does the assessment cost and include?",
        "The onsite assessment is $170 + GST, or $187 including GST. We assess the applicable Victorian rental minimum standards, record the property's condition with photos and explain defects or missing evidence. The completed report is emailed with a secure shareable link and downloadable PDF."
      ],
      [
        "Which rental minimum standards are covered?",
        "We work through the relevant 15 categories, including bathrooms, toilets, kitchen and laundry facilities, lighting, locks, heating, ventilation, windows and coverings, cord anchors, bins, mould and damp, structural soundness, weatherproofing and electrical-safety evidence. Applicability depends on the property, tenancy and assessment date."
      ],
      [
        "When should I book the assessment?",
        "Arrange it early enough to identify and address defects before advertising or offering the property for rent. Send any existing reports and relevant tenancy information when booking. The inspection helps identify what needs attention; booking an assessment does not itself make a non-compliant property ready to advertise."
      ],
      [
        "Are electrical, gas and smoke safety services included?",
        "They are separate services. We record relevant observations and available specialist evidence, but the minimum standards assessment does not replace licensed electrical or gas testing or the annual smoke alarm service. You can select those services in the same enquiry for coordinated booking."
      ],
      [
        "What access and documents do you need?",
        "Arrange safe access to every relevant room, external area and item being assessed. Provide the latest electrical and gas reports, any applicable exemption evidence and details of known defects. If access or specialist evidence is missing, the report identifies the limitation and the follow-up needed."
      ],
      [
        "What happens if the property does not meet a standard?",
        "The report identifies the affected item, evidence and practical next action. Some findings need repairs; others need a licensed trade or specialist assessment before a conclusion can be reached. Repairs are separate from this assessment. An unresolved item is not marked compliant simply because a report has been issued."
      ],
      [
        "Is this a government compliance certificate?",
        "No. You receive a dated assessment report with observed findings, supporting evidence and limitations. It is not a government-issued certificate, a structural engineering report or a guarantee about hidden defects or future condition. Separate professional reports remain necessary where the particular standard requires them."
      ],
      [
        "When will I receive the report?",
        "The completed onsite assessment report is emailed the same day, with a secure shareable link and downloadable PDF for your property records. It clearly identifies any defects, inaccessible areas or missing specialist evidence, so a completed report is not confused with a finding that every standard has been met."
      ],
      [
        "Do the new energy-efficiency standards apply now?",
        "Victoria's additional energy-efficiency requirements phase in from 2027, with different dates and triggers for different measures. We apply the requirements relevant to the property and assessment date. Future requirements can be highlighted for planning, without incorrectly recording a future rule as a current failure."
      ],
      [
        "Do I need another assessment every year?",
        "This is a dated assessment rather than an annual certification programme. Rental providers must keep the property compliant, and changes to its condition, tenancy circumstances or applicable rules can require further checking. Annual smoke alarm servicing and the applicable two-year electrical and gas checks have their own schedules."
      ]
    ], sources: [sources.minimum, sources.minimumChecklist, sources.minimumFuture],
  },
  {
    ...AEA_SERVICE_IDENTITIES.nathersNew,
    cadence: "Per assessment", icon: "home",
    title: "NatHERS Assessments for New Homes",
    inclusions: [
      "Review of complete building plans and supplied specifications",
      "Assessment through the applicable NatHERS pathway by an accredited assessor",
      "Modelling of the home's thermal performance",
      "Applicable Whole of Home assessment requirements confirmed for the project",
      "Design feedback explaining the assessment findings",
      "Applicable final assessment report and certificate documentation",
      "Same-day email of final documentation once modelling and certification are complete",
      "Secure shareable document link and downloadable PDF"
    ],
    scope: "Supply complete plans and specifications. We confirm the required assessment scope and documents before starting. BASIX, redesign work and separate specialist reports are not implied by this service price.",
    legal: "New-home energy requirements depend on jurisdiction, approval date and project scope. An accredited assessment does not guarantee planning or building approval. NatHERS thermal and Whole of Home requirements must be applied where required.",
    faqs: [
      [
        "What is the assessment price?",
        "The NatHERS new-home assessment is $300 + GST, or $330 including GST. We review the plans and confirm the required assessment and documentation before starting. BASIX, separate specialist reports and redesign work are not implied by this service price."
      ],
      [
        "What plans and specifications should I supply?",
        "Supply the current floor plans, elevations, sections and site information, together with the proposed construction, insulation, glazing and shading specifications. Provide the appliance and system selections needed for any applicable Whole of Home assessment. Complete, consistent information helps avoid modelling delays and unsupported assumptions."
      ],
      [
        "What is the difference between thermal and Whole of Home assessment?",
        "Thermal assessment models how the design affects heating and cooling demand. Whole of Home assessment considers the applicable home's energy systems and their modelled energy performance. Which assessments are needed depends on the project's approval requirements; we confirm the required pathway before the work starts."
      ],
      [
        "Is a site visit needed, and where is the service available?",
        "New-home energy assessments generally use the building plans and specifications, so plan-based work is available Australia-wide. The project location still matters because climate and approval requirements affect the assessment. If the project needs an additional site inspection, that scope is confirmed separately."
      ],
      [
        "What happens if the design does not achieve the required result?",
        "We explain the modelled result and the design features affecting it, so you can consider appropriate changes with your designer or builder. We do not promise that every submitted design will pass. Revised design or additional assessment work is discussed before it is authorised, and final documentation must match the design being assessed."
      ],
      [
        "When will I receive the certificate?",
        "The final report and applicable certificate are emailed the same day that modelling, required information and certification are complete. You receive a secure shareable link and downloadable PDF. This is not a promise that a new project will be fully assessed on the day plans are submitted; completion depends on the assessment scope and complete project information."
      ],
      [
        "Does the certificate guarantee building approval?",
        "No. The assessment provides the energy-performance documentation applicable to the project. Your building surveyor, certifier or relevant authority determines the full approval requirements, which can include other documents and compliance matters outside this energy assessment."
      ],
      [
        "Can I use an existing-home rating for a new build or renovation approval?",
        "An existing-home rating follows a different pathway and is not a substitute for the assessment required for building approval. Tell us whether the project is a new build, extension or alteration so the appropriate energy-assessment scope can be confirmed."
      ],
      [
        "What if the plans change after the assessment?",
        "Tell us about changes to the assessed design or specifications before relying on the existing result. Changes to glazing, insulation, construction, orientation or systems can affect the outcome. We confirm whether the assessment and documentation need updating; the old certificate should not be assumed to cover a changed design."
      ]
    ], sources: [sources.rating, sources.ratingNew],
  },
  {
    ...AEA_SERVICE_IDENTITIES.nathersExisting,
    cadence: "Per assessment", icon: "home",
    title: "Home Energy Rating for Existing Homes | NatHERS",
    inclusions: [
      "Onsite assessment of the existing home's construction and relevant appliances",
      "Property measurements and evidence needed for the existing-home rating pathway",
      "Assessment by an assessor accredited for the existing-home stream",
      "Home Energy Rating and Star Rating documentation",
      "Property-specific energy and comfort improvement guidance",
      "Explanation of the result and practical priorities for your home",
      "Same-day email of final documentation once modelling and certification are complete",
      "Secure shareable document link and downloadable PDF"
    ],
    scope: "Onsite appointments are mainly in NSW and Victoria. We confirm location and access before booking. Rebates or discounts are not assumed in this fixed price.",
    legal: "The Australian Government's Home Energy Rating framework covers existing homes as a distinct accredited pathway. The client information and consent form must be completed for each assessment, separately from consent to any other services. An existing-home rating is not a new-home building approval certificate or a rental safety certificate.",
    faqs: [
      [
        "What does an existing-home rating cost?",
        "The assessment is $300 + GST, or $330 including GST. It includes the onsite assessment, the accredited existing-home rating and property-specific improvement guidance. Rebates or discounts are not assumed in this fixed price, and appointment availability is confirmed for your address."
      ],
      [
        "Is Home Energy Rating the same service as NatHERS for existing homes?",
        "Home Energy Rating is the current public name for the national framework. The existing-home service follows its own accredited assessment pathway, using information about the home as it stands. Accreditation for new-home work alone does not establish accreditation for the existing-home stream."
      ],
      [
        "What happens during the onsite assessment?",
        "The assessor collects the measurements, construction and appliance information needed for the rating, supported by accessible observations and evidence. You can explain comfort issues and planned upgrades. The findings are then modelled through the accredited process; the onsite visit is one part of producing the final rating."
      ],
      [
        "How should I prepare for the visit?",
        "Provide available plans, renovation details, insulation or glazing information and appliance specifications. Arrange safe access to the areas the assessor needs to inspect and tell us about access limitations beforehand. Unknown or inaccessible features must be handled under the assessment method rather than treated as verified facts."
      ],
      [
        "Why do I need to complete a consent form?",
        "The scheme requires the official Client Information and Consent Form for each existing-home assessment. It explains how assessment information and rating records are used, including the scheme's publication and opt-out arrangements. Consent to the rating is separate from permission to share your details for another service or trade referral."
      ],
      [
        "What documents will I receive?",
        "You receive the applicable Home Energy Rating and Star Rating documentation, together with property-specific energy and comfort improvement guidance. The final documents are provided through a secure shareable link with a downloadable PDF. They describe the assessed home and the modelled result, rather than certifying rental safety."
      ],
      [
        "Will I receive the certificate on the day of the visit?",
        "The final documentation is emailed the same day that the modelling and certification are complete. Some work takes place after the onsite visit, and missing evidence may need to be resolved before the rating can be issued. We do not describe the inspection date as the certificate issue date unless the assessment is actually complete."
      ],
      [
        "Will the rating tell me exactly how much I will save?",
        "The rating and guidance help identify improvement opportunities, but modelled performance is not a guaranteed bill reduction. Actual energy use depends on occupancy, weather, tariffs, appliance settings and how the home is used. Any proposed upgrade should be considered against your circumstances and the assessment findings."
      ],
      [
        "Can I use this for building approval or rental compliance?",
        "An existing-home energy rating is distinct from new-home building-approval assessments and rental safety checks. It does not replace an electrical, gas, smoke alarm or minimum standards report. Tell us the purpose of the assessment so the correct service is selected."
      ],
      [
        "Should I choose this or the $180 + GST onsite energy visit?",
        "Choose the existing-home rating when you want formal accredited rating documentation and the associated modelling. Choose the onsite energy visit for practical observations and improvement advice without a certificate. Both can help identify priorities, but only the accredited rating service provides the applicable formal rating documents."
      ]
    ], sources: [sources.rating, sources.ratingAssessment, sources.ratingConsent, sources.ratingTechnical],
  },
  {
    ...AEA_SERVICE_IDENTITIES.onsiteEnergyAssessment,
    cadence: "Per onsite visit", icon: "bolt",
    title: "Onsite Home Energy Assessment Without a Certificate",
    inclusions: [
      "Onsite walk-through and discussion of your comfort and energy priorities",
      "Accessible observations about insulation, draughts and glazing",
      "Review of major appliances and how the home is used",
      "Discussion of the bills and property information you choose to provide",
      "Practical improvement priorities and next steps",
      "Written advice summary with observed findings and limitations",
      "Same-day email of your completed advice summary",
      "Secure shareable summary link and downloadable PDF",
      "Advice service with no formal rating or compliance certificate"
    ],
    scope: "This service does not issue a NatHERS, Home Energy Rating or compliance certificate. Specialist tests and licensed safety checks are separate services.",
    legal: "Advice is based on accessible observations and the information provided. It does not replace electrical, gas, structural or other specialist inspections, and does not guarantee energy savings.",
    faqs: [
      [
        "What is included in the $180 + GST visit?",
        "The visit is $198 including GST. We walk through the home, discuss your energy and comfort priorities, review accessible building and appliance features, and provide practical improvement advice. You receive a written summary with a secure shareable link and downloadable PDF. This service does not issue a formal rating certificate."
      ],
      [
        "Who is this service useful for?",
        "It is useful when you want help understanding a hot, cold or expensive-to-run home and deciding what to investigate or improve first. You can discuss planned upgrades and everyday use. If your objective requires a formal Home Energy Rating or building-approval document, choose the applicable accredited assessment service."
      ],
      [
        "What information should I prepare?",
        "Bring any recent bills, plans, renovation details and appliance information you would like us to consider. Note the rooms or times of day that feel uncomfortable and any upgrades you are considering. Arrange safe access to the relevant areas; advice is based on accessible observations and the information provided."
      ],
      [
        "Will I receive a NatHERS certificate or star rating?",
        "No. This is an advice service and provides neither a NatHERS or Home Energy Rating certificate nor a formal star rating. The $300 + GST existing-home assessment follows the accredited rating pathway if you need those documents."
      ],
      [
        "Does the visit include gas or electrical safety testing?",
        "No. Licensed gas and electrical checks, smoke alarm servicing and rental minimum standards assessments are separate services. An energy observation does not certify an appliance or installation as safe. If a recommendation depends on gas ventilation or other specialist findings, the relevant qualified assessment is needed."
      ],
      [
        "Are blower-door tests, thermal imaging or invasive inspections included?",
        "Specialist tests and invasive investigations are not included in the standard walk-through price. We identify when further investigation could help and explain the separate scope before it is authorised. Accessible observations are recorded as observations, without suggesting an unperformed test has verified them."
      ],
      [
        "When will I get the written advice?",
        "Your completed advice summary is emailed the same day, with a secure shareable link and a downloadable PDF. It records the findings, practical priorities and any limitations or follow-up investigation needed. It is an advice record, not a safety or energy-rating certificate."
      ],
      [
        "Can you guarantee lower bills after the visit?",
        "No. The visit helps you make informed decisions, but savings depend on the work undertaken, its quality, tariffs, weather and how the home is used. Recommendations are based on your priorities and the available evidence, rather than a fixed savings promise."
      ],
      [
        "Where are onsite appointments available?",
        "Onsite assessments are currently offered mainly in NSW and Victoria. We confirm availability and access for the property's address before arranging the appointment. New-home plan-based assessments follow a different service pathway and are available Australia-wide."
      ]
    ], sources: [sources.rating],
  },
].map((service) => Object.freeze(service)));

export const AEA_BUNDLES = Object.freeze([
  Object.freeze({ ...AEA_BUNDLE_IDENTITIES.electricalSafety,
    inclusions: [
      "2 smoke alarm checks, one each year",
      "2 blind safety checks, one each year",
      "1 electrical safety check",
      "Batteries and standard replacement smoke alarms included",
      "Basic cord anchors and safety labels included",
      "Between-visit smoke alarm and blind safety fault callouts",
      "Combined report for each completed visit",
      "Same-day email of each completed visit report",
      "Secure shareable report link and downloadable PDF"
    ],
    visits: ["Year 1: electrical, smoke alarm and blind safety", "Year 2: smoke alarm and blind safety"] }),
  Object.freeze({ ...AEA_BUNDLE_IDENTITIES.gasElectricalSafety,
    inclusions: [
      "2 smoke alarm checks, one each year",
      "2 blind safety checks, one each year",
      "1 electrical safety check",
      "1 gas safety check, no extra appliance charge",
      "Batteries and standard replacement smoke alarms included",
      "Basic cord anchors and safety labels included",
      "Between-visit smoke alarm and blind safety fault callouts",
      "Combined report for each completed visit",
      "Same-day email of each completed visit report",
      "Secure shareable report link and downloadable PDF"
    ],
    visits: ["Electrical visit: electrical, smoke alarm and blind safety", "Gas visit: gas, smoke alarm and blind safety"] }),
]);

export const AEA_BUNDLE_FAQS = Object.freeze([
  [
    "What does each two-year bundle include?",
    "Both bundles include two smoke alarm services and two blind safety checks, one of each per year, plus one electrical safety check. The gas and electrical bundle also includes one gas safety check, with no additional appliance charge. The annual smoke and blind services include batteries, standard replacement alarms, basic cord anchors and labels, and between-visit fault callouts."
  ],
  [
    "Is $225 or $350 the full two-year price?",
    "Those amounts are the annual equivalents excluding GST. The electrical bundle is $450 + GST for two years, or $495 including GST, equivalent to $225 + GST per year. The gas and electrical bundle is $700 + GST for two years, or $770 including GST, equivalent to $350 + GST per year. The annual equivalent explains the package price; it does not specify a payment schedule."
  ],
  [
    "Why choose a bundle?",
    "A bundle brings the required services into one coordinated enquiry with Australian Energy Assessments, with clear inclusions, due dates and reports for each completed visit. One point of contact helps you keep appointments, follow-up actions and the completed visit records organised across the two-year period."
  ],
  [
    "Which bundle suits an all-electric property?",
    "Choose the electrical, smoke and blind bundle when the property has no gas supply. If gas is supplied, the gas and electrical bundle adds the gas safety service without an appliance surcharge. Tell us about the property and previous reports so the appropriate scope can be confirmed."
  ],
  [
    "How are the visits scheduled?",
    "We use the existing smoke, electrical and gas check dates when coordinating appointments. Smoke and blind services take place annually; the electrical and gas checks follow their applicable two-year due dates. An electrical visit can include smoke and blinds, and a gas visit can include smoke and blinds. A check that is overdue or has no reliable record is not deferred simply to fit the second year."
  ],
  [
    "Will one person complete every check?",
    "Electrical work is completed by an appropriately licensed electrician and gas work by an appropriately qualified gasfitter with the required endorsement. Each can complete the smoke and blind service within their competence during the relevant visit. We coordinate the appointments around the required skills and due dates; the bundle does not replace those professional requirements."
  ],
  [
    "Will I receive one report or several separate documents?",
    "Each completed combined visit is presented in one report with the relevant professional records, emailed the same day with a secure shareable link and downloadable PDF. The findings retain each service's date, practitioner and result. Future visits receive their own dated record when performed; the first report does not certify work that has not happened yet."
  ],
  [
    "Are repairs and replacement items included?",
    "Both bundles include the annual smoke and blind service's batteries, standard like-for-like replacement alarms, basic cord anchors and labels, and fault callouts between annual visits. Gas and electrical repair parts, appliance replacements, new wiring, specialist alarm work and major blind repairs are scoped and authorised separately. Any required practitioner certificate accompanies the applicable completed work."
  ],
  [
    "What happens if a check finds a problem?",
    "The report clearly records the affected item, evidence, immediate safety action and further work needed. Included remedial work is documented, and separate repairs are explained before authorisation. A completed report can show a failed or limited finding; it is not presented as proof that every item passed."
  ],
  [
    "Is the rental minimum standards assessment included in a bundle?",
    "The $170 + GST rental minimum standards assessment is a separate service. The bundles cover the listed smoke, blind, electrical and, where selected, gas checks. You can add minimum standards or an energy assessment to the same enquiry so Australian Energy Assessments can coordinate the additional work."
  ]
].map((faq) => Object.freeze(faq)));

export function getAeaService(id) { return AEA_SERVICES.find((service) => service.id === id); }
export function gstInclusiveCents(priceExGstCents) { return Math.round(priceExGstCents * 11 / 10); }
export function audPrice(cents) { return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(cents / 100); }
