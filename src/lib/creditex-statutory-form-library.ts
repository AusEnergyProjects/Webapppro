import { createHash } from "node:crypto";
import veu from "../data/creditex-veu-statutory-forms.json" with { type: "json" };
import national from "../data/creditex-national-statutory-forms.json" with { type: "json" };
import nationalDeclarations from "../data/creditex-national-declarations.json" with { type: "json" };
import provider from "../data/creditex-declaration-provider.json" with { type: "json" };
export { provider as creditexDeclarationProvider };

export type CreditexStatutorySourceForm = {
  id: string; title: string; program: string; activity: string; reviewedOn: string;
  sources: { title: string; url: string; sha256: string }[];
  groups: { title: string; timing: string; fields: { key: string; label: string; type: string; condition: string; options: string[] }[] }[];
  declarations: { key: string; title: string; signer: string; timing: string; text: string; sourceTextSha256: string; creditexTextSha256: string; condition?: string; sourceUrl?: string }[];
  authoringRequirements?: string[];
  signatureRequirements: string[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid statutory source record");
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** This is an authoring preview. Job values and actual signer identities are
 * intentionally unresolved here and must be bound before execution. */
export function nationalCreditexDeclarationPiece(value: unknown) {
  const piece = record(value);
  const original = text(piece.verbatimText); const template = text(piece.templateText);
  if (!original || !template || sha256(original) !== piece.verbatimTextSha256 || sha256(template) !== piece.templateTextSha256) {
    throw new Error("National declaration does not match its retained text hash");
  }
  const providerTokens: Record<string, string> = {
    "{{creditex.sres.legal_name}}": provider.legalName,
    "{{creditex.nsw.legal_name}}": provider.legalName,
    "{{creditex.nsw.abn}}": provider.abn,
    "{{creditex.nsw.abn_acn}}": provider.abn,
    "{{creditex.nsw.contact_email}}": provider.email,
    "{{creditex.nsw.contact_phone}}": provider.phone,
    "{{creditex.nsw.contact_phone_email}}": `${provider.phone} | ${provider.email}`,
  };
  let bound = template;
  for (const [token, binding] of Object.entries(providerTokens)) bound = bound.replaceAll(token, binding);
  return { text: bound, sourceTextSha256: text(piece.verbatimTextSha256), creditexTextSha256: sha256(bound),
    sourceUrl: nationalDeclarations.sources.find((source) => source.id === piece.sourceId)?.url || "" };
}

function nationalDeclarationContent(activity: Record<string, unknown>) {
  const aliases: Record<string, string> = { PV: "solar_pv", BESS: "solar_battery", SWH: "solar_water_heater", ASHP: "air_source_heat_pump" };
  const activityCode = text(activity.activityCode);
  const selected = nationalDeclarations.declarations.filter((value) => {
    const declaration = record(value);
    return list(declaration.programs).includes(activity.scheme)
      && (!declaration.activities || list(declaration.activities).includes(aliases[activityCode] || activityCode))
      && !list(declaration.activityExclusions).includes(activityCode);
  });
  const declarations: CreditexStatutorySourceForm["declarations"] = [];
  const authoringRequirements: string[] = [];
  for (const value of selected) {
    const declaration = record(value); const execution = record(declaration.execution);
    authoringRequirements.push(...list(declaration.layoutControls).map(text), ...list(declaration.gaps).map(text));
    for (const gap of list(declaration.branchGaps)) authoringRequirements.push(text(record(gap).reason));
    if (text(declaration.status).startsWith("blocked_")) {
      authoringRequirements.push(text(execution.timing));
      continue;
    }
    for (const sectionValue of list(declaration.sections)) {
      const section = record(sectionValue);
      const variants = section.variants ? list(section.variants).map(record) : [section];
      for (const [variantIndex, variant] of variants.entries()) for (const [pieceIndex, piece] of list(variant.pieces).entries()) {
        declarations.push({ key: `${text(declaration.id)}:${text(section.id)}:${variantIndex}:${pieceIndex}`,
          title: `${text(execution.purpose)} | ${text(section.id).replaceAll("_", " ")}`,
          signer: text(execution.signer), timing: text(execution.timing), condition: text(variant.when),
          ...nationalCreditexDeclarationPiece(piece) });
      }
    }
  }
  const ids = selected.map((declaration) => declaration.id);
  const fields = nationalDeclarations.fieldGroups.filter((value) => list(record(value).appliesTo).some((id) => ids.includes(text(id))));
  const groups = fields.map((value) => {
    const item = record(value);
    return { title: text(item.id).replaceAll("_", " "), timing: "Statutory document fields",
      fields: list(item.fields).map((value) => { const field = record(value); return {
        key: text(field.key), label: text(field.label), type: text(field.type) || "Source-labelled field",
        condition: text(field.displayWhen || field.requiredWhen), options: list(field.options).map(text),
      }; }) };
  });
  const sources = nationalDeclarations.sources.filter((source) => declarations.some((piece) => piece.sourceUrl === source.url))
    .map((source) => ({ title: `${source.id.replaceAll("_", " ")} | ${source.version}`, url: source.url, sha256: source.sha256 }));
  return { declarations, groups, authoringRequirements: [...new Set(authoringRequirements.filter(Boolean))], sources };
}

/** Only AP-name tokens explicitly authorised by the source may be substituted. */
export function creditexDeclarationText(declaration: {
  canonicalText: string; canonicalTextSha256: string; permittedPlaceholderBindings: Record<string, string>;
}) {
  if (sha256(declaration.canonicalText) !== declaration.canonicalTextSha256) {
    throw new Error("Statutory declaration does not match its retained text hash");
  }
  let bound = declaration.canonicalText;
  for (const [token, binding] of Object.entries(declaration.permittedPlaceholderBindings)) {
    if (binding !== "creditex.legalEntityName") throw new Error("Unsupported statutory provider binding");
    bound = bound.replaceAll(token, provider.legalName);
  }
  return { text: bound, sourceTextSha256: declaration.canonicalTextSha256, creditexTextSha256: sha256(bound) };
}

function group(value: unknown, nationalFormat = false): CreditexStatutorySourceForm["groups"][number] {
  const source = record(value);
  return {
    title: text(source.title), timing: text(source.workflowStage),
    fields: list(nationalFormat ? source.fields : source.prompts).map((value) => {
      const field = record(value);
      return { key: text(field.key || field.id), label: text(field.label || field.prompt),
        type: text(field.inputType || field.type), condition: text(field.requiredWhen || field.when),
        options: list(field.options).map((option) => typeof option === "string" ? option : text(record(option).label || record(option).value)) };
    }),
  };
}

export function creditexStatutorySourceLibrary(): CreditexStatutorySourceForm[] {
  const forms: CreditexStatutorySourceForm[] = veu.forms.map((form) => ({
    id: form.id, title: form.title.trim(), program: "VEU", activity: `Part ${form.activityPart} | ${form.premises}`,
    reviewedOn: veu.reviewedOn,
    sources: [{ title: form.versionText, url: form.officialUrl, sha256: form.sha256 }],
    groups: form.groups.map((item) => group(item)),
    declarations: form.declarations.map((declaration) => {
      const signature = form.signaturePurposes.find((item) => item.declarationKey === declaration.key);
      return { key: declaration.key, title: declaration.sectionReference, signer: signature?.signerRole || "",
        timing: signature?.captureStage || "", ...creditexDeclarationText(declaration) };
    }),
    signatureRequirements: form.signaturePurposes.map((signature) => `${signature.signerRole}: ${signature.key} (${signature.captureStage})`),
  }));
  const sharedGroups = record(national.sharedGroups);
  const sharedSignatures = record(national.sharedSignatures);
  for (const value of national.activities) {
    const activity = record(value);
    const statutory = nationalDeclarationContent(activity);
    forms.push({
      id: text(activity.id), title: text(activity.title), program: text(activity.scheme), activity: text(activity.activityCode),
      reviewedOn: national.researchDate,
      sources: [...national.sources.filter((source) => list(activity.sourceRefs).includes(source.id) && !statutory.sources.some((item) => item.url === source.url)).map((source) => ({
        title: source.title, url: source.url, sha256: source.sha256 || "",
      })), ...statutory.sources],
      groups: [...list(activity.sharedGroupRefs).map((key) => group(sharedGroups[text(key)], true)), ...list(activity.groups).map((item) => group(item, true)), ...statutory.groups],
      declarations: statutory.declarations,
      authoringRequirements: statutory.authoringRequirements,
      signatureRequirements: list(activity.signatures).map((value) => {
        const ref = record(value);
        const signature = ref.sharedSignatureRef ? record(sharedSignatures[text(ref.sharedSignatureRef)]) : ref;
        return [text(signature.signerRole), text(signature.purpose), text(signature.timing)].filter(Boolean).join(" | ");
      }),
    });
  }
  return forms;
}
