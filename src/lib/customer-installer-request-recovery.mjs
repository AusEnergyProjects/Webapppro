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
