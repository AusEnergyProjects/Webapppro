"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  type WheelEvent as ReactWheelEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  parseSurgeConversationState,
  type SurgeConversationState,
} from "@/lib/energy-assistant-conversation";
import {
  EMPTY_SURGE_STARTER_PROFILE,
  markSurgeProfileStepReviewed,
  mergeHomeEnergyPlannerSessionIntoSurgeProfile,
  nextUnknownSurgeProfileStepIndex,
  parseSurgeStarterProfile,
  SURGE_PROFILE_FIELDS,
  SURGE_PROFILE_STEPS,
  SURGE_PROFILE_VERSION,
  surgeProfileAnswerLabel,
  surgeProfileFieldIsUnknown,
  surgeProfileFieldWasReviewed,
  surgeProfileFieldValue,
  surgeProfileKnownAnswerCount,
  surgeProfileReviewedAnswerCount,
  surgePlannerProfileAdapter,
  surgeStarterProfileContext,
  updateSurgeProfileField,
  type SurgeProfileField,
  type SurgeStarterProfile,
} from "@/lib/surge-assessor-profile";
import { HOME_ENERGY_ASSESSMENT_STORAGE_KEY } from "@/lib/home-energy-assessment-storage";
import { createHomeEnergyPlannerPublicPlanSnapshot } from "@/lib/home-energy-planner-schema";
import { takePendingSurgeDraft } from "@/lib/surge-page-navigation";
import { homeContextTips } from "@/lib/surge-home-context-tips";
import { recordSurgeProfileStorageHealth } from "@/lib/surge-profile-storage-health";
import { preferSurgeConversation, preferSurgeProfile } from "@/lib/surge-session-continuity";
import {
  ENERGY_ASSISTANT_MATCHING_EXPLANATION,
  ENERGY_ASSISTANT_MATCHING_PRIVACY_EXPLANATION,
} from "@/lib/energy-assistant-enquiry-copy.mjs";
import {
  buildEnergyAssistantLeadPayload,
  createEnergyAssistantSubmissionKey,
} from "@/lib/energy-assistant-lead-client.mjs";
import { ENERGY_SERVICE_OPTIONS } from "@/lib/energy-service-catalogue.mjs";
import { publicPlanQuoteQuestionsForSnapshot } from "@/lib/public-plan-quote-preparation.mjs";
import type { DocumentConversationMessage } from "@/lib/energy-assistant-document-client";
import styles from "./EnergyAssistantWidget.module.css";

const EnergyAssistantDocumentTools = lazy(() => import("./EnergyAssistantDocumentTools"));

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

type QuickReply = {
  id: string;
  label: string;
  message: string;
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
  answerType?: string;
  verdict?: string;
  reason?: string;
  extraDetail?: string;
  quickReplies?: QuickReply[];
  sourceBoundary: string;
  citations: Citation[];
  suggestions: string[];
  actions: AssistantAction[];
};

type LeadDraft = {
  destination: "" | "aea-follow-up" | "matched-trades";
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  unitNumber: string;
  streetAddress: string;
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
  shareName: boolean;
  sharePhone: boolean;
  shareAddress: boolean;
  shareKnownPlanFacts: boolean;
  marketingConsent: boolean;
};

type AddressLocality = {
  suburb: string;
  state: string;
};

type LocalityLookupStatus = "idle" | "loading" | "ready" | "error";
type LeadStage = "destination" | "scope" | "questions" | "contact" | "preferences" | "consent";

type SavedConversation = {
  mode: Audience;
  messages: AssistantMessage[];
  continuation: SurgeConversationState | null;
  profile: SurgeStarterProfile;
  profileUpdatedAt: string;
  lastActive: string;
  expired: boolean;
};

type PersistedSessionOverrides = {
  nextMessages?: AssistantMessage[];
  nextContinuation?: SurgeConversationState | null;
  nextProfile?: SurgeStarterProfile;
  nextProfileUpdatedAt?: string;
};

const STORAGE_KEY = "aea-energy-guide-v1";
const PROFILE_BACKUP_KEY = "aea-energy-guide-profile-backup-v1";
const DISPLAY_PREFERENCE_KEY = "aea-surge-display-v1";
const DISPLAY_PREFERENCE_TUCKED = "tucked";
const MAX_MESSAGE_LENGTH = 1200;
const MAX_LOCAL_MESSAGES = 40;
const MAX_LOCAL_STORAGE_CHARACTERS = 160_000;
const MAX_RECENT_TURNS = 8;
const MAX_RECENT_CONTEXT_CHARACTERS = 6_000;
const LOCAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const EMPTY_STARTER_PROFILE = EMPTY_SURGE_STARTER_PROFILE;

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
] as const;

const SAFE_CONVERSATION_FACT_LABELS: Readonly<Record<string, string>> = {
  approval: "Approval constraint",
  battery: "Battery",
  bill: "Energy bills",
  budget: "Budget",
  comfort_issue: "Comfort issue",
  constraints: "Practical constraint",
  cooking: "Cooking",
  cooling: "Cooling",
  disruption: "Disruption",
  draughts: "Draughts",
  energy_use: "Energy use",
  electrical_supply: "Electrical supply",
  electric_vehicle: "Electric vehicle",
  floor_area: "Floor area",
  gas_connection: "Gas connection",
  glazing: "Glazing",
  goal: "Current goal",
  heating: "Heating",
  heating_cooling: "Heating and cooling",
  existing_heating: "Existing heating",
  home_type: "Home type",
  hot_water: "Hot water",
  household_size: "Household",
  insulation: "Insulation",
  moisture: "Moisture",
  occupancy: "Occupancy",
  planned_work: "Planned work",
  postcode: "Postcode",
  priority: "Priority",
  relationship: "Relationship",
  rooms: "Rooms",
  solar: "Solar",
  state: "State",
  switchboard: "Switchboard",
  system_replaced: "Existing system",
  tenure: "Relationship",
  timing: "Timing",
};

type ContextRailFact = {
  key: string;
  label: string;
  value: string;
};

function normalizedFactEvidence(value: string) {
  return value.toLocaleLowerCase("en-AU").replace(/[^a-z0-9]+/g, " ").trim();
}

function safeConversationFacts(
  state: SurgeConversationState | null,
  messages: readonly AssistantMessage[],
): ContextRailFact[] {
  if (!state) return [];
  const userEvidence = normalizedFactEvidence(
    messages.filter((message) => message.role === "user").map((message) => message.content).join(" "),
  );
  return state.facts.flatMap((fact) => {
    const label = SAFE_CONVERSATION_FACT_LABELS[fact.key];
    const value = fact.value.trim().slice(0, 160);
    const evidence = normalizedFactEvidence(value);
    if (
      !label
      || !value
      || evidence.length < 2
      || !userEvidence.includes(evidence)
      || /@|(?:\+?61|0)4\d{8}/.test(value.replace(/[\s()-]/g, ""))
    ) return [];
    return [{ key: fact.key, label, value }];
  }).slice(0, 10);
}

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
  destination: "",
  name: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  unitNumber: "",
  streetAddress: "",
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
  shareName: false,
  sharePhone: false,
  shareAddress: false,
  shareKnownPlanFacts: false,
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

function parseQuickReplies(value: unknown): QuickReply[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const label = asString(record.label, 42);
    const message = asString(record.message, 160);
    if (!label || !message) return [];
    return [{
      id: asString(record.id, 60) || `quick-reply-${index + 1}`,
      label,
      message,
    }];
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
    answerType: asString(record.answerType ?? record.answer_type, 40),
    verdict: asString(record.verdict, 360),
    reason: asString(record.reason, 700),
    extraDetail: asString(record.extraDetail ?? record.extra_detail, 1_200),
    quickReplies: parseQuickReplies(record.quickReplies ?? record.quick_replies),
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
  const conversationalPunctuation = value.replace(/\s*[\u2013\u2014]\s*/gu, ", ");
  if (audience === "trade") return conversationalPunctuation;
  const safePlatformNames = conversationalPunctuation.replace(
    /\b(?:TLink|Creditex)(?:\s+or\s+(?:TLink|Creditex))?\b/gi,
    "the trade platform",
  );
  if (
    /\b(?:I|Surge(?: AI)?)\s+(?:am\s+)?(?:run(?:ning)?|built|powered|hosted|provided|based)\s+(?:on|by|with|through)\b/i.test(safePlatformNames)
    || /\b(?:my|the)\s+(?:underlying\s+)?(?:model|provider|platform|implementation)\s+is\b/i.test(safePlatformNames)
  ) {
    return "Surge AI is a specialised Australian home-energy guide. Its implementation details stay private so the answer can stay focused on your home and decision.";
  }
  if (
    /\b(?:private|internal|hidden)\s+(?:source|sources|reference|references|research|training data)\b/i.test(safePlatformNames)
    || /\b(?:I|we|Surge(?: AI)?)\b[^.!?\n]{0,100}\b(?:use|uses|draw|draws|rely|relies|trained|based)\b[^.!?\n]{0,100}\b(?:source|sources|research|reference|references|training data)\b/i.test(safePlatformNames)
  ) {
    return "I keep the background research private and focus on explaining what matters for your home.";
  }
  if (
    /\b(?:I am|I'm|Surge(?: AI)?\s+is)\s+(?:(?:an?|fully)\s+)?(?:NatHERS[- ]?)?(?:accredited|licensed|certified|registered|qualified)\b/i.test(safePlatformNames)
    || /\b(?:this is|I provide|I issue)\b[^.!?\n]{0,80}\b(?:formal assessment|formal rating|certificate decision)\b/i.test(safePlatformNames)
  ) {
    return "Surge AI provides general home-energy guidance, not an accredited rating, certificate or formal assessment.";
  }
  if (
    /\b(?:clear|obvious|definite)\s+winner\b/i.test(safePlatformNames)
    || /\b(?:best|top)\s+(?:brand|model|product|unit|system)\b/i.test(safePlatformNames)
    || /\b(?:buy|choose|pick|go with)\s+(?:the\s+)?[A-Z][\w-]+(?:\s+[A-Z0-9][\w-]+){0,4}\b/.test(safePlatformNames)
  ) {
    return "I can compare the pros, cons and fit of options you provide, but I will not choose or promote a brand or product for you.";
  }
  return safePlatformNames;
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

function makePublicPlanSubmissionId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${date}.${crypto.randomUUID()}`;
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
      intro: "Tell me what you want to improve or understand. I will explain it clearly and ask one useful question at a time. I do not read private account, project or quote records.",
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
      intro: "Tell me what you want to improve or understand. I will explain it clearly and ask one useful question at a time. I do not read customer, job or certificate records.",
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
      intro: "Tell me what you want to improve or understand. I will explain it clearly and ask one useful question at a time. I do not read customer, job or certificate records.",
    };
  }
  if (isSharedUtilityRoute(pathname) && rememberedAudience === "customer") {
    return {
      audience: "customer",
      apiPath: safePublicPath,
      modeLabel: "Customer guide",
      intro: "Tell me what you want to improve or understand. I will explain it clearly and ask one useful question at a time. I do not read private account, project or quote records.",
    };
  }
  return {
    audience: "public",
    apiPath: safePublicPath,
    modeLabel: "Household guide",
    intro: "Hi, I am Surge AI. Tell me what you want to improve or understand. I will explain it clearly and ask one useful question at a time. No contact details needed.",
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
  return parseSurgeStarterProfile(value);
}

function starterProfileContext(profile: SurgeStarterProfile) {
  return surgeStarterProfileContext(profile);
}

function localSessionLastActive(
  messages: readonly AssistantMessage[],
  profile: SurgeStarterProfile,
  profileUpdatedAt = "",
  now = Date.now(),
) {
  const messageActivity = messages.reduce((latest, message) => {
    const timestamp = new Date(message.createdAt || "").getTime();
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, Number.NEGATIVE_INFINITY);
  const profileActivity = new Date(profileUpdatedAt).getTime();
  const latestActivity = Math.max(
    messageActivity,
    Number.isFinite(profileActivity) ? profileActivity : Number.NEGATIVE_INFINITY,
  );
  if (Number.isFinite(latestActivity)) return new Date(latestActivity).toISOString();
  return profile.completed || surgeProfileKnownAnswerCount(profile) > 0
    ? new Date(now).toISOString()
    : "";
}

function recentTurnsForRequest(
  messages: readonly AssistantMessage[],
  profile: SurgeStarterProfile = EMPTY_STARTER_PROFILE,
  profileUpdatedAt = "",
) {
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    const content = message.content.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!content) continue;
    const turn = { role: message.role, content };
    if (turns.at(-1)?.role === turn.role) turns[turns.length - 1] = turn;
    else turns.push(turn);
  }
  if (turns.length > MAX_RECENT_TURNS) {
    turns.splice(0, turns.length - MAX_RECENT_TURNS);
  }
  while (
    turns.length > 0
    && turns.reduce((total, turn) => total + turn.content.length, 0) > MAX_RECENT_CONTEXT_CHARACTERS
  ) turns.shift();
  if (turns[0]?.role === "assistant") turns.shift();

  const profileContext = starterProfileContext(profile);
  if (profileContext) {
    const profileTime = new Date(profileUpdatedAt).getTime();
    const newestMessageTime = messages.reduce((latest, message) => {
      const timestamp = new Date(message.createdAt || "").getTime();
      return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
    }, Number.NEGATIVE_INFINITY);
    const profileIsNewest = Number.isFinite(profileTime) && profileTime > newestMessageTime;
    if (profileIsNewest && turns.at(-1)?.role === "user") {
      const lastIndex = turns.length - 1;
      const availableForPriorTurn = Math.max(0, MAX_MESSAGE_LENGTH - profileContext.length - 1);
      turns[lastIndex] = {
        role: "user",
        content: availableForPriorTurn > 0
          ? `${turns[lastIndex].content.slice(0, availableForPriorTurn)}\n${profileContext}`
          : profileContext,
      };
    } else if (profileIsNewest) {
      if (turns.length >= MAX_RECENT_TURNS) turns.shift();
      turns.push({ role: "user", content: profileContext });
    } else if (turns[0]?.role === "user") {
      const availableForPriorTurn = Math.max(0, MAX_MESSAGE_LENGTH - profileContext.length - 1);
      turns[0] = {
        role: "user",
        content: availableForPriorTurn > 0
          ? `${profileContext}\n${turns[0].content.slice(-availableForPriorTurn)}`
          : profileContext,
      };
    } else {
      if (turns.length >= MAX_RECENT_TURNS) turns.shift();
      turns.unshift({ role: "user", content: profileContext });
    }
  }
  while (
    turns.length > MAX_RECENT_TURNS
    || turns.reduce((total, turn) => total + turn.content.length, 0) > MAX_RECENT_CONTEXT_CHARACTERS
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
    profileUpdatedAt: expired ? "" : asString(record?.profileUpdatedAt, 80),
    lastActive: expired ? "" : lastActive,
    expired,
  };
}

function liveConversationSnapshot(
  mode: Audience,
  messages: readonly AssistantMessage[],
  continuation: SurgeConversationState | null,
  profile: SurgeStarterProfile,
  profileUpdatedAt: string,
): SavedConversation {
  const boundedMessages = boundedLocalMessages(messages);
  return {
    mode,
    messages: boundedMessages,
    continuation,
    profile,
    profileUpdatedAt,
    lastActive: localSessionLastActive(boundedMessages, profile, profileUpdatedAt),
    expired: false,
  };
}

function savedConversationActivity(session: SavedConversation) {
  const timestamps = [session.lastActive, session.profileUpdatedAt, ...session.messages.map((message) => message.createdAt)]
    .map((value) => new Date(value || "").getTime())
    .filter(Number.isFinite);
  return timestamps.length ? Math.max(...timestamps) : Number.NEGATIVE_INFINITY;
}

function savedContinuityMetrics(session: SavedConversation) {
  return {
    reviewedAnswers: surgeProfileReviewedAnswerCount(session.profile),
    knownAnswers: surgeProfileKnownAnswerCount(session.profile),
    completed: session.profile.completed,
    conversationActivityAt: savedConversationActivity(session),
    profileUpdatedAt: new Date(session.profileUpdatedAt || "").getTime(),
  };
}

function savedConversationIsPreferred(candidate: SavedConversation, current: SavedConversation) {
  return preferSurgeConversation(savedContinuityMetrics(candidate), savedContinuityMetrics(current));
}

function savedProfileIsPreferred(candidate: SavedConversation, current: SavedConversation) {
  return preferSurgeProfile(savedContinuityMetrics(candidate), savedContinuityMetrics(current));
}

function accessBrowserStorage<T>(operation: (storage: Storage) => T, fallback: T): T {
  try {
    return operation(window.localStorage);
  } catch {
    return fallback;
  }
}

function availableSessionStorages() {
  const storages: Storage[] = [];
  try {
    if (window.localStorage) storages.push(window.localStorage);
  } catch {
    // Continue with the per-tab mirror when persistent browser storage is unavailable.
  }
  try {
    if (window.sessionStorage && !storages.includes(window.sessionStorage)) {
      storages.push(window.sessionStorage);
    }
  } catch {
    // Saving is best effort and must not block the guide when storage is unavailable.
  }
  return storages;
}

function readStoredSession() {
  let preferred: { raw: string; session: SavedConversation } | null = null;
  for (const storage of availableSessionStorages()) {
    for (const key of [STORAGE_KEY, PROFILE_BACKUP_KEY]) {
      try {
        const raw = storage.getItem(key);
        if (!raw) continue;
        const session = savedConversation(JSON.parse(raw));
        if (session.expired) continue;
        if (!preferred || savedConversationIsPreferred(session, preferred.session)) {
          preferred = { raw, session };
        }
      } catch {
        recordSurgeProfileStorageHealth("load_failed");
      }
    }
  }
  return preferred?.raw ?? null;
}

function storeSession(value: string) {
  let nextValue = value;
  try {
    const candidateRecord = asRecord(JSON.parse(value));
    const candidate = savedConversation(candidateRecord);
    const storedValue = readStoredSession();
    const stored = storedValue ? savedConversation(JSON.parse(storedValue)) : null;
    if (candidateRecord && stored && savedProfileIsPreferred(stored, candidate)) {
      recordSurgeProfileStorageHealth("merge_recovered");
      nextValue = JSON.stringify({
        ...candidateRecord,
        profile: stored.profile,
        profileUpdatedAt: stored.profileUpdatedAt,
        lastActive: localSessionLastActive(candidate.messages, stored.profile, stored.profileUpdatedAt),
      });
    }
  } catch {
    // Preserve the caller's bounded value if an existing copy cannot be compared.
  }
  for (const storage of availableSessionStorages()) {
    try {
      storage.setItem(STORAGE_KEY, nextValue);
    } catch {
      recordSurgeProfileStorageHealth("save_failed");
    }
    try {
      const next = savedConversation(JSON.parse(nextValue));
      const backupValue = storage.getItem(PROFILE_BACKUP_KEY);
      const backup = backupValue ? savedConversation(JSON.parse(backupValue)) : null;
      if (!backup || backup.expired || !savedProfileIsPreferred(backup, next)) {
        storage.setItem(PROFILE_BACKUP_KEY, nextValue);
      }
    } catch {
      recordSurgeProfileStorageHealth("save_failed");
    }
  }
}

function removeStoredSession() {
  for (const storage of availableSessionStorages()) {
    for (const key of [STORAGE_KEY, PROFILE_BACKUP_KEY]) {
      try {
        storage.removeItem(key);
      } catch {
        // Explicit reset is best effort across every available browser store.
      }
    }
  }
}

function readStoredPlannerAssessment() {
  for (const storage of availableSessionStorages()) {
    try {
      const stored = storage.getItem(HOME_ENERGY_ASSESSMENT_STORAGE_KEY);
      if (stored) return stored;
    } catch {
      recordSurgeProfileStorageHealth("load_failed");
    }
  }
  return null;
}

function storePlannerAssessment(value: string) {
  for (const storage of availableSessionStorages()) {
    try {
      storage.setItem(HOME_ENERGY_ASSESSMENT_STORAGE_KEY, value);
    } catch {
      recordSurgeProfileStorageHealth("save_failed");
    }
  }
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

async function readStoredPlanContext(currentAssessment = "") {
  try {
    const storedAssessment = currentAssessment || readStoredPlannerAssessment();
    if (!storedAssessment) return null;
    const { buildSurgePlanContextFromStoredAssessment } = await import(
      "@/lib/energy-assistant-plan-context"
    );
    return buildSurgePlanContextFromStoredAssessment(storedAssessment);
  } catch {
    return null;
  }
}

export function EnergyAssistantWidget({
  initialDraft = "",
  initialOpen = false,
}: {
  initialDraft?: string;
  initialOpen?: boolean;
} = {}) {
  const pathname = usePathname() || "/";
  const router = useRouter();
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
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const conversationScrollPendingRef = useRef(false);
  const intakeRef = useRef<HTMLFormElement>(null);
  const leadFormRef = useRef<HTMLFormElement>(null);
  const leadFormScrollPendingRef = useRef(false);
  const contextRailRef = useRef<HTMLDetailsElement>(null);
  const profileEditScrollPendingRef = useRef(false);
  const messagesRef = useRef<AssistantMessage[]>([]);
  const continuationRef = useRef<SurgeConversationState | null>(null);
  const profileRef = useRef<SurgeStarterProfile>(EMPTY_STARTER_PROFILE);
  const hydrationStartedRef = useRef(false);
  const profileUpdatedAtRef = useRef("");

  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(initialOpen);
  const [openPathname, setOpenPathname] = useState(initialOpen ? pathname : "");
  const [mascotTucked, setMascotTucked] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [answerReviewState, setAnswerReviewState] = useState<Record<string, "sending" | "sent" | "error">>({});
  const [continuation, setContinuation] = useState<SurgeConversationState | null>(null);
  const [profile, setProfile] = useState<SurgeStarterProfile>(EMPTY_STARTER_PROFILE);
  const [profileStep, setProfileStep] = useState(0);
  const [profileEditing, setProfileEditing] = useState(false);
  const [contextRailOpen, setContextRailOpen] = useState(false);
  const [profileDeferred, setProfileDeferred] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [draft, setDraft] = useState(initialDraft.trim().slice(0, MAX_MESSAGE_LENGTH));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [hasUsefulAnswer, setHasUsefulAnswer] = useState(false);
  const [serviceInterest, setServiceInterest] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadStage, setLeadStage] = useState<LeadStage>("destination");
  const [leadQuestionPage, setLeadQuestionPage] = useState(0);
  const [lead, setLead] = useState<LeadDraft>(EMPTY_LEAD);
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadError, setLeadError] = useState("");
  const [leadStatus, setLeadStatus] = useState("");
  const [leadRequestId, setLeadRequestId] = useState("");
  const [leadSubmissionKey, setLeadSubmissionKey] = useState("");
  const [leadPublicPlanSubmissionId, setLeadPublicPlanSubmissionId] = useState("");
  const [leadStartedAt, setLeadStartedAt] = useState(0);
  const [leadGrantedAt, setLeadGrantedAt] = useState("");
  const [localities, setLocalities] = useState<AddressLocality[]>([]);
  const [localityLookupStatus, setLocalityLookupStatus] = useState<LocalityLookupStatus>("idle");
  const [localityLookupError, setLocalityLookupError] = useState("");
  const effectiveOpen = dedicated || (open && openPathname === pathname && !hidden);
  const needsStarterProfile = context.audience !== "trade"
    && ((messages.length === 0 && !profile.completed && !profileDeferred) || profileEditing);
  const currentProfileStep = SURGE_PROFILE_STEPS[profileStep] || SURGE_PROFILE_STEPS[0];
  const profileKnownAnswerCount = surgeProfileKnownAnswerCount(profile);
  const profileReviewedAnswerCount = surgeProfileReviewedAnswerCount(profile);
  const profileUnreviewedAnswerCount = SURGE_PROFILE_FIELDS.length - profileReviewedAnswerCount;
  const profileUnconfirmedAnswerCount = SURGE_PROFILE_FIELDS.length - profileKnownAnswerCount;
  const unconfirmedProfileFields = SURGE_PROFILE_FIELDS.filter((field) =>
    surgeProfileFieldIsUnknown(profile, field));
  const nextIncompleteProfileStep = nextUnknownSurgeProfileStepIndex(profile, -1);
  const currentUnknownProfileFields = currentProfileStep.fields.filter((field) =>
    surgeProfileFieldIsUnknown(profile, field));
  const plannerProfile = useMemo(() => surgePlannerProfileAdapter(profile), [profile]);
  const contextTips = useMemo(() => homeContextTips(profile), [profile]);
  const conversationFacts = useMemo(
    () => safeConversationFacts(continuation, messages),
    [continuation, messages],
  );
  const leadPlanSnapshot = useMemo(() => {
    try {
      return createHomeEnergyPlannerPublicPlanSnapshot(plannerProfile.draft);
    } catch {
      return null;
    }
  }, [plannerProfile.draft]);
  const quoteQuestions = useMemo(
    () => publicPlanQuoteQuestionsForSnapshot(lead.services, leadPlanSnapshot),
    [lead.services, leadPlanSnapshot],
  );
  const currentQuoteQuestions = quoteQuestions.slice(leadQuestionPage * 3, leadQuestionPage * 3 + 3);
  const answeredQuoteQuestionCount = quoteQuestions.filter((question) => lead.quoteAnswers[question.id]).length;
  const optionalHelpAvailable = profile.completed || (hasUsefulAnswer && serviceInterest);

  const persistLocalSession = useCallback(({
    nextMessages = messagesRef.current,
    nextContinuation = continuationRef.current,
    nextProfile = profileRef.current,
    nextProfileUpdatedAt = profileUpdatedAtRef.current,
  }: PersistedSessionOverrides = {}) => {
    const boundedMessages = boundedLocalMessages(nextMessages);
    storeSession(JSON.stringify({
      mode: context.audience,
      messages: boundedMessages,
      continuation: nextContinuation,
      profile: nextProfile,
      profileUpdatedAt: nextProfileUpdatedAt,
      lastActive: localSessionLastActive(boundedMessages, nextProfile, nextProfileUpdatedAt),
    }));
  }, [context.audience]);

  const applySavedSession = useCallback((saved: SavedConversation) => {
    messagesRef.current = saved.messages;
    continuationRef.current = saved.continuation;
    profileRef.current = saved.profile;
    profileUpdatedAtRef.current = saved.profileUpdatedAt;
    setMessages(saved.messages);
    setContinuation(saved.continuation);
    setProfile(saved.profile);
    setHasUsefulAnswer(saved.messages.some((message) => message.role === "assistant"));
    setServiceInterest(saved.messages.some((message) =>
      message.role === "user" && signalsServiceInterest(message.content)));
    if (saved.profile.completed) {
      setProfileEditing(false);
      setProfileDeferred(false);
      setProfileStep(0);
    }
  }, []);

  const resetLeadAttempt = () => {
    setLeadRequestId("");
    setLeadSubmissionKey("");
    setLeadPublicPlanSubmissionId("");
    setLeadGrantedAt("");
    setLeadError("");
    setLeadStatus("");
  };

  const updateLead = (updater: (current: LeadDraft) => LeadDraft) => {
    setLead(updater);
    resetLeadAttempt();
  };

  const openLeadForm = () => {
    setLead((current) => ({
      ...current,
      postcode: current.postcode || profile.postcode,
    }));
    setLeadStage("destination");
    setLeadStartedAt(Date.now());
    leadFormScrollPendingRef.current = true;
    setLeadOpen(true);
  };

  const chooseLeadDestination = (destination: LeadDraft["destination"]) => {
    updateLead((current) => ({
      ...current,
      destination,
      serviceConsent: false,
      shareName: false,
      sharePhone: false,
      shareAddress: false,
      shareKnownPlanFacts: false,
      marketingConsent: false,
    }));
    setLeadStage("scope");
  };

  const replaceMessages = (nextMessages: AssistantMessage[]) => {
    const boundedMessages = boundedLocalMessages(nextMessages);
    messagesRef.current = boundedMessages;
    setMessages(boundedMessages);
    persistLocalSession({ nextMessages: boundedMessages });
  };

  const clearLocalSession = useCallback(({
    nextMessages = [],
    nextStatus = "",
    keepProfile = false,
  }: {
    nextMessages?: AssistantMessage[];
    nextStatus?: string;
    keepProfile?: boolean;
  } = {}) => {
    messagesRef.current = nextMessages;
    continuationRef.current = null;
    setMessages(nextMessages);
    setContinuation(null);
    if (keepProfile) {
      persistLocalSession({ nextMessages, nextContinuation: null });
    } else {
      removeStoredSession();
      profileRef.current = EMPTY_STARTER_PROFILE;
      profileUpdatedAtRef.current = "";
      setProfile(EMPTY_STARTER_PROFILE);
      setProfileStep(0);
      setProfileEditing(false);
      setProfileDeferred(false);
      setProfileError("");
    }
    setHasUsefulAnswer(false);
    setServiceInterest(false);
    setLeadOpen(false);
    setLeadStage("destination");
    setLeadQuestionPage(0);
    setLead(EMPTY_LEAD);
    setLeadError("");
    setLeadStatus("");
    setLeadRequestId("");
    setLeadSubmissionKey("");
    setLeadPublicPlanSubmissionId("");
    setLeadStartedAt(0);
    setLeadGrantedAt("");
    setLocalities([]);
    setLocalityLookupStatus("idle");
    setLocalityLookupError("");
    setError("");
    setStatus(nextStatus);
    setBusy(false);
    setLeadBusy(false);
  }, [persistLocalSession]);

  useEffect(() => {
    if (hydrationStartedRef.current) return;
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      hydrationStartedRef.current = true;
      setMascotTucked(readStoredMascotTucked());
      let restoredProfile = EMPTY_STARTER_PROFILE;
      let restoredSession: SavedConversation | null = null;
      const stored = readStoredSession();
      if (stored) {
        try {
          const saved = savedConversation(JSON.parse(stored));
          if (saved.expired) {
            removeStoredSession();
            setStatus("Your locally saved conversation expired after 30 days of inactivity.");
          } else {
            restoredSession = saved;
            restoredProfile = saved.profile;
            applySavedSession(saved);
            setMode(explicitRouteAudience(pathname) || saved.mode);
          }
        } catch {
          removeStoredSession();
        }
      }
      let mergedProfile = restoredProfile;
      try {
        const storedAssessment = readStoredPlannerAssessment();
        mergedProfile = mergeHomeEnergyPlannerSessionIntoSurgeProfile(restoredProfile, storedAssessment);
      } catch {
        // Session planner data is supplementary; it must never erase a valid local Surge profile.
      }
      const mergedProfileUpdatedAt = mergedProfile !== restoredProfile
        ? new Date().toISOString()
        : profileUpdatedAtRef.current;
      profileRef.current = mergedProfile;
      profileUpdatedAtRef.current = mergedProfileUpdatedAt;
      setProfile(mergedProfile);
      if (restoredSession || mergedProfile !== restoredProfile) {
        persistLocalSession({ nextProfile: mergedProfile, nextProfileUpdatedAt: mergedProfileUpdatedAt });
      }
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, [applySavedSession, pathname, persistLocalSession]);

  useEffect(() => {
    const syncDisplayPreference = (event: StorageEvent) => {
      if (event.key !== DISPLAY_PREFERENCE_KEY) return;
      setMascotTucked(event.newValue === DISPLAY_PREFERENCE_TUCKED);
    };
    window.addEventListener("storage", syncDisplayPreference);
    return () => window.removeEventListener("storage", syncDisplayPreference);
  }, []);

  useEffect(() => {
    const syncStoredConversation = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== PROFILE_BACKUP_KEY) return;
      if (!event.newValue) {
        if (event.key === STORAGE_KEY) clearLocalSession();
        return;
      }
      try {
        const saved = savedConversation(JSON.parse(event.newValue));
        if (saved.expired) return;
        const current = liveConversationSnapshot(
          context.audience,
          messagesRef.current,
          continuationRef.current,
          profileRef.current,
          profileUpdatedAtRef.current,
        );
        if (!savedConversationIsPreferred(saved, current)) return;
        applySavedSession(saved);
      } catch {
        // Ignore malformed writes from another tab; the current valid session remains authoritative.
      }
    };
    window.addEventListener("storage", syncStoredConversation);
    return () => window.removeEventListener("storage", syncStoredConversation);
  }, [applySavedSession, clearLocalSession, context.audience]);

  useEffect(() => {
    if (!dedicated || initialDraft.trim()) return;
    const frame = window.requestAnimationFrame(() => {
      const pendingDraft = takePendingSurgeDraft();
      if (pendingDraft) setDraft(pendingDraft);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dedicated, initialDraft]);

  useEffect(() => {
    if (!dedicated) return;
    const desktop = window.matchMedia("(min-width: 641px)");
    const syncContextRail = () => {
      setContextRailOpen(desktop.matches);
    };
    syncContextRail();
    desktop.addEventListener("change", syncContextRail);
    return () => desktop.removeEventListener("change", syncContextRail);
  }, [dedicated]);

  useEffect(() => {
    if (!hydrated) return;
    const currentSession = () => liveConversationSnapshot(
      context.audience,
      messagesRef.current,
      continuationRef.current,
      profileRef.current,
      profileUpdatedAtRef.current,
    );
    const storedSession = () => {
      const storedValue = readStoredSession();
      if (!storedValue) return null;
      try {
        const saved = savedConversation(JSON.parse(storedValue));
        return saved.expired ? null : saved;
      } catch {
        return null;
      }
    };
    const reconcileStoredSession = () => {
      const saved = storedSession();
      if (saved && savedConversationIsPreferred(saved, currentSession())) applySavedSession(saved);
    };
    const flushLocalSession = () => {
      const saved = storedSession();
      if (saved && savedConversationIsPreferred(saved, currentSession())) return;
      persistLocalSession();
    };
    const syncVisibility = () => {
      if (window.document.visibilityState === "hidden") flushLocalSession();
      else reconcileStoredSession();
    };
    window.addEventListener("pagehide", flushLocalSession);
    window.addEventListener("pageshow", reconcileStoredSession);
    window.addEventListener("focus", reconcileStoredSession);
    window.document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      window.removeEventListener("pagehide", flushLocalSession);
      window.removeEventListener("pageshow", reconcileStoredSession);
      window.removeEventListener("focus", reconcileStoredSession);
      window.document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [applySavedSession, context.audience, hydrated, persistLocalSession]);

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
    if (dedicated && window.matchMedia("(max-width: 640px)").matches) {
      if (!conversationScrollPendingRef.current) return;
      conversationScrollPendingRef.current = false;
      conversationEndRef.current?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
      return;
    }
    container.scrollTo({
      top: hasConversation ? container.scrollHeight : 0,
      behavior: hasConversation ? "smooth" : "auto",
    });
    conversationScrollPendingRef.current = false;
  }, [dedicated, effectiveOpen, messages]);

  useEffect(() => {
    if (!leadOpen || !leadFormScrollPendingRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const form = leadFormRef.current;
      const container = conversationRef.current;
      if (!form || !container) return;
      leadFormScrollPendingRef.current = false;
      const containerTop = container.getBoundingClientRect().top;
      const formTop = form.getBoundingClientRect().top;
      container.scrollTo({
        top: Math.max(0, container.scrollTop + formTop - containerTop - 16),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
      form.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [leadOpen]);

  useEffect(() => {
    if (!profileEditing || !profileEditScrollPendingRef.current) return;
    profileEditScrollPendingRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      const intake = intakeRef.current;
      if (!intake) return;
      intake.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
      intake.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [profileEditing, profileStep]);

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
    if (leadOpen) {
      setLeadOpen(false);
      setLeadError("");
      setLeadStatus("");
    }
    const recentTurns = recentTurnsForRequest(
      messagesRef.current,
      profileRef.current,
      profileUpdatedAtRef.current,
    );
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
    conversationScrollPendingRef.current = true;
    replaceMessages([...messagesRef.current, userMessage]);
    if (signalsServiceInterest(message)) setServiceInterest(true);
    setDraft("");
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const planContext = context.audience === "trade"
        ? null
        : await readStoredPlanContext(JSON.stringify(plannerProfile.session));
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
      conversationScrollPendingRef.current = true;
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

  const submitAnswerReview = async (message: AssistantMessage, messageIndex: number) => {
    const question = [...messages.slice(0, messageIndex)]
      .reverse()
      .find((item) => item.role === "user")?.content || "";
    if (!question || answerReviewState[message.id] === "sending" || answerReviewState[message.id] === "sent") return;
    setAnswerReviewState((current) => ({ ...current, [message.id]: "sending" }));
    try {
      const response = await fetch("/api/energy-assistant/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answerId: message.id,
          question,
          answer: message.content || message.directAnswer,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || asRecord(payload)?.ok !== true) {
        throw new Error(parseApiError(payload, "The answer could not be sent for review."));
      }
      setAnswerReviewState((current) => ({ ...current, [message.id]: "sent" }));
    } catch {
      setAnswerReviewState((current) => ({ ...current, [message.id]: "error" }));
    }
  };

  const addDocumentMessages = (nextMessages: DocumentConversationMessage[], accepted: boolean) => {
    conversationScrollPendingRef.current = true;
    replaceMessages([...messagesRef.current, ...nextMessages]);
    if (accepted) setHasUsefulAnswer(true);
  };

  const updateStarterProfile = (field: SurgeProfileField, value: string, checked = true) => {
    const updatedProfile = updateSurgeProfileField(profileRef.current, field, value, checked);
    const nextProfile: SurgeStarterProfile = {
      ...updatedProfile,
      completed: surgeProfileKnownAnswerCount(updatedProfile) === SURGE_PROFILE_FIELDS.length,
    };
    const nextProfileUpdatedAt = new Date().toISOString();
    profileRef.current = nextProfile;
    profileUpdatedAtRef.current = nextProfileUpdatedAt;
    setProfile(nextProfile);
    persistLocalSession({ nextProfile, nextProfileUpdatedAt });
    setProfileError("");
  };

  const editStarterProfileStep = (stepIndex: number) => {
    profileEditScrollPendingRef.current = true;
    setProfileStep(stepIndex);
    setProfileEditing(true);
    setProfileError("");
  };

  const continueStarterProfile = () => {
    const nextStep = nextUnknownSurgeProfileStepIndex(profileRef.current, -1);
    if (nextStep >= 0) editStarterProfileStep(nextStep);
  };

  const completeStarterProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reviewedProfile = markSurgeProfileStepReviewed(profileRef.current, currentProfileStep);
    const nextProfileUpdatedAt = new Date().toISOString();
    const nextUnknownStep = nextUnknownSurgeProfileStepIndex(reviewedProfile, profileStep);
    const nextProfile: SurgeStarterProfile = {
      ...reviewedProfile,
      version: SURGE_PROFILE_VERSION,
      completed: nextUnknownStep < 0,
    };
    profileRef.current = nextProfile;
    profileUpdatedAtRef.current = nextProfileUpdatedAt;
    setProfile(nextProfile);
    persistLocalSession({ nextProfile, nextProfileUpdatedAt });
    if (nextUnknownStep >= 0) {
      const unknownFields = SURGE_PROFILE_STEPS[nextUnknownStep].fields.filter((field) =>
        surgeProfileFieldIsUnknown(nextProfile, field));
      setProfileStep(nextUnknownStep);
      profileEditScrollPendingRef.current = true;
      setProfileError(nextUnknownStep === profileStep
        ? `To reach 45 of 45 confirmed details, choose a confirmed answer for ${unknownFields.map((field) => field.label).join(", ")}.`
        : "");
      return;
    }
    setProfileEditing(false);
    setProfileDeferred(false);
    setProfileStep(0);
    persistLocalSession({ nextProfile, nextProfileUpdatedAt });
    setStatus("");
    setProfileError("");
  };

  const handOffConversationScroll = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!dedicated || event.deltaY === 0) return;
    const scroller = event.currentTarget;
    const atTop = scroller.scrollTop <= 1;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    if ((event.deltaY < 0 && !atTop) || (event.deltaY > 0 && !atBottom)) return;
    const pageScrollBefore = window.scrollY;
    const deltaY = event.deltaY;
    window.requestAnimationFrame(() => {
      if (Math.abs(window.scrollY - pageScrollBefore) < 1) {
        window.scrollBy({ top: deltaY, left: 0, behavior: "auto" });
      }
    });
  };

  const openHomeEnergyPlanner = () => {
    storePlannerAssessment(JSON.stringify(plannerProfile.session));
    router.push("/plan");
  };

  const resetConversation = () => {
    if (busy || leadBusy) return;
    setAnswerReviewState({});
    clearLocalSession({
      nextStatus: "Chat cleared. Home details kept",
      keepProfile: true,
    });
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
    if (!lead.destination) {
      setLeadError("Choose one optional help path before continuing.");
      setLeadStage("destination");
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
    setLeadError("");
    setLeadStage(lead.destination === "matched-trades" && quoteQuestions.length ? "questions" : "contact");
  };

  const answerCurrentQuoteQuestionsAsUnknown = () => {
    updateLead((current) => {
      const quoteAnswers = { ...current.quoteAnswers };
      for (const question of currentQuoteQuestions) {
        if (quoteAnswers[question.id]) continue;
        const unknownAnswer = question.options.find((option) => /not sure|need advice/i.test(option));
        if (unknownAnswer) quoteAnswers[question.id] = unknownAnswer;
      }
      return { ...current, quoteAnswers };
    });
  };

  const advanceLeadQuestions = (skip: boolean) => {
    if (skip) answerCurrentQuoteQuestionsAsUnknown();
    setLeadError("");
    if ((leadQuestionPage + 1) * 3 < quoteQuestions.length) {
      setLeadQuestionPage((current) => current + 1);
      return;
    }
    setLeadStage("contact");
  };

  const advanceLeadContact = () => {
    if (lead.destination === "matched-trades") {
      if (!lead.firstName.trim() || !lead.lastName.trim()) {
        setLeadError("Add your first and last name for the private plan record.");
        return;
      }
      if (!lead.email.trim() || !lead.phone.trim() || !lead.streetAddress.trim()) {
        setLeadError("Add an email, phone and street address for the private plan record.");
        return;
      }
    } else {
      if (!lead.name.trim()) {
        setLeadError("Add your name so Australian Energy Assessments knows who requested help.");
        return;
      }
      if (!lead.email.trim() && !lead.phone.trim()) {
        setLeadError("Add an email address or phone number so Australian Energy Assessments can respond.");
        return;
      }
    }
    setLeadError("");
    setLeadStage("preferences");
  };

  const submitLead = async (event: FormEvent) => {
    event.preventDefault();
    if (leadBusy || leadStatus || !lead.serviceConsent) return;
    if (!lead.destination) {
      setLeadError("Choose Australian Energy Assessments follow-up or matched trades.");
      setLeadStage("destination");
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
    if (lead.destination === "matched-trades") {
      if (!lead.firstName.trim() || !lead.lastName.trim() || !lead.email.trim() || !lead.phone.trim() || !lead.streetAddress.trim()) {
        setLeadError("Complete the private plan contact and property address fields.");
        setLeadStage("contact");
        return;
      }
      if (!leadPlanSnapshot) {
        setLeadError("Record at least one home-energy priority before requesting trade matching. Your private plan and chat remain available.");
        return;
      }
    } else if (!lead.name.trim() || (!lead.email.trim() && !lead.phone.trim())) {
      setLeadError("Add your name and an email address or phone number for Australian Energy Assessments follow-up.");
      setLeadStage("contact");
      return;
    }
    setLeadBusy(true);
    setLeadError("");
    setLeadStatus("");
    try {
      const requestId = leadRequestId || makeRequestId("lead");
      const submissionKey = leadSubmissionKey || createEnergyAssistantSubmissionKey();
      const publicPlanSubmissionId = leadPublicPlanSubmissionId || makePublicPlanSubmissionId();
      const grantedAt = leadGrantedAt || new Date().toISOString();
      setLeadRequestId(requestId);
      setLeadSubmissionKey(submissionKey);
      setLeadPublicPlanSubmissionId(publicPlanSubmissionId);
      setLeadGrantedAt(grantedAt);
      const { buildEnergyAssistantEnquirySubmission } = await import(
        "@/lib/energy-assistant-enquiry-adapter.mjs"
      );
      const submission = buildEnergyAssistantEnquirySubmission(
        lead.destination === "matched-trades"
          ? {
              destination: "matched-trades",
              tradeEnquiry: {
                submissionId: publicPlanSubmissionId,
                clientStartedAt: leadStartedAt || Date.now(),
                consentAccepted: true,
                consentGrantedAt: grantedAt,
                customerFirstName: lead.firstName,
                customerLastName: lead.lastName,
                email: lead.email,
                phone: lead.phone,
                customerUnitNumber: lead.unitNumber,
                customerStreetAddress: lead.streetAddress,
                customerSuburb: lead.suburb,
                customerState: lead.state,
                postcode: lead.postcode,
                services: lead.services,
                customerMessage: lead.message,
                shareContact: {
                  name: lead.shareName,
                  phone: lead.sharePhone,
                  address: lead.shareAddress,
                },
                quoteAnswers: quoteQuestions.flatMap((question) => {
                  const answer = lead.quoteAnswers[question.id];
                  return answer ? [{ questionId: question.id, answer }] : [];
                }),
                shareKnownPlanFacts: lead.shareKnownPlanFacts,
                planSnapshot: leadPlanSnapshot,
              },
            }
          : {
              destination: "aea-follow-up",
              assistantPayload: buildEnergyAssistantLeadPayload({
                lead,
                requestId,
                submissionKey,
                grantedAt,
              }),
            },
      );
      const response = await fetch(submission.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission.payload),
      });
      const payload: unknown = await response.json().catch(() => null);
      const record = asRecord(payload);
      if (!response.ok || record?.ok !== true) {
        throw new Error(parseApiError(payload, "Australian Energy Assessments could not receive your request."));
      }
      setLeadStatus(
        lead.destination === "matched-trades"
          ? "Your matched-trade enquiry was sent. Your private home plan is being prepared for your email; trades receive only the structured details you chose to share."
          : "Your request has been sent to Australian Energy Assessments only.",
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
          {dedicated && (
            <details
              ref={contextRailRef}
              data-testid="surge-context-rail"
              className={styles.contextRail}
              aria-label="Your home context"
              open={contextRailOpen}
              onToggle={(event) => {
                const desktop = window.matchMedia("(min-width: 641px)").matches;
                if (desktop && !event.currentTarget.open) {
                  event.currentTarget.open = true;
                }
                setContextRailOpen(desktop || event.currentTarget.open);
              }}
            >
              <summary className={styles.contextRailSummary}>
                <Image src="/surge-mascot.webp" alt="" width={54} height={68} />
                <span className={styles.contextRailTitle}>
                  <span>Surge AI knows</span>
                  <strong>Your home context</strong>
                  <small>{profileKnownAnswerCount} of {SURGE_PROFILE_FIELDS.length} details confirmed</small>
                </span>
                <span className={styles.contextRailToggle} aria-hidden="true">⌄</span>
              </summary>
              <div data-testid="surge-context-scroll" className={styles.contextRailBody}>
              <div className={styles.contextProgress}>
                <div>
                  <strong>{profileKnownAnswerCount}</strong>
                  <span>of {SURGE_PROFILE_FIELDS.length} details confirmed</span>
                </div>
                <progress max={SURGE_PROFILE_FIELDS.length} value={profileKnownAnswerCount} aria-label={`${profileKnownAnswerCount} of ${SURGE_PROFILE_FIELDS.length} home details confirmed`} />
                <p>{profileUnreviewedAnswerCount > 0
                  ? `${profileReviewedAnswerCount} responses saved · ${profileUnreviewedAnswerCount} unanswered`
                  : profileUnconfirmedAnswerCount > 0
                    ? `${profileReviewedAnswerCount} responses saved · ${profileUnconfirmedAnswerCount} not sure or skipped`
                    : `${profileReviewedAnswerCount} responses saved · all details confirmed`}</p>
                {unconfirmedProfileFields.length > 0 && (
                  <p className={styles.contextProgressMissing}>
                    Next to confirm: {unconfirmedProfileFields[0].shortLabel}
                    {unconfirmedProfileFields.length > 1 ? `, plus ${unconfirmedProfileFields.length - 1} more` : ""}
                  </p>
                )}
                {nextIncompleteProfileStep >= 0 && (
                  <button data-testid="surge-context-continue" className={styles.contextContinue} type="button" onClick={continueStarterProfile}>
                    {profileUnreviewedAnswerCount > 0
                      ? "Continue setup"
                      : `Review ${profileUnconfirmedAnswerCount} not sure ${profileUnconfirmedAnswerCount === 1 ? "answer" : "answers"}`}
                  </button>
                )}
              </div>
              <section className={styles.plannerProgress} aria-labelledby="surge-planner-progress-title">
                <div>
                  <span>Home Energy Planner</span>
                  <strong id="surge-planner-progress-title">{plannerProfile.completion.completed} of {plannerProfile.completion.total} stages ready</strong>
                </div>
                <progress
                  max={100}
                  value={plannerProfile.completion.percentage}
                  aria-label={`${plannerProfile.completion.percentage}% of the Home Energy Planner ready`}
                />
                <button type="button" onClick={openHomeEnergyPlanner}>Open my energy plan</button>
                <small>Only the confirmed answers shown here are copied into your private plan.</small>
              </section>
              <div className={styles.contextGroups}>
                {SURGE_PROFILE_STEPS.map((step, stepIndex) => {
                  const knownFields = step.fields.filter((field) => !surgeProfileFieldIsUnknown(profile, field));
                  const reviewedFields = step.fields.filter((field) => surgeProfileFieldWasReviewed(profile, field));
                  const unknownFields = step.fields.filter((field) => surgeProfileFieldIsUnknown(profile, field));
                  return (
                    <section key={step.id}>
                      <header>
                        <h3>{step.title}</h3>
                        <button
                          type="button"
                          onClick={() => editStarterProfileStep(stepIndex)}
                        >
                          Edit
                        </button>
                      </header>
                      {knownFields.length ? (
                        <>
                          <p className={styles.contextMobileSummary}>{knownFields.length} {knownFields.length === 1 ? "detail" : "details"} recorded</p>
                          <dl>
                            {knownFields.map((field) => (
                              <div key={field.id}>
                                <dt>{field.shortLabel}</dt>
                                <dd>{surgeProfileAnswerLabel(profile, field)}</dd>
                              </div>
                            ))}
                          </dl>
                        </>
                      ) : <p>{reviewedFields.length === step.fields.length ? "Not sure or skipped" : "Not answered yet"}</p>}
                      {unknownFields.length > 0 && (
                        <p className={styles.contextMissing}>
                          Needs confirmation: {unknownFields.map((field) => field.shortLabel).join(", ")}
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
              {conversationFacts.length > 0 && (
                <section className={styles.conversationFacts} aria-labelledby="surge-conversation-facts">
                  <h3 id="surge-conversation-facts">Learned in this chat</h3>
                  <ul>
                    {conversationFacts.map((fact) => (
                      <li key={fact.key}>
                        <div><span>{fact.label}</span><strong>{customerVisibleText(fact.value, context.audience)}</strong></div>
                        <button
                          type="button"
                          aria-label={`Correct ${fact.label}`}
                          onClick={() => {
                            setDraft(`Correction: ${fact.label} is `);
                            window.requestAnimationFrame(() => composerRef.current?.focus());
                          }}
                        >
                          Correct
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              </div>
            </details>
          )}

          <div className={styles.workspace}>
          <header className={styles.header}>
            <div>
              <span className={styles.mode}>{dedicated ? "Your future-focused Australian home-energy guide" : "All things energy upgrades"}</span>
              <h2 id="aea-energy-guide-title">Ask Surge AI</h2>
            </div>
            {!dedicated && <button type="button" aria-label="Close Surge AI" onClick={close}>
              <span aria-hidden="true">×</span>
            </button>}
          </header>

          <div ref={conversationRef} data-testid="surge-conversation-scroll" className={styles.conversation} tabIndex={-1} onWheel={handOffConversationScroll}>
            {needsStarterProfile && (
              <form ref={intakeRef} data-testid="surge-context-intake" className={styles.intake} onSubmit={completeStarterProfile} tabIndex={-1}>
                <header>
                  <span>Build your home context · Step {profileStep + 1} of {SURGE_PROFILE_STEPS.length}</span>
                  <progress max={SURGE_PROFILE_STEPS.length} value={profileStep + 1} aria-label={`Step ${profileStep + 1} of ${SURGE_PROFILE_STEPS.length}`} />
                  <h3>{currentProfileStep.title}</h3>
                  <p>{currentProfileStep.description}</p>
                  <p>Choose the closest safe answer. Not sure is always valid, and no name, email or phone number is collected here.</p>
                </header>
                <div className={styles.intakeGrid}>
                  {currentProfileStep.fields.map((field) => {
                    const fieldValue = surgeProfileFieldValue(profile, field);
                    if (field.kind === "postcode") {
                      return (
                        <label key={field.id}>
                          <span>{field.label}</span>
                          <input
                            pattern="[0-9]{4}"
                            inputMode="numeric"
                            autoComplete="postal-code"
                            maxLength={4}
                            placeholder="For example 3000"
                            value={profile.postcode}
                            onChange={(event) => updateStarterProfile(field, event.target.value)}
                          />
                          <small>{field.hint || "Leave blank to skip for now."}</small>
                        </label>
                      );
                    }
                    if (field.kind === "multiselect") {
                      const selectedValues = Array.isArray(fieldValue) ? fieldValue : [];
                      return (
                        <fieldset className={styles.intakeMulti} key={field.id}>
                          <legend>{field.label}</legend>
                          {field.hint && <small>{field.hint}</small>}
                          <div>
                            {field.options?.map((option) => (
                              <label key={option.value}>
                                <input
                                  type="checkbox"
                                  checked={selectedValues.includes(option.value)}
                                  onChange={(event) => updateStarterProfile(field, option.value, event.target.checked)}
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      );
                    }
                    return (
                      <label key={field.id}>
                        <span>{field.label}</span>
                        <select
                          value={typeof fieldValue === "string" ? fieldValue : ""}
                          onChange={(event) => updateStarterProfile(field, event.target.value)}
                        >
                          {!field.options?.some((option) => option.value === "") && <option value="">Not sure or skip</option>}
                          {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        {field.hint && <small>{field.hint}</small>}
                      </label>
                    );
                  })}
                </div>
                {currentUnknownProfileFields.length > 0 && (
                  <p className={styles.intakeMissing}>
                    Still missing or marked not sure: {currentUnknownProfileFields.map((field) => field.label).join(", ")}.
                  </p>
                )}
                {profileError && <p className={styles.error} role="alert">{profileError}</p>}
                <div className={styles.intakeNav}>
                  {profileStep > 0 && <button type="button" onClick={() => { setProfileStep((current) => current - 1); setProfileError(""); }}>Back</button>}
                  {!profileEditing && (
                    <button
                      className={styles.intakeSkip}
                      type="button"
                      onClick={() => {
                        setProfileDeferred(true);
                        setProfileError("");
                        window.requestAnimationFrame(() => composerRef.current?.focus());
                      }}
                    >
                      Ask a question now
                    </button>
                  )}
                  <button className={styles.intakeContinue} type="submit">
                    {profileKnownAnswerCount === SURGE_PROFILE_FIELDS.length
                      ? "Finish home context"
                      : profileStep === SURGE_PROFILE_STEPS.length - 1
                        ? "Review next missing answer"
                        : "Save and continue"}
                  </button>
                </div>
                <small>These answers stay in this browser with the conversation. Use the context rail to update any answer later.</small>
              </form>
            )}

            {messages.length === 0 && !needsStarterProfile && (
              <section className={styles.welcome} aria-labelledby="aea-start-heading">
                <span>Start here</span>
                <h3 id="aea-start-heading">What would you like help with?</h3>
                <p id="aea-energy-guide-description">{context.intro}</p>
                {context.audience !== "trade" && profile.completed && !dedicated && (
                  <div className={styles.profileSummary}>
                    <span>Using your postcode and home starting point</span>
                    <button type="button" onClick={() => editStarterProfileStep(0)}>
                      Change details
                    </button>
                  </div>
                )}
              </section>
            )}

            {messages.length === 0 && !needsStarterProfile && (
              <details className={styles.starterDrawer}>
                <summary>
                  <span>Suggested questions</span>
                  <small>{START_ROADMAP.reduce((total, group) => total + group.questions.length, 0)} options</small>
                </summary>
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
              </details>
            )}

            {dedicated && (
              <details className={styles.mobileGuidance}>
                <summary>Home tips and optional help</summary>
                <div>
                  <span>Based on your saved context</span>
                  <ul>
                    {contextTips.map((tip) => (
                      <li key={tip.title}><strong>{tip.title}</strong><p>{tip.detail}</p></li>
                    ))}
                  </ul>
                  {optionalHelpAvailable && !leadOpen && (
                    <button type="button" onClick={openLeadForm}>See optional help paths</button>
                  )}
                  {leadOpen && <p>The optional help form is open below. Your chat and private plan remain unchanged.</p>}
                </div>
              </details>
            )}

            {leadOpen && (
              <form ref={leadFormRef} className={styles.leadForm} tabIndex={-1} onSubmit={(event) => void submitLead(event)}>
                <header>
                  <div>
                    <span>Optional service request</span>
                    <h3>Ask Australian Energy Assessments to help</h3>
                  </div>
                  <button type="button" aria-label="Close service request" onClick={() => setLeadOpen(false)}>×</button>
                </header>
                <p>Choose one destination. Nothing is shared by default, and you can close this form without affecting your chat or private plan.</p>
                <button className={styles.leadReturn} type="button" onClick={() => {
                  setLeadOpen(false);
                  window.requestAnimationFrame(() => composerRef.current?.focus());
                }}>
                  <span aria-hidden="true">←</span> Back to Surge AI
                </button>
                {leadStage === "destination" && (
                  <section className={styles.leadStep} aria-labelledby="aea-lead-destination">
                    <h4 id="aea-lead-destination">Choose one optional follow-up</h4>
                    <div className={styles.destinationChoices}>
                      <button type="button" onClick={() => chooseLeadDestination("aea-follow-up")}>
                        <strong>Australian Energy Assessments only</strong>
                        <span>Send a lighter service request to the Australian Energy Assessments team. Nothing goes to matched trades.</span>
                      </button>
                      <button type="button" onClick={() => chooseLeadDestination("matched-trades")}>
                        <strong>Matched trades + my private plan by email</strong>
                        <span>Route one structured enquiry to suitable approved trades and email your private plan copy to you.</span>
                      </button>
                    </div>
                    <p>{ENERGY_ASSISTANT_MATCHING_EXPLANATION}</p>
                  </section>
                )}

                {leadStage !== "destination" && leadStage !== "scope" && (
                  <section className={styles.leadSummary} aria-label="Quote brief summary">
                    <strong>Brief so far</strong>
                    <p>{lead.suburb}, {lead.state} {lead.postcode}. {lead.services.length} service{lead.services.length === 1 ? "" : "s"}. {answeredQuoteQuestionCount} of {quoteQuestions.length} service details recorded.</p>
                    <div>
                      <button className={styles.leadSecondary} type="button" onClick={() => setLeadStage("scope")}>Edit location or services</button>
                      {lead.destination === "matched-trades" && quoteQuestions.length > 0 && <button className={styles.leadSecondary} type="button" onClick={() => { setLeadQuestionPage(0); setLeadStage("questions"); }}>Edit service details</button>}
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
                    <div className={styles.leadNav}><button className={styles.leadSecondary} type="button" onClick={() => setLeadStage("destination")}>Back</button><button className={styles.leadPrimary} type="button" onClick={advanceLeadScope}>Continue</button></div>
                  </section>
                )}

                {leadStage === "questions" && (
                  <section className={styles.leadStep} aria-labelledby="aea-lead-questions">
                    <h4 id="aea-lead-questions">Optional quote details</h4>
                    <p>Showing {leadQuestionPage * 3 + 1} to {Math.min((leadQuestionPage + 1) * 3, quoteQuestions.length)} of {quoteQuestions.length}. Skip anything you do not know; your private plan remains available either way.</p>
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
                      <button className={styles.leadSecondary} type="button" onClick={() => leadQuestionPage ? setLeadQuestionPage((current) => current - 1) : setLeadStage("scope")}>Back</button>
                      <button className={styles.leadTertiary} type="button" onClick={() => advanceLeadQuestions(true)}>Not sure / skip these</button>
                      <button className={styles.leadPrimary} type="button" onClick={() => advanceLeadQuestions(false)}>Save and continue</button>
                    </div>
                  </section>
                )}

                {leadStage === "contact" && (
                  <section className={styles.leadStep} aria-labelledby="aea-lead-contact">
                    <h4 id="aea-lead-contact">Contact details</h4>
                    {lead.destination === "matched-trades" ? (
                      <>
                        <p>These details are required for the private plan record. Only the fields you select on the next screen are shared with approved matched trades; email and postcode are always included so they can reply and match the service area.</p>
                        <div className={styles.leadColumns}>
                          <label><span>First name</span><input required maxLength={60} autoComplete="given-name" value={lead.firstName} onChange={(event) => updateLead((current) => ({ ...current, firstName: event.target.value }))} /></label>
                          <label><span>Last name</span><input required maxLength={60} autoComplete="family-name" value={lead.lastName} onChange={(event) => updateLead((current) => ({ ...current, lastName: event.target.value }))} /></label>
                          <label><span>Email</span><input required type="email" maxLength={254} autoComplete="email" inputMode="email" value={lead.email} onChange={(event) => updateLead((current) => ({ ...current, email: event.target.value }))} /></label>
                          <label><span>Phone</span><input required type="tel" maxLength={40} autoComplete="tel" inputMode="tel" value={lead.phone} onChange={(event) => updateLead((current) => ({ ...current, phone: event.target.value }))} /></label>
                          <label><span>Street address</span><input required maxLength={140} autoComplete="address-line1" value={lead.streetAddress} onChange={(event) => updateLead((current) => ({ ...current, streetAddress: event.target.value }))} /></label>
                          <label><span>Unit number <small>Optional</small></span><input maxLength={40} autoComplete="address-line2" value={lead.unitNumber} onChange={(event) => updateLead((current) => ({ ...current, unitNumber: event.target.value }))} /></label>
                        </div>
                      </>
                    ) : (
                      <>
                        <p>Only the details you enter here go to Australian Energy Assessments. Nothing is shared with matched trades.</p>
                        <label><span>Name</span><input required maxLength={120} autoComplete="name" value={lead.name} onChange={(event) => updateLead((current) => ({ ...current, name: event.target.value }))} /></label>
                        <label><span>Email <small>Email or phone required</small></span><input type="email" maxLength={254} autoComplete="email" inputMode="email" value={lead.email} onChange={(event) => updateLead((current) => ({ ...current, email: event.target.value }))} /></label>
                        <label><span>Phone <small>Email or phone required</small></span><input type="tel" maxLength={32} autoComplete="tel" inputMode="tel" value={lead.phone} onChange={(event) => updateLead((current) => ({ ...current, phone: event.target.value }))} /></label>
                      </>
                    )}
                    <div className={styles.leadNav}><button className={styles.leadSecondary} type="button" onClick={() => setLeadStage(lead.destination === "matched-trades" && quoteQuestions.length ? "questions" : "scope")}>Back</button><button className={styles.leadPrimary} type="button" onClick={advanceLeadContact}>Continue</button></div>
                  </section>
                )}

                {leadStage === "preferences" && (
                  <section className={styles.leadStep} aria-labelledby="aea-lead-preferences">
                    <h4 id="aea-lead-preferences">{lead.destination === "matched-trades" ? "Choose exactly what trades may see" : "Response preferences"}</h4>
                    {lead.destination === "matched-trades" ? (
                      <>
                        <p>Email, postcode, selected services, your message and any quote answers are included. The following details remain private unless you select them:</p>
                        <label className={styles.consent}><input type="checkbox" checked={lead.shareName} onChange={(event) => updateLead((current) => ({ ...current, shareName: event.target.checked }))} /><span>Also share my first and last name.</span></label>
                        <label className={styles.consent}><input type="checkbox" checked={lead.sharePhone} onChange={(event) => updateLead((current) => ({ ...current, sharePhone: event.target.checked }))} /><span>Also share my phone number.</span></label>
                        <label className={styles.consent}><input type="checkbox" checked={lead.shareAddress} onChange={(event) => updateLead((current) => ({ ...current, shareAddress: event.target.checked }))} /><span>Also share my unit, street, suburb and state.</span></label>
                        <label className={styles.consent}><input type="checkbox" checked={lead.shareKnownPlanFacts} onChange={(event) => updateLead((current) => ({ ...current, shareKnownPlanFacts: event.target.checked }))} /><span>Also include confirmed home-plan facts relevant to the selected services. My full plan stays private.</span></label>
                      </>
                    ) : (
                      <>
                        <label><span>Preferred contact</span><select value={lead.contactPreference} onChange={(event) => updateLead((current) => ({ ...current, contactPreference: event.target.value }))}><option value="either">Email or phone</option><option value="email">Email</option><option value="phone">Phone</option></select></label>
                        <label><span>Best contact time</span><select value={lead.bestContactTime} onChange={(event) => updateLead((current) => ({ ...current, bestContactTime: event.target.value }))}><option value="business-hours">Business hours</option><option value="after-hours">After hours</option><option value="any-time">Any time</option></select></label>
                      </>
                    )}
                    <label><span>Anything else to include? <small>Optional</small></span><textarea rows={3} maxLength={500} value={lead.message} onChange={(event) => updateLead((current) => ({ ...current, message: event.target.value }))} /></label>
                    <div className={styles.leadNav}><button className={styles.leadSecondary} type="button" onClick={() => setLeadStage("contact")}>Back</button><button className={styles.leadPrimary} type="button" onClick={() => setLeadStage("consent")}>Review consent</button></div>
                  </section>
                )}

                {leadStage === "consent" && (
                  <section className={styles.leadStep} aria-labelledby="aea-lead-consent">
                    <h4 id="aea-lead-consent">Confirm this one destination</h4>
                    {lead.destination === "matched-trades" ? (
                      <>
                        <p>{ENERGY_ASSISTANT_MATCHING_PRIVACY_EXPLANATION}</p>
                        <ul className={styles.sharingReceipt} aria-label="Details selected for matched trades">
                          <li>Email, postcode, selected services and supplied quote answers: shared</li>
                          <li>Name: {lead.shareName ? "shared" : "private"}</li>
                          <li>Phone: {lead.sharePhone ? "shared" : "private"}</li>
                          <li>Street address: {lead.shareAddress ? "shared" : "private"}</li>
                          <li>Confirmed relevant plan facts: {lead.shareKnownPlanFacts ? "shared" : "private"}</li>
                          <li>Private plan copy, full saved plan and chat: private</li>
                        </ul>
                        <label className={styles.consent}><input type="checkbox" required checked={lead.serviceConsent} onChange={(event) => updateLead((current) => ({ ...current, serviceConsent: event.target.checked }))} /><span>I agree to email my private plan copy and route this selected structured enquiry to suitable approved trades. This consent is optional and unchecked by default.</span></label>
                      </>
                    ) : (
                      <>
                        <label className={styles.consent}><input type="checkbox" required checked={lead.serviceConsent} onChange={(event) => updateLead((current) => ({ ...current, serviceConsent: event.target.checked }))} /><span>I agree that Australian Energy Assessments may use these details to respond to this service request. Nothing is sent to matched trades.</span></label>
                        <label className={styles.consent}><input type="checkbox" checked={lead.marketingConsent} onChange={(event) => updateLead((current) => ({ ...current, marketingConsent: event.target.checked }))} /><span>I would also like occasional Australian Energy Assessments updates. This is optional and is not required for a response.</span></label>
                      </>
                    )}
                    <div className={styles.leadNav}><button className={styles.leadSecondary} type="button" onClick={() => setLeadStage("preferences")}>Back</button></div>
                  </section>
                )}
                {leadError && <p className={styles.error} role="alert">{leadError}</p>}
                {leadStatus && <p className={styles.status} role="status">{leadStatus}</p>}
                {leadStage === "consent" && <button className={styles.leadSubmit} type="submit" disabled={leadBusy || Boolean(leadStatus) || !lead.serviceConsent}>
                  {leadBusy ? "Sending request..." : leadStatus ? "Request sent" : "Send request"}
                </button>}
              </form>
            )}

            {messages.length > 0 && (
              <ol className={styles.messages} aria-label="Energy guide conversation" aria-live="polite" aria-relevant="additions text">
                {messages.map((message, messageIndex) => (
                  <li key={message.id} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
                    {message.role === "user" ? (
                      <p>{message.content}</p>
                    ) : (
                      <>
                        <span className={styles.assistantAvatar} aria-hidden="true">
                          <Image src="/surge-mascot.webp" alt="" width={56} height={70} />
                        </span>
                        <article className={styles.answerCard}>
                          <header><span>Surge AI</span></header>
                          {message.answerStatus === "source_review_required" && (
                            <p className={styles.reviewRequired}>I need a current official rule check before you rely on this for a rebate or eligibility decision.</p>
                          )}
                          {message.verdict ? (
                            <>
                              <p className={styles.verdict}>{customerVisibleText(message.verdict, context.audience)}</p>
                              {message.reason && <p className={styles.directAnswer}>{customerVisibleText(message.reason, context.audience)}</p>}
                              {message.practicalSteps.length > 0 && (
                                <ol className={styles.practicalSteps}>
                                  {message.practicalSteps.map((step) => <li key={step}>{customerVisibleText(step, context.audience)}</li>)}
                                </ol>
                              )}
                              {message.extraDetail && (
                                <details className={styles.extraDetail}>
                                  <summary>Why this matters</summary>
                                  <p>{customerVisibleText(message.extraDetail, context.audience)}</p>
                                </details>
                              )}
                            </>
                          ) : (
                            <p className={styles.directAnswer}>{customerVisibleText(message.directAnswer || message.content, context.audience)}</p>
                          )}
                          {naturalFollowUpFor(message, context.audience) && (
                            <p className={styles.clarifyingQuestion}>{naturalFollowUpFor(message, context.audience)}</p>
                          )}
                          {message.id === messages[messages.length - 1]?.id && (message.quickReplies?.length || 0) > 0 && (
                            <div className={styles.quickReplies} aria-label="Suggested replies">
                              {message.quickReplies?.map((reply) => (
                                <button type="button" key={reply.id} disabled={busy} onClick={() => void ask(reply.message)}>
                                  {reply.label}
                                </button>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            className={styles.reviewAnswer}
                            disabled={answerReviewState[message.id] === "sending" || answerReviewState[message.id] === "sent"}
                            onClick={() => void submitAnswerReview(message, messageIndex)}
                          >
                            {answerReviewState[message.id] === "sending"
                              ? "Sending..."
                              : answerReviewState[message.id] === "sent"
                                ? "Sent for review"
                                : answerReviewState[message.id] === "error"
                                  ? "Try review again"
                                  : "Review answer"}
                          </button>
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
            <div ref={conversationEndRef} data-testid="surge-conversation-end" className={styles.conversationEnd} aria-hidden="true" />
          </div>

          {(context.audience === "trade" || profile.completed || profileDeferred || messages.length > 0) && <form className={styles.composer} onSubmit={submitQuestion}>
            <label htmlFor="aea-energy-guide-question">Ask Surge AI</label>
            <div>
              <textarea
                ref={composerRef}
                data-testid="surge-composer-input"
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
              <button data-testid="surge-composer-submit" type="submit" disabled={busy || !draft.trim()} aria-label="Ask Surge AI">
                <span aria-hidden="true">Send</span>
              </button>
            </div>
            <small>{context.audience !== "trade" && profile.completed
              ? "Uses your saved home details and this conversation. Confirm regulated work and final eligibility before committing."
              : "Independent guidance. Confirm regulated work and final eligibility before committing."}</small>
          </form>}
          <Suspense fallback={null}>
            <EnergyAssistantDocumentTools
              disabled={busy || leadBusy}
              onMessages={addDocumentMessages}
              onClear={resetConversation}
            />
          </Suspense>
          </div>

          {dedicated && (
            <aside className={styles.guidanceRail} aria-label="Home guidance">
              <section className={styles.guidanceTips}>
                <span>Based on your saved context</span>
                <h3>Quick guidance</h3>
                <ul>
                  {contextTips.map((tip) => (
                    <li key={tip.title}><strong>{tip.title}</strong><p>{tip.detail}</p></li>
                  ))}
                </ul>
              </section>
              {optionalHelpAvailable && !leadOpen && (
                <section className={styles.guidanceHelp}>
                  <span>Optional human help</span>
                  <h3>Only if you want it</h3>
                  <p>Your chat and private plan stay private unless you deliberately choose a follow-up path.</p>
                  <button type="button" onClick={openLeadForm}>See optional help paths</button>
                </section>
              )}
              {leadOpen && (
                <section className={styles.guidanceHelp}>
                  <span>Optional help</span>
                  <h3>Form open</h3>
                  <p>Complete or close the form in the main workspace. Your conversation remains available below it.</p>
                  <button type="button" onClick={() => setLeadOpen(false)}>Back to chat</button>
                </section>
              )}
            </aside>
          )}
        </section>
      )}
    </div>
  );
}
