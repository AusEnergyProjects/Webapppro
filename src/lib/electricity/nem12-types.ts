export type Nem12Direction = "import" | "export";
export type Nem12Confidence = "low" | "indicative" | "good" | "high";
export type RegisterRole = "general" | "controlled";

export type HalfHourlyGrid = number[][];

export interface Nem12DaySeries {
  date: string;
  dow: number;
  stamp: number;
  import: number[];
  export: number[];
  importSeen: boolean;
  exportSeen: boolean;
}

export interface Nem12RegisterDay {
  date: string;
  dow: number;
  stamp: number;
  values: number[];
}

export interface Nem12Register {
  id: string;
  registerId: string;
  suffix: string;
  direction: "import";
  intervalMinutes: 5 | 15 | 30;
  observedKwh: number;
  annualKwh: number;
  observedDays: number;
  suggestedRole: RegisterRole | null;
  roleConfidence: "explicit" | "likely" | "review";
  series: Nem12RegisterDay[];
}

export interface Nem12Success {
  ok: true;
  nmi: string | null;
  importKwh: number;
  exportKwh: number;
  annualImport: number;
  annualExport: number;
  spanDays: number;
  dateSpanDays: number;
  coverageRatio: number;
  startDate: string;
  endDate: string;
  fullYear: boolean;
  confidence: Nem12Confidence;
  actualPct: number;
  warnings: string[];
  profile: HalfHourlyGrid;
  grid: HalfHourlyGrid;
  exportProfile: HalfHourlyGrid;
  exportGrid: HalfHourlyGrid;
  dowCount: number[];
  exportDowCount: number[];
  series: Nem12DaySeries[];
  eChannels: Set<string>;
  bChannels: Set<string>;
  intervalLengths: Array<5 | 15 | 30>;
  qualityCounts: Record<string, number>;
  registers: Nem12Register[];
}

export interface Nem12Failure {
  ok: false;
  err: string;
}

export type Nem12ParseResult = Nem12Success | Nem12Failure;

export interface Nem12AllocatedDay {
  date: string;
  dow: number;
  stamp: number;
  general: number[];
  controlled: number[];
}

export interface Nem12RegisterAllocation {
  ok: true;
  series: Nem12AllocatedDay[];
  generalObservedKwh: number;
  controlledObservedKwh: number;
  annualGeneralKwh: number;
  annualControlledKwh: number;
  generalProfile: HalfHourlyGrid;
  controlledProfile: HalfHourlyGrid;
  controlledRegisterIds: string[];
}

export interface Nem12RegisterAllocationFailure {
  ok: false;
  unresolved: string[];
}

export type Nem12RegisterAllocationResult = Nem12RegisterAllocation | Nem12RegisterAllocationFailure;

export interface Nem12ChartModel {
  weekday: number[];
  weekend: number[] | null;
  maximum: number;
  busiestBin: number;
  averageDailyKwh: number;
  peakPercent: number;
  shoulderPercent: number;
  offPeakPercent: number;
}
