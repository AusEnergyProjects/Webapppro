/** Matches the existing web and native signature pads without importing server work-pack code. */
export type SwmsSignatureStroke = Readonly<{ points: readonly Readonly<{
  x: number; y: number; pressure: number | null; capturedAtOffsetMs: number;
}>[] }>;
export const SWMS_TEMPLATE = {
  key: "tlink-swms-v1", name: "Safe work method statement", version: 1,
  fields: [
    { key: "workDescription", label: "Work to be carried out", hint: "Describe the actual work and the site conditions.", required: true },
    { key: "highRiskWork", label: "High-risk construction work", hint: "Identify the high-risk construction work involved. If none is identified, record that here.", required: true },
    { key: "workSteps", label: "Work steps", hint: "List the work steps in the order they will be carried out.", required: true },
    { key: "hazardsControls", label: "Hazards and controls", hint: "For each step, identify the hazards, controls and who will put the controls in place.", required: true },
    { key: "consultation", label: "Worker consultation", hint: "Record who was consulted and how this SWMS will be explained to everyone doing the work.", required: true },
    { key: "reviewPlan", label: "Check and review", hint: "Record who will check the controls, when this SWMS will be reviewed and what to do if the work or conditions change.", required: true },
  ],
  declaration: "I have reviewed this statement for the work and conditions described and recorded the controls and worker consultation above.",
} as const;

export type SwmsAnswerKey = typeof SWMS_TEMPLATE.fields[number]["key"];
export type SwmsAnswers = Record<SwmsAnswerKey, string>;
export type SwmsContext = {
  businessName: string; abn: string; workNumber: string; jobTitle: string; siteAddress: string;
  scheduledWorker: { memberId: string; name: string; appointmentId: string; source: "appointment" | "job" | "unassigned" };
  signer: { memberId: string; name: string };
};
export type SwmsRecord = {
  id: string; workOrderId: string; templateName: string; templateVersion: number; status: "draft" | "complete";
  revision: number; answers: SwmsAnswers; context: SwmsContext;
  signature: { strokes: readonly SwmsSignatureStroke[]; signerName: string; signerMemberId: string; signedAt: string } | null;
  completedAt: string; pdfUrl: string; createdAt: string; updatedAt: string;
};
export type SwmsPayload = {
  ok: true; jobRevision: number; template: typeof SWMS_TEMPLATE; context: SwmsContext; record: SwmsRecord | null;
  capabilities: { canEdit: boolean; canSign: boolean; reason?: string }; duplicate?: boolean;
};
export type SwmsStartInput = { action: "start"; workOrderId: string; expectedJobRevision: number };
export type SwmsSaveInput = { workOrderId: string; id: string; expectedRevision: number; expectedJobRevision: number;
  answers: SwmsAnswers; finalize?: boolean; signature?: readonly SwmsSignatureStroke[] };
export const emptySwmsAnswers = (): SwmsAnswers => ({ workDescription: "", highRiskWork: "", workSteps: "", hazardsControls: "", consultation: "", reviewPlan: "" });
