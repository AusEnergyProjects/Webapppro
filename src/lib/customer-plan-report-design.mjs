export const CUSTOMER_PLAN_REPORT_DESIGN_VERSION =
  "2026-07-29-premium-report-v1";

export const customerPlanReportColors = Object.freeze({
  navy: "#062c32",
  navyDeep: "#032733",
  inkSoft: "#0c4b4a",
  green: "#12a66a",
  greenDark: "#08794c",
  teal: "#20d8c1",
  mint: "#edf8f4",
  mintStrong: "#dff3eb",
  paper: "#ffffff",
  canvas: "#eef5f2",
  text: "#18332c",
  body: "#3f5d54",
  muted: "#667a72",
  line: "#d7e5df",
  cream: "#fff7e5",
  creamLine: "#e8c66f",
  creamText: "#6d5315",
});

export const customerPlanReportCopy = Object.freeze({
  brand: "Australian Energy Assessments",
  heroEyebrow: "Your personalised home energy plan",
  heroTitle: "A clearer path to a more comfortable home",
  heroIntro:
    "Start with the first unfinished step, then work down the list at a pace that suits your home and budget.",
  snapshotEyebrow: "Your home at a glance",
  snapshotTitle: "The choices shaping this plan",
  readinessEyebrow: "Before you spend",
  climateEyebrow: "Planning for your climate",
  startEyebrow: "Start here",
  startTitle: "Your first three steps",
  startIntro:
    "These steps reduce uncertainty first. Complete them before committing to larger work.",
  everydayEyebrow: "Easy things to try",
  everydayTitle: "Small comfort wins for everyday life",
  everydayIntro:
    "Use the ideas that suit your home. Skip anything unsafe, unsuitable or against the product instructions.",
  whyEyebrow: "Why this order",
  whyTitle: "How your priorities were chosen",
  roadmapEyebrow: "Your step-by-step plan",
  roadmapTitle: "What to consider next",
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
    "Independent, product-neutral home energy guidance",
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
  const body = professionalReview
    ? "The named adviser says these details were professionally checked. Australian Energy Assessments has not independently verified that declaration."
    : "These are the household's answers. They are useful for planning, but they are not a site inspection.";
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
