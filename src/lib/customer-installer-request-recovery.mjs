function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function installerContactFingerprint(contact) {
  return JSON.stringify([
    clean(contact?.phone),
    clean(contact?.addressLine1),
    clean(contact?.addressLine2),
    clean(contact?.suburb),
  ]);
}

export function installerRequestFingerprint(
  contact,
  confirmInstallerPhotoSharing,
) {
  return JSON.stringify([
    installerContactFingerprint(contact),
    Boolean(confirmInstallerPhotoSharing),
  ]);
}

export function canRecoverInstallerRequest(attempt, current) {
  return Boolean(
    attempt
    && attempt.projectId === current.projectId
    && attempt.planRevision === current.planRevision
    && attempt.editGeneration === current.editGeneration
    && attempt.requestFingerprint === current.requestFingerprint,
  );
}

export function canUpdateReplayedCustomerDraft(project) {
  return Boolean(
    project
    && project.status === "draft"
    && project.planRevision === 1
    && project.createdAt === project.updatedAt,
  );
}

export function isProvenInstallerProfileRevisionConflict(
  result,
  latestProfile,
  attemptedUpdatedAt,
) {
  const conflictUpdatedAt = clean(result?.updatedAt);
  const latestUpdatedAt = clean(latestProfile?.updatedAt);
  return Boolean(
    Number(result?.status) === 409
    && result?.code === "PROFILE_REVISION_CONFLICT"
    && conflictUpdatedAt
    && conflictUpdatedAt !== clean(attemptedUpdatedAt)
    && latestUpdatedAt === conflictUpdatedAt,
  );
}

export async function saveInstallerRequestProfileWithOneConflictRetry({
  contact,
  expectedUpdatedAt,
  save,
  loadLatest,
}) {
  const firstResult = await save(expectedUpdatedAt, contact);
  if (firstResult?.ok) {
    return {
      result: firstResult,
      latestProfile: null,
      retried: false,
    };
  }

  if (
    Number(firstResult?.status) !== 409
    || firstResult?.code !== "PROFILE_REVISION_CONFLICT"
  ) {
    return {
      result: firstResult,
      latestProfile: null,
      retried: false,
    };
  }

  const latestProfile = await loadLatest();
  if (
    !isProvenInstallerProfileRevisionConflict(
      firstResult,
      latestProfile,
      expectedUpdatedAt,
    )
  ) {
    return {
      result: firstResult,
      latestProfile,
      retried: false,
    };
  }

  const retryResult = await save(latestProfile.updatedAt, contact);
  return {
    result: retryResult,
    latestProfile,
    retried: true,
  };
}
