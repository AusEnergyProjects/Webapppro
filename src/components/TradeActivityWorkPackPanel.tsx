"use client";

/* eslint-disable @next/next/no-img-element */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "firebase/auth";
import {
  CREDITEX_ACTIVITY_WORK_PACK_DEVICE_ATTESTATION_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_ATTESTATION_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_SIGNER_IDENTITY_CONTRACT,
  creditexActivityWorkPackCompletion,
  creditexActivityWorkPackVisibilityMatches,
  type CreditexActivityWorkPackResponse,
  type CreditexActivityWorkPackSignatureAttestation,
  type CreditexActivityWorkPackSignaturePayload,
  type CreditexActivityWorkPackSignatureStroke,
  type CreditexActivityWorkPackSignerIdentity,
  type CreditexWorkPackPrompt,
  type CreditexWorkPackSection,
  type CreditexWorkPackSignerRole,
} from "@/lib/creditex-activity-work-pack";
import type {
  CreditexActivityWorkPackCustomerProjection,
  CreditexActivityWorkPackOfficialProductProjection,
  CreditexActivityWorkPackReferenceDocumentProjection,
  CreditexAssignedActivityWorkPackProjection,
  CreditexWorkPackBrowserUploadPurpose,
  CreditexWorkPackBrowserUploadResult,
  CreditexWorkPackMutationResult,
  CreditexWorkPackSectionPatch,
} from "@/lib/creditex-activity-work-pack-server";
import { TradeWorkPackSignaturePad } from "./TradeWorkPackSignaturePad";
import styles from "./TradeActivityWorkPackPanel.module.css";

const ENDPOINT = "/api/trade-team/work-packs";
const WEB_DEVICE_STORAGE_KEY = "aea-creditex-work-pack-web-device-v1";
const BROWSER_UPLOAD_CONTRACT = "creditex-activity-work-pack-browser-upload/v1";

type WorkPackResult = {
  ok?: boolean;
  instances?: CreditexAssignedActivityWorkPackProjection[];
  workPack?: CreditexAssignedActivityWorkPackProjection;
  officialProducts?: CreditexActivityWorkPackOfficialProductProjection[];
  result?: CreditexWorkPackMutationResult;
  code?: string;
  error?: string;
};

type BrowserUploadResponse = {
  ok?: boolean;
  status?: CreditexWorkPackBrowserUploadResult["status"];
  upload?: CreditexWorkPackBrowserUploadResult["upload"];
  code?: string;
  error?: string;
};

type SignatureDraft = {
  signerName: string;
  fields: Record<string, string>;
  strokes: readonly CreditexActivityWorkPackSignatureStroke[];
};

type Preview = {
  title: string;
  fileName: string;
  contentType: string;
  url: string;
};

type OfficialProductChoice = Readonly<{
  product: CreditexActivityWorkPackOfficialProductProjection;
  quantity: number;
}>;

type PromptContext = {
  section: CreditexWorkPackSection;
  repeatInstanceKey: string;
  prompt: CreditexWorkPackPrompt;
};

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalWorkPackJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(canonicalWorkPackJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalWorkPackJson(item)}`)
    .join(",")}}`;
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function browserWorkPackSha256(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalWorkPackJson(value)),
  );
  return `sha256:${hex(new Uint8Array(digest))}`;
}

async function browserRawSha256(bytes: ArrayBuffer) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function normaliseSha256(value: string) {
  const result = value.trim().toLowerCase().replace(/^sha256:/, "");
  return /^[0-9a-f]{64}$/.test(result) ? result : "";
}

function webDeviceId() {
  const stored = window.localStorage.getItem(WEB_DEVICE_STORAGE_KEY)?.trim() || "";
  if (/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,179}$/.test(stored)) return stored;
  const created = `web-${crypto.randomUUID()}`;
  window.localStorage.setItem(WEB_DEVICE_STORAGE_KEY, created);
  return created;
}

function responseKey(context: PromptContext) {
  return context.section.repeatability
    ? `${context.section.sectionKey}[${context.repeatInstanceKey}].${context.prompt.promptKey}`
    : context.prompt.promptKey;
}

function referenceKey(document: CreditexActivityWorkPackReferenceDocumentProjection) {
  return `${document.responseKey}:${document.sourceArtifactId}`;
}

function answerFor(
  response: CreditexActivityWorkPackResponse,
  section: CreditexWorkPackSection,
  repeatInstanceKey: string,
  promptKey: string,
) {
  if (!section.repeatability) return response.answers[promptKey];
  return response.repeatableSections[section.sectionKey]
    ?.find((item) => item.instanceKey === repeatInstanceKey)?.answers[promptKey];
}

export function mergeWorkPackSectionPatches(
  response: CreditexActivityWorkPackResponse,
  sections: readonly CreditexWorkPackSection[],
  patches: readonly CreditexWorkPackSectionPatch[],
): CreditexActivityWorkPackResponse {
  let answers = { ...response.answers };
  let repeatableSections = Object.fromEntries(Object.entries(response.repeatableSections)
      .map(([key, instances]) => [key, instances.map((instance) => ({
        instanceKey: instance.instanceKey,
        answers: { ...instance.answers },
      }))]));
  const byKey = new Map(sections.map((section) => [section.sectionKey, section]));
  for (const patch of patches) {
    const section = byKey.get(patch.sectionKey);
    if (!section) throw new Error("This section is no longer part of the governed form.");
    const allowed = new Set(section.prompts.map((prompt) => prompt.promptKey));
    const patchAnswers = Object.fromEntries(Object.entries(patch.answers || {})
      .filter(([key]) => allowed.has(key)));
    if (!section.repeatability) {
      if (patch.remove || patch.repeatInstanceKey) {
        throw new Error("This section does not accept repeat items.");
      }
      answers = { ...answers, ...patchAnswers };
      continue;
    }
    const instanceKey = patch.repeatInstanceKey || "";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$/.test(instanceKey)) {
      throw new Error("This repeat item has an invalid identity.");
    }
    const instances = [...(repeatableSections[section.sectionKey] || [])];
    const index = instances.findIndex((item) => item.instanceKey === instanceKey);
    if (patch.remove) {
      if (index >= 0) instances.splice(index, 1);
    } else if (index >= 0) {
      instances[index] = { ...instances[index], answers: { ...instances[index].answers, ...patchAnswers } };
    } else {
      instances.push({ instanceKey, answers: patchAnswers });
    }
    repeatableSections = {
      ...repeatableSections,
      [section.sectionKey]: instances,
    };
  }
  return {
    ...response,
    answers,
    repeatableSections,
    dependencyResolutions: { ...response.dependencyResolutions },
  };
}

function visibleSections(pack: CreditexAssignedActivityWorkPackProjection) {
  return pack.definition.schema.sections
    .filter((section) => creditexActivityWorkPackVisibilityMatches(
      section.visibility,
      pack.response.answers,
    ))
    .sort((left, right) => left.order - right.order);
}

export function firstIncompleteWorkPackPage(pack: CreditexAssignedActivityWorkPackProjection) {
  const sections = visibleSections(pack);
  const blocker = pack.completion.blockers.find((candidate) =>
    sections.some((section) => candidate.key === section.sectionKey
      || candidate.key.startsWith(`${section.sectionKey}[`)
      || section.prompts.some((prompt) => candidate.key === prompt.promptKey)),
  );
  if (!blocker) return sections.length;
  const index = sections.findIndex((section) => blocker.key === section.sectionKey
    || blocker.key.startsWith(`${section.sectionKey}[`)
    || section.prompts.some((prompt) => blocker.key === prompt.promptKey));
  return index < 0 ? sections.length : index;
}

function dependencyReady(pack: CreditexAssignedActivityWorkPackProjection, dependencyKey: string) {
  const dependency = pack.definition.schema.dependencies.find((item) =>
    item.dependencyKey === dependencyKey);
  const resolution = pack.response.dependencyResolutions[dependencyKey];
  return !dependency?.required || Boolean(
    resolution?.status === "resolved"
    && resolution.referenceIds.length
    && /^sha256:[0-9a-f]{64}$/.test(resolution.snapshotSha256),
  );
}

function signatureRole(
  pack: CreditexAssignedActivityWorkPackProjection,
  prompt: CreditexWorkPackPrompt,
) {
  return pack.definition.schema.signerRoles.find((role) =>
    role.roleKey === prompt.signerRoleKey);
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

function customerAddress(customer: CreditexActivityWorkPackCustomerProjection) {
  return [customer.addressLine1, customer.addressLine2, customer.suburb, customer.state, customer.postcode]
    .filter(Boolean).join(", ");
}

function signaturePointCount(strokes: readonly CreditexActivityWorkPackSignatureStroke[]) {
  return strokes.reduce((total, stroke) => total + stroke.points.length, 0);
}

function signatureReady(role: CreditexWorkPackSignerRole, draft: SignatureDraft) {
  return Boolean(
    draft.signerName.trim()
    && draft.strokes.length
    && signaturePointCount(draft.strokes) >= 3
    && role.identityRequirements.every((requirement) =>
      !requirement.required || draft.fields[requirement.fieldKey]?.trim()),
  );
}

function defaultSignatureDraft(
  pack: CreditexAssignedActivityWorkPackProjection,
  role: CreditexWorkPackSignerRole,
): SignatureDraft {
  const binding = pack.signerBindings.find((candidate) => candidate.roleKey === role.roleKey);
  return {
    signerName: binding?.signerName || "",
    fields: Object.fromEntries(role.identityRequirements.map((requirement) => [
      requirement.fieldKey,
      binding?.fields[requirement.fieldKey] || "",
    ])),
    strokes: [],
  };
}

function signaturePacketBytes(payload: CreditexActivityWorkPackSignaturePayload) {
  return new TextEncoder().encode(canonicalWorkPackJson(payload));
}

async function exactAuthenticatedBlob(input: {
  user: User;
  path: string;
  sha256: string;
  contentType: string;
  sizeBytes: number;
}) {
  if (!input.path.startsWith(`${ENDPOINT}/`)) {
    throw new Error("This governed file link is invalid. Reload the job.");
  }
  const token = await input.user.getIdToken();
  const response = await fetch(input.path, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as WorkPackResult;
    throw new Error(result.error || "The governed file could not be opened.");
  }
  const expectedSha = normaliseSha256(input.sha256);
  const expectedType = input.contentType.toLowerCase();
  const returnedType = (response.headers.get("content-type") || "")
    .split(";", 1)[0].trim().toLowerCase();
  const retainedHeader = normaliseSha256(
    response.headers.get("x-creditex-sha256") || "",
  );
  const retainedSize = Number(response.headers.get("x-creditex-size-bytes"));
  const custodyReceipt = response.headers.get("x-creditex-custody-receipt") || "";
  if (
    retainedHeader !== expectedSha
    || retainedSize !== input.sizeBytes
    || !custodyReceipt
  ) {
    throw new Error("The governed document did not match its retained custody record.");
  }
  const bytes = await response.arrayBuffer();
  const actualSha = await browserRawSha256(bytes);
  if (
    !expectedSha
    || actualSha !== expectedSha
    || bytes.byteLength !== input.sizeBytes
    || returnedType !== expectedType
  ) {
    throw new Error("The governed file bytes did not match the retained record.");
  }
  return new Blob([bytes], { type: expectedType });
}

export function TradeActivityWorkPackPanel({
  user,
  workOrderId,
  readOnly = false,
  onPresenceChange,
  onOpenSupportingForms,
}: {
  user: User;
  workOrderId: string;
  readOnly?: boolean;
  onPresenceChange?: (hasGovernedPacks: boolean) => void;
  onOpenSupportingForms?: () => void;
}) {
  const [packs, setPacks] = useState<CreditexAssignedActivityWorkPackProjection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequest.current;
    const token = await user.getIdToken();
    const response = await fetch(`${ENDPOINT}?workOrderId=${encodeURIComponent(workOrderId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as WorkPackResult;
    if (!response.ok) throw new Error(result.error || "The activity forms could not be loaded.");
    const next = result.instances || [];
    if (requestId === loadRequest.current) {
      setPacks(next);
      onPresenceChange?.(next.length > 0);
      setError("");
    }
    return next;
  }, [onPresenceChange, user, workOrderId]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((loadError) => {
        if (active) setError(loadError instanceof Error
          ? loadError.message : "The activity forms could not be loaded.");
      }).finally(() => active && setLoading(false));
    });
    return () => {
      active = false;
      loadRequest.current += 1;
      window.cancelAnimationFrame(frame);
    };
  }, [load]);

  const replace = useCallback((projection: CreditexAssignedActivityWorkPackProjection) => {
    setPacks((current) => current.map((item) =>
      item.instance.instanceKey === projection.instance.instanceKey ? projection : item));
  }, []);

  if (loading) return <section className={styles.shell} aria-busy="true">
    <div className={styles.empty}><strong>Opening activity forms</strong><span>Loading the exact form assigned to this job.</span></div>
  </section>;

  if (error && !packs.length) return <section className={styles.shell}>
    <div className={styles.error} role="alert"><strong>Activity forms could not be opened</strong><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div>
  </section>;

  if (!packs.length) return null;

  return <section className={styles.shell} aria-labelledby={`governed-work-packs-${workOrderId}`}>
    <header className={styles.panelHeading}>
      <div>
        <span>Creditex compliance workflow</span>
        <h3 id={`governed-work-packs-${workOrderId}`}>Complete the assigned activity forms</h3>
        <p>Use the guided questions below. Creditex creates the final signed PDF from the approved activity document after every required item is complete.</p>
      </div>
      {onOpenSupportingForms && <button type="button" onClick={onOpenSupportingForms}>Supporting forms</button>}
    </header>
    {error && <p className={styles.inlineError} role="alert">{error}</p>}
    <div className={styles.packList}>
      {packs.map((pack, index) => <WorkPack
        key={pack.instance.instanceKey}
        user={user}
        initialPack={pack}
        readOnly={readOnly}
        initiallyOpen={index === 0}
        onReplace={replace}
        onReload={load}
      />)}
    </div>
  </section>;
}

function WorkPack({
  user,
  initialPack,
  readOnly,
  initiallyOpen,
  onReplace,
  onReload,
}: {
  user: User;
  initialPack: CreditexAssignedActivityWorkPackProjection;
  readOnly: boolean;
  initiallyOpen: boolean;
  onReplace: (projection: CreditexAssignedActivityWorkPackProjection) => void;
  onReload: () => Promise<CreditexAssignedActivityWorkPackProjection[]>;
}) {
  const [pack, setPack] = useState(initialPack);
  const [open, setOpen] = useState(initiallyOpen);
  const [page, setPage] = useState(() => firstIncompleteWorkPackPage(initialPack));
  const [response, setResponse] = useState(initialPack.response);
  const [dirty, setDirty] = useState<Record<string, CreditexWorkPackSectionPatch>>({});
  const [repeatSelection, setRepeatSelection] = useState<Record<string, string>>({});
  const [signatureDrafts, setSignatureDrafts] = useState<Record<string, SignatureDraft>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [openedReferences, setOpenedReferences] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [productQueries, setProductQueries] = useState<Record<string, string>>({});
  const [productResults, setProductResults] = useState<Record<
    string,
    readonly CreditexActivityWorkPackOfficialProductProjection[]
  >>({});
  const [productChoices, setProductChoices] = useState<Record<
    string,
    Readonly<Record<string, OfficialProductChoice>>
  >>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(dirty);
  const packRef = useRef(pack);
  const flushDirtyRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => { packRef.current = pack; }, [pack]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setPreview(null);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const sections = useMemo(() => visibleSections({ ...pack, response }), [pack, response]);
  const completion = useMemo(() => creditexActivityWorkPackCompletion({
    workPack: pack.definition.schema,
    response,
  }), [pack.definition.schema, response]);
  const currentSection = sections[page];
  const reviewPage = page >= sections.length;
  const dependenciesReady = pack.definition.schema.dependencies.every((dependency) =>
    dependencyReady({ ...pack, response }, dependency.dependencyKey));
  const signatureKeys = new Set(sections.flatMap((section) => {
    const instances = section.repeatability
      ? response.repeatableSections[section.sectionKey] || []
      : [{ instanceKey: "", answers: response.answers }];
    return instances.flatMap((instance) => section.prompts.filter((prompt) =>
      prompt.type === "signature"
      && creditexActivityWorkPackVisibilityMatches(
        prompt.visibility,
        response.answers,
        instance.answers,
      )).map((prompt) => responseKey({
      section,
      repeatInstanceKey: instance.instanceKey,
      prompt,
    })));
  }));
  const nonSignatureBlockers = completion.blockers.filter((blocker) =>
    !signatureKeys.has(blocker.key));
  const canPrepare = !readOnly
    && ["not_started", "in_progress"].includes(pack.instance.status)
    && !Object.keys(dirty).length
    && !nonSignatureBlockers.length
    && dependenciesReady
    && signatureKeys.size > 0;
  const canFinalize = !readOnly
    && pack.instance.status === "ready_to_sign"
    && !Object.keys(dirty).length
    && completion.ready
    && dependenciesReady;

  async function applyActionResponse(responseValue: Response) {
    const result = await responseValue.json().catch(() => ({})) as WorkPackResult;
    if (!responseValue.ok || !result.result?.projection) {
      const error = new Error(result.error || "The activity form could not be saved.") as Error & { code?: string };
      error.code = result.code;
      throw error;
    }
    const projection = result.result.projection;
    setPack(projection);
    setResponse(projection.response);
    packRef.current = projection;
    onReplace(projection);
    return projection;
  }

  async function action(
    actionName: CreditexWorkPackMutationResult["action"],
    payload: Record<string, unknown>,
    idempotencyDeviceId = webDeviceId(),
  ) {
    const token = await user.getIdToken();
    const requestPayload = {
      action: actionName,
      caseInstanceId: packRef.current.instance.id,
      expectedResponseSha256: packRef.current.instance.responseSha256,
      ...payload,
    };
    const clientActionId = `web-work-pack-${crypto.randomUUID()}`;
    const payloadHash = await browserWorkPackSha256(requestPayload);
    return applyActionResponse(await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...requestPayload,
        idempotency: {
          clientActionId,
          deviceId: idempotencyDeviceId,
          payloadHash,
        },
      }),
    }));
  }

  async function chooseScenario(dependencyKey: string, scenarioCode: string) {
    if (!scenarioCode || readOnly || Object.keys(dirtyRef.current).length) return;
    setBusy(`scenario:${dependencyKey}`);
    setMessage("Saving the governed scenario...");
    try {
      await action("work_pack_select_scenario", { dependencyKey, scenarioCode });
      setConflict("");
      setMessage("Governed scenario saved.");
    } catch (scenarioError) {
      const error = scenarioError instanceof Error
        ? scenarioError as Error & { code?: string }
        : new Error("The governed scenario could not be saved.");
      await reloadAfterConflict(error).catch((nextError) => {
        setMessage(nextError instanceof Error
          ? nextError.message
          : "The governed scenario could not be saved.");
      });
    } finally {
      setBusy("");
    }
  }

  async function findOfficialProducts(dependencyKey: string) {
    if (readOnly || Object.keys(dirtyRef.current).length) return;
    setBusy(`product-search:${dependencyKey}`);
    setMessage("Checking the exact approved product register...");
    try {
      const token = await user.getIdToken();
      const query = productQueries[dependencyKey]?.trim() || "";
      const search = new URLSearchParams({
        caseInstanceId: packRef.current.instance.id,
        officialProductDependencyKey: dependencyKey,
        search: query,
        limit: "30",
      });
      const responseValue = await fetch(`${ENDPOINT}?${search.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await responseValue.json().catch(() => ({})) as WorkPackResult;
      if (!responseValue.ok || result.ok !== true || !Array.isArray(result.officialProducts)) {
        throw new Error(result.error || "The approved product register could not be searched.");
      }
      setProductResults((current) => ({
        ...current,
        [dependencyKey]: result.officialProducts || [],
      }));
      setMessage(result.officialProducts.length
        ? "Choose the exact installed product below."
        : "No currently eligible approved products matched that search.");
    } catch (productError) {
      setMessage(productError instanceof Error
        ? productError.message
        : "The approved product register could not be searched.");
    } finally {
      setBusy("");
    }
  }

  function toggleOfficialProduct(
    dependencyKey: string,
    selectionMode: "single" | "multiple",
    product: CreditexActivityWorkPackOfficialProductProjection,
  ) {
    setProductChoices((current) => {
      const existing = current[dependencyKey] || {};
      if (existing[product.selectionId]) {
        const next = { ...existing };
        delete next[product.selectionId];
        return { ...current, [dependencyKey]: next };
      }
      const choice = { product, quantity: 1 };
      return {
        ...current,
        [dependencyKey]: selectionMode === "single"
          ? { [product.selectionId]: choice }
          : { ...existing, [product.selectionId]: choice },
      };
    });
  }

  function changeOfficialProductQuantity(
    dependencyKey: string,
    selectionId: string,
    quantity: number,
  ) {
    setProductChoices((current) => {
      const existing = current[dependencyKey]?.[selectionId];
      if (!existing) return current;
      return {
        ...current,
        [dependencyKey]: {
          ...current[dependencyKey],
          [selectionId]: { ...existing, quantity },
        },
      };
    });
  }

  async function saveOfficialProducts(dependencyKey: string) {
    const choices = Object.values(productChoices[dependencyKey] || {});
    if (!choices.length || readOnly || Object.keys(dirtyRef.current).length) return;
    setBusy(`product-save:${dependencyKey}`);
    setMessage("Verifying the selected product against the exact approved register...");
    try {
      await action("work_pack_select_official_products", {
        dependencyKey,
        selections: choices.map(({ product, quantity }) => ({
          selectionId: product.selectionId,
          snapshotId: product.snapshotId,
          quantity,
        })),
      });
      setProductChoices((current) => ({ ...current, [dependencyKey]: {} }));
      setProductResults((current) => ({ ...current, [dependencyKey]: [] }));
      setConflict("");
      setMessage("Approved installed product saved and verified.");
    } catch (productError) {
      const error = productError instanceof Error
        ? productError as Error & { code?: string }
        : new Error("The approved product could not be saved.");
      await reloadAfterConflict(error).catch((nextError) => {
        setMessage(nextError instanceof Error
          ? nextError.message
          : "The approved product could not be saved.");
      });
    } finally {
      setBusy("");
    }
  }

  async function runGovernedCalculator(dependencyKey: string) {
    if (readOnly || Object.keys(dirtyRef.current).length) return;
    setBusy(`calculator:${dependencyKey}`);
    setMessage("Running the exact approved program calculation...");
    try {
      await action("work_pack_run_calculator", { dependencyKey });
      setConflict("");
      setMessage("Calculation completed. Creditex independent review is now required before the governed result is shown.");
    } catch (calculatorError) {
      const error = calculatorError instanceof Error
        ? calculatorError as Error & { code?: string }
        : new Error("The governed calculation could not be run.");
      await reloadAfterConflict(error).catch((nextError) => {
        setMessage(nextError instanceof Error
          ? nextError.message
          : "The governed calculation could not be run.");
      });
    } finally {
      setBusy("");
    }
  }

  async function uploadToBrowserCustody(
    context: PromptContext,
    file: File,
    purpose: CreditexWorkPackBrowserUploadPurpose,
  ) {
    if (file.size < 1 || file.size > 50 * 1024 * 1024) {
      throw new Error("Choose a file no larger than 50 MB.");
    }
    const bytes = await file.arrayBuffer();
    const sha256 = await browserRawSha256(bytes);
    const clientUploadHash = await browserWorkPackSha256({
      contract: BROWSER_UPLOAD_CONTRACT,
      caseInstanceId: packRef.current.instance.id,
      responseKey: responseKey(context),
      purpose,
      sha256,
    });
    const clientUploadId = `web-${purpose}-${clientUploadHash.slice(7)}`;
    const formData = new FormData();
    formData.set("caseInstanceId", packRef.current.instance.id);
    formData.set("sectionKey", context.section.sectionKey);
    if (context.repeatInstanceKey) {
      formData.set("repeatInstanceKey", context.repeatInstanceKey);
    }
    formData.set("promptKey", context.prompt.promptKey);
    formData.set("clientUploadId", clientUploadId);
    formData.set("purpose", purpose);
    formData.set("file", file);
    const token = await user.getIdToken();
    const responseValue = await fetch(`${ENDPOINT}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const result = await responseValue.json().catch(() => ({})) as BrowserUploadResponse;
    const upload = result.upload;
    const exactStatus = (responseValue.status === 201 && result.status === "applied")
      || (responseValue.status === 200 && result.status === "duplicate");
    if (!responseValue.ok || result.ok !== true || !exactStatus || !upload) {
      throw new Error(result.error || "The exact field file could not be retained.");
    }
    if (
      upload.clientUploadId !== clientUploadId
      || upload.sha256 !== sha256
      || upload.sizeBytes !== file.size
      || upload.contentType.toLowerCase() !== file.type.toLowerCase()
      || upload.fileName !== file.name
      || upload.purpose !== purpose
      || upload.promptKey !== responseKey(context)
      || !upload.deviceId
      || !upload.sessionId
      || !Number.isFinite(Date.parse(upload.capturedAt))
    ) {
      throw new Error("The retained field file did not match this exact capture.");
    }
    return upload;
  }

  async function reloadAfterConflict(error: Error & { code?: string }) {
    if (error.code !== "WORK_PACK_REVISION_CONFLICT") throw error;
    const latest = await onReload();
    const next = latest.find((item) => item.instance.instanceKey === pack.instance.instanceKey);
    if (next) {
      setPack(next);
      setResponse(next.response);
      packRef.current = next;
      setDirty({});
      setConflict("This form changed elsewhere. The current saved version has been reloaded. Review this page before continuing.");
    }
  }

  const flushDirty = useCallback(async () => {
    const saving = { ...dirtyRef.current };
    const patches = Object.values(saving);
    if (!patches.length || readOnly) return;
    setBusy("save");
    setMessage("Saving...");
    try {
      const saved = await action("work_pack_commit", { sectionPatches: patches });
      const pending = Object.fromEntries(Object.entries(dirtyRef.current)
        .filter(([key, patch]) => saving[key] !== patch));
      dirtyRef.current = pending;
      setDirty(pending);
      if (Object.keys(pending).length) {
        setResponse(mergeWorkPackSectionPatches(
          saved.response,
          saved.definition.schema.sections,
          Object.values(pending),
        ));
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          saveTimer.current = null;
          void flushDirtyRef.current();
        }, 150);
      }
      setConflict("");
      setMessage(Object.keys(pending).length ? "Saving latest changes..." : "Saved");
    } catch (saveError) {
      const error = saveError instanceof Error ? saveError : new Error("The form could not be saved.");
      await reloadAfterConflict(error as Error & { code?: string }).catch((nextError) => {
        setMessage(nextError instanceof Error ? nextError.message : "The form could not be saved.");
      });
    } finally {
      setBusy("");
    }
  // action and reloadAfterConflict intentionally use refs for exact latest CAS state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  useEffect(() => {
    flushDirtyRef.current = flushDirty;
  }, [flushDirty]);

  function scheduleSave(nextDirty: Record<string, CreditexWorkPackSectionPatch>) {
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void flushDirty();
    }, 700);
  }

  function changeAnswer(
    section: CreditexWorkPackSection,
    repeatInstanceKey: string,
    promptKey: string,
    answer: unknown,
  ) {
    if (readOnly || pack.instance.status === "completed") return;
    const key = section.repeatability
      ? `${section.sectionKey}:${repeatInstanceKey}` : section.sectionKey;
    const patch: CreditexWorkPackSectionPatch = {
      sectionKey: section.sectionKey,
      repeatInstanceKey: repeatInstanceKey || undefined,
      answers: {
        ...(dirtyRef.current[key]?.answers || {}),
        [promptKey]: answer,
      },
    };
    const nextDirty = { ...dirtyRef.current, [key]: patch };
    setResponse((current) => mergeWorkPackSectionPatches(
      current,
      pack.definition.schema.sections,
      [patch],
    ));
    setSignatureDrafts({});
    scheduleSave(nextDirty);
  }

  function addRepeat(section: CreditexWorkPackSection) {
    if (!section.repeatability || readOnly) return;
    const instanceKey = `item-${crypto.randomUUID()}`;
    const key = `${section.sectionKey}:${instanceKey}`;
    const patch: CreditexWorkPackSectionPatch = {
      sectionKey: section.sectionKey,
      repeatInstanceKey: instanceKey,
      answers: {},
    };
    const nextDirty = { ...dirtyRef.current, [key]: patch };
    setResponse((current) => mergeWorkPackSectionPatches(
      current,
      pack.definition.schema.sections,
      [patch],
    ));
    setRepeatSelection((current) => ({ ...current, [section.sectionKey]: instanceKey }));
    scheduleSave(nextDirty);
  }

  function removeRepeat(section: CreditexWorkPackSection, instanceKey: string) {
    if (!section.repeatability || readOnly) return;
    const key = `${section.sectionKey}:${instanceKey}`;
    const patch: CreditexWorkPackSectionPatch = {
      sectionKey: section.sectionKey,
      repeatInstanceKey: instanceKey,
      remove: true,
      answers: {},
    };
    const nextDirty = { ...dirtyRef.current, [key]: patch };
    setResponse((current) => mergeWorkPackSectionPatches(
      current,
      pack.definition.schema.sections,
      [patch],
    ));
    setRepeatSelection((current) => ({ ...current, [section.sectionKey]: "" }));
    scheduleSave(nextDirty);
  }

  async function movePage(direction: -1 | 1) {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await flushDirty();
    setPage((current) => Math.max(0, Math.min(sections.length, current + direction)));
  }

  async function openReference(document: CreditexActivityWorkPackReferenceDocumentProjection) {
    setBusy(`reference:${document.sourceArtifactId}`);
    try {
      const blob = await exactAuthenticatedBlob({
        user,
        path: document.openUrl,
        sha256: document.sourceArtifactSha256,
        contentType: document.contentType,
        sizeBytes: document.sizeBytes,
      });
      setPreview({
        title: document.title,
        fileName: document.originalFileName,
        contentType: document.contentType,
        url: URL.createObjectURL(blob),
      });
      setOpenedReferences((current) => new Set(current).add(referenceKey(document)));
      if (document.acknowledgementMode === "viewed") {
        await action("work_pack_commit", {
          referenceAcknowledgements: [{
            sectionKey: document.sectionKey,
            repeatInstanceKey: document.repeatInstanceKey || undefined,
            promptKey: document.promptKey,
            sourceArtifactId: document.sourceArtifactId,
            acknowledgedAt: new Date().toISOString(),
          }],
        });
        setMessage("Approved document opened and recorded.");
      }
    } catch (openError) {
      setMessage(openError instanceof Error ? openError.message : "The approved document could not be opened.");
    } finally {
      setBusy("");
    }
  }

  async function acknowledgeReference(document: CreditexActivityWorkPackReferenceDocumentProjection) {
    if (!openedReferences.has(referenceKey(document))) {
      setMessage("Open and read the approved document before confirming it.");
      return;
    }
    setBusy(`ack:${document.sourceArtifactId}`);
    try {
      await action("work_pack_commit", {
        referenceAcknowledgements: [{
          sectionKey: document.sectionKey,
          repeatInstanceKey: document.repeatInstanceKey || undefined,
          promptKey: document.promptKey,
          sourceArtifactId: document.sourceArtifactId,
          acknowledgedAt: new Date().toISOString(),
        }],
      });
      setMessage("Approved document acknowledgement saved.");
    } catch (ackError) {
      setMessage(ackError instanceof Error ? ackError.message : "The acknowledgement could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function uploadArtifact(context: PromptContext, file: File) {
    setBusy(`artifact:${responseKey(context)}`);
    try {
      const upload = await uploadToBrowserCustody(context, file, "artifact");
      await action("work_pack_commit", {
        artifactLinks: [{
          sectionKey: context.section.sectionKey,
          repeatInstanceKey: context.repeatInstanceKey || undefined,
          promptKey: context.prompt.promptKey,
          clientUploadId: upload.clientUploadId,
          deviceId: upload.deviceId,
        }],
      }, upload.deviceId);
      setMessage("Evidence saved to this activity form.");
    } catch (uploadError) {
      setMessage(uploadError instanceof Error ? uploadError.message : "The evidence could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function captureSignature(
    context: PromptContext,
    role: CreditexWorkPackSignerRole,
    draft: SignatureDraft,
  ) {
    if (!context.prompt.attestation || pack.instance.status !== "ready_to_sign") return;
    const binding = pack.signerBindings.find((item) => item.roleKey === role.roleKey);
    if (!binding || !signatureReady(role, draft)) {
      setMessage("Complete the signer details and draw the signature before saving it.");
      return;
    }
    setBusy(`signature:${responseKey(context)}`);
    try {
      const signerIdentity: CreditexActivityWorkPackSignerIdentity = {
        contract: CREDITEX_ACTIVITY_WORK_PACK_SIGNER_IDENTITY_CONTRACT,
        roleKey: role.roleKey,
        capacity: role.capacity,
        identitySource: role.identitySource,
        signerName: binding.signerName,
        signerUid: binding.signerUid,
        fields: { ...binding.fields },
      };
      const signerIdentitySha256 = await browserWorkPackSha256(signerIdentity);
      const fullPromptKey = responseKey(context);
      const attestation: CreditexActivityWorkPackSignatureAttestation = {
        contract: CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_ATTESTATION_CONTRACT,
        promptKey: fullPromptKey,
        signerRoleKey: role.roleKey,
        text: context.prompt.attestation.text,
        version: context.prompt.attestation.version,
        sourceBindingTargetKey: context.prompt.attestation.sourceBindingTargetKey,
        signerIdentity,
        signerIdentitySha256,
        definitionSha256: pack.signatureBindings.definitionSha256,
        prefillSha256: pack.signatureBindings.prefillSha256,
        responseSha256: pack.signatureBindings.responseSha256,
        declarationsSha256: pack.signatureBindings.declarationsSha256,
      };
      const attestationSha256 = await browserWorkPackSha256(attestation);
      const signedAt = new Date().toISOString();
      const signaturePayload: CreditexActivityWorkPackSignaturePayload = {
        contract: CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT,
        instanceKey: pack.instance.instanceKey,
        caseInstanceId: pack.instance.id,
        promptKey: fullPromptKey,
        signerRoleKey: role.roleKey,
        signerName: signerIdentity.signerName,
        signerCapacity: role.capacity,
        signerIdentitySha256,
        attestationSha256,
        definitionSha256: pack.signatureBindings.definitionSha256,
        prefillSha256: pack.signatureBindings.prefillSha256,
        responseSha256: pack.signatureBindings.responseSha256,
        declarationsSha256: pack.signatureBindings.declarationsSha256,
        strokes: draft.strokes,
        signedAt,
      };
      const signaturePayloadSha256 = await browserWorkPackSha256(signaturePayload);
      const bytes = signaturePacketBytes(signaturePayload);
      const signatureSha256 = await browserRawSha256(bytes.buffer as ArrayBuffer);
      const file = new File(
        [bytes],
        `governed-signature-${normaliseSha256(signaturePayloadSha256).slice(0, 16)}.json`,
        { type: "application/json", lastModified: Date.parse(signedAt) },
      );
      const upload = await uploadToBrowserCustody(context, file, "signature");
      if (upload.sha256 !== signatureSha256) {
        throw new Error("The retained signature did not match the visible strokes.");
      }
      const deviceAttestation = {
        contract: CREDITEX_ACTIVITY_WORK_PACK_DEVICE_ATTESTATION_CONTRACT,
        deviceId: upload.deviceId,
        appId: "aea-tlink-web",
        appVersion: "1",
        appBuild: "web",
        sessionId: upload.sessionId,
        capturedByUid: user.uid,
        signedAt,
        deviceContext: {
          platform: "web",
          language: navigator.language,
          userAgent: navigator.userAgent.slice(0, 500),
          touchPoints: navigator.maxTouchPoints,
        },
      } as const;
      const deviceAttestationSha256 = await browserWorkPackSha256(deviceAttestation);
      await action("work_pack_capture_signatures", {
        packets: [{
          sectionKey: context.section.sectionKey,
          repeatInstanceKey: context.repeatInstanceKey || undefined,
          promptKey: context.prompt.promptKey,
          clientUploadId: upload.clientUploadId,
          signerIdentity,
          signerIdentitySha256,
          signaturePayload,
          signaturePayloadSha256,
          attestation,
          attestationSha256,
          deviceAttestation,
          deviceAttestationSha256,
          signatureSha256,
        }],
      }, upload.deviceId);
      setSignatureDrafts((current) => ({ ...current, [fullPromptKey]: { ...draft, strokes: [] } }));
      setMessage("Visible signature saved against this exact prepared form.");
    } catch (signatureError) {
      setMessage(signatureError instanceof Error ? signatureError.message : "The signature could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function prepareSigning() {
    setBusy("prepare");
    try {
      const next = await action("work_pack_prepare_signing", {});
      setPage(firstIncompleteWorkPackPage(next));
      setMessage("The exact form version is locked. Capture the visible signatures now.");
    } catch (prepareError) {
      setMessage(prepareError instanceof Error ? prepareError.message : "The form could not be prepared for signing.");
    } finally {
      setBusy("");
    }
  }

  async function finalize() {
    setBusy("finalize");
    try {
      const next = await action("work_pack_finalize", {});
      setMessage("Completed. The signed activity PDF is retained with this job.");
      if (next.finalRecord) await openFinalRecord(next);
    } catch (finalizeError) {
      setMessage(finalizeError instanceof Error ? finalizeError.message : "The final signed record could not be created.");
    } finally {
      setBusy("");
    }
  }

  async function openFinalRecord(source = pack) {
    const record = source.finalRecord;
    if (!record) return;
    setBusy("final-record");
    try {
      const blob = await exactAuthenticatedBlob({
        user,
        path: record.downloadUrl,
        sha256: record.pdfSha256,
        contentType: record.contentType,
        sizeBytes: record.sizeBytes,
      });
      setPreview({
        title: "Completed signed activity record",
        fileName: record.fileName,
        contentType: record.contentType,
        url: URL.createObjectURL(blob),
      });
      setMessage("");
    } catch (recordError) {
      setMessage(recordError instanceof Error ? recordError.message : "The signed record could not be opened.");
    } finally {
      setBusy("");
    }
  }

  async function saveCustomer(next: CreditexActivityWorkPackCustomerProjection) {
    setBusy("customer");
    try {
      await action("work_pack_update_customer_context", {
        customerContextBinding: pack.customerContextBinding,
        customerPatch: { firstName: next.firstName, lastName: next.lastName },
        sitePatch: {
          addressLine1: next.addressLine1,
          addressLine2: next.addressLine2,
          suburb: next.suburb,
          state: next.state,
          postcode: next.postcode,
        },
        contactPatch: { phone: next.phone, email: next.email },
      });
      setEditingCustomer(false);
      setMessage("Customer and site details corrected. Existing signatures were invalidated by the server.");
    } catch (customerError) {
      setMessage(customerError instanceof Error ? customerError.message : "Customer details could not be updated.");
    } finally {
      setBusy("");
    }
  }

  return <article className={styles.pack} data-status={pack.instance.status}>
    <button type="button" className={styles.packToggle} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span><b>{pack.definition.title}</b><small>{pack.instance.activityDate} | Version {pack.definition.version}</small></span>
      <strong>{statusLabel(pack.instance.status)}</strong>
    </button>
    {open && <div className={styles.packBody}>
      <IdentityBoundary pack={pack} />
      {conflict && <div className={styles.conflict} role="alert"><strong>This form was updated elsewhere</strong><span>{conflict}</span></div>}
      {pack.definition.schema.dependencies.length > 0 && <section className={styles.dependencies}>
        <header><span>Job setup</span><strong>Products, scenarios and calculations</strong></header>
        {pack.definition.schema.dependencies.map((dependency) => {
          const ready = dependencyReady({ ...pack, response }, dependency.dependencyKey);
          const resolution = response.dependencyResolutions[dependency.dependencyKey];
          const calculatorOutput = dependency.kind === "calculator"
            ? pack.calculatorOutputs.find((output) => output.dependencyKey === dependency.dependencyKey)
            : null;
          const calculatorPendingReview = dependency.kind === "calculator"
            ? pack.calculatorPendingReviews.find((review) => review.dependencyKey === dependency.dependencyKey)
            : null;
          return <div key={dependency.dependencyKey} data-ready={ready}>
            <span aria-hidden="true">{ready ? "OK" : "!"}</span>
            <p>
              <strong>{dependency.label}</strong>
              {dependency.kind === "product" && !ready
                ? <div className={styles.productPicker}>
                    <label className={styles.dependencyControl}>Find the exact installed product
                      <span className={styles.productSearch}>
                        <input
                          type="search"
                          value={productQueries[dependency.dependencyKey] || ""}
                          placeholder="Brand, model or approval number"
                          disabled={readOnly || Boolean(busy) || Boolean(Object.keys(dirty).length)}
                          onChange={(event) => setProductQueries((current) => ({
                            ...current,
                            [dependency.dependencyKey]: event.target.value,
                          }))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void findOfficialProducts(dependency.dependencyKey);
                            }
                          }}
                        />
                        <button
                          type="button"
                          disabled={readOnly || Boolean(busy) || Boolean(Object.keys(dirty).length)}
                          onClick={() => void findOfficialProducts(dependency.dependencyKey)}
                        >{busy === `product-search:${dependency.dependencyKey}` ? "Checking..." : "Search"}</button>
                      </span>
                    </label>
                    {(productResults[dependency.dependencyKey] || []).length > 0 && <div className={styles.productResults}>
                      {(productResults[dependency.dependencyKey] || []).map((product) => {
                        const selected = productChoices[dependency.dependencyKey]?.[product.selectionId];
                        return <div key={`${product.snapshotId}:${product.selectionId}`} data-selected={Boolean(selected)}>
                          <button
                            type="button"
                            aria-pressed={Boolean(selected)}
                            disabled={readOnly || Boolean(busy)}
                            onClick={() => toggleOfficialProduct(
                              dependency.dependencyKey,
                              dependency.selectionMode,
                              product,
                            )}
                          >
                            <strong>{[product.brand, product.model].filter(Boolean).join(" ") || product.manufacturer}</strong>
                            <span>{[product.manufacturer, product.series].filter(Boolean).join(" | ")}</span>
                            <small>{product.registrationNumber || product.certificateNumber || product.sourceRecordKey} | {product.approvalStatus}</small>
                          </button>
                          {selected && <label>Quantity
                            <input
                              type="number"
                              min="1"
                              max="1000"
                              step="1"
                              value={selected.quantity}
                              onChange={(event) => changeOfficialProductQuantity(
                                dependency.dependencyKey,
                                product.selectionId,
                                Math.max(1, Math.min(1000, Number(event.target.value) || 1)),
                              )}
                            />
                          </label>}
                        </div>;
                      })}
                      <button
                        type="button"
                        className={styles.productSave}
                        disabled={!Object.keys(productChoices[dependency.dependencyKey] || {}).length || Boolean(busy)}
                        onClick={() => void saveOfficialProducts(dependency.dependencyKey)}
                      >{busy === `product-save:${dependency.dependencyKey}` ? "Verifying..." : "Use selected product"}</button>
                    </div>}
                  </div>
                : dependency.kind === "scenario" && !ready
                ? <label className={styles.dependencyControl}>Choose the job scenario
                    <select
                      aria-label={`${dependency.label} scenario`}
                      value={resolution?.referenceIds[0] || ""}
                      disabled={readOnly || Boolean(busy) || Boolean(Object.keys(dirty).length)}
                      onChange={(event) => void chooseScenario(dependency.dependencyKey, event.target.value)}
                    >
                      <option value="">Choose scenario</option>
                      {dependency.scenarioCodes.map((scenarioCode) => <option key={scenarioCode} value={scenarioCode}>{scenarioCode}</option>)}
                    </select>
                  </label>
                : calculatorOutput
                ? <><b className={styles.verifiedCalculation}>Verified {calculatorOutput.claimOutputLabel}: {calculatorOutput.quantity} {calculatorOutput.unit}</b><small>{calculatorOutput.calculatorKey} v{calculatorOutput.calculatorVersion} | Verified {new Date(calculatorOutput.verifiedAt).toLocaleString("en-AU")} | Receipt {calculatorOutput.executionReceiptSha256.slice(0, 19)}</small><small>This is the exact governed result for this job. The correct {calculatorOutput.claimOutputCode} action remains separate until evidence and submission checks pass.</small></>
                : dependency.kind === "calculator" && calculatorPendingReview
                  ? <span className={styles.calculatorReview}><b>Calculated securely</b><small>Creditex independent review is required before the governed result can be shown or used.</small><small>Run {calculatorPendingReview.calculationRunId} | {new Date(calculatorPendingReview.runAt).toLocaleString("en-AU")}</small></span>
                  : dependency.kind === "calculator"
                    ? <button
                        type="button"
                        className={styles.calculateButton}
                        disabled={readOnly || Boolean(busy) || Boolean(Object.keys(dirty).length)}
                        onClick={() => void runGovernedCalculator(dependency.dependencyKey)}
                      >{busy === `calculator:${dependency.dependencyKey}` ? "Calculating..." : "Calculate governed result"}</button>
                : <small>{statusLabel(dependency.kind)} | {ready ? "Verified" : "Creditex verification required"}</small>}
            </p>
          </div>;
        })}
      </section>}
      <nav className={styles.steps} aria-label="Activity form sections">
        {sections.map((section, index) => <button type="button" key={section.sectionKey} aria-current={page === index ? "step" : undefined} onClick={() => setPage(index)}><span>{index + 1}</span><small>{section.title}</small></button>)}
        <button type="button" aria-current={reviewPage ? "step" : undefined} onClick={() => setPage(sections.length)}><span>R</span><small>Review</small></button>
      </nav>
      <p className={styles.stepCount}>Step {Math.min(page + 1, sections.length + 1)} of {sections.length + 1}</p>
      {currentSection ? <SectionPage
        pack={{ ...pack, response }}
        section={currentSection}
        repeatSelection={repeatSelection}
        openedReferences={openedReferences}
        signatureDrafts={signatureDrafts}
        busy={busy}
        readOnly={readOnly}
        onSelectRepeat={(instanceKey) => setRepeatSelection((current) => ({ ...current, [currentSection.sectionKey]: instanceKey }))}
        onAddRepeat={() => addRepeat(currentSection)}
        onRemoveRepeat={(instanceKey) => removeRepeat(currentSection, instanceKey)}
        onChange={(repeatInstanceKey, promptKey, value) => changeAnswer(currentSection, repeatInstanceKey, promptKey, value)}
        onOpenReference={openReference}
        onAcknowledgeReference={acknowledgeReference}
        onUpload={uploadArtifact}
        onSignatureDraft={(key, draft) => setSignatureDrafts((current) => ({ ...current, [key]: draft }))}
        onCaptureSignature={captureSignature}
      /> : <ReviewPage pack={{ ...pack, response }} editingCustomer={editingCustomer} readOnly={readOnly} busy={busy} onEditCustomer={() => setEditingCustomer(true)} onCancelCustomer={() => setEditingCustomer(false)} onSaveCustomer={saveCustomer} />}
      <div className={styles.navigation}>
        <button type="button" disabled={page === 0 || Boolean(busy)} onClick={() => void movePage(-1)}>Back</button>
        {!reviewPage ? <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => void movePage(1)}>Continue</button>
          : pack.instance.status === "completed" ? <button type="button" className={styles.primary} disabled={!pack.finalRecord || Boolean(busy)} onClick={() => void openFinalRecord()}>{busy === "final-record" ? "Opening..." : "Open signed PDF"}</button>
            : pack.instance.status === "ready_to_sign" ? <button type="button" className={styles.primary} disabled={!canFinalize || Boolean(busy)} onClick={() => void finalize()}>{busy === "finalize" ? "Creating signed PDF..." : "Finish and create signed PDF"}</button>
              : <button type="button" className={styles.primary} disabled={!canPrepare || Boolean(busy)} onClick={() => void prepareSigning()}>{busy === "prepare" ? "Preparing..." : "Prepare visible signatures"}</button>}
      </div>
      {reviewPage && !canPrepare && ["not_started", "in_progress"].includes(pack.instance.status) && <p className={styles.warning}>{nonSignatureBlockers[0]?.message || (!dependenciesReady ? "Creditex or dispatch must verify the required product, scenario and governed program calculation before this activity can be signed. Do not start regulated work while this block remains." : "Complete the required questions and evidence before signing.")}</p>}
      {reviewPage && pack.instance.status === "ready_to_sign" && !canFinalize && <p className={styles.warning}>{completion.blockers[0]?.message || "Capture every visible required signature before finishing."}</p>}
      {message && <p className={styles.status} role="status">{message}</p>}
      {preview && <PreviewDialog preview={preview} onClose={() => setPreview(null)} />}
    </div>}
  </article>;
}

function IdentityBoundary({ pack }: { pack: CreditexAssignedActivityWorkPackProjection }) {
  const provider = pack.executionContext.provider;
  const installer = pack.executionContext.installerBusiness;
  const technician = pack.executionContext.assignment;
  const customer = pack.customerContext;
  return <section className={styles.identity} aria-label="Bound form identities">
    <header><span>Bound to this exact job</span><strong>These names and businesses will appear in the completed activity document</strong></header>
    <dl>
      <div><dt>Authorised provider</dt><dd>{provider.tradingName || provider.legalName}</dd><small>{provider.legalName}{provider.abn ? ` | ABN ${provider.abn}` : ""}</small></div>
      <div><dt>Installer business</dt><dd>{installer.participantTradingName || installer.businessName}</dd><small>{installer.participantLegalName || installer.contactName}{(installer.participantAbn || installer.verifiedAbn || installer.abn) ? ` | ABN ${installer.participantAbn || installer.verifiedAbn || installer.abn}` : ""}</small><small>{[installer.contactName, installer.phone, installer.email].filter(Boolean).join(" | ")}</small></div>
      <div><dt>Assigned technician</dt><dd>{technician.displayName || `${technician.firstName} ${technician.lastName}`.trim()}</dd><small>{[technician.role, technician.phone, technician.email].filter(Boolean).join(" | ")}</small></div>
      <div><dt>Customer and site</dt><dd>{`${customer.firstName} ${customer.lastName}`.trim() || "Customer details protected"}</dd><small>{customerAddress(customer) || "Protected site details"}</small><small>{[customer.phone, customer.email].filter(Boolean).join(" | ")}</small></div>
    </dl>
  </section>;
}

function SectionPage({
  pack,
  section,
  repeatSelection,
  openedReferences,
  signatureDrafts,
  busy,
  readOnly,
  onSelectRepeat,
  onAddRepeat,
  onRemoveRepeat,
  onChange,
  onOpenReference,
  onAcknowledgeReference,
  onUpload,
  onSignatureDraft,
  onCaptureSignature,
}: {
  pack: CreditexAssignedActivityWorkPackProjection;
  section: CreditexWorkPackSection;
  repeatSelection: Record<string, string>;
  openedReferences: ReadonlySet<string>;
  signatureDrafts: Record<string, SignatureDraft>;
  busy: string;
  readOnly: boolean;
  onSelectRepeat: (instanceKey: string) => void;
  onAddRepeat: () => void;
  onRemoveRepeat: (instanceKey: string) => void;
  onChange: (repeatInstanceKey: string, promptKey: string, value: unknown) => void;
  onOpenReference: (document: CreditexActivityWorkPackReferenceDocumentProjection) => Promise<void>;
  onAcknowledgeReference: (document: CreditexActivityWorkPackReferenceDocumentProjection) => Promise<void>;
  onUpload: (context: PromptContext, file: File) => Promise<void>;
  onSignatureDraft: (key: string, draft: SignatureDraft) => void;
  onCaptureSignature: (context: PromptContext, role: CreditexWorkPackSignerRole, draft: SignatureDraft) => Promise<void>;
}) {
  const instances = section.repeatability
    ? pack.response.repeatableSections[section.sectionKey] || []
    : [{ instanceKey: "", answers: pack.response.answers }];
  const selectedKey = section.repeatability
    ? repeatSelection[section.sectionKey] || instances[0]?.instanceKey || "" : "";
  const selected = instances.find((item) => item.instanceKey === selectedKey);
  const instanceAnswers = selected?.answers || (section.repeatability ? {} : pack.response.answers);
  const prompts = section.prompts.filter((prompt) =>
    creditexActivityWorkPackVisibilityMatches(
      prompt.visibility,
      pack.response.answers,
      instanceAnswers,
    )).sort((left, right) => left.order - right.order);
  return <section className={styles.page}>
    <header><span>{section.repeatability ? "Repeatable section" : "Section"}</span><h4>{section.title}</h4>{section.description && <p>{section.description}</p>}</header>
    {section.repeatability && <div className={styles.repeat}>
      <strong>{section.repeatability.itemLabel}s</strong>
      <small>Add {section.repeatability.minimumInstances} to {section.repeatability.maximumInstances}. Each item keeps its own answers and evidence.</small>
      <div>{instances.map((instance, index) => <button type="button" key={instance.instanceKey} data-selected={selectedKey === instance.instanceKey} onClick={() => onSelectRepeat(instance.instanceKey)}>{section.repeatability?.itemLabel} {index + 1}</button>)}</div>
      {!readOnly && <footer><button type="button" disabled={instances.length >= section.repeatability.maximumInstances} onClick={onAddRepeat}>Add {section.repeatability.itemLabel}</button>{selected && instances.length > section.repeatability.minimumInstances && <button type="button" onClick={() => onRemoveRepeat(selected.instanceKey)}>Remove selected</button>}</footer>}
    </div>}
    {section.repeatability && !selected ? <div className={styles.empty}><strong>Add the first {section.repeatability.itemLabel.toLowerCase()}</strong><span>This section needs a separate record for each item.</span></div>
      : <div className={styles.prompts}>{prompts.map((prompt) => {
        const context: PromptContext = { section, repeatInstanceKey: selectedKey, prompt };
        return <PromptField key={responseKey(context)} pack={pack} context={context} answer={answerFor(pack.response, section, selectedKey, prompt.promptKey)} signatureDraft={signatureDrafts[responseKey(context)]} openedReferences={openedReferences} busy={busy} readOnly={readOnly} onChange={(value) => onChange(selectedKey, prompt.promptKey, value)} onOpenReference={onOpenReference} onAcknowledgeReference={onAcknowledgeReference} onUpload={(file) => onUpload(context, file)} onSignatureDraft={(draft) => onSignatureDraft(responseKey(context), draft)} onCaptureSignature={(role, draft) => onCaptureSignature(context, role, draft)} />;
      })}</div>}
  </section>;
}

function PromptField({
  pack,
  context,
  answer,
  signatureDraft,
  openedReferences,
  busy,
  readOnly,
  onChange,
  onOpenReference,
  onAcknowledgeReference,
  onUpload,
  onSignatureDraft,
  onCaptureSignature,
}: {
  pack: CreditexAssignedActivityWorkPackProjection;
  context: PromptContext;
  answer: unknown;
  signatureDraft?: SignatureDraft;
  openedReferences: ReadonlySet<string>;
  busy: string;
  readOnly: boolean;
  onChange: (value: unknown) => void;
  onOpenReference: (document: CreditexActivityWorkPackReferenceDocumentProjection) => Promise<void>;
  onAcknowledgeReference: (document: CreditexActivityWorkPackReferenceDocumentProjection) => Promise<void>;
  onUpload: (file: File) => Promise<void>;
  onSignatureDraft: (draft: SignatureDraft) => void;
  onCaptureSignature: (role: CreditexWorkPackSignerRole, draft: SignatureDraft) => Promise<void>;
}) {
  const { prompt } = context;
  const key = responseKey(context);
  const dependenciesBlocked = prompt.dependencyKeys.some((dependencyKey) =>
    !dependencyReady(pack, dependencyKey));
  const disabled = readOnly || dependenciesBlocked || pack.instance.status === "completed";
  const stage = pack.definition.schema.stages.find((item) => item.stageKey === prompt.stageKey);
  const attachments = Array.isArray(answer)
    ? answer.filter((item): item is string => typeof item === "string") : [];
  const references = pack.referenceDocuments.filter((document) => document.responseKey === key);
  const role = signatureRole(pack, prompt);
  const draft = role ? signatureDraft || defaultSignatureDraft(pack, role) : null;
  const signerBinding = role
    ? pack.signerBindings.find((binding) => binding.roleKey === role.roleKey)
    : null;
  const capturedSignatures = pack.signatures.filter((signature) =>
    signature.action === "captured"
    && signature.promptKey === key
    && signature.signerRole === prompt.signerRoleKey);
  return <fieldset className={styles.prompt} disabled={disabled && prompt.type !== "reference_document"}>
    <legend>{prompt.label}{prompt.required ? " *" : ""}</legend>
    <div className={styles.promptMeta}>{stage && <span>{stage.label}</span>}{prompt.required && <b>Required</b>}</div>
    {prompt.instructions && <p>{prompt.instructions}</p>}
    {dependenciesBlocked && <p className={styles.warning}>Creditex or dispatch must verify this prompt&apos;s governed product, scenario and program calculation before regulated work starts.</p>}
    {(prompt.type === "text" || prompt.type === "textarea") && (prompt.type === "textarea"
      ? <textarea rows={4} value={typeof answer === "string" ? answer : ""} minLength={prompt.minimumLength || undefined} maxLength={prompt.maximumLength || undefined} onChange={(event) => onChange(event.target.value)} />
      : <input type="text" value={typeof answer === "string" ? answer : ""} minLength={prompt.minimumLength || undefined} maxLength={prompt.maximumLength || undefined} onChange={(event) => onChange(event.target.value)} />)}
    {prompt.type === "number" && <label className={styles.number}><input type="number" value={typeof answer === "number" ? answer : ""} min={prompt.minimumNumber ?? undefined} max={prompt.maximumNumber ?? undefined} step={prompt.numberStep ?? "any"} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} />{prompt.unit && <span>{prompt.unit}</span>}</label>}
    {prompt.type === "date" && <input type="date" value={typeof answer === "string" ? answer : ""} onChange={(event) => onChange(event.target.value)} />}
    {prompt.type === "select" && <select value={typeof answer === "string" ? answer : ""} onChange={(event) => onChange(event.target.value)}><option value="">Choose an answer</option>{prompt.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
    {prompt.type === "multiselect" && <div className={styles.choiceList}>{prompt.options.map((option) => {
      const selected = Array.isArray(answer) && answer.includes(option.value);
      return <label key={option.value}><input type="checkbox" checked={selected} onChange={(event) => onChange(event.target.checked ? [...new Set([...(Array.isArray(answer) ? answer : []), option.value])] : (Array.isArray(answer) ? answer : []).filter((item) => item !== option.value))} /><span>{option.label}</span></label>;
    })}</div>}
    {prompt.type === "checkbox" && <label className={styles.confirm}><input type="checkbox" checked={answer === true} onChange={(event) => onChange(event.target.checked)} /><span>{prompt.label}</span></label>}
    {(prompt.type === "photo" || prompt.type === "document") && <div className={styles.capture}>
      <div><strong>{attachments.length} saved</strong><small>{prompt.fileRequirement ? `${prompt.fileRequirement.minimumCount} to ${prompt.fileRequirement.maximumCount} required | ${prompt.fileRequirement.metadataRequired ? "metadata retained" : "standard file"}${prompt.fileRequirement.gpsRequired ? " | location required" : ""}` : "Governed file requirement"}</small></div>
      {!readOnly && <label><span>{busy === `artifact:${key}` ? "Saving..." : prompt.type === "photo" ? "Take or add photo" : "Add document"}</span><input type="file" disabled={Boolean(busy)} accept={prompt.fileRequirement?.allowedContentTypes.join(",")} capture={prompt.type === "photo" ? "environment" : undefined} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onUpload(file); event.currentTarget.value = ""; }} /></label>}
    </div>}
    {prompt.type === "reference_document" && <div className={styles.references}>
      {references.map((document) => {
        const acknowledgement = answer && typeof answer === "object" && !Array.isArray(answer)
          ? answer as Record<string, unknown> : null;
        const acknowledged = acknowledgement?.contract === CREDITEX_ACTIVITY_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT
          && acknowledgement.sourceArtifactId === document.sourceArtifactId;
        const opened = openedReferences.has(referenceKey(document));
        return <article key={document.sourceArtifactId}>
          <div><strong>{document.title}</strong><span>{document.version} | {Math.max(1, Math.round(document.sizeBytes / 1024))} KB</span></div>
          <button type="button" disabled={Boolean(busy)} onClick={() => void onOpenReference(document)}>{busy === `reference:${document.sourceArtifactId}` ? "Verifying..." : "Open approved document"}</button>
          {document.acknowledgementMode === "confirmed" && !acknowledged && !readOnly && <button type="button" disabled={Boolean(busy) || !opened} onClick={() => void onAcknowledgeReference(document)}>{opened ? "I have read and confirm" : "Open before confirming"}</button>}
          {document.acknowledgementMode !== "none" && <small>{acknowledged ? "Acknowledgement recorded" : document.acknowledgementText}</small>}
        </article>;
      })}
    </div>}
    {prompt.type === "signature" && role && draft && <div className={styles.signature}>
      {capturedSignatures.length > 0 && <div className={styles.capturedSignatures}>{capturedSignatures.map((signature) => <article key={signature.id}>
        <TradeWorkPackSignaturePad label={`${role.label} saved signature`} signerName={signature.signerName} signerCapacity={signature.signerCapacity} value={signature.signaturePayload.strokes} disabled onChange={() => undefined} />
        <small>Signed {new Date(signature.signedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })} | SHA-256 {normaliseSha256(signature.signatureSha256).slice(0, 12)}...</small>
      </article>)}</div>}
      {pack.instance.status !== "ready_to_sign" && !capturedSignatures.length ? <p className={styles.notice}>Complete the other required fields, then choose Prepare visible signatures on the Review step.</p> : null}
      {pack.instance.status === "ready_to_sign" && capturedSignatures.length < role.maximumSignatures && !readOnly && <>
        <div className={styles.boundSigner}>
          <span>Signer fixed from this job</span>
          <strong>{signerBinding?.signerName || "Signer identity unavailable"}</strong>
          {role.identityRequirements.map((requirement) => <small key={requirement.fieldKey}>{requirement.label}: {signerBinding?.fields[requirement.fieldKey] || "Not available"}</small>)}
        </div>
        {prompt.attestation && <div className={styles.declaration}><strong>Declaration</strong><p>{prompt.attestation.text}</p><small>Version {prompt.attestation.version}</small></div>}
        <TradeWorkPackSignaturePad label={`${role.label} signature`} signerName={draft.signerName} signerCapacity={role.capacity} value={draft.strokes} disabled={Boolean(busy)} onChange={(strokes) => onSignatureDraft({ ...draft, strokes })} />
        <button type="button" className={styles.saveSignature} disabled={Boolean(busy) || !signerBinding || !signatureReady(role, draft)} onClick={() => void onCaptureSignature(role, draft)}>{busy === `signature:${key}` ? "Binding signature..." : "Save this visible signature"}</button>
      </>}
    </div>}
  </fieldset>;
}

function ReviewPage({
  pack,
  editingCustomer,
  readOnly,
  busy,
  onEditCustomer,
  onCancelCustomer,
  onSaveCustomer,
}: {
  pack: CreditexAssignedActivityWorkPackProjection;
  editingCustomer: boolean;
  readOnly: boolean;
  busy: string;
  onEditCustomer: () => void;
  onCancelCustomer: () => void;
  onSaveCustomer: (customer: CreditexActivityWorkPackCustomerProjection) => Promise<void>;
}) {
  const completion = creditexActivityWorkPackCompletion({
    workPack: pack.definition.schema,
    response: pack.response,
  });
  return <section className={styles.review}>
    <header><span>Review</span><h4>{completion.ready ? "Everything required is complete" : "Finish the remaining items"}</h4><p>{completion.completedPromptKeys.length} of {completion.requiredPromptKeys.length} required answers are complete.</p></header>
    {completion.blockers.length > 0 && <ul>{completion.blockers.map((blocker) => <li key={`${blocker.code}:${blocker.key}`}>{blocker.message}</li>)}</ul>}
    <section className={styles.customerReview}>
      <header><div><span>Customer and service site</span><strong>{`${pack.customerContext.firstName} ${pack.customerContext.lastName}`.trim() || "Protected customer"}</strong><small>{customerAddress(pack.customerContext)}</small></div>{!readOnly && pack.customerContext.editable && pack.instance.status !== "completed" && !editingCustomer && <button type="button" onClick={onEditCustomer}>Correct details</button>}</header>
      {editingCustomer && <CustomerCorrection initial={pack.customerContext} busy={busy === "customer"} onCancel={onCancelCustomer} onSave={onSaveCustomer} />}
    </section>
    {pack.definition.schema.documentOutputs.length > 0 && <section className={styles.outputs}><strong>Completed documents</strong>{pack.definition.schema.documentOutputs.map((output) => <div key={output.outputKey}><span>{output.title}</span><small>{output.required ? "Required signed output" : "Supporting output"} | Server renderer {output.rendererVersion}</small></div>)}</section>}
    {pack.finalRecord && <div className={styles.retained}><strong>Signed PDF retained</strong><span>{pack.finalRecord.fileName} | {Math.max(1, Math.round(pack.finalRecord.sizeBytes / 1024))} KB</span><small>SHA-256 {normaliseSha256(pack.finalRecord.pdfSha256)}</small></div>}
  </section>;
}

function CustomerCorrection({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial: CreditexActivityWorkPackCustomerProjection;
  busy: boolean;
  onCancel: () => void;
  onSave: (customer: CreditexActivityWorkPackCustomerProjection) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const field = (key: keyof CreditexActivityWorkPackCustomerProjection, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return <form className={styles.customerForm} onSubmit={(event) => { event.preventDefault(); void onSave(draft); }}>
    <label><span>First name</span><input value={draft.firstName} onChange={(event) => field("firstName", event.target.value)} /></label>
    <label><span>Last name</span><input value={draft.lastName} onChange={(event) => field("lastName", event.target.value)} /></label>
    <label><span>Phone</span><input type="tel" value={draft.phone} onChange={(event) => field("phone", event.target.value)} /></label>
    <label><span>Email</span><input type="email" value={draft.email} onChange={(event) => field("email", event.target.value)} /></label>
    <label className={styles.wide}><span>Address</span><input value={draft.addressLine1} onChange={(event) => field("addressLine1", event.target.value)} /></label>
    <label className={styles.wide}><span>Address line 2</span><input value={draft.addressLine2} onChange={(event) => field("addressLine2", event.target.value)} /></label>
    <label><span>Suburb</span><input value={draft.suburb} onChange={(event) => field("suburb", event.target.value)} /></label>
    <label><span>State</span><input value={draft.state} maxLength={3} onChange={(event) => field("state", event.target.value.toUpperCase())} /></label>
    <label><span>Postcode</span><input inputMode="numeric" value={draft.postcode} maxLength={4} onChange={(event) => field("postcode", event.target.value)} /></label>
    <footer className={styles.wide}><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className={styles.primary} disabled={busy}>{busy ? "Saving..." : "Save correction"}</button></footer>
  </form>;
}

function PreviewDialog({ preview, onClose }: { preview: Preview; onClose: () => void }) {
  return <div className={styles.previewBackdrop} role="presentation" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
    <section className={styles.previewDialog} role="dialog" aria-modal="true" aria-label={preview.title}>
      <header><div><span>Verified governed document</span><strong>{preview.title}</strong><small>{preview.fileName}</small></div><button type="button" onClick={onClose}>Close</button></header>
      <div>{preview.contentType === "application/pdf" ? <iframe src={preview.url} title={preview.title} /> : <img src={preview.url} alt={preview.title} />}</div>
      <footer><a href={preview.url} download={preview.fileName}>Download</a><button type="button" className={styles.primary} onClick={onClose}>Done</button></footer>
    </section>
  </div>;
}
