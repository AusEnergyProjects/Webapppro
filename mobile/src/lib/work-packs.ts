import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import type {
  FieldActivityWorkPack,
  FieldActivityWorkPackResponse,
  FieldActivityWorkPackSchema,
  FieldWorkPackCompletion,
  FieldWorkPackCondition,
  FieldWorkPackDependencyResolution,
  FieldWorkPackFinalRecord,
  FieldWorkPackPrompt,
  FieldWorkPackReferenceDocumentAcknowledgement,
  FieldWorkPackReferenceDocumentProjection,
  FieldWorkPackSection,
  FieldWorkPackSignatureDraft,
  FieldWorkPackSignaturePayload,
  FieldWorkPackSignerRole,
  FieldWorkPackSectionPatch,
  FieldWorkPackVisibility,
} from '@/lib/types';

export const FIELD_WORK_PACK_RESPONSE_CONTRACT = 'creditex-activity-work-pack-response/v1';
export const FIELD_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT =
  'creditex-activity-work-pack-signature-payload/v1';
export const FIELD_WORK_PACK_SIGNER_IDENTITY_CONTRACT =
  'creditex-activity-work-pack-signer-identity/v1';
export const FIELD_WORK_PACK_SIGNATURE_ATTESTATION_CONTRACT =
  'creditex-activity-work-pack-signature-attestation/v1';
export const FIELD_WORK_PACK_DEVICE_ATTESTATION_CONTRACT =
  'creditex-activity-work-pack-device-attestation/v1';
export const FIELD_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT =
  'creditex-activity-work-pack-reference-document-acknowledgement/v1';

const GOVERNED_REFERENCE_DOCUMENT_DIRECTORY = new Directory(
  Paths.document,
  'governed-reference-documents',
);

export type { FieldWorkPackSectionPatch } from '@/lib/types';

export function createFieldWorkPackReferenceDocumentAcknowledgement(
  document: FieldWorkPackReferenceDocumentProjection,
  acknowledgedAt: string,
): FieldWorkPackReferenceDocumentAcknowledgement {
  const sourceArtifactSha256 = document.sourceArtifactSha256
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, '');
  if (
    (document.acknowledgementMode !== 'viewed'
      && document.acknowledgementMode !== 'confirmed')
    || !document.sourceBindingTargetKey
    || !document.sourceArtifactId
    || !/^[0-9a-f]{64}$/.test(sourceArtifactSha256)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(acknowledgedAt)
    || !Number.isFinite(Date.parse(acknowledgedAt))
  ) {
    throw new Error('The approved document acknowledgement is invalid. Sync and try again.');
  }
  return {
    contract: FIELD_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT,
    sourceBindingTargetKey: document.sourceBindingTargetKey,
    sourceArtifactId: document.sourceArtifactId,
    sourceArtifactSha256,
    acknowledgementMode: document.acknowledgementMode,
    acknowledged: true,
    acknowledgedAt,
  };
}

export function fieldWorkPackReferenceDocumentCacheFile(
  document: FieldWorkPackReferenceDocumentProjection,
) {
  const artifactId = document.sourceArtifactId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
  const sha256 = document.sourceArtifactSha256
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, '');
  const extension = /\.([a-zA-Z0-9]{1,8})$/.exec(document.originalFileName)?.[1]
    ?.toLowerCase() || (document.contentType === 'application/pdf' ? 'pdf' : 'bin');
  if (!artifactId || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error('The approved document cache identity is invalid. Sync and try again.');
  }
  if (!GOVERNED_REFERENCE_DOCUMENT_DIRECTORY.exists) {
    GOVERNED_REFERENCE_DOCUMENT_DIRECTORY.create({ intermediates: true, idempotent: true });
  }
  return new File(
    GOVERNED_REFERENCE_DOCUMENT_DIRECTORY,
    `${artifactId}-${sha256}.${extension}`,
  );
}

export function fieldWorkPackFinalRecordCacheFile(
  record: FieldWorkPackFinalRecord,
) {
  const recordId = record.id.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
  const sha256 = record.pdfSha256.trim().toLowerCase().replace(/^sha256:/, '');
  if (
    !recordId
    || record.contentType !== 'application/pdf'
    || !/^[0-9a-f]{64}$/.test(sha256)
  ) {
    throw new Error('The completed PDF cache identity is invalid. Sync and try again.');
  }
  if (!GOVERNED_REFERENCE_DOCUMENT_DIRECTORY.exists) {
    GOVERNED_REFERENCE_DOCUMENT_DIRECTORY.create({ intermediates: true, idempotent: true });
  }
  return new File(
    GOVERNED_REFERENCE_DOCUMENT_DIRECTORY,
    `${recordId}-${sha256}.pdf`,
  );
}

export function purgeFieldWorkPackReferenceDocuments() {
  try {
    if (GOVERNED_REFERENCE_DOCUMENT_DIRECTORY.exists) {
      GOVERNED_REFERENCE_DOCUMENT_DIRECTORY.delete();
    }
  } catch {
    // The cache may already have been removed by the operating system.
  }
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalFieldWorkPackJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) as string;
  if (Array.isArray(value)) {
    return `[${value.map(canonicalFieldWorkPackJson).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalFieldWorkPackJson(item)}`)
    .join(',')}}`;
}

function pdfText(value: string) {
  return value.replace(/[^\x20-\x7e]/g, '?').replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(').replaceAll(')', '\\)').slice(0, 180);
}

function asciiJson(value: unknown) {
  return canonicalFieldWorkPackJson(value).replace(/[^\x20-\x7e]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Produces an exact-byte PDF without an additional rendering dependency. The
 * visible page contains the drawn strokes and the PDF embeds the canonical
 * vector payload as signature-payload.json for authoritative server binding.
 */
export function createFieldWorkPackSignaturePdf(
  payload: FieldWorkPackSignaturePayload,
) {
  const embeddedPayload = asciiJson(payload);
  const signatureCommands = payload.strokes.flatMap((stroke) => {
    if (!stroke.points.length) return [];
    const [first, ...rest] = stroke.points;
    const point = (value: typeof first) => ({
      x: 50 + value.x * 512,
      y: 360 + (1 - value.y) * 220,
    });
    const start = point(first);
    return [
      `${start.x.toFixed(3)} ${start.y.toFixed(3)} m`,
      ...rest.map((item) => {
        const next = point(item);
        return `${next.x.toFixed(3)} ${next.y.toFixed(3)} l`;
      }),
      'S',
    ];
  }).join('\n');
  const content = [
    'BT /F1 16 Tf 50 742 Td (Creditex governed signature record) Tj ET',
    `BT /F1 11 Tf 50 716 Td (${pdfText(payload.signerName)}) Tj ET`,
    `BT /F1 9 Tf 50 697 Td (${pdfText(payload.signerCapacity)}) Tj ET`,
    `BT /F1 8 Tf 50 678 Td (${pdfText(payload.signedAt)}) Tj ET`,
    '0.08 0.20 0.17 RG 2 w',
    signatureCommands,
    '0.75 0.75 0.75 RG 0.75 w 50 350 m 562 350 l S',
    `BT /F1 8 Tf 50 330 Td (Prompt ${pdfText(payload.promptKey)} | Role ${pdfText(payload.signerRoleKey)}) Tj ET`,
    `BT /F1 7 Tf 50 314 Td (Definition ${pdfText(payload.definitionSha256)}) Tj ET`,
    `BT /F1 7 Tf 50 300 Td (Response ${pdfText(payload.responseSha256)}) Tj ET`,
    `BT /F1 7 Tf 50 286 Td (Declarations ${pdfText(payload.declarationsSha256)}) Tj ET`,
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(signature-payload.json) 7 0 R] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length ${embeddedPayload.length} >>\nstream\n${embeddedPayload}\nendstream`,
    '<< /Type /Filespec /F (signature-payload.json) /EF << /F 6 0 R >> >>',
  ];
  let pdf = '%PDF-1.7\n% Creditex exact signature vector record\n';
  const offsets = [0];
  objects.forEach((objectBody, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) =>
    `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

export async function fieldWorkPackSha256(value: unknown) {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonicalFieldWorkPackJson(value),
  );
  return `sha256:${digest.toLowerCase()}`;
}

function hasAnswer(value: unknown) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function scalarEquals(left: unknown, right: unknown) {
  return typeof left === typeof right && left === right;
}

function conditionMatches(
  condition: FieldWorkPackCondition,
  answers: Readonly<Record<string, unknown>>,
  instanceAnswers: Readonly<Record<string, unknown>>,
) {
  const answer = condition.scope === 'section_instance'
    ? instanceAnswers[condition.promptKey]
    : answers[condition.promptKey];
  if (condition.operator === 'answered') return hasAnswer(answer);
  if (condition.operator === 'not_answered') return !hasAnswer(answer);
  if (condition.operator === 'equals') return scalarEquals(answer, condition.value);
  if (condition.operator === 'not_equals') return !scalarEquals(answer, condition.value);
  if (condition.operator === 'in' || condition.operator === 'not_in') {
    const expected = condition.value as ReadonlyArray<string | number | boolean>;
    const matched = Array.isArray(answer)
      ? answer.some((item) => expected.some((value) => scalarEquals(item, value)))
      : expected.some((value) => scalarEquals(answer, value));
    return condition.operator === 'in' ? matched : !matched;
  }
  if (condition.operator === 'contains') {
    return Array.isArray(answer)
      ? answer.some((item) => scalarEquals(item, condition.value))
      : typeof answer === 'string'
        && typeof condition.value === 'string'
        && answer.includes(condition.value);
  }
  if (typeof answer !== 'number' || typeof condition.value !== 'number') return false;
  if (condition.operator === 'greater_than') return answer > condition.value;
  if (condition.operator === 'greater_than_or_equal') return answer >= condition.value;
  if (condition.operator === 'less_than') return answer < condition.value;
  return answer <= condition.value;
}

export function fieldWorkPackVisibilityMatches(
  visibility: FieldWorkPackVisibility | null,
  answers: Readonly<Record<string, unknown>>,
  instanceAnswers: Readonly<Record<string, unknown>> = {},
) {
  if (!visibility) return true;
  const results = visibility.conditions.map((condition) =>
    conditionMatches(condition, answers, instanceAnswers));
  return visibility.match === 'all' ? results.every(Boolean) : results.some(Boolean);
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validIsoDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function answerMatchesPrompt(
  prompt: FieldWorkPackPrompt,
  answer: unknown,
  signerRoleByKey: ReadonlyMap<string, FieldWorkPackSignerRole>,
) {
  if (prompt.type === 'reference_document') {
    const reference = prompt.referenceDocument;
    if (!reference) return false;
    if (reference.acknowledgementMode === 'none') return true;
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return false;
    const acknowledgement = answer as Record<string, unknown>;
    return acknowledgement.contract
        === 'creditex-activity-work-pack-reference-document-acknowledgement/v1'
      && acknowledgement.sourceBindingTargetKey === reference.sourceBindingTargetKey
      && typeof acknowledgement.sourceArtifactId === 'string'
      && acknowledgement.sourceArtifactId.length > 0
      && typeof acknowledgement.sourceArtifactSha256 === 'string'
      && /^[0-9a-f]{64}$/.test(acknowledgement.sourceArtifactSha256)
      && acknowledgement.acknowledgementMode === reference.acknowledgementMode
      && acknowledgement.acknowledged === true
      && typeof acknowledgement.acknowledgedAt === 'string'
      && validIsoDateTime(acknowledgement.acknowledgedAt);
  }
  if (!hasAnswer(answer)) return false;
  if (prompt.type === 'text' || prompt.type === 'textarea') {
    if (typeof answer !== 'string') return false;
    if (prompt.minimumLength !== null && answer.length < prompt.minimumLength) return false;
    return prompt.maximumLength === null || answer.length <= prompt.maximumLength;
  }
  if (prompt.type === 'number') {
    if (typeof answer !== 'number' || !Number.isFinite(answer)) return false;
    if (prompt.minimumNumber !== null && answer < prompt.minimumNumber) return false;
    if (prompt.maximumNumber !== null && answer > prompt.maximumNumber) return false;
    if (prompt.numberStep !== null) {
      const origin = prompt.minimumNumber ?? 0;
      const quotient = (answer - origin) / prompt.numberStep;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) return false;
    }
    return true;
  }
  if (prompt.type === 'date') return typeof answer === 'string' && validIsoDate(answer);
  if (prompt.type === 'select') {
    return typeof answer === 'string'
      && prompt.options.some((option) => option.value === answer);
  }
  if (prompt.type === 'multiselect') {
    if (!Array.isArray(answer) || answer.some((item) => typeof item !== 'string')) return false;
    const values = answer as string[];
    if (new Set(values).size !== values.length) return false;
    if (prompt.minimumSelections !== null && values.length < prompt.minimumSelections) return false;
    if (prompt.maximumSelections !== null && values.length > prompt.maximumSelections) return false;
    return values.every((item) => prompt.options.some((option) => option.value === item));
  }
  if (prompt.type === 'checkbox') return answer === true;
  if (prompt.type === 'signature') {
    const role = signerRoleByKey.get(prompt.signerRoleKey);
    return Boolean(
      role
      && Array.isArray(answer)
      && answer.length >= role.minimumSignatures
      && answer.length <= role.maximumSignatures
      && answer.every((item) => typeof item === 'string' && item.length > 0)
      && new Set(answer).size === answer.length,
    );
  }
  if (!Array.isArray(answer) || answer.some((item) => typeof item !== 'string')) return false;
  const requirement = prompt.fileRequirement;
  return Boolean(
    requirement
    && answer.length >= requirement.minimumCount
    && answer.length <= requirement.maximumCount
    && new Set(answer).size === answer.length,
  );
}

export function fieldActivityWorkPackCompletion(input: {
  workPack: FieldActivityWorkPackSchema;
  response: FieldActivityWorkPackResponse;
  expectedSchemaSha256?: string;
}): FieldWorkPackCompletion {
  const { workPack, response } = input;
  const blockers: FieldWorkPackCompletion['blockers'] = [];
  if (response.contract !== FIELD_WORK_PACK_RESPONSE_CONTRACT) {
    blockers.push({
      code: 'WORK_PACK_RESPONSE_CONTRACT_INVALID',
      key: 'response',
      message: 'The response contract does not match this work-pack engine.',
    });
  }
  if (
    input.expectedSchemaSha256
    && response.schemaSha256 !== input.expectedSchemaSha256
  ) {
    blockers.push({
      code: 'WORK_PACK_RESPONSE_SCHEMA_MISMATCH',
      key: 'schemaSha256',
      message: 'The response is not bound to this exact work-pack version.',
    });
  }
  for (const dependency of workPack.dependencies) {
    if (!dependency.required) continue;
    const resolution = response.dependencyResolutions[dependency.dependencyKey];
    if (
      resolution?.status !== 'resolved'
      || resolution.referenceIds.length < 1
      || !/^sha256:[0-9a-f]{64}$/.test(resolution.snapshotSha256)
    ) {
      blockers.push({
        code: 'WORK_PACK_DEPENDENCY_UNRESOLVED',
        key: dependency.dependencyKey,
        message: `${dependency.label} must be resolved against its governed source.`,
      });
    }
  }
  const visiblePromptKeys: string[] = [];
  const requiredPromptKeys: string[] = [];
  const completedPromptKeys: string[] = [];
  const signerRoleByKey = new Map(workPack.signerRoles.map((role) => [role.roleKey, role]));
  for (const section of workPack.sections) {
    if (!fieldWorkPackVisibilityMatches(section.visibility, response.answers)) continue;
    const instances = section.repeatability
      ? response.repeatableSections?.[section.sectionKey] ?? []
      : [{ instanceKey: '', answers: response.answers }];
    if (section.repeatability) {
      const instanceKeys = instances.map((instance) => instance.instanceKey);
      if (
        instances.length < section.repeatability.minimumInstances
        || instances.length > section.repeatability.maximumInstances
        || new Set(instanceKeys).size !== instanceKeys.length
        || instanceKeys.some((key) => !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$/.test(key))
      ) {
        blockers.push({
          code: 'WORK_PACK_REPEATABLE_SECTION_INVALID',
          key: section.sectionKey,
          message: `${section.title} needs ${section.repeatability.minimumInstances} to ${section.repeatability.maximumInstances} uniquely identified items.`,
        });
      }
    }
    for (const instance of instances) {
      for (const prompt of section.prompts) {
        if (!fieldWorkPackVisibilityMatches(prompt.visibility, response.answers, instance.answers)) continue;
        const responseKey = section.repeatability
          ? `${section.sectionKey}[${instance.instanceKey}].${prompt.promptKey}`
          : prompt.promptKey;
        visiblePromptKeys.push(responseKey);
        if (prompt.required) requiredPromptKeys.push(responseKey);
        const answer = instance.answers[prompt.promptKey];
        if (answerMatchesPrompt(prompt, answer, signerRoleByKey)) {
          completedPromptKeys.push(responseKey);
        } else if (prompt.required) {
          blockers.push({
            code: 'WORK_PACK_REQUIRED_PROMPT_INCOMPLETE',
            key: responseKey,
            message: `${prompt.label} is required.`,
          });
        }
      }
    }
  }
  return {
    ready: blockers.length === 0 && requiredPromptKeys.length > 0,
    visiblePromptKeys,
    requiredPromptKeys,
    completedPromptKeys,
    blockers,
  };
}

export function projectedFieldActivityWorkPackCompletion(
  pack: FieldActivityWorkPack,
) {
  return fieldActivityWorkPackCompletion({
    workPack: pack.definition.schema,
    response: pack.response,
    expectedSchemaSha256: pack.definition.schemaSha256,
  });
}

export function fieldWorkPackSections(pack: FieldActivityWorkPack) {
  return pack.definition.schema.sections
    .filter((section) => fieldWorkPackVisibilityMatches(
      section.visibility,
      pack.response.answers,
    ))
    .sort((left, right) => left.order - right.order);
}

export function fieldWorkPackSectionInstances(
  section: FieldWorkPackSection,
  response: FieldActivityWorkPackResponse,
) {
  return section.repeatability
    ? response.repeatableSections[section.sectionKey] || []
    : [{ instanceKey: '', answers: response.answers }];
}

export function mergeFieldWorkPackSectionPatches(
  response: FieldActivityWorkPackResponse,
  sections: FieldWorkPackSection[],
  patches: FieldWorkPackSectionPatch[],
  dependencyResolutions?: Record<string, FieldWorkPackDependencyResolution>,
): FieldActivityWorkPackResponse {
  const next: FieldActivityWorkPackResponse = {
    ...response,
    answers: { ...response.answers },
    repeatableSections: Object.fromEntries(Object.entries(response.repeatableSections)
      .map(([key, instances]) => [key, instances.map((instance) => ({
        instanceKey: instance.instanceKey,
        answers: { ...instance.answers },
      }))])),
    dependencyResolutions: {
      ...response.dependencyResolutions,
      ...(dependencyResolutions || {}),
    },
  };
  const sectionByKey = new Map(sections.map((section) => [section.sectionKey, section]));
  for (const patch of patches) {
    const section = sectionByKey.get(patch.sectionKey);
    if (!section) throw new Error('This work-pack section is no longer in the governed schema.');
    const allowedPromptKeys = new Set(section.prompts.map((prompt) => prompt.promptKey));
    const answers = Object.fromEntries(Object.entries(patch.answers)
      .filter(([key]) => allowedPromptKeys.has(key)));
    if (!section.repeatability) {
      if (patch.remove) throw new Error('A non-repeatable section cannot be removed.');
      if (patch.repeatInstanceKey) throw new Error('This section does not accept repeat item keys.');
      next.answers = { ...next.answers, ...answers };
      continue;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$/.test(patch.repeatInstanceKey)) {
      throw new Error('This repeat item needs a stable valid item key.');
    }
    const items = [...(next.repeatableSections[section.sectionKey] || [])];
    const index = items.findIndex((item) => item.instanceKey === patch.repeatInstanceKey);
    if (patch.remove) {
      if (index < 0) throw new Error('This repeat item no longer exists.');
      items.splice(index, 1);
      next.repeatableSections = { ...next.repeatableSections, [section.sectionKey]: items };
      continue;
    }
    if (index >= 0) {
      items[index] = { ...items[index], answers: { ...items[index].answers, ...answers } };
    } else {
      if (items.length >= section.repeatability.maximumInstances) {
        throw new Error(`This section allows up to ${section.repeatability.maximumInstances} items.`);
      }
      items.push({ instanceKey: patch.repeatInstanceKey, answers });
    }
    next.repeatableSections = { ...next.repeatableSections, [section.sectionKey]: items };
  }
  return next;
}

export function clearFieldWorkPackSignatureAnswers(
  response: FieldActivityWorkPackResponse,
  sections: readonly FieldWorkPackSection[],
) {
  const next: FieldActivityWorkPackResponse = {
    ...response,
    answers: { ...response.answers },
    repeatableSections: Object.fromEntries(Object.entries(response.repeatableSections)
      .map(([sectionKey, instances]) => [sectionKey, instances.map((instance) => ({
        instanceKey: instance.instanceKey,
        answers: { ...instance.answers },
      }))])),
    dependencyResolutions: { ...response.dependencyResolutions },
  };
  for (const section of sections) {
    const signatureKeys = section.prompts
      .filter((prompt) => prompt.type === 'signature')
      .map((prompt) => prompt.promptKey);
    if (!signatureKeys.length) continue;
    if (!section.repeatability) {
      for (const promptKey of signatureKeys) delete next.answers[promptKey];
      continue;
    }
    next.repeatableSections[section.sectionKey] = (
      next.repeatableSections[section.sectionKey] || []
    ).map((instance) => {
      const answers = { ...instance.answers };
      for (const promptKey of signatureKeys) delete answers[promptKey];
      return { ...instance, answers };
    });
  }
  return next;
}

export function signatureDraftReady(
  role: FieldWorkPackSignerRole,
  draft: FieldWorkPackSignatureDraft,
) {
  const identityReady = role.identityRequirements.every((requirement) =>
    !requirement.required || Boolean(draft.identity[requirement.fieldKey]?.trim()));
  const pointCount = draft.strokes.reduce(
    (count, stroke) => count + stroke.points.length,
    0,
  );
  return identityReady
    && draft.signerRoleKey === role.roleKey
    && draft.signerCapacity === role.capacity
    && Boolean(draft.signerName.trim())
    && draft.strokes.length > 0
    && pointCount >= 3;
}

export function workPackPromptResponseKey(
  section: FieldWorkPackSection,
  repeatInstanceKey: string,
  prompt: FieldWorkPackPrompt,
) {
  return section.repeatability
    ? `${section.sectionKey}[${repeatInstanceKey}].${prompt.promptKey}`
    : prompt.promptKey;
}

export function workPackDependencyStatus(
  pack: FieldActivityWorkPack,
  dependencyKey: string,
) {
  const dependency = pack.definition.schema.dependencies.find(
    (item) => item.dependencyKey === dependencyKey,
  );
  const resolution = pack.response.dependencyResolutions[dependencyKey];
  return {
    dependency,
    resolution,
    ready: !dependency?.required || (
      resolution?.status === 'resolved'
      && resolution.referenceIds.length > 0
      && /^sha256:[0-9a-f]{64}$/.test(resolution.snapshotSha256)
    ),
  };
}
