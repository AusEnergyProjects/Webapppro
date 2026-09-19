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
 * or Creditex approval. Complete courses support automatic individual assessment.
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
  id: "creditex-training-policy", title: "Creditex training, evidence and exception handling policy",
  url: "/creditex-resources/creditex-training-operating-policy.md", reviewedAt: "2026-09-19",
};
const sentence = (value: string) => /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
const words = (value: string) => value.replaceAll("_", " ").replace(/\b(?:abn|acn|stc|pv|nmi|nem|rec|sgu)\b/gi, (term) => term.toUpperCase());

/** Copy-only substitutions. Keep technical names, limits, dates and conditions intact. */
export function plainTrainingText(value: string): string {
  return value
    .replace(/\bpremises\b/g, "property")
    .replace(/\bRetain\b/g, "Keep")
    .replace(/\bretain\b/g, "keep")
    .replace(/\bObtain\b/g, "Get")
    .replace(/\bobtain\b/g, "get")
    .replace(/\bVerify\b/g, "Check")
    .replace(/\bverify\b/g, "check")
    .replace(/\bdiscrepancy\b/g, "difference")
    .replace(/\bdiscrepancies\b/g, "differences")
    .replace(/\bcommencement date\b/g, "start date")
    .replace(/\bcommences\b/g, "starts")
    .replace(/\bprogramme\b/g, "program")
    .replace(/\bprogrammes\b/g, "programs");
}

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
    const description = sentence(plainTrainingText(requirement));
    if (!requirement.trim() || profile.facts.some((entry) => entry.key === key || entry.requirement === description)) return;
    profile.facts.push({ key, topic: plainTrainingText(words(topic)), requirement: description, sourceIds, kind });
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
        `Keep ${item.label}: ${item.details.join("; ")}. When required: ${item.when}`, [id], "evidence");
    }
    for (const item of veu.prompts.filter((entry) => entry.kind === "assignment" || entry.kind === "identity")) {
      add(`declaration-${item.key}`, item.label.replace(" from the applicable activity assignment form template", ""),
        `Record ${item.label}. When required: ${item.when}. Use the real job details and the people authorised to sign`, [source(item.source)], "authority");
    }
    for (const signature of veu.signatures) add(`signature-${signature.signatureId}`, `${words(signature.signerRole)} signature`,
      `The ${words(signature.documentType)} needs the ${words(signature.signerRole)} signature ${signature.when}. Another worker or account owner cannot sign for them without the required permission`, [source(signature.source)], "authority");
  }

  const sres = CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES.find((entry) => entry.templateId === activity.templateId);
  if (sres) {
    for (const entry of sres.sourceBindings) source(entry);
    for (const prompt of sres.prompts) {
      add(`sres-${prompt.key}`, prompt.label, `For ${prompt.label}, record: ${prompt.fields.map(words).join(", ")}. When required: ${prompt.when}`, [source(prompt.source)], ["identity", "assignment", "declaration"].includes(prompt.kind) ? "authority" : "activity");
    }
    for (const evidence of sres.evidenceRequirements) {
      add(`evidence-${evidence.requirementId}`, evidence.label,
        `Keep ${evidence.label}: ${evidence.details.join("; ")}. When required: ${evidence.when}`, [source(evidence.source)], "evidence");
    }
    add("sres-calculation", "Entitlement calculation", sres.calculator.formulaSummary.replace("multiplied by 2031 minus installation year", "multiplied by (2031 minus installation year)"), [source(sres.calculator.source)]);
    add("sres-scenario", "Installation history", `Check which description matches the real installation: ${sres.scenarioRules.sourceOptions.map(words).join("; ")}. This decides which history and eligibility checks are needed`, [source(sres.scenarioRules.source)]);
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
        `The ${words(signature.signerRole)} signs the ${words(signature.documentType)} themselves. When required: ${signature.when}`, [source(signature.source)], "authority");
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
    add("nsw-rule-period", "Dates these rules apply", `Apply the ${definition.effectiveDateLabel || "Installation date"} rules from ${definition.effectiveFrom}${definition.effectiveTo ? ` through ${definition.effectiveTo}` : ""}. Check again if the rules change`, ids, "authority");
  }
  if (nsw) {
    for (const entry of nsw.sources) source(entry);
    for (const evidence of nsw.evidenceRequirements) add(`evidence-${evidence.key}`, evidence.label,
      `Include ${evidence.label} in the job file. Keep the originals and their recorded date and file details linked to this job`, [source(evidence.source)], "evidence");
    for (const section of nsw.formSections.filter((entry) => entry.sectionKey === "job-and-nomination")) {
      for (const field of section.fields) add(`authority-${field.key}`, field.label,
        `Record ${field.label} on this job's nomination form. Use the actual customer, provider and site records`, [source(field.source)], "authority");
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
    ["programme-output", "What the program provides", `${programme.name} provides ${programme.claimOutputLabel}. Explain this accurately to the customer. Passing this quiz records your training; it does not mean the customer's application or claim has been accepted`],
    ["activity-boundary", "Which work this module covers", `This module covers ${activity.title} (${activity.registryActivityCode}) under ${programme.name}. Check the activity for the actual job. A similar service or a pass for another program does not prove this job qualifies`],
    ["source-version", "Use the rules for the job date", `Before promising a program benefit for ${activity.title}, check which official rules apply on the actual job date. Keep a record of that version with the job. A new date can change the rules, so check again if the job moves. If the start date or rule is unclear, resolve it before going ahead`],
    ["business-authority", "Get the business ready", `Before accepting ${programme.name} work, complete business setup with current insurance, the signed Creditex agreement, the correct program and required licences or credentials. Selecting a service in TLink only tells us what work you want to offer. It does not replace these checks`],
    ["individual-authority", "Each person completes their own training", `Every person assigned program work needs their own current activity training and any required licence, accreditation or specialist credential. The business owner's pass belongs to that person. It does not qualify employees or subcontractors, even when they work on the same job`],
    ["signed-facts", "Get the right person to sign", `For ${activity.title}, use the real authorised signer's signature and the correct dates and job details. Complete the form before it is signed so the person can check what they are agreeing to. Never copy a customer's signature, sign for an absent installer or put an earlier date on a form`],
    ["original-proof", "Keep originals when fixing mistakes", `Keep the original ${activity.title} records, including the photo capture time and device details where collected. Add a correction linked to the same job and property, showing what changed and when. Keep the original alongside it so the change can be followed. Do not change photo dates, use another job's photos or delete the original to hide a mistake`],
    ["changed-scope", "Check changes before going ahead", `If the site or equipment differs from the approved ${activity.title} job details, pause the program work. Get the changed job checked for eligibility and the evidence now required before continuing. The original decision covered the original details; it cannot prove the changed job qualifies`],
    ["separate-claims", "Check each program separately", `Any other incentive for this ${activity.title} job needs its own eligibility, any required signed assignment forms, payment and duplicate-claim checks. The assignment form records who receives the right to claim the certificates or benefit. Approval under ${programme.name} does not automatically approve another program, and one signed form may not cover both`],
    ["completion-boundary", "Record the actual claim result", `A completed TLink job or passed quiz does not prove that the claim for ${programme.claimOutputLabel} has been accepted. Keep the result from the program administrator or provider as a separate record. Only tell the customer a claim has been accepted when you have that result`],
    ["complaint", "Report problems and keep the records", `Tell Creditex about complaints, suspected false ${activity.title} records, unsafe work or missing permission to do the work. Keep the records that show the problem. Correct mistakes through the job's review process so the original and the correction can both be checked`],
    ["revocation", "Check training before the next booking", `When booking or assigning ${activity.title}, check the business setup, this activity's eligibility and each person's current training. A 100% pass completes that person's training automatically. If a pass expires or is cancelled, resolve that before booking. A successful past job or a colleague's pass cannot make it current again`],
  ];
  for (const [key, topic, requirement] of policies) add(key, topic, requirement, [policySource.id], "procedure");
  if (activity.catalogueState === "closed") add("closed-activity", "This activity is closed", `${activity.title} is listed as closed. Use this module to understand its rules and review older jobs. Do not book new claims unless a current, lawful option has been separately checked and confirmed`, [policySource.id], "authority");
  if (activity.catalogueState === "future") add("future-activity", "This activity has not started", `${activity.title} is listed as a future activity. An announcement does not mean claims are open. Check its start date, rules and the provider's permission before booking work under the program`, [policySource.id], "authority");
  if (activity.catalogueState === "specialist") add("specialist-activity", "Specialist work needs separate checks", `${activity.title} needs the required specialist project or facility approval, method and qualified professionals. This quiz teaches the checks you must follow. It cannot replace those approvals or the specialist skills needed to do the work`, [policySource.id], "authority");
  const substantive = profile.facts.filter((entry) => entry.kind !== "procedure").length;
  if (substantive < 8) profile.gaps.push(`Only ${substantive} activity-specific source learning points have been transcribed; complete the exact activity technical, eligibility and evidence review before activation.`);
  return profile;
}

export const CREDITEX_ACTIVITY_TRAINING_PROFILES: readonly ActivityLearningProfile[] = GOVERNMENT_ACTIVITY_TEMPLATES.map(createProfile);
