"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type { EnergyDocumentAnalysis } from "@/lib/energy-assistant-document";
import {
  buildEnergyAssistantLeadPayload,
  createEnergyAssistantSubmissionKey,
} from "@/lib/energy-assistant-lead-client.mjs";
import { ENERGY_SERVICE_OPTIONS } from "@/lib/energy-service-catalogue.mjs";
import { energyAssistantQuoteQuestionsForServices } from "@/lib/public-plan-quote-preparation.mjs";
import styles from "./EnergyAssistantWidget.module.css";

type Audience = "public" | "customer" | "trade";

type Citation = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  jurisdiction: string;
  effectiveDate: string;
  checkedDate: string;
  reviewDue: string;
  sourceTier: string;
  stale: boolean;
};

type AssistantAction = {
  id: string;
  label: string;
  href: string;
};

type AssistantMessage = {
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
  citations: Citation[];
  suggestions: string[];
  actions: AssistantAction[];
};

type LeadDraft = {
  name: string;
  email: string;
  phone: string;
  postcode: string;
  suburb: string;
  state: string;
  services: string[];
  propertyType: string;
  tenure: string;
  budgetRange: string;
  contactPreference: string;
  bestContactTime: string;
  quoteAnswers: Record<string, string>;
  message: string;
  serviceConsent: boolean;
  tradeSharingConsent: boolean;
  sharePhone: boolean;
  marketingConsent: boolean;
};

type AddressLocality = {
  suburb: string;
  state: string;
};

type LocalityLookupStatus = "idle" | "loading" | "ready" | "error";
type LeadStage = "scope" | "basics" | "questions" | "contact" | "preferences" | "consent";

type SavedConversation = {
  open: boolean;
  mode: Audience;
  messages: AssistantMessage[];
  lastActive: string;
  expired: boolean;
};

type LocalDocumentState = EnergyDocumentAnalysis | {
  ok: false;
  code: "ANALYSER_LOAD_FAILED";
  message: string;
};

const STORAGE_KEY = "aea-energy-guide-v1";
const MAX_MESSAGE_LENGTH = 1200;
const MAX_LOCAL_MESSAGES = 40;
const MAX_LOCAL_STORAGE_CHARACTERS = 160_000;
const MAX_RECENT_TURNS = 8;
const MAX_RECENT_CONTEXT_CHARACTERS = 6_000;
const LOCAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const START_ACTIONS = [
  "Lower my bills",
  "Make my home more comfortable",
  "Plan an upgrade",
  "Check a rebate or rule",
  "Understand a product or quote",
] as const;

const SAFE_EXACT_ACTIONS = new Set([
  "/",
  "/account",
  "/account/appointments",
  "/account/profile",
  "/account/projects/new",
  "/account/quotes",
  "/assessments",
  "/calculator",
  "/compare",
  "/compare/gas",
  "/creditex/compliance",
  "/direct-trade/dashboard",
  "/direct-trade/standards",
  "/guides",
  "/plan",
  "/platform",
  "/privacy",
  "/rebates",
]);

const EMPTY_LEAD: LeadDraft = {
  name: "",
  email: "",
  phone: "",
  postcode: "",
  suburb: "",
  state: "",
  services: [],
  propertyType: "not-sure",
  tenure: "not-sure",
  budgetRange: "not-set",
  contactPreference: "either",
  bestContactTime: "business-hours",
  quoteAnswers: {},
  message: "",
  serviceConsent: false,
  tradeSharingConsent: false,
  sharePhone: false,
  marketingConsent: false,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown, maxLength = 4000): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function asStringList(value: unknown, limit: number, itemLength = 500): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return asString(item, itemLength);
      const record = asRecord(item);
      return asString(record?.text ?? record?.label ?? record?.content, itemLength);
    })
    .filter(Boolean)
    .slice(0, limit);
}

function safeCitationUrl(value: unknown): string {
  const candidate = asString(value, 1000);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function safeActionHref(value: unknown): string {
  const candidate = asString(value, 180);
  if (!candidate || candidate.includes("\\") || candidate.includes("?")) return "";
  const [pathname, hash = ""] = candidate.split("#", 2);
  if (hash && !/^[a-z0-9_-]{1,80}$/i.test(hash)) return "";
  if (SAFE_EXACT_ACTIONS.has(pathname)) return candidate;
  if (/^\/guides\/[a-z0-9-]{1,80}$/.test(pathname)) return candidate;
  return "";
}

function parseCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const title = asString(record.title, 260);
    const publisher = asString(record.publisher ?? record.source, 160);
    const url = safeCitationUrl(record.url);
    if (!title || !publisher || !url) return [];
    return [{
      id: asString(record.id, 100) || `source-${index + 1}`,
      title,
      publisher,
      url,
      jurisdiction: asString(record.jurisdiction, 120),
      effectiveDate: asString(
        record.effectiveDate ?? record.effectiveFrom ?? record.effective_at,
        80,
      ),
      checkedDate: asString(
        record.checkedDate ?? record.lastChecked ?? record.reviewedAt ?? record.lastCheckedAt ?? record.reviewed_at,
        80,
      ),
      reviewDue: asString(record.reviewDue ?? record.review_due, 80),
      sourceTier: asString(record.sourceTier ?? record.source_tier, 80),
      stale: record.stale === true,
    }];
  }).slice(0, 8);
}

function parseActions(value: unknown): AssistantAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const label = asString(record.label ?? record.title, 120);
    const href = safeActionHref(record.href);
    if (!label || !href) return [];
    return [{ id: asString(record.id, 100) || `action-${index + 1}`, label, href }];
  }).slice(0, 4);
}

function parseMessage(value: unknown, fallbackRole: "user" | "assistant" = "assistant"): AssistantMessage | null {
  if (typeof value === "string") {
    const content = asString(value);
    return content ? {
      id: makeRequestId("message"),
      role: fallbackRole,
      createdAt: "",
      content,
      directAnswer: fallbackRole === "assistant" ? content : "",
      practicalSteps: [],
      nextAction: "",
      assumptions: [],
      confidence: "",
      answerStatus: "",
      sourceBoundary: "",
      citations: [],
      suggestions: [],
      actions: [],
    } : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const role = record.role === "user" ? "user" : fallbackRole;
  const content = asString(record.content ?? record.text ?? record.answer);
  const directAnswer = asString(record.directAnswer ?? record.direct_answer)
    || (role === "assistant" ? content : "");
  if (!content && !directAnswer) return null;
  return {
    id: asString(record.id, 120) || makeRequestId("message"),
    role,
    createdAt: asString(record.createdAt ?? record.created_at, 80),
    content: content || directAnswer,
    directAnswer,
    practicalSteps: asStringList(
      record.practicalSteps ?? record.practical_steps ?? record.steps,
      3,
    ),
    nextAction: asString(record.nextAction ?? record.next_action, 500),
    assumptions: asStringList(record.assumptions, 4, 320),
    confidence: asString(record.confidence ?? record.confidenceLabel, 80),
    answerStatus: asString(record.status, 80),
    sourceBoundary: asString(record.sourceBoundary ?? record.source_boundary, 700),
    citations: parseCitations(record.citations ?? record.sources),
    suggestions: asStringList(
      record.suggestedQuestions ?? record.suggestions ?? record.followUps,
      directAnswer.includes("AEA Energy Guide only covers") ? 3 : 1,
      180,
    ),
    actions: parseActions(record.toolActions ?? record.actions ?? record.tools),
  };
}

function parseApiError(payload: unknown, fallback: string): string {
  const record = asRecord(payload);
  const error = asRecord(record?.error);
  return asString(error?.message ?? record?.error ?? record?.message, 500) || fallback;
}

function signalsServiceInterest(message: string) {
  return /\b(?:get|request|compare|review|accept|send|need|want|ready for|interested in|explore)\s+(?:a\s+|an\s+|some\s+)?(?:quote|quotes|installer|installers|trade help|tradesperson|tradespeople|service provider|service providers|site visit|assessment)\b|\b(?:book an assessment|contact (?:me|us)|talk to (?:someone|a person)|help (?:finding|me find) (?:an? )?(?:installer|trade|tradesperson|service provider))\b/i.test(message);
}

function makeRequestId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`.slice(0, 80);
}

function lastActiveLabel(messages: readonly AssistantMessage[]) {
  const value = [...messages].reverse().find((message) => message.createdAt)?.createdAt;
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isHiddenRoute(pathname: string): boolean {
  return pathname === "/plan/print"
    || pathname.includes("/print/")
    || pathname.endsWith("/print")
    || pathname.includes("/pdf/")
    || pathname.endsWith("/pdf");
}

function explicitRouteAudience(pathname: string): Audience | null {
  if (pathname === "/account" || pathname.startsWith("/account/")) return "customer";
  if (
    pathname === "/creditex/compliance"
    || pathname === "/operations/control-centre"
    || pathname.startsWith("/direct-trade/")
  ) return "trade";
  return null;
}

function isSharedUtilityRoute(pathname: string) {
  return pathname === "/calculator"
    || pathname === "/rebates"
    || pathname === "/compare"
    || pathname === "/compare/gas"
    || pathname === "/guides"
    || pathname.startsWith("/guides/");
}

function pageContext(pathname: string, rememberedAudience: Audience = "public"): {
  audience: Audience;
  apiPath: string;
  modeLabel: string;
  intro: string;
  tools: AssistantAction[];
} {
  if (pathname === "/account" || pathname.startsWith("/account/")) {
    const knownPath = SAFE_EXACT_ACTIONS.has(pathname) ? pathname : "/account";
    return {
      audience: "customer",
      apiPath: knownPath,
      modeLabel: "Customer guide",
      intro: "Get source-backed help with your home plan. The guide does not read private account, project or quote records from this page.",
      tools: [
        { id: "account", label: "Account overview", href: "/account" },
        { id: "new-project", label: "Start a home project", href: "/account/projects/new" },
        { id: "calculator", label: "Check a rebate", href: "/calculator" },
      ],
    };
  }
  if (
    pathname === "/creditex/compliance"
    || pathname === "/operations/control-centre"
    || pathname.startsWith("/direct-trade/dashboard")
    || pathname === "/direct-trade/access"
    || pathname === "/direct-trade/integrations"
    || pathname === "/direct-trade/team"
  ) {
    const apiPath = pathname === "/creditex/compliance"
      ? "/creditex/compliance"
      : pathname.startsWith("/operations")
        ? "/operations/control-centre"
        : pathname.startsWith("/direct-trade/dashboard")
          ? "/direct-trade/dashboard"
          : pathname;
    return {
      audience: "trade",
      apiPath,
      modeLabel: "Trade guide",
      intro: "Get source-backed rule, product and workflow guidance. The guide does not read customer, job or certificate records from this page.",
      tools: [
        { id: "tlink", label: "TLink workspace", href: "/direct-trade/dashboard" },
        { id: "calculator", label: "Source-verified calculator", href: "/calculator" },
        { id: "creditex", label: "Creditex workspace", href: "/creditex/compliance" },
      ],
    };
  }
  const safePublicPath = /^\/(?:|assessments|calculator|compare(?:\/gas)?|direct-trade\/standards|guides(?:\/[a-z0-9-]+)?|plan|platform|privacy|rebates)$/.test(pathname)
    ? pathname
    : "/";
  if (isSharedUtilityRoute(pathname) && rememberedAudience === "trade") {
    return {
      audience: "trade",
      apiPath: safePublicPath,
      modeLabel: "Trade guide",
      intro: "Keep source-backed trade and platform context while using shared tools. The guide does not read customer, job or certificate records from this page.",
      tools: [
        { id: "tlink", label: "TLink workspace", href: "/direct-trade/dashboard" },
        { id: "calculator", label: "Source-verified calculator", href: "/calculator" },
        { id: "creditex", label: "Creditex workspace", href: "/creditex/compliance" },
      ],
    };
  }
  if (isSharedUtilityRoute(pathname) && rememberedAudience === "customer") {
    return {
      audience: "customer",
      apiPath: safePublicPath,
      modeLabel: "Customer guide",
      intro: "Keep your home-planning context while using shared tools. The guide does not read private account, project or quote records from this page.",
      tools: [
        { id: "account", label: "Account overview", href: "/account" },
        { id: "new-project", label: "Start a home project", href: "/account/projects/new" },
        { id: "calculator", label: "Check a rebate", href: "/calculator" },
      ],
    };
  }
  return {
    audience: "public",
    apiPath: safePublicPath,
    modeLabel: "Household guide",
    intro: "Get practical Australian home energy guidance with the source and review date shown. You can use the guide without sharing contact details.",
    tools: [
      { id: "plan", label: "Build a home plan", href: "/plan" },
      { id: "calculator", label: "Check a rebate", href: "/calculator" },
      { id: "guides", label: "Browse energy guides", href: "/guides" },
    ],
  };
}

function boundedLocalMessages(value: unknown): AssistantMessage[] {
  if (!Array.isArray(value)) return [];
  const parsed = value.flatMap((item) => {
    const role = asRecord(item)?.role === "user" ? "user" : "assistant";
    const message = parseMessage(item, role);
    return message ? [message] : [];
  }).slice(-MAX_LOCAL_MESSAGES);
  while (parsed.length > 2 && JSON.stringify(parsed).length > MAX_LOCAL_STORAGE_CHARACTERS) {
    parsed.splice(0, 2);
  }
  return parsed;
}

function recentTurnsForRequest(messages: readonly AssistantMessage[]) {
  const turns = messages.filter((message) => message.role === "user").slice(-MAX_RECENT_TURNS).map((message) => ({
    role: "user" as const,
    content: message.content.slice(0, MAX_MESSAGE_LENGTH),
  }));
  while (
    turns.length > 0
    && turns.reduce((total, turn) => total + turn.content.length, 0) > MAX_RECENT_CONTEXT_CHARACTERS
  ) turns.shift();
  return turns;
}

function documentLeadSummary(result: LocalDocumentState | null) {
  if (!result?.ok) return "";
  if (result.kind === "quote-pdf") {
    const metrics = result.summary.metrics.slice(0, 4).map((metric) =>
      `${metric.metric}: ${metric.value} ${metric.unit}`,
    );
    const amounts = result.summary.amounts.slice(0, 4).map((amount) =>
      `${amount.label}: ${amount.amount}`,
    );
    return [
      `Local quote review. Topics: ${result.summary.topics.join(", ") || "not classified"}.`,
      `Pages reviewed locally: ${result.summary.pageCount}.`,
      metrics.length ? `Detected values: ${metrics.join("; ")}.` : "",
      amounts.length ? `Detected amounts: ${amounts.join("; ")}.` : "",
      result.summary.missingEvidence.length
        ? `Missing evidence to confirm: ${result.summary.missingEvidence.slice(0, 4).join("; ")}.`
        : "",
      result.summary.questions.length ? `Priority question: ${result.summary.questions[0]}` : "",
    ].filter(Boolean).join(" ").slice(0, 800);
  }
  if (result.kind === "vehicle-comparison-csv") {
    const vehicles = result.summary.vehicles.slice(0, 3).map((vehicle) => [
      `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.variant}`,
      `${vehicle.energyConsumptionWhPerKm} Wh/km`,
      `${vehicle.electricRangeKm} km laboratory range`,
      `current-model flag in file: ${vehicle.currentModelInFile ? "yes" : "no"}`,
      `test cycle: ${vehicle.testCycle}`,
      typeof vehicle.annualFuelCostAud === "number"
        ? `annual fuel cost in file: $${vehicle.annualFuelCostAud.toLocaleString("en-AU")}`
        : "",
    ].filter(Boolean).join(", "));
    return [
      `Local Green Vehicle Guide CSV comparison: ${vehicles.join("; ")}.`,
      result.summary.vehicles.length > vehicles.length
        ? `${result.summary.vehicles.length - vehicles.length} more validated vehicle row${result.summary.vehicles.length - vehicles.length === 1 ? "" : "s"} remain in the local result.`
        : "",
      result.summary.sameTestCycle
        ? `All shown vehicles use ${result.summary.testCycles[0]}.`
        : `Mixed test cycles: ${result.summary.testCycles.join(", ")}; do not rank the laboratory figures as directly comparable.`,
      "Real-world energy use and range depend on conditions and use.",
    ].filter(Boolean).join(" ").slice(0, 800);
  }
  const totals = [
    typeof result.summary.totals.importKwh === "number"
      ? `${result.summary.totals.importKwh} kWh grid import`
      : "",
    typeof result.summary.totals.exportKwh === "number"
      ? `${result.summary.totals.exportKwh} kWh grid export`
      : "",
  ].filter(Boolean).join(" and ");
  return [
    `Local interval-data review for ${result.summary.period.startDate} to ${result.summary.period.endDate}.`,
    totals ? `Proven totals: ${totals}.` : "No direction-and-unit-proven total was calculated.",
    result.summary.loadShape.busiestAverageInterval
      ? `Highest average import interval starts at ${result.summary.loadShape.busiestAverageInterval}.`
      : "",
    result.summary.ambiguities.length
      ? `Check before use: ${result.summary.ambiguities.slice(0, 3).join("; ")}.`
      : "",
  ].filter(Boolean).join(" ").slice(0, 800);
}

function savedConversation(value: unknown, now = Date.now()): SavedConversation {
  const record = asRecord(value);
  const lastActive = asString(record?.lastActive, 80);
  const activeAt = new Date(lastActive).getTime();
  const expired = !Number.isFinite(activeAt) || now - activeAt > LOCAL_RETENTION_MS;
  return {
    open: record?.open === true,
    mode: record?.mode === "trade" || record?.mode === "customer" ? record.mode : "public",
    messages: expired ? [] : boundedLocalMessages(record?.messages),
    lastActive: expired ? "" : lastActive,
    expired,
  };
}

function accessBrowserStorage<T>(operation: (storage: Storage) => T, fallback: T): T {
  try {
    return operation(window.localStorage);
  } catch {
    return fallback;
  }
}

function readStoredSession() {
  return accessBrowserStorage((storage) => storage.getItem(STORAGE_KEY), null);
}

function storeSession(value: string) {
  accessBrowserStorage((storage) => {
    storage.setItem(STORAGE_KEY, value);
    return true;
  }, false);
}

function removeStoredSession() {
  accessBrowserStorage((storage) => {
    storage.removeItem(STORAGE_KEY);
    return true;
  }, false);
}

export function EnergyAssistantWidget() {
  const pathname = usePathname() || "/";
  const [mode, setMode] = useState<Audience>("public");
  const explicitAudience = explicitRouteAudience(pathname);
  const context = useMemo(
    () => pageContext(pathname, explicitAudience || mode),
    [explicitAudience, mode, pathname],
  );
  const hidden = isHiddenRoute(pathname);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<AssistantMessage[]>([]);
  const hydrationStartedRef = useRef(false);

  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [hasUsefulAnswer, setHasUsefulAnswer] = useState(false);
  const [serviceInterest, setServiceInterest] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadStage, setLeadStage] = useState<LeadStage>("scope");
  const [leadQuestionPage, setLeadQuestionPage] = useState(0);
  const [lead, setLead] = useState<LeadDraft>(EMPTY_LEAD);
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadError, setLeadError] = useState("");
  const [leadStatus, setLeadStatus] = useState("");
  const [leadRequestId, setLeadRequestId] = useState("");
  const [leadSubmissionKey, setLeadSubmissionKey] = useState("");
  const [leadGrantedAt, setLeadGrantedAt] = useState("");
  const [localities, setLocalities] = useState<AddressLocality[]>([]);
  const [localityLookupStatus, setLocalityLookupStatus] = useState<LocalityLookupStatus>("idle");
  const [localityLookupError, setLocalityLookupError] = useState("");
  const [documentResult, setDocumentResult] = useState<LocalDocumentState | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [shareDocumentSummary, setShareDocumentSummary] = useState(false);

  const effectiveOpen = open && !hidden;
  const lastActive = lastActiveLabel(messages);
  const structuredDocumentSummary = documentLeadSummary(documentResult);
  const quoteQuestions = useMemo(
    () => energyAssistantQuoteQuestionsForServices(lead.services),
    [lead.services],
  );
  const currentQuoteQuestions = quoteQuestions.slice(leadQuestionPage * 3, leadQuestionPage * 3 + 3);
  const answeredQuoteQuestionCount = quoteQuestions.filter((question) => lead.quoteAnswers[question.id]).length;

  const resetLeadAttempt = () => {
    setLeadRequestId("");
    setLeadSubmissionKey("");
    setLeadGrantedAt("");
    setLeadError("");
    setLeadStatus("");
  };

  const updateLead = (updater: (current: LeadDraft) => LeadDraft) => {
    setLead(updater);
    resetLeadAttempt();
  };

  const rememberModeForNavigation = () => {
    setMode(context.audience);
    storeSession(JSON.stringify({
      open,
      mode: context.audience,
      messages: boundedLocalMessages(messages),
      lastActive: [...messages].reverse().find((message) => message.createdAt)?.createdAt || "",
    }));
  };

  const replaceMessages = (nextMessages: AssistantMessage[]) => {
    const boundedMessages = boundedLocalMessages(nextMessages);
    messagesRef.current = boundedMessages;
    setMessages(boundedMessages);
    storeSession(JSON.stringify({
      open,
      mode: context.audience,
      messages: boundedMessages,
      lastActive: [...boundedMessages].reverse().find((message) => message.createdAt)?.createdAt || "",
    }));
  };

  const clearLocalSession = useCallback(({
    nextMessages = [],
    nextStatus = "",
    resetMode = false,
  }: {
    nextMessages?: AssistantMessage[];
    nextStatus?: string;
    resetMode?: boolean;
  } = {}) => {
    removeStoredSession();
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setHasUsefulAnswer(false);
    setServiceInterest(false);
    setLeadOpen(false);
    setLeadStage("scope");
    setLeadQuestionPage(0);
    setLead(EMPTY_LEAD);
    setLeadError("");
    setLeadStatus("");
    setLeadRequestId("");
    setLeadSubmissionKey("");
    setLeadGrantedAt("");
    setLocalities([]);
    setLocalityLookupStatus("idle");
    setLocalityLookupError("");
    setDocumentResult(null);
    setDocumentBusy(false);
    setShareDocumentSummary(false);
    setError("");
    setStatus(nextStatus);
    setBusy(false);
    setLeadBusy(false);
    if (resetMode) {
      const nextMode = explicitRouteAudience(pathname) || "public";
      setMode(nextMode);
    }
  }, [pathname]);

  useEffect(() => {
    if (hydrationStartedRef.current) return;
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      hydrationStartedRef.current = true;
      try {
        const stored = readStoredSession();
        if (stored) {
          const saved = savedConversation(JSON.parse(stored));
          setOpen(saved.open);
          messagesRef.current = saved.messages;
          setMessages(saved.messages);
          setHasUsefulAnswer(saved.messages.some((message) => message.role === "assistant"));
          setServiceInterest(saved.messages.some((message) =>
            message.role === "user" && signalsServiceInterest(message.content)));
          const restoredMode = explicitRouteAudience(pathname) || saved.mode;
          setMode(restoredMode);
          if (saved.expired) {
            removeStoredSession();
            setStatus("Your locally saved conversation expired after 30 days of inactivity.");
          }
        }
      } catch {
        removeStoredSession();
      }
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, [pathname]);

  useEffect(() => {
    if (!hydrated) return;
    storeSession(JSON.stringify({
      open,
      mode: context.audience,
      messages: boundedLocalMessages(messages),
      lastActive: [...messages].reverse().find((message) => message.createdAt)?.createdAt || "",
    }));
  }, [context.audience, hydrated, messages, open]);

  useEffect(() => {
    const postcode = lead.postcode;
    if (!/^\d{4}$/.test(postcode)) return;
    const controller = new AbortController();
    let current = true;
    void fetch(`/api/address-localities?postcode=${encodeURIComponent(postcode)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const payload: unknown = await response.json().catch(() => null);
      const record = asRecord(payload);
      if (!response.ok || record?.ok !== true || record.postcode !== postcode) {
        throw new Error(asString(record?.error, 300) || "Suburbs could not be loaded for this postcode.");
      }
      const seen = new Set<string>();
      const nextLocalities = Array.isArray(record.localities)
        ? record.localities.flatMap((value) => {
          const locality = asRecord(value);
          const suburb = asString(locality?.suburb, 80);
          const state = asString(locality?.state, 3).toUpperCase();
          const key = `${suburb.toLocaleLowerCase("en-AU")}:${state}`;
          if (!suburb || !/^(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/.test(state) || seen.has(key)) return [];
          seen.add(key);
          return [{ suburb, state }];
        })
        : [];
      if (!nextLocalities.length) throw new Error("No matching suburbs were found for this postcode.");
      if (!current) return;
      setLocalities(nextLocalities);
      setLocalityLookupStatus("ready");
    }).catch((caught: unknown) => {
      if (!current || controller.signal.aborted) return;
      setLocalities([]);
      setLocalityLookupStatus("error");
      setLocalityLookupError(caught instanceof Error
        ? caught.message
        : "Suburbs could not be loaded for this postcode.");
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [lead.postcode]);

  useEffect(() => {
    if (!effectiveOpen) return;
    returnFocusRef.current = window.document.activeElement as HTMLElement;
    const media = window.matchMedia("(max-width: 640px)");
    let bodyLocked = false;
    let priorOverflow = "";
    const applyBodyLock = () => {
      if (media.matches && !bodyLocked) {
        priorOverflow = window.document.body.style.overflow;
        window.document.body.style.overflow = "hidden";
        bodyLocked = true;
      } else if (!media.matches && bodyLocked) {
        window.document.body.style.overflow = priorOverflow;
        bodyLocked = false;
      }
    };
    applyBodyLock();
    media.addEventListener("change", applyBodyLock);
    window.requestAnimationFrame(() => composerRef.current?.focus());
    return () => {
      media.removeEventListener("change", applyBodyLock);
      if (bodyLocked) window.document.body.style.overflow = priorOverflow;
      returnFocusRef.current?.focus();
    };
  }, [effectiveOpen]);

  useEffect(() => {
    const container = conversationRef.current;
    if (!effectiveOpen || !container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [effectiveOpen, leadOpen, messages]);

  const close = () => {
    setOpen(false);
    setError("");
  };

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary, select:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && window.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && window.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const ask = async (question: string) => {
    const message = question.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message || busy) return;
    const recentTurns = recentTurnsForRequest(messagesRef.current);
    const requestId = makeRequestId("ask");
    const userMessage: AssistantMessage = {
      id: requestId,
      role: "user",
      createdAt: new Date().toISOString(),
      content: message,
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
    };
    replaceMessages([...messagesRef.current, userMessage]);
    if (signalsServiceInterest(message)) setServiceInterest(true);
    setDraft("");
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/energy-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ask",
          requestId,
          message,
          recentTurns,
          pageContext: context.apiPath,
          audience: context.audience,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const record = asRecord(payload);
      if (!response.ok || record?.ok !== true) {
        throw new Error(parseApiError(payload, "The guide could not answer that question."));
      }
      const replySource = record.reply ?? record.answer ?? record.message;
      const reply = parseMessage(replySource, "assistant");
      if (!reply) throw new Error("The guide returned an empty answer. Please try again.");
      replaceMessages([...messagesRef.current, reply]);
      setHasUsefulAnswer(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The guide could not answer that question.");
    } finally {
      setBusy(false);
    }
  };

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
  };

  const analyseDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || documentBusy) return;
    setDocumentBusy(true);
    setDocumentResult(null);
    setShareDocumentSummary(false);
    resetLeadAttempt();
    try {
      const { analyseLocalEnergyDocument } = await import("@/lib/energy-assistant-document");
      setDocumentResult(await analyseLocalEnergyDocument(file));
    } catch {
      setDocumentResult({
        ok: false,
        code: "ANALYSER_LOAD_FAILED",
        message: "The local document checker could not start. The file was not uploaded. Please try again.",
      });
    } finally {
      input.value = "";
      setDocumentBusy(false);
    }
  };

  const clearDocument = () => {
    setDocumentResult(null);
    setShareDocumentSummary(false);
    resetLeadAttempt();
  };

  const useVehicleComparisonInQuestion = () => {
    if (!documentResult?.ok || documentResult.kind !== "vehicle-comparison-csv" || !structuredDocumentSummary) return;
    setDraft(`${structuredDocumentSummary}\n\nMy question: `.slice(0, MAX_MESSAGE_LENGTH));
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const resetConversation = () => {
    if (busy || leadBusy) return;
    clearLocalSession({ nextStatus: "Local conversation history cleared.", resetMode: true });
  };

  const toggleServiceCategory = (value: string) => {
    updateLead((current) => ({
      ...current,
      services: current.services.includes(value)
        ? current.services.filter((item) => item !== value)
        : [...current.services, value],
    }));
    setLeadQuestionPage(0);
  };

  const advanceLeadScope = () => {
    if (!lead.services.length) {
      setLeadError("Choose at least one service so AEA can route your request.");
      return;
    }
    if (!lead.suburb || !lead.state || localityLookupStatus !== "ready") {
      setLeadError("Choose a suburb listed for this residential postcode.");
      return;
    }
    setLeadError("");
    setLeadStage("basics");
  };

  const answerCurrentQuoteQuestionsAsUnknown = () => {
    updateLead((current) => {
      const quoteAnswers = { ...current.quoteAnswers };
      for (const question of currentQuoteQuestions) {
        if (quoteAnswers[question.id]) continue;
        quoteAnswers[question.id] = question.options.find((option) => /not sure|need advice/i.test(option)) || question.options[0];
      }
      return { ...current, quoteAnswers };
    });
  };

  const advanceLeadQuestions = (skip: boolean) => {
    if (skip) answerCurrentQuoteQuestionsAsUnknown();
    if (!skip && currentQuoteQuestions.some((question) => !lead.quoteAnswers[question.id])) {
      setLeadError("Answer these questions, or choose Not sure / Need advice to continue.");
      return;
    }
    setLeadError("");
    if ((leadQuestionPage + 1) * 3 < quoteQuestions.length) {
      setLeadQuestionPage((current) => current + 1);
      return;
    }
    setLeadStage("contact");
  };

  const advanceLeadContact = () => {
    if (!lead.name.trim()) {
      setLeadError("Add your name so AEA knows who requested help.");
      return;
    }
    if (!lead.email.trim() && !lead.phone.trim()) {
      setLeadError("Add an email address or phone number so AEA can respond.");
      return;
    }
    setLeadError("");
    setLeadStage("preferences");
  };

  const submitLead = async (event: FormEvent) => {
    event.preventDefault();
    if (leadBusy || !lead.serviceConsent) return;
    if (!lead.email.trim() && !lead.phone.trim()) {
      setLeadError("Add an email address or phone number so AEA can respond.");
      return;
    }
    if (!lead.services.length) {
      setLeadError("Choose at least one service so AEA can route your request.");
      return;
    }
    if (!lead.suburb || !lead.state || localityLookupStatus !== "ready") {
      setLeadError("Choose a suburb listed for this residential postcode.");
      return;
    }
    if (lead.tradeSharingConsent && (!lead.email.trim() || lead.name.trim().split(/\s+/).length < 2)) {
      setLeadError("Add your first and last name and email before sharing the brief with matched trades.");
      return;
    }
    if (lead.tradeSharingConsent && lead.sharePhone && !lead.phone.trim()) {
      setLeadError("Add a phone number or turn off phone sharing with matched trades.");
      return;
    }
    if (
      lead.tradeSharingConsent
      && quoteQuestions.some((question) => !lead.quoteAnswers[question.id])
    ) {
      const firstUnanswered = quoteQuestions.findIndex((question) => !lead.quoteAnswers[question.id]);
      setLeadQuestionPage(Math.max(0, Math.floor(firstUnanswered / 3)));
      setLeadStage("questions");
      setLeadError("Finish the trade brief or leave trade sharing off. Not sure is allowed; AEA help stays available.");
      return;
    }
    if (lead.tradeSharingConsent) {
      const servicesWithoutUsefulDetail = lead.services.filter((service) =>
        quoteQuestions.filter((question) =>
          question.id !== "timing"
          && question.services.length === 1
          && question.services.includes(service)
          && lead.quoteAnswers[question.id]
          && !/not sure|need advice/i.test(lead.quoteAnswers[question.id])).length < 2);
      if (servicesWithoutUsefulDetail.length) {
        const firstMissingQuestion = quoteQuestions.findIndex((question) =>
          question.services.length === 1 && question.services.includes(servicesWithoutUsefulDetail[0]));
        setLeadQuestionPage(Math.max(0, Math.floor(firstMissingQuestion / 3)));
        setLeadStage("questions");
        setLeadError("Add two useful details for each service or leave trade sharing off. AEA help stays available.");
        return;
      }
    }
    setLeadBusy(true);
    setLeadError("");
    setLeadStatus("");
    try {
      const requestId = leadRequestId || makeRequestId("lead");
      const submissionKey = leadSubmissionKey || createEnergyAssistantSubmissionKey();
      const grantedAt = leadGrantedAt || new Date().toISOString();
      setLeadRequestId(requestId);
      setLeadSubmissionKey(submissionKey);
      setLeadGrantedAt(grantedAt);
      const leadPayload = buildEnergyAssistantLeadPayload({
        lead,
        requestId,
        submissionKey,
        grantedAt,
        documentSummary: shareDocumentSummary ? structuredDocumentSummary : "",
      });
      const response = await fetch("/api/energy-assistant/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(leadPayload),
      });
      const payload: unknown = await response.json().catch(() => null);
      const record = asRecord(payload);
      if (!response.ok || record?.ok !== true) {
        throw new Error(parseApiError(payload, "AEA could not receive your request."));
      }
      const tradeSharing = asString(record.tradeSharing, 40);
      setLeadStatus(
        lead.tradeSharingConsent && tradeSharing !== "shared"
          ? "Your request is with Australian Energy Assessments. It has not been shared with trades because the brief still needs more useful detail."
          : lead.tradeSharingConsent
            ? "Your request is with Australian Energy Assessments and the completed brief was shared with matched TLink trades."
            : "Your request has been sent to Australian Energy Assessments.",
      );
    } catch (caught) {
      setLeadError(caught instanceof Error ? caught.message : "AEA could not receive your request.");
    } finally {
      setLeadBusy(false);
    }
  };

  if (!hydrated || hidden) return null;

  return (
    <div className={`${styles.root}${effectiveOpen ? ` ${styles.rootOpen}` : ""}`} data-energy-assistant>
      {!effectiveOpen && (
        <div className={styles.launcherWrap}>
          <span className={styles.launcherLabel} aria-hidden="true">Ask AEA Energy Guide</span>
          <button
            ref={launcherRef}
            className={styles.launcher}
            type="button"
            aria-label="Open Ask AEA Energy Guide"
            aria-controls="aea-energy-guide"
            aria-expanded="false"
            onClick={() => setOpen(true)}
          >
            <span aria-hidden="true">AEA</span>
          </button>
        </div>
      )}

      {effectiveOpen && (
        <section
          ref={dialogRef}
          id="aea-energy-guide"
          className={styles.panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="aea-energy-guide-title"
          aria-describedby="aea-energy-guide-description"
          onKeyDown={trapFocus}
        >
          <header className={styles.header}>
            <div>
              <span className={styles.mode}>{context.modeLabel}</span>
              <h2 id="aea-energy-guide-title">Ask AEA Energy Guide</h2>
            </div>
            <button type="button" aria-label="Close AEA Energy Guide" onClick={close}>
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <div ref={conversationRef} className={styles.conversation} tabIndex={-1}>
            <section className={styles.contextCard} aria-labelledby="aea-page-tools-title">
              <p id="aea-energy-guide-description">{context.intro}</p>
              <div className={styles.pageTools}>
                <strong id="aea-page-tools-title">Useful on this page</strong>
                <div>
                      {context.tools.map((tool) => (
                        <a key={tool.id} href={tool.href} onClick={rememberModeForNavigation}>{tool.label}</a>
                  ))}
                </div>
              </div>
            </section>

            {messages.length === 0 && (
              <section className={styles.starters} aria-labelledby="aea-start-heading">
                <h3 id="aea-start-heading">What do you need help with?</h3>
                <div>
                  {START_ACTIONS.map((action) => (
                    <button key={action} type="button" disabled={busy} onClick={() => void ask(action)}>
                      {action}<span aria-hidden="true">›</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <details className={styles.documentTool}>
              <summary>Check a quote, interval or vehicle CSV locally</summary>
              <div>
                <p id="aea-local-document-boundary">
                  Choose a text-based PDF quote, electricity interval CSV or Green Vehicle Guide CSV. Analysis runs in this browser. The file and extracted text are never uploaded or stored by the guide.
                </p>
                <label className={styles.documentPicker}>
                  <span>{documentBusy ? "Checking locally..." : "Choose PDF or CSV"}</span>
                  <input
                    type="file"
                    accept=".pdf,.csv,application/pdf,text/csv,application/csv"
                    aria-describedby="aea-local-document-boundary"
                    disabled={documentBusy}
                    onChange={(event) => void analyseDocument(event)}
                  />
                </label>
                {documentBusy && <p className={styles.thinking} role="status">Reading and redacting the file in this browser...</p>}
                {documentResult && !documentResult.ok && (
                  <div className={styles.error} role="alert">
                    <strong>{documentResult.code.replaceAll("_", " ")}</strong>
                    <p>{documentResult.message}</p>
                  </div>
                )}
                {documentResult?.ok && documentResult.kind === "quote-pdf" && (
                  <section className={styles.documentResult} aria-labelledby="aea-local-quote-title">
                    <h3 id="aea-local-quote-title">Local quote check</h3>
                    <p>{documentResult.summary.reviewBoundary}</p>
                    <dl>
                      <div><dt>Topics found</dt><dd>{documentResult.summary.topics.join(", ")}</dd></div>
                      <div><dt>Pages read</dt><dd>{documentResult.summary.pageCount}</dd></div>
                    </dl>
                    {documentResult.summary.missingEvidence.length > 0 && (
                      <>
                        <h4>Evidence to confirm</h4>
                        <ul>{documentResult.summary.missingEvidence.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul>
                      </>
                    )}
                    {documentResult.summary.questions.length > 0 && (
                      <>
                        <h4>Questions for the quote</h4>
                        <ul>{documentResult.summary.questions.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
                      </>
                    )}
                  </section>
                )}
                {documentResult?.ok && documentResult.kind === "interval-csv" && (
                  <section className={styles.documentResult} aria-labelledby="aea-local-interval-title">
                    <h3 id="aea-local-interval-title">Local interval-data check</h3>
                    <p>{documentResult.summary.loadShape.tariffBoundary}</p>
                    <dl>
                      <div><dt>Period</dt><dd>{documentResult.summary.period.startDate} to {documentResult.summary.period.endDate}</dd></div>
                      <div><dt>Coverage</dt><dd>{documentResult.summary.period.coveragePercent}%</dd></div>
                      <div><dt>Intervals</dt><dd>{documentResult.summary.granularity}</dd></div>
                      <div><dt>Grid import</dt><dd>{typeof documentResult.summary.totals.importKwh === "number" ? `${documentResult.summary.totals.importKwh} kWh` : "Not proven from the column labels and units"}</dd></div>
                    </dl>
                    {documentResult.summary.observations.length > 0 && (
                      <>
                        <h4>Load-shape observations</h4>
                        <ul>{documentResult.summary.observations.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>
                      </>
                    )}
                    {documentResult.summary.ambiguities.length > 0 && (
                      <>
                        <h4>Check before relying on totals</h4>
                        <ul>{documentResult.summary.ambiguities.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>
                      </>
                    )}
                  </section>
                )}
                {documentResult?.ok && documentResult.kind === "vehicle-comparison-csv" && (
                  <section className={styles.documentResult} aria-labelledby="aea-local-vehicle-title">
                    <h3 id="aea-local-vehicle-title">Local Green Vehicle Guide comparison</h3>
                    <p>{documentResult.summary.comparisonBoundary}</p>
                    <dl>
                      <div><dt>Vehicles</dt><dd>{documentResult.summary.vehicleCount}</dd></div>
                      <div><dt>Test cycle</dt><dd>{documentResult.summary.sameTestCycle ? documentResult.summary.testCycles[0] : `Mixed: ${documentResult.summary.testCycles.join(", ")}`}</dd></div>
                      <div><dt>Excluded rows</dt><dd>{documentResult.summary.excludedRowCount}</dd></div>
                    </dl>
                    <ul className={styles.documentVehicles} aria-label="Vehicles in the local GVG comparison">
                      {documentResult.summary.vehicles.map((vehicle) => (
                        <li key={`${vehicle.year}-${vehicle.make}-${vehicle.model}-${vehicle.variant}`}>
                          <strong>{vehicle.year} {vehicle.make} {vehicle.model} {vehicle.variant}</strong>
                          <span>{vehicle.energyConsumptionWhPerKm} Wh/km</span>
                          <span>{vehicle.electricRangeKm} km laboratory range</span>
                          <span>Current-model flag in file: {vehicle.currentModelInFile ? "Yes" : "No"}</span>
                          <span>Test cycle: {vehicle.testCycle}</span>
                          {typeof vehicle.annualFuelCostAud === "number" && (
                            <span>Annual fuel cost in file: ${vehicle.annualFuelCostAud.toLocaleString("en-AU")}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p>{documentResult.summary.annualFuelCostBoundary}</p>
                    {documentResult.summary.ambiguities.length > 0 && (
                      <>
                        <h4>Comparison limits</h4>
                        <ul>{documentResult.summary.ambiguities.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul>
                      </>
                    )}
                    <button className={styles.documentUse} type="button" onClick={useVehicleComparisonInQuestion}>
                      Put this derived comparison in my question
                    </button>
                    <small>Only the concise fields shown here are copied into the question box. Review them before sending. The CSV stays local.</small>
                  </section>
                )}
                {documentResult?.ok && structuredDocumentSummary && (
                  <label className={styles.documentShare}>
                    <input
                      type="checkbox"
                      checked={shareDocumentSummary}
                      onChange={(event) => {
                        setShareDocumentSummary(event.target.checked);
                        resetLeadAttempt();
                      }}
                    />
                    <span>Include only this structured findings summary if I later send the optional AEA service form. Quote lines, file bytes and raw text stay local.</span>
                  </label>
                )}
                {documentResult && (
                  <button className={styles.documentClear} type="button" onClick={clearDocument}>Clear local document result</button>
                )}
              </div>
            </details>

            {messages.length > 0 && (
                  <ol className={styles.messages} aria-label="Energy guide conversation" aria-live="polite" aria-relevant="additions text">
                {messages.map((message) => (
                  <li key={message.id} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
                    {message.role === "user" ? (
                      <p>{message.content}</p>
                    ) : (
                      <article className={styles.answerCard}>
                        <header>
                          <span>Direct answer</span>
                          {message.confidence && <strong>{`${message.confidence[0].toUpperCase()}${message.confidence.slice(1)} confidence`}</strong>}
                        </header>
                        {message.answerStatus === "source_review_required" && (
                          <p className={styles.reviewRequired}>This source needs review before the answer can be used for a current rule, rebate or eligibility decision.</p>
                        )}
                        <p className={styles.directAnswer}>{message.directAnswer || message.content}</p>
                        {message.practicalSteps.length > 0 && (
                          <section className={styles.steps}>
                            <h3>What to do next</h3>
                            <ol>
                              {message.practicalSteps.slice(0, 3).map((step, index) => (
                                <li key={`${message.id}-step-${index + 1}`}>{step}</li>
                              ))}
                            </ol>
                          </section>
                        )}
                        {message.nextAction && (
                          <section className={styles.nextAction}>
                            <strong>Best next action</strong>
                            <p>{message.nextAction}</p>
                          </section>
                        )}
                        {message.actions.length > 0 && (
                          <nav className={styles.answerTools} aria-label="Recommended AEA tools">
                            {message.actions.map((action) => (
                                  <a key={action.id} href={action.href} onClick={rememberModeForNavigation}>{action.label}</a>
                            ))}
                          </nav>
                        )}
                        {message.assumptions.length > 0 && (
                          <details className={styles.assumptions}>
                            <summary>Assumptions and limits</summary>
                            <ul>{message.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
                          </details>
                        )}
                        <section className={styles.sources} aria-label="Sources and dates">
                          <h3>Sources and dates</h3>
                          {message.citations.length > 0 ? (
                            <ol>
                              {message.citations.map((citation) => (
                                <li key={citation.id}>
                                  <a href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a>
                                  <span>
                                    {citation.publisher}
                                    {citation.jurisdiction ? ` · ${citation.jurisdiction}` : ""}
                                    {citation.sourceTier === "primary_official" ? " · Official source" : ""}
                                  </span>
                                  <small>
                                    {citation.effectiveDate ? `Effective ${citation.effectiveDate}` : ""}
                                    {citation.effectiveDate && citation.checkedDate ? " · " : ""}
                                    {citation.checkedDate ? `Checked ${citation.checkedDate}` : ""}
                                    {(citation.effectiveDate || citation.checkedDate) && citation.reviewDue ? " · " : ""}
                                    {citation.reviewDue ? `Review due ${citation.reviewDue}` : ""}
                                    {citation.stale ? " · Source review required" : ""}
                                  </small>
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p>General guidance only. Ask for an official rule check before relying on an eligibility or rebate answer.</p>
                          )}
                          {message.sourceBoundary && <p className={styles.sourceBoundary}>{message.sourceBoundary}</p>}
                        </section>
                        {message.suggestions.length > 0 && (
                          <div className={styles.followUps} aria-label="Suggested follow-up questions">
                            {message.suggestions.slice(0, 1).map((suggestion) => (
                              <button key={suggestion} type="button" disabled={busy} onClick={() => void ask(suggestion)}>
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        )}
                      </article>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {busy && <p className={styles.thinking} role="status">Checking the maintained AEA source library...</p>}
            {error && <p className={styles.error} role="alert">{error}</p>}
            {status && <p className={styles.status} role="status">{status}</p>}

            {hasUsefulAnswer && serviceInterest && !leadOpen && (
              <section className={styles.leadOffer}>
                <strong>Explore quote or service options, if you want to</strong>
                <p>Only details you choose in the optional form go to AEA so its team can contact you. Your advice is not gated, and the guide does not send the raw conversation to trades.</p>
                <button
                  type="button"
                  onClick={() => {
                    setLeadOpen(true);
                  }}
                >
                  Explore help from AEA
                </button>
                <button type="button" onClick={() => composerRef.current?.focus()}>
                  Keep exploring or change subject
                </button>
              </section>
            )}

            {leadOpen && (
              <form className={styles.leadForm} onSubmit={(event) => void submitLead(event)}>
                <header>
                  <div>
                    <span>Optional service request</span>
                    <h3>Ask Australian Energy Assessments to help</h3>
                  </div>
                  <button type="button" aria-label="Close service request" onClick={() => setLeadOpen(false)}>×</button>
                </header>
                <p>Only the details you enter here go to Australian Energy Assessments so its team can respond using your contact details. The raw guide conversation is not sent to trades, and all advice above remains available whether or not you submit.</p>
                {shareDocumentSummary && structuredDocumentSummary && (
                  <p><strong>Structured local document findings selected for this request:</strong> {structuredDocumentSummary}</p>
                )}
                <button type="button" onClick={() => {
                  setLeadOpen(false);
                  window.requestAnimationFrame(() => composerRef.current?.focus());
                }}>
                  Continue asking or change subject
                </button>
                {leadStage !== "scope" && (
                  <section className={styles.leadSummary} aria-label="Quote brief summary">
                    <strong>Brief so far</strong>
                    <p>{lead.suburb}, {lead.state} {lead.postcode}. {lead.services.length} service{lead.services.length === 1 ? "" : "s"}. {answeredQuoteQuestionCount} of {quoteQuestions.length} service details recorded.</p>
                    <div>
                      <button type="button" onClick={() => setLeadStage("scope")}>Edit location or services</button>
                      <button type="button" onClick={() => setLeadStage("basics")}>Edit property details</button>
                      {quoteQuestions.length > 0 && <button type="button" onClick={() => { setLeadQuestionPage(0); setLeadStage("questions"); }}>Edit service details</button>}
                    </div>
                  </section>
                )}

                {leadStage === "scope" && (
                  <section className={styles.leadStep} aria-labelledby="aea-lead-scope">
                    <h4 id="aea-lead-scope">1. Location and help wanted</h4>
                    <label>
                      <span>Residential postcode</span>
                      <input required pattern="[0-9]{4}" maxLength={4} autoComplete="postal-code" inputMode="numeric" value={lead.postcode} onChange={(event) => {
                        const postcode = event.target.value.replace(/\D/g, "").slice(0, 4);
                        setLocalities([]);
                        setLocalityLookupStatus(/^\d{4}$/.test(postcode) ? "loading" : "idle");
                        setLocalityLookupError("");
                        updateLead((current) => ({ ...current, postcode, suburb: "", state: "" }));
                      }} />
                    </label>
                    {localityLookupStatus === "loading" && <p role="status">Loading suburbs for this postcode...</p>}
                    {localityLookupStatus === "error" && <p className={styles.error} role="alert">{localityLookupError}</p>}
                    {localityLookupStatus === "ready" && (
                      <label>
                        <span>Residential suburb and state</span>
                        <select required value={lead.suburb} onChange={(event) => {
                          const selected = localities.find((locality) => locality.suburb === event.target.value);
                          updateLead((current) => ({ ...current, suburb: selected?.suburb || "", state: selected?.state || "" }));
                        }}>
                          <option value="">Choose suburb</option>
                          {localities.map((locality) => <option key={`${locality.suburb}-${locality.state}`} value={locality.suburb}>{locality.suburb}, {locality.state}</option>)}
                        </select>
                      </label>
                    )}
                    <fieldset>
                      <legend>What would you like help with?</legend>
                      <div className={styles.services}>
                        {ENERGY_SERVICE_OPTIONS.map(([value, label]) => (
                          <label key={value}>
                            <input type="checkbox" checked={lead.services.includes(value)} onChange={() => toggleServiceCategory(value)} />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <button type="button" onClick={advanceLeadScope}>Continue</button>
                  </section>
                )}

                {leadStage === "basics" && (
                  <section className={styles.leadStep} aria-labelledby="aea-lead-basics">
                    <h4 id="aea-lead-basics">2. Property basics</h4>
                    <p>Three quick facts improve the brief. Not sure is a valid answer.</p>
                    <label><span>Property type</span><select value={lead.propertyType} onChange={(event) => updateLead((current) => ({ ...current, propertyType: event.target.value }))}><option value="not-sure">Not sure</option><option value="house">House</option><option value="townhouse">Townhouse</option><option value="apartment-unit">Apartment or unit</option><option value="other">Other</option></select></label>
                    <label><span>Your relationship to the property</span><select value={lead.tenure} onChange={(event) => updateLead((current) => ({ ...current, tenure: event.target.value }))}><option value="not-sure">Not sure</option><option value="owner-occupier">Owner-occupier</option><option value="landlord">Landlord</option><option value="renter">Renter</option><option value="strata">Strata</option><option value="trade-client">Trade acting for a client</option></select></label>
                    <label><span>Budget range</span><select value={lead.budgetRange} onChange={(event) => updateLead((current) => ({ ...current, budgetRange: event.target.value }))}><option value="not-set">Not set</option><option value="under-5000">Under $5,000</option><option value="5000-15000">$5,000 to $15,000</option><option value="15000-30000">$15,000 to $30,000</option><option value="30000-plus">$30,000 plus</option></select></label>
                    <div className={styles.leadNav}><button type="button" onClick={() => setLeadStage("scope")}>Back</button><button type="button" onClick={() => setLeadStage(quoteQuestions.length ? "questions" : "contact")}>Continue</button></div>
                  </section>
                )}

                {leadStage === "questions" && (
                  <section className={styles.leadStep} aria-labelledby="aea-lead-questions">
                    <h4 id="aea-lead-questions">3. Service details</h4>
                    <p>Showing {leadQuestionPage * 3 + 1} to {Math.min((leadQuestionPage + 1) * 3, quoteQuestions.length)} of {quoteQuestions.length}. These improve quote readiness. Advice and AEA follow-up stay available if you choose Not sure or Need advice.</p>
                    {currentQuoteQuestions.map((question) => (
                      <label key={question.id}>
                        <span>{question.label}</span>
                        <select value={lead.quoteAnswers[question.id] || ""} onChange={(event) => updateLead((current) => ({ ...current, quoteAnswers: { ...current.quoteAnswers, [question.id]: event.target.value } }))}>
                          <option value="">Choose an answer</option>
                          {question.options.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                    ))}
                    <div className={styles.leadNav}>
                      <button type="button" onClick={() => leadQuestionPage ? setLeadQuestionPage((current) => current - 1) : setLeadStage("basics")}>Back</button>
                      <button type="button" onClick={() => advanceLeadQuestions(true)}>Not sure / skip these</button>
                      <button type="button" onClick={() => advanceLeadQuestions(false)}>Save and continue</button>
                    </div>
                  </section>
                )}

                {leadStage === "contact" && (
                  <section className={styles.leadStep} aria-labelledby="aea-lead-contact">
                    <h4 id="aea-lead-contact">4. Contact details</h4>
                    <label><span>Name</span><input required maxLength={120} autoComplete="name" value={lead.name} onChange={(event) => updateLead((current) => ({ ...current, name: event.target.value }))} /></label>
                    <label><span>Email</span><input type="email" maxLength={254} autoComplete="email" inputMode="email" value={lead.email} onChange={(event) => updateLead((current) => ({ ...current, email: event.target.value }))} /></label>
                    <label><span>Phone</span><input type="tel" maxLength={30} autoComplete="tel" inputMode="tel" value={lead.phone} onChange={(event) => updateLead((current) => ({ ...current, phone: event.target.value }))} /></label>
                    <div className={styles.leadNav}><button type="button" onClick={() => setLeadStage(quoteQuestions.length ? "questions" : "basics")}>Back</button><button type="button" onClick={advanceLeadContact}>Continue</button></div>
                  </section>
                )}

                {leadStage === "preferences" && (
                  <section className={styles.leadStep} aria-labelledby="aea-lead-preferences">
                    <h4 id="aea-lead-preferences">5. Response preferences</h4>
                    <label><span>Preferred contact</span><select value={lead.contactPreference} onChange={(event) => updateLead((current) => ({ ...current, contactPreference: event.target.value }))}><option value="either">Email or phone</option><option value="email">Email</option><option value="phone">Phone</option></select></label>
                    <label><span>Best contact time</span><select value={lead.bestContactTime} onChange={(event) => updateLead((current) => ({ ...current, bestContactTime: event.target.value }))}><option value="business-hours">Business hours</option><option value="after-hours">After hours</option><option value="any-time">Any time</option></select></label>
                    <label><span>Anything AEA should know? <small>Optional</small></span><textarea rows={3} maxLength={800} value={lead.message} onChange={(event) => updateLead((current) => ({ ...current, message: event.target.value }))} /></label>
                    <div className={styles.leadNav}><button type="button" onClick={() => setLeadStage("contact")}>Back</button><button type="button" onClick={() => setLeadStage("consent")}>Review consent</button></div>
                  </section>
                )}

                {leadStage === "consent" && (
                  <section className={styles.leadStep} aria-labelledby="aea-lead-consent">
                    <h4 id="aea-lead-consent">6. Choose what may be shared</h4>
                    <label className={styles.consent}><input type="checkbox" required checked={lead.serviceConsent} onChange={(event) => updateLead((current) => ({ ...current, serviceConsent: event.target.checked }))} /><span>I agree that Australian Energy Assessments may use these details to respond to this service request.</span></label>
                    <label className={styles.consent}><input type="checkbox" checked={lead.tradeSharingConsent} onChange={(event) => updateLead((current) => ({ ...current, tradeSharingConsent: event.target.checked, sharePhone: event.target.checked ? current.sharePhone : false }))} /><span>I separately agree that AEA may share my name, email, postcode, state, selected services and completed quote brief with approved matched TLink trades. This is optional and unchecked by default.</span></label>
                    {lead.tradeSharingConsent && <label className={styles.consent}><input type="checkbox" checked={lead.sharePhone} onChange={(event) => updateLead((current) => ({ ...current, sharePhone: event.target.checked }))} /><span>Also share my phone number with those matched trades. This is separately optional.</span></label>}
                    <label className={styles.consent}><input type="checkbox" checked={lead.marketingConsent} onChange={(event) => updateLead((current) => ({ ...current, marketingConsent: event.target.checked }))} /><span>I would also like occasional AEA energy updates. This is optional and is not required for a response.</span></label>
                    <div className={styles.leadNav}><button type="button" onClick={() => setLeadStage("preferences")}>Back</button></div>
                  </section>
                )}
                {leadError && <p className={styles.error} role="alert">{leadError}</p>}
                {leadStatus && <p className={styles.status} role="status">{leadStatus}</p>}
                {leadStage === "consent" && <button className={styles.leadSubmit} type="submit" disabled={leadBusy || Boolean(leadStatus) || !lead.serviceConsent}>
                  {leadBusy ? "Sending request..." : leadStatus ? "Request sent" : "Send request to AEA"}
                </button>}
              </form>
            )}

            <footer className={styles.privacy}>
              <p>
                This browser stores up to {MAX_LOCAL_MESSAGES} recent messages locally so you can continue for 30 days after your last question. The conversation is not stored on the assistant server.{lastActive ? ` Last active ${lastActive}.` : ""}
              </p>
              <p>No third-party cookie, fingerprint or cross-device anonymous identity is used. Details entered in the optional contact form, lead consent choices, uploaded document bytes and NMI data are not stored in this local conversation or carried into a new one.</p>
              <div>
                <a href="/privacy">Privacy</a>
                <button type="button" disabled={busy || leadBusy} onClick={resetConversation}>
                  New conversation / Clear history
                </button>
              </div>
            </footer>
          </div>

          <form className={styles.composer} onSubmit={submitQuestion}>
            <label htmlFor="aea-energy-guide-question">Ask about your home, an upgrade, a product or a rule</label>
            <div>
              <textarea
                ref={composerRef}
                id="aea-energy-guide-question"
                rows={2}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="Type your question"
                value={draft}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (draft.trim()) void ask(draft);
                  }
                }}
              />
              <button type="submit" disabled={busy || !draft.trim()} aria-label="Ask AEA Energy Guide">
                <span aria-hidden="true">Send</span>
              </button>
            </div>
            <small>Source-backed guidance, not a NatHERS rating, trade quote or certificate decision.</small>
          </form>
        </section>
      )}
    </div>
  );
}
