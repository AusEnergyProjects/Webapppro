import national from "./creditex-national-statutory-forms.json" with { type: "json" };
import type { CreditexCurrentWorkPackContentCandidate, CreditexCurrentWorkPackSource } from "./creditex-current-work-pack-content.ts";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid September battery source map");
  return value as Record<string, unknown>;
}
const text = (value: unknown) => typeof value === "string" ? value : "";
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function sourceFor(refs: unknown): CreditexCurrentWorkPackSource {
  const source = national.sources.find((source) => list(refs).includes(source.id) && source.sha256);
  if (!source) throw new Error("A retained official battery source is required");
  return { sourceKey: `september-2026:${source.id}`, sourceId: null, title: source.title,
    version: national.researchDate, officialUrl: source.url, expectedSha256: source.sha256,
    citation: source.title, custodyState: "pointer_not_in_governed_custody" };
}

/** New activities are explicit source candidates until exact policy, signatures,
 * product decisions and output mapping are bound by the master editor. */
export const CREDITEX_SEPTEMBER_BATTERY_WORK_PACK_CONTENT: readonly CreditexCurrentWorkPackContentCandidate[] =
  national.activities.filter((activity) => ["pdrs_bess3", "pdrs_bess4", "pdrs_bess5"].includes(activity.id)).map((value) => {
    const activity = record(value);
    const source = sourceFor(activity.sourceRefs);
    const groups = [...list(activity.sharedGroupRefs).map((key) => record(record(national.sharedGroups)[text(key)])), ...list(activity.groups).map(record)];
    const prompts = groups.flatMap((group) => list(group.fields).map((value) => {
      const field = record(value);
      return { key: `${text(group.id) || text(group.title)}:${text(field.id) || text(field.key)}`, label: text(field.prompt || field.label),
        category: text(group.title), inputSignal: text(field.type), unit: text(field.unit), requiredCandidate: field.required === true,
        approvalState: "candidate_not_approved" as const,
        guidance: [text(field.when), ...list(field.options).map(text)].filter(Boolean), source: group.sourceRefs ? sourceFor(group.sourceRefs) : source };
    }));
    const evidence = list(activity.evidence).map((value) => {
      const ref = record(value);
      return ref.sharedEvidenceRef ? record(record(national.sharedEvidence)[text(ref.sharedEvidenceRef)]) : ref;
    });
    const signatures = list(activity.signatures).map((value) => {
      const ref = record(value);
      return ref.sharedSignatureRef ? record(record(national.sharedSignatures)[text(ref.sharedSignatureRef)]) : ref;
    });
    return {
      schema: "creditex-current-work-pack-content/v1", sourceCatalogue: "NSW_CERTIFICATE", programCode: "NSW-PDRS",
      templateId: `nsw-pdrs-${text(activity.activityCode).toLowerCase()}`, activityCode: text(activity.activityCode), title: text(activity.title),
      catalogueState: "current", outcomeLabel: "Peak reduction certificates (PRCs)",
      identityBindings: [{ role: "accredited_certificate_provider", resolution: "Creditex verified PDRS activity accreditation" }],
      sources: [source], referenceDocuments: [source], prompts,
      evidenceRequirements: evidence.map((item, index) => ({ requirementId: text(item.id) || `evidence_${index}`, label: text(item.purpose || item.title),
        kind: text(item.type) || "document_or_original_media", requiredCandidate: true, captureState: "candidate_defined",
        preserveOriginalBytes: true, preserveOriginalMetadata: true, guidance: [text(item.when)],
        source: item.sourceRefs ? sourceFor(item.sourceRefs) : source })),
      productNeeds: [{ key: "battery", label: "Approved battery and inverter on installation date", requiredCandidate: true,
        decisionState: "candidate_not_approved", registryCodeSignal: "CEC", officialProductKindSignal: "battery",
        executableRegistryCode: "not_applicable", executableProductKind: "not_applicable", attributes: [], source }],
      scenarioNeed: { requiredCandidate: true, decisionState: "candidate_not_approved",
        codesOrSignals: list(activity.gates).map((value) => text(record(value).passCondition)), source },
      calculatorNeeds: [],
      signatureNeeds: signatures.map((item, index) => ({ signatureId: text(item.id) || `signature_${index}`,
        label: text(item.purpose), signerRole: text(item.signerRole), requiredCandidate: true,
        decisionState: "candidate_not_approved", source: item.sourceRefs ? sourceFor(item.sourceRefs) : source })),
      finalDocumentNeeds: [{ documentType: "creditex_activity_file_pack", label: "Creditex nomination, declarations and activity evidence report",
        format: "pdf", requiredCandidate: true, decisionState: "blocked_exact_provider_template_required", source }],
      blockers: [{ code: "SEPTEMBER_MASTER_COMPOSITION_REQUIRED", detail: "Bind the September source fields, conditional requirements, exact Creditex declarations, approvals and final PDF before making this activity executable." }],
      guidedCaptureState: "candidate_only", statutoryDocumentState: "candidate_only", providerSchemaState: "external_provider_schema_not_retained",
      draftCreationState: "not_available", candidateOnly: true, independentlyApproved: false, published: false, activationReady: false,
    };
  });
