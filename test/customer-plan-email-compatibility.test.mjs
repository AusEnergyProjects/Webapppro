import assert from "node:assert/strict";
import test from "node:test";
import {
  AEA_BRANDMARK_PUBLIC_URL,
  createCustomerPlanReportView,
  customerPlanDocumentHtml,
  customerPlanDocumentText,
} from "../src/lib/customer-plan-document.mjs";
import {
  CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
} from "../src/lib/customer-projects.mjs";

const EVERYDAY_ACTION_IDS = [
  "moisture-safe-routine",
  "personal-warmth-first",
  "use-existing-controls",
  "safe-seasonal-airflow",
  "seasonal-window-and-landscape",
  "renter-friendly-diy-boundary",
];

function atCharacterLimit(label, maximum, fill = "&") {
  const prefix = `${label} `;
  return `${prefix}${fill.repeat(maximum - Array.from(prefix).length)}`;
}

function maximumEmailDocument() {
  return {
    heading: atCharacterLimit("Maximum heading", 180),
    planTitle: atCharacterLimit(
      "A comfortable, efficient home in clear stages",
      180,
    ),
    summary: atCharacterLimit(
      "Start with safe evidence and low-cost comfort measures",
      480,
    ),
    preparedDate: "2026-07-30",
    overview: {
      goals: Array.from({ length: 10 }, (_, index) =>
        atCharacterLimit(`Goal ${index + 1}`, 120)
      ),
      propertyType: atCharacterLimit("Detached house", 100),
      tenure: atCharacterLimit("I own the home", 100),
      approval: atCharacterLimit(
        "No shared-property approval known",
        180,
      ),
      pace: atCharacterLimit("Stage improvements over time", 100),
      budget: atCharacterLimit("$2,000 to $10,000", 100),
      state: atCharacterLimit("VIC", 20),
    },
    climate: {
      label: atCharacterLimit("Cool temperate planning profile", 160),
      summary: atCharacterLimit(
        "Prioritise safe draught control and insulation",
        480,
      ),
    },
    everydayActions: EVERYDAY_ACTION_IDS.map((id, index) => ({
      id,
      category: atCharacterLimit(`Everyday category ${index + 1}`, 100),
      title: atCharacterLimit(`Practical comfort action ${index + 1}`, 180),
      description: atCharacterLimit(
        `Try this bounded household action ${index + 1}`,
        900,
      ),
    })),
    everydayActionsBoundary: atCharacterLimit(
      "These are optional household actions, not substitute trade work",
      700,
    ),
    actions: Array.from({ length: 40 }, (_, index) => ({
      number: index + 1,
      id: `bounded-action-${index + 1}`,
      stage: atCharacterLimit(
        `Stage ${Math.floor(index / 5) + 1}`,
        100,
      ),
      title: atCharacterLimit(`Bounded home energy action ${index + 1}`, 180),
      description: atCharacterLimit(
        "Confirm the relevant evidence, permissions and written scope",
        900,
      ),
      completed: false,
      guideLabel: atCharacterLimit(`Open guide ${index + 1}`, 120),
      guideHref: "/guides/heating",
    })),
    questions: Array.from({ length: 3 }, (_, index) => ({
      prompt: atCharacterLimit(`Question ${index + 1}`, 240),
      whyItMatters: atCharacterLimit(
        `Why question ${index + 1} matters`,
        360,
      ),
    })),
    readiness: {
      answered: 14,
      total: 14,
      notSure: 0,
      linked: 0,
      missing: 0,
      missingLabels: [],
      message: atCharacterLimit("All questions addressed", 520),
      boundary: atCharacterLimit(
        "These details were supplied by the household",
        320,
      ),
    },
    professionalReview: {
      enabled: true,
      role: "accredited-energy-adviser",
      adviserName: atCharacterLimit("Alex Adviser", 80),
      accreditationScheme: atCharacterLimit("Accreditation scheme", 120),
      accreditationReference: "ACCREDITATION-REFERENCE-1234567890",
      notes: atCharacterLimit("Professional review note", 1_200),
      declarationAccepted: true,
      declarationVersion:
        CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
    },
    privacyNote: atCharacterLimit(
      "Private account details are not included",
      700,
    ),
    adviceBoundary: atCharacterLimit(
      "This is independent general guidance",
      700,
    ),
    resources: [
      {
        label: "Estimate certificate and rebate value",
        description: "Use the Australian Energy Assessments calculator.",
        href: "/calculator",
      },
      {
        label: "Find current rebates and support",
        description: "Review current support before accepting a quote.",
        href: "/rebates",
      },
      {
        label: "Compare electricity plans",
        description: "Continue with the guided electricity comparison.",
        href: "/compare",
      },
      {
        label: "Compare gas plans",
        description: "Continue with the guided gas comparison where relevant.",
        href: "/gas-compare",
      },
    ],
  };
}

function styleAttributes(html) {
  return Array.from(
    html.matchAll(/\sstyle="([^"]*)"/gi),
    (match) => match[1],
  );
}

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) =>
    Number.parseInt(value, 16) / 255
  ).map((value) =>
    value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  );
  return (
    (0.2126 * channels[0])
    + (0.7152 * channels[1])
    + (0.0722 * channels[2])
  );
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

test("true maximum plan email stays below clipping risk with explicit plain text parity", () => {
  const document = maximumEmailDocument();
  const report = createCustomerPlanReportView(document);
  const html = customerPlanDocumentHtml(document);
  const text = customerPlanDocumentText(document);

  assert.equal(report.actions.length, 40);
  assert.equal(report.everydayActions.length, 6);
  assert.equal(Array.from(document.actions[0].stage).length, 100);
  assert.equal(Array.from(document.actions[0].title).length, 180);
  assert.equal(Array.from(document.actions[0].description).length, 900);
  assert.equal(Array.from(document.actions[0].guideLabel).length, 120);
  assert.equal(
    Array.from(document.everydayActions[0].description).length,
    900,
  );
  assert.ok(
    Buffer.byteLength(html, "utf8") <= 88_000,
    `maximum HTML email reached ${Buffer.byteLength(html, "utf8")} bytes`,
  );
  assert.ok(
    Buffer.byteLength(text, "utf8") < 25_000,
    `maximum text email reached ${Buffer.byteLength(text, "utf8")} bytes`,
  );
  assert.match(html, /A comfortable, efficient home in clear stages/);
  assert.match(text, /A comfortable, efficient home in clear stages/);
  assert.match(html, /Bounded home energy action 1/);
  assert.match(text, /01\. Bounded home energy action 1/);
  assert.doesNotMatch(html, /Bounded home energy action 40/);
  assert.doesNotMatch(text, /40\. Bounded home energy action 40/);
  assert.match(html, /This email shows the first \d+ of 40 plan steps/);
  assert.match(text, /This email shows the first \d+ of 40 plan steps/);
  assert.match(html, /Some longer wording was shortened for email readability/);
  assert.match(text, /Some longer wording was shortened for email readability/);
  assert.match(html, /Private by design/i);
  assert.match(text, /PRIVATE BY DESIGN/);
  assert.match(html, /Australian Energy Assessments/);
  assert.match(text, /Australian Energy Assessments/);
  assert.doesNotMatch(html, />[^<]*\bAEA\b[^<]*</);
  assert.doesNotMatch(text, /\bAEA\b/);
  assert.doesNotMatch(html, /Questions that could|Home details to check/i);
  assert.doesNotMatch(text, /Questions that could|Home details to check/i);
});

test("email markup uses conservative table layout and inline client fallbacks", () => {
  const html = customerPlanDocumentHtml(maximumEmailDocument());
  const presentationTables =
    html.match(/<table\b[^>]*role="presentation"[^>]*>/gi) || [];
  const styles = styleAttributes(html);
  const gradientStyles = styles.filter((style) =>
    /background-image:/i.test(style)
  );

  assert.match(
    html,
    /^<!doctype html><html lang="en" xmlns="http:\/\/www\.w3\.org\/1999\/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">/i,
  );
  assert.ok(
    presentationTables.length >= 20,
    `only ${presentationTables.length} presentation tables were rendered`,
  );
  assert.ok(styles.length >= 60);
  assert.ok(gradientStyles.length > 0);
  for (const style of gradientStyles) {
    assert.match(
      style,
      /background-color:[^;]+;[^"]*background-image:/i,
      "every gradient surface needs a solid-colour fallback first",
    );
  }

  assert.doesNotMatch(
    html,
    /<script\b|<form\b|<iframe\b|<video\b|<svg\b|@font-face|position:\s*fixed|display:\s*(?:flex|grid)|var\(--|data:image\//i,
  );
  assert.match(html, /font-family:Arial,Helvetica,sans-serif/);
  assert.match(html, /<meta name="x-apple-disable-message-reformatting">/);
  assert.match(html, /<o:PixelsPerInch>96<\/o:PixelsPerInch>/);
  assert.match(
    html,
    /table, td \{ mso-table-lspace: 0pt; mso-table-rspace: 0pt; \}/,
  );
  assert.match(html, /-ms-interpolation-mode: bicubic/);
  assert.match(html, /-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%/);
  assert.doesNotMatch(html, /<ul\b|<ol\b/i);
  assert.match(
    html,
    /display:none!important;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;/,
  );
});

test("email small blue and muted copy meets WCAG AA contrast", () => {
  const html = customerPlanDocumentHtml(maximumEmailDocument());
  const foregrounds = ["#006da6", "#536c78"];
  const backgrounds = ["#eaf4f7", "#f8fcfd"];

  for (const foreground of foregrounds) {
    assert.match(html, new RegExp(foreground, "i"));
    for (const background of backgrounds) {
      const ratio = contrastRatio(foreground, background);
      assert.ok(
        ratio >= 4.5,
        `${foreground} on ${background} only reached ${ratio.toFixed(2)}:1`,
      );
    }
  }
  assert.doesNotMatch(html, /#0878b7|#637a87/i);
});

test("email markup keeps one accessible hosted brandmark and trusted links", () => {
  const html = customerPlanDocumentHtml(maximumEmailDocument());
  const images = html.match(/<img\b[^>]*>/gi) || [];
  const links = Array.from(
    html.matchAll(/\shref="([^"]+)"/gi),
    (match) => match[1],
  );

  assert.equal(images.length, 1);
  assert.ok(images[0].includes(`src="${AEA_BRANDMARK_PUBLIC_URL}"`));
  assert.match(images[0], /\bwidth="32"/);
  assert.match(images[0], /\bheight="32"/);
  assert.match(images[0], /\balt=""/);
  assert.ok(links.length >= 6);
  assert.ok(links.length < 50);
  for (const link of links) {
    assert.match(
      link,
      /^https:\/\/compare\.ausenergyassessments\.com\/(?:guides\/|calculator$|rebates$|compare$|gas-compare$)/,
    );
  }
  for (const href of ["calculator", "rebates", "compare", "gas-compare"]) {
    assert.ok(
      links.includes(`https://compare.ausenergyassessments.com/${href}`),
      `email is missing the guided ${href} link`,
    );
  }
});

test("email includes a bounded mobile adaptation for Gmail and Outlook apps", () => {
  const html = customerPlanDocumentHtml(maximumEmailDocument());

  assert.match(html, /@media only screen and \(max-width: 680px\)/);
  assert.match(html, /\.email-shell \{ width: 100% !important; \}/);
  assert.match(
    html,
    /\.snapshot-cell \{ display: block !important; width: auto !important; margin-bottom: 12px !important; \}/,
  );
  assert.match(html, /\.hero-title \{ font-size: 34px !important;/);
  assert.match(html, /width="640"/);
  assert.match(html, /max-width:640px/);
});
