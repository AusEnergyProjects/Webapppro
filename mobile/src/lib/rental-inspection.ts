export type RentalMetadataField = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'select' | 'checkbox';
  required: boolean;
  phase?: 'setup' | 'profile' | 'final';
  source?: 'team_profile' | 'assessment' | 'automatic';
  help: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
};

export type RentalAssessmentCheck = {
  key: string;
  prompt: string;
  required: boolean;
  requiredEvidenceCount: number;
  responseType: string;
  responseFields?: Array<{ key: string; label: string; required: boolean }>;
  repeatBy: string;
  photoGuidance: string;
  help: string;
  credentialGate: string;
  effectiveFrom?: string;
  trigger?: string;
  sourceUrl?: string;
  assessmentPhase?: 'current' | 'energy_readiness_2027';
};

export type RentalAssessmentSection = {
  key: string;
  title: string;
  summary: string;
  checks: RentalAssessmentCheck[];
};

export type RentalAssessmentModule = {
  id: string;
  key: string;
  required: boolean;
  status: string;
  title: string;
  requiredCapability: string;
  template: {
    key: string;
    title: string;
    credentialGate: string;
    reportBoundary: string;
    metadataFields: RentalMetadataField[];
    sections: RentalAssessmentSection[];
    assessmentScope?: 'energy_readiness_2027' | 'current_minimum_standards';
    templateVersion?: number;
  };
  answers: Record<string, unknown>;
  revision: number;
  completedAt: string;
};

export type RentalAssessmentItem = {
  id: string;
  moduleId: string;
  itemKey: string;
  sectionKey: string;
  checkKey: string;
  instanceKey: string;
  locationLabel: string;
  outcome: string;
  response: Record<string, unknown>;
  publicNotes: string;
  internalNotes: string;
  requiredEvidenceCount: number;
  sortOrder: number;
  revision: number;
};

export type RentalAssessmentFinding = {
  id: string;
  moduleId: string;
  itemId: string;
  title: string;
  description: string;
  standardReference: string;
  status: string;
  severity: string;
  tradeCategory: string;
  recommendedAction: string;
  scopeSummary: string;
  quantityMilli: number;
  unitLabel: string;
  details: Record<string, unknown>;
  internalNotes: string;
  revision: number;
};

export type RentalAssessmentEvidence = {
  id: string;
  moduleId: string;
  itemId: string;
  jobMediaId: string;
  purpose: string;
  caption: string;
  status: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  capture: null | {
    source: string;
    capturedAtUtc: string;
    locationCaptured: boolean;
    latitude: number | null;
    longitude: number | null;
    accuracyMetres: number | null;
  };
};

export type RentalAssessmentResult = {
  ok?: boolean;
  deliveryRecipient?: { email: string; name: string } | null;
  reportDelivery?: { status: string; recipientEmail?: string; sentAt?: string };
  inspection?: {
    id: string;
    inspectionNumber: string;
    status: string;
    rulesEffectiveFrom: string;
    revision: number;
  };
  modules?: RentalAssessmentModule[];
  items?: RentalAssessmentItem[];
  findings?: RentalAssessmentFinding[];
  evidence?: RentalAssessmentEvidence[];
  evidenceCounts?: Record<string, number>;
  evidenceBudget?: { usedBytes: number; maxBytes: number; remainingBytes: number };
  completion?: Record<string, { complete: boolean; blockers: Array<{ key: string; label: string }> }>;
  reports?: Array<{
    id: string;
    reportNumber: string;
    revision: number;
    status: string;
    issuedAt: string;
    pdfSizeBytes: number;
    link: null | {
      id: string;
      status: string;
      expiresAt: string;
      viewCount: number;
      downloadCount: number;
      shareUrl: string;
      pdfUrl: string;
    };
  }>;
  issuedReport?: {
    reportId: string;
    reportNumber: string;
    issuedAt: string;
    expiresAt: string;
    shareUrl: string;
    pdfUrl: string;
  };
  permissions?: {
    canEdit: boolean;
    canIssue: boolean;
    canRevokeLink: boolean;
    isAssignedAssessor: boolean;
  };
  blockers?: Array<{ key: string; label: string }>;
  error?: string;
};

export const RENTAL_OUTCOMES = [
  { value: 'meets', label: 'Meets the standard' },
  { value: 'does_not_meet', label: 'Does not meet' },
  { value: 'specialist_verification_required', label: 'Specialist verification needed' },
  { value: 'not_accessible', label: 'Not accessible' },
  { value: 'not_applicable', label: 'Not applicable' },
  { value: 'exemption_evidence_pending', label: 'Exemption evidence pending' },
] as const;

export const RENTAL_READINESS_OUTCOMES = RENTAL_OUTCOMES.map((option) => ({
  ...option,
  label: option.value === 'meets' ? 'Yes, ready' : option.value === 'does_not_meet' ? 'Upgrade planning needed' : option.label,
}));

export function rentalObservationsComplete(result: RentalAssessmentResult, moduleId: string) {
  const completion = result.completion?.[moduleId];
  return Boolean(completion && completion.blockers.every((blocker) => blocker.key.startsWith('metadata:')));
}

// Remember a successful upload before linking it, so a failed link can retry the same job file.
export async function deliverRentalPhoto<T>(input: {
  mediaId?: string;
  upload: () => Promise<string>;
  remember: (mediaId: string) => Promise<void>;
  link: (mediaId: string) => Promise<T>;
}) {
  let mediaId = input.mediaId;
  if (!mediaId) {
    mediaId = await input.upload();
    if (!mediaId) throw new Error('The photo upload did not return a file reference.');
    await input.remember(mediaId);
  }
  return input.link(mediaId);
}

export const RENTAL_ADVERSE_OUTCOMES = new Set([
  'does_not_meet',
  'specialist_verification_required',
  'not_accessible',
  'exemption_evidence_pending',
]);

export function rentalAccessLimitations(items: RentalAssessmentItem[], moduleId: string): string {
  return items.filter((item) => item.moduleId === moduleId && item.outcome === 'not_accessible')
    .map((item) => [item.locationLabel, item.publicNotes].filter(Boolean).join(': '))
    .filter(Boolean).join('\n');
}

export function newRentalItem(
  module: RentalAssessmentModule,
  section: RentalAssessmentSection,
  check: RentalAssessmentCheck,
  instanceKey = module.key === 'minimum_standards' || check.repeatBy === 'property' ? 'property' : 'first',
): RentalAssessmentItem {
  return {
    id: '',
    moduleId: module.id,
    itemKey: '',
    sectionKey: section.key,
    checkKey: check.key,
    instanceKey,
    locationLabel: instanceKey === 'property' ? 'Property' : '',
    outcome: '',
    response: {},
    publicNotes: '',
    internalNotes: '',
    requiredEvidenceCount: check.requiredEvidenceCount,
    sortOrder: 0,
    revision: 0,
  };
}

/** Routes server completion blockers to the actual answer, including historical item keys. */
export function rentalCompletionTarget(module: RentalAssessmentModule, items: RentalAssessmentItem[], blockerKey: string):
  { kind: 'check'; sectionKey: string; checkIndex: number; instanceKey?: string } | { kind: 'metadata'; fieldKey: string } | null {
  if (blockerKey.startsWith('metadata:')) return { kind: 'metadata', fieldKey: blockerKey.slice('metadata:'.length) };
  if (module.key === 'minimum_standards' && blockerKey.includes('shower_2027_readiness')) {
    const section = module.template.sections.find((entry) => entry.checks.some((check) => check.key === 'showerhead_rating'));
    if (section) return { kind: 'check', sectionKey: section.key, checkIndex: section.checks.findIndex((check) => check.key === 'showerhead_rating') };
  }
  if (blockerKey.startsWith('check:')) {
    const [, sectionKey, checkKey] = blockerKey.split(':');
    const section = module.template.sections.find((entry) => entry.key === sectionKey);
    const checkIndex = section?.checks.findIndex((entry) => entry.key === checkKey) ?? -1;
    if (checkIndex >= 0) return { kind: 'check', sectionKey, checkIndex };
  }
  const detailKey = blockerKey.slice(blockerKey.indexOf(':') + 1);
  const item = items.find((entry) => entry.moduleId === module.id && entry.itemKey
    && (detailKey === entry.itemKey || detailKey.startsWith(entry.itemKey + ':')));
  if (!item) return null;
  const section = module.template.sections.find((entry) => entry.key === item.sectionKey);
  const checkIndex = section?.checks.findIndex((entry) => entry.key === item.checkKey) ?? -1;
  return checkIndex >= 0 ? { kind: 'check', sectionKey: item.sectionKey, checkIndex,
    ...(module.key !== 'minimum_standards' ? { instanceKey: item.instanceKey } : {}) } : null;
}

/** Saved device answers count toward review; the server still validates them before issuing anything. */
export function rentalPendingCompletionBlockers(result: RentalAssessmentResult, module: RentalAssessmentModule,
  pending: { status: string; body: Record<string, unknown> }[]) {
  return (result.completion?.[module.id]?.blockers || []).filter((blocker) => {
    if (['metadata:coverageConfirmed', 'metadata:assessorDeclaration'].includes(blocker.key)) return false;
    const target = rentalCompletionTarget(module, result.items || [], blocker.key);
    if (!target) return true;
    return !pending.some((save) => {
      if (save.status === 'conflict' || save.body.moduleId !== module.id) return false;
      if (target.kind === 'check') {
        const check = module.template.sections.find((section) => section.key === target.sectionKey)?.checks[target.checkIndex];
        return save.body.action === 'save_item' && save.body.sectionKey === target.sectionKey && save.body.checkKey === check?.key
          && save.body.instanceKey === (target.instanceKey || 'property');
      }
      const field = module.template.metadataFields.find((entry) => entry.key === target.fieldKey);
      const patch = save.body.answers;
      if (!field || save.body.action !== 'save_module_answers' || !patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
      const value = (patch as Record<string, unknown>)[target.fieldKey];
      if (field.type === 'checkbox') return value === true;
      if (!String(value ?? '').trim()) return false;
      return field.type !== 'select' || field.options.some((option) => option.value === value);
    });
  });
}
