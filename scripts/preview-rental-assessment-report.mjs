import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { rentalAssessmentTemplateSnapshot } from "../src/lib/trade-rental-assessment.mjs";
import { createRentalAssessmentPdfBytes } from "../src/lib/trade-rental-report-pdf.mjs";

// Synthetic content only. Optional local photos demonstrate layout and are never added to source control.
const output = resolve(process.argv[2] || "output/pdf/rental-assessment-preview.pdf");
const photoPaths = process.argv.slice(3);
const template = rentalAssessmentTemplateSnapshot(["minimum_standards"]);
const moduleTemplate = template.modules.minimum_standards;
const sections = moduleTemplate.sections.map((section) => ({ ...section, items: section.checks.map((check) => ({
  ...check, id: check.key, outcome: "meets", locationLabel: section.title, response: {}, publicNotes: "Illustrative result for layout review only.",
})) }));
const items = sections.flatMap((section) => section.items);
const set = (key, values) => Object.assign(items.find((item) => item.key === key), values);
set("ceiling_2027_readiness", { outcome: "does_not_meet", locationLabel: "Rear bedroom ceiling", publicNotes: "A 24 m2 uninsulated area is identified for R5 insulation. Example scope and measurements only.", response: { measurement: "4 m x 6 m = 24 m2; room plan measurement. Hatch 550 x 600 mm.", limitationReason: "Electrical clearance must be confirmed before installation." } });
set("windows_2027_readiness", { outcome: "does_not_meet", locationLabel: "Living room and bedroom windows", response: { measurement: "Four windows; 18.4 linear metres of perimeter seals measured with tape." } });
set("outlet_lighting_protection", { outcome: "specialist_verification_required", locationLabel: "Hallway switchboard", publicNotes: "A licensed electrician must verify the protected circuits and record the results." });
const findings = [
  { id: "finding-insulation", itemId: "ceiling_2027_readiness", title: "Insulate the identified ceiling area", description: "Illustrative uninsulated section over the rear bedroom.", status: "recommendation", severity: "recommended", tradeCategory: "Insulation installer", locationLabel: "Rear bedroom ceiling", scopeSummary: "Install R5 insulation to the measured 24 m2 bare section after the required electrical check. Keep existing insulated areas unless separately agreed.", quantityMilli: 24000, unitLabel: "m2", details: { quotation: { measurements: "4.0 x 6.0 m = 24.0 m2, measured from the room plan. Hatch 550 x 600 mm.", specification: "R5 ceiling insulation to the identified bare area. Existing coverage retained; installer to select suitable compliant product.", access: "Single-storey dwelling; hallway hatch. Arrange tenant access. Obtain required electrical checklist and rectify issues before work.", exclusions: "Include material, labour, packaging removal and installation record. Electrical inspection and any rectification quoted separately." } } },
  { id: "finding-seals", itemId: "windows_2027_readiness", title: "Replace worn perimeter window seals", description: "Illustrative gaps around four opening window frames.", status: "recommendation", severity: "recommended", tradeCategory: "Carpenter", locationLabel: "Living room and bedroom windows", scopeSummary: "Supply and fit suitable perimeter seals without restricting operation; allow 18.4 metres across four identified windows.", quantityMilli: 18400, unitLabel: "metres", details: { quotation: { measurements: "Measured perimeter: living 5.2 + 5.2 m; bedrooms 4.0 + 4.0 m.", specification: "Replace the existing compressible perimeter seals in the four aluminium opening frames. Measured channel 4 mm; observed gap 3 mm. Match a compatible seal profile within these dimensions.", access: "Internal ground-floor access. Tenant appointment needed.", exclusions: "Include 18.4 m of perimeter seal, removal, disposal and an operation check for all four windows. Exclude frame repairs and glazing replacement." } } },
  { id: "finding-electrical", itemId: "outlet_lighting_protection", title: "Verify circuit protection", description: "Circuit protection has not been established by a licensed electrician.", status: "not_tested", severity: "required", tradeCategory: "Electrician", locationLabel: "Hallway switchboard", scopeSummary: "Arrange licensed verification of the required circuit protection. Quote any rectification after test results; no replacement board has been assumed.", quantityMilli: 1000, unitLabel: "switchboard", details: { quotation: { measurements: "One hallway switchboard, eight labelled final subcircuits. Board 450 x 600 mm; mounted 1.6 m above floor.", specification: "Test the identified RCD and circuit-breaker protection and issue a written test record. No replacement board is specified.", access: "Ground-floor hallway, clear working space. Include an isolation appointment coordinated with the property manager.", exclusions: "Include testing and written results for the listed board and circuits. Exclude board replacement and concealed wiring rectification; price those only against a separately defined scope." } } },
];
const evidence = [], assets = {};
for (const [index, path] of photoPaths.entries()) {
  const bytes = new Uint8Array(await readFile(path));
  const id = `photo-${index + 1}`;
  evidence.push({ id, itemId: "ceiling_2027_readiness", findingId: "finding-insulation", fileName: `illustrative-roof-photo-${index + 1}.jpg`, caption: `Illustrative roof photo ${index + 1} from the supplied reference; not evidence of this synthetic property.`, contentType: "image/jpeg", originalSha256: createHash("sha256").update(bytes).digest("hex") });
  assets[id] = { bytes, contentType: "image/jpeg" };
}
const snapshot = { schemaVersion: "tlink-rental-report-v1", preview: true,
  report: { number: "SAMPLE-RMS-001", issuedAt: "2026-09-09T02:00:00Z", revision: 1 },
  inspection: { title: template.title, assessmentDate: "2026-09-09", rulesEffectiveFrom: template.effectiveFrom, assessmentScope: template.assessmentScope, reportBoundary: moduleTemplate.reportBoundary, rentalRegime: "ordinary_residential" },
  property: { address: "12 Example Street, Melbourne VIC 3000", customerName: "Example Property Management" },
  business: { name: "Australian Energy Assessments | TLink", email: "Example contact supplied on issued reports" },
  issuer: { name: "Example Energy Assessor", role: "Energy assessor", declaration: "Sample layout only. No real property assessment or certification has been issued." },
  modules: [{ ...moduleTemplate, id: "module-1", key: "minimum_standards", required: true, title: moduleTemplate.title, completedAt: "2026-09-09T01:45:00Z", answers: { rentalRegime: "ordinary_residential", occupancyAtAssessment: "vacant", areasNotAccessed: "Illustrative limitations are shown in the individual work details." }, sections }], findings, evidence, sources: template.sources,
};
await mkdir(dirname(output), { recursive: true });
const fonts = { regular: new Uint8Array(await readFile(new URL("../public/fonts/LiberationSans-Regular.ttf", import.meta.url))), bold: new Uint8Array(await readFile(new URL("../public/fonts/LiberationSans-Bold.ttf", import.meta.url))) };
const brand = new Uint8Array(await readFile(new URL("../public/tlink-icon-192.png", import.meta.url)));
await writeFile(output, await createRentalAssessmentPdfBytes(snapshot, assets, fonts, brand));
console.log(output);
