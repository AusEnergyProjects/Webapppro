"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  parseSurgeConversationState,
  type SurgeConversationState,
} from "@/lib/energy-assistant-conversation";
import { HOME_ENERGY_ASSESSMENT_STORAGE_KEY } from "@/lib/home-energy-assessment-storage";
import { OPEN_SURGE_EVENT } from "@/lib/energy-assistant-events";
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
  mode: Audience;
  messages: AssistantMessage[];
  continuation: SurgeConversationState | null;
  profile: SurgeStarterProfile;
  lastActive: string;
  expired: boolean;
};

type SurgeStarterProfile = {
  postcode: string;
  relationship: "owner-occupier" | "renter" | "landlord" | "strata" | "not-sure";
  homeType: "detached-house" | "townhouse" | "apartment-unit" | "rural-home" | "not-sure";
  householdSize: "one" | "two" | "three-four" | "five-plus" | "not-sure";
  priority: "lower-bills" | "comfort" | "healthy-home" | "electrify" | "solar-storage" | "not-sure";
  completed: boolean;
};

const STORAGE_KEY = "aea-energy-guide-v1";
const DISPLAY_PREFERENCE_KEY = "aea-surge-display-v1";
const DISPLAY_PREFERENCE_TUCKED = "tucked";
const MAX_MESSAGE_LENGTH = 1200;
const MAX_LOCAL_MESSAGES = 40;
const MAX_LOCAL_STORAGE_CHARACTERS = 160_000;
const MAX_RECENT_TURNS = 8;
const MAX_RECENT_CONTEXT_CHARACTERS = 6_000;
const LOCAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const EMPTY_STARTER_PROFILE: SurgeStarterProfile = {
  postcode: "",
  relationship: "owner-occupier",
  homeType: "detached-house",
  householdSize: "three-four",
  priority: "lower-bills",
  completed: false,
};

const PROFILE_RELATIONSHIPS = new Set<SurgeStarterProfile["relationship"]>([
  "owner-occupier", "renter", "landlord", "strata", "not-sure",
]);
const PROFILE_HOME_TYPES = new Set<SurgeStarterProfile["homeType"]>([
  "detached-house", "townhouse", "apartment-unit", "rural-home", "not-sure",
]);
const PROFILE_HOUSEHOLD_SIZES = new Set<SurgeStarterProfile["householdSize"]>([
  "one", "two", "three-four", "five-plus", "not-sure",
]);
const PROFILE_PRIORITIES = new Set<SurgeStarterProfile["priority"]>([
  "lower-bills", "comfort", "healthy-home", "electrify", "solar-storage", "not-sure",
]);

const START_ROADMAP = [
  {
    label: "Improve my home",
    questions: [
      "What should I upgrade first?",
      "Why is one room too hot or too cold?",
    ],
  },
  {
    label: "Costs and support",
    questions: [
      "How much could solar, a battery or an EV save me?",
      "Which rebates could apply to my home?",
    ],
  },
  {
    label: "Compare my options",
    questions: [
      "Help me compare an energy quote",
      "Which heating, hot water or cooking option suits my home?",
    ],
  },
] as const;

function SurgeMascot({ peeking = false }: { peeking?: boolean }) {
  return (
    <span
      className={`${styles.mascot}${peeking ? ` ${styles.mascotPeeking}` : ""}`}
      aria-hidden="true"
    />
  );
}

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
  "/surge",
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
    suggestions: asString(record.followUpQuestion, 180)
      ? [asString(record.followUpQuestion, 180)]
      : asStringList(
        record.suggestedQuestions ?? record.suggestions ?? record.followUps,
        1,
        180,
      ),
    actions: parseActions(record.toolActions ?? record.actions ?? record.tools),
  };
}

function customerVisibleText(value: string, audience: Audience): string {
  if (audience === "trade") return value;
  return value.replace(
    /\b(?:TLink|Creditex)(?:\s+or\s+(?:TLink|Creditex))?\b/gi,
    "the trade platform",
  );
}

function naturalFollowUpFor(message: AssistantMessage, audience: Audience): string {
  const suggestion = customerVisibleText(message.suggestions[0]?.trim() || "", audience);
  if (!suggestion) return "";
  const normalizedSuggestion = suggestion.replace(/[?.!]+$/u, "").toLocaleLowerCase();
  const normalizedAnswer = customerVisibleText(
    message.directAnswer || message.content,
    audience,
  ).toLocaleLowerCase();
  return normalizedAnswer.includes(normalizedSuggestion) ? "" : suggestion;
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
} {
  if (pathname === "/account" || pathname.startsWith("/account/")) {
    const knownPath = SAFE_EXACT_ACTIONS.has(pathname) ? pathname : "/account";
    return {
      audience: "customer",
      apiPath: knownPath,
      modeLabel: "Customer guide",
      intro: "Tell me what you want to improve, compare or understand. I will explain it clearly and ask one useful question at a time. I do not read private account, project or quote records.",
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
      intro: "Tell me what you want to improve, compare or understand. I will explain it clearly and ask one useful question at a time. I do not read customer, job or certificate records.",
    };
  }
  const safePublicPath = /^\/(?:|assessments|calculator|compare(?:\/gas)?|direct-trade\/standards|guides(?:\/[a-z0-9-]+)?|plan|platform|privacy|rebates|surge)$/.test(pathname)
    ? pathname
    : "/";
  if (isSharedUtilityRoute(pathname) && rememberedAudience === "trade") {
    return {
      audience: "trade",
      apiPath: safePublicPath,
      modeLabel: "Trade guide",
      intro: "Tell me what you want to improve, compare or understand. I will explain it clearly and ask one useful question at a time. I do not read customer, job or certificate records.",
    };
  }
  if (isSharedUtilityRoute(pathname) && rememberedAudience === "customer") {
    return {
      audience: "customer",
      apiPath: safePublicPath,
      modeLabel: "Customer guide",
      intro: "Tell me what you want to improve, compare or understand. I will explain it clearly and ask one useful question at a time. I do not read private account, project or quote records.",
    };
  }
  return {
    audience: "public",
    apiPath: safePublicPath,
    modeLabel: "Household guide",
    intro: "Hi, I am Surge AI. Tell me what you want to improve, compare or understand. I will explain it clearly and ask one useful question at a time. No contact details needed.",
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

function starterProfile(value: unknown): SurgeStarterProfile {
  const record = asRecord(value);
  const postcode = asString(record?.postcode, 4);
  const relationship = PROFILE_RELATIONSHIPS.has(record?.relationship as SurgeStarterProfile["relationship"])
    ? record?.relationship as SurgeStarterProfile["relationship"]
    : EMPTY_STARTER_PROFILE.relationship;
  const homeType = PROFILE_HOME_TYPES.has(record?.homeType as SurgeStarterProfile["homeType"])
    ? record?.homeType as SurgeStarterProfile["homeType"]
    : EMPTY_STARTER_PROFILE.homeType;
  const householdSize = PROFILE_HOUSEHOLD_SIZES.has(record?.householdSize as SurgeStarterProfile["householdSize"])
    ? record?.householdSize as SurgeStarterProfile["householdSize"]
    : EMPTY_STARTER_PROFILE.householdSize;
  const priority = PROFILE_PRIORITIES.has(record?.priority as SurgeStarterProfile["priority"])
    ? record?.priority as SurgeStarterProfile["priority"]
    : EMPTY_STARTER_PROFILE.priority;
  return {
    postcode: /^\d{4}$/.test(postcode) ? postcode : "",
    relationship,
    homeType,
    householdSize,
    priority,
    completed: record?.completed === true && /^\d{4}$/.test(postcode),
  };
}

function starterProfileContext(profile: SurgeStarterProfile) {
  if (!profile.completed) return "";
  const relationship = {
    "owner-occupier": "owner-occupier",
    renter: "renter",
    landlord: "landlord",
    strata: "strata or owners corporation member",
    "not-sure": "relationship to the property not yet confirmed",
  }[profile.relationship];
  const homeType = {
    "detached-house": "detached house",
    townhouse: "townhouse, terrace, villa or duplex",
    "apartment-unit": "apartment or unit",
    "rural-home": "rural home",
    "not-sure": "home type not yet confirmed",
  }[profile.homeType];
  const householdSize = {
    one: "one person",
    two: "two people",
    "three-four": "three or four people",
    "five-plus": "five or more people",
    "not-sure": "household size not yet confirmed",
  }[profile.householdSize];
  const priority = {
    "lower-bills": "lower energy bills",
    comfort: "a warmer winter home and cooler summer home",
    "healthy-home": "healthier air and moisture control",
    electrify: "moving away from gas",
    "solar-storage": "solar or battery options",
    "not-sure": "the best first upgrade",
  }[profile.priority];
  return `Household starting point: postcode ${profile.postcode}; ${relationship}; ${homeType}; ${householdSize}; main goal is ${priority}. Treat newer details in the chat as corrections.`;
}

function recentTurnsForRequest(
  messages: readonly AssistantMessage[],
  profile: SurgeStarterProfile = EMPTY_STARTER_PROFILE,
) {
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    const content = message.content.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!content) continue;
    const turn = { role: message.role, content };
    if (turns.at(-1)?.role === turn.role) turns[turns.length - 1] = turn;
    else turns.push(turn);
  }
  const profileContext = starterProfileContext(profile);
  if (profileContext) {
    if (turns[0]?.role === "user") {
      turns[0] = {
        role: "user",
        content: `${profileContext}\n${turns[0].content}`.slice(0, MAX_MESSAGE_LENGTH),
      };
    } else {
      turns.unshift({ role: "user", content: profileContext });
    }
  }
  if (turns.length > MAX_RECENT_TURNS) {
    turns.splice(0, turns.length - MAX_RECENT_TURNS);
  }
  while (
    turns.length > 0
    && turns.reduce((total, turn) => total + turn.content.length, 0) > MAX_RECENT_CONTEXT_CHARACTERS
  ) turns.shift();
  if (turns[0]?.role === "assistant") turns.shift();
  return turns;
}

function savedConversation(value: unknown, now = Date.now()): SavedConversation {
  const record = asRecord(value);
  const lastActive = asString(record?.lastActive, 80);
  const activeAt = new Date(lastActive).getTime();
  const expired = !Number.isFinite(activeAt) || now - activeAt > LOCAL_RETENTION_MS;
  return {
    mode: record?.mode === "trade" || record?.mode === "customer" ? record.mode : "public",
    messages: expired ? [] : boundedLocalMessages(record?.messages),
    continuation: expired ? null : parseSurgeConversationState(record?.continuation),
    profile: expired ? EMPTY_STARTER_PROFILE : starterProfile(record?.profile),
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

function readStoredMascotTucked() {
  return accessBrowserStorage(
    (storage) => storage.getItem(DISPLAY_PREFERENCE_KEY) === DISPLAY_PREFERENCE_TUCKED,
    false,
  );
}

function storeMascotTucked(tucked: boolean) {
  accessBrowserStorage((storage) => {
    if (tucked) storage.setItem(DISPLAY_PREFERENCE_KEY, DISPLAY_PREFERENCE_TUCKED);
    else storage.removeItem(DISPLAY_PREFERENCE_KEY);
    return true;
  }, false);
}

async function readStoredPlanContext() {
  try {
    const storedAssessment = window.sessionStorage.getItem(HOME_ENERGY_ASSESSMENT_STORAGE_KEY);
    if (!storedAssessment) return null;
    const { buildSurgePlanContextFromStoredAssessment } = await import(
      "@/lib/energy-assistant-plan-context"
    );
    return buildSurgePlanContextFromStoredAssessment(storedAssessment);
  } catch {
    return null;
  }
}

export function EnergyAssistantWidget() {
  const pathname = usePathname() || "/";
  const dedicated = pathname === "/surge";
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
  const continuationRef = useRef<SurgeConversationState | null>(null);
  const hydrationStartedRef = useRef(false);

  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [openPathname, setOpenPathname] = useState("");
  const [mascotTucked, setMascotTucked] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [continuation, setContinuation] = useState<SurgeConversationState | null>(null);
  const [profile, setProfile] = useState<SurgeStarterProfile>(EMPTY_STARTER_PROFILE);
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
  const effectiveOpen = dedicated || (open && openPathname === pathname && !hidden);
  const needsStarterProfile = context.audience !== "trade" && messages.length === 0 && !profile.completed;
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

  const replaceMessages = (nextMessages: AssistantMessage[]) => {
    const boundedMessages = boundedLocalMessages(nextMessages);
    messagesRef.current = boundedMessages;
    setMessages(boundedMessages);
    storeSession(JSON.stringify({
      mode: context.audience,
      messages: boundedMessages,
      continuation: continuationRef.current,
      profile,
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
    continuationRef.current = null;
    setMessages(nextMessages);
    setContinuation(null);
    setProfile(EMPTY_STARTER_PROFILE);
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
        setMascotTucked(readStoredMascotTucked());
        const stored = readStoredSession();
        if (stored) {
          const saved = savedConversation(JSON.parse(stored));
          messagesRef.current = saved.messages;
          continuationRef.current = saved.continuation;
          setMessages(saved.messages);
          setContinuation(saved.continuation);
          setProfile(saved.profile);
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
    const syncDisplayPreference = (event: StorageEvent) => {
      if (event.key !== DISPLAY_PREFERENCE_KEY) return;
      setMascotTucked(event.newValue === DISPLAY_PREFERENCE_TUCKED);
    };
    window.addEventListener("storage", syncDisplayPreference);
    return () => window.removeEventListener("storage", syncDisplayPreference);
  }, []);

  useEffect(() => {
    const openFromCustomerPage = (event: Event) => {
      if (hidden || context.audience === "trade") return;
      const detail = event instanceof CustomEvent ? asRecord(event.detail) : null;
      const nextDraft = asString(detail?.draft, MAX_MESSAGE_LENGTH);
      setMascotTucked(false);
      storeMascotTucked(false);
      setOpenPathname(pathname);
      setOpen(true);
      if (nextDraft) setDraft(nextDraft);
    };
    window.addEventListener(OPEN_SURGE_EVENT, openFromCustomerPage);
    return () => window.removeEventListener(OPEN_SURGE_EVENT, openFromCustomerPage);
  }, [context.audience, hidden, pathname]);

  useEffect(() => {
    if (!hydrated) return;
    storeSession(JSON.stringify({
      mode: context.audience,
      messages: boundedLocalMessages(messages),
      continuation,
      profile,
      lastActive: [...messages].reverse().find((message) => message.createdAt)?.createdAt || "",
    }));
  }, [context.audience, continuation, hydrated, messages, profile]);

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
    if (!effectiveOpen || dedicated) return;
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
    window.requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));
    return () => {
      media.removeEventListener("change", applyBodyLock);
      if (bodyLocked) window.document.body.style.overflow = priorOverflow;
      returnFocusRef.current?.focus();
    };
  }, [dedicated, effectiveOpen]);

  useEffect(() => {
    const container = conversationRef.current;
    if (!effectiveOpen || !container) return;
    const hasConversation = messages.length > 0;
    container.scrollTo({
      top: hasConversation ? container.scrollHeight : 0,
      behavior: hasConversation ? "smooth" : "auto",
    });
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
    const recentTurns = recentTurnsForRequest(messagesRef.current, profile);
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
      const planContext = context.audience === "trade" ? null : await readStoredPlanContext();
      const response = await fetch("/api/energy-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ask",
          requestId,
          message,
          recentTurns,
          continuation: continuationRef.current,
          planContext,
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
      const nextContinuation = parseSurgeConversationState(record.continuation);
      continuationRef.current = nextContinuation;
      setContinuation(nextContinuation);
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

  const completeStarterProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(profile.postcode)) return;
    setProfile((current) => ({ ...current, completed: true }));
    setStatus("");
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
      setLeadError("Choose at least one service so Australian Energy Assessments can route your request.");
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
      setLeadError("Add your name so Australian Energy Assessments knows who requested help.");
      return;
    }
    if (!lead.email.trim() && !lead.phone.trim()) {
      setLeadError("Add an email address or phone number so Australian Energy Assessments can respond.");
      return;
    }
    setLeadError("");
    setLeadStage("preferences");
  };

  const submitLead = async (event: FormEvent) => {
    event.preventDefault();
    if (leadBusy || !lead.serviceConsent) return;
    if (!lead.email.trim() && !lead.phone.trim()) {
      setLeadError("Add an email address or phone number so Australian Energy Assessments can respond.");
      return;
    }
    if (!lead.services.length) {
      setLeadError("Choose at least one service so Australian Energy Assessments can route your request.");
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
      setLeadError("Finish the trade brief or leave trade sharing off. Not sure is allowed; Australian Energy Assessments help stays available.");
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
        setLeadError("Add two useful details for each service or leave trade sharing off. Australian Energy Assessments help stays available.");
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
      });
      const response = await fetch("/api/energy-assistant/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(leadPayload),
      });
      const payload: unknown = await response.json().catch(() => null);
      const record = asRecord(payload);
      if (!response.ok || record?.ok !== true) {
        throw new Error(parseApiError(payload, "Australian Energy Assessments could not receive your request."));
      }
      const tradeSharing = asString(record.tradeSharing, 40);
      setLeadStatus(
        lead.tradeSharingConsent && tradeSharing !== "shared"
          ? "Your request is with Australian Energy Assessments. It has not been shared with trades because the brief still needs more useful detail."
          : lead.tradeSharingConsent
            ? "Your request is with Australian Energy Assessments and the completed brief was shared with matched trades."
            : "Your request has been sent to Australian Energy Assessments.",
      );
    } catch (caught) {
      setLeadError(caught instanceof Error ? caught.message : "Australian Energy Assessments could not receive your request.");
    } finally {
      setLeadBusy(false);
    }
  };

  if (!hydrated || hidden) return null;

  return (
    <div
      className={`${styles.root}${dedicated ? ` ${styles.rootDedicated}` : ""}${effectiveOpen && !dedicated ? ` ${styles.rootOpen}` : ""}${!effectiveOpen && mascotTucked ? ` ${styles.rootTucked}` : ""}`}
      data-energy-assistant
      role={dedicated ? "main" : undefined}
    >
      {!dedicated && <div className={styles.launcherWrap}>
        {effectiveOpen ? (
          <button
            ref={launcherRef}
            className={styles.launcher}
            type="button"
            data-mascot-state={messages.length > 0 ? "returning" : "idle"}
            aria-label="Close Surge AI"
            aria-controls="aea-energy-guide"
            aria-expanded="true"
            onClick={close}
          >
            <SurgeMascot />
          </button>
        ) : mascotTucked ? (
            <button
              ref={launcherRef}
              className={styles.launcherPeek}
              type="button"
              aria-label="Bring Surge AI back and open chat"
              aria-controls="aea-energy-guide"
              aria-expanded="false"
              onClick={() => {
                setMascotTucked(false);
                storeMascotTucked(false);
                setOpenPathname(pathname);
                setOpen(true);
              }}
            >
              <SurgeMascot peeking />
            </button>
        ) : (
            <>
              <button
                ref={launcherRef}
                className={styles.launcher}
                type="button"
                data-mascot-state={messages.length > 0 ? "returning" : "idle"}
                aria-label="Open Surge AI"
                aria-controls="aea-energy-guide"
                aria-expanded="false"
                onClick={() => {
                  setOpenPathname(pathname);
                  setOpen(true);
                }}
              >
                <SurgeMascot />
              </button>
              <button
                className={styles.launcherDismiss}
                type="button"
                aria-label="Hide Surge AI mascot"
                title="Hide Surge AI"
                onClick={() => {
                  setMascotTucked(true);
                  storeMascotTucked(true);
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </>
        )}
      </div>}

      {effectiveOpen && (
        <section
          ref={dialogRef}
          id="aea-energy-guide"
          className={styles.panel}
          role={dedicated ? "region" : "dialog"}
          aria-modal={dedicated ? undefined : "true"}
          aria-labelledby="aea-energy-guide-title"
          aria-describedby={messages.length === 0 && !needsStarterProfile ? "aea-energy-guide-description" : undefined}
          tabIndex={dedicated ? undefined : -1}
          onKeyDown={dedicated ? undefined : trapFocus}
        >
          <header className={styles.header}>
            <div>
              <span className={styles.mode}>All things energy upgrades</span>
              <h2 id="aea-energy-guide-title">Ask Surge AI</h2>
            </div>
            {!dedicated && <button type="button" aria-label="Close Surge AI" onClick={close}>
              <span aria-hidden="true">×</span>
            </button>}
          </header>

          <div ref={conversationRef} className={styles.conversation} tabIndex={-1}>
            {needsStarterProfile && (
              <form className={styles.intake} onSubmit={completeStarterProfile}>
                <header>
                  <span>Set the scene</span>
                  <h3>Tell Surge AI about the home</h3>
                  <p>Five quick answers give you a useful first response instead of generic advice. No name, email or phone number is needed.</p>
                </header>
                <div className={styles.intakeGrid}>
                  <label>
                    <span>Property postcode</span>
                    <input
                      required
                      pattern="[0-9]{4}"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      maxLength={4}
                      placeholder="For example 3000"
                      value={profile.postcode}
                      onChange={(event) => setProfile((current) => ({
                        ...current,
                        postcode: event.target.value.replace(/\D/g, "").slice(0, 4),
                        completed: false,
                      }))}
                    />
                  </label>
                  <label>
                    <span>Your relationship to the home</span>
                    <select value={profile.relationship} onChange={(event) => setProfile((current) => ({
                      ...current,
                      relationship: event.target.value as SurgeStarterProfile["relationship"],
                      completed: false,
                    }))}>
                      <option value="owner-occupier">I own and live here</option>
                      <option value="renter">I rent the home</option>
                      <option value="landlord">I am the landlord</option>
                      <option value="strata">Strata or owners corporation</option>
                      <option value="not-sure">Not sure</option>
                    </select>
                  </label>
                  <label>
                    <span>Home type</span>
                    <select value={profile.homeType} onChange={(event) => setProfile((current) => ({
                      ...current,
                      homeType: event.target.value as SurgeStarterProfile["homeType"],
                      completed: false,
                    }))}>
                      <option value="detached-house">Detached house</option>
                      <option value="townhouse">Townhouse, terrace, villa or duplex</option>
                      <option value="apartment-unit">Apartment or unit</option>
                      <option value="rural-home">Rural home</option>
                      <option value="not-sure">Not sure</option>
                    </select>
                  </label>
                  <label>
                    <span>People usually living here</span>
                    <select value={profile.householdSize} onChange={(event) => setProfile((current) => ({
                      ...current,
                      householdSize: event.target.value as SurgeStarterProfile["householdSize"],
                      completed: false,
                    }))}>
                      <option value="one">One person</option>
                      <option value="two">Two people</option>
                      <option value="three-four">Three or four people</option>
                      <option value="five-plus">Five or more people</option>
                      <option value="not-sure">Not sure</option>
                    </select>
                  </label>
                  <label className={styles.intakePriority}>
                    <span>What matters most right now?</span>
                    <select value={profile.priority} onChange={(event) => setProfile((current) => ({
                      ...current,
                      priority: event.target.value as SurgeStarterProfile["priority"],
                      completed: false,
                    }))}>
                      <option value="lower-bills">Lower energy bills</option>
                      <option value="comfort">Feel warmer in winter and cooler in summer</option>
                      <option value="healthy-home">Healthier air and moisture control</option>
                      <option value="electrify">Move away from gas</option>
                      <option value="solar-storage">Solar or battery options</option>
                      <option value="not-sure">Help me work out the first priority</option>
                    </select>
                  </label>
                </div>
                <button className={styles.intakeContinue} type="submit">Start with my home</button>
                <small>These answers stay in this browser with the conversation and can be changed at any time.</small>
              </form>
            )}

            {messages.length === 0 && !needsStarterProfile && (
              <section className={styles.welcome} aria-labelledby="aea-start-heading">
                <span>Start here</span>
                <h3 id="aea-start-heading">What would you like help with?</h3>
                <p id="aea-energy-guide-description">{context.intro}</p>
                {context.audience !== "trade" && profile.completed && (
                  <div className={styles.profileSummary}>
                    <span>Using your postcode and home starting point</span>
                    <button type="button" onClick={() => setProfile((current) => ({ ...current, completed: false }))}>
                      Change details
                    </button>
                  </div>
                )}
              </section>
            )}

            {messages.length === 0 && !needsStarterProfile && (
              <section className={styles.starters} aria-label="Ways Surge AI can help">
                {START_ROADMAP.map((group) => (
                  <div className={styles.starterGroup} key={group.label}>
                    <h4>{group.label}</h4>
                    <div>
                      {group.questions.map((question) => (
                        <button key={question} type="button" disabled={busy} onClick={() => void ask(question)}>
                          <span>{question}</span><span aria-hidden="true">›</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {messages.length > 0 && (
                  <ol className={styles.messages} aria-label="Energy guide conversation" aria-live="polite" aria-relevant="additions text">
                {messages.map((message) => (
                  <li key={message.id} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
                    {message.role === "user" ? (
                      <p>{message.content}</p>
                    ) : (
                      <>
                        <span className={styles.assistantAvatar} aria-hidden="true">
                          <Image src="/surge-mascot.png" alt="" width={56} height={70} />
                        </span>
                        <article className={styles.answerCard}>
                        <header>
                          <span>Surge AI</span>
                        </header>
                        {message.answerStatus === "source_review_required" && (
                          <p className={styles.reviewRequired}>I need a current official rule check before you rely on this for a rebate or eligibility decision.</p>
                        )}
                        <p className={styles.directAnswer}>{customerVisibleText(message.directAnswer || message.content, context.audience)}</p>
                        {naturalFollowUpFor(message, context.audience) && (
                          <p className={styles.clarifyingQuestion}>{naturalFollowUpFor(message, context.audience)}</p>
                        )}
                        </article>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {busy && <p className={styles.thinking} role="status">Surge AI is checking that...</p>}
            {error && <p className={styles.error} role="alert">{error}</p>}
            {status && <p className={styles.status} role="status">{status}</p>}

            {hasUsefulAnswer && serviceInterest && !leadOpen && (
              <section className={styles.leadOffer}>
                <strong>Explore quote or service options, if you want to</strong>
                <p>Only details you choose in the optional form go to Australian Energy Assessments. Your advice is not gated, and Surge AI never sends the raw conversation to trades.</p>
                <button
                  type="button"
                  onClick={() => {
                    setLeadOpen(true);
                  }}
                >
                  Explore professional help
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
                    <p>Showing {leadQuestionPage * 3 + 1} to {Math.min((leadQuestionPage + 1) * 3, quoteQuestions.length)} of {quoteQuestions.length}. These improve quote readiness. Advice and Australian Energy Assessments follow-up stay available if you choose Not sure or Need advice.</p>
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
                    <label><span>Anything Australian Energy Assessments should know? <small>Optional</small></span><textarea rows={3} maxLength={800} value={lead.message} onChange={(event) => updateLead((current) => ({ ...current, message: event.target.value }))} /></label>
                    <div className={styles.leadNav}><button type="button" onClick={() => setLeadStage("contact")}>Back</button><button type="button" onClick={() => setLeadStage("consent")}>Review consent</button></div>
                  </section>
                )}

                {leadStage === "consent" && (
                  <section className={styles.leadStep} aria-labelledby="aea-lead-consent">
                    <h4 id="aea-lead-consent">6. Choose what may be shared</h4>
                    <label className={styles.consent}><input type="checkbox" required checked={lead.serviceConsent} onChange={(event) => updateLead((current) => ({ ...current, serviceConsent: event.target.checked }))} /><span>I agree that Australian Energy Assessments may use these details to respond to this service request.</span></label>
                    <label className={styles.consent}><input type="checkbox" checked={lead.tradeSharingConsent} onChange={(event) => updateLead((current) => ({ ...current, tradeSharingConsent: event.target.checked, sharePhone: event.target.checked ? current.sharePhone : false }))} /><span>I separately agree that Australian Energy Assessments may share my name, email, postcode, state, selected services and completed quote brief with approved matched trades. This is optional and unchecked by default.</span></label>
                    {lead.tradeSharingConsent && <label className={styles.consent}><input type="checkbox" checked={lead.sharePhone} onChange={(event) => updateLead((current) => ({ ...current, sharePhone: event.target.checked }))} /><span>Also share my phone number with those matched trades. This is separately optional.</span></label>}
                    <label className={styles.consent}><input type="checkbox" checked={lead.marketingConsent} onChange={(event) => updateLead((current) => ({ ...current, marketingConsent: event.target.checked }))} /><span>I would also like occasional Australian Energy Assessments updates. This is optional and is not required for a response.</span></label>
                    <div className={styles.leadNav}><button type="button" onClick={() => setLeadStage("preferences")}>Back</button></div>
                  </section>
                )}
                {leadError && <p className={styles.error} role="alert">{leadError}</p>}
                {leadStatus && <p className={styles.status} role="status">{leadStatus}</p>}
                {leadStage === "consent" && <button className={styles.leadSubmit} type="submit" disabled={leadBusy || Boolean(leadStatus) || !lead.serviceConsent}>
                  {leadBusy ? "Sending request..." : leadStatus ? "Request sent" : "Send request"}
                </button>}
              </form>
            )}

            <footer className={styles.privacy}>
              <p>Chat history stays on this device for 30 days. Your question and recent context are securely processed to answer you.</p>
              <div>
                <a href="/privacy">Privacy</a>
                <button type="button" disabled={busy || leadBusy} onClick={resetConversation}>
                  Clear conversation
                </button>
              </div>
            </footer>
          </div>

          {(context.audience === "trade" || profile.completed || messages.length > 0) && <form className={styles.composer} onSubmit={submitQuestion}>
            <label htmlFor="aea-energy-guide-question">Ask Surge AI</label>
            <div>
              <textarea
                ref={composerRef}
                id="aea-energy-guide-question"
                rows={2}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="Ask about your home or energy upgrade"
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
              <button type="submit" disabled={busy || !draft.trim()} aria-label="Ask Surge AI">
                <span aria-hidden="true">Send</span>
              </button>
            </div>
            <small>Independent guidance. Confirm regulated work and final eligibility before committing.</small>
          </form>}
        </section>
      )}
    </div>
  );
}
