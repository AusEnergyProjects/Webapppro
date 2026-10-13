import test from 'node:test';
import assert from 'node:assert/strict';
import { safetyCheckEmailDraft } from '../src/lib/safety-check-email.ts';

const input = () => ({ businessName: 'Example Trades', recordNumber: 'TSC-EXAMPLE', title: 'Electrical safety check',
  propertyAddress: 'Example property', inspectionDate: '13 October 2026', inspectorName: 'Example Inspector',
  photoCount: 2, businessEmail: 'example@example.test', businessPhone: 'Example phone' });

test('completion email identifies the business and saved inspection with PDF and photo attachment wording', () => {
  const draft = safetyCheckEmailDraft(input());
  assert.equal(draft.subject, 'Electrical safety check | TSC-EXAMPLE');
  for (const value of ['Example Trades', 'Example property', 'Example Inspector', '13 October 2026']) {
    assert.ok(draft.body.includes(value)); assert.ok(draft.html.includes(value));
  }
  assert.match(draft.body, /PDF is attached, with 2 evidence photos/);
  assert.match(draft.html, /alt="TLink"/);
  assert.doesNotMatch(draft.body, /compliant|safe to proceed|guaranteed|successfully delivered/i);
});
test('single and zero photo counts accurately describe the actual attachments', () => {
  assert.match(safetyCheckEmailDraft({ ...input(), photoCount: 1 }).body, /1 evidence photo\./);
  assert.doesNotMatch(safetyCheckEmailDraft({ ...input(), photoCount: 0 }).body, /evidence photo/);
  assert.match(safetyCheckEmailDraft({ ...input(), supportingDocumentCount: 1 }).body, /1 supporting document\./);
});
test('HTML escapes business, property, recorded findings and contact data', () => {
  const draft = safetyCheckEmailDraft({ ...input(), businessName: '<img onerror="bad">', propertyAddress: '<script>bad</script>',
    outcome: 'Needs attention <script>bad</script>', actionRequired: '<b>Recorded action</b>', businessEmail: '<img src="bad">' });
  assert.doesNotMatch(draft.html, /<script>|onerror="bad"|<b>Recorded action<\/b>|src="bad"/);
  assert.match(draft.html, /&lt;script&gt;/); assert.match(draft.body, /Needs attention/);
});
test('email subject cannot introduce additional mail headers', () => {
  const draft = safetyCheckEmailDraft({ ...input(), recordNumber: 'TSC\r\nBcc: bad', title: 'Check\u0000\nMore' });
  assert.doesNotMatch(draft.subject, /[\r\n\u0000]/);
});
test('an unsafe recorded finding is visually urgent without inventing corrective work', () => {
  const draft = safetyCheckEmailDraft({ ...input(), outcome: 'Unsafe', attention: 'urgent',
    actionRequired: 'Contact the inspecting gasfitter immediately about the recorded fault and actions.' });
  assert.match(draft.html, /URGENT RECORDED FINDING/);
  assert.match(draft.html, /background:#fff0ee/);
  assert.match(draft.body, /Contact the inspecting gasfitter immediately/);
  assert.doesNotMatch(draft.body, /disconnected|repaired|made safe/);
});
test('invalid record identities and attachment counts are rejected rather than fabricating completion copy', () => {
  for (const change of [{businessName:''},{recordNumber:''},{title:''},{photoCount:-1},{photoCount:1.5},{photoCount:NaN},{supportingDocumentCount:-1}]) {
    assert.throws(() => safetyCheckEmailDraft({ ...input(), ...change }), /CONTENT_INVALID/);
  }
});
