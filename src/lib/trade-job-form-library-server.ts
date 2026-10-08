import { GOVERNMENT_ACTIVITY_TEMPLATES, GOVERNMENT_PROGRAM_TEMPLATES } from "./australian-government-program-catalogue";
import { activityFieldCatalogue } from "./trade-activity-forms-library";
import { activityPremisesVariantId, activityRequiresPremisesVariant } from "./trade-compliance-intent";
import { RENTAL_ASSESSMENT_MODULES } from "./trade-rental-assessment.mjs";
import { createVeuElectricalForm } from "./veu-electrical-safety-form";
import { publishedTradeFormTemplatesFor, type TradeFormTemplate } from "./trade-form-templates-server";
import { tradeJobFormSelectionId, type TradeJobFormLibraryOption, type TradeJobFormSelection } from "./trade-job-form-library";

export type SavedJobFormEligibility = {
  revision: number;
  canAdd: boolean;
  unavailableReason: string;
  activities: { id: string; programTemplateId: string; added: boolean; unavailableReason: string }[];
  rentalModules: { id: string; added: boolean; unavailableReason: string }[];
};

function option(selection: TradeJobFormSelection, metadata: Omit<TradeJobFormLibraryOption, "id" | "selection" | "searchText" | "name">): TradeJobFormLibraryOption {
  return { ...metadata, selection, id: tradeJobFormSelectionId(selection), name: selection.name,
    searchText: [selection.name, metadata.group, metadata.jurisdiction, metadata.description, ...metadata.categories].join(" ").toLocaleLowerCase("en-AU") };
}

function planningReason(state: string, label: string) {
  if (state === "closed") return `${label} is closed and cannot be selected for new work.`;
  if (state === "future") return `${label} has not commenced.`;
  if (state === "specialist") return `${label} requires a specialist workflow.`;
  return "";
}

export function buildTradeJobFormLibrary({ serviceCategory, addressState, buildingType, businessTemplates,
  saved, attachedBusinessIds = [], piesaAdded = false, piesaUnavailableReason = "", businessUnavailableReason = "" }: {
  serviceCategory: string; addressState: string; buildingType: string; businessTemplates: TradeFormTemplate[];
  saved?: SavedJobFormEligibility; attachedBusinessIds?: string[]; piesaAdded?: boolean; piesaUnavailableReason?: string; businessUnavailableReason?: string;
}): TradeJobFormLibraryOption[] {
  const options: TradeJobFormLibraryOption[] = [];
  const fieldForms = activityFieldCatalogue();
  for (const fieldForm of fieldForms) {
    const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(entry => entry.templateId === fieldForm.activityTemplateId);
    const program = GOVERNMENT_PROGRAM_TEMPLATES.find(entry => entry.programCode === fieldForm.programCode);
    if (!activity || !program) throw new Error("JOB_FORM_CATALOGUE_INVALID");
    const variantId = activityPremisesVariantId(activity.templateId, buildingType);
    const eligibility = saved?.activities.find(entry => entry.id === activity.templateId && entry.programTemplateId === program.templateId);
    const unavailableReason = planningReason(program.catalogueState, program.name) || planningReason(activity.catalogueState, activity.title)
      || (!addressState ? "Choose the job address state before adding this form." : program.jurisdiction !== "AU" && program.jurisdiction !== addressState
        ? `${program.programCode} is not available for a ${addressState} service site.` : "")
      || (activityRequiresPremisesVariant(activity.templateId) && !variantId ? "Choose residential or business premises before adding this form." : "")
      || (saved ? eligibility?.unavailableReason || (!eligibility ? saved.unavailableReason || "This activity cannot be added to this job." : "") : "");
    options.push(option({ kind: "creditex", programTemplateId: program.templateId, activityTemplateId: activity.templateId,
      ...(variantId ? { variantId } : {}), name: fieldForm.title }, {
      group: "Creditex forms", jurisdiction: program.jurisdiction, categories: [activity.serviceCategory],
      description: `${program.programCode} ${activity.registryActivityCode || activity.activityKey} | ${activity.scenario || activity.productCategory || program.name}`,
      unavailableReason, ...(saved ? { added: Boolean(eligibility?.added) } : {}),
    }));
  }
  for (const rentalModule of RENTAL_ASSESSMENT_MODULES) {
    const eligibility = saved?.rentalModules.find(entry => entry.id === rentalModule.key);
    options.push(option({ kind: "rental", moduleKey: rentalModule.key, name: rentalModule.label }, {
      group: "Rental assessments", jurisdiction: "VIC", description: rentalModule.reportBoundary, categories: ["rental-inspection"],
      unavailableReason: addressState !== "VIC" ? "Rental assessment forms currently cover Victorian properties."
        : saved ? eligibility?.unavailableReason || (!eligibility ? saved.unavailableReason || "This assessment cannot be added to this job." : "") : "",
      ...(saved ? { added: Boolean(eligibility?.added) } : {}),
    }));
  }
  const piesa = createVeuElectricalForm();
  options.push(option({ kind: "piesa", name: piesa.title }, {
    group: "Creditex forms", jurisdiction: "VIC", description: "Pre-insulation electrical safety assessment (PIESA) with evidence, signatures and the completed PDF.",
    categories: ["insulation", "electrical"], unavailableReason: addressState !== "VIC"
      ? "The pre-installation electrical safety assessment covers Victorian properties." : piesaUnavailableReason,
    ...(saved ? { added: piesaAdded } : {}),
  }));
  for (const template of businessTemplates) {
    const selection: TradeJobFormSelection = { kind: "business", templateKey: template.key, templateVersion: template.version, name: template.name };
    options.push(option(selection, { group: "Business forms", jurisdiction: template.jurisdiction,
      description: template.description, categories: template.categories,
      unavailableReason: businessUnavailableReason || (!template.categories.includes(serviceCategory || "other") ? "This published form is not available for this job's work type."
        : template.jurisdiction !== "AU" && template.jurisdiction !== addressState ? `This form covers ${template.jurisdiction} properties.` : ""),
      ...(saved ? { added: attachedBusinessIds.includes(tradeJobFormSelectionId(selection)) } : {}),
    }));
  }
  return options.sort((left, right) => left.group.localeCompare(right.group, "en-AU") || left.name.localeCompare(right.name, "en-AU"));
}

export async function loadTradeJobFormLibrary(input: Omit<Parameters<typeof buildTradeJobFormLibrary>[0], "businessTemplates">,
  database: D1Database, ownerUid: string) {
  const businessTemplates = await publishedTradeFormTemplatesFor(input.serviceCategory, database, ownerUid,
    { allCategories: true, includeBuiltIns: false });
  return buildTradeJobFormLibrary({ ...input, businessTemplates });
}
