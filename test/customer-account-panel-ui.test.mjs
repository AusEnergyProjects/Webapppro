import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const accountPanel = read("../src/components/FirebaseAccountPanel.tsx");
const styles = read("../src/app/globals.css");

test("email account choices are equal, responsive and expose their selected state", () => {
  assert.match(accountPanel, /role="group" aria-label="Choose an email account action"/);
  assert.equal(accountPanel.match(/aria-controls=\{emailFormId\}/g)?.length, 2);
  assert.match(accountPanel, /aria-pressed=\{mode === "create"\}/);
  assert.match(accountPanel, /aria-pressed=\{mode === "signin"\}/);
  assert.match(
    styles,
    /\.customer-auth-tabs \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*width: 100%;[^}]*\}/,
  );
  assert.match(
    styles,
    /\.customer-auth-tabs button \{[^}]*align-items: center;[^}]*justify-content: center;[^}]*min-width: 0;[^}]*width: 100%;[^}]*\}/,
  );
  assert.match(
    styles,
    /\.customer-auth-tabs button\.selected \{[^}]*background: #08794c;[^}]*color: #fff;[^}]*\}/,
  );
});

test("password input has a visible full-size control and persistent requirements", () => {
  assert.match(accountPanel, /id=\{passwordInputId\} required type="password" minLength=\{8\}/);
  assert.match(accountPanel, /aria-describedby=\{\[passwordHelpId, fieldErrorDescription\("password"\)\]/);
  assert.match(accountPanel, /className="customer-auth-field-help" id=\{passwordHelpId\}>Use at least eight characters\.<\/p>/);
  assert.match(
    styles,
    /\.customer-email-form \.field-control > input \{[^}]*display: block;[^}]*min-height: 48px;[^}]*width: 100%;[^}]*\}/,
  );
});

test("labels, help and validation errors remain programmatically associated", () => {
  assert.match(accountPanel, /id=\{nameInputId\} required type="text"/);
  assert.match(accountPanel, /id=\{emailInputId\} required type="email"/);
  assert.equal(accountPanel.match(/aria-invalid=\{invalidField === /g)?.length, 3);
  assert.match(accountPanel, /aria-describedby=\{fieldErrorDescription\("email"\)\}/);
  assert.match(accountPanel, /role=\{statusTone === "error" \? "alert" : "status"\} aria-atomic="true"/);
  assert.match(styles, /\.customer-email-form \.field-control > input\[aria-invalid="true"\]/);
  assert.match(styles, /\.customer-auth-status\.error/);
});
