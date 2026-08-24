export type JobStage = 'backlog' | 'ready' | 'scheduled' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type TaskStatus = 'pending' | 'done';
export type FieldAccessMode = 'trade_team' | 'creditex_manual';

export type FieldTask = {
  id: string;
  title: string;
  dueAt: string;
  status: TaskStatus;
  completedAt: string;
  revision: number;
  updatedAt: string;
};

export type FieldMedia = {
  id: string;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  caption: string;
  createdAt: string;
};

export type FieldForm = {
  id: string;
  templateKey: string;
  templateVersion: number;
  name: string;
  jurisdiction: string;
  template: {
    guidance: string;
    fields: Array<{ key: string; label: string; type: 'checkbox' | 'text' | 'textarea' | 'date' | 'select' | 'number' | 'signature'; required: boolean; maxLength?: number; options?: string[] }>;
  };
  answers: Record<string, string | boolean>;
  status: 'draft' | 'complete';
  revision: number;
  ready: boolean;
  missing: string[];
  completedAt: string;
  updatedAt: string;
};

export type ComplianceEvidenceRequirement = {
  id: string;
  code: string;
  title: string;
  description: string;
  evidenceType: string;
  captureTiming: string;
  minimumCount: number;
  maximumCount: number;
  acceptedCount: number;
  submittedCount: number;
  originalRequired: boolean;
  metadataRequired: boolean;
  gpsRequired: boolean;
  dateStampRequired: boolean;
  installerSignatureRequired: boolean;
  customerSignatureRequired: boolean;
  allowedContentTypes: string[];
  captureModes: Array<'camera' | 'document'>;
  compatibility: {
    captureSupported: boolean;
    requiresConditionEvaluation: boolean;
    requiresSignatureCapture: boolean;
    requiresDynamicFieldSchema: boolean;
    blockers: string[];
  };
  status: string;
};

export type FieldJobCompliance = {
  caseId: string;
  caseNumber: string;
  activityVersionId: string;
  activityCode: string;
  activityTitle: string;
  evidencePolicyVersionId: string;
  status?: string;
  evidenceStatus?: string;
  revision?: number;
  requirements: ComplianceEvidenceRequirement[];
};

export type FieldComplianceIntent = {
  id: string;
  intentKey: string;
  programTemplateId: string;
  programCode: string;
  programName: string;
  activityTemplateId: string;
  activityCode: string;
  activityTitle: string;
  plannedStart: string;
  plannedDate: string;
  status: 'planned' | 'case_linked';
  governanceState: string;
  governanceMessage: string;
  linkedCaseReady: boolean;
  complianceCaseId: string;
  caseNumber: string;
  caseStatus: string;
  evidenceStatus: string;
};

export type FieldWorkPackSignaturePoint = {
  x: number;
  y: number;
  capturedAtMs: number;
  pressure: number | null;
};

export type FieldWorkPackSignatureStroke = {
  strokeKey: string;
  points: FieldWorkPackSignaturePoint[];
};

export type FieldWorkPackSignatureDraft = {
  signerRoleKey: string;
  signerName: string;
  signerCapacity: string;
  identity: Record<string, string>;
  strokes: FieldWorkPackSignatureStroke[];
  capturedAt: string;
};

export type FieldWorkPackSignerIdentity = {
  contract: 'creditex-activity-work-pack-signer-identity/v1';
  roleKey: string;
  capacity: string;
  identitySource: FieldWorkPackSignerIdentitySource;
  signerName: string;
  signerUid: string;
  fields: Record<string, string>;
};

export type FieldWorkPackBoundSignaturePoint = {
  x: number;
  y: number;
  pressure: number | null;
  capturedAtOffsetMs: number;
};

export type FieldWorkPackSignaturePayload = {
  contract: 'creditex-activity-work-pack-signature-payload/v1';
  instanceKey: string;
  caseInstanceId: string;
  promptKey: string;
  signerRoleKey: string;
  signerName: string;
  signerCapacity: string;
  signerIdentitySha256: string;
  attestationSha256: string;
  definitionSha256: string;
  prefillSha256: string;
  responseSha256: string;
  declarationsSha256: string;
  strokes: Array<{ points: FieldWorkPackBoundSignaturePoint[] }>;
  signedAt: string;
};

export type FieldWorkPackSignatureAttestation = {
  contract: 'creditex-activity-work-pack-signature-attestation/v1';
  promptKey: string;
  signerRoleKey: string;
  text: string;
  version: string;
  sourceBindingTargetKey: string;
  signerIdentity: FieldWorkPackSignerIdentity;
  signerIdentitySha256: string;
  definitionSha256: string;
  prefillSha256: string;
  responseSha256: string;
  declarationsSha256: string;
};

export type FieldWorkPackDeviceAttestation = {
  contract: 'creditex-activity-work-pack-device-attestation/v1';
  deviceId: string;
  appId: string;
  appVersion: string;
  appBuild: string;
  sessionId: string;
  capturedByUid: string;
  signedAt: string;
  deviceContext: Record<string, string | number | boolean>;
};

export type FieldWorkPackConditionValue = string | number | boolean;

export type FieldWorkPackCondition = {
  promptKey: string;
  scope: 'work_pack' | 'section_instance';
  operator: 'equals' | 'not_equals' | 'in' | 'not_in' | 'contains'
    | 'greater_than' | 'greater_than_or_equal' | 'less_than'
    | 'less_than_or_equal' | 'answered' | 'not_answered';
  value: FieldWorkPackConditionValue | FieldWorkPackConditionValue[] | null;
};

export type FieldWorkPackVisibility = {
  match: 'all' | 'any';
  conditions: FieldWorkPackCondition[];
};

export type FieldWorkPackOption = {
  value: string;
  label: string;
};

export type FieldWorkPackFileRequirement = {
  minimumCount: number;
  maximumCount: number;
  allowedContentTypes: string[];
  originalRequired: boolean;
  metadataRequired: boolean;
  gpsRequired: boolean;
  captureTimeRequired: boolean;
};

export type FieldWorkPackReferenceDocument = {
  sourceBindingTargetKey: string;
  acknowledgementMode: 'none' | 'viewed' | 'confirmed';
  acknowledgementText: string;
  acknowledgementVersion: string;
};

export type FieldWorkPackReferenceDocumentAcknowledgement = {
  contract: 'creditex-activity-work-pack-reference-document-acknowledgement/v1';
  sourceBindingTargetKey: string;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  acknowledgementMode: 'viewed' | 'confirmed';
  acknowledged: true;
  acknowledgedAt: string;
};

export type FieldWorkPackStage = {
  stageKey: string;
  order: number;
  label: string;
  description: string;
};

export type FieldWorkPackAttestation = {
  text: string;
  version: string;
  sourceBindingTargetKey: string;
};

export type FieldWorkPackSignerIdentityRequirement = {
  fieldKey: string;
  label: string;
  required: boolean;
};

export type FieldWorkPackSignerIdentitySource = 'customer_context'
  | 'assigned_worker' | 'authenticated_actor' | 'manual_verified';

export type FieldWorkPackSignerRole = {
  roleKey: string;
  label: string;
  capacity: string;
  identitySource: FieldWorkPackSignerIdentitySource;
  minimumSignatures: number;
  maximumSignatures: number;
  identityRequirements: FieldWorkPackSignerIdentityRequirement[];
};

export type FieldWorkPackProductDependency = {
  dependencyKey: string;
  kind: 'product';
  label: string;
  required: boolean;
  registryCode: string;
  productKind: string | 'not_applicable';
  productCategory: string;
  selectionMode: 'single' | 'multiple';
  minimumCount: number;
  maximumCount: number;
};

export type FieldWorkPackScenarioDependency = {
  dependencyKey: string;
  kind: 'scenario';
  label: string;
  required: boolean;
  scenarioCodes: string[];
  selectionMode: 'single' | 'multiple';
};

export type FieldWorkPackCalculatorDependency = {
  dependencyKey: string;
  kind: 'calculator';
  label: string;
  required: boolean;
  calculatorKey: string;
  requiredInputKeys: string[];
};

export type FieldWorkPackDependency = FieldWorkPackProductDependency
  | FieldWorkPackScenarioDependency | FieldWorkPackCalculatorDependency;

export type FieldWorkPackPrompt = {
  promptKey: string;
  order: number;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select'
    | 'multiselect' | 'checkbox' | 'photo' | 'document'
    | 'reference_document' | 'signature';
  label: string;
  instructions: string;
  required: boolean;
  visibility: FieldWorkPackVisibility | null;
  dependencyKeys: string[];
  requirementKeys: string[];
  stageKey: string;
  options: FieldWorkPackOption[];
  signerRoleKey: string;
  attestation: FieldWorkPackAttestation | null;
  minimumLength: number | null;
  maximumLength: number | null;
  minimumNumber: number | null;
  maximumNumber: number | null;
  numberStep: number | null;
  unit: string;
  minimumSelections: number | null;
  maximumSelections: number | null;
  fileRequirement: FieldWorkPackFileRequirement | null;
  referenceDocument: FieldWorkPackReferenceDocument | null;
};

export type FieldWorkPackRepeatability = {
  itemKey: string;
  itemLabel: string;
  minimumInstances: number;
  maximumInstances: number;
};

export type FieldWorkPackSection = {
  sectionKey: string;
  order: number;
  title: string;
  description: string;
  visibility: FieldWorkPackVisibility | null;
  repeatability: FieldWorkPackRepeatability | null;
  prompts: FieldWorkPackPrompt[];
};

export type FieldActivityWorkPackSchema = {
  contract: 'creditex-activity-work-pack/v1';
  activityTemplateId: string;
  version: number;
  title: string;
  effectiveFrom: string;
  effectiveTo: string;
  catalogueReviewedOn: string;
  stages: FieldWorkPackStage[];
  signerRoles: FieldWorkPackSignerRole[];
  dependencies: FieldWorkPackDependency[];
  sections: FieldWorkPackSection[];
};

export type FieldWorkPackDependencyResolution = {
  status: 'resolved' | 'blocked' | 'not_applicable';
  referenceIds: string[];
  snapshotSha256: string;
};

export type FieldWorkPackOfficialProduct = {
  dependencyKey: string;
  selectionId: string;
  snapshotId: string;
  registryCode: string;
  productKind: string;
  sourceKey: string;
  sourceRecordKey: string;
  sourceSha256: string;
  manufacturer: string;
  brand: string;
  model: string;
  series: string;
  registrationNumber: string;
  certificateNumber: string;
  approvalStatus: string;
  eligibleFrom: string;
  eligibleTo: string;
  registryEffectiveFrom: string;
};

export type FieldWorkPackOfficialProductSelection = {
  selectionId: string;
  snapshotId: string;
  quantity: number;
};

export type FieldWorkPackCalculatorPendingReview = {
  dependencyKey: string;
  calculationRunId: string;
  status: 'calculated';
  reviewStatus: 'creditex_review_required';
  runAt: string;
};

export type FieldActivityWorkPackResponse = {
  contract: 'creditex-activity-work-pack-response/v1';
  schemaSha256: string;
  answers: Record<string, unknown>;
  repeatableSections: Record<string, Array<{
    instanceKey: string;
    answers: Record<string, unknown>;
  }>>;
  dependencyResolutions: Record<string, FieldWorkPackDependencyResolution>;
};

export type FieldWorkPackCompletion = {
  ready: boolean;
  visiblePromptKeys: string[];
  requiredPromptKeys: string[];
  completedPromptKeys: string[];
  blockers: Array<{ code: string; key: string; message: string }>;
};

export type FieldWorkPackSignature = {
  id: string;
  promptKey: string;
  signerRole: string;
  signerCapacity: string;
  signerName: string;
  signerUid: string;
  signatureSha256: string;
  signaturePayload: FieldWorkPackSignaturePayload;
  previewUrl: string;
  attestationSha256: string;
  definitionSha256: string;
  prefillSha256: string;
  responseSha256: string;
  declarationsSha256: string;
  action: 'captured' | 'revoked';
  supersedesSignatureId: string;
  capturedDeviceId: string;
  signedAt: string;
  createdAt: string;
};

export type FieldWorkPackArtifact = {
  id: string;
  promptKey: string;
  artifactKind: 'photo' | 'document';
  originalFileName: string;
  originalSha256: string;
  metadataSha256: string;
  integrityReceiptId: string;
  verificationState: 'matched';
  supersedesArtifactId: string;
  capturedDeviceId: string;
  capturedByUid: string;
  capturedAt: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

export type FieldWorkPackSignerBinding = {
  roleKey: string;
  capacity: string;
  identitySource: FieldWorkPackSignerIdentitySource;
  signerUid: string;
  signerName: string;
  fields: Record<string, string>;
};

export type FieldWorkPackReferenceDocumentProjection = {
  responseKey: string;
  sectionKey: string;
  repeatInstanceKey: string;
  promptKey: string;
  sourceBindingTargetKey: string;
  acknowledgementMode: 'none' | 'viewed' | 'confirmed';
  acknowledgementText: string;
  acknowledgementVersion: string;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  title: string;
  version: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  openUrl: string;
};

export type FieldWorkPackProviderContext = {
  contract: 'creditex-activity-work-pack-provider-context/v1';
  organisationId: string;
  organisationCode: string;
  legalName: string;
  tradingName: string;
  abn: string;
  revision: string;
  contextSha256: string;
};

export type FieldWorkPackInstallerBusinessContext = {
  contract: 'creditex-activity-work-pack-installer-business-context/v1';
  ownerUid: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  abn: string;
  verifiedAbn: string;
  participantId: string;
  participantLegalName: string;
  participantTradingName: string;
  participantAbn: string;
  accountRevision: string;
  participantRevision: string;
  contextSha256: string;
};

export type FieldWorkPackAssignmentContext = {
  contract: 'creditex-activity-work-pack-assignment-context/v1';
  ownerUid: string;
  memberId: string;
  memberUid: string;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  revision: string;
  contextSha256: string;
};

export type FieldWorkPackFinalRecord = {
  id: string;
  caseInstanceId: string;
  instanceSha256: string;
  signatureManifestSha256: string;
  rendererVersion: string;
  fileName: string;
  contentType: 'application/pdf';
  sizeBytes: number;
  pdfSha256: string;
  finalisedAt: string;
  downloadUrl: string;
};

export type FieldWorkPackCalculatorOutput = {
  dependencyKey: string;
  outcomeClass:
    | 'tradable_certificate'
    | 'retailer_obligation_credit'
    | 'rebate'
    | 'grant'
    | 'loan'
    | 'project_credit'
    | 'tariff_only'
    | 'procurement_only';
  claimOutputCode:
    | 'STC'
    | 'LGC'
    | 'REGO'
    | 'ACCU'
    | 'VEEC'
    | 'ESC'
    | 'PRC'
    | 'EEIS_BENEFIT'
    | 'REPS_BENEFIT'
    | 'REBATE'
    | 'GRANT'
    | 'FINANCE'
    | 'TARIFF'
    | 'PROCUREMENT';
  claimOutputLabel: string;
  calculationRunId: string;
  caseRevision: number;
  calculatorVersionId: string;
  calculatorKey: string;
  calculatorVersion: number;
  calculatorSourceSha256: string;
  quantity: string;
  unit: string;
  outputSha256: string;
  executionReceiptSha256: string;
  engineReceiptId: string;
  engineContractSha256: string;
  goldenVectorSuiteSha256: string;
  engineSuiteReceiptSha256: string;
  verifiedByUid: string;
  verifiedAt: string;
};

export type FieldActivityWorkPack = {
  instance: {
    id: string;
    instanceKey: string;
    caseId: string;
    workOrderId: string;
    complianceIntentId: string;
    workPackVersionId: string;
    compositionLockId: string;
    compositionSha256: string;
    activityDate: string;
    revision: number;
    supersedesInstanceId: string;
    status: 'not_started' | 'in_progress' | 'ready_to_sign' | 'completed' | 'void';
    responseSha256: string;
    createdAt: string;
  };
  signatureBindings: {
    definitionSha256: string;
    prefillSha256: string;
    responseSha256: string;
    declarationsSha256: string;
  };
  signerBindings: FieldWorkPackSignerBinding[];
  definition: {
    id: string;
    title: string;
    activityVersionId: string;
    activityTemplateId: string;
    version: number;
    schemaSha256: string;
    effectiveFrom: string;
    effectiveTo: string;
    schema: FieldActivityWorkPackSchema;
  };
  response: FieldActivityWorkPackResponse;
  completion: FieldWorkPackCompletion;
  signatures: FieldWorkPackSignature[];
  artifacts: FieldWorkPackArtifact[];
  calculatorOutputs: FieldWorkPackCalculatorOutput[];
  calculatorPendingReviews: FieldWorkPackCalculatorPendingReview[];
  referenceDocuments: FieldWorkPackReferenceDocumentProjection[];
  finalRecord: FieldWorkPackFinalRecord | null;
  protectedCustomer: boolean;
  customerContextBinding: FieldWorkPackCustomerContextBinding;
  customerContext: FieldWorkPackCustomerContext;
  executionContext: {
    provider: FieldWorkPackProviderContext;
    installerBusiness: FieldWorkPackInstallerBusinessContext;
    assignment: FieldWorkPackAssignmentContext;
  };
  artifactHook: {
    contract: 'creditex-activity-work-pack-artifact-hook/v1';
    status: 'not_ready' | 'generation_required' | 'retained';
    finalisationSha256: string;
  };
};

export type FieldWorkPackCustomerContextBinding = {
  contract: 'creditex-activity-work-pack-customer-context/v1';
  editable: boolean;
  customerId: string;
  siteId: string;
  contactId: string;
  customerRevision: string;
  siteRevision: string;
  contactRevision: string;
  contextSha256: string;
};

export type FieldWorkPackCustomerContext = {
  editable: boolean;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: string;
  postcode: string;
  customerRevision: string;
  siteRevision: string;
  contactRevision: string;
};

export type FieldRentalInspectionSummary = {
  id: string;
  inspectionNumber: string;
  status: 'draft' | 'scheduled' | 'in_progress' | 'submitted' | 'issuing' | 'issued' | 'superseded' | 'withdrawn';
  templateKey: string;
  templateVersion: number;
  rulesEffectiveFrom: string;
  selectedModules: string[];
  assessorMemberId: string;
  revision: number;
  issuedReportId: string;
  issuedAt: string;
  progress: {
    completeModules: number;
    moduleTotal: number;
    savedItems: number;
    evidenceFiles: number;
  };
  permissions: {
    canEdit: boolean;
    canIssue: boolean;
  };
};

export type FieldJob = {
  id: string;
  workNumber: string;
  title: string;
  serviceCategory: string;
  siteArea: string;
  stage: JobStage;
  priority: string;
  scheduledStart: string;
  scheduledEnd: string;
  assigneeMemberId: string;
  assigneeLabel: string;
  protectedJob: boolean;
  customerName: string;
  customerPhone: string;
  serviceAddress: string;
  appointmentId: string;
  appointmentStatus: string;
  appointmentStartsAt: string;
  appointmentEndsAt: string;
  travelStartedAt: string;
  arrivedAt: string;
  workStartedAt: string;
  completedAt: string;
  description: string;
  openIssues: number;
  revision: number;
  updatedAt: string;
  recordMode?: 'regulated' | 'synthetic_test';
  fieldLane?: FieldAccessMode;
  offlinePolicy: {
    containsPersonalData: boolean;
    maxAgeSeconds: number;
    purgeWhenUnassigned: boolean;
  };
  tasks: FieldTask[];
  media: FieldMedia[];
  forms: FieldForm[];
  complianceIntents?: FieldComplianceIntent[];
  activityWorkPacks?: FieldActivityWorkPack[];
  complianceCases?: FieldJobCompliance[];
  compliance?: FieldJobCompliance;
  rentalInspection?: FieldRentalInspectionSummary;
};

export type SyncChange = {
  sequence: number;
  entityType: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  revision: number;
  changedAt?: string;
  entity?: FieldJob;
};

export type DevicePolicy = {
  minimumVersion?: string;
  latestVersion?: string;
  updateUrl?: string;
};

export type SyncResponse = {
  ok: boolean;
  contractVersion: number;
  bootstrap: boolean;
  serverTime: string;
  nextCursor: string;
  hasMore: boolean;
  changes: SyncChange[];
  devicePolicy?: DevicePolicy;
};

export type OfflineActionType = 'advance_field_job' | 'set_job_stage'
  | 'set_task_status' | 'add_time_entry' | 'save_job_form'
  | 'work_pack_commit' | 'work_pack_prepare_signing'
  | 'work_pack_capture_signatures'
  | 'work_pack_update_customer_context'
  | 'work_pack_select_scenario'
  | 'work_pack_select_official_products'
  | 'work_pack_run_calculator'
  | 'work_pack_finalize';

export type FieldWorkPackSectionPatch = {
  sectionKey: string;
  repeatInstanceKey: string;
  remove: boolean;
  answers: Record<string, unknown>;
};

export type FieldWorkPackArtifactLink = {
  sectionKey: string;
  repeatInstanceKey: string;
  promptKey: string;
  clientUploadId: string;
  deviceId: string;
};

export type FieldWorkPackReferenceAcknowledgementInput = {
  sectionKey: string;
  repeatInstanceKey: string;
  promptKey: string;
  sourceArtifactId: string;
  acknowledgedAt: string;
};

export type FieldWorkPackSignaturePacket = {
  sectionKey: string;
  repeatInstanceKey: string;
  promptKey: string;
  clientUploadId: string;
  signerIdentity: FieldWorkPackSignerIdentity;
  signerIdentitySha256: string;
  attestation: FieldWorkPackSignatureAttestation;
  attestationSha256: string;
  deviceAttestation: FieldWorkPackDeviceAttestation;
  deviceAttestationSha256: string;
  signatureSha256: string;
  signaturePayloadSha256: string;
  signaturePayload: FieldWorkPackSignaturePayload;
};

export type OfflineAction = {
  clientActionId: string;
  fieldLane?: FieldAccessMode;
  type: OfflineActionType;
  workOrderId: string;
  taskId?: string;
  formId?: string;
  baseRevision: number;
  stage?: JobStage;
  transition?: 'start_travel' | 'arrive' | 'start_work' | 'finish';
  status?: TaskStatus;
  workDate?: string;
  durationMinutes?: number;
  notes?: string;
  answers?: Record<string, string | boolean>;
  complete?: boolean;
  caseInstanceId?: string;
  expectedResponseSha256?: string;
  dependencyKey?: string;
  scenarioCode?: string;
  selections?: FieldWorkPackOfficialProductSelection[];
  sectionPatches?: FieldWorkPackSectionPatch[];
  dependencyResolutions?: Record<string, FieldWorkPackDependencyResolution>;
  artifactLinks?: FieldWorkPackArtifactLink[];
  referenceAcknowledgements?: FieldWorkPackReferenceAcknowledgementInput[];
  signaturePackets?: FieldWorkPackSignaturePacket[];
  baseCustomerRevision?: string;
  baseSiteRevision?: string;
  baseContactRevision?: string;
  customerContextBinding?: FieldWorkPackCustomerContextBinding;
  customerPatch?: Partial<Pick<FieldWorkPackCustomerContext, 'firstName' | 'lastName'>>;
  sitePatch?: Partial<Pick<FieldWorkPackCustomerContext,
    'addressLine1' | 'addressLine2' | 'suburb' | 'state' | 'postcode'>>;
  contactPatch?: Partial<Pick<FieldWorkPackCustomerContext, 'phone' | 'email'>>;
};

export type QueueRow = {
  id: string;
  work_order_id: string;
  field_lane: FieldAccessMode;
  payload: string;
  status: 'queued' | 'retry' | 'conflict' | 'rejected';
  attempts: number;
  error_code: string;
  error_message: string;
  created_at: string;
};

export type UploadRow = {
  id: string;
  work_order_id: string;
  field_lane: FieldAccessMode;
  client_upload_id: string;
  local_uri: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  category: string;
  caption: string;
  evidence_envelope: string;
  session_id: string;
  uploaded_parts: string;
  status: 'queued' | 'uploading' | 'retry' | 'completed' | 'rejected';
  attempts: number;
  error_message: string;
  created_at: string;
};

export type SyncState = {
  running: boolean;
  online: boolean;
  lastSyncedAt: string;
  queuedActions: number;
  queuedUploads: number;
  conflicts: number;
  updateRequired: string;
  message: string;
};
