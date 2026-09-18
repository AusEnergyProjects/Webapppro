import { GOVERNMENT_ACTIVITY_TEMPLATES, GOVERNMENT_PROGRAM_TEMPLATES, type GovernmentActivityTemplate } from "../lib/australian-government-program-catalogue.ts";
import { CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT } from "./creditex-veu-publishable-work-pack-content.ts";
import { CREDITEX_VEU_ACTIVITY_DEFINITIONS } from "../lib/creditex-veu-calculator-catalogue.ts";
import { CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES } from "./creditex-sres-work-pack-content.ts";
import { CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT } from "./creditex-nsw-governed-work-pack-content.ts";
import { CREDITEX_NSW_PROGRAM_DEFINITIONS } from "../lib/creditex-nsw-program-catalogue.ts";
import { CREDITEX_TRAINING_SUPPLEMENTAL_FACTS } from "./creditex-training-supplemental-facts.ts";
import { CREDITEX_TRAINING_ADMINISTRATIVE_FACTS } from "./creditex-training-administrative-facts.ts";
import { CREDITEX_TRAINING_ACT_FACTS } from "./creditex-training-act-facts.ts";
import { CREDITEX_TRAINING_NATIONAL_FACTS } from "./creditex-training-national-facts.ts";
import { CREDITEX_TRAINING_NSW_BOUNDARY_FACTS } from "./creditex-training-nsw-boundary-facts.ts";
import { CREDITEX_TRAINING_NSW_TECHNICAL_FACTS } from "./creditex-training-nsw-technical-facts.ts";

/** Source-derived learning points, kept bound to one exact programme activity.
 * Retained source hashes identify historical evidence; they are not a fresh fetch
 * or Creditex approval. Course activation still requires independent review.
 */
export interface ActivityTrainingSource {
  id: string; title: string; url: string; reviewedAt?: string;
  version?: string; citation?: string; retainedSha256?: string; retainedObservedOn?: string;
}
export interface ActivityLearningFact {
  key: string; topic: string; requirement: string; sourceIds: string[];
  kind: "activity" | "evidence" | "authority" | "procedure";
}
export interface ActivityLearningProfile {
  activity: GovernmentActivityTemplate;
  programmeName: string;
  outcome: string;
  sources: ActivityTrainingSource[];
  facts: ActivityLearningFact[];
  gaps: string[];
}

interface RetainedSource {
  sourceId: string; officialUrl: string; title?: string; sourceTitle?: string;
  version?: string; sourceVersion?: string; citation?: string; expectedSha256?: string; observedOn?: string;
}
const policySource: ActivityTrainingSource = {
  id: "creditex-training-policy", title: "Creditex training, evidence and exception handling policy (draft for approval)",
  url: "/creditex-resources/creditex-training-operating-policy.md", reviewedAt: "2026-09-18",
};
const sentence = (value: string) => /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
const words = (value: string) => value.replaceAll("_", " ");

function createProfile(activity: GovernmentActivityTemplate): ActivityLearningProfile {
  const programme = GOVERNMENT_PROGRAM_TEMPLATES.find((entry) => entry.programCode === activity.programCode);
  if (!programme) throw new Error(`Missing programme for training activity ${activity.templateId}`);
  const profile: ActivityLearningProfile = {
    activity, programmeName: programme.programCode === "NSW-HES" ? "Home Energy Saver loans (current loan-only pathway)" : programme.name, outcome: programme.claimOutputLabel,
    sources: [{ id: "programme-authority", title: programme.officialSourceTitle, url: programme.officialSourceUrl }, policySource],
    facts: [], gaps: [],
  };
  const source = (retained: RetainedSource): string => {
    const id = retained.sourceId;
    if (!profile.sources.some((entry) => entry.id === id)) profile.sources.push({
      id, title: retained.title || retained.sourceTitle || programme.officialSourceTitle, url: retained.officialUrl,
      version: retained.version || retained.sourceVersion, citation: retained.citation,
      retainedSha256: retained.expectedSha256, retainedObservedOn: retained.observedOn || "2026-08-15",
    });
    return id;
  };
  const add = (key: string, topic: string, requirement: string, sourceIds: string[], kind: ActivityLearningFact["kind"] = "activity") => {
    if (!requirement.trim() || profile.facts.some((entry) => entry.key === key || entry.requirement === sentence(requirement))) return;
    profile.facts.push({ key, topic: words(topic), requirement: sentence(requirement), sourceIds, kind });
  };

  const veu = CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT.find((entry) => entry.templateId === activity.templateId);
  if (veu) {
    for (const entry of veu.sourceBindings) source(entry);
    if (veu.activityGuide) source(veu.activityGuide);
    const specification = veu.sourceBindings.find((entry) => entry.title === "Victorian Energy Upgrades Specifications 2018");
    const technicalSource = specification ? source(specification) : "programme-authority";
    for (const definition of CREDITEX_VEU_ACTIVITY_DEFINITIONS.filter((entry) => entry.activityCode === activity.registryActivityCode || entry.activityCode.startsWith(`${activity.registryActivityCode}C`) || entry.activityCode.startsWith(`${activity.registryActivityCode}D`))) {
      for (const input of definition.inputDefinitions) {
        add(`technical-${input.key}`, input.label, input.help, [technicalSource]);
      }
    }
    for (const item of veu.evidenceRequirements) {
      const id = source(item.source);
      add(`evidence-${item.requirementId}`, item.label,
        `Retain ${item.label.toLowerCase()}: ${item.details.join("; ")}. Applies ${item.when}`, [id], "evidence");
    }
    for (const item of veu.prompts.filter((entry) => entry.kind === "assignment" || entry.kind === "identity")) {
      add(`declaration-${item.key}`, item.label.replace(" from the applicable activity assignment form template", ""),
        `Capture ${item.label.toLowerCase()}. This applies ${item.when}; the declared details must match the actual activity and authorised people`, [source(item.source)], "authority");
    }
    for (const signature of veu.signatures) add(`signature-${signature.signatureId}`, `${words(signature.signerRole)} signature`,
      `The ${signature.documentType} needs the ${words(signature.signerRole)} signature ${signature.when}. A different worker or account owner cannot substitute their signature without the required authority`, [source(signature.source)], "authority");
  }

  const sres = CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES.find((entry) => entry.templateId === activity.templateId);
  if (sres) {
    for (const entry of sres.sourceBindings) source(entry);
    for (const prompt of sres.prompts) {
      add(`sres-${prompt.key}`, prompt.label, `${prompt.label} must identify ${prompt.fields.map(words).join(", ")}. Applies ${prompt.when}`, [source(prompt.source)], ["identity", "assignment", "declaration"].includes(prompt.kind) ? "authority" : "activity");
    }
    for (const evidence of sres.evidenceRequirements) {
      add(`evidence-${evidence.requirementId}`, evidence.label,
        `Retain ${evidence.label.toLowerCase()}: ${evidence.details.join("; ")}. Applies ${evidence.when}`, [source(evidence.source)], "evidence");
    }
    add("sres-calculation", "Entitlement calculation", sres.calculator.formulaSummary.replace("multiplied by 2031 minus installation year", "multiplied by (2031 minus installation year)"), [source(sres.calculator.source)]);
    add("sres-scenario", "Installation history", `Resolve the actual installation as ${sres.scenarioRules.sourceOptions.map(words).join("; ")}; these options determine which history and eligibility checks apply`, [source(sres.scenarioRules.source)]);
    for (const [index, limitation] of sres.statusDecision.sourceBackedLimitations.entries()) {
      const topic = limitation.startsWith("rated capacity") ? "Maximum rated generating capacity"
        : limitation.startsWith("annual electricity") ? "Annual generation limit"
        : limitation.startsWith("eligible from") ? "Scheme commencement date"
        : limitation.startsWith("nominal capacity") ? "Nominal battery capacity range"
        : limitation.startsWith("one battery") ? "Prior battery claims at the address"
        : limitation.startsWith("registered system") ? "Official system registration"
        : limitation.startsWith("capacity at most") ? "Maximum system capacity"
        : "Large-system supporting documents";
      add(`sres-limitation-${index}`, topic, limitation, [source(sres.statusDecision.source)]);
    }
    for (const signature of sres.signatures) {
      add(`signature-${signature.signatureId}`, `${words(signature.signerRole)} statement`,
        `The ${words(signature.signerRole)} supplies their own signature on the ${words(signature.documentType)}. Applies ${signature.when}`, [source(signature.source)], "authority");
    }
  }

  const nsw = CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT.find((entry) => entry.templateId === activity.templateId);
  for (const definition of CREDITEX_NSW_PROGRAM_DEFINITIONS.filter((entry) => entry.programCode === `${activity.programCode}-2026`).flatMap((entry) => entry.activities).filter((entry) => entry.officialActivityCode === activity.registryActivityCode)) {
    const ids = definition.sourceReferences.map((entry, index) => {
      const id = `nsw-current-rule-${index}`;
      if (!profile.sources.some((item) => item.id === id)) profile.sources.push({ id, title: entry.title, url: entry.url, citation: `${entry.clauses}; ${entry.pages}`, reviewedAt: "2026-09-18" });
      return id;
    });
    for (const input of definition.inputDefinitions) add(`technical-${input.key}`, input.label, input.help, ids);
    for (const [index, requirement] of definition.productRegistryRequirements.entries()) add(`registry-${index}`, `Approved equipment evidence ${index + 1}`, requirement, ids, "evidence");
    add("nsw-defined-scenario", "Defined activity scenario", definition.supportedScenario, ids);
    add("nsw-rule-period", "Applicable implementation period", `Apply the ${definition.effectiveDateLabel || "Installation date"} rules from ${definition.effectiveFrom}${definition.effectiveTo ? ` through ${definition.effectiveTo}` : ""}; source-version changes need a fresh review`, ids, "authority");
  }
  if (nsw) {
    for (const entry of nsw.sources) source(entry);
    for (const evidence of nsw.evidenceRequirements) add(`evidence-${evidence.key}`, evidence.label,
      `The activity evidence packet must include ${evidence.label.toLowerCase()}. Keep original files and source metadata linked to this implementation`, [source(evidence.source)], "evidence");
    for (const section of nsw.formSections.filter((entry) => entry.sectionKey === "job-and-nomination")) {
      for (const field of section.fields) add(`authority-${field.key}`, field.label,
        `The nomination record must establish ${field.label.toLowerCase()} for this implementation. Use the actual customer, provider and site records`, [source(field.source)], "authority");
    }
    for (const signature of nsw.signatures) add(`signature-${signature.role}`, `${words(signature.role)} declaration`,
      `Obtain the ${words(signature.role)} signature using the exact applicable official declaration and retain its completed record`, [source(signature.source)], "authority");
  }

  const supplemental = CREDITEX_TRAINING_SUPPLEMENTAL_FACTS[activity.templateId] || CREDITEX_TRAINING_ADMINISTRATIVE_FACTS[activity.templateId] || CREDITEX_TRAINING_ACT_FACTS[activity.templateId] || CREDITEX_TRAINING_NATIONAL_FACTS[activity.templateId] || CREDITEX_TRAINING_NSW_BOUNDARY_FACTS[activity.templateId] || CREDITEX_TRAINING_NSW_TECHNICAL_FACTS[activity.templateId];
  if (supplemental) {
    if (!profile.sources.some((entry) => entry.id === supplemental.source.id)) profile.sources.push(supplemental.source);
    for (const entry of supplemental.sources || []) if (!profile.sources.some((existing) => existing.id === entry.id)) profile.sources.push(entry);
    for (const [index, fact] of supplemental.facts.entries()) add(`verified-${index}`, fact.topic, fact.requirement, fact.sourceIds || [supplemental.source.id]);
    profile.gaps.push(...(supplemental.gaps || []));
  }

  // These are Creditex operating controls, clearly sourced as company policy.
  // They supplement the distinct technical/evidence facts above, never substitute
  // for an absent statutory activity definition or confer external qualifications.
  const policies: [string, string, string][] = [
    ["programme-output", "Correct programme outcome", `${programme.name} produces ${programme.claimOutputLabel}. Describe that outcome accurately to the customer; an internal assessment pass is not that outcome`],
    ["activity-boundary", "Exact scope of work", `This module is confined to ${activity.title} (${activity.registryActivityCode}) under ${programme.name}. A similar trade category or a pass in a different programme does not establish this activity's eligibility`],
    ["source-version", "Installation-date source control", `Before committing ${activity.title} to a programme claim, resolve the official rules effective on the implementation date and retain the source version. Stop if the applicable version or commencement date is uncertain`],
    ["business-authority", "Business authority", `Creditex must approve the business's declared programme scope, insurance and executed agreement for ${programme.name}; a capability tick box cannot grant that approval`],
    ["individual-authority", "Each assigned person's authority", `Every person assigned programme work needs their own current activity training and any separately required licence, accreditation or specialist credential. A director's pass does not qualify the rest of the team`],
    ["signed-facts", "Declarations reflect completed facts", `For ${activity.title}, signatures must identify the actual authorised signer and true dates and facts. Never reuse a customer's signature, sign for an absent installer or backdate a declaration`],
    ["original-proof", "Evidence custody", `Preserve the original ${activity.title} evidence, capture time and device metadata where collected. Link the record to the exact premises and retain corrections as traceable revisions rather than overwriting original evidence`],
    ["changed-scope", "Changes at the site", `If site conditions or the equipment differ from the approved ${activity.title} scope, pause the programme work and obtain a revised eligibility and evidence decision before continuing`],
    ["separate-claims", "Multiple programme claims", `Any other incentive linked to this ${activity.title} job needs its own eligibility, assignment, payment and duplication checks. Approval under ${programme.name} does not automatically approve another scheme`],
    ["completion-boundary", "Job completion and external acceptance", `A completed TLink job or passed quiz does not prove that ${programme.claimOutputLabel} has been accepted. Record the external administrator or provider outcome separately from local work completion`],
    ["complaint", "Complaints and incorrect records", `Escalate complaints, suspected false ${activity.title} evidence, unsafe work and missing authority to Creditex. Preserve relevant records and correct errors through the controlled review process`],
    ["revocation", "Approval after a pass", `Recheck business, activity and individual approval when booking or assigning ${activity.title}. An expired or revoked pass is not made valid by an earlier successful job`],
  ];
  for (const [key, topic, requirement] of policies) add(key, topic, requirement, [policySource.id], "procedure");
  if (activity.catalogueState === "closed") add("closed-activity", "Closed activity boundary", `The retained catalogue identifies ${activity.title} as closed. This learning module supports understanding and legacy review only; do not book new programme claims without a separately verified lawful pathway`, [policySource.id], "authority");
  if (activity.catalogueState === "future") add("future-activity", "Future activity boundary", `The retained catalogue identifies ${activity.title} as future. Announcements alone do not establish an active claim pathway; verify commencement, rules and provider authority before any programme booking`, [policySource.id], "authority");
  if (activity.catalogueState === "specialist") add("specialist-activity", "Specialist approval boundary", `${activity.title} needs the applicable specialist project or facility approval, method and qualified professionals. This operational knowledge assessment cannot replace those approvals or specialist competence`, [policySource.id], "authority");
  const substantive = profile.facts.filter((entry) => entry.kind !== "procedure").length;
  if (substantive < 8) profile.gaps.push(`Only ${substantive} activity-specific source learning points have been transcribed; complete the exact activity technical, eligibility and evidence review before activation.`);
  return profile;
}

export const CREDITEX_ACTIVITY_TRAINING_PROFILES: readonly ActivityLearningProfile[] = GOVERNMENT_ACTIVITY_TEMPLATES.map(createProfile);
