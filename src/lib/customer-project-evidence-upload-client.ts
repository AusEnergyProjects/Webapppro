export type CustomerEvidenceUploadCandidate = {
  id: string;
  file: File;
  category: string;
  captureSlot: string;
  factKeys: string[];
  sharingScope: "private-plan" | "allocated-installers";
  replaceEvidenceId?: string;
  expectedEvidenceRevision?: number;
};

export type CustomerEvidenceUploadProgress = {
  status: "queued" | "uploading" | "finalising" | "failed";
  progress: number;
  error?: string;
};

export type CustomerEvidenceUploadRecord = {
  id: string;
  category: string;
  captureSlot: string;
  factKeys: string[];
  sharingScope: "private-plan" | "allocated-installers";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  privacyStatus: string;
  revision: number;
  previewUrl: string;
  thumbnailUrl: string;
  createdAt: string;
  updatedAt: string;
};

type UploadSession = {
  id: string;
  partSizeBytes: number;
  totalParts: number;
  uploadedBytes: number;
  parts: Array<{ partNumber: number; sizeBytes: number }>;
  status: string;
};

type UploadResponse = {
  ok?: boolean;
  error?: string;
  cleanupPending?: boolean;
  upload?: UploadSession;
  evidence?: CustomerEvidenceUploadRecord;
};

const COMPLETE_ATTEMPTS = 8;

async function readUploadResponse(response: Response) {
  const result = await response.json().catch(() => ({})) as UploadResponse;
  if (!response.ok || !result.ok) {
    throw new Error(result.error || "The photo upload could not be completed.");
  }
  return result;
}

export async function uploadCustomerProjectEvidence(
  {
    token,
    projectId,
    candidate,
    confirmInstallerPhotoSharing,
    onProgress,
    fetchImpl = fetch,
  }: {
    token: string;
    projectId: string;
    candidate: CustomerEvidenceUploadCandidate;
    confirmInstallerPhotoSharing: boolean;
    onProgress?: (progress: CustomerEvidenceUploadProgress) => void;
    fetchImpl?: typeof fetch;
  },
) {
  onProgress?.({ status: "queued", progress: 0 });
  const initiateResponse = await fetchImpl(
    "/api/customer-project-evidence/uploads",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "initiate",
        projectId,
        clientUploadId: candidate.id,
        contentType: candidate.file.type,
        sizeBytes: candidate.file.size,
        category: candidate.category,
        captureSlot: candidate.captureSlot,
        factKeys: candidate.factKeys,
        sharingScope: candidate.sharingScope,
        confirmInstallerPhotoSharing:
          candidate.sharingScope === "allocated-installers"
          && confirmInstallerPhotoSharing,
        ...(candidate.replaceEvidenceId
          ? {
              replaceEvidenceId: candidate.replaceEvidenceId,
              expectedEvidenceRevision: candidate.expectedEvidenceRevision,
            }
          : {}),
      }),
    },
  );
  let result = await readUploadResponse(initiateResponse);
  if (result.evidence && result.upload?.status === "completed") {
    onProgress?.({ status: "finalising", progress: 100 });
    return result.evidence;
  }
  if (!result.upload) {
    throw new Error("The secure upload session could not be started.");
  }

  const session = result.upload;
  const completedParts = new Set(
    session.parts.map((part) => part.partNumber),
  );
  let uploadedBytes = session.uploadedBytes;
  for (let partNumber = 1; partNumber <= session.totalParts; partNumber += 1) {
    if (completedParts.has(partNumber)) continue;
    const start = (partNumber - 1) * session.partSizeBytes;
    const end = Math.min(candidate.file.size, start + session.partSizeBytes);
    const form = new FormData();
    form.set("action", "upload_part");
    form.set("sessionId", session.id);
    form.set("partNumber", String(partNumber));
    form.set(
      "file",
      candidate.file.slice(start, end, candidate.file.type),
      candidate.file.name,
    );
    result = await readUploadResponse(
      await fetchImpl("/api/customer-project-evidence/uploads", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      }),
    );
    uploadedBytes = Math.max(
      uploadedBytes + (end - start),
      result.upload?.uploadedBytes || 0,
    );
    onProgress?.({
      status: "uploading",
      progress: Math.min(99, (uploadedBytes / candidate.file.size) * 100),
    });
  }

  onProgress?.({ status: "finalising", progress: 100 });
  for (let attempt = 0; attempt < COMPLETE_ATTEMPTS; attempt += 1) {
    result = await readUploadResponse(
      await fetchImpl("/api/customer-project-evidence/uploads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "complete", sessionId: session.id }),
      }),
    );
    if (!result.cleanupPending && result.evidence) return result.evidence;
    if (attempt < COMPLETE_ATTEMPTS - 1) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
    }
  }
  throw new Error(
    "The photo is saved and is still finishing its private cleanup. Select Save changes to check it again.",
  );
}
