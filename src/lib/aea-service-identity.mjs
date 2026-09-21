// Shared service identity for enquiry choices, routing and public search.
// Detailed inclusions, FAQs and legal sources belong to the server page catalogue.
export const AEA_SERVICE_IDENTITIES = Object.freeze({
  smokeAlarmBlindSafety: Object.freeze({
    "id": "smoke-alarm-blind-safety",
    "name": "Smoke alarm + blind safety",
    "priceExGstCents": 10000,
    "path": "/services/smoke-alarm-blind-safety",
    "category": "Rental safety",
    "area": "Victoria",
    "summary": "Annual smoke alarm and blind cord safety, including batteries, standard replacement alarms, cord anchors and labels, plus fault callouts between annual visits."
  }),
  gasSafety: Object.freeze({
    "id": "gas-safety-check",
    "name": "Gas safety check",
    "priceExGstCents": 25000,
    "path": "/services/gas-safety-check",
    "category": "Rental safety",
    "area": "Victoria",
    "summary": "A qualified gasfitter checks and services the property's in-scope gas appliances at one fixed price, with no extra appliance charge and clear written findings."
  }),
  electricalSafety: Object.freeze({
    "id": "electrical-safety-check",
    "name": "Electrical safety check",
    "priceExGstCents": 25000,
    "path": "/services/electrical-safety-check",
    "category": "Rental safety",
    "area": "Victoria",
    "summary": "A licensed electrician inspects and tests the property's electrical installation, with clear results, defect evidence and a completed report sent by email."
  }),
  minimumRentalStandards: Object.freeze({
    "id": "minimum-rental-standards",
    "name": "Rental minimum standards",
    "priceExGstCents": 17000,
    "path": "/minimum-rental-standards",
    "category": "Rental safety",
    "area": "Victoria",
    "summary": "An onsite assessment of Victoria's rental minimum standards, with clear findings, photos and a practical record of what needs attention."
  }),
  nathersNew: Object.freeze({
    "id": "nathers-new",
    "name": "NatHERS for new homes",
    "priceExGstCents": 30000,
    "path": "/nathers-for-new-homes",
    "category": "Energy assessments",
    "area": "Australia",
    "summary": "A plan-based energy assessment for a new home, delivered through the applicable NatHERS pathway by an accredited assessor."
  }),
  nathersExisting: Object.freeze({
    "id": "nathers-existing",
    "name": "Home Energy Rating for existing homes",
    "priceExGstCents": 30000,
    "path": "/home-energy-rating-for-existing-homes",
    "category": "Energy assessments",
    "area": "NSW and Victoria",
    "summary": "An accredited existing-home energy assessment to understand energy performance, comfort and practical improvement opportunities."
  }),
  onsiteEnergyAssessment: Object.freeze({
    "id": "onsite-energy-assessment",
    "name": "Onsite energy assessment",
    "priceExGstCents": 18000,
    "path": "/services/onsite-energy-assessment",
    "category": "Energy assessments",
    "area": "NSW and Victoria",
    "summary": "Practical onsite advice about your home's energy use, comfort and upgrade priorities, without a formal rating certificate."
  }),
});

export const AEA_BUNDLE_IDENTITIES = Object.freeze({
  electricalSafety: Object.freeze({
    "id": "rental-electrical-bundle",
    "name": "Electrical, smoke + blind bundle",
    "priceExGstCents": 45000,
    "durationMonths": 24,
    "gas": false
  }),
  gasElectricalSafety: Object.freeze({
    "id": "rental-gas-electrical-bundle",
    "name": "Gas + electrical safety bundle",
    "priceExGstCents": 70000,
    "durationMonths": 24,
    "gas": true
  }),
});

export const AEA_RESERVED_SERVICE_IDS = Object.freeze(["assessment", "rental-inspection", "blower-door-testing", "thermal-imaging", ...Object.values(AEA_SERVICE_IDENTITIES).map(({ id }) => id), ...Object.values(AEA_BUNDLE_IDENTITIES).map(({ id }) => id)]);
const reservedServiceIds = new Set(AEA_RESERVED_SERVICE_IDS);
export function isAeaReservedService(value) { return reservedServiceIds.has(value); }
// A mixed enquiry stays with Australian Energy Assessments so its complete scope remains private.
export function requiresAeaDelivery(services) { return Array.isArray(services) && services.some(isAeaReservedService); }
