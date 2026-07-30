import test from "node:test";
import assert from "node:assert/strict";
import {
  uploadCustomerProjectEvidence,
} from "../src/lib/customer-project-evidence-upload-client.ts";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("client resumes missing parts and waits for secure cleanup", async () => {
  const calls = [];
  const progress = [];
  let completeCalls = 0;
  const file = new File(
    [new Uint8Array(6 * 1024 * 1024)],
    "switchboard.jpg",
    { type: "image/jpeg" },
  );
  const evidence = {
    id: "evidence-1",
    category: "switchboard",
    captureSlot: "shared:switchboard",
    factKeys: ["switchboard"],
    sharingScope: "private-plan",
    fileName: "switchboard-evidence-1.jpg",
    contentType: "image/jpeg",
    sizeBytes: file.size,
    privacyStatus: "metadata-stripped",
    revision: 2,
    previewUrl: "/api/customer-project-evidence?preview=evidence-1",
    thumbnailUrl: "/api/customer-project-evidence?preview=evidence-1",
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (typeof init?.body === "string") {
      const body = JSON.parse(init.body);
      if (body.action === "initiate") {
        assert.equal(body.captureSlot, "shared:switchboard");
        assert.equal(body.replaceEvidenceId, "evidence-1");
        assert.equal(body.expectedEvidenceRevision, 1);
        return json({
          ok: true,
          upload: {
            id: "session-1",
            partSizeBytes: 5 * 1024 * 1024,
            totalParts: 2,
            uploadedBytes: 5 * 1024 * 1024,
            parts: [{ partNumber: 1, sizeBytes: 5 * 1024 * 1024 }],
            status: "uploading",
          },
        });
      }
      completeCalls += 1;
      return completeCalls === 1
        ? json({
            ok: true,
            cleanupPending: true,
            upload: {
              id: "session-1",
              partSizeBytes: 5 * 1024 * 1024,
              totalParts: 2,
              uploadedBytes: file.size,
              parts: [],
              status: "finalising",
            },
            evidence,
          }, 202)
        : json({
            ok: true,
            cleanupPending: false,
            upload: {
              id: "session-1",
              partSizeBytes: 5 * 1024 * 1024,
              totalParts: 2,
              uploadedBytes: file.size,
              parts: [],
              status: "completed",
            },
            evidence,
          });
    }
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("partNumber"), "2");
    assert.equal(init.body.get("file").size, 1024 * 1024);
    return json({
      ok: true,
      upload: {
        id: "session-1",
        partSizeBytes: 5 * 1024 * 1024,
        totalParts: 2,
        uploadedBytes: file.size,
        parts: [
          { partNumber: 1, sizeBytes: 5 * 1024 * 1024 },
          { partNumber: 2, sizeBytes: 1024 * 1024 },
        ],
        status: "uploading",
      },
    });
  };

  const result = await uploadCustomerProjectEvidence({
    token: "token",
    projectId: "project-1",
    candidate: {
      id: "client-upload-123",
      file,
      category: "switchboard",
      captureSlot: "shared:switchboard",
      factKeys: ["switchboard"],
      sharingScope: "private-plan",
      replaceEvidenceId: "evidence-1",
      expectedEvidenceRevision: 1,
    },
    confirmInstallerPhotoSharing: false,
    onProgress: (item) => progress.push(item),
    fetchImpl,
  });

  assert.deepEqual(result, evidence);
  assert.equal(
    calls.filter((call) => call.init?.body instanceof FormData).length,
    1,
  );
  assert.equal(completeCalls, 2);
  assert.equal(progress.at(-1).status, "finalising");
  assert.equal(progress.at(-1).progress, 100);
});
