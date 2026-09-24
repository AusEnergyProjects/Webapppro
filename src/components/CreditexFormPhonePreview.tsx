"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ActivityAnswer, ActivityAnswers, ActivityField, ActivityForm } from "@/lib/trade-activity-form-types";
import { activityFieldWorkerForm } from "@/lib/trade-activity-field-policy";
import {
  activityBaseFieldKey, activityOptionLabel, activityRepeatCount, activityRepeatItemLabel, activityRepeatKey,
  activityWizardPageForStepKey, activityWizardPages, boundActivityDeclaration,
  removeLastActivityRepeat, streamlinedActivityPages, type ExpandedActivityField,
} from "@/lib/trade-activity-form-flow";
import type { CreditexActivityWorkPackSignatureStroke } from "@/lib/creditex-activity-work-pack";
import { TradeWorkPackSignaturePad } from "./TradeWorkPackSignaturePad";
import styles from "./CreditexFormPhonePreview.module.css";

type TestSignature = { name: string; accepted: boolean; strokes: readonly CreditexActivityWorkPackSignatureStroke[]; scope: string };
const emptySignature: TestSignature = { name: "", accepted: false, strokes: [], scope: "" };

function validAnswer(field: ActivityField, value: ActivityAnswer | undefined) {
  if (value === undefined || value === "") return false;
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e12;
  if (typeof value !== "string" || !value.trim() || value.length > 10_000) return false;
  if (field.approvedProduct) return value === `preview-${field.approvedProduct.role}`;
  if (field.type === "select") return field.options.includes(value);
  if (field.type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return field.type === "text";
}

function previewAnswers(form: ActivityForm, answers: ActivityAnswers): ActivityAnswers {
  const fields = new Map(form.fields.map((field) => [field.key, field]));
  return Object.fromEntries(Object.entries(answers).filter(([key, value]) => {
    if (key.startsWith("$repeat.")) return form.fields.some((field) => field.repeatGroup === key.slice(8)) && typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20;
    const field = fields.get(activityBaseFieldKey(key));
    return field && validAnswer(field, value);
  }));
}

export function CreditexFormPhonePreview({ form: sourceForm, selectedFieldKey, selectedDeclarationKey, onSelectField, onSelectDeclaration, canEdit = true }: {
  form: ActivityForm;
  selectedFieldKey?: string;
  selectedDeclarationKey?: string;
  onSelectField?: (key: string) => void;
  onSelectDeclaration?: (key: string) => void;
  canEdit?: boolean;
}) {
  const form = useMemo(() => activityFieldWorkerForm(sourceForm), [sourceForm]);
  const selectedKey = selectedDeclarationKey || selectedFieldKey || "";
  const selection = selectedDeclarationKey ? `declaration:${selectedDeclarationKey}` : `field:${selectedFieldKey || ""}`;
  const [device, setDevice] = useState<"iphone" | "galaxy">("iphone");
  const [draft, setDraft] = useState<ActivityAnswers>({});
  const [evidence, setEvidence] = useState<Record<string, ActivityField["type"] | undefined>>({});
  const [signatures, setSignatures] = useState<Record<string, TestSignature>>({});
  const [pageKey, setPageKey] = useState(selectedKey);
  const [trackedSelection, setTrackedSelection] = useState(selection);
  const [inspect, setInspect] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const id = useId();
  const answers = previewAnswers(form, draft);
  const pages = streamlinedActivityPages(activityWizardPages(form, answers));
  const page = activityWizardPageForStepKey(pages, pageKey) || pages[0];
  const pageIndex = pages.findIndex((item) => item.key === page.key);
  const selectedField = selectedDeclarationKey ? undefined : form.fields.find((field) => field.key === selectedFieldKey)
    || sourceForm.fields.find((field) => field.key === selectedFieldKey);
  const selectedDeclaration = form.declarations.find((declaration) => declaration.key === selectedDeclarationKey);
  const selectedPage = selectedKey ? activityWizardPageForStepKey(pages, selectedKey) : undefined;
  if (trackedSelection !== selection) {
    setTrackedSelection(selection);
    setPageKey(selectedKey);
    setInspect(false);
    setShowValidation(false);
  }
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [page.key, selection, inspect]);

  const fields = pages.flatMap((item) => item.kind === "fields" ? item.fields : []);
  const required = fields.filter((field) => field.required);
  const missing = (field: ActivityField) => field.type === "photo" || field.type === "document"
    ? evidence[field.key] !== field.type : !validAnswer(field, answers[field.key]) || (field.requiredValue !== undefined && answers[field.key] !== field.requiredValue);
  const missingFields = required.filter(missing);
  const declarations = inspect && selectedDeclaration ? [selectedDeclaration]
    : !inspect && page.kind === "signature" ? form.declarations.filter((item) => page.legacyStepKeys.includes(item.key)) : [];
  const signatureKey = inspect && selectedDeclaration ? `inspection:${selectedDeclaration.key}` : page.key;
  const signature = signatures[signatureKey] || emptySignature;
  const signatureScope = JSON.stringify([form, answers, evidence]);
  const signatureComplete = (key: string) => {
    const value = signatures[key];
    return Boolean(value?.name.trim() && value.accepted && value.scope === signatureScope && value.strokes.some((stroke) => stroke.points.length >= 3));
  };
  const requiredSignatures = pages.filter((item) => item.kind === "signature" && form.declarations.some((declaration) => item.legacyStepKeys.includes(declaration.key) && declaration.required));
  const missingSignatures = requiredSignatures.filter((item) => !signatureComplete(item.key));
  const total = required.length + requiredSignatures.length;
  const complete = total - missingFields.length - missingSignatures.length;
  const repeatField = page.kind === "fields" ? page.fields.find((field) => field.repeatGroup) : undefined;
  const repeatGroup = repeatField?.repeatGroup || "";
  const repeatCount = activityRepeatCount(form, answers, repeatGroup);
  const nextPage = pages[pageIndex + 1];
  const repeatContinues = repeatField && nextPage?.kind === "fields" && nextPage.fields.some((field) => field.repeatGroup === repeatGroup && field.repeatIndex === repeatField.repeatIndex);
  const repeatLabel = activityRepeatItemLabel(repeatGroup);
  const visibleFields: ExpandedActivityField[] = inspect && selectedField
    ? [{ ...selectedField, baseKey: selectedField.key, repeatIndex: 0 }]
    : !inspect && page.kind === "fields" ? page.fields : [];

  function answer(field: ActivityField, value: ActivityAnswer) {
    setDraft((current) => ({ ...previewAnswers(form, current), [field.key]: value }));
    // Test signatures follow the form answers rather than pretending to be legal records.
    setSignatures({});
  }
  function navigate(key: string) {
    setPageKey(key); setInspect(false); setShowValidation(false);
  }
  function next() {
    if (nextPage) navigate(nextPage.key);
  }
  function reset() {
    setDraft({}); setEvidence({}); setSignatures({}); setPageKey(selectedKey); setInspect(false); setShowValidation(false);
  }
  function updateSignature(patch: Partial<TestSignature>) {
    setSignatures({ ...signatures, [signatureKey]: { ...signature, ...patch, scope: signatureScope } });
  }
  function renderField(field: ExpandedActivityField) {
    const inputId = `${id}-${field.key}`;
    const isMissing = showValidation && field.required && missing(field);
    const approved = field.approvedProduct;
    const productLabel = approved?.role === "brand" ? "brand" : "model";
    const needsBrand = approved?.role === "model" && approved.brandFieldKey
      && !answers[activityRepeatKey(approved.brandFieldKey, field.repeatIndex)];
    const value = answers[field.key];
    return <section key={field.key} className={styles.field} data-selected={field.baseKey === selectedFieldKey || undefined}>
      <div className={styles.fieldHeading}><label htmlFor={inputId}>{field.label}{field.repeatGroup ? ` · Item ${field.repeatIndex + 1}` : ""}</label><span>{field.required ? "Required" : "Optional"}</span></div>
      {field.help && <p>{field.help}</p>}
      {field.presentation === "prefilled" && <small>Starts with the assigned worker or business profile. Test a correction here.</small>}
      {field.referenceDocuments?.map((document) => <div key={document.url} className={styles.reference}>Reference document: {document.title}</div>)}
      {field.presentation === "derived" ? <div className={styles.reference}>Recorded automatically by TLink. This value comes from the job, business, assigned team member or signature record.</div>
        : approved ? <><select id={inputId} disabled={Boolean(needsBrand)} aria-invalid={isMissing || undefined} value={String(value ?? "")} onChange={(event) => answer(field, event.target.value)}><option value="">{needsBrand ? "Choose a brand first" : `Choose approved ${productLabel}`}</option><option value={`preview-${approved.role}`}>Sample {productLabel} (preview only)</option></select><small>The live app uses the approved product register. This sample tests the question layout only.</small></>
          : field.type === "boolean" ? <div id={inputId} className={styles.choices} role="radiogroup" aria-label={field.label} aria-required={field.required}>{[true, false].map((option) => <button key={String(option)} type="button" role="radio" aria-checked={value === option} className={value === option ? styles.chosen : undefined} onClick={() => answer(field, option)}>{option ? "Yes" : "No"}</button>)}</div>
            : field.type === "select" ? <select id={inputId} value={String(value ?? "")} aria-invalid={isMissing || undefined} onChange={(event) => answer(field, event.target.value)}><option value="">Choose an answer</option>{field.options.map((option) => <option key={option} value={option}>{activityOptionLabel(option, field.optionLabels?.[option])}</option>)}</select>
              : field.type === "photo" || field.type === "document" ? <div className={styles.attachment}>
                {field.evidenceFor?.length ? <small>Evidence for: {field.evidenceFor.map((key) => form.fields.find((item) => item.key === key)?.label || key).join(", ")}</small> : null}
                {evidence[field.key] === field.type ? <><div className={styles.sampleFile}>{field.type === "photo" ? "▧" : "▤"}<strong>Test {field.type} added</strong><small>Preview sample only</small></div><button type="button" onClick={() => { setEvidence((current) => ({ ...current, [field.key]: undefined })); setSignatures({}); }}>Remove test {field.type}</button></> : <button id={inputId} type="button" onClick={() => { setEvidence((current) => ({ ...current, [field.key]: field.type })); setSignatures({}); }}>{field.type === "photo" ? "Add test photo" : "Add test document"}</button>}
                {field.requireLocation && <small>Accurate GPS location is required when captured in the field app.</small>}
              </div>
                : <input id={inputId} type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} step={field.type === "number" ? "any" : undefined} maxLength={10_000} placeholder="Enter answer" value={String(value ?? "")} aria-invalid={isMissing || undefined} onChange={(event) => answer(field, field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)} />}
      {isMissing && <p className={styles.error} role="alert">{field.requiredValue !== undefined ? `This answer must be ${String(field.requiredValue)}.` : "Complete this required question."}</p>}
      {onSelectField && <button type="button" className={styles.editQuestion} onClick={() => onSelectField(field.baseKey)}>{canEdit ? "Edit this question" : "Select this question"}</button>}
    </section>;
  }

  return <aside className={styles.preview} aria-label="Live phone preview">
    <div className={styles.tools}><div><strong>Live phone preview</strong><p>Try the form as you edit.</p></div><button type="button" onClick={reset}>Reset test</button></div>
    <div className={styles.devicePicker} role="group" aria-label="Preview phone style"><button type="button" aria-pressed={device === "iphone"} onClick={() => setDevice("iphone")}>iPhone</button><button type="button" aria-pressed={device === "galaxy"} onClick={() => setDevice("galaxy")}>Samsung Galaxy</button></div>
    <p className={styles.caption}>Unsaved edits appear immediately. Test answers stay in this preview.</p>
    {selectedField && !selectedPage && <div className={styles.inspectionNotice}><p>{selectedField.presentation === "derived" ? "The selected field is recorded automatically and has no question screen." : "The selected question is hidden by its current routing or profile rules."}</p><button type="button" onClick={() => setInspect(!inspect)}>{inspect ? "Return to form flow" : "Inspect selected question"}</button></div>}
    {selectedDeclaration && !selectedPage && <div className={styles.inspectionNotice}><p>The selected signing item is hidden by its current routing rules.</p><button type="button" onClick={() => setInspect(!inspect)}>{inspect ? "Return to form flow" : "Inspect selected signing item"}</button></div>}
    <div className={`${styles.phone} ${device === "galaxy" ? styles.galaxy : styles.iphone}`}>
      <div className={styles.screen}>
        <div className={styles.statusBar} aria-hidden="true"><span>9:41</span><i /><span>▮▮▮ ▰</span></div>
        <header className={styles.appHeader}><span className={styles.brand}>TLink</span><span>FIELD APP</span><b>TEST</b></header>
        <div className={styles.formTitle}>{form.title}<small>{form.programCode} · Preview only</small></div>
        <div className={styles.pagePicker}><label htmlFor={`${id}-page`}>Jump to a section</label><select id={`${id}-page`} value={page.key} onChange={(event) => navigate(event.target.value)}>{pages.map((item, index) => <option key={item.key} value={item.key}>{index + 1}. {item.kind === "fields" ? `${item.phase === "before" ? "Before" : "After"}: ${item.section}${item.fields[0]?.repeatGroup ? ` · Item ${item.fields[0].repeatIndex + 1}` : ""}` : item.kind === "signature" ? `${item.declaration.role === "technician" ? "Installer" : item.declaration.role === "customer" ? "Customer" : "Other signer"} declarations` : "Review"}</option>)}</select></div>
        <div className={styles.body} ref={scroll}>
          <div className={styles.progress}><span>Form progress <b>{complete}/{total}</b></span><progress aria-label="Test form progress" value={complete} max={total || 1} /></div>
          {inspect ? <p className={styles.notice}>{selectedDeclaration ? "Signing item inspection." : "Question inspection."} Routing is temporarily bypassed here; return to the form to test the actual path.</p> : <div className={styles.sectionHeading}><small>{page.kind === "fields" ? page.phase === "before" ? "BEFORE WORK" : "WORK AND COMPLETION" : "FINISH AND REVIEW"}</small><h3>{page.kind === "fields" ? page.section : page.kind === "signature" ? `${page.declaration.role === "technician" ? "Installer" : page.declaration.role === "customer" ? "Customer" : "Other signer"} declarations` : "Review your test"}</h3></div>}
          {!inspect && page.kind !== "review" && <div className={styles.validationTools}><button type="button" onClick={() => setShowValidation(true)}>Check these answers</button><small>Next works without answers in this preview.</small></div>}
          {visibleFields.map(renderField)}
          {!inspect && page.kind === "fields" && repeatField && !repeatContinues && repeatField.repeatIndex === repeatCount - 1 && <div className={styles.repeat}><strong>{repeatCount} {repeatLabel}{repeatCount === 1 ? "" : "s"}</strong><button type="button" disabled={repeatCount >= 20} onClick={() => { setDraft({ ...answers, [`$repeat.${repeatGroup}`]: repeatCount + 1 }); setSignatures({}); navigate(`${repeatField.baseKey}[${repeatCount}]`); }}>Add another {repeatLabel}</button>{repeatCount > 1 && <button type="button" onClick={() => { setDraft(removeLastActivityRepeat(form, answers, repeatGroup)); const removedKeys = new Set(form.fields.filter((field) => field.repeatGroup === repeatGroup).map((field) => activityRepeatKey(field.key, repeatCount - 1))); setEvidence((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !removedKeys.has(key)))); setSignatures({}); navigate(repeatField.baseKey); }}>Remove last {repeatLabel}</button>}</div>}
          {declarations.length > 0 && <section className={styles.signature}>{declarations.map((declaration) => <article key={declaration.key} data-selected={declaration.key === selectedDeclarationKey || undefined}><h4>{declaration.title}</h4><p>{boundActivityDeclaration(declaration, answers)}</p>{onSelectDeclaration && <button type="button" className={styles.editSigningItem} onClick={() => onSelectDeclaration(declaration.key)}>{canEdit ? "Edit this signing item" : "Select this signing item"}</button>}</article>)}<label>Test signer name<input value={signature.name} placeholder="Example signer" onChange={(event) => updateSignature({ name: event.target.value })} /></label><label className={styles.check}><input type="checkbox" checked={signature.accepted} onChange={(event) => updateSignature({ accepted: event.target.checked })} />I have read these declarations (test only)</label><TradeWorkPackSignaturePad label="Test signature" signerName={signature.name} signerCapacity="Preview only" value={signature.strokes} onChange={(strokes) => updateSignature({ strokes })} />{showValidation && !signatureComplete(signatureKey) && <p className={styles.error} role="alert">Enter a test signer name, acknowledge the declarations and draw a test signature.</p>}</section>}
          {!inspect && page.kind === "review" && <section className={styles.review}><p>{missingFields.length + missingSignatures.length ? `${missingFields.length + missingSignatures.length} required items remain in this test.` : "Every visible required item is complete in this test."}</p>{missingFields.map((field) => <button key={field.key} type="button" onClick={() => navigate(field.key)}>{field.label}</button>)}{missingSignatures.map((item) => <button key={item.key} type="button" onClick={() => navigate(item.key)}>{item.kind === "signature" ? item.declaration.title : "Declaration"}</button>)}<p className={styles.notice}>Preview complete. Nothing is saved, signed or submitted to Creditex.</p><button type="button" onClick={reset}>Start a new test</button></section>}
        </div>
        <footer className={styles.footer}>{inspect ? <button type="button" onClick={() => setInspect(false)}>Return to form flow</button> : <><button type="button" disabled={pageIndex === 0} onClick={() => navigate(pages[pageIndex - 1].key)}>Back</button><span>{pageIndex + 1} / {pages.length}</span><button type="button" disabled={!nextPage} onClick={next}>Next</button></>}</footer>
        <div className={styles.homeBar} aria-hidden="true"><i /></div>
      </div>
    </div>
    <p className={styles.caption}>Uses the app&apos;s questions, page order, routing and repeat rules. Camera, GPS, product approvals, signatures and submission are simulated. Native keyboard and date controls may look different.</p>
  </aside>;
}
