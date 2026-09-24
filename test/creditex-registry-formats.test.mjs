import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  listRegistryFormats,
  serializeRegistryRows,
  validateRegistryRows,
} from "../src/lib/creditex-registry-formats.ts";
import { analyseCreditexCsv } from "../src/lib/creditex-interchange-preflight.ts";

const formats = listRegistryFormats();
const find = (key) => formats.find((format) => format.key === key);
const pick = (key, data) => Object.fromEntries(Object.entries(data).filter(([field]) => find(key).headers.includes(field)));

function recFixture(key) {
  const row = {
    "Reference": "claim-0001", "Installation date": "01/09/2026",
    "System Brand": "Example brand", "System model": "Example model", "Tank serial numbers (s)": "TANK1",
    "System/panel brand": "Example brand", "System/panel model": "Example model",
    "Installation type": "Replaced electric heater", "Installation Type": "New system",
    "Is the volumetric capacity of this installation greater than 700L": "No",
    "Is your water heater second hand?": "No", "Creating certificates for previously failed SWH": "No",
    "Is there more than one SWH/ASHP at this address?": "No", "Number of panels": key === "rec_swh" ? "0" : "2",
    "Installation property type": "Residential", "Single or multi-story": "Single story", "Installation single or multi story": "Single story",
    "Installation street number": "10", "Installation street name": "Test", "Installation street type": "ST",
    "Installation town/suburb": "Sydney", "Installation state": "NSW", "Installation postcode": "2000",
    "Owner type": "Corporate body", "Owner organisation name": "Example Pty Ltd", "Owner country": "Australia",
    "Type of system": key === "rec_battery" ? "S.G.U. - solar battery (deemed)" : "S.G.U. – Solar (deemed)",
    "Was a solar retailer involved in the procurement and installation of the system?": "No",
    "Was a solar battery retailer involved in the procurement and installation of the system?": "No",
    "Type of connection to the electricity grid": "Connected to an electricity grid",
    "System mounting type": "Building or structure",
    "Are you installing a complete unit (adding capacity to an existing system is not considered a complete unit)?": "Yes",
    "For what period would you like to create RECs": "Five years",
    "What is the rated power output (in kW) of your small generation unit": "0.800",
    "Number of inverters": "1", "Inverter serial number(s)": "INV1",
    "Equipment model serial number(s)": "PV1;PV2",
    "Inverter manufacturer": "Example", "Inverter series": "Series", "Inverter model number": "Model",
    "Are you creating certificates for a system that has previously been failed by the Clean Energy Regulator?": "No",
    "Is there more than one SGU at this address?": "No",
    "CEC accredited installer number": "SAA0001", "CEC accredited designer number": "SAA0002",
    "Licensed electrician number": "123456",
    "Is there an existing solar PV installation at this address?": "Yes",
    "Is the solar battery system part of, or capable of being part of, a Virtual Power Plant (VPP)?": "Yes",
    "Is the system retrospectively connected to an existing solar PV system or commissioned at the same time as a new solar PV system?": "Connected to existing PV",
    "Has the installer changed default manufacturer setting of the solar battery storage system?": "No",
    "Are you adding battery capacity to an existing battery stack?": "No",
    "Solar battery manufacturer": "Example", "Solar battery brand": "Example", "Solar battery series": "Series", "Solar battery model": "Model",
    "Number of solar batteries": "2", "Solar battery serial number(s)": "BAT1;BAT2", "Location of solar battery": "Outdoor",
    "Are inverters being added as part of the solar battery system?": "Yes",
    "What is the nominal power output (kWh) of your solar battery system?": "10.0",
    "What is the usable power output (kWh) of your solar battery system?": "9.6",
    "Are you creating certificates for a solar battery system that has previously been failed by the Clean Energy Regulator?": "No",
    "Solar battery installer accreditation number": "SAA0001", "Solar battery designer accreditation number": "SAA0002",
  };
  for (const prefix of ["Owner", "Installer", "Electrician", "Designer"]) {
    Object.assign(row, {
      [`${prefix} first name`]: "Alex", [`${prefix} surname`]: "Example", [`${prefix} phone`]: "0412345678",
      [`${prefix} email`]: "example@example.test", [`${prefix} address type`]: "Physical", [`${prefix} street number`]: "10",
      [`${prefix} street name`]: "Test", [`${prefix} street type`]: "ST", [`${prefix} town/suburb`]: "Sydney", [`${prefix} state`]: "NSW", [`${prefix} postcode`]: "2000",
    });
  }
  for (const field of find(key).fields) if (/statement/i.test(field.name) || field.name === "Electrical safety documentation" || field.name === "Local, State and Territory government requirements" || /retailer conflicts of interest/i.test(field.name)) row[field.name] = "Yes";
  return pick(key, row);
}

function nswFixture(key) {
  return pick(key, {
    "ACP Implementation Identifier": "CLAIM-001", "Implementation Date": "01/08/2026",
    "Address Line 2 ( Street No , Street Name )": "10 TEST ST", "Suburb": "SYDNEY", "State": "NSW", "Postcode": "2000",
    "End-User Business Classification": "Residential", "End-Use Service": "Air heating and cooling", "Purchase Cost (Excluding GST)": "500.00",
    "ESS Activity Definition": "D16", "Calculation Method": "Deemed Energy Savings Method - Home Energy Efficiency Retrofits",
    "Number of units installed": "1", "Product Brand": "Example", "Product Model Number": "Model", "Refrigerant": "R32", "New or Replacement": "New",
    "Electricity Savings (MWh)": "10.00", "Regional Network Factor": "1", "Version of the Rule": "01/07/2026",
    "Company or individual responsible for work at site": "Example Pty Ltd", "Electrician licence": "123456", "Multi split system": "No",
    "PDRS Activity Definition": "HVAC1", "PDRS Calculation Method": "Peak Demand Savings Capacity - Reducing Demand Using Efficiency Activity",
    "Peak demand reduction capacity (kW)": "2.00", "Network Factor": "1.04", "Version of The Rule": "01/07/2026", "National Metering Identifier (NMI)": "43100629836",
  });
}
const fixture = (key) => key.startsWith("nsw_") ? nswFixture(key) : recFixture(key);

test("all five official formats serialize in exact retained order with review boundaries", () => {
  assert.deepEqual(formats.map(({ key, headers }) => [key, headers.length]), [["rec_sgu", 146], ["rec_swh", 65], ["rec_battery", 140], ["nsw_esc", 51], ["nsw_prc", 44]]);
  for (const format of formats) {
    const result = serializeRegistryRows(format.key, [fixture(format.key)]);
    assert.equal(result.valid, true, `${format.key}: ${JSON.stringify(result.issues)}`);
    assert.equal(result.complianceEligibilityAssessed, false);
    assert.equal(format.externalSubmissionEnabled, false);
    assert.equal(format.certificateQuantityField, null);
    assert.deepEqual(analyseCreditexCsv(result.csv).rows[0], format.headers);
    assert.match(result.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.equal(result.csv.endsWith("\r\n"), true);
    assert.equal(serializeRegistryRows(format.key, [fixture(format.key)]).csv, result.csv);
  }
  assert.equal(find("rec_sgu").headers[145], "Installation Type Additional Information");
  assert.equal(find("rec_battery").headers[139], "Documents zip file");
  assert.equal(find("rec_swh").headers[2], "Tank serial numbers (s)");
  assert.equal(find("nsw_esc").headers[31], "Version of the Rule");
  assert.equal(find("nsw_prc").headers[23], "Version of The Rule");
});

test("source byte hashes match every declared dictionary and template", () => {
  for (const format of formats) for (const source of format.sources) {
    const bytes = readFileSync(new URL(`../docs/compliance/registry-contracts/${source.file}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, source.file);
    assert.match(source.url, /^https:\/\/(cer\.gov\.au|www\.energysustainabilityschemes\.nsw\.gov\.au)\//);
  }
  assert.equal(Object.isFrozen(formats), true);
  assert.equal(Object.isFrozen(find("nsw_esc").headers), true);
});

test("CSV quotes preserve commas, quotes and newlines without changing submitted values", () => {
  const row = fixture("rec_swh");
  row.Reference = 'batch, "quoted"\nline two';
  const result = serializeRegistryRows("rec_swh", [row]);
  assert.equal(result.valid, true);
  assert.equal(analyseCreditexCsv(result.csv).rows[1][find("rec_swh").headers.indexOf("Reference")], row.Reference);
});

test("unknown and non-string fields, impossible dates, missing fields and controls block all output", () => {
  const cases = [
    [{ unexpected: "value" }, "UNKNOWN_FIELD"],
    [{ "Installation date": "31/02/2026" }, "DATE_FORMAT"],
    [{ "Installation date": "" }, "REQUIRED_FIELD"],
    [{ "Owner phone": 412345678 }, "VALUE_TYPE"],
    [{ Reference: "bad\u0000value" }, "INVALID_CHARACTER"],
  ];
  for (const [change, code] of cases) {
    const result = serializeRegistryRows("rec_swh", [{ ...fixture("rec_swh"), ...change }]);
    assert.equal(result.valid, false);
    assert.equal(result.csv, null);
    assert.equal(result.sha256, null);
    assert.ok(result.issues.some((issue) => issue.code === code), code);
  }
  assert.equal(validateRegistryRows("rec_swh", []).valid, false);
});

test("REC exact record ceiling and NSW ceiling reject entire batches", () => {
  const recRows = Array.from({ length: 250 }, () => fixture("rec_swh"));
  assert.equal(validateRegistryRows("rec_swh", recRows).valid, true);
  assert.ok(validateRegistryRows("rec_swh", [...recRows, fixture("rec_swh")]).issues.some((issue) => issue.code === "MAXIMUM_RECORDS"));
  const nswRows = Array.from({ length: 3000 }, (_, index) => ({ ...fixture("nsw_prc"), "ACP Implementation Identifier": `CLAIM-${index}` }));
  assert.equal(validateRegistryRows("nsw_prc", nswRows).valid, true);
  assert.ok(serializeRegistryRows("nsw_prc", [...nswRows, fixture("nsw_prc")]).issues.some((issue) => issue.code === "MAXIMUM_RECORDS"));
});

test("NSW identity, vintage, numeric precision and conditionals are checked", () => {
  const row = fixture("nsw_esc");
  assert.ok(validateRegistryRows("nsw_esc", [row, row]).issues.some((issue) => issue.code === "DUPLICATE_IMPLEMENTATION"));
  assert.ok(validateRegistryRows("nsw_esc", [row, { ...row, "ACP Implementation Identifier": "SECOND", "Implementation Date": "01/08/2025" }]).issues.some((issue) => issue.code === "MIXED_VINTAGE"));
  assert.ok(validateRegistryRows("nsw_esc", [{ ...row, "Electricity Savings (MWh)": "10.123" }]).issues.some((issue) => issue.code === "DECIMAL_PLACES"));
  assert.ok(validateRegistryRows("nsw_esc", [{ ...row, "Electrician licence": "" }]).issues.some((issue) => issue.code === "CONDITIONAL_FIELD"));
  assert.ok(validateRegistryRows("nsw_esc", [{ ...row, "End-User Business Classification": "C Manufacturing" }]).issues.some((issue) => issue.field === "End User ABN"));
  assert.ok(validateRegistryRows("nsw_esc", [{ ...row, State: "VIC" }]).issues.some((issue) => issue.code === "REFERENCE_VALUE"));
});

test("battery owner email, quantities, serial identities, retailers and inverter answers are enforced", () => {
  const row = fixture("rec_battery");
  for (const [change, field] of [
    [{ "Owner email": "" }, "Owner email"],
    [{ "Solar battery serial number(s)": "BAT1;BAT1" }, "Solar battery serial number(s)"],
    [{ "Number of solar batteries": "3" }, "Solar battery serial number(s)"],
    [{ "Inverter model number": "" }, "Inverter model number"],
    [{ "Was a solar battery retailer involved in the procurement and installation of the system?": "Yes" }, "Retailer name"],
    [{ "What is the nominal power output (kWh) of your solar battery system?": "101" }, "What is the nominal power output (kWh) of your solar battery system?"],
  ]) assert.ok(validateRegistryRows("rec_battery", [{ ...row, ...change }]).issues.some((issue) => issue.field === field), field);
});

test("SWH greater-than-700L and re-created claims cannot omit their declarations", () => {
  const row = fixture("rec_swh");
  assert.ok(validateRegistryRows("rec_swh", [{ ...row, "Is the volumetric capacity of this installation greater than 700L": "Yes" }]).issues.some((issue) => issue.code === "DECLARATION_REQUIRED"));
  assert.ok(validateRegistryRows("rec_swh", [{ ...row, "Creating certificates for previously failed SWH": "Yes" }]).issues.some((issue) => issue.field === "Failed accreditation code"));
});

test("unresolved contradictory operating-period rules fail closed", () => {
  const row = { ...fixture("nsw_esc"), "Calculation Method": "Project Impact Assessment with Measurement and Verification Method", "Measurement Date": "01/09/2026", "Operating measuring period start date": "01/08/2026", "Operating measuring period end date": "01/09/2026" };
  const result = serializeRegistryRows("nsw_esc", [row]);
  assert.equal(result.csv, null);
  assert.ok(result.issues.some((issue) => issue.code === "SOURCE_CONTRACT_CONFLICT"));
});

test("non-finite decimal text cannot bypass the numeric field boundary", () => {
  const row = { ...fixture("nsw_esc"), "Electricity Savings (MWh)": `${"9".repeat(400)}.00` };
  const result = serializeRegistryRows("nsw_esc", [row]);
  assert.equal(result.csv, null);
  assert.ok(result.issues.some((issue) => issue.code === "NUMBER_FORMAT"));
});
