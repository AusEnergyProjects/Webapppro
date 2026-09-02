const GIT_COMMIT_SHA = /^[a-f0-9]{40}$/;

export function releaseIdentityFromEnvironment(environment) {
  const releaseId = String(environment?.AEA_RELEASE_SHA || "").trim().toLowerCase();
  return GIT_COMMIT_SHA.test(releaseId) ? releaseId : "";
}
