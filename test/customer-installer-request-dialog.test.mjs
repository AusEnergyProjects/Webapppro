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
  assert.match(dialog, /projectPhotoCount: number/);
  assert.match(dialog, /export type CustomerInstallerRequestProgress/);
  assert.match(dialog, /phase: "checking-previous-request" \| "saving-plan" \| "sending-request"/);
  assert.match(dialog, /phase: "securing-photo"/);
  assert.match(
    dialog,
    /onSubmit: \(\s*contact: CustomerInstallerRequestContact,\s*confirmAllProjectPhotoSharing: boolean,\s*onProgress: \(progress: CustomerInstallerRequestProgress\) => void,\s*\) => Promise<string \| void>/s,
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
  assert.doesNotMatch(dialog, /CustomerInstallerRequestProfileConflictError/);
  assert.doesNotMatch(dialog, /setContact\(caught\.contact\)/);
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

test("the complete safe plan and current photos need one explicit confirmation", () => {
  assert.match(dialog, /if \(!confirmAllProjectPhotoSharing\)/);
  assert.match(dialog, /ref=\{evidenceRef\}/);
  assert.match(dialog, /type="checkbox"/);
  assert.match(
    dialog,
    /privacy-safe generated plan and all \$\{projectPhotoCount\}/,
  );
  assert.match(
    dialog,
    /There are currently no project photos to share/,
  );
  assert.match(
    dialog,
    /Other uploaded documents stay private unless I already\s*marked them for installer sharing/,
  );
  assert.match(
    dialog,
    /onSubmit\(\s*result\.contact,\s*confirmAllProjectPhotoSharing,\s*setProgress,/,
  );
});

test("missing sharing consent is visible and focused beside the sticky submit action", () => {
  const stickyFooterStart = dialog.indexOf(
    "<footer className={styles.actions}>",
  );
  const consentStart = dialog.indexOf(
    "className={`${styles.evidenceConfirmation} ${styles.actionConsent}`}",
  );
  const consentErrorStart = dialog.indexOf("id={formErrorId}");
  const submitActionStart = dialog.indexOf(
    "Save details and request responses",
  );

  assert.ok(stickyFooterStart >= 0);
  assert.ok(consentStart > stickyFooterStart);
  assert.ok(consentErrorStart > consentStart);
  assert.ok(submitActionStart > consentErrorStart);
  assert.equal(
    [...dialog.matchAll(/styles\.evidenceConfirmation/g)].length,
    1,
  );
  assert.match(
    dialog,
    /className=\{`\$\{styles\.evidenceConfirmation\} \$\{styles\.actionConsent\}`\}/,
  );
  assert.match(
    dialog,
    /my suburb, postcode and state,[\s\S]*privacy-safe generated plan/,
  );
  assert.match(
    dialog,
    /aria-describedby=\{\s*invalidField === "evidence"\s*\?\s*formErrorId\s*:\s*undefined\s*\}/,
  );
  assert.match(
    dialog,
    /aria-errormessage=\{\s*invalidField === "evidence"\s*\?\s*formErrorId\s*:\s*undefined\s*\}/,
  );
  assert.match(
    dialog,
    /result\.field === "suburb"[\s\S]*:\s*evidenceRef\.current;[\s\S]*target\?\.focus\(\)/,
  );
  assert.match(
    dialog,
    /if \(invalidField === "evidence"\) \{\s*setInvalidField\(""\);\s*setError\(""\);\s*\}/,
  );
  assert.match(
    dialog,
    /className=\{styles\.primaryButton\}\s*disabled=\{busy\}\s*type="submit"/,
  );
  assert.match(styles, /\.actions \{[\s\S]*position: sticky/);
  assert.match(styles, /\.actionConsent \{[\s\S]*grid-column: 1 \/ -1/);
  assert.match(styles, /\.actionError \{[\s\S]*grid-column: 1 \/ -1/);
});

test("installer request dialog traps focus, blocks busy dismissal and restores focus", () => {
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
  assert.match(dialog, /const dismissible = !busy && !complete/);
  assert.match(dialog, /disabled=\{busy\}/);
  assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);
  assert.match(dialog, /returnTarget\?\.isConnected/);
  assert.match(dialog, /returnTarget\.focus\(\)/);
  assert.match(dialog, /if \(!complete\) return/);
  assert.match(dialog, /submitButtonRef\.current\?\.focus\(\)/);
  assert.match(dialog, /!initialContact\.phone\.trim\(\)/);
  assert.match(dialog, /!initialContact\.addressLine1\.trim\(\)/);
  assert.match(dialog, /!initialContact\.suburb\.trim\(\)/);
});

test("installer request dialog reports truthful staged and delayed progress", () => {
  assert.match(dialog, /setProgress\(\{ phase: "checking-previous-request" \}\)/);
  assert.match(dialog, /phase === "saving-plan"/);
  assert.match(dialog, /Securing photo \$\{progress\.current\} of \$\{progress\.total\}/);
  assert.match(dialog, /: "Sending your request"/);
  assert.match(dialog, /window\.setTimeout\(\(\) => setDelayLevel\(1\), 8_000\)/);
  assert.match(dialog, /window\.setTimeout\(\(\) => setDelayLevel\(2\), 25_000\)/);
  assert.match(dialog, /Please do not submit it again/);
  assert.match(dialog, /role="progressbar"/);
  assert.match(dialog, /aria-valuenow=/);
  assert.match(dialog, /progress\.phase === "securing-photo"/);
  assert.match(dialog, /aria-busy=\{busy\}/);
  assert.match(styles, /\.progressRegion/);
  assert.match(styles, /\.progressTrack\.indeterminate/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("installer request dialog remains compact and touch friendly", () => {
  assert.match(styles, /border-radius: 1\.4rem/);
  assert.match(styles, /max-width: 39rem/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /min-height: 2\.8rem/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(styles, /border-radius: 1\.35rem 1\.35rem 0 0/);
  assert.match(styles, /calc\(100dvh - 1rem\)/);
  assert.match(
    styles,
    /grid-template-columns: minmax\(5\.5rem, 0\.65fr\) minmax\(0, 1\.35fr\)/,
  );
  for (const field of ["phone", "addressLine1", "suburb"]) {
    assert.match(
      dialog,
      new RegExp(
        `aria-describedby=\\{\\s*invalidField === "${field}"[\\s\\S]*?formErrorId`,
      ),
    );
  }
});
