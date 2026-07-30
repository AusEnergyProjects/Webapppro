import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dialog = read("../src/components/CustomerInstallerRequestDialog.tsx");
const styles = read(
  "../src/components/CustomerInstallerRequestDialog.module.css",
);

test("installer request dialog exposes one reusable, typed request contract", () => {
  assert.match(dialog, /export type CustomerInstallerRequestContact/);
  assert.match(dialog, /phone: string/);
  assert.match(dialog, /addressLine1: string/);
  assert.match(dialog, /addressLine2: string/);
  assert.match(dialog, /suburb: string/);
  assert.match(dialog, /export type CustomerInstallerRequestDialogProps/);
  assert.match(dialog, /open: boolean/);
  assert.match(dialog, /initialContact: CustomerInstallerRequestContact/);
  assert.match(dialog, /projectPostcode: string/);
  assert.match(dialog, /projectState: string/);
  assert.match(
    dialog,
    /installerEvidenceConfirmationRequired\?: boolean/,
  );
  assert.match(
    dialog,
    /onSubmit: \(\s*contact: CustomerInstallerRequestContact,\s*confirmInstallerPhotoSharing: boolean,\s*\) => Promise<string \| void>/s,
  );
  assert.match(dialog, /onComplete: \(\) => void/);
});

test("installer request dialog keeps contact completion private and inline", () => {
  assert.match(dialog, /saved to your private profile/);
  assert.match(dialog, /Private during matching/);
  assert.match(
    dialog,
    /Installers cannot see your name, phone number or street\s*address/,
  );
  assert.match(dialog, /role="alert"/);
  assert.match(dialog, /errorMessage\(caught\)/);
  assert.match(dialog, /setComplete\(true\)/);
  assert.match(dialog, /const nextCompletionMessage = await onSubmit\(/);
  assert.match(dialog, /setCompletionMessage\(nextCompletionMessage\)/);
  assert.match(dialog, /\{completionMessage\}/);
  assert.match(dialog, /Back to overview/);
  assert.match(dialog, /onClick=\{onComplete\}/);
  assert.match(dialog, /Save details and request responses/);
  assert.match(
    dialog,
    /export class CustomerInstallerRequestProfileConflictError extends Error/,
  );
  assert.match(
    dialog,
    /caught instanceof CustomerInstallerRequestProfileConflictError[\s\S]{0,100}setContact\(caught\.contact\)/,
  );
  assert.match(dialog, /submittingRef\.current \|\| busy/);
  assert.match(dialog, /submittingRef\.current = true/);
  assert.match(dialog, /disabled=\{busy\}/);
  assert.match(
    dialog,
    /useState<CustomerInstallerRequestContact>\(initialContact\)/,
  );
});

test("installer request dialog labels and validates all profile fields", () => {
  assert.match(dialog, /Phone number/);
  assert.match(dialog, /autoComplete="tel"/);
  assert.match(dialog, /Service street address/);
  assert.match(dialog, /autoComplete="address-line1"/);
  assert.match(dialog, /Unit, building or address detail/);
  assert.match(dialog, /autoComplete="address-line2"/);
  assert.match(dialog, /Suburb/);
  assert.match(dialog, /autoComplete="address-level2"/);
  assert.match(dialog, /Project postcode/);
  assert.match(dialog, /autoComplete="postal-code"/);
  assert.match(dialog, /State or territory/);
  assert.match(dialog, /aria-readonly="true"/);
  assert.match(dialog, /readOnly/);
  assert.match(dialog, /phonePattern\.test/);
  assert.match(dialog, /aria-invalid=\{invalidField === "phone"\}/);
  assert.match(dialog, /aria-invalid=\{invalidField === "addressLine1"\}/);
  assert.match(dialog, /aria-invalid=\{invalidField === "suburb"\}/);
});

test("installer evidence needs an explicit confirmation only when required", () => {
  assert.match(
    dialog,
    /installerEvidenceConfirmationRequired &&\s*!confirmInstallerPhotoSharing/s,
  );
  assert.match(
    dialog,
    /installerEvidenceConfirmationRequired && \(/,
  );
  assert.match(dialog, /ref=\{evidenceRef\}/);
  assert.match(dialog, /type="checkbox"/);
  assert.match(
    dialog,
    /photos and documents I selected for\s*quoting can be shared with matched installers/,
  );
  assert.match(
    dialog,
    /onSubmit\(\s*result\.contact,\s*confirmInstallerPhotoSharing,\s*\)/,
  );
});

test("installer request dialog traps focus and restores the request control", () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /aria-labelledby=\{titleId\}/);
  assert.match(dialog, /aria-describedby=\{descriptionId\}/);
  assert.match(dialog, /aria-busy=\{busy\}/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /event\.shiftKey/);
  assert.match(dialog, /querySelectorAll<HTMLElement>/);
  assert.match(dialog, /event\.currentTarget === event\.target && dismissible/);
  assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);
  assert.match(dialog, /returnTarget\?\.isConnected/);
  assert.match(dialog, /returnTarget\.focus\(\)/);
  assert.match(dialog, /if \(!complete\) return/);
  assert.match(dialog, /submitButtonRef\.current\?\.focus\(\)/);
  assert.match(dialog, /!initialContact\.phone\.trim\(\)/);
  assert.match(dialog, /!initialContact\.addressLine1\.trim\(\)/);
  assert.match(dialog, /!initialContact\.suburb\.trim\(\)/);
});

test("installer request dialog remains compact and touch friendly", () => {
  assert.match(styles, /border-radius: 1\.4rem/);
  assert.match(styles, /max-width: 39rem/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /min-height: 2\.8rem/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(styles, /border-radius: 1\.35rem 1\.35rem 0 0/);
});
