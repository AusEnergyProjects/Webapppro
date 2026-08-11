"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  downloadPublicPlanPdf,
  type PublicPlanPdfInput,
} from "@/lib/customer-plan-pdf-client";
import {
  isPublicPlanUpgradeInterest,
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
  PUBLIC_PLAN_ENQUIRY_KIND,
} from "@/lib/public-plan-enquiry.mjs";
import {
  PUBLIC_PLAN_QUOTE_ALLOWED_TYPES,
  PUBLIC_PLAN_QUOTE_MAX_FILE_BYTES,
  PUBLIC_PLAN_QUOTE_MAX_FILES,
  PUBLIC_PLAN_QUOTE_MAX_IMAGE_DIMENSION,
  PUBLIC_PLAN_QUOTE_MAX_IMAGE_PIXELS,
  PUBLIC_PLAN_QUOTE_MAX_TOTAL_BYTES,
  PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
  publicPlanQuotePhotoPromptsForServices,
  publicPlanQuoteQuestionsForSnapshot,
} from "@/lib/public-plan-quote-preparation.mjs";
import styles from "./PublicPlanEnquiryForm.module.css";

export type PublicPlanUpgradeInterest =
  | "assessment"
  | "solar"
  | "battery"
  | "heating-cooling"
  | "hot-water"
  | "draught-proofing"
  | "insulation"
  | "glazing"
  | "window-coverings"
  | "ev-charging"
  | "other";

export type PublicPlanSnapshot = {
  goals: string[];
  pace: string;
  situation: string;
  approvalContext: string;
  budgetRange: string;
  addressState: string;
  features: string[];
  propertyContext?: {
    propertyType?: string;
    storeys?: string;
    ageBand?: string;
    floorArea?: string;
    occupants?: string;
    sharedWalls?: string;
    roofType?: string;
    roofColour?: string;
    roofForm?: string;
    roofCondition?: string;
    switchboard?: string;
    wallConstruction?: string;
    floorConstruction?: string;
  };
};

const INTEREST_LABELS: Record<PublicPlanUpgradeInterest, string> = {
  assessment: "An independent home energy assessment",
  solar: "Rooftop solar",
  battery: "A home battery",
  "heating-cooling": "Heating and cooling",
  "hot-water": "Hot water",
  "draught-proofing": "Draught proofing",
  insulation: "Insulation",
  glazing: "Windows and glazing",
  "window-coverings": "Blinds, shutters or external shading",
  "ev-charging": "Electric vehicle charging",
  other: "Another home energy upgrade",
};

type PublicPlanEnquiryFormProps = {
  initialPostcode?: string;
  suggestedInterests?: readonly string[];
  planSnapshot: PublicPlanSnapshot;
  planHref: string;
  className?: string;
};

type SubmissionStatus =
  | { kind: "idle"; message: "" }
  | { kind: "sending"; message: string }
  | { kind: "uploading"; message: string; reference: string }
  | { kind: "photos_pending"; message: string; reference: string }
  | { kind: "error"; message: string }
  | { kind: "received"; message: string; reference: string }
  | { kind: "success"; message: string; reference: string };

type QuoteWithdrawalStatus =
  | { kind: "idle"; message: ""; cleanupPending: 0 }
  | { kind: "removing"; message: string; cleanupPending: 0 }
  | { kind: "removed"; message: string; cleanupPending: number }
  | { kind: "error"; message: string; cleanupPending: 0 };

type LocalityLookupStatus = "idle" | "loading" | "ready" | "error";

type AddressLocality = {
  suburb: string;
  state: string;
};

type AddressLocalitiesResponse = {
  ok?: boolean;
  postcode?: unknown;
  localities?: unknown;
  error?: unknown;
};

type QuotePhotoSelection = {
  clientUploadId: string;
  promptId: string;
  file: File;
};

async function browserImageDimensions(file: File) {
  if (typeof window.createImageBitmap === "function") {
    try {
      const bitmap = await window.createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    } catch {
      return null;
    }
  }
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new window.Image();
    const finish = (dimensions: { width: number; height: number } | null) => {
      URL.revokeObjectURL(objectUrl);
      resolve(dimensions);
    };
    image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => finish(null);
    image.src = objectUrl;
  });
}

type QuotePreparationAnswer = {
  questionId: string;
  answer: string;
};

function localityOptionValue(locality: AddressLocality) {
  return JSON.stringify([locality.suburb, locality.state]);
}

function initialAllowedInterests(
  suggestedInterests: readonly string[] | undefined,
): PublicPlanUpgradeInterest[] {
  const suggested = suggestedInterests?.filter(
    (value, index, values) =>
      isPublicPlanUpgradeInterest(value) && values.indexOf(value) === index,
  ) as PublicPlanUpgradeInterest[] | undefined;
  return suggested?.length ? suggested : ["assessment"];
}

const INTEREST_OPTIONS = Object.entries(INTEREST_LABELS) as Array<
  [PublicPlanUpgradeInterest, string]
>;

function createSubmissionId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${date}.${crypto.randomUUID()}`;
}

function createQuoteUploadKey() {
  return crypto.randomUUID();
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function preparedAtFromReference(reference: string, fallback: string) {
  const match = /(?:^|-)\s*(\d{4})(\d{2})(\d{2})(?:-|$)/.exec(reference);
  return match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z` : fallback;
}

function submissionCoreKey({
  customerFirstName,
  customerLastName,
  email,
  phone,
  customerUnitNumber,
  customerStreetAddress,
  customerSuburb,
  customerState,
  postcode,
  interests,
  message,
  tradeSharing,
  quoteAnswers,
  quotePhotos,
  planSnapshot,
}: {
  customerFirstName: string;
  customerLastName: string;
  email: string;
  phone: string;
  customerUnitNumber: string;
  customerStreetAddress: string;
  customerSuburb: string;
  customerState: string;
  postcode: string;
  interests: PublicPlanUpgradeInterest[];
  message: string;
  tradeSharing: {
    name: boolean;
    phone: boolean;
    address: boolean;
  };
  quoteAnswers: QuotePreparationAnswer[];
  quotePhotos: QuotePhotoSelection[];
  planSnapshot: PublicPlanSnapshot;
}) {
  return JSON.stringify({
    customerFirstName: customerFirstName.trim(),
    customerLastName: customerLastName.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    customerUnitNumber: customerUnitNumber.trim(),
    customerStreetAddress: customerStreetAddress.trim(),
    customerSuburb: customerSuburb.trim(),
    customerState: customerState.trim(),
    postcode: postcode.trim(),
    interests: [...interests].sort(),
    message: message.trim(),
    tradeSharing,
    quoteAnswers: [...quoteAnswers]
      .sort((left, right) => left.questionId.localeCompare(right.questionId)),
    quotePhotos: quotePhotos
      .map((selection) => ({
        clientUploadId: selection.clientUploadId,
        promptId: selection.promptId,
        name: selection.file.name,
        type: selection.file.type,
        size: selection.file.size,
        lastModified: selection.file.lastModified,
      }))
      .sort((left, right) => left.clientUploadId.localeCompare(right.clientUploadId)),
    planSnapshot: {
      goals: [...planSnapshot.goals].sort(),
      pace: planSnapshot.pace,
      situation: planSnapshot.situation,
      approvalContext: planSnapshot.approvalContext,
      budgetRange: planSnapshot.budgetRange,
      addressState: planSnapshot.addressState,
      features: [...planSnapshot.features].sort(),
      propertyContext: {
        propertyType: planSnapshot.propertyContext?.propertyType || "",
        storeys: planSnapshot.propertyContext?.storeys || "",
        ageBand: planSnapshot.propertyContext?.ageBand || "",
        floorArea: planSnapshot.propertyContext?.floorArea || "",
        occupants: planSnapshot.propertyContext?.occupants || "",
        sharedWalls: planSnapshot.propertyContext?.sharedWalls || "",
        roofType: planSnapshot.propertyContext?.roofType || "",
        roofColour: planSnapshot.propertyContext?.roofColour || "",
        roofForm: planSnapshot.propertyContext?.roofForm || "",
        roofCondition: planSnapshot.propertyContext?.roofCondition || "",
        switchboard: planSnapshot.propertyContext?.switchboard || "",
        wallConstruction: planSnapshot.propertyContext?.wallConstruction || "",
        floorConstruction: planSnapshot.propertyContext?.floorConstruction || "",
      },
    },
    consent: {
      accepted: true,
      purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
      noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    },
  });
}

export function PublicPlanEnquiryForm({
  initialPostcode = "",
  suggestedInterests,
  planSnapshot,
  planHref,
  className = "",
}: PublicPlanEnquiryFormProps) {
  const [customerFirstName, setCustomerFirstName] = useState("");
  const [customerLastName, setCustomerLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [customerUnitNumber, setCustomerUnitNumber] = useState("");
  const [customerStreetAddress, setCustomerStreetAddress] = useState("");
  const [customerSuburb, setCustomerSuburb] = useState("");
  const [customerState, setCustomerState] = useState("");
  const [postcode, setPostcode] = useState(initialPostcode.slice(0, 4));
  const [localities, setLocalities] = useState<AddressLocality[]>([]);
  const [localityLookupStatus, setLocalityLookupStatus] = useState<LocalityLookupStatus>(() =>
    /^\d{4}$/.test(initialPostcode.slice(0, 4)) ? "loading" : "idle");
  const [localityLookupError, setLocalityLookupError] = useState("");
  const [interests, setInterests] = useState<PublicPlanUpgradeInterest[]>(() =>
    initialAllowedInterests(suggestedInterests));
  const [message, setMessage] = useState("");
  const [quoteAnswers, setQuoteAnswers] = useState<Record<string, string>>({});
  const [includeKnownPlanAnswers, setIncludeKnownPlanAnswers] = useState(false);
  const [quotePhotos, setQuotePhotos] = useState<QuotePhotoSelection[]>([]);
  const [quotePhotoError, setQuotePhotoError] = useState("");
  const [shareName, setShareName] = useState(false);
  const [sharePhone, setSharePhone] = useState(false);
  const [shareAddress, setShareAddress] = useState(false);
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [gatewayPlanDownloadBusy, setGatewayPlanDownloadBusy] = useState(false);
  const [gatewayPlanDownloadError, setGatewayPlanDownloadError] = useState("");
  const [quoteWithdrawal, setQuoteWithdrawal] = useState<QuoteWithdrawalStatus>({
    kind: "idle",
    message: "",
    cleanupPending: 0,
  });
  const [sharedQuotePackPrepared, setSharedQuotePackPrepared] = useState(false);
  const [status, setStatus] = useState<SubmissionStatus>({ kind: "idle", message: "" });
  const startedAt = useRef(0);
  const submissionId = useRef("");
  const quoteUploadKey = useRef("");
  const uploadedQuotePhotoIds = useRef(new Set<string>());
  const acceptedLeadReference = useRef("");
  const acceptedLeadSuccessMessage = useRef("");
  const consentGrantedAt = useRef("");
  const lastAttemptCore = useRef("");
  const successfulPdfInput = useRef<PublicPlanPdfInput | null>(null);
  const gatewayDialogRef = useRef<HTMLDialogElement>(null);
  const gatewayFirstActionRef = useRef<HTMLAnchorElement>(null);
  const gatewayReopenRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    startedAt.current = Date.now();
    submissionId.current = createSubmissionId();
    quoteUploadKey.current = createQuoteUploadKey();
    uploadedQuotePhotoIds.current = new Set();
    acceptedLeadReference.current = "";
    acceptedLeadSuccessMessage.current = "";
    consentGrantedAt.current = "";
    lastAttemptCore.current = "";
  }, []);

  useEffect(() => {
    if (!/^\d{4}$/.test(postcode)) {
      return;
    }
    const controller = new AbortController();
    let current = true;
    void fetch(`/api/address-localities?postcode=${encodeURIComponent(postcode)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const result = await response.json().catch(() => ({})) as AddressLocalitiesResponse;
      if (!response.ok || !result.ok) {
        throw new Error(typeof result.error === "string" && result.error.trim()
          ? result.error.trim()
          : "Suburbs could not be loaded for this postcode.");
      }
      const seen = new Set<string>();
      const nextLocalities = Array.isArray(result.localities)
        ? result.localities.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const record = value as { suburb?: unknown; state?: unknown };
          const suburb = typeof record.suburb === "string" ? record.suburb.trim() : "";
          const state = typeof record.state === "string" ? record.state.trim().toUpperCase() : "";
          const key = `${suburb.toLocaleLowerCase("en-AU")}:${state}`;
          if (!suburb || suburb.length > 80 || !/^(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/.test(state) || seen.has(key)) return [];
          seen.add(key);
          return [{ suburb, state }];
        })
        : [];
      if (!nextLocalities.length || result.postcode !== postcode) {
        throw new Error("No matching suburbs were found for this postcode.");
      }
      if (!current) return;
      setLocalities(nextLocalities);
      setLocalityLookupStatus("ready");
    }).catch((error: unknown) => {
      if (!current || controller.signal.aborted) return;
      setLocalityLookupStatus("error");
      setLocalityLookupError(error instanceof Error
        ? error.message
        : "Suburbs could not be loaded for this postcode.");
    });

    return () => {
      current = false;
      controller.abort();
    };
  }, [postcode]);

  useEffect(() => {
    if (status.kind !== "success" || !gatewayOpen) return;
    const dialog = gatewayDialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function" && !dialog.open) {
      dialog.showModal();
    } else if (!dialog.open) {
      dialog.setAttribute("open", "");
    }
    gatewayFirstActionRef.current?.focus();
  }, [gatewayOpen, status.kind]);

  function reset() {
    setStatus({ kind: "idle", message: "" });
    setConsent(false);
    setMessage("");
    setQuoteAnswers({});
    setIncludeKnownPlanAnswers(false);
    setQuotePhotos([]);
    setQuotePhotoError("");
    setShareName(false);
    setSharePhone(false);
    setShareAddress(false);
    setSubmitAttempted(false);
    setGatewayOpen(false);
    setGatewayPlanDownloadBusy(false);
    setGatewayPlanDownloadError("");
    setQuoteWithdrawal({ kind: "idle", message: "", cleanupPending: 0 });
    successfulPdfInput.current = null;
    startedAt.current = Date.now();
    submissionId.current = createSubmissionId();
    quoteUploadKey.current = createQuoteUploadKey();
    uploadedQuotePhotoIds.current = new Set();
    acceptedLeadReference.current = "";
    acceptedLeadSuccessMessage.current = "";
    setSharedQuotePackPrepared(false);
    consentGrantedAt.current = "";
    lastAttemptCore.current = "";
  }

  function changeInterests(nextInterests: PublicPlanUpgradeInterest[]) {
    const visibleQuestions = publicPlanQuoteQuestionsForSnapshot(nextInterests, planSnapshot);
    const allowedQuestionIds = new Set(visibleQuestions.map((question) => question.id));
    const allowedPromptIds = new Set(
      publicPlanQuotePhotoPromptsForServices(nextInterests).map((prompt) => prompt.id),
    );
    setInterests(nextInterests);
    setQuoteAnswers((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([questionId]) => allowedQuestionIds.has(questionId)),
      );
      if (includeKnownPlanAnswers) {
        for (const question of visibleQuestions) {
          if (
            question.defaultAnswer
            && !Object.prototype.hasOwnProperty.call(current, question.id)
          ) {
            next[question.id] = question.defaultAnswer;
          }
        }
      }
      return next;
    });
    setQuotePhotos((current) => current.filter((selection) =>
      allowedPromptIds.has(selection.promptId)));
    if (!visibleQuestions.some((question) => question.defaultAnswer)) {
      setIncludeKnownPlanAnswers(false);
    }
  }

  function toggleInterest(interest: PublicPlanUpgradeInterest) {
    changeInterests(interests.includes(interest)
      ? interests.filter((value) => value !== interest)
      : [...interests, interest]);
  }

  function toggleAllInterests(selectAll: boolean) {
    changeInterests(selectAll ? INTEREST_OPTIONS.map(([value]) => value) : []);
  }

  function changeKnownPlanAnswerSharing(include: boolean) {
    const knownQuestions = publicPlanQuoteQuestionsForSnapshot(interests, planSnapshot)
      .filter((question) => question.defaultAnswer);
    setIncludeKnownPlanAnswers(include);
    setQuoteAnswers((current) => {
      const next = { ...current };
      for (const question of knownQuestions) {
        if (include) {
          if (!Object.prototype.hasOwnProperty.call(current, question.id)) {
            next[question.id] = question.defaultAnswer;
          }
        } else if (next[question.id] === question.defaultAnswer) {
          delete next[question.id];
        }
      }
      return next;
    });
  }

  function changePostcode(nextPostcode: string) {
    setPostcode(nextPostcode);
    setCustomerSuburb("");
    setLocalities([]);
    setCustomerState("");
    setLocalityLookupError("");
    setLocalityLookupStatus(/^\d{4}$/.test(nextPostcode) ? "loading" : "idle");
  }

  function changeLocality(nextLocalityValue: string) {
    const selected = localities.find((locality) =>
      localityOptionValue(locality) === nextLocalityValue);
    setCustomerSuburb(selected?.suburb || "");
    setCustomerState(selected?.state || "");
  }

  async function chooseQuotePhotos(promptId: string, selectedFiles: FileList | null) {
    const files = Array.from(selectedFiles || []);
    if (!files.length) return;
    const retained = quotePhotos;
    const invalidType = files.find((file) =>
      !PUBLIC_PLAN_QUOTE_ALLOWED_TYPES.includes(file.type));
    if (invalidType) {
      setQuotePhotoError("Choose JPEG or PNG photos only.");
      return;
    }
    const invalidSize = files.find((file) =>
      file.size <= 0 || file.size > PUBLIC_PLAN_QUOTE_MAX_FILE_BYTES);
    if (invalidSize) {
      setQuotePhotoError("Each quote photo must be no larger than 8 MB.");
      return;
    }
    for (const file of files) {
      const dimensions = await browserImageDimensions(file);
      if (!dimensions) {
        setQuotePhotoError("One selected photo could not be read. Choose a valid JPEG or PNG image.");
        return;
      }
      if (
        dimensions.width <= 0
        || dimensions.height <= 0
        || dimensions.width > PUBLIC_PLAN_QUOTE_MAX_IMAGE_DIMENSION
        || dimensions.height > PUBLIC_PLAN_QUOTE_MAX_IMAGE_DIMENSION
        || dimensions.width * dimensions.height > PUBLIC_PLAN_QUOTE_MAX_IMAGE_PIXELS
      ) {
        setQuotePhotoError("Choose a photo no larger than 8,192 pixels on either side or 25 megapixels.");
        return;
      }
    }
    const next = [
      ...retained,
      ...files.map((file) => ({
        clientUploadId: `quote.${crypto.randomUUID()}`,
        promptId,
        file,
      })),
    ];
    if (next.length > PUBLIC_PLAN_QUOTE_MAX_FILES) {
      setQuotePhotoError(`Choose no more than ${PUBLIC_PLAN_QUOTE_MAX_FILES} quote photos in total.`);
      return;
    }
    if (next.reduce((total, selection) => total + selection.file.size, 0)
      > PUBLIC_PLAN_QUOTE_MAX_TOTAL_BYTES) {
      setQuotePhotoError("The selected quote photos must total no more than 48 MB.");
      return;
    }
    setQuotePhotos(next);
    setQuotePhotoError("");
  }

  function removeQuotePhoto(clientUploadId: string) {
    setQuotePhotos((current) => current.filter((selection) =>
      selection.clientUploadId !== clientUploadId));
    setQuotePhotoError("");
  }

  function finishAcceptedEnquiry(reference: string) {
    setStatus({
      kind: "success",
      message: acceptedLeadSuccessMessage.current,
      reference,
    });
    setGatewayOpen(true);
  }

  async function uploadRemainingQuotePhotos(reference: string) {
    const remaining = quotePhotos.filter((selection) =>
      !uploadedQuotePhotoIds.current.has(selection.clientUploadId));
    if (!remaining.length) {
      finishAcceptedEnquiry(reference);
      return;
    }
    setStatus({
      kind: "uploading",
      message: `Your enquiry is received. Securely preparing ${remaining.length} selected ${remaining.length === 1 ? "photo" : "photos"} for matched trades...`,
      reference,
    });
    try {
      for (const selection of remaining) {
        const form = new FormData();
        form.set("sourceReference", reference);
        form.set("uploadKey", quoteUploadKey.current);
        form.set("clientUploadId", selection.clientUploadId);
        form.set("promptId", selection.promptId);
        form.set("file", selection.file, selection.file.name);
        const response = await fetch("/api/public-plan-quote-preparation", {
          method: "POST",
          headers: {
            "X-Quote-Source-Reference": reference,
            "X-Quote-Upload-Key": quoteUploadKey.current,
          },
          body: form,
        });
        const result = await response.json().catch(() => ({})) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || !result.ok) {
          throw new Error(result.error || "A selected quote photo could not be uploaded.");
        }
        uploadedQuotePhotoIds.current.add(selection.clientUploadId);
        const remainingCount = quotePhotos.length - uploadedQuotePhotoIds.current.size;
        setStatus({
          kind: "uploading",
          message: remainingCount > 0
            ? `${uploadedQuotePhotoIds.current.size} of ${quotePhotos.length} selected photos are ready. Uploading ${remainingCount} more...`
            : "All selected quote photos are ready for matched trades.",
          reference,
        });
      }
      finishAcceptedEnquiry(reference);
    } catch (error) {
      const readyCount = uploadedQuotePhotoIds.current.size;
      setStatus({
        kind: "photos_pending",
        message: `Your enquiry was sent and ${readyCount} of ${quotePhotos.length} selected photos are ready. ${error instanceof Error ? error.message : "The remaining photos could not be uploaded."} Retry the remaining photos without sending the enquiry again.`,
        reference,
      });
    }
  }

  function retryQuotePhotoUploads() {
    const reference = acceptedLeadReference.current;
    if (!reference || status.kind !== "photos_pending") return;
    void uploadRemainingQuotePhotos(reference);
  }

  async function removeSharedQuotePack(confirmRemoval = true) {
    const reference = acceptedLeadReference.current;
    if (!reference || !quoteUploadKey.current) {
      setQuoteWithdrawal({
        kind: "error",
        message: "The private removal reference is not available. Call 1300 241 149 with your enquiry reference.",
        cleanupPending: 0,
      });
      return;
    }
    if (
      confirmRemoval
      && !window.confirm(
        "Remove the optional quote answers and photos from matched trades? Your enquiry and contact details will remain sent.",
      )
    ) {
      return;
    }
    setQuoteWithdrawal({
      kind: "removing",
      message: "Removing shared quote details and photos...",
      cleanupPending: 0,
    });
    try {
      const response = await fetch("/api/public-plan-quote-preparation", {
        method: "DELETE",
        headers: {
          "X-Quote-Source-Reference": reference,
          "X-Quote-Upload-Key": quoteUploadKey.current,
        },
      });
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        cleanupPending?: number;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "The shared quote details could not be removed.");
      }
      const cleanupPending = Number.isSafeInteger(result.cleanupPending)
        ? Math.max(0, Number(result.cleanupPending))
        : 0;
      uploadedQuotePhotoIds.current = new Set();
      setSharedQuotePackPrepared(false);
      setQuoteAnswers({});
      setIncludeKnownPlanAnswers(false);
      setQuotePhotos([]);
      setQuotePhotoError("");
      setStatus({
        kind: "success",
        message: "Your enquiry remains sent. Optional quote details and photos are no longer available to matched trades.",
        reference,
      });
      setGatewayOpen(false);
      setQuoteWithdrawal({
        kind: "removed",
        message: cleanupPending
          ? "Trade access stopped immediately. Retry private photo cleanup below."
          : "Shared quote details and photos were removed. Your enquiry remains sent.",
        cleanupPending,
      });
    } catch (error) {
      setQuoteWithdrawal({
        kind: "error",
        message: error instanceof Error
          ? error.message
          : "The shared quote details could not be removed. Try again.",
        cleanupPending: 0,
      });
    }
  }

  function closeGateway() {
    const dialog = gatewayDialogRef.current;
    if (dialog?.open && typeof dialog.close === "function") {
      dialog.close();
      return;
    }
    setGatewayOpen(false);
    gatewayReopenRef.current?.focus();
  }

  async function downloadSubmittedPlan(
    event: ReactMouseEvent<HTMLAnchorElement>,
  ) {
    event.preventDefault();
    const input = successfulPdfInput.current;
    if (!input || gatewayPlanDownloadBusy) return;
    setGatewayPlanDownloadBusy(true);
    setGatewayPlanDownloadError("");
    try {
      await downloadPublicPlanPdf(input);
    } catch (error) {
      setGatewayPlanDownloadError(
        error instanceof Error
          ? error.message
          : "Your personalised plan could not be downloaded. Please try again.",
      );
    } finally {
      setGatewayPlanDownloadBusy(false);
    }
  }

  function changeConsent(accepted: boolean) {
    setConsent(accepted);
    if (accepted) {
      consentGrantedAt.current = new Date().toISOString();
      return;
    }
    consentGrantedAt.current = "";
    if (lastAttemptCore.current) {
      submissionId.current = createSubmissionId();
      lastAttemptCore.current = "";
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);
    if (!customerFirstName.trim()) {
      setStatus({ kind: "error", message: "Enter your first name for Australian Energy Assessments records. It stays private unless you choose to share it." });
      return;
    }
    if (!customerLastName.trim()) {
      setStatus({ kind: "error", message: "Enter your last name for Australian Energy Assessments records. It stays private unless you choose to share it." });
      return;
    }
    if (!email.trim()) {
      setStatus({ kind: "error", message: "Enter your email address so we can send your private plan and matching trades can reply." });
      return;
    }
    if (!phone.trim()) {
      setStatus({ kind: "error", message: "Enter your phone number for Australian Energy Assessments records. It stays private unless you choose to share it." });
      return;
    }
    if (!customerStreetAddress.trim()) {
      setStatus({ kind: "error", message: "Enter the street address for Australian Energy Assessments records. It stays private unless you choose to share it." });
      return;
    }
    if (!/^\d{4}$/.test(postcode)) {
      setStatus({ kind: "error", message: "Enter a valid Australian postcode." });
      return;
    }
    if (localityLookupStatus === "loading") {
      setStatus({ kind: "error", message: "Wait for the suburb list to finish loading." });
      return;
    }
    if (localityLookupStatus !== "ready" || !localities.some((locality) =>
      locality.suburb === customerSuburb && locality.state === customerState)) {
      setStatus({ kind: "error", message: "Choose a suburb for this postcode." });
      return;
    }
    if (interests.length === 0) {
      setStatus({ kind: "error", message: "Choose at least one service so we can notify the right trades." });
      return;
    }
    if (!consent || !consentGrantedAt.current) {
      setStatus({ kind: "error", message: "Confirm that we may use these details to respond to this enquiry." });
      return;
    }

    setStatus({ kind: "sending", message: "Sending your enquiry..." });
    try {
      if (!submissionId.current) {
        submissionId.current = createSubmissionId();
      }
      const preparedQuoteAnswers = publicPlanQuoteQuestionsForSnapshot(
        interests,
        planSnapshot,
      )
        .flatMap((question) => quoteAnswers[question.id]
          ? [{ questionId: question.id, answer: quoteAnswers[question.id] }]
          : []);
      const selectedPhotoPromptIds = publicPlanQuotePhotoPromptsForServices(interests)
        .map((prompt) => prompt.id)
        .filter((promptId) => quotePhotos.some((selection) =>
          selection.promptId === promptId));
      const currentCore = submissionCoreKey({
        customerFirstName,
        customerLastName,
        email,
        phone,
        customerUnitNumber,
        customerStreetAddress,
        customerSuburb,
        customerState,
        postcode,
        interests,
        message,
        tradeSharing: {
          name: shareName,
          phone: sharePhone,
          address: shareAddress,
        },
        quoteAnswers: preparedQuoteAnswers,
        quotePhotos,
        planSnapshot,
      });
      if (lastAttemptCore.current && lastAttemptCore.current !== currentCore) {
        submissionId.current = createSubmissionId();
        quoteUploadKey.current = createQuoteUploadKey();
        uploadedQuotePhotoIds.current = new Set();
      }
      lastAttemptCore.current = currentCore;
      const uploadKeyHash = await sha256Hex(quoteUploadKey.current);
      const publicPlanPdfInput: PublicPlanPdfInput = {
        snapshot: planSnapshot,
        name: [customerFirstName.trim(), customerLastName.trim()]
          .filter(Boolean)
          .join(" "),
        postcode,
        projectCategories: [...interests],
        preparedAt: new Date().toISOString(),
      };
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionType: "upgrade",
          enquiry: PUBLIC_PLAN_ENQUIRY_KIND,
          submissionId: submissionId.current,
          clientStartedAt: startedAt.current,
          website,
          customerFirstName,
          customerLastName,
          email,
          phone,
          customerUnitNumber,
          customerStreetAddress,
          customerSuburb,
          customerState,
          postcode,
          projectCategories: interests,
          projectNotes: message,
          tradeSharing: {
            email: true,
            postcode: true,
            name: shareName,
            phone: sharePhone,
            address: shareAddress,
          },
          quotePreparation: {
            version: PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
            answers: preparedQuoteAnswers,
            photoPromptIds: selectedPhotoPromptIds,
            expectedPhotoCount: quotePhotos.length,
            uploadKeyHash,
          },
          planSnapshot,
          consent: {
            accepted: true,
            purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
            noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
            grantedAt: consentGrantedAt.current,
          },
        }),
      });
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        filtered?: boolean;
        error?: string;
        reference?: string;
        planEmailSent?: boolean;
        received?: boolean;
      };
      if (result.filtered) {
        throw new Error("We could not verify this enquiry. Refresh the page and try again, or call 1300 241 149.");
      }
      if (!response.ok || !result.ok) {
        if (result.received) {
          setStatus({
            kind: "received",
            message: result.planEmailSent
              ? "Your enquiry and private plan PDF email were safely received, but trade matching is not prepared yet. Retry trade matching with this same request."
              : "Your enquiry was safely received, but trade matching is not prepared yet. Retry trade matching with this same request.",
            reference: result.reference || "",
          });
          return;
        }
        throw new Error(result.error || "Your enquiry could not be delivered. Please try again.");
      }
      const reference = result.reference || "";
      acceptedLeadReference.current = reference;
      setSharedQuotePackPrepared(preparedQuoteAnswers.length > 0 || quotePhotos.length > 0);
      acceptedLeadSuccessMessage.current = result.planEmailSent
        ? "Your enquiry is ready for matching trades and your personalised home plan PDF has been emailed to you. This did not create an account."
        : "Your enquiry is ready for matching trades. Your private plan PDF could not be emailed, so you can still download it here. This did not create an account.";
      successfulPdfInput.current = {
        ...publicPlanPdfInput,
        preparedAt: preparedAtFromReference(
          reference,
          publicPlanPdfInput.preparedAt,
        ),
      };
      if (quotePhotos.length) {
        if (!reference) {
          setStatus({
            kind: "photos_pending",
            message: "Your enquiry was sent, but its private photo reference was not returned. Call 1300 241 149 with your email address so we can help without resending the enquiry.",
            reference: "",
          });
          return;
        }
        await uploadRemainingQuotePhotos(reference);
        return;
      }
      finishAcceptedEnquiry(reference);
    } catch (caught) {
      setStatus({
        kind: "error",
        message: caught instanceof Error
          ? caught.message
          : "Your enquiry could not be delivered. Please try again.",
      });
    }
  }

  const rootClassName = [styles.root, className].filter(Boolean).join(" ");
  const allInterestsSelected = interests.length === INTEREST_OPTIONS.length;
  const serviceSelectionInvalid = submitAttempted && interests.length === 0;
  const quoteQuestions = publicPlanQuoteQuestionsForSnapshot(interests, planSnapshot);
  const knownPlanQuoteQuestions = quoteQuestions.filter((question) => question.defaultAnswer);
  const quotePhotoPrompts = publicPlanQuotePhotoPromptsForServices(interests);
  const answeredQuoteQuestionCount = quoteQuestions.filter((question) =>
    Boolean(quoteAnswers[question.id])).length;
  const showLocalityStates = new Set(localities.map((locality) => locality.state)).size > 1;
  const selectedLocalityValue = customerSuburb && customerState
    ? localityOptionValue({ suburb: customerSuburb, state: customerState })
    : "";

  if (status.kind === "uploading" || status.kind === "photos_pending") {
    return (
      <section className={rootClassName} aria-labelledby="public-plan-photo-upload-title">
        <div className={styles.success}>
          <span className={styles.eyebrow}>Enquiry received</span>
          <h3 className={styles.title} id="public-plan-photo-upload-title">
            {status.kind === "uploading"
              ? "Preparing your quote photos"
              : "Your enquiry is safe. Some photos still need attention."}
          </h3>
          <p role={status.kind === "photos_pending" ? "alert" : "status"}>{status.message}</p>
          {status.reference && <p className={styles.reference}>Reference {status.reference}</p>}
          <div className={styles.successActions}>
            {status.kind === "photos_pending" && status.reference ? (
              <button className={styles.reset} type="button" onClick={retryQuotePhotoUploads}>
                Retry remaining photos
              </button>
            ) : null}
            {status.kind === "photos_pending" ? (
              <button className={styles.secondaryAction} type="button" onClick={reset}>
                Start another enquiry
              </button>
            ) : null}
            {status.kind === "photos_pending" && sharedQuotePackPrepared ? (
              <button
                className={styles.secondaryAction}
                disabled={quoteWithdrawal.kind === "removing"}
                type="button"
                onClick={() => void removeSharedQuotePack()}
              >
                {quoteWithdrawal.kind === "removing"
                  ? "Removing shared quote details..."
                  : "Remove shared quote details and photos"}
              </button>
            ) : null}
          </div>
          {quoteWithdrawal.message ? (
            <p
              className={styles.withdrawalStatus}
              role={quoteWithdrawal.kind === "error" ? "alert" : "status"}
            >
              {quoteWithdrawal.message}
            </p>
          ) : null}
          <p className={styles.uploadPrivacyNote}>
            The enquiry is not sent again during a photo retry. Photos are stripped of location metadata, stay out of email and are available only after an approved matched trade signs in.
          </p>
        </div>
      </section>
    );
  }

  if (status.kind === "success") {
    return (
      <section className={rootClassName} aria-labelledby="public-plan-enquiry-success-title">
        <div className={styles.success}>
          <span className={styles.eyebrow}>Enquiry received</span>
          <h3 className={styles.title} id="public-plan-enquiry-success-title">We have your request</h3>
          <p role="status">{status.message}</p>
          {status.reference && <p className={styles.reference}>Reference {status.reference}</p>}
          <div className={styles.successActions}>
            <button
              className={styles.reset}
              ref={gatewayReopenRef}
              type="button"
              onClick={() => setGatewayOpen(true)}
            >
              Choose what to do next
            </button>
            <button className={styles.secondaryAction} type="button" onClick={reset}>Send another enquiry</button>
            {(sharedQuotePackPrepared || quoteWithdrawal.cleanupPending > 0) ? (
              <button
                className={styles.secondaryAction}
                disabled={quoteWithdrawal.kind === "removing"}
                type="button"
                onClick={() => void removeSharedQuotePack(quoteWithdrawal.kind !== "removed")}
              >
                {quoteWithdrawal.kind === "removing"
                  ? "Removing shared quote details..."
                  : quoteWithdrawal.cleanupPending > 0
                    ? "Retry private photo cleanup"
                    : "Remove shared quote details and photos"}
              </button>
            ) : null}
          </div>
          {quoteWithdrawal.message ? (
            <p
              className={styles.withdrawalStatus}
              role={quoteWithdrawal.kind === "error" ? "alert" : "status"}
            >
              {quoteWithdrawal.message}
            </p>
          ) : null}
        </div>
        <dialog
          aria-describedby="public-plan-next-steps-description"
          aria-labelledby="public-plan-next-steps-title"
          className={styles.gatewayDialog}
          onCancel={(event) => {
            event.preventDefault();
            closeGateway();
          }}
          onClose={() => {
            setGatewayOpen(false);
            gatewayReopenRef.current?.focus();
          }}
          ref={gatewayDialogRef}
        >
          <div className={styles.gatewayHeader}>
            <div>
              <span className={styles.eyebrow}>Your next step</span>
              <h3 id="public-plan-next-steps-title">Where would you like to go next?</h3>
            </div>
            <button
              aria-label="Close next steps"
              className={styles.gatewayClose}
              onClick={closeGateway}
              type="button"
            >
              <span aria-hidden="true">&#215;</span>
            </button>
          </div>
          <p id="public-plan-next-steps-description">
            Your enquiry is complete. Continue with another useful tool or open the printable version of your plan.
          </p>
          <nav aria-label="Continue in the portal" className={styles.gatewayActions}>
            <a href="/compare?from=home-plan" ref={gatewayFirstActionRef}>
              <strong>Compare electricity plans</strong>
              <span>Check current electricity offers</span>
            </a>
            <a href="/gas-compare?from=home-plan">
              <strong>Compare gas plans</strong>
              <span>Check gas offers separately</span>
            </a>
            <a href="/calculator">
              <strong>Use the rebate calculator</strong>
              <span>Estimate relevant rebates and certificates</span>
            </a>
            <a
              aria-disabled={gatewayPlanDownloadBusy}
              href={planHref}
              onClick={downloadSubmittedPlan}
            >
              <strong>
                {gatewayPlanDownloadBusy
                  ? "Preparing my plan..."
                  : "View my personalised plan"}
              </strong>
              <span>Download the same PDF prepared for your email</span>
            </a>
          </nav>
          {gatewayPlanDownloadError && (
            <p role="alert">{gatewayPlanDownloadError}</p>
          )}
        </dialog>
      </section>
    );
  }

  return (
    <section className={rootClassName} aria-labelledby="public-plan-enquiry-title">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Your next step</span>
          <h3 className={styles.title} id="public-plan-enquiry-title">Ask about an upgrade</h3>
          <p className={styles.intro}>No account needed. Tell us what you want help with and how to contact you.</p>
        </div>
        <span className={styles.badge}>About 1 minute + optional quote details</span>
      </header>

      <form className={styles.form} onSubmit={submit}>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.labelRow}>First name <span className={styles.optional}>private unless you share it below</span></span>
            <input className={styles.control} required autoComplete="given-name" maxLength={60} value={customerFirstName} onChange={(event) => setCustomerFirstName(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>Last name <span className={styles.optional}>private unless you share it below</span></span>
            <input className={styles.control} required autoComplete="family-name" maxLength={60} value={customerLastName} onChange={(event) => setCustomerLastName(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>Email <span className={styles.optional}>shared so trades can reply</span></span>
            <input className={styles.control} required type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby="public-plan-contact-hint" />
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>Phone <span className={styles.optional}>private unless you share it below</span></span>
            <input className={styles.control} required type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} aria-describedby="public-plan-contact-hint" />
          </label>
          <fieldset className={`${styles.addressFields} ${styles.full}`}>
            <legend>Property address</legend>
            <p>Start with the postcode, then choose the matching suburb. Australian Energy Assessments keeps the full address for its records.</p>
            <div className={styles.addressGrid}>
              <label className={styles.field}>
                <span className={styles.labelRow}>Postcode <span className={styles.optional}>shared to match your service area</span></span>
                <input
                  aria-describedby="public-plan-locality-status"
                  className={styles.control}
                  required
                  autoComplete="postal-code"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={postcode}
                  onChange={(event) => changePostcode(event.target.value.replace(/\D/g, "").slice(0, 4))}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.labelRow}>Suburb</span>
                <select
                  aria-busy={localityLookupStatus === "loading"}
                  aria-describedby="public-plan-locality-status"
                  className={styles.control}
                  disabled={localityLookupStatus !== "ready"}
                  required
                  value={selectedLocalityValue}
                  onChange={(event) => changeLocality(event.target.value)}
                >
                  <option value="">
                    {localityLookupStatus === "loading"
                      ? "Loading suburbs..."
                      : localityLookupStatus === "error"
                        ? "Check the postcode"
                        : localityLookupStatus === "ready"
                          ? "Choose suburb"
                          : "Enter postcode first"}
                  </option>
                  {localities.map((locality) => (
                    <option key={`${locality.suburb}:${locality.state}`} value={localityOptionValue(locality)}>
                      {locality.suburb}{showLocalityStates ? ` (${locality.state})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.labelRow}>State or territory <span className={styles.optional}>filled automatically</span></span>
                <input
                  aria-describedby="public-plan-locality-status"
                  className={`${styles.control} ${styles.readOnlyControl}`}
                  readOnly
                  value={customerState}
                />
              </label>
              <label className={`${styles.field} ${styles.addressStreet}`}>
                <span className={styles.labelRow}>Street address <span className={styles.optional}>private unless you share it below</span></span>
                <input className={styles.control} required autoComplete="address-line1" maxLength={140} value={customerStreetAddress} onChange={(event) => setCustomerStreetAddress(event.target.value)} aria-describedby="public-plan-contact-hint" />
              </label>
              <label className={styles.field}>
                <span className={styles.labelRow}>Unit number <span className={styles.optional}>optional</span></span>
                <input className={styles.control} autoComplete="address-line2" maxLength={40} value={customerUnitNumber} onChange={(event) => setCustomerUnitNumber(event.target.value)} />
              </label>
            </div>
            <p
              className={localityLookupStatus === "error" ? styles.lookupError : styles.lookupStatus}
              id="public-plan-locality-status"
              role={localityLookupStatus === "error" ? "alert" : "status"}
            >
              {localityLookupStatus === "loading"
                ? "Loading matching suburbs and state..."
                : localityLookupStatus === "ready"
                  ? customerSuburb
                    ? `${customerSuburb}, ${customerState} selected.`
                    : `${localities.length} ${localities.length === 1 ? "suburb" : "suburbs"} found. Choose one to fill the state.`
                  : localityLookupError}
            </p>
          </fieldset>
          <p className={`${styles.hint} ${styles.full}`} id="public-plan-contact-hint">Matching trades always receive your email, postcode and selected services. Your first and last name, phone, unit, street, suburb and state stay private unless you choose to share them.</p>
          <fieldset
            aria-describedby={serviceSelectionInvalid
              ? "public-plan-service-hint public-plan-service-error"
              : "public-plan-service-hint"}
            aria-invalid={serviceSelectionInvalid}
            aria-required="true"
            className={`${styles.serviceChoices} ${styles.full}`}
          >
            <legend>Which services would you like help with?</legend>
            <p id="public-plan-service-hint">Choose one, several or all. Every approved TLink trade that covers your area and offers at least one selected service can receive the lead.</p>
            <label className={`${styles.serviceChoice} ${styles.selectAll} ${allInterestsSelected ? styles.serviceChoiceSelected : ""}`}>
              <input
                checked={allInterestsSelected}
                onChange={(event) => toggleAllInterests(event.target.checked)}
                type="checkbox"
              />
              <span><strong>Select all services</strong><small>Send one enquiry across every service category</small></span>
            </label>
            <div className={styles.serviceGrid}>
              {INTEREST_OPTIONS.map(([value, label]) => {
                const selected = interests.includes(value);
                return (
                  <label className={`${styles.serviceChoice} ${selected ? styles.serviceChoiceSelected : ""}`} key={value}>
                    <input
                      checked={selected}
                      name="public-plan-services"
                      onChange={() => toggleInterest(value)}
                      type="checkbox"
                      value={value}
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
            <p className={styles.serviceCount} aria-live="polite">{interests.length} of {INTEREST_OPTIONS.length} services selected</p>
            {serviceSelectionInvalid ? <p className={styles.serviceError} id="public-plan-service-error" role="alert">Choose at least one service.</p> : null}
          </fieldset>
          <label className={`${styles.field} ${styles.full}`}>
            <span className={styles.labelRow}>Anything we should know? <span className={styles.optional}>optional</span></span>
            <textarea className={styles.control} maxLength={500} rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="For example, the system has stopped working or you want to plan the upgrade in stages." />
          </label>
          <details className={`${styles.quotePreparation} ${styles.full}`}>
            <summary>
              <span>
                <strong>Help trades prepare a desktop quote</strong>
                <small>Optional. Answer what you know and add useful photos, or skip this section.</small>
              </span>
              <span className={styles.quotePreparationCount}>
                {answeredQuoteQuestionCount} answers, {quotePhotos.length} photos
              </span>
            </summary>
            <div className={styles.quotePreparationBody}>
              <header className={styles.quotePreparationHeader}>
                <div>
                  <span className={styles.eyebrow}>Quote preparation</span>
                  <h4>One useful set of details for every selected service</h4>
                </div>
                <span>{quoteQuestions.length} deduplicated questions</span>
              </header>
              <p>
                Shared questions appear once even when several services need the same answer. Leaving any answer or photo blank will not stop the enquiry.
              </p>
              {knownPlanQuoteQuestions.length ? (
                <label className={styles.knownPlanAnswerChoice}>
                  <input
                    checked={includeKnownPlanAnswers}
                    onChange={(event) => changeKnownPlanAnswerSharing(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <strong>Use {knownPlanQuoteQuestions.length} known {knownPlanQuoteQuestions.length === 1 ? "answer" : "answers"} from my private plan</strong>
                    <small>The exact suggestions are marked below. Review, change or skip each one before sending.</small>
                  </span>
                </label>
              ) : null}
              <div className={styles.quoteQuestionGrid}>
                {quoteQuestions.map((question) => (
                  <label className={styles.quoteQuestion} key={question.id}>
                    <span>{question.label}</span>
                    {question.answerSource === "private-plan" ? (
                      <small className={styles.carriedPlanFact}>
                        {includeKnownPlanAnswers
                          ? `Carried from your private plan: ${question.defaultAnswer}. Change it or choose Skip before sharing.`
                          : `Suggested from your private plan: ${question.defaultAnswer}. It is not shared unless you use the control above or choose an answer yourself.`}
                      </small>
                    ) : (
                      <small>
                        For {question.services
                          .map((service) => INTEREST_LABELS[service as PublicPlanUpgradeInterest])
                          .join(", ")}
                      </small>
                    )}
                    <select
                      className={styles.control}
                      value={quoteAnswers[question.id] || ""}
                      onChange={(event) => setQuoteAnswers((current) => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))}
                    >
                      <option value="">Skip this question</option>
                      {question.options.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <section className={styles.quotePhotos} aria-labelledby="public-plan-quote-photos-title">
                <div>
                  <h4 id="public-plan-quote-photos-title">Photos that can reduce follow-up questions</h4>
                  <p>
                        Use your camera or choose existing JPEG or PNG images. Up to {PUBLIC_PLAN_QUOTE_MAX_FILES} photos, 8 MB each and 48 MB total.
                  </p>
                </div>
                <div className={styles.quotePhotoGrid}>
                  {quotePhotoPrompts.map((prompt) => {
                    const selectedForPrompt = quotePhotos.filter((selection) =>
                      selection.promptId === prompt.id);
                    const hintId = `public-plan-photo-hint-${prompt.id}`;
                    return (
                      <article className={styles.quotePhotoPrompt} key={prompt.id}>
                        <div>
                          <strong>{prompt.label}</strong>
                          <p id={hintId}>{prompt.hint}</p>
                        </div>
                        <label className={styles.photoPicker}>
                          <span>{selectedForPrompt.length ? "Add more photos" : "Add photos"}</span>
                          <input
                                accept="image/jpeg,image/png"
                            aria-describedby={hintId}
                            aria-label={`Add photos: ${prompt.label}`}
                            capture="environment"
                            multiple
                            type="file"
                            onChange={(event) => {
                              void chooseQuotePhotos(prompt.id, event.currentTarget.files);
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        {selectedForPrompt.length ? (
                          <ul className={styles.selectedPhotoList}>
                            {selectedForPrompt.map((selection) => (
                              <li key={selection.clientUploadId}>
                                <span>{selection.file.name}</span>
                                <button
                                  aria-label={`Remove ${selection.file.name}`}
                                  onClick={() => removeQuotePhoto(selection.clientUploadId)}
                                  type="button"
                                >
                                  Remove
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
                {quotePhotoError ? <p className={styles.serviceError} role="alert">{quotePhotoError}</p> : null}
                <p className={styles.quotePhotoPrivacy}>
                  Selected photos are stripped of location metadata before private storage. They are never attached to email and only approved trades matched to this enquiry can open them after signing in.
                </p>
              </section>
            </div>
          </details>
        </div>

        <fieldset className={styles.shareChoices}>
          <legend>Choose what matching trades can see</legend>
          <p>Your email, postcode, selected services, message and any optional quote answers or photos are included so trades can reply and understand what you need. Known plan answers are included only when you select the quote-preparation control above.</p>
          <label>
            <input type="checkbox" checked={shareName} onChange={(event) => setShareName(event.target.checked)} />
            <span>Also share my first and last name</span>
          </label>
          <label>
            <input type="checkbox" checked={sharePhone} onChange={(event) => setSharePhone(event.target.checked)} />
            <span>Also share my phone number</span>
          </label>
          <label>
            <input type="checkbox" checked={shareAddress} onChange={(event) => setShareAddress(event.target.checked)} />
            <span>Also share my full property address</span>
          </label>
        </fieldset>

        <div className={styles.honeypot} aria-hidden="true">
          <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
        </div>

        <label className={styles.consent}>
          <input className={styles.consentBox} type="checkbox" checked={consent} onChange={(event) => changeConsent(event.target.checked)} />
          <span>I agree that Australian Energy Assessments may send this enquiry to all approved TLink trades that service my area. Trades receive my email, postcode, selected services, message and any quote answers or photos I chose to add. This includes known plan answers only when I selected the quote-preparation control above. My name, phone or full property address is shared only if I selected it above. My full plan and PDF stay private and are emailed only to me.</span>
        </label>

        <details className={styles.privacy}>
          <summary>What is sent with this enquiry?</summary>
          <p>Australian Energy Assessments keeps the full enquiry, including your first and last name, unit, street, suburb and state, for its records. Matching trades receive your email, postcode, selected services, message and any optional quote answers or photos you deliberately added. Known answers from your private plan are included only when you select the quote-preparation control and can be changed or skipped before sending. Your first and last name, phone and full property address are included only when you choose to share them. Quote photos have location metadata removed, stay in private storage and are not attached to email. Your full plan, PDF, bills, energy usage, meter identifiers and account data are not shared with trades.</p>
        </details>

        <div className={styles.actions}>
          <button className={styles.submit} type="submit" disabled={status.kind === "sending"}>
            {status.kind === "sending"
              ? "Sending..."
              : status.kind === "received"
                ? "Retry trade matching"
                : "Send my enquiry"}
          </button>
          {status.message && (
            <p className={status.kind === "error" ? styles.error : styles.status} role={status.kind === "error" ? "alert" : "status"}>
              {status.message}
              {status.kind === "received" && status.reference ? ` Reference ${status.reference}.` : ""}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
