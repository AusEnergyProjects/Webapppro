import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import test from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { createServer } from "vite";

const HASH = `sha256:${"a".repeat(64)}`;

async function templatePdf() {
  const document = await PDFDocument.create();
  document.setTitle("Governed activity form template");
  document.setCreationDate(new Date("2026-08-15T00:00:00.000Z"));
  document.setModificationDate(new Date("2026-08-15T00:00:00.000Z"));
  const page = document.addPage([595, 842]);
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  page.drawText("GOVERNED ACTIVITY FORM", { x: 54, y: 785, size: 14, font });
  return document.save({ useObjectStreams: false, addDefaultPage: false });
}

function placement(overrides) {
  return {
    placementKey: "field",
    kind: "text",
    sourcePath: "/prefill/customerSnapshot/fullName",
    signaturePromptKey: "",
    signerRoleKey: "",
    pageIndex: 0,
    x: 0.1,
    y: 0.15,
    width: 0.8,
    height: 0.06,
    fontFamily: "helvetica",
    fontSize: 11,
    minimumFontSize: 6,
    overflow: "shrink",
    maximumLines: 1,
    textFormat: "text",
    ...overrides,
  };
}

test("the server renderer deterministically embeds Unicode context and visible signature strokes", async () => {
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
  });
  try {
    const renderer = await vite.ssrLoadModule(
      "/src/lib/creditex-activity-work-pack-pdf-renderer.ts",
    );
    const signaturePayload = {
      contract: "creditex-activity-work-pack-signature-payload/v1",
      instanceKey: "instance-key",
      caseInstanceId: "case-instance",
      promptKey: "customer-signature",
      signerRoleKey: "customer",
      signerName: "José 王",
      signerCapacity: "Authorised customer",
      signerIdentitySha256: HASH,
      attestationSha256: HASH,
      definitionSha256: HASH,
      prefillSha256: HASH,
      responseSha256: HASH,
      declarationsSha256: HASH,
      strokes: [{ points: [
        { x: 0.05, y: 0.8, pressure: 0.5, capturedAtOffsetMs: 0 },
        { x: 0.28, y: 0.2, pressure: 0.6, capturedAtOffsetMs: 20 },
        { x: 0.58, y: 0.7, pressure: 0.5, capturedAtOffsetMs: 40 },
        { x: 0.92, y: 0.25, pressure: 0.4, capturedAtOffsetMs: 60 },
      ] }],
      signedAt: "2026-08-15T10:11:12.000Z",
    };
    const input = {
      templateBytes: await templatePdf(),
      output: {
        outputKey: "completed-form",
        title: "Completed governed form",
        sourceBindingTargetKey: "approved-form-template",
        rendererVersion: "1.0.0",
        required: true,
        placements: [
          placement({ placementKey: "customer-name" }),
          placement({
            placementKey: "customer-signature",
            kind: "signature",
            sourcePath: "",
            signaturePromptKey: "customer-signature",
            signerRoleKey: "customer",
            x: 0.1,
            y: 0.62,
            width: 0.42,
            height: 0.12,
          }),
          placement({
            placementKey: "customer-signer-name",
            sourcePath:
              "/signatures/customer-signature/customer/signerName",
            x: 0.1,
            y: 0.75,
            width: 0.42,
          }),
          placement({
            placementKey: "customer-signed-date",
            sourcePath: "/signatures/customer-signature/customer/signedAt",
            textFormat: "date_au",
            x: 0.58,
            y: 0.75,
            width: 0.25,
          }),
        ],
      },
      context: {
        prefill: { customerSnapshot: { fullName: "José 王" } },
        response: { answers: {} },
        declarations: {},
      },
      signatures: [{
        promptKey: "customer-signature",
        signerRoleKey: "customer",
        signerName: "José 王",
        signerCapacity: "Authorised customer",
        signedAt: signaturePayload.signedAt,
        payload: signaturePayload,
      }],
    };
    const first = await renderer.renderCreditexActivityWorkPackPdf(input);
    const second = await renderer.renderCreditexActivityWorkPackPdf(input);
    assert.deepEqual(first.bytes, second.bytes);
    assert.equal(first.rendererVersion, "1.0.0");
    assert.equal(first.rendererContract,
      "creditex-activity-work-pack-pdf-renderer/v1");
    assert.equal(
      createHash("sha256").update(first.bytes).digest("hex"),
      createHash("sha256").update(second.bytes).digest("hex"),
    );
    const completed = await PDFDocument.load(first.bytes);
    assert.equal(completed.getPageCount(), 1);
    assert.ok(first.bytes.byteLength > input.templateBytes.byteLength + 10_000);
    if (process.env.CREDITEX_WORK_PACK_RENDER_OUTPUT) {
      await fs.writeFile(process.env.CREDITEX_WORK_PACK_RENDER_OUTPUT, first.bytes);
    }
  } finally {
    await vite.close();
  }
});
