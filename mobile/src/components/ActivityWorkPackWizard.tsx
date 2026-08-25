import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SignatureCapture } from '@/components/SignatureCapture';
import { FieldButton } from '@/components/field-button';
import { colours, radius, spacing } from '@/lib/theme';
import type {
  FieldActivityWorkPack,
  FieldActivityWorkPackResponse,
  FieldWorkPackDependency,
  FieldWorkPackOfficialProduct,
  FieldWorkPackOfficialProductSelection,
  FieldWorkPackPrompt,
  FieldWorkPackSection,
  FieldWorkPackCustomerContext,
  FieldWorkPackReferenceDocumentProjection,
  FieldWorkPackSignature,
  FieldWorkPackSignatureDraft,
  FieldWorkPackSignerRole,
} from '@/lib/types';
import {
  fieldActivityWorkPackCompletion,
  fieldWorkPackSectionInstances,
  fieldWorkPackSections,
  fieldWorkPackVisibilityMatches,
  mergeFieldWorkPackSectionPatches,
  signatureDraftReady,
  workPackDependencyStatus,
  workPackPromptResponseKey,
  type FieldWorkPackSectionPatch,
} from '@/lib/work-packs';

export type ActivityWorkPackPromptContext = {
  pack: FieldActivityWorkPack;
  section: FieldWorkPackSection;
  repeatInstanceKey: string;
  prompt: FieldWorkPackPrompt;
};

const AUTOSAVE_DELAY_MS = 700;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'This work-pack change could not be saved.';
}

function responseAnswer(
  response: FieldActivityWorkPackResponse,
  section: FieldWorkPackSection,
  repeatInstanceKey: string,
  promptKey: string,
) {
  if (!section.repeatability) return response.answers[promptKey];
  return response.repeatableSections[section.sectionKey]
    ?.find((item) => item.instanceKey === repeatInstanceKey)
    ?.answers[promptKey];
}

function signatureDraft(
  role: FieldWorkPackSignerRole,
  binding?: FieldActivityWorkPack['signerBindings'][number],
): FieldWorkPackSignatureDraft {
  return {
    signerRoleKey: role.roleKey,
    signerName: binding?.signerName || '',
    signerCapacity: role.capacity,
    identity: { ...(binding?.fields || {}) },
    strokes: [],
    capturedAt: '',
  };
}

function capturedSignatureDraft(
  signature: FieldWorkPackSignature,
): FieldWorkPackSignatureDraft {
  const signedAtMs = Date.parse(signature.signedAt);
  const origin = Number.isFinite(signedAtMs) ? signedAtMs : 0;
  const strokes = Array.isArray(signature.signaturePayload?.strokes)
    ? signature.signaturePayload.strokes
    : [];
  return {
    signerRoleKey: signature.signerRole,
    signerName: signature.signerName,
    signerCapacity: signature.signerCapacity,
    identity: {},
    strokes: strokes.map((stroke, strokeIndex) => ({
      strokeKey: `${signature.id}:${strokeIndex + 1}`,
      points: stroke.points.map((point) => ({
        x: point.x,
        y: point.y,
        pressure: point.pressure,
        capturedAtMs: origin + point.capturedAtOffsetMs,
      })),
    })),
    capturedAt: signature.signedAt,
  };
}

function newRepeatInstanceKey(section: FieldWorkPackSection) {
  return `${section.repeatability?.itemKey || section.sectionKey}-${Date.now()}`;
}

function readable(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initialFieldWorkPackPage(pack: FieldActivityWorkPack) {
  const sections = fieldWorkPackSections(pack);
  const completion = fieldActivityWorkPackCompletion({
    workPack: pack.definition.schema,
    response: pack.response,
    expectedSchemaSha256: pack.definition.schemaSha256,
  });
  if (completion.ready) return sections.length;
  const incomplete = new Set(completion.requiredPromptKeys.filter(
    (key) => !completion.completedPromptKeys.includes(key),
  ));
  const sectionIndex = sections.findIndex((section) => {
    const instances = fieldWorkPackSectionInstances(section, pack.response);
    if (section.repeatability && instances.length < section.repeatability.minimumInstances) {
      return true;
    }
    return instances.some((instance) => section.prompts.some((prompt) => incomplete.has(
      workPackPromptResponseKey(section, instance.instanceKey, prompt),
    )));
  });
  return sectionIndex < 0 ? 0 : sectionIndex;
}

export function ActivityWorkPackWizard({
  pack,
  conflict,
  pendingActions = [],
  busy,
  onSaveSections,
  onCaptureArtifact,
  onOpenReferenceDocument,
  onAcknowledgeReferenceDocument,
  onCaptureSignature,
  onPrepareSigning,
  onFinalize,
  onOpenFinalRecord,
  onUpdateCustomerContext,
  onFindOfficialProducts,
  onSelectOfficialProducts,
  onSelectScenario,
  onRunCalculator,
}: {
  pack: FieldActivityWorkPack;
  conflict?: string;
  pendingActions?: string[];
  busy: string;
  onSaveSections: (patches: FieldWorkPackSectionPatch[]) => Promise<void>;
  onCaptureArtifact: (context: ActivityWorkPackPromptContext) => Promise<string>;
  onOpenReferenceDocument: (
    context: ActivityWorkPackPromptContext,
    document: FieldWorkPackReferenceDocumentProjection,
  ) => Promise<void>;
  onAcknowledgeReferenceDocument: (
    context: ActivityWorkPackPromptContext,
    document: FieldWorkPackReferenceDocumentProjection,
    acknowledgedAt: string,
  ) => Promise<void>;
  onCaptureSignature: (
    context: ActivityWorkPackPromptContext,
    draft: FieldWorkPackSignatureDraft,
  ) => Promise<void>;
  onPrepareSigning: () => Promise<void>;
  onFinalize: () => Promise<void>;
  onOpenFinalRecord?: () => Promise<void>;
  onUpdateCustomerContext: (next: FieldWorkPackCustomerContext) => Promise<void>;
  onFindOfficialProducts: (
    dependencyKey: string,
    search: string,
  ) => Promise<FieldWorkPackOfficialProduct[]>;
  onSelectOfficialProducts: (
    dependencyKey: string,
    selections: FieldWorkPackOfficialProductSelection[],
  ) => Promise<void>;
  onSelectScenario: (dependencyKey: string, scenarioCode: string) => Promise<void>;
  onRunCalculator: (dependencyKey: string) => Promise<void>;
}) {
  // Keep the finished record visible on first open. The completed PDF is the
  // technician's useful hand-off, not an implementation detail to hide.
  const [open, setOpen] = useState(true);
  const [pageIndex, setPageIndex] = useState(() => initialFieldWorkPackPage(pack));
  const [response, setResponse] = useState(pack.response);
  const [repeatSelection, setRepeatSelection] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, FieldWorkPackSectionPatch>>({});
  const [signatureDrafts, setSignatureDrafts] = useState<Record<string, FieldWorkPackSignatureDraft>>({});
  const [pendingArtifacts, setPendingArtifacts] = useState<Record<string, string[]>>({});
  const [pendingSignatures, setPendingSignatures] = useState<Record<string, boolean>>({});
  const [operationError, setOperationError] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const responseSha256 = useRef(pack.instance.responseSha256);

  useEffect(() => () => {
    mounted.current = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  useEffect(() => {
    if (Object.keys(dirty).length > 0) return undefined;
    const refresh = setTimeout(() => setResponse(pack.response), 0);
    return () => clearTimeout(refresh);
  }, [dirty, pack.instance.responseSha256, pack.response]);

  useEffect(() => {
    if (responseSha256.current === pack.instance.responseSha256) return undefined;
    responseSha256.current = pack.instance.responseSha256;
    const refresh = setTimeout(() => {
      setPendingArtifacts({});
      setPendingSignatures({});
      setSignatureDrafts({});
    }, 0);
    return () => clearTimeout(refresh);
  }, [pack.instance.responseSha256]);

  const sections = useMemo(() => fieldWorkPackSections({ ...pack, response }), [pack, response]);
  const reviewPage = pageIndex >= sections.length;
  const section = reviewPage ? undefined : sections[pageIndex];
  const completion = useMemo(() => fieldActivityWorkPackCompletion({
    workPack: pack.definition.schema,
    response,
    expectedSchemaSha256: pack.definition.schemaSha256,
  }), [pack.definition.schema, pack.definition.schemaSha256, response]);

  async function flushDirty(nextDirty = dirty) {
    const patches = Object.values(nextDirty);
    if (!patches.length) return;
    try {
      await onSaveSections(patches);
      setOperationError('');
    } catch (error) {
      setOperationError(errorMessage(error));
      throw error;
    }
    if (mounted.current) setDirty((current) => {
      const next = { ...current };
      for (const patch of patches) {
        const key = `${patch.sectionKey}:${patch.repeatInstanceKey}`;
        if (next[key] === nextDirty[key]) delete next[key];
      }
      return next;
    });
  }

  function scheduleSave(nextDirty: Record<string, FieldWorkPackSectionPatch>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void flushDirty(nextDirty).catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);
  }

  async function run(operation: () => Promise<void>) {
    try {
      await operation();
      setOperationError('');
    } catch (error) {
      setOperationError(errorMessage(error));
    }
  }

  function changeAnswer(
    changedSection: FieldWorkPackSection,
    repeatInstanceKey: string,
    promptKey: string,
    answer: unknown,
  ) {
    const key = `${changedSection.sectionKey}:${repeatInstanceKey}`;
    const patch: FieldWorkPackSectionPatch = {
      sectionKey: changedSection.sectionKey,
      repeatInstanceKey,
      remove: false,
      answers: {
        ...(dirty[key]?.answers || {}),
        [promptKey]: answer,
      },
    };
    const nextDirty = { ...dirty, [key]: patch };
    setDirty(nextDirty);
    setResponse((current) => mergeFieldWorkPackSectionPatches(
      current,
      pack.definition.schema.sections,
      [patch],
    ));
    // Any response edit changes the declaration-bound response hash. The
    // server invalidates affected signatures; hiding local signed state avoids
    // implying an old signature still covers the edited response.
    setPendingSignatures({});
    scheduleSave(nextDirty);
  }

  function selectedRepeatInstance(currentSection: FieldWorkPackSection) {
    const instances = fieldWorkPackSectionInstances(currentSection, response);
    const selected = repeatSelection[currentSection.sectionKey];
    return instances.find((item) => item.instanceKey === selected) || instances[0];
  }

  function addRepeatItem(currentSection: FieldWorkPackSection) {
    if (!currentSection.repeatability) return;
    const instances = fieldWorkPackSectionInstances(currentSection, response);
    if (instances.length >= currentSection.repeatability.maximumInstances) return;
    const instanceKey = newRepeatInstanceKey(currentSection);
    setRepeatSelection((current) => ({ ...current, [currentSection.sectionKey]: instanceKey }));
    const key = `${currentSection.sectionKey}:${instanceKey}`;
    const patch: FieldWorkPackSectionPatch = {
      sectionKey: currentSection.sectionKey,
      repeatInstanceKey: instanceKey,
      remove: false,
      answers: {},
    };
    const nextDirty = { ...dirty, [key]: patch };
    setDirty(nextDirty);
    setResponse((current) => mergeFieldWorkPackSectionPatches(
      current,
      pack.definition.schema.sections,
      [patch],
    ));
    scheduleSave(nextDirty);
  }

  function removeRepeatItem(currentSection: FieldWorkPackSection, instanceKey: string) {
    if (!currentSection.repeatability) return;
    const key = `${currentSection.sectionKey}:${instanceKey}`;
    const patch: FieldWorkPackSectionPatch = {
      sectionKey: currentSection.sectionKey,
      repeatInstanceKey: instanceKey,
      remove: true,
      answers: {},
    };
    const nextDirty = { ...dirty, [key]: patch };
    setDirty(nextDirty);
    setResponse((current) => mergeFieldWorkPackSectionPatches(
      current,
      pack.definition.schema.sections,
      [patch],
    ));
    setRepeatSelection((current) => {
      const next = { ...current };
      delete next[currentSection.sectionKey];
      return next;
    });
    setPendingSignatures({});
    scheduleSave(nextDirty);
  }

  async function movePage(direction: -1 | 1) {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await flushDirty();
    setPageIndex((current) => Math.max(0, Math.min(sections.length, current + direction)));
  }

  const dependenciesReady = pack.definition.schema.dependencies.every(
    (dependency) => workPackDependencyStatus(pack, dependency.dependencyKey).ready,
  );
  const executionContextReady = Boolean(
    (pack.executionContext?.provider?.tradingName || pack.executionContext?.provider?.legalName)
    && pack.executionContext?.installerBusiness?.businessName
    && pack.executionContext?.assignment?.displayName,
  );
  const visibleSignatureKeys = new Set(sections.flatMap((candidate) =>
    fieldWorkPackSectionInstances(candidate, response).flatMap((instance) =>
      candidate.prompts.filter((prompt) =>
        prompt.type === 'signature'
        && fieldWorkPackVisibilityMatches(
          prompt.visibility,
          response.answers,
          instance.answers,
        )
      ).map((prompt) => workPackPromptResponseKey(
        candidate,
        instance.instanceKey,
        prompt,
      ))
    )
  ));
  const nonSignatureBlockers = completion.blockers.filter(
    (blocker) => !visibleSignatureKeys.has(blocker.key),
  );
  const pending = Object.keys(dirty).length > 0
    || Object.values(pendingArtifacts).some((items) => items.length > 0)
    || Object.values(pendingSignatures).some(Boolean)
    || pendingActions.length > 0;
  const canPrepareSigning = nonSignatureBlockers.length === 0
    && visibleSignatureKeys.size > 0
    && dependenciesReady
    && executionContextReady
    && !pending
    && !conflict
    && ['not_started', 'in_progress'].includes(pack.instance.status);
  const canFinalize = completion.ready
    && dependenciesReady
    && executionContextReady
    && !pending
    && !conflict
    && pack.instance.status === 'ready_to_sign';
  const nextRequiredAction = conflict
      ? 'Sync this job and resolve the saved conflict.'
    : pendingActions.length
      ? 'Your saved work must finish syncing before signatures or completion.'
    : pending
      ? 'Keep this screen open while the encrypted draft finishes saving.'
      : !executionContextReady
        ? 'Sync this job to load the authorised provider, trade business and assigned technician before signing.'
        : !dependenciesReady
          ? 'Creditex or dispatch must verify the governed product, scenario and program calculation before regulated work starts.'
          : pack.instance.status === 'completed'
            ? pack.finalRecord
              ? 'The completed activity PDF is ready to open.'
              : 'The work is complete, but the completed PDF is still being secured. Sync before leaving this job.'
            : pack.instance.status === 'ready_to_sign'
              ? completion.blockers[0]?.message
                || 'Review the captured signatures, then finish this work pack.'
              : nonSignatureBlockers[0]?.message
                || (canPrepareSigning
                  ? 'Review the details, then prepare the exact version for signatures.'
                  : 'Continue through the guided questions below.');

  return <View style={styles.shell}>
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((value) => !value)}
      style={styles.heading}
    >
      <MaterialCommunityIcons
        name={pack.finalRecord ? 'check-decagram-outline' : 'clipboard-edit-outline'}
        size={26}
        color={pack.finalRecord ? colours.green : colours.forest}
      />
      <View style={styles.flex}>
        <Text style={styles.title}>{pack.definition.title}</Text>
        <Text style={styles.meta}>{pack.instance.activityDate} | {readable(pack.instance.status)}</Text>
      </View>
      <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={24} color={colours.muted} />
    </Pressable>

    {open ? <View style={styles.body}>
      {conflict ? <View style={styles.conflict} accessibilityLiveRegion="assertive">
        <MaterialCommunityIcons name="cloud-alert-outline" size={24} color={colours.red} />
        <View style={styles.flex}>
          <Text style={styles.conflictTitle}>This work pack changed elsewhere</Text>
          <Text style={styles.conflictText}>{conflict}</Text>
          <Text style={styles.meta}>Your encrypted draft is retained. Review the conflict in Sync before retrying.</Text>
        </View>
      </View> : null}
      {operationError ? <View style={styles.conflict} accessibilityLiveRegion="assertive">
        <MaterialCommunityIcons name="alert-circle-outline" size={24} color={colours.red} />
        <View style={styles.flex}>
          <Text style={styles.conflictTitle}>Work pack not saved</Text>
          <Text style={styles.conflictText}>{operationError}</Text>
          <Text style={styles.meta}>The encrypted local draft is retained. Correct the issue or sync and try again.</Text>
        </View>
      </View> : null}

      <View style={styles.schemaNotice}>
        <View style={styles.statusRow}>
          <Text style={styles.schemaNoticeTitle}>TLINK FIELD WORK</Text>
          <View style={[
            styles.saveState,
            (conflict || operationError) && styles.saveStateAttention,
          ]}>
            <Text style={styles.saveStateText}>{conflict || operationError
              ? 'Action needed'
              : pendingActions.length
                ? 'Saved offline'
                : pending
                  ? 'Saving'
                  : pack.finalRecord
                    ? 'PDF ready'
                    : 'Saved'}</Text>
          </View>
        </View>
        <Text style={styles.schemaNoticeTitle}>Your next step</Text>
        <Text style={styles.nextAction}>{nextRequiredAction}</Text>
        <Text style={styles.meta}>Answers save automatically on this device and sync when a connection is available.</Text>
      </View>

      {pack.definition.schema.dependencies.length ? <View style={styles.dependencyPanel}>
        <Text style={styles.sectionEyebrow}>JOB SETUP STATUS</Text>
        {pack.definition.schema.dependencies.map((dependency) => {
          const status = workPackDependencyStatus(pack, dependency.dependencyKey);
          const calculatorOutput = dependency.kind === 'calculator'
            ? (pack.calculatorOutputs || []).find((output) => output.dependencyKey === dependency.dependencyKey)
            : null;
          const pendingCalculator = dependency.kind === 'calculator'
            ? (pack.calculatorPendingReviews || []).find(
              (output) => output.dependencyKey === dependency.dependencyKey,
            )
            : null;
          return <View key={dependency.dependencyKey} style={styles.dependencyRow}>
            <MaterialCommunityIcons
              name={status.ready ? 'check-circle-outline' : 'alert-circle-outline'}
              size={22}
              color={status.ready ? colours.green : colours.amber}
            />
            <View style={styles.flex}>
              <Text style={styles.promptLabel}>{dependency.label}</Text>
              {calculatorOutput ? <>
                <Text style={styles.verifiedCalculation}>Verified {calculatorOutput.claimOutputLabel}: {calculatorOutput.quantity} {calculatorOutput.unit}</Text>
                <Text style={styles.meta}>{calculatorOutput.calculatorKey} v{calculatorOutput.calculatorVersion} | Receipt {calculatorOutput.executionReceiptSha256.slice(0, 19)}</Text>
                <Text style={styles.meta}>This is the exact governed result for this job. The correct {calculatorOutput.claimOutputCode} action remains separate until evidence and submission checks pass.</Text>
              </> : pendingCalculator ? <>
                <Text style={styles.calculationReview}>Calculated securely</Text>
                <Text style={styles.meta}>Creditex is independently checking the exact run. The result will appear here only after that review passes.</Text>
              </> : <Text style={styles.meta}>{readable(dependency.kind)} | {status.ready ? 'Verified' : 'Action required'}</Text>}
              {!calculatorOutput ? <DependencyControl
                dependency={dependency}
                pack={pack}
                disabled={pending || Boolean(conflict) || busy !== ''
                  || ['completed', 'void', 'ready_to_sign'].includes(pack.instance.status)}
                pendingCalculator={Boolean(pendingCalculator)}
                onFindOfficialProducts={onFindOfficialProducts}
                onSelectOfficialProducts={onSelectOfficialProducts}
                onSelectScenario={onSelectScenario}
                onRunCalculator={onRunCalculator}
              /> : null}
            </View>
          </View>;
        })}
        {!dependenciesReady ? <Text style={styles.warning}>Choose from the approved options shown here. TLink applies the governed rules and Creditex review automatically. The technician only completes the job steps shown here.</Text> : null}
      </View> : null}

      <View style={styles.steps}>
        {sections.map((item, index) => <View key={item.sectionKey} style={[styles.step, index <= pageIndex && styles.stepActive]}><Text style={[styles.stepText, index <= pageIndex && styles.stepTextActive]}>{index + 1}</Text></View>)}
        <View style={[styles.step, reviewPage && styles.stepActive]}><MaterialCommunityIcons name="check" size={16} color={reviewPage ? colours.white : colours.muted} /></View>
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.meta}>Step {Math.min(pageIndex + 1, sections.length + 1)} of {sections.length + 1}</Text>

      {section ? <SectionPage
        pack={pack}
        response={response}
        section={section}
        selectedInstance={selectedRepeatInstance(section)}
        repeatSelection={repeatSelection}
        pendingArtifacts={pendingArtifacts}
        pendingSignatures={pendingSignatures}
        signatureDrafts={signatureDrafts}
        busy={busy}
        onSelectRepeat={(instanceKey) => setRepeatSelection((current) => ({ ...current, [section.sectionKey]: instanceKey }))}
        onAddRepeat={() => addRepeatItem(section)}
        onRemoveRepeat={(instanceKey) => removeRepeatItem(section, instanceKey)}
        onChange={(repeatInstanceKey, promptKey, answer) => changeAnswer(section, repeatInstanceKey, promptKey, answer)}
        onCaptureArtifact={async (context) => {
          if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = null;
          }
          await flushDirty();
          const key = workPackPromptResponseKey(context.section, context.repeatInstanceKey, context.prompt);
          const marker = `pending-${Date.now()}`;
          setPendingArtifacts((current) => ({ ...current, [key]: [...(current[key] || []), marker] }));
          try {
            const clientUploadId = await onCaptureArtifact(context);
            setPendingArtifacts((current) => current[key]?.includes(marker)
              ? { ...current, [key]: current[key].map((item) => item === marker ? clientUploadId : item) }
              : current);
            setOperationError('');
          } catch (error) {
            setPendingArtifacts((current) => ({
              ...current,
              [key]: (current[key] || []).filter((item) => item !== marker),
            }));
            setOperationError(errorMessage(error));
          }
        }}
        onOpenReferenceDocument={async (context, document) => {
          if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = null;
          }
          await flushDirty();
          await onOpenReferenceDocument(context, document);
        }}
        onAcknowledgeReferenceDocument={async (context, document, acknowledgedAt) => {
          if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = null;
          }
          await flushDirty();
          await onAcknowledgeReferenceDocument(context, document, acknowledgedAt);
        }}
        onChangeSignature={(key, draft) => setSignatureDrafts((current) => ({ ...current, [key]: draft }))}
        onCaptureSignature={async (context, draft) => {
          if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = null;
          }
          await flushDirty();
          const key = workPackPromptResponseKey(context.section, context.repeatInstanceKey, context.prompt);
          setPendingSignatures((current) => ({ ...current, [key]: true }));
          try {
            await onCaptureSignature(context, draft);
            setOperationError('');
          } catch (error) {
            setPendingSignatures((current) => ({ ...current, [key]: false }));
            setOperationError(errorMessage(error));
          }
        }}
      /> : <ReviewPage
        pack={pack}
        completion={completion}
        pending={pending}
        conflict={Boolean(conflict)}
        onUpdateCustomerContext={onUpdateCustomerContext}
      />}

      <View style={styles.navigation}>
        <FieldButton
          variant="secondary"
          disabled={pageIndex === 0 || Boolean(busy)}
          style={styles.flex}
          onPress={() => void run(() => movePage(-1))}
        >Back</FieldButton>
        {!reviewPage ? <FieldButton
          disabled={Boolean(busy)}
          style={styles.flex}
          onPress={() => void run(() => movePage(1))}
        >Continue</FieldButton> : pack.instance.status === 'completed' ? <FieldButton
          disabled={!pack.finalRecord || !onOpenFinalRecord || Boolean(busy)}
          loading={busy === `work-pack-final-record:${pack.instance.id}`}
          style={styles.flex}
          onPress={() => void run(async () => {
            if (!onOpenFinalRecord) throw new Error('The completed PDF is not available yet. Sync and try again.');
            await onOpenFinalRecord();
          })}
        >Open completed PDF</FieldButton> : <FieldButton
          disabled={pack.instance.status === 'ready_to_sign'
            ? !canFinalize || Boolean(busy)
            : !canPrepareSigning || Boolean(busy)}
          loading={busy === `work-pack-finalize:${pack.instance.id}`
            || busy === `work-pack-prepare-signing:${pack.instance.id}`}
          style={styles.flex}
          onPress={() => void run(pack.instance.status === 'ready_to_sign'
            ? onFinalize
            : onPrepareSigning)}
        >{pack.instance.status === 'ready_to_sign'
          ? 'Finish work pack'
          : 'Prepare signatures'}</FieldButton>}
      </View>
      {reviewPage && pack.instance.status !== 'ready_to_sign' && !canPrepareSigning
        ? <Text style={styles.warning}>Finish the required questions, setup items and files shown above, then sync before preparing signatures.</Text>
        : null}
      {reviewPage && pack.instance.status === 'ready_to_sign' && !canFinalize
        ? <Text style={styles.warning}>Capture every required signature against this prepared version before finishing.</Text>
        : null}
    </View> : null}
  </View>;
}

function DependencyControl({
  dependency,
  pack,
  disabled,
  pendingCalculator,
  onFindOfficialProducts,
  onSelectOfficialProducts,
  onSelectScenario,
  onRunCalculator,
}: {
  dependency: FieldWorkPackDependency;
  pack: FieldActivityWorkPack;
  disabled: boolean;
  pendingCalculator: boolean;
  onFindOfficialProducts: (
    dependencyKey: string,
    search: string,
  ) => Promise<FieldWorkPackOfficialProduct[]>;
  onSelectOfficialProducts: (
    dependencyKey: string,
    selections: FieldWorkPackOfficialProductSelection[],
  ) => Promise<void>;
  onSelectScenario: (dependencyKey: string, scenarioCode: string) => Promise<void>;
  onRunCalculator: (dependencyKey: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<FieldWorkPackOfficialProduct[]>([]);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const status = workPackDependencyStatus(pack, dependency.dependencyKey);

  async function perform(key: string, operation: () => Promise<void>) {
    setWorking(key);
    setError('');
    try {
      await operation();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking('');
    }
  }

  if (dependency.kind === 'scenario') {
    const selectedScenario = status.resolution?.referenceIds[0] || '';
    return <View style={styles.dependencyAction}>
      <Text style={styles.actionLabel}>Choose the exact scenario</Text>
      <View style={styles.scenarioOptions}>
        {dependency.scenarioCodes.map((scenarioCode) => <Pressable
          key={scenarioCode}
          accessibilityRole="radio"
          accessibilityState={{
            checked: selectedScenario === scenarioCode,
            disabled: disabled || working !== '',
          }}
          disabled={disabled || working !== ''}
          onPress={() => void perform(`scenario:${scenarioCode}`, async () => {
            await onSelectScenario(dependency.dependencyKey, scenarioCode);
          })}
          style={({ pressed }) => [
            styles.scenarioOption,
            selectedScenario === scenarioCode && styles.scenarioOptionSelected,
            pressed && styles.pressed,
          ]}
        >
          <MaterialCommunityIcons
            name={selectedScenario === scenarioCode ? 'radiobox-marked' : 'radiobox-blank'}
            size={22}
            color={selectedScenario === scenarioCode ? colours.green : colours.muted}
          />
          <Text style={styles.scenarioText}>{scenarioCode}</Text>
        </Pressable>)}
      </View>
      {error ? <Text style={styles.warning}>{error}</Text> : null}
    </View>;
  }

  if (dependency.kind === 'product') {
    const selectedProducts = products.filter((product) => selected[product.selectionId]);
    const countReady = selectedProducts.length >= dependency.minimumCount
      && selectedProducts.length <= dependency.maximumCount;
    return <View style={styles.dependencyAction}>
      <Text style={styles.actionLabel}>Find the installed approved product</Text>
      <TextInput
        accessibilityLabel={`Search ${dependency.label}`}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled && working === ''}
        onChangeText={setQuery}
        placeholder="Brand, model or approval number"
        placeholderTextColor={colours.muted}
        returnKeyType="search"
        style={styles.productSearch}
        value={query}
        onSubmitEditing={() => void perform('search', async () => {
          setProducts(await onFindOfficialProducts(dependency.dependencyKey, query));
          setSelected({});
        })}
      />
      <FieldButton
        variant="secondary"
        disabled={disabled}
        loading={working === 'search'}
        onPress={() => void perform('search', async () => {
          setProducts(await onFindOfficialProducts(dependency.dependencyKey, query));
          setSelected({});
        })}
      >Show approved products</FieldButton>
      {products.length ? <View style={styles.productResults}>
        {products.map((product) => {
          const quantity = selected[product.selectionId] || 0;
          const productName = [product.brand || product.manufacturer, product.model, product.series]
            .filter(Boolean).join(' ');
          const approval = product.registrationNumber || product.certificateNumber
            || product.sourceRecordKey;
          return <View
            key={`${product.snapshotId}:${product.selectionId}`}
            style={[styles.productCard, quantity > 0 && styles.productCardSelected]}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: quantity > 0, disabled: disabled || working !== '' }}
              disabled={disabled || working !== ''}
              onPress={() => setSelected((current) => {
                if (current[product.selectionId]) {
                  const next = { ...current };
                  delete next[product.selectionId];
                  return next;
                }
                return dependency.selectionMode === 'single'
                  ? { [product.selectionId]: 1 }
                  : { ...current, [product.selectionId]: 1 };
              })}
              style={({ pressed }) => [styles.productChoice, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons
                name={quantity > 0 ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                size={25}
                color={quantity > 0 ? colours.green : colours.muted}
              />
              <View style={styles.flex}>
                <Text style={styles.promptLabel}>{productName || 'Approved product'}</Text>
                <Text style={styles.meta}>{approval}</Text>
                <Text style={styles.meta}>Effective {product.eligibleFrom}{product.eligibleTo ? ` to ${product.eligibleTo}` : ''}</Text>
              </View>
            </Pressable>
            {quantity > 0 ? <View style={styles.quantityRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Decrease quantity for ${productName}`}
                disabled={disabled || working !== '' || quantity <= 1}
                onPress={() => setSelected((current) => ({
                  ...current,
                  [product.selectionId]: Math.max(1, quantity - 1),
                }))}
                style={styles.quantityButton}
              ><MaterialCommunityIcons name="minus" size={24} color={colours.forest} /></Pressable>
              <Text accessibilityLabel={`Quantity ${quantity}`} style={styles.quantityValue}>{quantity}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Increase quantity for ${productName}`}
                disabled={disabled || working !== '' || quantity >= 1000}
                onPress={() => setSelected((current) => ({
                  ...current,
                  [product.selectionId]: Math.min(1000, quantity + 1),
                }))}
                style={styles.quantityButton}
              ><MaterialCommunityIcons name="plus" size={24} color={colours.forest} /></Pressable>
            </View> : null}
          </View>;
        })}
      </View> : null}
      {products.length && !selectedProducts.length
        ? <Text style={styles.meta}>Tap the product that is being installed.</Text>
        : null}
      {selectedProducts.length ? <FieldButton
        disabled={disabled || !countReady}
        loading={working === 'save-products'}
        onPress={() => void perform('save-products', async () => {
          await onSelectOfficialProducts(
            dependency.dependencyKey,
            selectedProducts.map((product) => ({
              selectionId: product.selectionId,
              snapshotId: product.snapshotId,
              quantity: selected[product.selectionId],
            })),
          );
        })}
      >Use {selectedProducts.length === 1 ? 'this product' : 'these products'}</FieldButton> : null}
      {!countReady && selectedProducts.length
        ? <Text style={styles.warning}>Choose {dependency.minimumCount} to {dependency.maximumCount} approved products.</Text>
        : null}
      {error ? <Text style={styles.warning}>{error}</Text> : null}
    </View>;
  }

  return <View style={styles.dependencyAction}>
    {pendingCalculator ? <Text style={styles.meta}>No action is needed from the technician while Creditex checks this calculation.</Text> : <>
      <Text style={styles.actionLabel}>Calculate from the answers in this form</Text>
      <FieldButton
        disabled={disabled}
        loading={working === 'calculator'}
        onPress={() => void perform('calculator', async () => {
          await onRunCalculator(dependency.dependencyKey);
        })}
      >Run governed calculation</FieldButton>
    </>}
    {error ? <Text style={styles.warning}>{error}</Text> : null}
  </View>;
}

function SectionPage({
  pack,
  response,
  section,
  selectedInstance,
  repeatSelection,
  pendingArtifacts,
  pendingSignatures,
  signatureDrafts,
  busy,
  onSelectRepeat,
  onAddRepeat,
  onRemoveRepeat,
  onChange,
  onCaptureArtifact,
  onOpenReferenceDocument,
  onAcknowledgeReferenceDocument,
  onChangeSignature,
  onCaptureSignature,
}: {
  pack: FieldActivityWorkPack;
  response: FieldActivityWorkPackResponse;
  section: FieldWorkPackSection;
  selectedInstance?: { instanceKey: string; answers: Record<string, unknown> };
  repeatSelection: Record<string, string>;
  pendingArtifacts: Record<string, string[]>;
  pendingSignatures: Record<string, boolean>;
  signatureDrafts: Record<string, FieldWorkPackSignatureDraft>;
  busy: string;
  onSelectRepeat: (instanceKey: string) => void;
  onAddRepeat: () => void;
  onRemoveRepeat: (instanceKey: string) => void;
  onChange: (repeatInstanceKey: string, promptKey: string, answer: unknown) => void;
  onCaptureArtifact: (context: ActivityWorkPackPromptContext) => Promise<void>;
  onOpenReferenceDocument: (
    context: ActivityWorkPackPromptContext,
    document: FieldWorkPackReferenceDocumentProjection,
  ) => Promise<void>;
  onAcknowledgeReferenceDocument: (
    context: ActivityWorkPackPromptContext,
    document: FieldWorkPackReferenceDocumentProjection,
    acknowledgedAt: string,
  ) => Promise<void>;
  onChangeSignature: (key: string, draft: FieldWorkPackSignatureDraft) => void;
  onCaptureSignature: (context: ActivityWorkPackPromptContext, draft: FieldWorkPackSignatureDraft) => Promise<void>;
}) {
  const instances = fieldWorkPackSectionInstances(section, response);
  const repeatInstanceKey = section.repeatability ? selectedInstance?.instanceKey || '' : '';
  const instanceAnswers = selectedInstance?.answers || response.answers;
  const visiblePrompts = section.prompts.filter((prompt) => fieldWorkPackVisibilityMatches(
    prompt.visibility,
    response.answers,
    instanceAnswers,
  ));
  return <View style={styles.page}>
    <Text style={styles.sectionEyebrow}>{section.repeatability ? 'REPEATABLE SECTION' : 'SECTION'}</Text>
    <Text style={styles.pageTitle}>{section.title}</Text>
    {section.description ? <Text style={styles.description}>{section.description}</Text> : null}
    {section.repeatability ? <View style={styles.repeatPanel}>
      <Text style={styles.promptLabel}>{section.repeatability.itemLabel}s</Text>
      <Text style={styles.meta}>Add {section.repeatability.minimumInstances} to {section.repeatability.maximumInstances}. Each item keeps its own answers and evidence.</Text>
      <View style={styles.chips}>{instances.map((instance, index) => <Pressable
        accessibilityRole="button"
        key={instance.instanceKey}
        onPress={() => onSelectRepeat(instance.instanceKey)}
        style={[styles.chip, (repeatSelection[section.sectionKey] || instances[0]?.instanceKey) === instance.instanceKey && styles.chipActive]}
      ><Text style={[styles.chipText, (repeatSelection[section.sectionKey] || instances[0]?.instanceKey) === instance.instanceKey && styles.chipTextActive]}>{section.repeatability?.itemLabel} {index + 1}</Text></Pressable>)}</View>
      {selectedInstance && instances.length > section.repeatability.minimumInstances ? <FieldButton
        variant="secondary"
        onPress={() => onRemoveRepeat(selectedInstance.instanceKey)}
      >Remove selected {section.repeatability.itemLabel.toLowerCase()}</FieldButton> : null}
      <FieldButton
        variant="secondary"
        disabled={instances.length >= section.repeatability.maximumInstances}
        onPress={onAddRepeat}
      >Add {section.repeatability.itemLabel}</FieldButton>
    </View> : null}
    {section.repeatability && !selectedInstance ? <View style={styles.empty}><Text style={styles.warning}>Add the first {section.repeatability.itemLabel.toLowerCase()} to start this section.</Text></View> : visiblePrompts.map((prompt) => {
      const context = { pack, section, repeatInstanceKey, prompt };
      const key = workPackPromptResponseKey(section, repeatInstanceKey, prompt);
      const answer = responseAnswer(response, section, repeatInstanceKey, prompt.promptKey);
      const signatureSaved = pack.signatures.some(
        (signature) => signature.action === 'captured' && signature.promptKey === key,
      );
      return <PromptField
        key={key}
        context={context}
        answer={answer}
        pendingArtifacts={pendingArtifacts[key] || []}
        pendingSignature={pendingSignatures[key] === true && !signatureSaved}
        signatureDraft={signatureDrafts[key]}
        busy={busy}
        onChange={(next) => onChange(repeatInstanceKey, prompt.promptKey, next)}
        onCaptureArtifact={() => onCaptureArtifact(context)}
        onOpenReferenceDocument={(document) => onOpenReferenceDocument(context, document)}
        onAcknowledgeReferenceDocument={(document, acknowledgedAt) =>
          onAcknowledgeReferenceDocument(context, document, acknowledgedAt)}
        onChangeSignature={(draft) => onChangeSignature(key, draft)}
        onCaptureSignature={(draft) => onCaptureSignature(context, draft)}
      />;
    })}
  </View>;
}

function PromptField({
  context,
  answer,
  pendingArtifacts,
  pendingSignature,
  signatureDraft: existingSignatureDraft,
  busy,
  onChange,
  onCaptureArtifact,
  onOpenReferenceDocument,
  onAcknowledgeReferenceDocument,
  onChangeSignature,
  onCaptureSignature,
}: {
  context: ActivityWorkPackPromptContext;
  answer: unknown;
  pendingArtifacts: string[];
  pendingSignature: boolean;
  signatureDraft?: FieldWorkPackSignatureDraft;
  busy: string;
  onChange: (answer: unknown) => void;
  onCaptureArtifact: () => Promise<void>;
  onOpenReferenceDocument: (document: FieldWorkPackReferenceDocumentProjection) => Promise<void>;
  onAcknowledgeReferenceDocument: (
    document: FieldWorkPackReferenceDocumentProjection,
    acknowledgedAt: string,
  ) => Promise<void>;
  onChangeSignature: (draft: FieldWorkPackSignatureDraft) => void;
  onCaptureSignature: (draft: FieldWorkPackSignatureDraft) => Promise<void>;
}) {
  const { pack, prompt } = context;
  const stage = pack.definition.schema.stages.find((item) => item.stageKey === prompt.stageKey);
  const dependencyBlocked = prompt.dependencyKeys.some(
    (key) => !workPackDependencyStatus(pack, key).ready,
  );
  const attachmentIds = Array.isArray(answer)
    ? answer.filter((item): item is string => typeof item === 'string')
    : [];
  return <View style={styles.prompt}>
    <View style={styles.promptHeading}>
      <View style={styles.flex}>
        <Text style={styles.promptLabel}>{prompt.label}{prompt.required ? ' *' : ''}</Text>
        {stage ? <Text style={styles.stage}>{stage.label}</Text> : null}
      </View>
      {prompt.required ? <Text style={styles.required}>REQUIRED</Text> : null}
    </View>
    {prompt.instructions ? <Text style={styles.description}>{prompt.instructions}</Text> : null}
    {prompt.dependencyKeys.map((key) => {
      const dependency = workPackDependencyStatus(pack, key);
      return <Text key={key} style={dependency.ready ? styles.meta : styles.warning}>{dependency.dependency?.label || key}: {dependency.ready ? 'verified' : 'blocked until Creditex or dispatch completes governance'}</Text>;
    })}
    {prompt.type === 'checkbox' ? <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: answer === true }}
      disabled={dependencyBlocked}
      onPress={() => onChange(answer !== true)}
      style={[styles.checkbox, answer === true && styles.checkboxActive]}
    ><MaterialCommunityIcons name={answer === true ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={25} color={colours.green} /><Text style={styles.checkboxText}>{answer === true ? 'Confirmed' : 'Tap to confirm'}</Text></Pressable>
      : prompt.type === 'select' ? <View style={styles.options}>{prompt.options.map((option) => <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: answer === option.value }}
        disabled={dependencyBlocked}
        key={option.value}
        onPress={() => onChange(option.value)}
        style={[styles.option, answer === option.value && styles.optionActive]}
      ><Text style={styles.optionText}>{option.label}</Text></Pressable>)}</View>
        : prompt.type === 'multiselect' ? <View style={styles.options}>{prompt.options.map((option) => {
          const values = Array.isArray(answer) ? answer.filter((item): item is string => typeof item === 'string') : [];
          const selected = values.includes(option.value);
          return <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            disabled={dependencyBlocked}
            key={option.value}
            onPress={() => onChange(selected ? values.filter((item) => item !== option.value) : [...values, option.value])}
            style={[styles.option, selected && styles.optionActive]}
          ><Text style={styles.optionText}>{option.label}</Text></Pressable>;
        })}</View>
          : prompt.type === 'photo' || prompt.type === 'document' ? <View style={styles.capturePanel}>
            <Text style={styles.meta}>{attachmentIds.length} saved attachment{attachmentIds.length === 1 ? '' : 's'}{pendingArtifacts.length ? ` | ${pendingArtifacts.length} file${pendingArtifacts.length === 1 ? '' : 's'} saving` : ''}</Text>
            <FieldButton
              variant="secondary"
              disabled={dependencyBlocked || attachmentIds.length + pendingArtifacts.length >= (prompt.fileRequirement?.maximumCount || 0)}
              loading={busy === `work-pack-artifact:${pack.instance.id}:${prompt.promptKey}`}
              onPress={() => void onCaptureArtifact()}
            >{prompt.type === 'photo' ? 'Take required photo' : 'Add required document'}</FieldButton>
            <Text style={styles.meta}>{prompt.fileRequirement?.gpsRequired ? 'Precise GPS required. ' : ''}{prompt.fileRequirement?.metadataRequired ? 'Original metadata required. ' : ''}{prompt.fileRequirement?.captureTimeRequired ? 'Capture time required. ' : ''}Original files remain unchanged.</Text>
          </View>
            : prompt.type === 'reference_document' ? <ReferenceDocumentPrompt
              context={context}
              answer={answer}
              disabled={dependencyBlocked || Boolean(busy)}
              onAcknowledge={onAcknowledgeReferenceDocument}
              onOpen={onOpenReferenceDocument}
            />
            : prompt.type === 'signature' ? <SignaturePrompt
              context={context}
              answerIds={attachmentIds}
              pending={pendingSignature}
              draft={existingSignatureDraft}
              onChange={onChangeSignature}
              onCapture={onCaptureSignature}
              busy={busy}
            />
              : prompt.type === 'number' ? <NumberPromptInput
                answer={answer}
                disabled={dependencyBlocked}
                label={prompt.label}
                maximumLength={prompt.maximumLength}
                onChange={onChange}
                unit={prompt.unit}
              /> : <TextInput
                accessibilityLabel={prompt.label}
                editable={!dependencyBlocked}
                keyboardType="default"
                maxLength={prompt.maximumLength || 20_000}
                multiline={prompt.type === 'textarea'}
                onChangeText={onChange}
                placeholder={prompt.type === 'date' ? 'YYYY-MM-DD' : 'Enter answer'}
                style={[styles.input, prompt.type === 'textarea' && styles.textarea]}
                value={typeof answer === 'number' || typeof answer === 'string' ? String(answer) : ''}
              />}
    {prompt.attestation && prompt.type !== 'signature' ? <View style={styles.attestation}><Text style={styles.attestationLabel}>PLEASE READ BEFORE CONTINUING</Text><Text style={styles.attestationText}>{prompt.attestation.text}</Text></View> : null}
  </View>;
}

function ReferenceDocumentPrompt({
  context,
  answer,
  disabled,
  onAcknowledge,
  onOpen,
}: {
  context: ActivityWorkPackPromptContext;
  answer: unknown;
  disabled: boolean;
  onAcknowledge: (
    document: FieldWorkPackReferenceDocumentProjection,
    acknowledgedAt: string,
  ) => Promise<void>;
  onOpen: (document: FieldWorkPackReferenceDocumentProjection) => Promise<void>;
}) {
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const [locallyAcknowledged, setLocallyAcknowledged] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [openError, setOpenError] = useState('');
  const responseKey = workPackPromptResponseKey(
    context.section,
    context.repeatInstanceKey,
    context.prompt,
  );
  const document = context.pack.referenceDocuments.find(
    (item) => item.responseKey === responseKey
      && item.sourceBindingTargetKey
        === context.prompt.referenceDocument?.sourceBindingTargetKey,
  );
  const acknowledgement = answer && typeof answer === 'object' && !Array.isArray(answer)
    ? answer as Record<string, unknown>
    : {};
  const acknowledged = locallyAcknowledged || Boolean(document
    && acknowledgement.sourceArtifactId === document.sourceArtifactId
    && String(acknowledgement.sourceArtifactSha256 || '').replace(/^sha256:/, '')
      === document.sourceArtifactSha256.replace(/^sha256:/, '')
    && acknowledgement.acknowledgementMode === document.acknowledgementMode
    && acknowledgement.acknowledged === true);
  const mode = context.prompt.referenceDocument?.acknowledgementMode || 'none';

  async function openDocument() {
    if (!document) {
      setOpenError('This document is not available yet. Sync the job and try again.');
      return;
    }
    setOpening(true);
    try {
      await onOpen(document);
      setOpened(true);
      setOpenError('');
      if (mode === 'viewed' && !acknowledged) {
        setAcknowledging(true);
        await onAcknowledge(document, new Date().toISOString());
        setLocallyAcknowledged(true);
      }
    } catch (error) {
      setOpenError(errorMessage(error));
    } finally {
      setAcknowledging(false);
      setOpening(false);
    }
  }

  return <View style={styles.capturePanel}>
    <Text style={styles.promptLabel}>{document?.title || 'Required document'}</Text>
    {document?.version ? <Text style={styles.meta}>{document.version}</Text> : null}
    <FieldButton
      disabled={disabled || !document}
      loading={opening}
      onPress={() => void openDocument()}
    >Open document</FieldButton>
    <Text style={styles.meta}>The approved copy is checked before it opens and remains available offline on this device.</Text>
    {openError ? <Text accessibilityLiveRegion="assertive" style={styles.warning}>{openError}</Text> : null}
    {mode === 'confirmed' ? <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: acknowledged }}
      disabled={disabled || acknowledging || (!opened && !acknowledged) || !document || acknowledged}
      onPress={() => void (async () => {
        if (!document || (!opened && !acknowledged) || acknowledged) return;
        setAcknowledging(true);
        try {
          await onAcknowledge(document, new Date().toISOString());
          setLocallyAcknowledged(true);
          setOpenError('');
        } catch (error) {
          setOpenError(errorMessage(error));
        } finally {
          setAcknowledging(false);
        }
      })()}
      style={[styles.checkbox, acknowledged && styles.checkboxActive]}
    >
      <MaterialCommunityIcons
        name={acknowledged ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
        size={25}
        color={colours.green}
      />
      <Text style={styles.checkboxText}>{context.prompt.referenceDocument?.acknowledgementText || 'I have read this document'}</Text>
    </Pressable> : mode === 'viewed' && acknowledged
      ? <Text style={styles.meta}>Document opened and saved.</Text>
      : null}
    {acknowledging ? <Text style={styles.meta}>Saving acknowledgement...</Text> : null}
  </View>;
}

function NumberPromptInput({
  answer,
  disabled,
  label,
  maximumLength,
  onChange,
  unit,
}: {
  answer: unknown;
  disabled: boolean;
  label: string;
  maximumLength: number | null;
  onChange: (answer: unknown) => void;
  unit: string;
}) {
  const answerValue = typeof answer === 'number' && Number.isFinite(answer)
    ? String(answer)
    : '';
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const value = draftValue ?? answerValue;
  return <TextInput
    accessibilityLabel={label}
    editable={!disabled}
    keyboardType="decimal-pad"
    maxLength={Math.min(maximumLength || 48, 48)}
    onBlur={() => {
      const number = Number(value);
      onChange(value.trim() === '' || !Number.isFinite(number) ? '' : number);
      setDraftValue(null);
    }}
    onChangeText={(next) => {
      if (/^-?(?:\d+)?(?:\.\d*)?$/.test(next)) setDraftValue(next);
    }}
    onFocus={() => setDraftValue(answerValue)}
    placeholder={`Enter number${unit ? ` in ${unit}` : ''}`}
    style={styles.input}
    value={value}
  />;
}

function SignaturePrompt({
  context,
  answerIds,
  pending,
  draft,
  onChange,
  onCapture,
  busy,
}: {
  context: ActivityWorkPackPromptContext;
  answerIds: string[];
  pending: boolean;
  draft?: FieldWorkPackSignatureDraft;
  onChange: (draft: FieldWorkPackSignatureDraft) => void;
  onCapture: (draft: FieldWorkPackSignatureDraft) => Promise<void>;
  busy: string;
}) {
  const { pack, prompt } = context;
  const role = pack.definition.schema.signerRoles.find((item) => item.roleKey === prompt.signerRoleKey);
  const attestation = prompt.attestation;
  if (!role || !attestation) {
    return <Text style={styles.warning}>This signature is not ready. Sync the job, then try again.</Text>;
  }
  if (pack.instance.status !== 'ready_to_sign') {
    return <View style={styles.capturePanel}>
      <MaterialCommunityIcons name="lock-check-outline" size={28} color={colours.green} />
      <Text style={styles.promptLabel}>Signature opens after review</Text>
      <Text style={styles.meta}>Complete the questions and files, sync them, then tap Prepare signatures. This keeps every signature bound to the exact reviewed version.</Text>
    </View>;
  }
  const responseKey = workPackPromptResponseKey(
    context.section,
    context.repeatInstanceKey,
    prompt,
  );
  const capturedSignatures = pack.signatures.filter((signature) =>
    signature.action === 'captured' && signature.promptKey === responseKey
  );
  const signerBinding = pack.signerBindings.find(
    (binding) => binding.roleKey === role.roleKey,
  );
  const draftAlreadyCaptured = Boolean(draft && capturedSignatures.some(
    (signature) => signature.signedAt === draft.capturedAt
      && signature.signerName === draft.signerName,
  ));
  const value = draft && !draftAlreadyCaptured ? draft : signatureDraft(role, signerBinding);
  const savedCount = Math.max(answerIds.length, capturedSignatures.length);
  const count = savedCount + (pending ? 1 : 0);
  const savedSignatures = <>
    {capturedSignatures.map((signature) => {
      const captured = capturedSignatureDraft(signature);
      return <View key={signature.id} style={styles.savedSignatureCard}>
        <View style={styles.savedSignatureHeading}>
          <MaterialCommunityIcons name="check-decagram-outline" size={26} color={colours.green} />
          <View style={styles.flex}>
            <Text style={styles.promptLabel}>{signature.signerName}</Text>
            <Text style={styles.meta}>{role.label} | {signature.signerCapacity} | {new Date(signature.signedAt).toLocaleString('en-AU')}</Text>
          </View>
        </View>
        {captured.strokes.length ? <SignatureCapture
          declaration={attestation.text}
          signerRole={role}
          value={captured}
          displayOnly
          disabled
          onChange={() => undefined}
        /> : <View style={styles.savedSignaturePlaceholder}>
          <MaterialCommunityIcons name="draw-pen" size={34} color={colours.green} />
          <Text style={styles.promptLabel}>Signature securely retained</Text>
          <Text style={styles.meta}>Open the completed activity PDF after finishing to see this signature in its approved form.</Text>
        </View>}
      </View>;
    })}
    {!capturedSignatures.length && answerIds.length ? <View style={styles.savedSignaturePlaceholder}>
      <MaterialCommunityIcons name="draw-pen" size={34} color={colours.green} />
      <Text style={styles.promptLabel}>Signature securely retained</Text>
      <Text style={styles.meta}>Sync this job to show the retained signature here. The completed activity PDF remains the exact signed record.</Text>
    </View> : null}
    {pending && value.strokes.length ? <View style={styles.savedSignatureCard}>
      <View style={styles.savedSignatureHeading}>
        <MaterialCommunityIcons name="cloud-upload-outline" size={26} color={colours.green} />
        <View style={styles.flex}>
          <Text style={styles.promptLabel}>Signature saving</Text>
          <Text style={styles.meta}>{value.signerName || role.label} | {value.signerCapacity || role.capacity}</Text>
        </View>
      </View>
      <SignatureCapture
        declaration={attestation.text}
        signerRole={role}
        value={value}
        displayOnly
        disabled
        onChange={() => undefined}
      />
    </View> : null}
  </>;
  if (count >= role.maximumSignatures) {
    return <View style={styles.signaturePanel}>
      {savedSignatures}
    </View>;
  }
  return <View style={styles.signaturePanel}>
    {savedSignatures}
    <Text style={styles.meta}>{savedCount} saved signature{savedCount === 1 ? '' : 's'}{pending ? ' | one signature saving' : ''}</Text>
    <View style={styles.boundSigner}>
      <Text style={styles.sectionEyebrow}>SIGNER FIXED FROM THIS JOB</Text>
      <Text style={styles.promptLabel}>{signerBinding?.signerName || 'Signer identity unavailable'}</Text>
      {role.identityRequirements.map((requirement) => <Text key={requirement.fieldKey} style={styles.meta}>{requirement.label}: {signerBinding?.fields[requirement.fieldKey] || 'Not available'}</Text>)}
    </View>
    <SignatureCapture
      declaration={attestation.text}
      signerRole={role}
      value={value}
      disabled={Boolean(busy) || pending}
      onChange={onChange}
    />
    <FieldButton
      disabled={!signerBinding || !signatureDraftReady(role, value) || pending}
      loading={busy === `work-pack-signature:${pack.instance.id}:${prompt.promptKey}`}
      onPress={() => void onCapture(value)}
    >Confirm this signature</FieldButton>
  </View>;
}

function ReviewPage({
  pack,
  completion,
  pending,
  conflict,
  onUpdateCustomerContext,
}: {
  pack: FieldActivityWorkPack;
  completion: ReturnType<typeof fieldActivityWorkPackCompletion>;
  pending: boolean;
  conflict: boolean;
  onUpdateCustomerContext: (next: FieldWorkPackCustomerContext) => Promise<void>;
}) {
  return <View style={styles.page}>
    <Text style={styles.sectionEyebrow}>REVIEW</Text>
    <Text style={styles.pageTitle}>{pack.instance.status === 'completed' ? 'Completed record' : 'Check before finishing'}</Text>
    <Text style={styles.description}>{pack.instance.status === 'completed'
      ? 'Keep the exact signed activity PDF with the job and open it whenever you need the completed form.'
      : 'Confirm the customer, activity, products, calculations, files and declarations are correct.'}</Text>
    <ExecutionContextReview pack={pack} />
    <CustomerContextReview
      context={pack.customerContext}
      protectedCustomer={pack.protectedCustomer}
      onSave={onUpdateCustomerContext}
    />
    <View style={styles.reviewRow}><Text style={styles.promptLabel}>Visible required items</Text><Text style={styles.reviewValue}>{completion.requiredPromptKeys.filter((key) => completion.completedPromptKeys.includes(key)).length}/{completion.requiredPromptKeys.length}</Text></View>
    <View style={styles.reviewRow}><Text style={styles.promptLabel}>Signatures</Text><Text style={styles.reviewValue}>{pack.signatures.length}</Text></View>
    <View style={styles.reviewRow}><Text style={styles.promptLabel}>Files</Text><Text style={styles.reviewValue}>{pack.artifacts.length}</Text></View>
    {pack.finalRecord ? <View style={styles.finalRecord}>
      <MaterialCommunityIcons name="file-pdf-box" size={36} color={colours.green} />
      <View style={styles.flex}>
        <Text style={styles.promptLabel}>Completed activity PDF</Text>
        <Text style={styles.meta}>{pack.finalRecord.fileName}</Text>
        <Text style={styles.meta}>Signed record saved {new Date(pack.finalRecord.finalisedAt).toLocaleString('en-AU')}</Text>
      </View>
    </View> : pack.instance.status === 'completed' ? <View style={styles.conflict}>
      <MaterialCommunityIcons name="file-clock-outline" size={24} color={colours.red} />
      <View style={styles.flex}>
        <Text style={styles.conflictTitle}>Completed PDF not ready</Text>
        <Text style={styles.conflictText}>Sync this job. Do not treat the work pack as handed over until the signed PDF is available here.</Text>
      </View>
    </View> : null}
    {completion.blockers.map((blocker) => <View key={`${blocker.code}:${blocker.key}`} style={styles.blocker}><MaterialCommunityIcons name="alert-circle-outline" size={20} color={colours.red} /><View style={styles.flex}><Text style={styles.blockerTitle}>{blocker.message}</Text></View></View>)}
    {pending ? <Text style={styles.warning}>Wait for drafts, signatures and files to finish saving.</Text> : null}
    {conflict ? <Text style={styles.warning}>Resolve the saved conflict before finishing.</Text> : null}
    {completion.ready && !pending && !conflict && pack.instance.status !== 'completed' ? <View style={styles.ready}><MaterialCommunityIcons name="shield-check-outline" size={25} color={colours.green} /><Text style={styles.readyText}>Everything required on this device is ready. Tap Finish work pack.</Text></View> : null}
  </View>;
}

function ExecutionContextReview({ pack }: { pack: FieldActivityWorkPack }) {
  if (
    !(pack.executionContext?.provider?.tradingName || pack.executionContext?.provider?.legalName)
    || !pack.executionContext?.installerBusiness?.businessName
    || !pack.executionContext?.assignment?.displayName
  ) {
    return <View style={styles.conflict}>
      <MaterialCommunityIcons name="account-alert-outline" size={24} color={colours.red} />
      <View style={styles.flex}>
        <Text style={styles.conflictTitle}>Delivery identities not loaded</Text>
        <Text style={styles.conflictText}>Sync this job before signing. The work pack cannot finish without the authorised provider, trade business and assigned technician.</Text>
      </View>
    </View>;
  }
  const { provider, installerBusiness, assignment } = pack.executionContext;
  return <View style={styles.identitySummary}>
    <Text style={styles.sectionEyebrow}>WHO IS DELIVERING THIS WORK</Text>
    <View style={styles.identityRow}>
      <Text style={styles.meta}>Authorised provider</Text>
      <Text style={styles.promptLabel}>{provider.tradingName || provider.legalName}</Text>
      {provider.abn ? <Text style={styles.meta}>ABN {provider.abn}</Text> : null}
    </View>
    <View style={styles.identityRow}>
      <Text style={styles.meta}>Trade business</Text>
      <Text style={styles.promptLabel}>{installerBusiness.businessName}</Text>
      {installerBusiness.abn || installerBusiness.participantAbn
        ? <Text style={styles.meta}>ABN {installerBusiness.abn || installerBusiness.participantAbn}</Text>
        : null}
    </View>
    <View style={styles.identityRow}>
      <Text style={styles.meta}>Assigned technician or assessor</Text>
      <Text style={styles.promptLabel}>{assignment.displayName}</Text>
      <Text style={styles.meta}>{readable(assignment.role)}{assignment.phone ? ` | ${assignment.phone}` : ''}</Text>
    </View>
    <View style={styles.identityRow}>
      <Text style={styles.meta}>Activity and job</Text>
      <Text style={styles.promptLabel}>{pack.definition.title}</Text>
      <Text style={styles.meta}>{pack.instance.activityDate}</Text>
    </View>
    <Text style={styles.meta}>These identities come from the assigned job and cannot be edited here. If one is wrong, stop and ask dispatch to correct the assignment before anyone signs.</Text>
  </View>;
}

function CustomerContextReview({
  context,
  protectedCustomer,
  onSave,
}: {
  context?: FieldWorkPackCustomerContext;
  protectedCustomer: boolean;
  onSave: (next: FieldWorkPackCustomerContext) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FieldWorkPackCustomerContext | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  if (protectedCustomer || !context?.editable) {
    return <View style={styles.reviewRow}>
      <Text style={styles.promptLabel}>Customer and site details</Text>
      <Text style={styles.meta}>Protected customer details can only be corrected by the authorised record owner.</Text>
    </View>;
  }
  if (!editing) {
    return <View style={styles.reviewRow}>
      <Text style={styles.promptLabel}>Customer and site details</Text>
      <Text style={styles.description}>{[context.firstName, context.lastName].filter(Boolean).join(' ') || 'Name not set'}</Text>
      <Text style={styles.meta}>{context.phone || 'Phone not set'} | {context.email || 'Email not set'}</Text>
      <Text style={styles.meta}>{[
        context.addressLine1,
        context.addressLine2,
        context.suburb,
        context.state,
        context.postcode,
      ].filter(Boolean).join(', ') || 'Site address not set'}</Text>
      <FieldButton variant="secondary" onPress={() => {
        setDraft({ ...context });
        setEditing(true);
      }}>Correct customer or site details</FieldButton>
    </View>;
  }
  if (!draft) return null;
  const fields: Array<{
    key: keyof FieldWorkPackCustomerContext;
    label: string;
    keyboard?: 'email-address' | 'phone-pad';
  }> = [
    { key: 'firstName', label: 'First name' },
    { key: 'lastName', label: 'Last name' },
    { key: 'phone', label: 'Phone', keyboard: 'phone-pad' },
    { key: 'email', label: 'Email', keyboard: 'email-address' },
    { key: 'addressLine1', label: 'Address line 1' },
    { key: 'addressLine2', label: 'Address line 2' },
    { key: 'suburb', label: 'Suburb' },
    { key: 'state', label: 'State' },
    { key: 'postcode', label: 'Postcode' },
  ];
  return <View style={styles.customerEditor}>
    <Text style={styles.promptLabel}>Correct customer and site details</Text>
    <Text style={styles.warning}>Saving a correction invalidates existing signatures. The required people must review and sign the corrected record again.</Text>
    {saveError ? <Text accessibilityLiveRegion="assertive" style={styles.warning}>{saveError}</Text> : null}
    {fields.map((field) => <View key={field.key} style={styles.customerField}>
      <Text style={styles.meta}>{field.label}</Text>
      <TextInput
        autoCapitalize={field.key === 'email' ? 'none' : 'sentences'}
        keyboardType={field.keyboard || 'default'}
        maxLength={field.key === 'email' ? 180 : 120}
        onChangeText={(value) => setDraft((current) => current ? ({ ...current, [field.key]: value }) : current)}
        style={styles.input}
        value={String(draft[field.key] || '')}
      />
    </View>)}
    <View style={styles.navigation}>
          <FieldButton variant="secondary" disabled={saving} style={styles.flex} onPress={() => {
            setDraft(null);
        setSaveError('');
        setEditing(false);
      }}>Cancel</FieldButton>
      <FieldButton loading={saving} style={styles.flex} onPress={() => void (async () => {
        setSaving(true);
        try {
              await onSave(draft);
              setSaveError('');
              setDraft(null);
          setEditing(false);
        } catch (error) {
          setSaveError(errorMessage(error));
        } finally {
          setSaving(false);
        }
      })()}>Save corrections</FieldButton>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { backgroundColor: colours.surface, borderColor: colours.line, borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  heading: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 68, padding: spacing.md },
  flex: { flex: 1 },
  title: { color: colours.ink, fontSize: 17, fontWeight: '800' },
  meta: { color: colours.muted, fontSize: 12, lineHeight: 17 },
  body: { borderTopColor: colours.line, borderTopWidth: 1, gap: spacing.md, padding: spacing.md },
  conflict: { alignItems: 'flex-start', backgroundColor: colours.redSoft, borderColor: '#efb7b7', borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  conflictTitle: { color: colours.red, fontSize: 15, fontWeight: '900' },
  conflictText: { color: colours.ink, lineHeight: 20 },
  schemaNotice: { backgroundColor: colours.mint, borderColor: colours.mintStrong, borderRadius: radius.sm, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  statusRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  saveState: { backgroundColor: colours.surfaceRaised, borderColor: colours.green, borderRadius: 999, borderWidth: 1, minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm },
  saveStateAttention: { backgroundColor: colours.redSoft, borderColor: colours.red },
  saveStateText: { color: colours.ink, fontSize: 11, fontWeight: '900' },
  schemaNoticeTitle: { color: colours.green, fontSize: 14, fontWeight: '900' },
  nextAction: { color: colours.ink, fontSize: 16, fontWeight: '800', lineHeight: 22 },
  dependencyPanel: { borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  dependencyRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  dependencyAction: { backgroundColor: colours.cream, borderRadius: radius.sm, gap: spacing.sm, marginTop: spacing.sm, padding: spacing.sm },
  actionLabel: { color: colours.ink, fontSize: 13, fontWeight: '800' },
  scenarioOptions: { gap: spacing.xs },
  scenarioOption: { alignItems: 'center', backgroundColor: colours.surface, borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md },
  scenarioOptionSelected: { backgroundColor: colours.mint, borderColor: colours.green },
  scenarioText: { color: colours.ink, flex: 1, fontSize: 15, fontWeight: '700' },
  productSearch: { backgroundColor: colours.surfaceRaised, borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, color: colours.ink, fontSize: 16, minHeight: 50, paddingHorizontal: spacing.md },
  productResults: { gap: spacing.sm },
  productCard: { backgroundColor: colours.surface, borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, overflow: 'hidden' },
  productCardSelected: { borderColor: colours.green, borderWidth: 2 },
  productChoice: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, minHeight: 56, padding: spacing.md },
  quantityRow: { alignItems: 'center', borderTopColor: colours.line, borderTopWidth: 1, flexDirection: 'row', gap: spacing.md, justifyContent: 'center', padding: spacing.sm },
  quantityButton: { alignItems: 'center', backgroundColor: colours.mint, borderColor: colours.green, borderRadius: radius.sm, borderWidth: 1, height: 48, justifyContent: 'center', width: 48 },
  quantityValue: { color: colours.ink, fontSize: 18, fontWeight: '900', minWidth: 48, textAlign: 'center' },
  calculationReview: { color: '#674b00', fontSize: 14, fontWeight: '900', lineHeight: 20, marginTop: 2 },
  sectionEyebrow: { color: colours.green, fontSize: 11, fontWeight: '900', letterSpacing: 0.7 },
  warning: { color: colours.red, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  verifiedCalculation: { color: colours.green, fontSize: 14, fontWeight: '900', lineHeight: 20, marginTop: 2 },
  steps: { flexDirection: 'row', gap: spacing.xs },
  step: { alignItems: 'center', backgroundColor: colours.cream, borderRadius: 999, height: 28, justifyContent: 'center', minWidth: 28 },
  stepActive: { backgroundColor: colours.green },
  stepText: { color: colours.muted, fontSize: 12, fontWeight: '800' },
  stepTextActive: { color: colours.white },
  page: { gap: spacing.md },
  pageTitle: { color: colours.ink, fontSize: 21, fontWeight: '900' },
  description: { color: colours.muted, lineHeight: 21 },
  repeatPanel: { backgroundColor: colours.cream, borderRadius: radius.sm, gap: spacing.sm, padding: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { backgroundColor: colours.surfaceRaised, borderColor: colours.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipActive: { backgroundColor: colours.forest, borderColor: colours.forest },
  chipText: { color: colours.ink, fontSize: 12, fontWeight: '800' },
  chipTextActive: { color: colours.white },
  empty: { alignItems: 'center', padding: spacing.lg },
  prompt: { borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  promptHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  promptLabel: { color: colours.ink, fontSize: 15, fontWeight: '800' },
  stage: { color: colours.blue, fontSize: 11, fontWeight: '800', marginTop: 3 },
  required: { backgroundColor: colours.amberSoft, borderRadius: 999, color: '#674b00', fontSize: 9, fontWeight: '900', paddingHorizontal: spacing.sm, paddingVertical: 4 },
  checkbox: { alignItems: 'center', borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 50, paddingHorizontal: spacing.md },
  checkboxActive: { backgroundColor: colours.mint, borderColor: colours.green },
  checkboxText: { color: colours.ink, fontWeight: '700' },
  options: { gap: spacing.xs },
  option: { borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.md },
  optionActive: { backgroundColor: colours.mint, borderColor: colours.green },
  optionText: { color: colours.ink, fontWeight: '700' },
  input: { backgroundColor: colours.surfaceRaised, borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, color: colours.ink, fontSize: 16, minHeight: 50, paddingHorizontal: spacing.md },
  textarea: { minHeight: 100, paddingTop: spacing.md, textAlignVertical: 'top' },
  capturePanel: { backgroundColor: colours.cream, borderRadius: radius.sm, gap: spacing.sm, padding: spacing.md },
  signaturePanel: { gap: spacing.md },
  boundSigner: { backgroundColor: colours.mint, borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  savedSignatureCard: { backgroundColor: colours.surface, borderColor: colours.green, borderRadius: radius.sm, borderWidth: 2, gap: spacing.sm, padding: spacing.md },
  savedSignatureHeading: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  savedSignaturePlaceholder: { alignItems: 'center', backgroundColor: colours.surface, borderColor: colours.green, borderRadius: radius.sm, borderWidth: 2, gap: spacing.sm, justifyContent: 'center', minHeight: 180, padding: spacing.lg },
  attestation: { backgroundColor: colours.mint, borderColor: colours.mintStrong, borderRadius: radius.sm, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  attestationLabel: { color: colours.green, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  attestationText: { color: colours.ink, lineHeight: 20 },
  navigation: { flexDirection: 'row', gap: spacing.sm },
  reviewRow: { borderBottomColor: colours.line, borderBottomWidth: 1, gap: spacing.sm, paddingBottom: spacing.md },
  identitySummary: { backgroundColor: colours.cream, borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, gap: spacing.md, padding: spacing.md },
  identityRow: { borderBottomColor: colours.line, borderBottomWidth: 1, gap: spacing.xs, paddingBottom: spacing.sm },
  reviewValue: { color: colours.green, fontSize: 19, fontWeight: '900' },
  customerEditor: { backgroundColor: colours.cream, borderRadius: radius.sm, gap: spacing.sm, padding: spacing.md },
  customerField: { gap: spacing.xs },
  blocker: { alignItems: 'flex-start', backgroundColor: colours.redSoft, borderRadius: radius.sm, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  blockerTitle: { color: colours.ink, fontWeight: '700' },
  ready: { alignItems: 'center', backgroundColor: colours.mint, borderRadius: radius.sm, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  readyText: { color: colours.ink, flex: 1, fontWeight: '700', lineHeight: 20 },
  finalRecord: { alignItems: 'center', backgroundColor: colours.mint, borderColor: colours.green, borderRadius: radius.sm, borderWidth: 2, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, minHeight: 96, padding: spacing.md },
  pressed: { opacity: 0.72 },
});
