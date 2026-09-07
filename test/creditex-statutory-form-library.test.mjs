import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import veu from "../src/data/creditex-veu-statutory-forms.json" with { type: "json" };
import { creditexDeclarationText, creditexStatutorySourceLibrary, nationalCreditexDeclarationPiece } from "../src/lib/creditex-statutory-form-library.ts";
import national from "../src/data/creditex-national-declarations.json" with { type: "json" };

test("all six VEU source variants retain every mapped question and four separate signing purposes", () => {
  const library = creditexStatutorySourceLibrary();
  for (const source of veu.forms) {
    const form = library.find((item) => item.id === source.id);
    assert.ok(form);
    assert.equal(form.groups.reduce((n, group) => n + group.fields.length, 0), source.groups.reduce((n, group) => n + group.prompts.length, 0));
    assert.equal(form.declarations.length, 4);
    assert.equal(form.declarations.filter((item) => item.timing === "before_work").length, 2);
    assert.equal(form.declarations.filter((item) => item.timing === "after_installation").length, 2);
    assert.equal(form.sources[0].sha256, source.sha256);
  }
  assert.equal(library.filter((item) => item.program === "VEU").length, 6);
});

test("Creditex binding changes only explicit AP-name placeholders and preserves exact statutory text", () => {
  for (const source of veu.forms) for (const declaration of source.declarations) {
    const bound = creditexDeclarationText(declaration);
    const expected = declaration.canonicalText
      .replaceAll("<insert name of accredited person>", "CREDITEX PTY LTD")
      .replaceAll("<name of accredited person>", "CREDITEX PTY LTD");
    assert.equal(bound.text, expected);
    assert.equal(bound.creditexTextSha256, createHash("sha256").update(expected).digest("hex"));
  }
  assert.doesNotMatch(JSON.stringify(creditexStatutorySourceLibrary()), /dataforce/i);
});

test("modified statutory text cannot retain the original verified declaration hash", () => {
  const declaration = veu.forms[0].declarations[0];
  assert.throws(() => creditexDeclarationText({ ...declaration, canonicalText: declaration.canonicalText + " Extra condition." }), /retained text hash/);
  assert.throws(() => creditexDeclarationText({ ...declaration, permittedPlaceholderBindings: { "I declare": "otherProvider.name" } }), /Unsupported statutory provider binding/);
});

test("national text retains exact source hashes, actual signer roles and conditional alternatives", () => {
  for (const declaration of national.declarations) for (const section of declaration.sections) {
    for (const variant of section.variants || [section]) for (const piece of variant.pieces) {
      const bound = nationalCreditexDeclarationPiece(piece);
      assert.equal(bound.sourceTextSha256, createHash("sha256").update(piece.verbatimText).digest("hex"));
      assert.throws(() => nationalCreditexDeclarationPiece({ ...piece, templateText: piece.templateText + " Changed." }), /retained text hash/);
      if (piece.templateText.includes("{{retailer.legal_name}}")) assert.match(bound.text, /\{\{retailer\.legal_name\}\}/);
      if (piece.templateText.includes("{{creditex.sres.legal_name}}")) assert.match(bound.text, /CREDITEX PTY LTD/);
    }
  }
  const forms = creditexStatutorySourceLibrary();
  const bess2 = forms.find((form) => form.id === "pdrs_bess2");
  assert.equal(bess2.declarations.filter((piece) => piece.condition).length, 2);
  assert.ok(bess2.authoringRequirements.some((note) => /single page\/webpage/.test(note)));
  for (const form of forms.filter((form) => ["sres_swh", "sres_ashp"].includes(form.id))) {
    assert.equal(form.declarations.length, 0, "Historical ten-year wording must not become a current assignment");
    assert.ok(form.authoringRequirements.some((note) => /five.year/.test(note)));
  }
  assert.doesNotMatch(JSON.stringify(forms), /dataforce/i);
});
