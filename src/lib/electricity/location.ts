export type ElectricityCustomerType = "RESIDENTIAL" | "BUSINESS";

export interface DistributorInfo {
  state: string;
  region: string;
  website: string;
  meterDataUrl: string | null;
  meterDataInstructions: string;
}

type NmiAllocation = { matches: (core: string) => boolean; distributor: string };

const LEGACY_NMI_CHARACTER = "[A-HJ-NP-Z0-9]";
const LEGACY_NMI_FIRST_SUFFIX_CHARACTER = "[A-HJ-NP-VX-Z0-9]";

function legacyAllocation(prefix: string, core: string, minimumSuffix = "000000") {
  if (!core.startsWith(prefix)) return false;
  const suffix = core.slice(prefix.length);
  if (!new RegExp(`^${LEGACY_NMI_FIRST_SUFFIX_CHARACTER}${LEGACY_NMI_CHARACTER}{5}$`).test(suffix)) return false;
  return suffix >= minimumSuffix;
}

function energexLegacyAllocation(core: string) {
  return new RegExp(`^QB\\d{2}${LEGACY_NMI_FIRST_SUFFIX_CHARACTER}${LEGACY_NMI_CHARACTER}{5}$`).test(core);
}

function tasNetworksLegacyAllocation(core: string) {
  if (!/^T\d{9}$/.test(core)) return false;
  const allocationNumber = Number(core.slice(1));
  return allocationNumber >= 1 && allocationNumber <= 5_001;
}

const NMI_ALLOCATIONS: NmiAllocation[] = [
  { matches: (core) => legacyAllocation("NGGG", core) || /^7001\d{6}$/.test(core), distributor: "Evoenergy" },
  { matches: (core) => ["NAAA", "NBBB", "NDDD", "NFFF"].some((prefix) => legacyAllocation(prefix, core)) || /^(?:4001|4508|4204|4407)\d{6}$/.test(core), distributor: "Essential Energy" },
  { matches: (core) => legacyAllocation("NCCC", core) || /^410[234]\d{6}$/.test(core), distributor: "Ausgrid" },
  { matches: (core) => legacyAllocation("NEEE", core) || /^431\d{7}$/.test(core), distributor: "Endeavour Energy" },
  { matches: (core) => ["QAAA", "QCCC", "QDDD", "QEEE", "QFFF", "QGGG"].some((prefix) => legacyAllocation(prefix, core)) || /^30\d{8}$/.test(core), distributor: "Ergon Energy" },
  { matches: (core) => energexLegacyAllocation(core) || /^31\d{8}$/.test(core), distributor: "Energex" },
  { matches: (core) => legacyAllocation("SAAA", core) || /^200[12]\d{6}$/.test(core), distributor: "SA Power Networks" },
  { matches: (core) => tasNetworksLegacyAllocation(core) || /^8000\d{6}$/.test(core) || /^8590[23]\d{5}$/.test(core), distributor: "TasNetworks" },
  { matches: (core) => legacyAllocation("VAAA", core) || /^610[23]\d{6}$/.test(core), distributor: "CitiPower" },
  { matches: (core) => legacyAllocation("VBBB", core) || /^630[56]\d{6}$/.test(core), distributor: "AusNet Services" },
  { matches: (core) => legacyAllocation("VCCC", core) || /^620[34]\d{6}$/.test(core), distributor: "Powercor" },
  { matches: (core) => legacyAllocation("VDDD", core) || /^6001\d{6}$/.test(core), distributor: "Jemena" },
  { matches: (core) => legacyAllocation("VEEE", core, "000001") || /^640[78]\d{6}$/.test(core), distributor: "United Energy" },
];

export const DISTRIBUTOR_INFO: Record<string, DistributorInfo> = {
  Ausgrid: { state: "NSW", region: "NSW1", website: "https://www.ausgrid.com.au/", meterDataUrl: "https://www.ausgrid.com.au/your-energy-use/your-meter-and-supply/access-your-meter-data", meterDataInstructions: "Use the online meter-data request form. Up to two years can be emailed to you." },
  "Endeavour Energy": { state: "NSW", region: "NSW1", website: "https://www.endeavourenergy.com.au/", meterDataUrl: "https://www.endeavourenergy.com.au/for-your-home/energy-use-and-bills/your-meter", meterDataInstructions: "Request your meter data online. Up to two years can be emailed to you." },
  "Essential Energy": { state: "NSW", region: "NSW1", website: "https://www.essentialenergy.com.au/", meterDataUrl: "https://www.essentialenergy.com.au/web-forms/retail-customer-single-nmi-request", meterDataInstructions: "Use the single-NMI meter-data request form." },
  Evoenergy: { state: "ACT", region: "NSW1", website: "https://www.evoenergy.com.au/", meterDataUrl: "https://www.evoenergy.com.au/Your-Energy/Electricity-Meters/Request-meter-data", meterDataInstructions: "Request meter data online. Evoenergy advises it may take up to 10 business days." },
  Energex: { state: "QLD", region: "QLD1", website: "https://www.energex.com.au/", meterDataUrl: "https://www.energex.com.au/our-services/metering/accessing-your-metering-data", meterDataInstructions: "Use the online metering-data application and request interval data as a CSV." },
  "Ergon Energy": { state: "QLD", region: "QLD1", website: "https://www.ergon.com.au/network/", meterDataUrl: "https://www.ergon.com.au/network/our-services/metering/accessing-your-metering-data", meterDataInstructions: "Use the online metering-data application and request interval data as a CSV." },
  "SA Power Networks": { state: "SA", region: "SA1", website: "https://www.sapowernetworks.com.au/", meterDataUrl: "https://customer.portal.sapowernetworks.com.au/meterdata/", meterDataInstructions: "Register for the Your Meter Data portal, then download the detailed NEM12 CSV." },
  TasNetworks: { state: "TAS", region: "TAS1", website: "https://www.tasnetworks.com.au/", meterDataUrl: null, meterDataInstructions: "Ask your retailer for your detailed interval data in NEM12 format." },
  CitiPower: { state: "VIC", region: "VIC1", website: "https://www.citipower.com.au/", meterDataUrl: "https://www.powercor.com.au/for-your-home/manage-power-costs/myenergy/", meterDataInstructions: "Open the CitiPower and Powercor myEnergy page, register with the NMI from your bill, then download the detailed CSV report." },
  Powercor: { state: "VIC", region: "VIC1", website: "https://www.powercor.com.au/", meterDataUrl: "https://www.powercor.com.au/for-your-home/manage-power-costs/myenergy/", meterDataInstructions: "Open myEnergy, register with the NMI from your bill, then download the detailed CSV report." },
  Jemena: { state: "VIC", region: "VIC1", website: "https://www.jemena.com.au/", meterDataUrl: "https://www.jemena.com.au/electricity/existing-connections/usage-and-costs/", meterDataInstructions: "Open Jemena's usage and costs page, follow the My Portal login link, then download your meter data as a CSV." },
  "United Energy": { state: "VIC", region: "VIC1", website: "https://www.unitedenergy.com.au/", meterDataUrl: "https://www.unitedenergy.com.au/help-support/online-services", meterDataInstructions: "Open United Energy online services, then use the myEnergy usage portal with the NMI and meter serial number from your bill to download the detailed metering-data report." },
  "AusNet Services": { state: "VIC", region: "VIC1", website: "https://www.ausnetservices.com.au/", meterDataUrl: "https://www.ausnetservices.com.au/electricity/your-electricity-meter/meter-data", meterDataInstructions: "View data in MyHomeEnergy or submit a meter-data request." },
};

export function cleanNmi(value: string): string {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function nmiCheckDigit(value: string): string | null {
  const core = cleanNmi(value);
  if (!/^[A-HJ-NP-Z0-9]{10}$/.test(core)) return null;
  const total = [...core].reverse().reduce((sum, character, index) => {
    const weighted = character.charCodeAt(0) * (index % 2 === 0 ? 2 : 1);
    return sum + [...String(weighted)].reduce((digitSum, digit) => digitSum + Number(digit), 0);
  }, 0);
  return String((10 - (total % 10)) % 10);
}

export function hasValidNmiCheckDigit(value: string): boolean {
  const nmi = cleanNmi(value);
  return /^\d$/.test(nmi.slice(10)) && nmiCheckDigit(nmi.slice(0, 10)) === nmi.slice(10);
}

export function distributorFromNmi(value: string): string | null {
  const nmi = cleanNmi(value);
  if (nmi.length < 10 || nmi.length > 11) return null;
  if (nmi.length === 11 && !hasValidNmiCheckDigit(nmi)) return null;
  const core = nmi.slice(0, 10);
  for (const allocation of NMI_ALLOCATIONS) {
    if (allocation.matches(core)) return allocation.distributor;
  }
  return null;
}

export function maskNmi(value: string): string {
  const nmi = cleanNmi(value);
  if (nmi.length < 6) return nmi;
  return `${nmi.slice(0, 3)}${"•".repeat(Math.max(3, nmi.length - 6))}${nmi.slice(-3)}`;
}
