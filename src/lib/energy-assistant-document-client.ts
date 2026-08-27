const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const ACCEPTED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/octet-stream",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export type DocumentConversationMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  content: string;
  directAnswer: string;
  practicalSteps: string[];
  nextAction: string;
  assumptions: string[];
  confidence: string;
  answerStatus: string;
  sourceBoundary: string;
  citations: [];
  suggestions: string[];
  actions: [];
};

function errorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
  if (record.error && typeof record.error === "object" && !Array.isArray(record.error)) {
    const message = (record.error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return fallback;
}

export async function analyseEnergyDocumentFile(file: File) {
  const extensionAccepted = /\.(?:pdf|docx)$/i.test(file.name);
  const typeAccepted = !file.type || ACCEPTED_DOCUMENT_TYPES.has(file.type.toLowerCase());
  if (!extensionAccepted || !typeAccepted) {
    throw new Error("Choose a PDF or modern Word .docx file.");
  }
  if (file.size < 1 || file.size > MAX_DOCUMENT_BYTES) {
    throw new Error("Documents must be between 1 byte and 5 MB.");
  }
  const form = new FormData();
  form.set("file", file);
  const response = await fetch("/api/energy-assistant/document", {
    method: "POST",
    body: form,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessage(payload, "The document could not be analysed."));
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("The document analysis returned an invalid response.");
  }
  const record = payload as Record<string, unknown>;
  const reply = record.reply && typeof record.reply === "object" && !Array.isArray(record.reply)
    ? record.reply as Record<string, unknown>
    : null;
  const directAnswer = typeof reply?.directAnswer === "string" ? reply.directAnswer.trim() : "";
  if (!directAnswer) throw new Error("The document analysis returned an empty answer.");
  const now = new Date().toISOString();
  const messages: DocumentConversationMessage[] = [{
    id: `document:${crypto.randomUUID()}`,
    role: "user",
    createdAt: now,
    content: "Attached a document for analysis.",
    directAnswer: "",
    practicalSteps: [],
    nextAction: "",
    assumptions: [],
    confidence: "",
    answerStatus: "",
    sourceBoundary: "",
    citations: [],
    suggestions: [],
    actions: [],
  }, {
    id: typeof reply?.id === "string" ? reply.id : `document-reply:${crypto.randomUUID()}`,
    role: "assistant",
    createdAt: typeof reply?.createdAt === "string" ? reply.createdAt : now,
    content: directAnswer,
    directAnswer,
    practicalSteps: [],
    nextAction: "",
    assumptions: [],
    confidence: typeof reply?.confidence === "string" ? reply.confidence : "",
    answerStatus: typeof reply?.status === "string" ? reply.status : "answered",
    sourceBoundary: "",
    citations: [],
    suggestions: [],
    actions: [],
  }];
  return { accepted: record.accepted === true, messages };
}
