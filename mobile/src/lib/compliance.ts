import type {
  ComplianceEvidenceRequirement,
  FieldJob,
  FieldJobCompliance,
} from '@/lib/types';

export type GovernedEvidenceSelection = {
  complianceCase: FieldJobCompliance;
  requirement: ComplianceEvidenceRequirement;
};

export type GovernedEvidenceBinding = {
  complianceCaseId: string;
  complianceActivityVersionId: string;
  evidencePolicyVersionId: string;
  evidenceRequirementId: string;
  evidenceRequirementCode: string;
};

export function complianceCasesForJob(
  job: Pick<FieldJob, 'complianceCases' | 'compliance'>,
) {
  if (Array.isArray(job.complianceCases) && job.complianceCases.length) {
    return job.complianceCases;
  }
  return job.compliance ? [job.compliance] : [];
}

function requiredIdentifier(value: unknown, label: string) {
  const identifier = typeof value === 'string' ? value.trim() : '';
  if (!identifier) {
    throw new Error(
      `This governed evidence requirement is missing its ${label}. Sync the job before capturing evidence.`,
    );
  }
  return identifier;
}

export function governedEvidenceBinding(
  selection: GovernedEvidenceSelection,
): GovernedEvidenceBinding {
  const complianceCaseId = requiredIdentifier(
    selection.complianceCase.caseId,
    'case ID',
  );
  const complianceActivityVersionId = requiredIdentifier(
    selection.complianceCase.activityVersionId,
    'activity version',
  );
  const evidencePolicyVersionId = requiredIdentifier(
    selection.complianceCase.evidencePolicyVersionId,
    'evidence policy version',
  );
  const evidenceRequirementId = requiredIdentifier(
    selection.requirement.id,
    'requirement ID',
  );
  const evidenceRequirementCode = requiredIdentifier(
    selection.requirement.code,
    'requirement code',
  );
  if (!selection.complianceCase.requirements.some(
    (requirement) => requirement.id === evidenceRequirementId,
  )) {
    throw new Error(
      'This evidence requirement does not belong to the selected compliance case. Sync the job before capturing evidence.',
    );
  }
  return {
    complianceCaseId,
    complianceActivityVersionId,
    evidencePolicyVersionId,
    evidenceRequirementId,
    evidenceRequirementCode,
  };
}
