export type RentalMetadataField = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'select' | 'checkbox';
  required: boolean;
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
  repeatBy: string;
  photoGuidance: string;
  help: string;
  credentialGate: string;
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

export const RENTAL_ADVERSE_OUTCOMES = new Set([
  'does_not_meet',
  'specialist_verification_required',
  'not_accessible',
  'exemption_evidence_pending',
]);

export const RENTAL_TRADES = [
  'Assessor follow-up',
  'Builder',
  'Carpenter',
  'Electrician',
  'Gasfitter',
  'Glazier',
  'Heating and cooling technician',
  'Locksmith',
  'Mould or moisture specialist',
  'Painter',
  'Plumber',
  'Roof plumber',
  'Smoke alarm technician',
  'Structural engineer',
  'Window furnishings installer',
] as const;

export function newRentalItem(
  module: RentalAssessmentModule,
  section: RentalAssessmentSection,
  check: RentalAssessmentCheck,
  instanceKey = check.repeatBy === 'property' ? 'property' : 'first',
): RentalAssessmentItem {
  return {
    id: '',
    moduleId: module.id,
    itemKey: '',
    sectionKey: section.key,
    checkKey: check.key,
    instanceKey,
    locationLabel: '',
    outcome: '',
    response: {},
    publicNotes: '',
    internalNotes: '',
    requiredEvidenceCount: check.requiredEvidenceCount,
    sortOrder: 0,
    revision: 0,
  };
}
