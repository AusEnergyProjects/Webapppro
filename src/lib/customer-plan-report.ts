export type CustomerPlanReportAction = {
  number: number;
  id: string;
  stage: string;
  title: string;
  description: string;
  whatToDo: string;
  whyItMatters: string;
  householdReason: string;
  confirmBeforeWork: string[];
  quoteChecklist: string[];
  sequence: string;
  safety: string;
  solutionOptions: Array<{
    label: string;
    description: string;
  }>;
  completed: boolean;
  priority: boolean;
  guideLabel: string;
  guideHref: string;
  links: Array<{ label: string; href: string }>;
};

export type CustomerPlanReportView = {
  version: string;
  designVersion: string;
  heading: string;
  planTitle: string;
  summary: string;
  preparedDate: string;
  displayDate: string;
  preparedFor: string;
  customerSummary: string;
  copy: {
    brand: string;
    heroEyebrow: string;
    heroTitle: string;
    heroIntro: string;
    snapshotEyebrow: string;
    snapshotTitle: string;
    readinessEyebrow: string;
    climateEyebrow: string;
    startEyebrow: string;
    startTitle: string;
    startIntro: string;
    everydayEyebrow: string;
    everydayTitle: string;
    everydayIntro: string;
    whyEyebrow: string;
    whyTitle: string;
    roadmapEyebrow: string;
    roadmapTitle: string;
    roadmapIntro: string;
    completedEyebrow: string;
    completedTitle: string;
    completedIntro: string;
    tradeEyebrow: string;
    tradeTitle: string;
    privacyEyebrow: string;
    privacyTitle: string;
    guideLabel: string;
    footer: string;
  };
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
  readinessPresentation: {
    title: string;
    body: string;
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
  professionalPresentation: null | {
    eyebrow: string;
    title: string;
    role: string;
    scheme: string;
    reference: string;
    notes: string;
    boundary: string;
  };
  everydayActions: Array<{
    id: string;
    category: string;
    title: string;
    description: string;
    outcome: string;
  }>;
  everydayActionsBoundary: string;
  electrificationMoves: Array<{
    id: string;
    title: string;
    summary: string;
    checkFirst: string;
  }>;
  questions: Array<{
    number: number;
    prompt: string;
    whyItMatters: string;
  }>;
  decisionBasis: string[];
  actions: CustomerPlanReportAction[];
  priorityActions: CustomerPlanReportAction[];
  laterActions: CustomerPlanReportAction[];
  changeBoundary: string;
  beforeTrade: string[];
  resources: Array<{
    label: string;
    description: string;
    href: string;
  }>;
  privacyNote: string;
  adviceBoundary: string;
};
