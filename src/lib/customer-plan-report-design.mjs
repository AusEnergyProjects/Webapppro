export const CUSTOMER_PLAN_REPORT_DESIGN_VERSION =
  "2026-08-10-professional-personalised-report-design-v4";

export const customerPlanReportColors = Object.freeze({
  navy: "#063448",
  navyDeep: "#001525",
  inkSoft: "#0b526b",
  electricBlue: "#00a9e8",
  oceanBlue: "#0878b7",
  green: "#10b981",
  greenDark: "#047857",
  teal: "#20d8c1",
  aqua: "#74f1d7",
  mint: "#e8f7f5",
  mintStrong: "#d7f3ee",
  paper: "#f8fcfd",
  canvas: "#eaf4f7",
  text: "#082a3a",
  body: "#365467",
  muted: "#637a87",
  line: "#c9dfe5",
  cream: "#fff7e5",
  creamLine: "#e8c66f",
  creamText: "#6d5315",
});

export const customerPlanReportLayout = Object.freeze({
  pdf: Object.freeze({
    panelRadius: 10,
    compactRadius: 8,
    badgeRadius: 9,
    cardGap: 14,
    labelTitleGap: 7,
    titleBodyGap: 9,
    bodyLinkGap: 11,
    panelPaddingX: 20,
    panelPaddingY: 20,
  }),
  email: Object.freeze({
    shellRadius: 22,
    featureRadius: 20,
    tileRadius: 16,
    insetRadius: 12,
    badgeRadius: 10,
    sectionGap: 40,
    mobileSectionGap: 32,
    tileGap: 16,
    labelTitleGap: 8,
    titleBodyGap: 10,
    bodyLinkGap: 14,
    tilePaddingX: 22,
    tilePaddingY: 20,
  }),
});

export const customerPlanReportCopy = Object.freeze({
  brand: "Australian Energy Assessments",
  heroEyebrow: "Your personalised home energy plan",
  heroTitle: "A practical plan for a more comfortable, efficient home",
  heroIntro:
    "Your answers have been turned into an ordered scope, clear checks and useful next steps.",
  snapshotEyebrow: "Executive summary",
  snapshotTitle: "Your home and the decisions that come first",
  readinessEyebrow: "Before you spend",
  climateEyebrow: "Planning for your climate",
  startEyebrow: "Start here",
  startTitle: "Your first three priorities",
  startIntro:
    "Each step includes what to do, why it matters, what applies to this home and what a useful quote must contain.",
  everydayEyebrow: "Energy-saving actions",
  everydayTitle: "Useful actions you can take now",
  everydayIntro:
    "These are tailored to the answers in this plan. Use only what is safe and suitable for the household.",
  whyEyebrow: "Why this order",
  whyTitle: "How your priorities were chosen",
  roadmapEyebrow: "Your step-by-step plan",
  roadmapTitle: "Your complete ordered plan",
  roadmapIntro:
    "Work through the sequence in order. Unknown details are listed inside the step where they affect scope, safety or price.",
  completedEyebrow: "Plan progress",
  completedTitle: "Every step in this plan is marked complete",
  completedIntro:
    "Keep this copy for your records. Review it if your home, equipment or priorities change.",
  tradeEyebrow: "Before you book a trade",
  tradeTitle: "Use the same evidence checklist for every quote",
  privacyEyebrow: "Private by design",
  privacyTitle: "Useful detail without exposing private information",
  guideLabel: "Open the related Australian Energy Assessments guide",
  footer:
    "Independent, brand-neutral home energy guidance",
});

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function customerPlanDisplayDate(value) {
  const supplied = String(value ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(supplied);
  if (!match) return "";
  const month = Number(match[2]);
  if (month < 1 || month > 12) return "";
  return `${Number(match[3])} ${MONTHS[month - 1]} ${match[1]}`;
}

export function customerPlanReadinessPresentation(
  readiness,
  professionalReview = null,
) {
  const total = Math.max(0, Number(readiness?.total || 0));
  const missing = Math.max(0, Number(readiness?.missing || 0));
  const notSure = Math.max(0, Number(readiness?.notSure || 0));
  let title = "This plan is ready to use as a planning and quoting brief.";
  if (total && missing > 0) {
    title = "This plan is ready to use. Remaining site confirmations are placed inside the affected steps.";
  } else if (total && notSure > 0) {
    title = "This plan is ready to use. Details marked \"Not sure\" are handled inside the relevant steps.";
  } else if (total) {
    title = `All ${total} key home details are covered.`;
  }
  const body = String(
    readiness?.boundary
      || (
        professionalReview
          ? "These answers are marked as reviewed by the named self-declared adviser. Australian Energy Assessments has not independently checked that review."
          : "These details were supplied by the household and have not been professionally checked."
      ),
  );
  return { title, body };
}

export function customerPlanProfessionalPresentation(review) {
  if (!review) return null;
  return {
    eyebrow: "Professional review, self-declared",
    title: `Checked by ${String(review.adviserName || "the named adviser")}`,
    role: String(review.roleLabel || "Accredited adviser"),
    scheme: String(review.accreditationScheme || ""),
    reference: String(review.accreditationReference || ""),
    notes: String(review.notes || ""),
    boundary:
      "This professional status is self-declared. Australian Energy Assessments has not checked the adviser's identity, credentials or observations.",
  };
}
