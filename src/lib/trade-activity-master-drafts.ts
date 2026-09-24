import type { ActivityForm } from "./trade-activity-form-types";

export type ActivityMasterDraftSummary = {
  id: string;
  activityTemplateId: string;
  variantId: string;
  title: string;
  revision: number;
  baseMasterVersion: number;
  status: "draft" | "published" | "discarded";
  createdAt: string;
  updatedAt: string;
};

export type ActivityMasterDraft = ActivityMasterDraftSummary & {
  form: ActivityForm;
  currentMasterVersion: number;
  baseIsCurrent: boolean;
};
