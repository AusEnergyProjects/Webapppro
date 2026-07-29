export const CUSTOMER_PLAN_REPORT_DESIGN_VERSION =
  "2026-07-30-tech-presentation-design-v1";

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

export const customerPlanReportCopy = Object.freeze({
  brand: "Australian Energy Assessments",
  heroEyebrow: "Your personalised home energy plan",
  heroTitle: "Your home energy roadmap",
  heroIntro:
    "See what to do now, what to check and what can wait.",
  snapshotEyebrow: "Your home at a glance",
  snapshotTitle: "Your plan in one view",
  readinessEyebrow: "Before you spend",
  climateEyebrow: "Planning for your climate",
  startEyebrow: "Start here",
  startTitle: "Start with these three moves",
  startIntro:
    "These reduce uncertainty first. Work through them before committing to larger upgrades.",
  everydayEyebrow: "Quick comfort wins",
  everydayTitle: "Comfort wins you can try this week",
  everydayIntro:
    "Use the ideas that suit your home. Skip anything unsafe, unsuitable or against the product instructions.",
  whyEyebrow: "Why this order",
  whyTitle: "How your priorities were chosen",
  roadmapEyebrow: "Your step-by-step plan",
  roadmapTitle: "Build the rest of your roadmap",
  roadmapIntro:
    "Each step appears once. A site check or new information can still change the order.",
  completedEyebrow: "Plan progress",
  completedTitle: "Every step in this plan is marked complete",
  completedIntro:
    "Keep this copy for your records. Review it if your home, equipment or priorities change.",
  tradeEyebrow: "Before you book a trade",
  tradeTitle: "Three checks that protect your budget",
  privacyEyebrow: "Private by design",
  privacyTitle: "Useful detail without exposing private information",
  guideLabel: "Open the helpful guide",
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
  let title = "This plan is ready for a first review.";
  if (total && missing > 0) {
    title = `${missing} of ${total} home detail${
      missing === 1 ? "" : "s"
    } still need a quick check.`;
  } else if (total && notSure > 0) {
    title = `All ${total} key questions are covered. ${
      notSure
    } answer${notSure === 1 ? " is" : "s are"} still marked "Not sure".`;
  } else if (total) {
    title = `All ${total} key home questions are covered.`;
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
