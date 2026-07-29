export type CustomerPlanReportView = {
  version: string;
  heading: string;
  planTitle: string;
  summary: string;
  preparedDate: string;
  planningSnapshot: Array<{ label: string; value: string }>;
  climate: null | { label: string; summary: string };
  readiness: {
    answered: number;
    total: number;
    notSure: number;
    linked: number;
    missing: number;
    missingLabels: string[];
    message: string;
    boundary: string;
  };
  professionalReview: null | {
    role: string;
    roleLabel: string;
    adviserName: string;
    accreditationScheme: string;
    accreditationReference: string;
    notes: string;
    statement: string;
    readinessBoundary: string;
    boundary: string;
  };
  everydayActions: Array<{
    id: string;
    category: string;
    title: string;
    description: string;
  }>;
  everydayActionsBoundary: string;
  questions: Array<{
    number: number;
    prompt: string;
    whyItMatters: string;
  }>;
  decisionBasis: string[];
  actions: Array<{
    number: number;
    id: string;
    stage: string;
    title: string;
    description: string;
    completed: boolean;
    priority: boolean;
    guideLabel: string;
    guideHref: string;
  }>;
  changeBoundary: string;
  beforeTrade: string[];
  privacyNote: string;
  adviceBoundary: string;
};
