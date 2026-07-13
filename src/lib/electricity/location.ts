export type ElectricityCustomerType = "RESIDENTIAL" | "BUSINESS";

export interface DistributorInfo {
  state: string;
  region: string;
  website: string;
  meterDataUrl: string | null;
  meterDataInstructions: string;
}

const NMI_ALLOCATIONS: Array<{ patterns: RegExp[]; distributor: string }> = [
  { patterns: [/^NGGG/i, /^7001\d{6}$/], distributor: "Evoenergy" },
  { patterns: [/^NAAA/i, /^NBBB/i, /^NDDD/i, /^NFFF/i, /^4001\d{6}$/, /^4508\d{6}$/, /^4204\d{6}$/, /^4407\d{6}$/], distributor: "Essential Energy" },
  { patterns: [/^NCCC/i, /^410[234]\d{6}$/], distributor: "Ausgrid" },
  { patterns: [/^NEEE/i, /^431\d{7}$/], distributor: "Endeavour Energy" },
  { patterns: [/^QAAA/i, /^QCCC/i, /^QDDD/i, /^QEEE/i, /^QFFF/i, /^QGGG/i, /^30\d{8}$/], distributor: "Ergon Energy" },
  { patterns: [/^QB\d{2}/i, /^31\d{8}$/], distributor: "Energex" },
  { patterns: [/^SAAA/i, /^SASMPL\d{4}$/i, /^200[12]\d{6}$/], distributor: "SA Power Networks" },
  { patterns: [/^T000000/i, /^8000\d{6}$/, /^8590[23]\d{5}$/], distributor: "TasNetworks" },
  { patterns: [/^VAAA/i, /^610[23]\d{6}$/], distributor: "CitiPower" },
  { patterns: [/^VBBB/i, /^630[56]\d{6}$/], distributor: "AusNet Services" },
  { patterns: [/^VCCC/i, /^620[34]\d{6}$/], distributor: "Powercor" },
  { patterns: [/^VDDD/i, /^6001\d{6}$/], distributor: "Jemena" },
  { patterns: [/^VEEE/i, /^640[78]\d{6}$/], distributor: "United Energy" },
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

export function distributorFromNmi(value: string): string | null {
  const nmi = cleanNmi(value);
  if (nmi.length < 10 || nmi.length > 11) return null;
  const core = nmi.slice(0, 10);
  for (const allocation of NMI_ALLOCATIONS) {
    if (allocation.patterns.some((pattern) => pattern.test(core))) return allocation.distributor;
  }
  return null;
}

export function maskNmi(value: string): string {
  const nmi = cleanNmi(value);
  if (nmi.length < 6) return nmi;
  return `${nmi.slice(0, 3)}${"•".repeat(Math.max(3, nmi.length - 6))}${nmi.slice(-3)}`;
}
