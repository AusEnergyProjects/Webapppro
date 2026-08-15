"use client";

import type {
  CreditexWorkPackDocumentOutput,
  CreditexWorkPackDocumentPlacement,
  CreditexWorkPackPrompt,
  CreditexWorkPackSignerRole,
} from "@/lib/creditex-activity-work-pack";
import { CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION } from "@/lib/creditex-activity-work-pack";
import styles from "./CreditexWorkPackDocumentOutputEditor.module.css";

function slug(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || fallback;
}

function percent(value: number) {
  return Number((value * 100).toFixed(2));
}

function ratio(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) / 100 : fallback;
}

function newPlacement(order: number): CreditexWorkPackDocumentPlacement {
  return {
    placementKey: `field_${order}`,
    kind: "text",
    sourcePath: "/prefill/providerContext/tradingName",
    signaturePromptKey: "",
    signerRoleKey: "",
    pageIndex: 0,
    x: .08,
    y: .08 + ((order - 1) % 8) * .09,
    width: .36,
    height: .055,
    fontFamily: "helvetica",
    fontSize: 10,
    minimumFontSize: 7,
    overflow: "shrink",
    maximumLines: 1,
    textFormat: "text",
  };
}

function newOutput(order: number, required: boolean): CreditexWorkPackDocumentOutput {
  return {
    outputKey: `completed_form_${order}`,
    title: `Completed activity form ${order}`,
    sourceBindingTargetKey: `completed_form_template_${order}`,
    rendererVersion: CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION,
    required,
    placements: [],
  };
}

function placementLabel(
  placement: CreditexWorkPackDocumentPlacement,
  prompts: readonly CreditexWorkPackPrompt[],
  roles: readonly CreditexWorkPackSignerRole[],
) {
  if (placement.kind === "signature") {
    const prompt = prompts.find((item) => item.promptKey === placement.signaturePromptKey);
    const role = roles.find((item) => item.roleKey === placement.signerRoleKey);
    return `${prompt?.label || placement.signaturePromptKey || "Signature"} | ${role?.label || placement.signerRoleKey || "Signer"}`;
  }
  return placement.sourcePath || placement.placementKey;
}

function PagePreview({
  output,
  prompts,
  roles,
}: {
  output: CreditexWorkPackDocumentOutput;
  prompts: readonly CreditexWorkPackPrompt[];
  roles: readonly CreditexWorkPackSignerRole[];
}) {
  const pages = Math.max(1, ...output.placements.map((item) => item.pageIndex + 1));
  return <div className={styles.pagePreviewList} aria-label={`Placement preview for ${output.title}`}>
    {Array.from({ length: pages }, (_, pageIndex) => <article className={styles.pagePreview} key={pageIndex}>
      <span>Page {pageIndex + 1}</span>
      {output.placements.filter((placement) => placement.pageIndex === pageIndex).map((placement) => <div
        key={placement.placementKey}
        className={placement.kind === "signature" ? styles.signaturePlacement : styles.textPlacement}
        style={{
          left: `${percent(placement.x)}%`,
          top: `${percent(placement.y)}%`,
          width: `${percent(placement.width)}%`,
          height: `${percent(placement.height)}%`,
        }}
        title={placementLabel(placement, prompts, roles)}
      >{placement.kind === "signature" ? "Signature" : placementLabel(placement, prompts, roles)}</div>)}
    </article>)}
  </div>;
}

function PlacementEditor({
  placement,
  prompts,
  signerRoles,
  sourcePaths,
  onChange,
  onRemove,
}: {
  placement: CreditexWorkPackDocumentPlacement;
  prompts: readonly CreditexWorkPackPrompt[];
  signerRoles: readonly CreditexWorkPackSignerRole[];
  sourcePaths: readonly string[];
  onChange: (next: CreditexWorkPackDocumentPlacement) => void;
  onRemove: () => void;
}) {
  const signaturePrompts = prompts.filter((prompt) => prompt.type === "signature");
  return <article className={styles.placementEditor}>
    <header><strong>{placementLabel(placement, prompts, signerRoles)}</strong><button type="button" onClick={onRemove}>Remove field</button></header>
    <div className={styles.formGrid}>
      <label>Placement key<input value={placement.placementKey} onChange={(event) => onChange({ ...placement, placementKey: slug(event.target.value, "field") })} /></label>
      <label>Content<select value={placement.kind} onChange={(event) => {
        const kind = event.target.value as "text" | "signature";
        onChange({
          ...placement,
          kind,
          sourcePath: kind === "text" ? placement.sourcePath || sourcePaths[0] || "/prefill/providerContext/tradingName" : "",
          signaturePromptKey: kind === "signature" ? placement.signaturePromptKey || signaturePrompts[0]?.promptKey || "" : "",
          signerRoleKey: kind === "signature" ? placement.signerRoleKey || signerRoles[0]?.roleKey || "" : "",
          fontFamily: kind === "signature" ? "helvetica" : placement.fontFamily,
          textFormat: kind === "signature" ? "text" : placement.textFormat,
        });
      }}><option value="text">Text, date or tick</option><option value="signature">Visible signature, name and date</option></select></label>
      {placement.kind === "text" ? <>
        <label className={styles.wide}>Data to print<input list="creditex-work-pack-pdf-source-paths" value={placement.sourcePath} onChange={(event) => onChange({ ...placement, sourcePath: event.target.value })} placeholder="/response/answers/customer_type" /></label>
        <label>Format<select value={placement.textFormat} onChange={(event) => onChange({ ...placement, textFormat: event.target.value as CreditexWorkPackDocumentPlacement["textFormat"] })}><option value="text">Text</option><option value="date_au">Australian date</option><option value="boolean_mark">Tick / checkbox mark</option></select></label>
      </> : <>
        <label>Signature question<select value={placement.signaturePromptKey} onChange={(event) => onChange({ ...placement, signaturePromptKey: event.target.value })}><option value="">Choose signature question</option>{signaturePrompts.map((prompt) => <option key={prompt.promptKey} value={prompt.promptKey}>{prompt.label}</option>)}</select></label>
        <label>Signer role<select value={placement.signerRoleKey} onChange={(event) => onChange({ ...placement, signerRoleKey: event.target.value })}><option value="">Choose signer</option>{signerRoles.map((role) => <option key={role.roleKey} value={role.roleKey}>{role.label} | {role.capacity}</option>)}</select></label>
      </>}
      <fieldset className={styles.geometry}>
        <legend>Position on the approved PDF page</legend>
        <label>Page<input type="number" min="1" max="500" value={placement.pageIndex + 1} onChange={(event) => onChange({ ...placement, pageIndex: Math.max(0, Number(event.target.value || 1) - 1) })} /></label>
        <label>From left %<input type="number" min="0" max="100" step="0.1" value={percent(placement.x)} onChange={(event) => onChange({ ...placement, x: ratio(event.target.value, placement.x) })} /></label>
        <label>From top %<input type="number" min="0" max="100" step="0.1" value={percent(placement.y)} onChange={(event) => onChange({ ...placement, y: ratio(event.target.value, placement.y) })} /></label>
        <label>Width %<input type="number" min="0.1" max="100" step="0.1" value={percent(placement.width)} onChange={(event) => onChange({ ...placement, width: ratio(event.target.value, placement.width) })} /></label>
        <label>Height %<input type="number" min="0.1" max="100" step="0.1" value={percent(placement.height)} onChange={(event) => onChange({ ...placement, height: ratio(event.target.value, placement.height) })} /></label>
      </fieldset>
      {placement.kind === "text" ? <fieldset className={styles.textRules}>
        <legend>Text fitting</legend>
        <label>Font<select value={placement.fontFamily} onChange={(event) => onChange({ ...placement, fontFamily: event.target.value as CreditexWorkPackDocumentPlacement["fontFamily"] })}><option value="helvetica">Regular</option><option value="helvetica_bold">Bold</option></select></label>
        <label>Font size<input type="number" min="4" max="72" value={placement.fontSize} onChange={(event) => onChange({ ...placement, fontSize: Number(event.target.value) })} /></label>
        <label>Smallest size<input type="number" min="4" max="72" value={placement.minimumFontSize} onChange={(event) => onChange({ ...placement, minimumFontSize: Number(event.target.value) })} /></label>
        <label>Long answers<select value={placement.overflow} onChange={(event) => onChange({ ...placement, overflow: event.target.value as CreditexWorkPackDocumentPlacement["overflow"] })}><option value="shrink">Shrink to fit</option><option value="wrap">Wrap onto lines</option><option value="clip">Clip at box edge</option></select></label>
        <label>Maximum lines<input type="number" min="1" max="100" value={placement.maximumLines} onChange={(event) => onChange({ ...placement, maximumLines: Number(event.target.value) })} /></label>
      </fieldset> : null}
    </div>
  </article>;
}

export function CreditexWorkPackDocumentOutputEditor({
  value,
  prompts,
  signerRoles,
  onChange,
}: {
  value: readonly CreditexWorkPackDocumentOutput[];
  prompts: readonly CreditexWorkPackPrompt[];
  signerRoles: readonly CreditexWorkPackSignerRole[];
  onChange: (next: readonly CreditexWorkPackDocumentOutput[]) => void;
}) {
  const answerPaths = prompts.filter((prompt) => prompt.type !== "signature").map((prompt) => `/response/answers/${prompt.promptKey}`);
  const sourcePaths = [
    "/prefill/providerContext/legalName",
    "/prefill/providerContext/tradingName",
    "/prefill/providerContext/abn",
    "/prefill/installerBusinessContext/businessName",
    "/prefill/installerBusinessContext/abn",
    "/prefill/installerBusinessContext/participantId",
    "/prefill/assignmentContext/displayName",
    "/prefill/assignmentContext/email",
    "/prefill/assignmentContext/phone",
    "/prefill/jobContext/workNumber",
    "/prefill/jobContext/title",
    "/prefill/jobContext/serviceCategory",
    "/prefill/activityDate",
    "/prefill/customerSnapshot/firstName",
    "/prefill/customerSnapshot/lastName",
    "/prefill/customerSnapshot/phone",
    "/prefill/customerSnapshot/email",
    "/prefill/customerSnapshot/addressLine1",
    "/prefill/customerSnapshot/addressLine2",
    "/prefill/customerSnapshot/suburb",
    "/prefill/customerSnapshot/state",
    "/prefill/customerSnapshot/postcode",
    ...answerPaths,
  ];
  const removeOutput = (outputIndex: number) => {
    const removedRequiredOutput = Boolean(value[outputIndex]?.required);
    const remaining = value.filter((_, index) => index !== outputIndex);
    if (!removedRequiredOutput || remaining.length === 0) {
      onChange(remaining);
      return;
    }
    onChange(remaining.map((output, index) => ({ ...output, required: index === 0 })));
  };
  return <section className={styles.editor}>
    <datalist id="creditex-work-pack-pdf-source-paths">{sourcePaths.map((path) => <option key={path} value={path} />)}</datalist>
    <header>
      <div><h4>Completed final PDF and visible signatures</h4><p>Map the exact approved blank PDF to the saved job data. Creditex renders one required completed record on the server and places captured signatures, names and dates in these governed boxes. Supporting documents belong in governed document questions.</p></div>
      {value.length === 0
        ? <button type="button" onClick={() => onChange([newOutput(1, true)])}>Add completed final PDF</button>
        : <span>One completed final PDF per activity work pack</span>}
    </header>
    {value.length === 0 ? <div className={styles.empty}><strong>No completed PDF mapped</strong><span>A work pack with a required signature cannot be published until its approved form template and visible signature boxes are mapped.</span></div> : value.map((output, outputIndex) => <article className={styles.output} key={output.outputKey}>
      <header>
        <div><strong>{output.title}</strong><span>{output.sourceBindingTargetKey} | renderer {output.rendererVersion}</span></div>
        <button type="button" onClick={() => removeOutput(outputIndex)}>Remove PDF</button>
      </header>
      <div className={styles.outputGrid}>
        <label>Output key<input value={output.outputKey} onChange={(event) => onChange(value.map((item, index) => index === outputIndex ? { ...item, outputKey: slug(event.target.value, `completed_form_${outputIndex + 1}`) } : item))} /></label>
        <label>Completed document title<input value={output.title} onChange={(event) => onChange(value.map((item, index) => index === outputIndex ? { ...item, title: event.target.value } : item))} /></label>
        <label className={styles.wide}>Approved blank PDF source target<input value={output.sourceBindingTargetKey} onChange={(event) => onChange(value.map((item, index) => index === outputIndex ? { ...item, sourceBindingTargetKey: slug(event.target.value, `completed_form_template_${outputIndex + 1}`) } : item))} /><small>Upload and independently approve the exact blank PDF, then bind it to this target in the source register.</small></label>
        <label className={styles.check}><input type="radio" name="creditex-required-final-pdf" checked={output.required} onChange={() => onChange(value.map((item, index) => ({ ...item, required: index === outputIndex })))} />Use as the one required final record before the technician can finish</label>
      </div>
      <PagePreview output={output} prompts={prompts} roles={signerRoles} />
      <section className={styles.placements}>
        <header><strong>Fields printed into the PDF</strong><button type="button" onClick={() => onChange(value.map((item, index) => index === outputIndex ? { ...item, placements: [...item.placements, newPlacement(item.placements.length + 1)] } : item))}>Add field or signature box</button></header>
        {output.placements.map((placement, placementIndex) => <PlacementEditor
          key={placement.placementKey}
          placement={placement}
          prompts={prompts}
          signerRoles={signerRoles}
          sourcePaths={sourcePaths}
          onChange={(next) => onChange(value.map((item, index) => index === outputIndex ? { ...item, placements: item.placements.map((current, currentIndex) => currentIndex === placementIndex ? next : current) } : item))}
          onRemove={() => onChange(value.map((item, index) => index === outputIndex ? { ...item, placements: item.placements.filter((_, currentIndex) => currentIndex !== placementIndex) } : item))}
        />)}
      </section>
    </article>)}
  </section>;
}
